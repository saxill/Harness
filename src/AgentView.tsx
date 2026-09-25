import { Fragment, useEffect, useRef, useState } from "react";
import { api, Device, runOutput, runs } from "./api";
import { laya, LayaChoice, vault } from "./hub";
import { Badge, RunPanel, useRuns, useStatus } from "./components";

type Msg = Record<string, unknown>;

type Item =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "error"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      device?: string;
      command?: string;
      reason?: string;
      state: "pending" | "running" | "done" | "denied";
      runId?: string;
      summary?: string;
      risk?: LayaChoice | "unavailable";
    };

const ROLE_NOTES: Record<string, string> = {
  macos: "macOS, zsh",
  linux: "Linux, bash",
  windows: "Windows 11, PowerShell (commands run inside powershell -NoProfile)",
};

function systemPrompt(devices: Device[]) {
  const list = devices
    .map((d) => `- id "${d.id}": ${d.name} — ${ROLE_NOTES[d.kind] ?? d.kind}; ${d.role}${d.isLocal ? " (the machine this app is running on)" : ""}`)
    .join("\n");
  return `You are Harness, an operator for Sahil's machines. They are linked over Tailscale; you act through tools.
Today is ${new Date().toDateString()}.

Machines:
${list}

What lives where:
- pi (user saxill): Zara agent at /mnt/phone_files/files; shorts-factory ~/storage/shorts-factory (API 127.0.0.1:7123); shorts-poster (127.0.0.1:7124, queue ~/storage/shorts-outbox, held Shorts in .hold/); ig-poster ~/storage/ig-poster; linkedin-factory ~/storage/linkedin-factory; n8n :5678; open-webui :3000. Some services are user units: use systemctl --user for shorts-factory, open-webui, linkedin-approver.
- channa: Hermes (another AI agent) at D:\\hermes. His jobs: & 'D:\\hermes\\bin\\hermes.exe' cron list (set $env:HERMES_HOME='D:\\hermes' first).

Rules:
- Check before you claim. Use run_command or get_status to find facts; never state something you did not see in tool output.
- One command per call, read-only whenever possible, and say why in "reason". Sahil approves every command; if he denies one, do not retry it — ask what he wants instead.
- Never kill processes by name (no pkill, killall, taskkill /IM). Look up the exact PID and kill that.
- On the Pi never use root or sudo for anything touching the browser profiles (~/storage/chrome-*-profile); root runs log Instagram and YouTube out.
- Never publish anything (YouTube, Instagram, LinkedIn) unless Sahil asked for that exact post in this chat.
- Never print secrets: .env files, .agent_env, tokens, keys, cookies.
- Keep replies short and concrete: numbers, names, what you changed.`;
}

function tools(devices: Device[]) {
  const ids = devices.map((d) => d.id);
  return [
    {
      type: "function",
      function: {
        name: "run_command",
        description: "Run one shell command on one machine and get its output and exit code. Sahil must approve it first.",
        parameters: {
          type: "object",
          properties: {
            device: { type: "string", enum: ids },
            command: { type: "string", description: "bash/zsh on Linux and macOS; PowerShell on Windows." },
            reason: { type: "string", description: "One short sentence: why this command." },
          },
          required: ["device", "command", "reason"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_status",
        description: "Read a machine's current status (uptime, CPU, memory, disks, battery; Wi-Fi and Hermes jobs on Windows). Read-only, no approval needed.",
        parameters: { type: "object", properties: { device: { type: "string", enum: ids } }, required: ["device"] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_pipelines",
        description: "Read the Pi's content pipelines: Shorts queue with fact-check marks, held Shorts, factory job states, today's posts, LinkedIn drafts, service states. Read-only.",
        parameters: { type: "object", properties: {} },
      },
    },
  ];
}

/** Just enough markdown for model replies: code fences, inline code, bold. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/```(?:\w+)?\n?/);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <pre key={i} className="code">{p.replace(/\n$/, "")}</pre>
        ) : (
          <div key={i} className="prose">
            {p.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((s, j) =>
              s.startsWith("`") && s.endsWith("`") ? <code key={j}>{s.slice(1, -1)}</code>
                : s.startsWith("**") && s.endsWith("**") ? <b key={j}>{s.slice(2, -2)}</b>
                  : <Fragment key={j}>{s}</Fragment>)}
          </div>
        ))}
    </>
  );
}

export default function AgentView({ onSettings }: { onSettings: () => void }) {
  const { devices } = useStatus();
  const allRuns = useRuns();
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState("");
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const history = useRef<Msg[]>([]);
  const chatStarted = useRef<Date | null>(null);
  const approvals = useRef(new Map<string, (ok: boolean) => void>());
  const stop = useRef(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.agentSettings().then((s) => setModel(s.model));
    api.hasKey().then(setHasKey);
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [items.length, allRuns]);

  const push = (it: Item) => setItems((xs) => [...xs, it]);
  const patchTool = (id: string, patch: Partial<Extract<Item, { kind: "tool" }>>) =>
    setItems((xs) => xs.map((x) => (x.kind === "tool" && x.id === id ? { ...x, ...patch } : x)));

  const decide = (id: string, ok: boolean) => {
    approvals.current.get(id)?.(ok);
    approvals.current.delete(id);
  };

  async function callTool(call: { id: string; function: { name: string; arguments: string } }): Promise<string> {
    let args: Record<string, string> = {};
    try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* handled below */ }
    const name = call.function.name;

    if (name === "get_status" || name === "get_pipelines") {
      const dev = name === "get_pipelines" ? devices.find((d) => d.pipelines)?.id : args.device;
      push({ kind: "tool", id: call.id, name, device: dev, state: "running" });
      try {
        const data = name === "get_pipelines" ? await api.pipelines(dev ?? "pi") : await api.probe(args.device);
        patchTool(call.id, { state: "done", summary: "read status" });
        return JSON.stringify(data).slice(0, 12000);
      } catch (e) {
        patchTool(call.id, { state: "done", summary: String(e) });
        return `error: ${e}`;
      }
    }

    if (name !== "run_command" || !args.device || !args.command) {
      return `error: bad tool call ${name} ${call.function.arguments}`;
    }
    push({ kind: "tool", id: call.id, name, device: args.device, command: args.command, reason: args.reason, state: "pending" });
    // Laya's quick second opinion on what the command would do, shown on the card.
    laya.commandRisk(args.command, devices.find((d) => d.id === args.device)?.name ?? args.device)
      .then((risk) => patchTool(call.id, { risk }), () => patchTool(call.id, { risk: "unavailable" }));
    const ok = await new Promise<boolean>((resolve) => approvals.current.set(call.id, resolve));
    if (!ok) {
      patchTool(call.id, { state: "denied" });
      return "Sahil denied this command. Do not run it; ask what he wants instead.";
    }
    const pending = runs.start(args.device, args.command, "agent");
    const runId = runs.getSnapshot()[0]?.id;
    patchTool(call.id, { state: "running", runId });
    const run = await pending;
    patchTool(call.id, { state: "done" });
    return JSON.stringify({
      exit_code: run.error ? null : run.code,
      cancelled: !!run.cancelled,
      error: run.error,
      output: runOutput(run, 6000) || "(no output)",
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    stop.current = false;
    setBusy(true);
    if (history.current.length === 0) history.current.push({ role: "system", content: systemPrompt(devices) });
    history.current.push({ role: "user", content: text });
    push({ kind: "user", text });
    try {
      for (let step = 0; step < 16 && !stop.current; step++) {
        const msg = await api.complete(history.current, tools(devices));
        history.current.push(msg);
        const content = typeof msg.content === "string" ? msg.content.trim() : "";
        if (content) push({ kind: "assistant", text: content });
        const calls = (msg.tool_calls as { id: string; function: { name: string; arguments: string } }[] | undefined) ?? [];
        if (calls.length === 0) break;
        for (const c of calls) {
          if (stop.current) break;
          const result = await callTool(c);
          history.current.push({ role: "tool", tool_call_id: c.id, content: result });
        }
      }
    } catch (e) {
      push({ kind: "error", text: String(e) });
    } finally {
      approvals.current.forEach((r) => r(false));
      approvals.current.clear();
      setBusy(false);
      saveTranscript();
    }
  }

  /** Harness/Agent/<start>.md in Obsidian, rewritten after every turn. */
  function saveTranscript() {
    if (!chatStarted.current) chatStarted.current = new Date();
    const t = chatStarted.current;
    const stamp = `${t.toISOString().slice(0, 10)} ${t.toTimeString().slice(0, 5).replace(":", "")}`;
    const lines = history.current.filter((m) => m.role !== "system").map((m) => {
      if (m.role === "user") return `**You:** ${m.content}`;
      if (m.role === "tool") return "```\n" + String(m.content).slice(0, 1500) + "\n```";
      const calls = (m.tool_calls as { function: { arguments: string } }[] | undefined) ?? [];
      const text = typeof m.content === "string" ? m.content : "";
      return [text && `**Agent:** ${text}`, ...calls.map((c) => `> ran: \`${(() => { try { return JSON.parse(c.function.arguments).command ?? c.function.arguments; } catch { return c.function.arguments; } })()}\``)].filter(Boolean).join("\n");
    });
    vault.write(`Harness/Agent/${stamp}.md`, `# Harness agent · ${stamp}\n\n${lines.join("\n\n")}\n`).catch(() => {});
  }

  const reset = () => {
    stop.current = true;
    approvals.current.forEach((r) => r(false));
    approvals.current.clear();
    history.current = [];
    chatStarted.current = null;
    setItems([]);
  };

  const devName = (id?: string) => devices.find((d) => d.id === id)?.name ?? id ?? "";

  return (
    <div className="view agent">
      <div className="view-head">
        <h1>Agent</h1>
        <span className="muted small">{model || "…"} · every command needs your approval</span>
        <span className="spacer" />
        {busy && <button className="btn" onClick={() => { stop.current = true; approvals.current.forEach((r) => r(false)); }}>Stop</button>}
        <button className="btn" onClick={reset}>New chat</button>
      </div>

      {hasKey === false && (
        <div className="alert alert-warn">
          No API key yet. <button className="btn btn-xs" onClick={onSettings}>Open Settings</button>
        </div>
      )}

      <div className="chat">
        {items.length === 0 && (
          <div className="empty">
            Ask about any machine — “why is channa's C: drive full?”, “is anything failing on the Pi?”, “what did Hermes do today?”
          </div>
        )}
        {items.map((it, i) => {
          if (it.kind === "user") return <div key={i} className="bubble bubble-user">{it.text}</div>;
          if (it.kind === "assistant") return <div key={i} className="bubble bubble-agent"><Rich text={it.text} /></div>;
          if (it.kind === "error") return <div key={i} className="alert alert-bad">{it.text}</div>;
          const run = it.runId ? allRuns.find((r) => r.id === it.runId) : undefined;
          return (
            <div key={i} className={`tool tool-${it.state}`}>
              <div className="tool-head">
                <Badge tone={it.name === "run_command" ? "accent" : "dim"}>{it.name === "run_command" ? "command" : it.name.replace("get_", "read ")}</Badge>
                <span className="tool-device">{devName(it.device)}</span>
                {it.state === "denied" && <Badge tone="bad">denied</Badge>}
                {it.state === "done" && it.summary && <span className="muted small">{it.summary}</span>}
              </div>
              {it.reason && <div className="small muted">{it.reason}</div>}
              {it.name === "run_command" && it.state === "pending" && (
                <div className="laya">
                  <span className="laya-tag">LAYA</span>
                  {it.risk === undefined && <span className="muted small">judging…</span>}
                  {it.risk === "unavailable" && <span className="muted small">offline — judge it yourself</span>}
                  {it.risk && it.risk !== "unavailable" && (
                    <Badge tone={it.risk.choice === "read_only" ? "ok" : it.risk.choice === "modifies" ? "warn" : "bad"}>
                      {it.risk.choice.replace("_", "-")} · {Math.round((it.risk.probabilities[it.risk.choice] ?? 0) * 100)}%
                    </Badge>
                  )}
                </div>
              )}
              {it.command && <pre className="code">{it.command}</pre>}
              {it.state === "pending" && (
                <div className="btn-row">
                  <button className="btn btn-primary" onClick={() => decide(it.id, true)}>Run it</button>
                  <button className="btn" onClick={() => decide(it.id, false)}>Deny</button>
                </div>
              )}
              {run && <RunPanel run={run} device={devices.find((d) => d.id === run.deviceId)} compact />}
            </div>
          );
        })}
        {busy && !items.some((x) => x.kind === "tool" && x.state === "pending") && <div className="muted small thinking">thinking…</div>}
        <div ref={end} />
      </div>

      <div className="card composer">
        <div className="composer-row">
          <textarea
            value={input}
            rows={2}
            placeholder={busy ? "Working…" : "Ask the agent…"}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button className="btn btn-primary" disabled={busy || !input.trim()} onClick={send}>Send</button>
        </div>
      </div>
    </div>
  );
}
