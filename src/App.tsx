import { useState } from "react";
import AgentView from "./AgentView";
import HistoryView from "./HistoryView";
import Overview from "./Overview";
import RunView from "./RunView";
import SettingsView from "./SettingsView";
import { ConfirmHost, Dot, OsGlyph, RunPanel, useRuns, useStatus } from "./components";

type Tab = "overview" | "terminal" | "agent" | "history" | "settings";

const TABS: { id: Tab; label: string; key: string }[] = [
  { id: "overview", label: "Overview", key: "1" },
  { id: "terminal", label: "Terminal", key: "2" },
  { id: "agent", label: "Agent", key: "3" },
  { id: "history", label: "History", key: "4" },
  { id: "settings", label: "Settings", key: "5" },
];

/** Output of dashboard buttons, pinned bottom-right on every tab. */
function ActivityDock() {
  const all = useRuns();
  const { devices } = useStatus();
  const [hidden, setHidden] = useState<string[]>([]);
  const shown = all.filter((r) => r.source === "action" && !hidden.includes(r.id)).slice(0, 3);
  if (shown.length === 0) return null;
  return (
    <div className="dock">
      {shown.map((r) => (
        <div key={r.id} className="dock-item">
          <button className="dock-close" onClick={() => setHidden((h) => [...h, r.id])} aria-label="Dismiss">×</button>
          <RunPanel run={r} device={devices.find((d) => d.id === r.deviceId)} compact={!r.running} />
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("overview");
  const [terminalFor, setTerminalFor] = useState<string | undefined>();
  const { devices, status } = useStatus();
  const running = useRuns().filter((r) => r.running).length;

  const openTerminal = (id: string) => { setTerminalFor(id); setTab("terminal"); };

  return (
    <div className="shell"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
          const t = TABS.find((t) => t.key === e.key);
          if (t) { e.preventDefault(); setTab(t.id); }
        }
      }}>
      <aside className="sidebar">
        <div className="brand">Harness<span>.</span></div>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={`nav ${tab === t.id ? "nav-on" : ""}`} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === "terminal" && running > 0 && <span className="pill">{running}</span>}
              <span className="kbd">⌘{t.key}</span>
            </button>
          ))}
        </nav>
        <div className="side-devices">
          <div className="side-label">Machines</div>
          {devices.map((d) => {
            const s = status[d.id];
            const worst = Math.max(0, ...(s?.probe?.disks ?? []).map((k) => k.used_percent));
            const state = !s || (s.loading && !s.probe) ? "idle" : s.error && !s.probe ? "bad" : worst >= 95 ? "bad" : worst >= 90 ? "warn" : "ok";
            return (
              <button key={d.id} className="side-device" onClick={() => openTerminal(d.id)} title={`${d.host} — open terminal`}>
                <Dot state={state} />
                <OsGlyph kind={d.kind} />
                <span className="clip">{d.name}</span>
                {d.isLocal && <span className="muted small">here</span>}
              </button>
            );
          })}
        </div>
      </aside>

      <main className="main">
        {tab === "overview" && <Overview onTerminal={openTerminal} />}
        {tab === "terminal" && <RunView preselect={terminalFor} />}
        {tab === "agent" && <AgentView onSettings={() => setTab("settings")} />}
        {tab === "history" && <HistoryView />}
        {tab === "settings" && <SettingsView />}
      </main>

      <ActivityDock />
      <ConfirmHost />
    </div>
  );
}
