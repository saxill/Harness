import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ---------- types ----------

export type DeviceKind = "macos" | "linux" | "windows";

export interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  host: string;
  role: string;
  pipelines: boolean;
  isLocal: boolean;
}

export interface Disk {
  name: string;
  total_gb: number;
  free_gb: number;
  used_percent: number;
}

export interface HermesJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  last_status: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  last_error: string | null;
  failure_streak: number | null;
}

export interface Probe {
  hostname?: string;
  os?: string;
  os_pretty?: string;
  arch?: string;
  uptime_s?: number;
  load?: number[];
  cpus?: number;
  cpu_percent?: number;
  mem_total_mb?: number;
  mem_avail_mb?: number;
  temp_c?: number;
  disks?: Disk[];
  battery?: { percent: number; state: string };
  wifi?: { state: string; ssid?: string; signal?: number };
  hermes?: { running: boolean; since: string | null; jobs: HermesJob[] };
  failed_units?: number;
  failed_names?: string[];
}

export interface Status {
  probe?: Probe;
  error?: string;
  at?: number;
  loading: boolean;
}

export interface Pipelines {
  generated: string;
  services: { name: string; scope: string; state: string; restartable: boolean }[];
  factory: { counts: Record<string, number>; recent: { id: string; job_id: string; status: string; error: string; updated: number }[] };
  queue: { job_id: string; title: string; fact_checked: boolean; created?: number }[];
  held: { job_id: string; title: string; reason: string }[];
  posting: {
    youtube_today: number | null;
    instagram_today: number | null;
    last_youtube?: { status?: string; at?: number; job_id?: string };
    last_instagram?: { status?: string; at?: number; error?: string };
  };
  linkedin: {
    recent: { id: string; status: string; error: string | null; created: number }[];
    pending_approvals?: string[];
    last_telegram?: string | null;
  };
}

export interface HistoryRow {
  ts: number;
  runId: string;
  deviceId: string;
  deviceName: string;
  command: string;
  source: string;
  code: number | null;
  cancelled: boolean;
  durationMs: number;
}

export interface AgentSettings {
  baseUrl: string;
  model: string;
}

// ---------- backend calls ----------

export const api = {
  devices: () => invoke<Device[]>("devices_list"),
  saveDevices: (devices: Device[]) => invoke<void>("devices_save", { devices }),
  probe: (deviceId: string) => invoke<Probe>("probe_device", { deviceId }),
  pipelines: (deviceId: string) => invoke<Pipelines>("probe_pipelines", { deviceId }),
  history: (limit = 300) => invoke<HistoryRow[]>("history_list", { limit }),
  agentSettings: () => invoke<AgentSettings>("agent_settings_get"),
  saveAgentSettings: (settings: AgentSettings) => invoke<void>("agent_settings_set", { settings }),
  setKey: (key: string) => invoke<string>("agent_key_set", { key }),
  hasKey: () => invoke<boolean>("agent_key_status"),
  complete: (messages: unknown[], tools: unknown[]) =>
    invoke<Record<string, unknown>>("agent_complete", { messages, tools }),
};

// ---------- tiny store helper ----------

type Listener = () => void;

export class Emitter {
  private listeners = new Set<Listener>();
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  protected emit() {
    this.listeners.forEach((l) => l());
  }
}

// ---------- runs: every command, from any source, streams through here ----------

export type RunSource = "user" | "agent" | "action";

export interface RunLine {
  stream: "stdout" | "stderr";
  line: string;
}

export interface Run {
  id: string;
  deviceId: string;
  command: string;
  label?: string;
  source: RunSource;
  lines: RunLine[];
  running: boolean;
  code?: number | null;
  cancelled?: boolean;
  startedAt: number;
  durationMs?: number;
  error?: string;
}

const MAX_LINES = 4000;

class RunStore extends Emitter {
  runs: Run[] = [];
  private waiters = new Map<string, (r: Run) => void>();
  private started = false;

  async init() {
    if (this.started) return;
    this.started = true;
    await listen<{ runId: string; stream: "stdout" | "stderr"; line: string }>("run://output", (e) => {
      this.update(e.payload.runId, (r) => {
        const lines = r.lines.length >= MAX_LINES ? r.lines.slice(-MAX_LINES + 1) : r.lines.slice();
        lines.push({ stream: e.payload.stream, line: e.payload.line });
        return { ...r, lines };
      });
    });
    await listen<{ runId: string; code: number | null; cancelled: boolean; durationMs: number }>("run://exit", (e) => {
      const r = this.update(e.payload.runId, (r) => ({
        ...r,
        running: false,
        code: e.payload.code,
        cancelled: e.payload.cancelled,
        durationMs: e.payload.durationMs,
      }));
      if (r) this.settle(r);
    });
  }

  private update(id: string, f: (r: Run) => Run): Run | undefined {
    let out: Run | undefined;
    this.runs = this.runs.map((r) => (r.id === id ? (out = f(r)) : r));
    this.emit();
    return out;
  }

  private settle(r: Run) {
    const w = this.waiters.get(r.id);
    if (w) {
      this.waiters.delete(r.id);
      w(r);
    }
  }

  getSnapshot = () => this.runs;

  /** Starts a command and resolves once it has exited. */
  start(deviceId: string, command: string, source: RunSource, label?: string): Promise<Run> {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const run: Run = { id, deviceId, command, label, source, lines: [], running: true, startedAt: Date.now() };
    this.runs = [run, ...this.runs].slice(0, 200);
    this.emit();
    return new Promise<Run>((resolve) => {
      this.waiters.set(id, resolve);
      invoke("run_start", { runId: id, deviceId, command, source }).catch((err) => {
        const failed = this.update(id, (r) => ({ ...r, running: false, code: null, error: String(err) }));
        if (failed) this.settle(failed);
      });
    });
  }

  cancel(id: string) {
    return invoke<boolean>("run_cancel", { runId: id });
  }

  clearFinished() {
    this.runs = this.runs.filter((r) => r.running);
    this.emit();
  }
}

export const runs = new RunStore();

export function runOutput(r: Run, limit = 6000): string {
  const text = r.lines.map((l) => (l.stream === "stderr" ? `[stderr] ${l.line}` : l.line)).join("\n");
  return text.length > limit ? "…" + text.slice(-limit) : text;
}

// ---------- device status: polled, shared by every view ----------

class StatusStore extends Emitter {
  devices: Device[] = [];
  status: Record<string, Status> = {};
  pipelines: { data?: Pipelines; error?: string; at?: number; loading: boolean } = { loading: false };
  private snapshot = { devices: this.devices, status: this.status, pipelines: this.pipelines };
  private timers: number[] = [];
  private lastAll = 0;

  getSnapshot = () => this.snapshot;

  private publish() {
    this.snapshot = { devices: this.devices, status: this.status, pipelines: this.pipelines };
    this.emit();
  }

  async init() {
    this.devices = await api.devices();
    this.publish();
    this.refreshAll();
    // Every 30 s while you're using the window, every 2 min while it's in the
    // background, every 5 min while it's hidden, so a Harness left open doesn't
    // SSH into every machine twice a minute for nobody. Coming back refreshes.
    this.timers.push(window.setInterval(() => {
      const every = document.hidden ? 5 * 60_000 : document.hasFocus() ? 30_000 : 2 * 60_000;
      if (Date.now() - this.lastAll >= every - 1_000) this.refreshAll();
    }, 30_000));
    const back = () => {
      if (!document.hidden && Date.now() - this.lastAll >= 30_000) this.refreshAll();
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
  }

  async reloadDevices() {
    this.devices = await api.devices();
    this.publish();
    this.refreshAll();
  }

  refreshAll() {
    this.lastAll = Date.now();
    this.devices.forEach((d) => this.refresh(d.id));
    if (this.devices.some((d) => d.pipelines)) this.refreshPipelines();
  }

  async refresh(id: string) {
    this.status = { ...this.status, [id]: { ...this.status[id], loading: true } };
    this.publish();
    try {
      const probe = await api.probe(id);
      this.status = { ...this.status, [id]: { probe, at: Date.now(), loading: false } };
    } catch (e) {
      this.status = { ...this.status, [id]: { ...this.status[id], error: String(e), at: Date.now(), loading: false } };
    }
    this.publish();
  }

  async refreshPipelines() {
    const dev = this.devices.find((d) => d.pipelines);
    if (!dev) return;
    this.pipelines = { ...this.pipelines, loading: true };
    this.publish();
    try {
      const data = await api.pipelines(dev.id);
      this.pipelines = { data, at: Date.now(), loading: false };
    } catch (e) {
      this.pipelines = { ...this.pipelines, error: String(e), at: Date.now(), loading: false };
    }
    this.publish();
  }
}

export const statusStore = new StatusStore();

// ---------- formatting ----------

export function ago(ms?: number): string {
  if (!ms) return "—";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function duration(s?: number): string {
  if (s === undefined) return "—";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export function when(iso?: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso);
  if (isNaN(t.getTime())) return iso;
  const today = new Date();
  const sameDay = t.toDateString() === today.toDateString();
  const time = t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay ? time : `${t.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}
