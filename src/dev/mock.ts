// DEV ONLY. Lets the interface run in an ordinary browser for design work by
// standing in for the Rust side, fed with real status captured from the
// machines (fixtures.json, git-ignored). Never loaded inside the real app.
// A glob, so a fresh checkout without the file still type-checks and builds.
const found = import.meta.glob("./fixtures.json", { eager: true, import: "default" });
const fixtures = found["./fixtures.json"] ?? { probes: {}, pipelines: null, youtube: null };

type Cb = (e: unknown) => void;
const callbacks = new Map<number, Cb>();
const listeners = new Map<string, number[]>();
let nextId = 1;
const wait = <T,>(v: T, ms = 400) => new Promise<T>((r) => setTimeout(() => r(v), ms));

function emit(event: string, payload: unknown) {
  for (const id of listeners.get(event) ?? []) callbacks.get(id)?.({ event, id, payload });
}

const devices = [
  { id: "mac", name: "MacBook", kind: "macos", host: "sahil@100.106.218.120", role: "Laptop · Xcode, Claude", pipelines: false, isLocal: true },
  { id: "channa", name: "channa", kind: "windows", host: "Admin@100.111.91.80", role: "Hermes · carousels", pipelines: false, isLocal: false },
  { id: "pi", name: "Pi", kind: "linux", host: "saxill@100.90.23.49", role: "Zara · Shorts · LinkedIn", pipelines: true, isLocal: false },
  { id: "laptop", name: "Linux laptop", kind: "linux", host: "saxill@100.120.253.10", role: "Omarchy", pipelines: false, isLocal: false },
];

let agentStep = 0;
const fx = fixtures as unknown as { probes: Record<string, unknown>; pipelines: unknown; youtube: unknown };
const vaultNotes: Record<string, string> = {
  "Directives.md": "# Directives\n\n- [ ] Rotate the leaked secrets\n- [ ] Refresh Reckon on the iPhone before 27 Sep\n- [ ] Pick a model for Zara\n- [x] Log Instagram back in on the Pi\n",
  "Hermes/2026-09-25 daily check.md": "# Daily check\n\nAll 12 jobs ok.",
};

const handlers: Record<string, (a: Record<string, string>) => unknown> = {
  devices_list: () => devices,
  probe_device: ({ deviceId }) => wait(fx.probes[deviceId], 300 + Math.random() * 900),
  probe_pipelines: () => wait(fx.pipelines, 900),
  history_list: () => [
    { ts: Date.now() / 1000 - 300, runId: "a", deviceId: "pi", deviceName: "Pi", command: "df -h /", source: "user", code: 0, cancelled: false, durationMs: 812 },
    { ts: Date.now() / 1000 - 900, runId: "b", deviceId: "channa", deviceName: "channa", command: "Get-PSDrive C", source: "agent", code: 0, cancelled: false, durationMs: 2210 },
  ],
  agent_settings_get: () => ({ baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5" }),
  agent_settings_set: () => null,
  agent_key_status: () => true,
  agent_key_set: () => "keychain",
  devices_save: () => null,
  run_cancel: ({ runId }) => { emit("run://exit", { runId, code: null, cancelled: true, durationMs: 500 }); return true; },
  run_start: ({ runId, command }) => {
    const lines = [`$ ${command}`, "Filesystem      Size  Used Avail Use% Mounted on", "/dev/mmcblk0p2  6.9G  5.8G  770M  89% /"];
    lines.forEach((line, i) => setTimeout(() => emit("run://output", { runId, stream: "stdout", line }), 250 * (i + 1)));
    setTimeout(() => emit("run://exit", { runId, code: 0, cancelled: false, durationMs: 1100 }), 1100);
    return null;
  },
  agent_complete: () => {
    agentStep += 1;
    if (agentStep % 2 === 1) {
      return wait({ role: "assistant", content: "I'll check the disk on channa first.",
        tool_calls: [{ id: `call_${agentStep}`, type: "function", function: { name: "run_command",
          arguments: JSON.stringify({ device: "channa", command: "Get-ChildItem C:\\Users\\Admin -Directory | Sort-Object Name | Select-Object -First 5", reason: "See which folders are largest on C:" }) } }] }, 900);
    }
    return wait({ role: "assistant", content: "C: is **97% full** (2.1 GB free). The biggest folder is `C:\\Users\\Admin\\AppData\\Local` — mostly Hermes' uv cache." }, 900);
  },
  youtube_stats: () => wait(fx.youtube, 700),
  laya_judge: ({ state }) => wait({ answers: {
    risk: { choice: /rm |kill|delete/.test(String(state)) ? "destructive" : "read_only", probabilities: { read_only: 0.86, modifies: 0.1, destructive: 0.04 } },
    route: { choice: "claude", probabilities: { claude: 0.81, hermes: 0.12, zara: 0.07 } },
    ok: { noul: 0.97 },
  } }, 250),
  vault_settings_get: () => ({ deviceId: "pi", root: "~/storage/vault" }),
  vault_settings_set: () => null,
  vault_op: ({ op, path, content }) => {
    if (op === "list") return { exists: true, notes: Object.keys(vaultNotes).map((p) => ({ path: p, mtime: Date.now() / 1000 - 3600 })) };
    if (op === "read") return { exists: path in vaultNotes, content: vaultNotes[path] ?? "" };
    vaultNotes[path] = (op === "append" ? vaultNotes[path] ?? "" : "") + content;
    return { ok: true, path };
  },
  pty_open: ({ sessionId, command }) => {
    const say = (t: string) => emit("pty://data", { sessionId, data: btoa(unescape(encodeURIComponent(t))) });
    setTimeout(() => say(`\x1b[2m(browser preview — no real machine)\x1b[0m\r\n$ ${command ?? "bash -l"}\r\n`), 200);
    if (String(command).startsWith("claude")) setTimeout(() => say("\x1b[38;5;215m✻\x1b[0m Welcome to \x1b[1mClaude Code\x1b[0m\r\n\r\n  cwd: ~\r\n\r\n> "), 700);
    return null;
  },
  pty_write: ({ sessionId, data }) => { emit("pty://data", { sessionId, data: btoa(unescape(encodeURIComponent(String(data).replace(/\r/g, "\r\n")))) }); return null; },
  pty_resize: () => null,
  pty_close: () => null,
  "plugin:event|listen": ({ event, handler }) => {
    const id = Number(handler);
    listeners.set(event, [...(listeners.get(event) ?? []), id]);
    return id;
  },
  "plugin:event|unlisten": () => null,
};

const w = window as unknown as Record<string, unknown>;
w.__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: Record<string, string>) => {
    const h = handlers[cmd];
    if (!h) throw new Error(`mock: no handler for ${cmd}`);
    return h(args ?? {});
  },
  transformCallback: (cb: Cb) => {
    const id = nextId++;
    callbacks.set(id, cb);
    return id;
  },
  metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
};
w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
console.info("[harness] browser preview: using captured fixtures, not live machines");
