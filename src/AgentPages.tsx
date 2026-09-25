import { useEffect, useState } from "react";
import { Action, piActions } from "./actions";
import { runs, statusStore, when } from "./api";
import { Badge, Dot, OsGlyph, RunPanel, runAction, useRuns, useStatus } from "./components";
import { DEFAULT_CWD, SessionKind, sessions, vault } from "./hub";
import { ChatPanel } from "./ChatPanel";
import { HermesPanel } from "./Overview";
import { openSession, TerminalView, useSessions } from "./terminals";

/** Session tabs + the live terminal for one kind, filling the page. */
export function Deck({ kind, empty }: { kind: SessionKind; empty: React.ReactNode }) {
  const { sessions: all, active } = useSessions();
  const { devices } = useStatus();
  const mine = all.filter((s) => s.kind === kind);
  const current = mine.find((s) => s.id === active) ?? mine[mine.length - 1];
  if (!current) return <div className="deck deck-empty">{empty}</div>;
  return (
    <div className="deck">
      <div className="deck-tabs">
        {mine.map((s) => (
          <span key={s.id} className={`dock-tab ${s.id === current.id ? "dock-tab-on" : ""} ${s.alive ? "" : "dock-tab-dead"}`} onClick={() => sessions.focus(s.id)}>
            <Dot state={s.alive ? "ok" : "idle"} />
            <span>{devices.find((d) => d.id === s.deviceId)?.name ?? s.deviceId}</span>
            <button className="x" onClick={(e) => { e.stopPropagation(); sessions.close(s.id); }} aria-label="Close">×</button>
          </span>
        ))}
      </div>
      <TerminalView session={current} className="deck-term" />
    </div>
  );
}

/** Hermes and Zara: a chat panel, with their own terminal program one click away
 * (for slash commands and anything the chat can't do). */
function AgentTalk({ agent }: { agent: "hermes" | "zara" }) {
  const [view, setView] = useState<"chat" | "terminal">("chat");
  const { devices } = useStatus();
  const { sessions: all } = useSessions();
  const name = agent === "hermes" ? "Hermes" : "Zara";
  if (view === "chat") {
    return <ChatPanel agent={agent} onTerminal={() => {
      if (!all.some((s) => s.kind === agent && s.alive)) openSession(devices, agent);
      setView("terminal");
    }} />;
  }
  return (
    <div className="talk-term">
      <div className="talk-bar">
        <button className="btn btn-xs" onClick={() => setView("chat")}>← Chat</button>
        <span className="muted small">{name}'s own terminal program</span>
        <span className="spacer" />
        <button className="btn btn-xs" onClick={() => openSession(devices, agent)}>New terminal</button>
      </div>
      <Deck kind={agent} empty={<><div className="deck-big">No terminal open</div><div className="muted">Use New terminal, or go back to the chat.</div></>} />
    </div>
  );
}

// ---------------- Claude Code ----------------

export function ClaudeView() {
  const { devices, status } = useStatus();
  const { sessions: all } = useSessions();
  const [cwd, setCwd] = useState<Record<string, string>>(DEFAULT_CWD);

  const start = (id: string) => {
    const d = devices.find((x) => x.id === id);
    if (!d) return;
    sessions.open({ deviceId: id, kind: "claude", command: "claude", cwd: cwd[id], title: `Claude · ${d.name}` });
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>CLAUDE CODE</h1>
        <span className="muted small">The real Claude Code, running on the machine you pick. Its own permission prompts apply.</span>
      </div>
      <div className="machine-row">
        {devices.map((d) => {
          const n = all.filter((s) => s.kind === "claude" && s.deviceId === d.id && s.alive).length;
          const up = !!status[d.id]?.probe;
          return (
            <div key={d.id} className="machine">
              <div className="machine-top">
                <OsGlyph kind={d.kind} />
                <b>{d.name}</b>
                {d.id === "laptop" && <Badge tone="accent">worker</Badge>}
                <span className="spacer" />
                <Dot state={up ? "ok" : status[d.id]?.error ? "bad" : "idle"} />
              </div>
              <input className="mono-input" value={cwd[d.id] ?? ""} spellCheck={false}
                onChange={(e) => setCwd({ ...cwd, [d.id]: e.target.value })} aria-label={`Working folder on ${d.name}`} />
              <div className="machine-foot">
                <span className="muted small">{n ? `${n} running` : "idle"}</span>
                <button className="hud-btn" onClick={() => start(d.id)}>Start →</button>
              </div>
            </div>
          );
        })}
      </div>
      <Deck kind="claude" empty={<><div className="deck-big">No Claude Code session yet</div><div className="muted">Pick a machine above. The Linux laptop is the default worker.</div></>} />
    </div>
  );
}

// ---------------- Hermes ----------------

function VaultNotes({ folder }: { folder: string }) {
  const [notes, setNotes] = useState<{ path: string; mtime: number }[] | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  useEffect(() => { vault.list().then((r) => setNotes(r.notes.filter((n) => n.path.startsWith(folder + "/")))).catch(() => setNotes([])); }, [folder]);
  return (
    <div className="card panel">
      <div className="panel-head"><h2>Reports in Obsidian</h2><span className="muted small">{folder}/</span></div>
      {notes === null && <div className="muted small">reading the vault…</div>}
      {notes?.length === 0 && <div className="muted small">Nothing yet. Once the vault syncs, his reports land here.</div>}
      <ul className="list small">
        {notes?.slice(0, 8).map((n) => (
          <li key={n.path} className="list-row" style={{ cursor: "pointer" }}
            onClick={() => { setOpenPath(n.path); vault.read(n.path).then((r) => setContent(r.content)); }}>
            <span className="clip">{n.path.slice(folder.length + 1).replace(/\.md$/, "")}</span>
            <span className="muted">{when(new Date(n.mtime * 1000).toISOString())}</span>
          </li>
        ))}
      </ul>
      {openPath && <pre className="note-view">{content}</pre>}
    </div>
  );
}

function LogButtons({ items }: { items: { label: string; deviceId: string; command: string }[] }) {
  const all = useRuns();
  const { devices } = useStatus();
  const [ids, setIds] = useState<string[]>([]);
  const mine = all.filter((r) => ids.includes(r.id)).slice(0, 2);
  return (
    <>
      <div className="btn-row">
        {items.map((it) => (
          <button key={it.label} className="btn btn-xs" onClick={() => {
            const p = runs.start(it.deviceId, it.command, "user", it.label);
            setIds((xs) => [runs.getSnapshot()[0].id, ...xs]);
            return p;
          }}>{it.label}</button>
        ))}
      </div>
      {mine.map((r) => <RunPanel key={r.id} run={r} device={devices.find((d) => d.id === r.deviceId)} />)}
    </>
  );
}

export function HermesView() {
  const { devices, status } = useStatus();
  const pr = status["channa"]?.probe;
  const cDisk = pr?.disks?.find((d) => d.name === "C:");
  const LOG = "Get-Content 'D:\\hermes\\logs\\";
  return (
    <div className="page">
      <div className="page-head">
        <h1>HERMES</h1>
        <span className={pr?.hermes?.running ? "muted small" : "tone-bad small"}>
          {pr ? (pr.hermes?.running ? `gateway up since ${when(pr.hermes.since)}` : "gateway not running") : "checking channa…"}
        </span>
      </div>
      <div className="facts">
        <span>Wi-Fi <b>{pr?.wifi ? `${pr.wifi.state} · ${pr.wifi.signal ?? "?"}%` : "—"}</b></span>
        <span>C: <b className={cDisk && cDisk.used_percent >= 95 ? "tone-bad" : ""}>{cDisk ? `${cDisk.used_percent}% · ${cDisk.free_gb} GB free` : "—"}</b></span>
        <span>Jobs <b>{pr?.hermes?.jobs.filter((j) => j.enabled).length ?? "—"}</b></span>
      </div>
      <div className="two-col">
        <div className="stack">
          <HermesPanel probe={pr} devices={devices} />
          <div className="card panel">
            <div className="panel-head"><h2>Logs</h2></div>
            <LogButtons items={[
              { label: "Errors", deviceId: "channa", command: `${LOG}errors.log' -Tail 40` },
              { label: "Gateway", deviceId: "channa", command: `${LOG}gateway.log' -Tail 40` },
              { label: "Job runs", deviceId: "channa", command: "$env:HERMES_HOME='D:\\hermes'; & 'D:\\hermes\\bin\\hermes.exe' cron runs --limit 15" },
            ]} />
          </div>
        </div>
        <div className="stack">
          <AgentTalk agent="hermes" />
          <VaultNotes folder="Hermes" />
        </div>
      </div>
    </div>
  );
}

// ---------------- Zara ----------------

export function ZaraView() {
  const { devices, pipelines } = useStatus();
  const zara = (pipelines.data?.services ?? []).filter((s) => s.name.startsWith("zara"));
  const up = zara.filter((s) => s.state === "active").length;
  const journal = (unit: string) =>
    `journalctl -u ${unit} -n 60 --no-pager -o short-iso | grep -v 'Ignoring invalid environment assignment'`;
  const honesty: Action = {
    label: "Run Zara's honesty eval",
    deviceId: "pi",
    command: "cd /mnt/phone_files/files && set -a && . ./.agent_env && set +a && timeout 600 .venv/bin/python scripts/honesty_eval.py 2>&1 | tail -25",
    tone: "normal",
    effect: "Asks Zara a fixed set of questions and checks she uses tools instead of guessing. Takes a few minutes and uses model credits.",
  };
  return (
    <div className="page">
      <div className="page-head">
        <h1>ZARA</h1>
        <span className="muted small">{zara.length ? `${up}/${zara.length} services running` : "reading the Pi…"}</span>
        <span className="spacer" />
        <button className="btn" onClick={() => runAction(honesty, devices)}>Honesty eval</button>
      </div>
      <div className="two-col">
        <div className="stack">
          <div className="card panel">
            <div className="panel-head"><h2>Services</h2><button className="btn btn-xs" onClick={() => statusStore.refreshPipelines()}>Refresh</button></div>
            <ul className="services">
              {zara.map((s) => (
                <li key={s.name}>
                  <Dot state={s.state === "active" ? "ok" : "bad"} />
                  <span className="svc-name">{s.name}</span>
                  {s.restartable && (
                    <button className="icon-btn" title={`Restart ${s.name}`}
                      onClick={() => runAction(piActions.restart(s.name, s.scope), devices).then(() => statusStore.refreshPipelines())}>↻</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className="card panel">
            <div className="panel-head"><h2>Logs</h2><span className="muted small">last 60 lines</span></div>
            <LogButtons items={["zara-telegram", "zara-server", "zara-discord", "zara-healer"].map((u) => ({ label: u.replace("zara-", ""), deviceId: "pi", command: journal(u) }))} />
          </div>
        </div>
        <div className="stack">
          <AgentTalk agent="zara" />
          <VaultNotes folder="Zara" />
        </div>
      </div>
    </div>
  );
}
