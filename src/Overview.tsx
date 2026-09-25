import { useState } from "react";
import { hermesActions, piActions } from "./actions";
import { ago, Device, duration, Pipelines, Probe, statusStore, Status, when } from "./api";
import { Badge, Dot, Meter, OsGlyph, runAction, useStatus } from "./components";

/** `device` and `topic` let each home mode show only the alerts that concern it. */
export type Alert = { tone: "bad" | "warn"; text: string; device?: string; topic?: "machine" | "hermes" | "pipelines" };

export function alertsFor(devices: Device[], status: Record<string, Status>, p?: Pipelines): Alert[] {
  const out: Alert[] = [];
  for (const d of devices) {
    const s = status[d.id];
    if (!s) continue;
    if (s.error && !s.probe) out.push({ tone: "bad", text: `${d.name} is unreachable — ${s.error.slice(0, 90)}`, device: d.id, topic: "machine" });
    const pr = s.probe;
    if (!pr) continue;
    for (const k of pr.disks ?? []) {
      if (k.used_percent >= 90) out.push({ tone: k.used_percent >= 95 ? "bad" : "warn", text: `${d.name} ${k.name} is ${k.used_percent}% full (${k.free_gb} GB free)`, device: d.id, topic: "machine" });
    }
    if (pr.failed_units) out.push({ tone: "warn", text: `${d.name}: ${pr.failed_units} failed service(s) — ${(pr.failed_names ?? []).join(", ")}`, device: d.id, topic: "machine" });
    if (pr.wifi && pr.wifi.state !== "connected") out.push({ tone: "bad", text: `${d.name} Wi-Fi is ${pr.wifi.state}`, device: d.id, topic: "machine" });
    if (pr.hermes && !pr.hermes.running) out.push({ tone: "bad", text: "Hermes' gateway is not running on channa", device: d.id, topic: "hermes" });
    for (const j of pr.hermes?.jobs ?? []) {
      if (j.enabled && j.last_status && j.last_status !== "ok") out.push({ tone: "warn", text: `Hermes job “${j.name}” last ${j.last_status}${j.last_error ? ": " + j.last_error.slice(0, 80) : ""}`, device: d.id, topic: "hermes" });
    }
  }
  if (p) {
    const down = p.services.filter((s) => s.state !== "active");
    if (down.length) out.push({ tone: "bad", text: `Pi services not running: ${down.map((s) => s.name).join(", ")}`, device: "pi", topic: "pipelines" });
    if ((p.factory.counts.blocked ?? 0) > 0) out.push({ tone: "warn", text: `${p.factory.counts.blocked} Short(s) blocked in the factory`, device: "pi", topic: "pipelines" });
    if (p.queue.length > 0 && !p.queue.some((q) => q.fact_checked)) out.push({ tone: "warn", text: "No queued Short has passed the fact-check — the next slot will post nothing", device: "pi", topic: "pipelines" });
    if (p.queue.length === 0) out.push({ tone: "warn", text: "The Shorts queue is empty", device: "pi", topic: "pipelines" });
    if (p.posting.last_instagram?.status === "failed") out.push({ tone: "warn", text: `Last Instagram cross-post failed: ${p.posting.last_instagram.error ?? ""}`.slice(0, 120), device: "pi", topic: "pipelines" });
  }
  return out;
}

function DeviceCard({ device, status, onTerminal }: { device: Device; status?: Status; onTerminal: (id: string) => void }) {
  const pr: Probe | undefined = status?.probe;
  const reachable = !!pr && !(status?.error && !pr);
  const worstDisk = Math.max(0, ...(pr?.disks ?? []).map((d) => d.used_percent));
  const dotState = !status || status.loading && !pr ? "idle" : !reachable ? "bad" : worstDisk >= 95 || pr?.hermes?.running === false ? "bad" : worstDisk >= 90 || pr?.failed_units ? "warn" : "ok";
  const memUsed = pr?.mem_total_mb && pr.mem_avail_mb !== undefined ? pr.mem_total_mb - pr.mem_avail_mb : 0;
  // Windows reports a real CPU %. Unix only has load average, which can exceed
  // the core count, so show it as load against cores (bar capped at 100%).
  const load = pr?.load && pr?.cpus ? { value: pr.load[0], cores: pr.cpus } : undefined;

  return (
    <section className="card device">
      <header className="device-head">
        <OsGlyph kind={device.kind} />
        <div className="device-title">
          <div className="device-name">
            {device.name}
            {device.isLocal && <Badge tone="accent">this machine</Badge>}
          </div>
          <div className="device-role">{device.role}</div>
        </div>
        <Dot state={dotState} />
      </header>

      {!pr && status?.error && <div className="device-error">{status.error}</div>}
      {!pr && !status?.error && <div className="device-pending">Checking…</div>}

      {pr && (
        <>
          <div className="device-sub">
            <span>{pr.os_pretty ?? pr.os}</span>
            <span>up {duration(pr.uptime_s)}</span>
            {pr.temp_c !== undefined && <span className={pr.temp_c > 75 ? "tone-bad" : ""}>{pr.temp_c}°C</span>}
            {pr.battery && <span>🔋 {pr.battery.percent}% {pr.battery.state}</span>}
          </div>
          {pr.cpu_percent !== undefined ? (
            <Meter label="CPU" value={pr.cpu_percent} max={100} warnAt={0.75} badAt={0.95} detail={`${pr.cpu_percent}%`} />
          ) : load ? (
            <Meter label="Load" value={load.value} max={load.cores} warnAt={0.8} badAt={1.2} detail={`${load.value.toFixed(2)} · ${load.cores} cores`} />
          ) : null}
          {pr.mem_total_mb ? (
            <Meter label="Memory" value={memUsed} max={pr.mem_total_mb} warnAt={0.85} badAt={0.95}
              detail={`${(memUsed / 1024).toFixed(1)} / ${(pr.mem_total_mb / 1024).toFixed(0)} GB`} />
          ) : null}
          {(pr.disks ?? []).map((d) => (
            <Meter key={d.name} label={`Disk ${d.name}`} value={d.used_percent} max={100} warnAt={0.9} badAt={0.95}
              detail={`${d.used_percent}% · ${d.free_gb} GB free`} />
          ))}
          <div className="device-facts">
            {pr.wifi && <span>Wi-Fi {pr.wifi.state}{pr.wifi.signal !== undefined ? ` · ${pr.wifi.signal}%` : ""}</span>}
            {pr.hermes && (
              <span className={pr.hermes.running ? "" : "tone-bad"}>
                Hermes {pr.hermes.running ? `running since ${when(pr.hermes.since)}` : "not running"}
              </span>
            )}
            {pr.failed_units ? <span className="tone-warn">{pr.failed_units} failed unit(s)</span> : null}
          </div>
        </>
      )}

      <footer className="device-foot">
        <span className="muted">{status?.loading ? "refreshing…" : `checked ${ago(status?.at)}`}</span>
        <span className="spacer" />
        <button className="btn btn-xs" onClick={() => statusStore.refresh(device.id)}>Refresh</button>
        <button className="btn btn-xs" onClick={() => onTerminal(device.id)}>Terminal</button>
      </footer>
    </section>
  );
}

function ShortsPanel({ p, devices }: { p: Pipelines; devices: Device[] }) {
  const [holdFor, setHoldFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const act = (a: ReturnType<typeof piActions.postYouTube>) =>
    runAction(a, devices).then(() => statusStore.refreshPipelines());

  return (
    <section className="card panel">
      <header className="panel-head">
        <h2>Shorts</h2>
        <span className="muted">
          today: {p.posting.youtube_today ?? "?"} on YouTube · {p.posting.instagram_today ?? "?"} on Instagram
        </span>
      </header>

      <div className="btn-row">
        <button className="btn btn-danger" onClick={() => act(piActions.postYouTube())}>Post next to YouTube</button>
        <button className="btn btn-danger" onClick={() => act(piActions.crosspostInstagram())}>Cross-post to Instagram</button>
        <button className="btn" onClick={() => act(piActions.previewNext())}>Show next Short</button>
        <button className="btn" onClick={() => act(piActions.runFactory())}>Make a new Short</button>
      </div>

      <div className="split">
        <div>
          <h3>Queue <Badge>{p.queue.length}</Badge></h3>
          {p.queue.length === 0 && <div className="muted small">Empty.</div>}
          <ul className="list">
            {p.queue.map((q, i) => (
              <li key={q.job_id} className="list-row list-row-stack">
                <span className="clip row-title" title={q.title}>{q.title || q.job_id.slice(0, 8)}</span>
                <span className="row-line">
                  {i === 0 && <Badge tone="accent">next</Badge>}
                  {q.fact_checked ? <Badge tone="ok">checked</Badge> : <Badge tone="warn">unchecked</Badge>}
                  <span className="row-actions">
                    <button className="btn btn-xs" onClick={() => { setHoldFor(q.job_id); setReason(""); }}>Hold</button>
                    {!q.fact_checked && <button className="btn btn-xs" onClick={() => act(piActions.vouch(q.job_id))}>Vouch</button>}
                  </span>
                </span>
                {holdFor === q.job_id && (
                  <form className="inline-form" onSubmit={(e) => { e.preventDefault(); setHoldFor(null); act(piActions.hold(q.job_id, reason)); }}>
                    <input autoFocus placeholder="Why hold it?" value={reason} onChange={(e) => setReason(e.target.value)} />
                    <button className="btn btn-xs btn-primary" type="submit">Hold</button>
                    <button className="btn btn-xs" type="button" onClick={() => setHoldFor(null)}>Cancel</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Held <Badge>{p.held.length}</Badge></h3>
          <ul className="list">
            {p.held.map((h) => (
              <li key={h.job_id} className="list-row list-row-stack">
                <span className="clip row-title" title={h.title}>{h.title || h.job_id.slice(0, 8)}</span>
                <span className="small muted reason">{h.reason || "no reason recorded"}</span>
                <span className="row-actions">
                  <button className="btn btn-xs" onClick={() => act(piActions.release(h.job_id))}>Release</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="split">
        <div>
          <h3>Factory</h3>
          <div className="chips">
            {Object.entries(p.factory.counts).map(([k, v]) => (
              <Badge key={k} tone={k === "blocked" ? "bad" : k === "needs_edit" ? "warn" : k === "ready" ? "ok" : "neutral"}>{k} {v}</Badge>
            ))}
          </div>
          <ul className="list small">
            {p.factory.recent.slice(0, 5).map((r) => (
              <li key={r.job_id} className="list-row">
                <code>{r.id}</code>
                <Badge tone={r.status === "blocked" ? "bad" : r.status === "needs_edit" ? "warn" : "neutral"}>{r.status}</Badge>
                <span className="clip muted" title={r.error}>{r.error}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Last posts</h3>
          <div className="kv"><span>YouTube</span><span>{p.posting.last_youtube?.status ?? "—"} · {ago((p.posting.last_youtube?.at ?? 0) * 1000)}</span></div>
          <div className="kv"><span>Instagram</span><span className={p.posting.last_instagram?.status === "failed" ? "tone-bad" : ""}>{p.posting.last_instagram?.status ?? "—"} · {ago((p.posting.last_instagram?.at ?? 0) * 1000)}</span></div>
          {p.posting.last_instagram?.error && <div className="small muted">{p.posting.last_instagram.error}</div>}
        </div>
      </div>
    </section>
  );
}

function LinkedInPanel({ p, devices }: { p: Pipelines; devices: Device[] }) {
  return (
    <section className="card panel">
      <header className="panel-head">
        <h2>LinkedIn</h2>
        <button className="btn btn-xs" onClick={() => runAction(piActions.linkedinDraft(), devices).then(() => statusStore.refreshPipelines())}>Draft now</button>
      </header>
      <ul className="list small">
        {p.linkedin.recent.map((r) => (
          <li key={r.id} className="list-row">
            <code>{r.id}</code>
            <Badge tone={r.status === "ready" ? "ok" : r.status === "blocked" ? "bad" : "warn"}>{r.status}</Badge>
            <span className="muted">{ago(r.created * 1000)}</span>
            {r.error && <span className="clip muted" title={r.error}>{r.error}</span>}
          </li>
        ))}
      </ul>
      {(p.linkedin.pending_approvals?.length ?? 0) > 0 && (
        <div className="small">Waiting for your tap in Telegram: {p.linkedin.pending_approvals!.join(", ")}</div>
      )}
      {p.linkedin.last_telegram && <div className="small muted">{p.linkedin.last_telegram}</div>}
    </section>
  );
}

function ServicesPanel({ p, devices }: { p: Pipelines; devices: Device[] }) {
  return (
    <section className="card panel">
      <header className="panel-head"><h2>Pi services</h2><span className="muted small">{p.services.filter((s) => s.state === "active").length}/{p.services.length} running</span></header>
      <ul className="services">
        {p.services.map((s) => (
          <li key={s.name}>
            <Dot state={s.state === "active" ? "ok" : "bad"} />
            <span className="svc-name" title={`${s.name} (${s.scope} service) — ${s.state}`}>{s.name}</span>
            {s.restartable && (
              <button className="icon-btn" title={`Restart ${s.name}`} aria-label={`Restart ${s.name}`}
                onClick={() => runAction(piActions.restart(s.name, s.scope), devices).then(() => statusStore.refreshPipelines())}>↻</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HermesPanel({ probe, devices }: { probe?: Probe; devices: Device[] }) {
  const jobs = (probe?.hermes?.jobs ?? []).filter((j) => j.enabled).sort((a, b) => (a.next_run_at ?? "").localeCompare(b.next_run_at ?? ""));
  if (!probe?.hermes) return null;
  return (
    <section className="card panel">
      <header className="panel-head">
        <h2>Hermes</h2>
        <span className={probe.hermes.running ? "muted small" : "tone-bad small"}>{probe.hermes.running ? `gateway up since ${when(probe.hermes.since)}` : "gateway down"}</span>
      </header>
      <table className="table">
        <thead><tr><th>Job</th><th>Schedule</th><th>Last</th><th>Next</th><th /></tr></thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td>{j.name}</td>
              <td className="muted">{j.schedule}</td>
              <td>
                <Badge tone={j.last_status === "ok" ? "ok" : j.last_status ? "bad" : "neutral"}>{j.last_status ?? "never"}</Badge>{" "}
                <span className="muted small">{when(j.last_run_at)}</span>
                {j.last_error && <div className="small tone-bad clip" title={j.last_error}>{j.last_error}</div>}
              </td>
              <td className="muted">{when(j.next_run_at)}</td>
              <td><button className="btn btn-xs" onClick={() => runAction(hermesActions.runJob(j.id, j.name), devices).then(() => statusStore.refresh("channa"))}>Run now</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function Overview({ onTerminal }: { onTerminal: (id: string) => void }) {
  const { devices, status, pipelines } = useStatus();
  const alerts = alertsFor(devices, status, pipelines.data);
  const channa = devices.find((d) => d.kind === "windows");

  return (
    <div className="view">
      <div className="view-head">
        <h1>Machines</h1>
        <span className="muted small">{pipelines.loading ? "refreshing pipelines…" : pipelines.at ? `pipelines ${ago(pipelines.at)}` : ""}</span>
        <span className="spacer" />
        <button className="btn" onClick={() => statusStore.refreshAll()}>Refresh all</button>
      </div>

      {alerts.length > 0 && (
        <div className="alerts">
          {alerts.map((a, i) => <div key={i} className={`alert alert-${a.tone}`}>{a.text}</div>)}
        </div>
      )}

      <div className="grid-devices">
        {devices.map((d) => <DeviceCard key={d.id} device={d} status={status[d.id]} onTerminal={onTerminal} />)}
      </div>

      {pipelines.error && !pipelines.data && <div className="alert alert-bad">Pi pipelines: {pipelines.error}</div>}
      {pipelines.data && (
        <div className="grid-panels">
          <ShortsPanel p={pipelines.data} devices={devices} />
          <div className="stack">
            <LinkedInPanel p={pipelines.data} devices={devices} />
            <ServicesPanel p={pipelines.data} devices={devices} />
          </div>
        </div>
      )}
      {channa && <HermesPanel probe={status[channa.id]?.probe} devices={devices} />}
    </div>
  );
}
