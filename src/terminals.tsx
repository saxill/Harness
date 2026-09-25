import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Device } from "./api";
import { OsGlyph, useStatus } from "./components";
import { DEFAULT_CWD, LAUNCH, Session, SessionKind, sessions } from "./hub";

export const useSessions = () => useSyncExternalStore(sessions.subscribe, sessions.getSnapshot);

const KIND_LABEL: Record<SessionKind, string> = { shell: "shell", claude: "Claude Code", hermes: "Hermes", zara: "Zara" };

/** Hosts one live session. The xterm element moves to wherever it's shown last. */
export function TerminalView({ session, className = "" }: { session: Session; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.appendChild(session.host);
    const fit = () => { try { session.fit.fit(); } catch { /* not laid out yet */ } };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    requestAnimationFrame(fit);
    session.term.focus();
    return () => ro.disconnect();
  }, [session]);
  return <div ref={box} className={`term ${className}`} onClick={() => session.term.focus()} />;
}

export function openSession(devices: Device[], kind: SessionKind, deviceId?: string, prompt?: string) {
  if (kind === "shell") {
    const d = devices.find((x) => x.id === deviceId);
    if (!d) return;
    return sessions.open({ deviceId: d.id, kind, title: d.name });
  }
  const spec = LAUNCH[kind];
  const target = spec.deviceId ?? deviceId ?? "laptop";
  const d = devices.find((x) => x.id === target);
  if (!d) return;
  if (kind === "claude") {
    const quoted = prompt ? ` ${d.kind === "windows" ? `"${prompt.replace(/"/g, "'")}"` : `'${prompt.replace(/'/g, "'\\''")}'`}` : "";
    return sessions.open({ deviceId: d.id, kind, command: `claude${quoted}`, cwd: DEFAULT_CWD[d.id], title: `Claude · ${d.name}` });
  }
  return sessions.open({ deviceId: d.id, kind, command: spec.command, title: spec.label, typeAfter: prompt });
}

function NewMenu({ onPick }: { onPick: (kind: SessionKind, deviceId?: string) => void }) {
  const { devices } = useStatus();
  return (
    <div className="menu" onClick={(e) => e.stopPropagation()}>
      <div className="menu-label">CLAUDE CODE ON</div>
      {devices.map((d) => (
        <button key={`c-${d.id}`} className="menu-item" onClick={() => onPick("claude", d.id)}>
          <OsGlyph kind={d.kind} /> {d.name}
        </button>
      ))}
      <div className="menu-label">AGENTS</div>
      <button className="menu-item" onClick={() => onPick("hermes")}>Hermes · chat</button>
      <button className="menu-item" onClick={() => onPick("zara")}>Zara · chat</button>
      <div className="menu-label">SHELL ON</div>
      {devices.map((d) => (
        <button key={`s-${d.id}`} className="menu-item" onClick={() => onPick("shell", d.id)}>
          <OsGlyph kind={d.kind} /> {d.name}
        </button>
      ))}
    </div>
  );
}

/** The bar along the bottom of every page, expanding into a terminal deck. */
export function TerminalDock({ hiddenFor }: { hiddenFor?: SessionKind }) {
  const { devices } = useStatus();
  const { sessions: all, active } = useSessions();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const shown = hiddenFor ? all.filter((s) => s.kind !== hiddenFor) : all;
  const current = shown.find((s) => s.id === active) ?? shown[shown.length - 1];

  useEffect(() => {
    const close = () => setMenu(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const pick = (kind: SessionKind, deviceId?: string) => {
    setMenu(false);
    openSession(devices, kind, deviceId);
    setOpen(true);
  };

  return (
    <div className={`dockbar ${open && current ? "dockbar-open" : ""}`}>
      <div className="dockbar-head">
        <button className="hud-link" onClick={() => setOpen((o) => !o)}>
          <span className="hud-key">⌘</span> TERMINALS <span className="muted">{shown.length} open</span> <span className="caret">{open ? "▾" : "▴"}</span>
        </button>
        <div className="dock-tabs">
          {shown.map((s) => (
            <span key={s.id} className={`dock-tab ${current?.id === s.id ? "dock-tab-on" : ""} ${s.alive ? "" : "dock-tab-dead"}`}
              onClick={() => { sessions.focus(s.id); setOpen(true); }}>
              <span className={`kind kind-${s.kind}`}>{KIND_LABEL[s.kind]}</span>
              <span className="clip">{s.kind === "shell" ? s.title : devices.find((d) => d.id === s.deviceId)?.name}</span>
              <button className="x" onClick={(e) => { e.stopPropagation(); sessions.close(s.id); }} aria-label="Close">×</button>
            </span>
          ))}
        </div>
        <span className="spacer" />
        <div className="menu-anchor">
          <button className="hud-btn" onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }}>+ New terminal</button>
          {menu && <NewMenu onPick={pick} />}
        </div>
      </div>
      {open && current && <TerminalView session={current} className="dock-term" />}
    </div>
  );
}
