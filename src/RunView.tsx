import { useEffect, useRef, useState } from "react";
import { snippets } from "./actions";
import { runs } from "./api";
import { OsGlyph, RunPanel, useRuns, useStatus } from "./components";

export default function RunView({ preselect }: { preselect?: string }) {
  const { devices } = useStatus();
  const all = useRuns();
  const [targets, setTargets] = useState<string[]>(preselect ? [preselect] : []);
  const [command, setCommand] = useState("");
  const [recall, setRecall] = useState(-1);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (preselect) setTargets([preselect]);
    box.current?.focus();
  }, [preselect]);

  const chosen = devices.filter((d) => targets.includes(d.id));
  const kinds = new Set(chosen.map((d) => d.kind));
  const mixed = kinds.size > 1;
  const typed = all.filter((r) => r.source === "user").map((r) => r.command);

  const go = () => {
    const cmd = command.trim();
    if (!cmd || chosen.length === 0) return;
    chosen.forEach((d) => runs.start(d.id, cmd, "user"));
    setRecall(-1);
    setCommand("");
  };

  const toggle = (id: string) =>
    setTargets((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  return (
    <div className="view">
      <div className="view-head">
        <h1>Terminal</h1>
        <span className="muted small">Runs over SSH with your own keys · every command is logged in History</span>
        <span className="spacer" />
        <button className="btn" onClick={() => runs.clearFinished()}>Clear finished</button>
      </div>

      <div className="card composer">
        <div className="targets">
          {devices.map((d) => (
            <button key={d.id} className={`chip ${targets.includes(d.id) ? "chip-on" : ""}`} onClick={() => toggle(d.id)}>
              <OsGlyph kind={d.kind} /> {d.name}
            </button>
          ))}
          <span className="spacer" />
          {chosen.length === 1 &&
            (snippets[chosen[0].kind] ?? []).map((s) => (
              <button key={s.label} className="btn btn-xs" onClick={() => { setCommand(s.command); box.current?.focus(); }}>{s.label}</button>
            ))}
        </div>
        {mixed && (
          <div className="small tone-warn">
            Mixed targets: channa runs PowerShell, the others run bash/zsh — the same command may not work on both.
          </div>
        )}
        <div className="composer-row">
          <textarea
            ref={box}
            value={command}
            placeholder={chosen.length ? (kinds.has("windows") && kinds.size === 1 ? "PowerShell command…" : "Shell command…") : "Pick a machine first"}
            spellCheck={false}
            rows={Math.min(8, Math.max(2, command.split("\n").length))}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); }
              if (e.key === "ArrowUp" && !command.includes("\n") && typed.length) {
                e.preventDefault();
                const i = Math.min(typed.length - 1, recall + 1);
                setRecall(i);
                setCommand(typed[i]);
              }
            }}
          />
          <button className="btn btn-primary" disabled={!command.trim() || chosen.length === 0} onClick={go}>
            Run{chosen.length > 1 ? ` on ${chosen.length}` : ""}
          </button>
        </div>
        <div className="small muted">⌘/Ctrl + Enter to run · ↑ for your last commands</div>
      </div>

      <div className="runs">
        {all.length === 0 && <div className="empty">No commands yet this session.</div>}
        {all.map((r) => <RunPanel key={r.id} run={r} device={devices.find((d) => d.id === r.deviceId)} />)}
      </div>
    </div>
  );
}
