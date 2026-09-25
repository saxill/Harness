import { useEffect, useState } from "react";
import { api, HistoryRow, runs } from "./api";
import { Badge } from "./components";

export default function HistoryView() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [filter, setFilter] = useState("");
  const load = () => api.history(500).then(setRows);
  useEffect(() => { load(); }, []);

  const shown = rows.filter((r) =>
    !filter || `${r.deviceName} ${r.command} ${r.source}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="view">
      <div className="view-head">
        <h1>History</h1>
        <span className="muted small">Every command run from this app, on this machine</span>
        <span className="spacer" />
        <input className="search" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="btn" onClick={load}>Reload</button>
      </div>
      <div className="card">
        <table className="table">
          <thead><tr><th>When</th><th>Machine</th><th>By</th><th>Command</th><th>Result</th><th /></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.runId}>
                <td className="muted nowrap">{new Date(r.ts * 1000).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td className="nowrap">{r.deviceName}</td>
                <td><Badge tone={r.source === "agent" ? "accent" : r.source === "action" ? "dim" : "neutral"}>{r.source}</Badge></td>
                <td><code className="clip block" title={r.command}>{r.command}</code></td>
                <td className="nowrap">
                  {r.cancelled ? <Badge>cancelled</Badge> : <Badge tone={r.code === 0 ? "ok" : "bad"}>exit {r.code ?? "?"}</Badge>}{" "}
                  <span className="muted small">{(r.durationMs / 1000).toFixed(1)}s</span>
                </td>
                <td><button className="btn btn-xs" onClick={() => runs.start(r.deviceId, r.command, "user")}>Run again</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <div className="empty">Nothing yet.</div>}
      </div>
    </div>
  );
}
