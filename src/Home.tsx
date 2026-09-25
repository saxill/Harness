import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { piActions } from "./actions";
import { Device, statusStore, when } from "./api";
import { runAction, useRuns, useStatus } from "./components";
import {
  compact, Directive, DIRECTIVES_PATH, DIRECTIVES_TEMPLATE, laya, parseDirectives, SessionKind, vault, youtube,
} from "./hub";
import { Core, CoreShape } from "./cores";
import { ClaudeMachines, ClaudeSide, HermesJobs, HermesSide, ZaraSide, ZaraToday } from "./modes";
import { Alert, alertsFor } from "./Overview";
import { openSession, useSessions } from "./terminals";

type Mode = "auto" | "claude" | "hermes" | "zara";
/** Every mode uses the same particle core; only its shape and colour change. */
const MODES: { id: Mode; label: string; sub: string; shape: CoreShape; rgb: string }[] = [
  { id: "auto", label: "AUTO", sub: "Laya picks who handles it", shape: "spiral", rgb: "235,242,246" },
  { id: "claude", label: "CLAUDE CODE", sub: "Opens a session on the machine you pick", shape: "globe", rgb: "232,166,106" },
  { id: "hermes", label: "HERMES", sub: "Research, browsing, carousels · on channa", shape: "orbits", rgb: "157,140,255" },
  { id: "zara", label: "ZARA", sub: "Assistant, memory, pipelines · on the Pi", shape: "wave", rgb: "95,211,194" },
];

/** Which alerts each mode shows: everything, machines only, channa, or the Pi. */
const inScope = (mode: Mode, a: Alert) =>
  mode === "auto" ? true
    : mode === "claude" ? a.topic === "machine"
      : mode === "hermes" ? a.device === "channa"
        : a.device === "pi";

const MODE_KEY = "harness.home.mode";
function savedMode(): Mode {
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (m && MODES.some((x) => x.id === m)) return m as Mode;
  } catch { /* storage can be unavailable */ }
  return "auto";
}

const useYoutube = () => useSyncExternalStore(youtube.subscribe, youtube.getSnapshot);

// ---------- visuals ----------

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const hh = now.getHours().toString().padStart(2, "0"), mm = now.getMinutes().toString().padStart(2, "0");
  const ss = now.getSeconds().toString().padStart(2, "0");
  return (
    <div className="clock">
      <div className="clock-time">{hh}:{mm}<span>:{ss}</span></div>
      <div className="clock-date">{now.toLocaleDateString([], { weekday: "short" }).toUpperCase()} · {now.toLocaleDateString([], { month: "short", day: "numeric" }).toUpperCase()}</div>
    </div>
  );
}

function Spark({ values, color = "var(--hud-line)" }: { values: number[]; color?: string }) {
  if (values.length < 2) return <svg className="spark" viewBox="0 0 100 24"><line x1="0" y1="20" x2="100" y2="20" stroke="#2a333a" strokeDasharray="2 3" /></svg>;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${22 - ((v - lo) / span) * 18}`);
  const last = pts[pts.length - 1].split(",");
  return (
    <svg className="spark" viewBox="0 0 100 24" preserveAspectRatio="none">
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="1.6" fill={color} />
    </svg>
  );
}

// ---------- panels ----------

function Vitals() {
  const { data, loading, error } = useYoutube();
  const { devices, status } = useStatus();
  const ch = data?.channels[0];
  const subsHist = (ch?.history ?? []).map((h) => h.subscribers ?? 0);
  const viewHist = (ch?.history ?? []).map((h) => h.total_views);
  const recentShorts = (ch?.items ?? []).filter((i) => i.kind === "short").slice(0, 20).reverse().map((i) => i.views ?? 0);
  const latest = ch?.items.find((i) => i.kind === "short");
  const subsDelta = subsHist.length > 1 ? subsHist[subsHist.length - 1] - subsHist[Math.max(0, subsHist.length - 8)] : null;
  const online = devices.filter((d) => status[d.id]?.probe).length;

  return (
    <div className="hud-col">
      <div className="hud-label">SYSTEM VITALS <span>{ch ? ch.handle : "YOUTUBE"}</span></div>
      {error && !data && <div className="hud-note bad">YouTube: {error.slice(0, 80)}</div>}
      {loading && !data && <div className="hud-note">reading the channel…</div>}
      {ch && (
        <>
          <div className="vital">
            <div className="vital-head"><span>● YT SUBSCRIBERS</span>{subsDelta !== null && <span className={subsDelta >= 0 ? "up" : "down"}>{subsDelta >= 0 ? "▲" : "▼"} {Math.abs(subsDelta)} /wk</span>}</div>
            <div className="vital-num">{compact(ch.subscribers)}</div>
            <Spark values={subsHist} color="#ff7a6b" />
          </div>
          <div className="vital">
            <div className="vital-head"><span>● TOTAL VIEWS</span><span>{ch.count} videos</span></div>
            <div className="vital-num">{compact(ch.total_views)}</div>
            <Spark values={viewHist} color="#9d8cff" />
          </div>
          <div className="vital">
            <div className="vital-head"><span>● LAST 7 DAYS</span><span>{ch.last7.posted} shorts</span></div>
            <div className="vital-num">{compact(ch.last7.views)}<small> views</small></div>
            <Spark values={recentShorts} color="#5fd3c2" />
          </div>
          {latest && (
            <div className="vital">
              <div className="vital-head"><span>● LATEST SHORT</span><span>median {compact(ch.median_views)}</span></div>
              <div className="vital-num">{compact(latest.views)}<small> views</small></div>
              <div className="vital-title" title={latest.title}>{latest.title}</div>
            </div>
          )}
        </>
      )}
      <div className="vital">
        <div className="vital-head"><span>● MACHINES</span><span>tailnet</span></div>
        <div className="vital-num">{online}<small>/{devices.length} online</small></div>
      </div>
    </div>
  );
}

function Directives() {
  const [items, setItems] = useState<Directive[] | null>(null);
  const [raw, setRaw] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const load = () => vault.read(DIRECTIVES_PATH)
    .then((r) => { setRaw(r.content); setItems(parseDirectives(r.content)); setState(r.exists ? "ready" : "missing"); })
    .catch(() => setState("error"));
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, []);

  const toggle = async (d: Directive) => {
    const lines = raw.split("\n");
    lines[d.line] = lines[d.line].replace(/\[( |x|X)\]/, d.done ? "[ ]" : "[x]");
    const next = lines.join("\n");
    setRaw(next); setItems(parseDirectives(next));
    await vault.write(DIRECTIVES_PATH, next).catch(load);
  };

  const open = (items ?? []).filter((d) => !d.done);
  return (
    <div className="hud-block">
      <div className="hud-label">DIRECTIVES <span>{state === "ready" ? `${open.length} OPEN` : "OBSIDIAN"}</span></div>
      {state === "loading" && <div className="hud-note">reading the vault…</div>}
      {state === "error" && <div className="hud-note bad">vault unreachable — is the laptop on?</div>}
      {state === "missing" && (
        <button className="hud-btn" onClick={() => vault.write(DIRECTIVES_PATH, DIRECTIVES_TEMPLATE).then(load)}>Create Directives.md</button>
      )}
      {open.slice(0, 5).map((d) => (
        <label key={d.line} className="directive">
          <input type="checkbox" checked={d.done} onChange={() => toggle(d)} />
          <span>{d.text}</span>
        </label>
      ))}
      {state === "ready" && open.length === 0 && <div className="hud-note">All clear.</div>}
    </div>
  );
}

function NextUp() {
  const { status } = useStatus();
  const jobs = (status["channa"]?.probe?.hermes?.jobs ?? [])
    .filter((j) => j.enabled && j.next_run_at && new Date(j.next_run_at).getTime() > Date.now())
    .sort((a, b) => (a.next_run_at ?? "").localeCompare(b.next_run_at ?? ""))
    .slice(0, 3);
  const slots = [9, 13, 18].map((h) => { const d = new Date(); d.setHours(h, 0, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); return d; })
    .sort((a, b) => a.getTime() - b.getTime());
  return (
    <div className="hud-block">
      <div className="hud-label">NEXT UP</div>
      <div className="nextrow"><span>YouTube post</span><span>{when(slots[0].toISOString())}</span></div>
      {jobs.map((j) => <div key={j.id} className="nextrow"><span>{j.name}</span><span>{when(j.next_run_at)}</span></div>)}
    </div>
  );
}

function QuickActions({ devices }: { devices: Device[] }) {
  const acts = [
    { label: "Post next\nShort", a: piActions.postYouTube },
    { label: "Cross-post\nInstagram", a: piActions.crosspostInstagram },
    { label: "Draft\nLinkedIn", a: piActions.linkedinDraft },
    { label: "Show next\nShort", a: piActions.previewNext },
  ];
  return (
    <div className="hud-block">
      <div className="hud-label">QUICK ACTIONS <span>CONFIRMED FIRST</span></div>
      <div className="qa-grid">
        {acts.map((x) => (
          <button key={x.label} className="qa" onClick={() => runAction(x.a(), devices).then(() => statusStore.refreshPipelines())}>
            <span>{x.label}</span><span className="arrow">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- page ----------

export default function Home({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { devices, status, pipelines } = useStatus();
  const runsNow = useRuns().filter((r) => r.running).length;
  const { sessions: open } = useSessions();
  const [mode, setModeState] = useState<Mode>(savedMode);
  const [target, setTarget] = useState("laptop");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [routing, setRouting] = useState(false);
  const [layaOk, setLayaOk] = useState<boolean | null>(null);
  const [vaultOk, setVaultOk] = useState<boolean | null>(null);

  const setMode = (m: Mode) => {
    setModeState(m);
    setNote("");
    try { localStorage.setItem(MODE_KEY, m); } catch { /* not important */ }
  };

  useEffect(() => {
    laya.judge("health check", { ok: { type: "noul", instructions: "Is this a health check?" } }).then(() => setLayaOk(true), () => setLayaOk(false));
    vault.list().then((r) => setVaultOk(r.exists), () => setVaultOk(false));
  }, []);

  const allAlerts = useMemo(() => alertsFor(devices, status, pipelines.data), [devices, status, pipelines.data]);
  const alerts = allAlerts.filter((a) => inScope(mode, a));
  const online = devices.filter((d) => status[d.id]?.probe).length;
  const working = routing || runsNow > 0;
  const bad = alerts.some((a) => a.tone === "bad");
  const coreState = working ? "working" : bad ? "alert" : "idle";
  const current = MODES.find((m) => m.id === mode)!;
  const hermesNext = (status["channa"]?.probe?.hermes?.jobs ?? [])
    .filter((j) => j.enabled && j.next_run_at && new Date(j.next_run_at).getTime() > Date.now())
    .sort((a, b) => (a.next_run_at ?? "").localeCompare(b.next_run_at ?? ""))[0];
  const sub = mode === "hermes" && hermesNext
    ? `On channa · next: ${hermesNext.name} at ${new Date(hermesNext.next_run_at!).toTimeString().slice(0, 5)}`
    : current.sub;

  const go = async () => {
    const prompt = text.trim();
    let kind: SessionKind = mode === "auto" ? "claude" : mode;
    if (mode === "auto") {
      if (!prompt) return;
      setRouting(true);
      try {
        const r = await laya.route(prompt);
        kind = r.choice as SessionKind;
        setNote(`Laya → ${MODES.find((m) => m.id === kind)?.label} (${Math.round((r.probabilities[r.choice] ?? 0) * 100)}%)`);
      } catch {
        setNote("Laya unreachable — sent to Claude Code");
      } finally { setRouting(false); }
    }
    openSession(devices, kind, kind === "claude" ? target : undefined, prompt || undefined);
    setText("");
  };

  const core = <Core shape={current.shape} rgb={current.rgb} state={coreState} />;

  const left = mode === "claude" ? <ClaudeMachines target={target} onPick={setTarget} />
    : mode === "hermes" ? <HermesJobs />
      : mode === "zara" ? <ZaraToday />
        : <Vitals />;
  const right = mode === "claude" ? <ClaudeSide onNavigate={onNavigate} />
    : mode === "hermes" ? <HermesSide onNavigate={onNavigate}><Directives /></HermesSide>
      : mode === "zara" ? <ZaraSide devices={devices} />
        : (
          <div className="hud-col">
            <QuickActions devices={devices} />
            <Directives />
            <NextUp />
          </div>
        );

  return (
    <div className="hud" data-mode={mode}>
      <header className="hud-top">
        <div className="hud-brand">
          <div className="hud-name">HARNESS<span>/v1</span></div>
          <div className="hud-tag">FOUR MACHINES, ONE CONSOLE</div>
        </div>
        <div className="modes" role="tablist">
          {MODES.map((m) => (
            <button key={m.id} role="tab" aria-selected={mode === m.id} className={`mode mode-${m.id} ${mode === m.id ? "mode-on" : ""}`} onClick={() => setMode(m.id)}>{m.label}</button>
          ))}
        </div>
        <Clock />
      </header>

      <div className="hud-grid">
        {left}

        <section className="hud-center">
          <div className="statusline">
            <span className={`st ${coreState}`}>● {mode === "auto" ? "CORE" : current.label} · {coreState.toUpperCase()}</span>
            <span>{online}/{devices.length} MACHINES</span>
            <span className={vaultOk === false ? "off" : ""}>{vaultOk === null ? "VAULT …" : vaultOk ? "VAULT CONNECTED" : "VAULT OFFLINE"}</span>
            <span className={layaOk === false ? "off" : ""}>{layaOk === null ? "LAYA …" : layaOk ? "LAYA READY" : "LAYA OFFLINE"}</span>
            <span>{open.length} TERMINALS</span>
          </div>
          {core}
          <div className="core-name">{current.label}</div>
          <div className="core-sub">{sub}</div>
          {mode === "claude" && (
            <div className="targets hud-targets">
              {devices.map((d) => (
                <button key={d.id} className={`chip ${target === d.id ? "chip-on" : ""}`} onClick={() => setTarget(d.id)}>{d.name}</button>
              ))}
            </div>
          )}
          <form className="ask" onSubmit={(e) => { e.preventDefault(); go(); }}>
            <input value={text} onChange={(e) => setText(e.target.value)}
              placeholder={mode === "auto" ? "Ask anything — Laya routes it" : mode === "claude" ? `What should Claude Code do on ${devices.find((d) => d.id === target)?.name ?? "it"}? (empty = just open it)` : `Message ${current.label.toLowerCase()}…`} />
            <button className="hud-btn" type="submit" disabled={routing || (mode === "auto" && !text.trim())}>{mode === "auto" ? "Route" : "Open"}</button>
          </form>
          {note && <div className="hud-note">{note}</div>}
          {alerts.length > 0 && (
            <div className="hud-alerts">
              {alerts.slice(0, 3).map((a, i) => <div key={i} className={`hud-alert ${a.tone}`}>{a.text}</div>)}
              {alerts.length > 3 && <button className="hud-link" onClick={() => onNavigate("machines")}>+{alerts.length - 3} more →</button>}
            </div>
          )}
        </section>

        {right}
      </div>
    </div>
  );
}
