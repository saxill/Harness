// Terminals, YouTube analytics, the vault and Laya — the pieces the HUD is built from.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

type Listener = () => void;
class Emitter {
  private ls = new Set<Listener>();
  subscribe = (l: Listener) => { this.ls.add(l); return () => { this.ls.delete(l); }; };
  protected emit() { this.ls.forEach((l) => l()); }
}

// ---------------- terminals ----------------

export type SessionKind = "shell" | "claude" | "hermes" | "zara";

export interface Session {
  id: string;
  deviceId: string;
  kind: SessionKind;
  title: string;
  alive: boolean;
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
}

const decoder = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export const LAUNCH: Record<Exclude<SessionKind, "shell">, { deviceId?: string; command: string; cwd?: string; label: string }> = {
  claude: { command: "claude", label: "Claude Code" },
  hermes: {
    deviceId: "channa",
    command: "$env:HERMES_HOME='D:\\hermes'; $env:PYTHONIOENCODING='utf-8'; & 'D:\\hermes\\bin\\hermes.exe' chat",
    label: "Hermes",
  },
  zara: {
    deviceId: "pi",
    command: "cd /mnt/phone_files/files && set -a && . ./.agent_env && set +a && .venv/bin/python zara_cli.py",
    label: "Zara",
  },
};

export const DEFAULT_CWD: Record<string, string> = {
  mac: "~/code",
  pi: "~/storage",
  laptop: "~",
  channa: "D:\\hermes",
};

class SessionStore extends Emitter {
  sessions: Session[] = [];
  active: string | null = null;
  private snapshot = { sessions: this.sessions, active: this.active };
  private started = false;

  getSnapshot = () => this.snapshot;
  private publish() { this.snapshot = { sessions: this.sessions, active: this.active }; this.emit(); }

  async init() {
    if (this.started) return;
    this.started = true;
    await listen<{ sessionId: string; data: string }>("pty://data", (e) => {
      this.sessions.find((s) => s.id === e.payload.sessionId)?.term.write(decoder(e.payload.data));
    });
    await listen<{ sessionId: string; code: number | null }>("pty://exit", (e) => {
      const s = this.sessions.find((x) => x.id === e.payload.sessionId);
      if (!s) return;
      s.alive = false;
      s.term.write(`\r\n\x1b[2m[session ended${e.payload.code !== null ? `, exit ${e.payload.code}` : ""}]\x1b[0m\r\n`);
      this.sessions = [...this.sessions];
      this.publish();
    });
  }

  open(opts: { deviceId: string; kind: SessionKind; command?: string; cwd?: string; title: string; typeAfter?: string }) {
    const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const term = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace',
      fontSize: 12.5,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: {
        background: "#07090b", foreground: "#dfe7ec", cursor: "#ffb020", selectionBackground: "#ffb02040",
        black: "#0b0f12", brightBlack: "#5a6a74", red: "#ff5d5d", green: "#3ddc97", yellow: "#ffb020",
        blue: "#6ab7ff", magenta: "#c792ea", cyan: "#5cc8ff", white: "#dfe7ec",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const host = document.createElement("div");
    host.className = "xterm-host";
    term.open(host);
    term.onData((data) => invoke("pty_write", { sessionId: id, data }).catch(() => {}));
    term.onResize(({ cols, rows }) => invoke("pty_resize", { sessionId: id, cols, rows }).catch(() => {}));
    const s: Session = { id, deviceId: opts.deviceId, kind: opts.kind, title: opts.title, alive: true, term, fit, host };
    this.sessions = [...this.sessions, s];
    this.active = id;
    this.publish();
    invoke("pty_open", {
      sessionId: id, deviceId: opts.deviceId, command: opts.command ?? null, cwd: opts.cwd ?? null,
      cols: term.cols || 100, rows: term.rows || 30,
    }).catch((err) => term.write(`\x1b[31mcould not start: ${err}\x1b[0m\r\n`));
    if (opts.typeAfter) {
      // Interactive CLIs need a moment to draw their prompt before input lands.
      setTimeout(() => invoke("pty_write", { sessionId: id, data: opts.typeAfter + "\r" }).catch(() => {}), 4500);
    }
    return id;
  }

  focus(id: string) { this.active = id; this.publish(); }

  close(id: string) {
    const s = this.sessions.find((x) => x.id === id);
    invoke("pty_close", { sessionId: id }).catch(() => {});
    s?.term.dispose();
    this.sessions = this.sessions.filter((x) => x.id !== id);
    if (this.active === id) this.active = this.sessions[this.sessions.length - 1]?.id ?? null;
    this.publish();
  }
}

export const sessions = new SessionStore();

// ---------------- YouTube ----------------

export interface YtItem { id: string; title: string; views: number | null; kind: "short" | "video"; posted_at: number | null }
export interface YtChannel {
  handle: string; name: string; url: string; subscribers: number | null; count: number; shorts: number;
  total_views: number; median_views: number; last7: { posted: number; views: number };
  items: YtItem[]; history: { ts: number; subscribers: number | null; total_views: number; count: number }[];
  error: string | null;
}

const CH_KEY = "harness.youtube.channels";
export function ytChannels(): string[] {
  try { return JSON.parse(localStorage.getItem(CH_KEY) ?? "") as string[]; } catch { return ["@bytsyz1"]; }
}
export function setYtChannels(list: string[]) {
  try { localStorage.setItem(CH_KEY, JSON.stringify(list)); } catch { /* private mode */ }
}

class YoutubeStore extends Emitter {
  data: { channels: YtChannel[]; generated: number } | null = null;
  error: string | null = null;
  loading = false;
  private snapshot = { data: this.data, error: this.error, loading: this.loading };
  getSnapshot = () => this.snapshot;
  private publish() { this.snapshot = { data: this.data, error: this.error, loading: this.loading }; this.emit(); }

  async refresh() {
    this.loading = true; this.publish();
    try {
      this.data = await invoke("youtube_stats", { channels: ytChannels() });
      this.error = null;
    } catch (e) { this.error = String(e); }
    this.loading = false; this.publish();
  }

  start() { this.refresh(); window.setInterval(() => this.refresh(), 30 * 60_000); }
}

export const youtube = new YoutubeStore();

// ---------------- vault ----------------

export interface VaultSettings { deviceId: string; root: string }

export const vault = {
  settings: () => invoke<VaultSettings>("vault_settings_get"),
  setSettings: (settings: VaultSettings) => invoke<void>("vault_settings_set", { settings }),
  read: (path: string) => invoke<{ exists: boolean; content: string }>("vault_op", { op: "read", path }),
  write: (path: string, content: string) => invoke("vault_op", { op: "write", path, content }),
  append: (path: string, content: string) => invoke("vault_op", { op: "append", path, content }),
  list: () => invoke<{ exists: boolean; notes: { path: string; mtime: number }[] }>("vault_op", { op: "list" }),
};

export interface Directive { line: number; text: string; done: boolean }

export function parseDirectives(md: string): Directive[] {
  return md.split("\n").flatMap((l, i) => {
    const m = l.match(/^\s*[-*] \[( |x|X)\] (.+)$/);
    return m ? [{ line: i, text: m[2].trim(), done: m[1] !== " " }] : [];
  });
}

export const DIRECTIVES_PATH = "Directives.md";
export const DIRECTIVES_TEMPLATE = `# Directives

What matters right now. Harness shows the open items on its home screen and
Hermes reads this note to know your priorities. Tick items off here or there.

- [ ] Rotate the leaked secrets (Telegram session, GitHub, Discord, MCP, RapidAPI)
- [ ] Refresh Reckon on the iPhone before 27 Sep
`;

// ---------------- Laya ----------------

export interface LayaChoice { choice: string; probabilities: Record<string, number> }

export const laya = {
  judge: (state: string, questions: Record<string, unknown>) =>
    invoke<{ answers: Record<string, LayaChoice & { score?: number; noul?: number }> }>("laya_judge", { state, questions }),

  /** Risk of one shell command: read_only / modifies / destructive. */
  async commandRisk(command: string, device: string) {
    const r = await laya.judge(`On ${device}: ${command}`, {
      risk: {
        type: "choice",
        instructions: "What does this shell command do to the machine?",
        criteria: {
          read_only: "only reads, lists or prints; changes nothing",
          modifies: "changes files, settings or services but can be undone",
          destructive: "deletes data, kills processes, publishes publicly or is hard to undo",
        },
      },
    });
    return r.answers.risk;
  },

  /** Where a request should go. */
  async route(request: string) {
    const r = await laya.judge(request, {
      route: {
        type: "choice",
        instructions: "Which assistant should handle this request?",
        criteria: {
          claude: "coding, files, debugging, building or changing software on a machine",
          hermes: "research, web browsing, job hunting, social media carousels, scheduled jobs",
          zara: "personal assistant chat, reminders, memory, the Shorts and LinkedIn pipelines on the Pi",
        },
      },
    });
    return r.answers.route;
  },
};

// ---------------- formatting ----------------

export function compact(n?: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
