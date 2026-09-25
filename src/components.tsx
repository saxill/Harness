import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Action } from "./actions";
import { Device, Run, runs, statusStore } from "./api";
import { vault } from "./hub";

// ---------- hooks ----------

export const useStatus = () => useSyncExternalStore(statusStore.subscribe, statusStore.getSnapshot);
export const useRuns = () => useSyncExternalStore(runs.subscribe, runs.getSnapshot);

// ---------- small pieces ----------

/** Plain shapes rather than logo glyphs or emoji, which render inconsistently. */
export function OsGlyph({ kind }: { kind: string }) {
  const icon =
    kind === "windows" ? (
      <svg viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6.5" height="6.5" rx="1" /><rect x="8.5" y="1" width="6.5" height="6.5" rx="1" /><rect x="1" y="8.5" width="6.5" height="6.5" rx="1" /><rect x="8.5" y="8.5" width="6.5" height="6.5" rx="1" /></svg>
    ) : kind === "macos" ? (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2.5" y="3" width="11" height="7.5" rx="1.2" /><path d="M1 13h14" strokeLinecap="round" /></svg>
    ) : (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" /><path d="M4.5 6.5 6.5 8l-2 1.5M8 10h3" /></svg>
    );
  return <span className={`os os-${kind}`} aria-label={kind}>{icon}</span>;
}

export function Dot({ state }: { state: "ok" | "warn" | "bad" | "idle" }) {
  return <span className={`dot dot-${state}`} />;
}

export function Meter({ label, value, max, unit, warnAt = 0.8, badAt = 0.92, detail }: {
  label: string;
  value: number;
  max: number;
  unit?: string;
  warnAt?: number;
  badAt?: number;
  detail?: string;
}) {
  const frac = max > 0 ? Math.min(1, value / max) : 0;
  const tone = frac >= badAt ? "bad" : frac >= warnAt ? "warn" : "ok";
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <span className={`meter-val tone-${tone}`}>
          {detail ?? `${Math.round(frac * 100)}%`}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <div className="meter-track">
        <div className={`meter-fill fill-${tone}`} style={{ width: `${frac * 100}%` }} />
      </div>
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: string; children: React.ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

// ---------- run output ----------

export function RunPanel({ run, device, compact = false }: { run: Run; device?: Device; compact?: boolean }) {
  const body = useRef<HTMLPreElement>(null);
  const [open, setOpen] = useState(!compact || run.running);
  useEffect(() => {
    const el = body.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [run.lines.length]);

  const state = run.running
    ? { text: "running", tone: "live" }
    : run.error
      ? { text: "couldn't start", tone: "bad" }
      : run.cancelled
        ? { text: "cancelled", tone: "neutral" }
        : run.code === 0
          ? { text: "exit 0", tone: "ok" }
          : { text: `exit ${run.code ?? "?"}`, tone: "bad" };

  return (
    <div className={`run ${run.running ? "run-live" : ""}`}>
      <div className="run-head" onClick={() => setOpen((o) => !o)}>
        <span className="run-device">{device?.name ?? run.deviceId}</span>
        {run.source !== "user" && <Badge tone="dim">{run.source}</Badge>}
        <code className="run-cmd" title={run.command}>{run.label ?? run.command}</code>
        <span className="run-meta">
          {run.durationMs !== undefined && <span>{(run.durationMs / 1000).toFixed(1)}s</span>}
          <Badge tone={state.tone}>{state.text}</Badge>
          {run.running && (
            <button className="btn btn-xs" onClick={(e) => { e.stopPropagation(); runs.cancel(run.id); }}>
              Stop
            </button>
          )}
        </span>
      </div>
      {open && (
        <pre ref={body} className="run-body">
          {run.error && <span className="stderr">{run.error}{"\n"}</span>}
          {run.lines.length === 0 && run.running && <span className="muted">waiting for output…</span>}
          {run.lines.map((l, i) => (
            <span key={i} className={l.stream === "stderr" ? "stderr" : undefined}>{l.line}{"\n"}</span>
          ))}
          {!run.running && run.lines.length === 0 && !run.error && <span className="muted">(no output)</span>}
        </pre>
      )}
    </div>
  );
}

// ---------- confirm sheet (one global instance) ----------

interface Ask {
  action: Action;
  deviceName: string;
  resolve: (ok: boolean) => void;
}

let setAsk: ((a: Ask | null) => void) | null = null;

/** Shows the exact command and asks. Resolves true only on an explicit yes. */
export function confirmAction(action: Action, deviceName: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!setAsk) return resolve(false);
    setAsk({ action, deviceName, resolve });
  });
}

export function ConfirmHost() {
  const [ask, _setAsk] = useState<Ask | null>(null);
  useEffect(() => {
    setAsk = _setAsk;
    return () => { setAsk = null; };
  }, []);
  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (!ask) return null;
  const close = (ok: boolean) => { ask.resolve(ok); _setAsk(null); };
  const { action } = ask;
  return (
    <div className="scrim" onClick={() => close(false)}>
      <div className={`sheet sheet-${action.tone}`} onClick={(e) => e.stopPropagation()}>
        {action.tone === "publish" && <div className="sheet-flag">Publishes publicly</div>}
        <h3>{action.label}</h3>
        <p>{action.effect}</p>
        <div className="sheet-target">on <b>{ask.deviceName}</b></div>
        <pre className="sheet-cmd">{action.command}</pre>
        <div className="sheet-actions">
          <button className="btn" onClick={() => close(false)}>Cancel</button>
          <button className={`btn ${action.tone === "publish" ? "btn-danger" : "btn-primary"}`} autoFocus onClick={() => close(true)}>
            {action.tone === "publish" ? "Yes, publish" : "Run it"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Confirm, run, and hand back the finished run. */
export async function runAction(action: Action, devices: Device[]): Promise<Run | null> {
  const dev = devices.find((d) => d.id === action.deviceId);
  if (!dev) return null;
  if (!(await confirmAction(action, dev.name))) return null;
  const run = await runs.start(dev.id, action.command, "action", action.label);
  // Keep a plain-text trail in Obsidian: Harness/Log/<day>.md
  const t = new Date();
  const day = t.toISOString().slice(0, 10);
  const result = run.error ? "could not start" : run.cancelled ? "cancelled" : `exit ${run.code}`;
  vault.append(`Harness/Log/${day}.md`,
    `- ${t.toTimeString().slice(0, 5)} · ${action.label} on ${dev.name} → ${result}\n`).catch(() => {});
  return run;
}
