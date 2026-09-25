// Side panels for the Claude Code, Hermes and Zara home modes. Auto keeps the
// general overview (Home.tsx); each of these shows only what that agent needs.
import { useEffect, useState } from "react";
import { api, Device, HermesJob, HistoryRow, Status, statusStore, when } from "./api";
import { piActions } from "./actions";
import { Dot, OsGlyph, runAction, useStatus } from "./components";
import { sessions, vault } from "./hub";
import { useSessions } from "./terminals";

const pct = (n?: number) => (n === undefined ? "–" : `${Math.round(n)}%`);

function machineState(s?: Status): "ok" | "warn" | "bad" | "idle" {
  if (!s || (s.loading && !s.probe)) return "idle";
  if (!s.probe) return "bad";
  const worst = Math.max(0, ...(s.probe.disks ?? []).map((d) => d.used_percent));
  return worst >= 95 ? "bad" : worst >= 90 || s.probe.failed_units ? "warn" : "ok";
}

// ---------------- Claude Code ----------------

export function ClaudeMachines({ target, onPick }: { target: string; onPick: (id: string) => void }) {
  const { devices, status } = useStatus();
  const { sessions: open } = useSessions();
  return (
    <div className="hud-col">
      <div className="hud-label">MACHINES <span>PICK ONE</span></div>
      {devices.map((d) => {
        const pr = status[d.id]?.probe;
        // Unix has load average (can exceed the core count), Windows a real CPU %
        const cpu = pr?.load && pr.cpus ? `LOAD ${(pr.load[0] / pr.cpus).toFixed(1)}×` : `CPU ${pct(pr?.cpu_percent)}`;
        const mem = pr?.mem_total_mb && pr.mem_avail_mb !== undefined ? ((pr.mem_total_mb - pr.mem_avail_mb) / pr.mem_total_mb) * 100 : undefined;
        const disk = Math.max(0, ...(pr?.disks ?? []).map((k) => k.used_percent));
        const n = open.filter((s) => s.kind === "claude" && s.deviceId === d.id && s.alive).length;
        return (
          <button key={d.id} className={`mrow ${target === d.id ? "mrow-on" : ""}`} onClick={() => onPick(d.id)}>
            <div className="mrow-top">
              <OsGlyph kind={d.kind} />
              <span className="mrow-name">{d.name}</span>
              {n > 0 && <span className="mrow-count">{n} open</span>}
              <Dot state={machineState(status[d.id])} />
            </div>
            <div className="mrow-stats">
              <span>{cpu}</span><span>MEM {pct(mem)}</span><span>DISK {pr ? `${disk}%` : "–"}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function ClaudeSide({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { sessions: open } = useSessions();
  const { devices } = useStatus();
  const [recent, setRecent] = useState<HistoryRow[]>([]);
  useEffect(() => { api.history(40).then((h) => setRecent(h.slice(0, 6))).catch(() => {}); }, []);
  const mine = open.filter((s) => s.kind === "claude");
  return (
    <div className="hud-col">
      <div className="hud-block">
        <div className="hud-label">SESSIONS <span>{mine.length} OPEN</span></div>
        {mine.length === 0 && <div className="hud-note">None open. Pick a machine and press Open.</div>}
        {mine.map((s) => (
          <button key={s.id} className="linkrow" onClick={() => { sessions.focus(s.id); onNavigate("claude"); }}>
            <span>{s.title}</span><span className={s.alive ? "live" : ""}>{s.alive ? "● live" : "ended"}</span>
          </button>
        ))}
      </div>
      <div className="hud-block">
        <div className="hud-label">RECENT COMMANDS</div>
        {recent.length === 0 && <div className="hud-note">Nothing run yet.</div>}
        {recent.map((r) => (
          <div key={r.runId} className="cmdrow" title={r.command}>
            <span className={r.code === 0 ? "ok" : r.cancelled ? "" : "bad"}>{r.code === 0 ? "✓" : r.cancelled ? "–" : "✕"}</span>
            <code>{r.command}</code>
            <span>{devices.find((d) => d.id === r.deviceId)?.name ?? r.deviceName}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Hermes ----------------

/** Times of day (hours, fractional) a job runs, from a cron expression or,
 * failing that, from its next run. Weekly jobs are flagged. */
export function jobTimes(j: HermesJob): { hours: number[]; weekly: boolean } {
  const parts = j.schedule.trim().split(/\s+/);
  const expand = (f: string, max: number) => {
    if (f === "*") return Array.from({ length: max }, (_, i) => i);
    const step = f.match(/^\*\/(\d+)$/);
    if (step) return Array.from({ length: max }, (_, i) => i).filter((i) => i % Number(step[1]) === 0);
    return f.split(",").flatMap((x) => {
      const r = x.match(/^(\d+)-(\d+)$/);
      return r ? Array.from({ length: Number(r[2]) - Number(r[1]) + 1 }, (_, i) => Number(r[1]) + i) : [Number(x)];
    }).filter((n) => Number.isFinite(n));
  };
  if (parts.length === 5 && /^[\d*,/-]+$/.test(parts[0]) && /^[\d*,/-]+$/.test(parts[1])) {
    const mins = expand(parts[0], 60), hrs = expand(parts[1], 24);
    return { hours: hrs.flatMap((h) => mins.map((m) => h + m / 60)).slice(0, 48), weekly: parts[4] !== "*" };
  }
  if (j.next_run_at) {
    const d = new Date(j.next_run_at);
    return { hours: [d.getHours() + d.getMinutes() / 60], weekly: /week|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(j.schedule) };
  }
  return { hours: [], weekly: false };
}


export function HermesJobs() {
  const { status } = useStatus();
  const jobs = (status["channa"]?.probe?.hermes?.jobs ?? []).filter((j) => j.enabled)
    .sort((a, b) => (a.next_run_at ?? "~").localeCompare(b.next_run_at ?? "~"));
  const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
  return (
    <div className="hud-col">
      <div className="hud-label">CRON <span>{jobs.length} JOBS</span></div>
      {!status["channa"]?.probe && <div className="hud-note">waiting for channa…</div>}
      {jobs.map((j) => {
        const bad = !!j.last_status && j.last_status !== "ok";
        const { hours, weekly } = jobTimes(j);
        return (
          <div key={j.id} className="jobrow" title={j.last_error ?? ""}>
            <div className="jobrow-top">
              <span className={`jobdot ${bad ? "bad" : ""} ${weekly ? "hollow" : ""}`} />
              <span className="jobrow-name">{j.name}</span>
              <span className="jobrow-next">{when(j.next_run_at)}</span>
            </div>
            <div className="jobrow-sub">
              {hours.slice(0, 4).map(hhmm).join(" · ")}{hours.length > 4 ? ` +${hours.length - 4}` : ""}{weekly ? " · weekly" : ""}
              {bad && <span className="bad"> · last {j.last_status}{j.failure_streak ? ` ×${j.failure_streak}` : ""}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function HermesSide({ onNavigate, children }: { onNavigate: (tab: string) => void; children?: React.ReactNode }) {
  const { status } = useStatus();
  const pr = status["channa"]?.probe;
  const c = pr?.disks?.find((d) => /^C/i.test(d.name));
  const [notes, setNotes] = useState<{ path: string; mtime: number }[] | null>(null);
  useEffect(() => {
    const load = () => vault.list()
      .then((r) => setNotes(r.notes.filter((n) => n.path.startsWith("Hermes/")).sort((a, b) => b.mtime - a.mtime)))
      .catch(() => setNotes([]));
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="hud-col">
      <div className="hud-block">
        <div className="hud-label">CHANNA</div>
        <div className="nextrow"><span>Gateway</span><span className={pr?.hermes?.running === false ? "bad" : ""}>{pr?.hermes ? (pr.hermes.running ? `up ${when(pr.hermes.since)}` : "down") : "…"}</span></div>
        <div className="nextrow"><span>Wi-Fi</span><span>{pr?.wifi ? `${pr.wifi.ssid ?? pr.wifi.state}${pr.wifi.signal ? ` · ${pr.wifi.signal}%` : ""}` : "…"}</span></div>
        <div className="nextrow"><span>C: drive</span><span className={c && c.used_percent >= 95 ? "bad" : ""}>{c ? `${c.used_percent}% · ${c.free_gb} GB free` : "…"}</span></div>
        <div className="nextrow"><span>CPU</span><span>{pct(pr?.cpu_percent)}</span></div>
      </div>
      <div className="hud-block">
        <div className="hud-label">REPORTS <span>OBSIDIAN</span></div>
        {notes === null && <div className="hud-note">reading the vault…</div>}
        {notes?.length === 0 && <div className="hud-note">None yet. His next report lands in Hermes/.</div>}
        {notes?.slice(0, 5).map((n) => (
          <button key={n.path} className="linkrow" onClick={() => onNavigate("hermes")}>
            <span>{n.path.slice(7).replace(/\.md$/, "")}</span><span>{when(new Date(n.mtime * 1000).toISOString())}</span>
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}

// ---------------- Zara ----------------

export function ZaraToday() {
  const { pipelines, status } = useStatus();
  const p = pipelines.data;
  const pi = status["pi"]?.probe;
  const sd = pi?.disks?.find((d) => d.name === "/" || d.name === "root") ?? pi?.disks?.[0];
  const rows: [string, string, string?][] = p ? [
    ["Shorts posted today", String(p.posting.youtube_today ?? "–")],
    ["Instagram today", String(p.posting.instagram_today ?? "–")],
    ["Queue", `${p.queue.length} · ${p.queue.filter((q) => q.fact_checked).length} checked`, p.queue.length && !p.queue.some((q) => q.fact_checked) ? "warn" : undefined],
    ["Held", String(p.held.length), p.held.length ? "warn" : undefined],
    ["Factory ready", String(p.factory.counts.ready ?? 0)],
    ["Needs edit", String(p.factory.counts.needs_edit ?? 0)],
    ["Blocked", String(p.factory.counts.blocked ?? 0), p.factory.counts.blocked ? "bad" : undefined],
    ["LinkedIn to approve", String(p.linkedin.pending_approvals?.length ?? 0), p.linkedin.pending_approvals?.length ? "warn" : undefined],
  ] : [];
  return (
    <div className="hud-col">
      <div className="hud-label">PIPELINES <span>TODAY</span></div>
      {!p && <div className="hud-note">{pipelines.error ? `Pi: ${pipelines.error.slice(0, 80)}` : "asking the Pi…"}</div>}
      {p && (
        <div className="vital">
          <div className="vital-head"><span>● RUNWAY</span><span>3 SLOTS A DAY</span></div>
          <div className="vital-num">{p.factory.counts.ready ?? 0}<small>ready · ≈{Math.floor((p.factory.counts.ready ?? 0) / 3)} days</small></div>
        </div>
      )}
      <div className="hud-block">
        {rows.map(([k, v, tone]) => <div key={k} className="nextrow"><span>{k}</span><span className={tone ?? ""}>{v}</span></div>)}
      </div>
      {pi && (
        <div className="hud-block">
          <div className="hud-label">THE PI</div>
          <div className="nextrow"><span>Temperature</span><span>{pi.temp_c ? `${pi.temp_c.toFixed(0)} °C` : "–"}</span></div>
          <div className="nextrow"><span>SD card</span><span className={sd && sd.used_percent >= 90 ? "warn" : ""}>{sd ? `${sd.used_percent}%` : "–"}</span></div>
          <div className="nextrow"><span>Load</span><span>{pi.load ? pi.load[0].toFixed(2) : "–"}</span></div>
        </div>
      )}
    </div>
  );
}

export function ZaraSide({ devices }: { devices: Device[] }) {
  const { pipelines } = useStatus();
  const p = pipelines.data;
  const down = (p?.services ?? []).filter((s) => s.state !== "active");
  const acts = [
    { label: "Post next\nShort", a: piActions.postYouTube },
    { label: "Cross-post\nInstagram", a: piActions.crosspostInstagram },
    { label: "Draft\nLinkedIn", a: piActions.linkedinDraft },
    { label: "Show next\nShort", a: piActions.previewNext },
  ];
  return (
    <div className="hud-col">
      <div className="hud-block">
        <div className="hud-label">ACTIONS <span>CONFIRMED FIRST</span></div>
        <div className="qa-grid">
          {acts.map((x) => (
            <button key={x.label} className="qa" onClick={() => runAction(x.a(), devices).then(() => statusStore.refreshPipelines())}>
              <span>{x.label}</span><span className="arrow">→</span>
            </button>
          ))}
        </div>
      </div>
      <div className="hud-block">
        <div className="hud-label">UP NEXT <span>QUEUE</span></div>
        {p?.queue.length === 0 && <div className="hud-note">Queue is empty.</div>}
        {p?.queue.slice(0, 4).map((q) => (
          <div key={q.job_id} className="nextrow" title={q.title}>
            <span>{q.title || q.job_id.slice(0, 8)}</span><span className={q.fact_checked ? "ok" : ""}>{q.fact_checked ? "checked" : "unchecked"}</span>
          </div>
        ))}
      </div>
      <div className="hud-block">
        <div className="hud-label">SERVICES <span>{p ? `${p.services.length - down.length}/${p.services.length} UP` : "…"}</span></div>
        {p && down.length === 0 && <div className="hud-note">All running.</div>}
        {down.map((s) => <div key={s.name} className="nextrow"><span>{s.name}</span><span className="bad">{s.state}</span></div>)}
      </div>
    </div>
  );
}

