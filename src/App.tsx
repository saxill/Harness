import { useState } from "react";
import { ClaudeView, HermesView, ZaraView } from "./AgentPages";
import AgentView from "./AgentView";
import HistoryView from "./HistoryView";
import Home from "./Home";
import Overview from "./Overview";
import RunView from "./RunView";
import SettingsView from "./SettingsView";
import { ConfirmHost, Dot, RunPanel, useRuns, useStatus } from "./components";
import { SessionKind } from "./hub";
import { TerminalDock, useSessions } from "./terminals";

type Tab = "home" | "claude" | "hermes" | "zara" | "machines" | "run" | "agent" | "history" | "settings";

const NAV: { id: Tab; label: string; key: string }[] = [
  { id: "home", label: "HOME", key: "1" },
  { id: "claude", label: "CLAUDE CODE", key: "2" },
  { id: "hermes", label: "HERMES", key: "3" },
  { id: "zara", label: "ZARA", key: "4" },
  { id: "agent", label: "AGENT", key: "5" },
  { id: "machines", label: "MACHINES", key: "6" },
  { id: "run", label: "RUN", key: "7" },
  { id: "history", label: "HISTORY", key: "8" },
  { id: "settings", label: "SETTINGS", key: "9" },
];

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
  const [tab, setTab] = useState<Tab>("home");
  const [runFor, setRunFor] = useState<string | undefined>();
  const { devices, status } = useStatus();
  const { sessions } = useSessions();
  const openRun = (id: string) => { setRunFor(id); setTab("run"); };
  const count = (k: SessionKind) => sessions.filter((s) => s.kind === k && s.alive).length;
  const deckKind: SessionKind | undefined = tab === "claude" || tab === "hermes" || tab === "zara" ? tab : undefined;

  return (
    <div className="shell"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
          const t = NAV.find((n) => n.key === e.key);
          if (t && !(e.target as HTMLElement).closest(".xterm")) { e.preventDefault(); setTab(t.id); }
        }
      }}>
      <header className="topnav">
        <nav className="topnav-links">
          {NAV.map((n) => (
            <button key={n.id} className={`tn ${tab === n.id ? "tn-on" : ""}`} onClick={() => setTab(n.id)} title={`⌘${n.key}`}>
              {n.label}
              {(n.id === "claude" || n.id === "hermes" || n.id === "zara") && count(n.id) > 0 && <span className="tn-count">{count(n.id)}</span>}
            </button>
          ))}
        </nav>
        <div className="topnav-machines">
          {devices.map((d) => {
            const s = status[d.id];
            const worst = Math.max(0, ...(s?.probe?.disks ?? []).map((k) => k.used_percent));
            const state = !s || (s.loading && !s.probe) ? "idle" : s.error && !s.probe ? "bad" : worst >= 95 ? "bad" : worst >= 90 ? "warn" : "ok";
            return (
              <button key={d.id} className="tm" onClick={() => openRun(d.id)} title={`${d.name} · ${d.host} — run commands`}>
                <Dot state={state} /><span>{d.name}</span>
              </button>
            );
          })}
        </div>
      </header>

      <div className="main-wrap">
        <main className={`main ${tab === "home" ? "main-hud" : ""}`}>
          {tab === "home" && <Home onNavigate={(t) => setTab(t as Tab)} />}
          {tab === "claude" && <ClaudeView />}
          {tab === "hermes" && <HermesView />}
          {tab === "zara" && <ZaraView />}
          {tab === "agent" && <AgentView onSettings={() => setTab("settings")} />}
          {tab === "machines" && <Overview onTerminal={openRun} />}
          {tab === "run" && <RunView preselect={runFor} />}
          {tab === "history" && <HistoryView />}
          {tab === "settings" && <SettingsView />}
        </main>
        <TerminalDock hiddenFor={deckKind} />
      </div>

      <ActivityDock />
      <ConfirmHost />
    </div>
  );
}
