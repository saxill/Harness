// The centrepiece of each home mode. Each one draws that mode's data, not just
// decoration: machines for Claude Code, the day's cron schedule for Hermes,
// recent Shorts' views for Zara. All hold still under reduced motion.
import { MutableRefObject, useEffect, useRef } from "react";
import { HermesJob } from "./api";

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, dpr: number) => void;

/** Sizes the canvas, runs `draw` every frame (or once a second under reduced
 * motion), and pauses while the window is hidden. */
function useCanvas(draw: MutableRefObject<Draw>) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    let raf = 0;
    const frame = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      ctx.clearRect(0, 0, w, h);
      draw.current(ctx, w, h, still ? 0 : (performance.now() - t0) / 1000, dpr);
      if (!still && !document.hidden) raf = requestAnimationFrame(frame);
    };
    frame();
    const slow = still ? window.setInterval(frame, 1000) : 0;
    const onVis = () => { if (!document.hidden && !still) { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelAnimationFrame(raf); clearInterval(slow); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  return ref;
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, a: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

const RED = "255,110,110";
/** Canvas font size: a share of the core's radius, never below 9 CSS px. */
const fs = (R: number, k: number, dpr: number) => Math.max(9 * dpr, Math.round(R * k));
const AMBER = "255,190,70";

// ---------- AUTO: the spiral ----------

export function SpiralCore({ state }: { state: "idle" | "working" | "alert" }) {
  const stars = useRef(Array.from({ length: 1400 }, (_, i) => {
    const arm = i % 3, t = Math.random();
    return { r: Math.pow(t, 0.7), a: arm * ((Math.PI * 2) / 3) + t * 5.2 + (Math.random() - 0.5) * 0.55, s: Math.random() * 1.4 + 0.3, tw: Math.random() * 6 };
  }));
  const rot = useRef(0);
  const draw = useRef<Draw>(() => {});
  draw.current = (ctx, w, h, _t, dpr) => {
    const R = Math.min(w, h) * 0.46;
    const col = state === "alert" ? RED : state === "working" ? AMBER : "235,242,246";
    glow(ctx, w / 2, h / 2, R * 0.5, col, 0.35);
    for (const st of stars.current) {
      const a = st.a + rot.current * (1.2 - st.r * 0.6);
      const x = w / 2 + Math.cos(a) * st.r * R, y = h / 2 + Math.sin(a) * st.r * R * 0.92;
      ctx.fillStyle = `rgba(${col},${0.35 + 0.65 * Math.abs(Math.sin(st.tw + rot.current * 3)) * (1 - st.r * 0.5)})`;
      ctx.fillRect(x, y, st.s * dpr, st.s * dpr);
    }
    rot.current += state === "working" ? 0.006 : 0.0018;
  };
  return <canvas ref={useCanvas(draw)} className="core" aria-hidden />;
}

// ---------- CLAUDE CODE: code rings around the four machines ----------

const GLYPHS = "{}[]()<>/;=+*#$&|~:.01λ→_".split("");
export interface CoreMachine { id: string; name: string; online: boolean; sessions: number; selected: boolean }

export function CodeCore({ machines, alert, working }: { machines: CoreMachine[]; alert: boolean; working: boolean }) {
  const rings = useRef([0.28, 0.44, 0.6].map((r, k) => ({
    r, dir: k % 2 ? -1 : 1, speed: 0.16 - k * 0.04,
    chars: Array.from({ length: 18 + k * 12 }, () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]),
  })));
  const lastSwap = useRef(0);
  const draw = useRef<Draw>(() => {});
  draw.current = (ctx, w, h, t, dpr) => {
    const R = Math.min(w, h) * 0.46, cx = w / 2, cy = h / 2;
    const col = "232,166,106";
    glow(ctx, cx, cy, R * 0.42, alert ? RED : col, 0.22);

    // a glyph changes now and then, so the rings read as live code
    if (t - lastSwap.current > (working ? 0.05 : 0.18)) {
      lastSwap.current = t;
      const ring = rings.current[Math.floor(Math.random() * rings.current.length)];
      ring.chars[Math.floor(Math.random() * ring.chars.length)] = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const ring of rings.current) {
      const n = ring.chars.length, spin = t * ring.speed * ring.dir * (working ? 3 : 1);
      ctx.font = `${fs(R, 0.078, dpr)}px "JetBrains Mono", monospace`;
      const scan = t * 0.9 * ring.dir;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + spin;
        const lit = Math.pow(Math.max(0, Math.cos(a - scan)), 3);
        ctx.fillStyle = `rgba(${col},${0.32 + 0.68 * lit})`;
        ctx.save();
        ctx.translate(cx + Math.cos(a) * ring.r * R, cy + Math.sin(a) * ring.r * R);
        ctx.rotate(a + Math.PI / 2);
        ctx.fillText(ring.chars[i], 0, 0);
        ctx.restore();
      }
    }

    // the prompt cursor
    if (Math.floor(t * 1.6) % 2 === 0 || t === 0) {
      ctx.fillStyle = `rgba(${alert ? RED : col},0.95)`;
      ctx.fillRect(cx - R * 0.035, cy - R * 0.06, R * 0.07, R * 0.12);
    }

    // machines on the outer orbit; the chosen one is wired to the core
    const orbit = R * 0.84;
    ctx.strokeStyle = `rgba(${col},0.12)`;
    ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.arc(cx, cy, orbit, 0, Math.PI * 2); ctx.stroke();
    ctx.font = `${fs(R, 0.05, dpr)}px "JetBrains Mono", monospace`;
    machines.forEach((m, i) => {
      const a = -Math.PI / 2 + (i / Math.max(1, machines.length)) * Math.PI * 2;
      const x = cx + Math.cos(a) * orbit, y = cy + Math.sin(a) * orbit;
      if (m.selected) {
        ctx.setLineDash([4 * dpr, 5 * dpr]);
        ctx.lineDashOffset = -t * 20 * dpr;
        ctx.strokeStyle = `rgba(${col},0.55)`;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.12, cy + Math.sin(a) * R * 0.12); ctx.lineTo(x, y); ctx.stroke();
        ctx.setLineDash([]);
        glow(ctx, x, y, R * 0.12, col, 0.35);
      }
      ctx.fillStyle = m.online ? `rgba(${col},${m.selected ? 1 : 0.7})` : "rgba(120,130,138,0.5)";
      ctx.beginPath(); ctx.arc(x, y, (m.selected ? 5.5 : 3.5) * dpr, 0, Math.PI * 2); ctx.fill();
      for (let s = 0; s < Math.min(m.sessions, 5); s++) {
        ctx.beginPath(); ctx.arc(x, y, (9 + s * 4) * dpr, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${col},${0.5 - s * 0.08})`; ctx.stroke();
      }
      // labels sit above the top machine and below the rest, centred, so the
      // side ones stay inside the canvas
      const lx = x, ly = y + (Math.sin(a) < -0.5 ? -1 : 1) * R * 0.1;
      ctx.textAlign = "center";
      ctx.fillStyle = m.selected ? `rgba(${col},1)` : "rgba(150,162,170,0.8)";
      ctx.fillText(m.name.toUpperCase(), lx, ly);
    });
  };
  return <canvas ref={useCanvas(draw)} className="core" aria-hidden />;
}

// ---------- HERMES: the day's schedule as a 24-hour dial ----------

/** Times of day (hours, fractional) a job runs, from a cron expression or,
 * failing that, from its next run. Weekly jobs are flagged so they can be drawn hollow. */
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

export function OrbitCore({ jobs, running, alert }: { jobs: HermesJob[]; running: boolean | undefined; alert: boolean }) {
  const draw = useRef<Draw>(() => {});
  draw.current = (ctx, w, h, t, dpr) => {
    const R = Math.min(w, h) * 0.46, cx = w / 2, cy = h / 2;
    const col = "157,140,255";
    const now = new Date();
    const nowH = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    const ang = (hh: number) => -Math.PI / 2 + (hh / 24) * Math.PI * 2;
    const dim = running === false;
    glow(ctx, cx, cy, R * 0.36, alert || dim ? RED : col, 0.22);

    // dial: hour ticks, quarter labels
    ctx.lineWidth = dpr;
    ctx.strokeStyle = `rgba(${col},0.25)`;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.94, 0, Math.PI * 2); ctx.stroke();
    ctx.font = `${fs(R, 0.05, dpr)}px "JetBrains Mono", monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (let hh = 0; hh < 24; hh++) {
      const a = ang(hh), big = hh % 6 === 0;
      ctx.strokeStyle = `rgba(${col},${big ? 0.6 : 0.28})`;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * (big ? 0.88 : 0.91), cy + Math.sin(a) * R * (big ? 0.88 : 0.91));
      ctx.lineTo(cx + Math.cos(a) * R * 0.94, cy + Math.sin(a) * R * 0.94);
      ctx.stroke();
      if (big) {
        ctx.fillStyle = "rgba(150,162,170,0.8)";
        ctx.fillText(String(hh).padStart(2, "0"), cx + Math.cos(a) * R * 1.0, cy + Math.sin(a) * R * 1.0);
      }
    }

    // the last two hours as a fading sweep, then the hand
    const sweep = ctx.createConicGradient ? ctx.createConicGradient(ang(nowH - 2), cx, cy) : null;
    if (sweep) {
      sweep.addColorStop(0, `rgba(${col},0)`);
      sweep.addColorStop(2 / 24, `rgba(${col},0.16)`);
      sweep.addColorStop(2 / 24 + 0.0001, "rgba(0,0,0,0)");
      ctx.fillStyle = sweep;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R * 0.9, ang(nowH - 2), ang(nowH)); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = `rgba(${col},0.9)`;
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang(nowH)) * R * 0.92, cy + Math.sin(ang(nowH)) * R * 0.92); ctx.stroke();

    // each enabled job on its own orbit; the next run pulses
    const live = jobs.filter((j) => j.enabled);
    const next = live.filter((j) => j.next_run_at && new Date(j.next_run_at) > now)
      .sort((a, b) => (a.next_run_at ?? "").localeCompare(b.next_run_at ?? ""))[0];
    live.forEach((j, i) => {
      const r = R * (0.3 + (0.52 * (i + 0.5)) / Math.max(1, live.length));
      ctx.strokeStyle = `rgba(${col},0.07)`;
      ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      const { hours, weekly } = jobTimes(j);
      const bad = !!j.last_status && j.last_status !== "ok";
      for (const hh of hours) {
        const a = ang(hh), x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        const isNext = j === next && next.next_run_at && Math.abs(new Date(next.next_run_at).getHours() + new Date(next.next_run_at).getMinutes() / 60 - hh) < 0.01;
        const c = bad ? RED : col;
        if (isNext) glow(ctx, x, y, R * (0.08 + 0.02 * Math.sin(t * 3)), c, 0.6);
        ctx.fillStyle = `rgba(${c},${hh < nowH ? 0.45 : 0.95})`;
        ctx.strokeStyle = `rgba(${c},0.9)`;
        ctx.beginPath(); ctx.arc(x, y, (isNext ? 4.5 : 3) * dpr, 0, Math.PI * 2);
        if (weekly) ctx.stroke(); else ctx.fill();
      }
    });

    // centre: the gateway (what runs next is written under the title)
    ctx.fillStyle = dim ? `rgba(${RED},0.95)` : `rgba(${col},0.95)`;
    ctx.beginPath(); ctx.arc(cx, cy, 4 * dpr, 0, Math.PI * 2); ctx.fill();
    if (dim) {
      ctx.font = `${fs(R, 0.05, dpr)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = `rgba(${RED},0.95)`;
      ctx.fillText("GATEWAY DOWN", cx, cy + R * 0.12);
    }
  };
  return <canvas ref={useCanvas(draw)} className="core" aria-hidden />;
}

// ---------- ZARA: a voice ring made of the recent Shorts' views ----------

export function WaveCore({ views, postedToday, alert, working }: { views: number[]; postedToday: number | null; alert: boolean; working: boolean }) {
  const draw = useRef<Draw>(() => {});
  draw.current = (ctx, w, h, t, dpr) => {
    const R = Math.min(w, h) * 0.46, cx = w / 2, cy = h / 2;
    const col = "95,211,194";
    const vals = views.length ? views : Array.from({ length: 48 }, () => 0);
    const logs = vals.map((v) => Math.log1p(Math.max(0, v)));
    const top = Math.max(1, ...logs);
    const n = vals.length, r0 = R * 0.34;
    glow(ctx, cx, cy, R * 0.4, alert ? RED : col, 0.2 + 0.06 * Math.sin(t * 2));

    // oldest at the top, going clockwise; the newest Short is drawn white
    ctx.lineCap = "round";
    const bw = Math.max(1.5 * dpr, ((Math.PI * 2 * r0) / n) * 0.38);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const breathe = 1 + (working ? 0.18 : 0.06) * Math.sin(t * (working ? 7 : 2.2) + i * 0.45);
      const len = R * (0.05 + 0.5 * (logs[i] / top)) * breathe;
      const newest = i === n - 1 && views.length > 0;
      ctx.strokeStyle = newest ? "rgba(245,250,252,0.95)" : `rgba(${col},${0.35 + 0.6 * (logs[i] / top)})`;
      ctx.lineWidth = bw;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
      ctx.stroke();
    }

    // the "listening" ring
    for (let k = 0; k < 2; k++) {
      const p = ((t * 0.35 + k * 0.5) % 1);
      ctx.strokeStyle = `rgba(${col},${0.35 * (1 - p)})`;
      ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.arc(cx, cy, r0 * (0.55 + 0.4 * p), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(235,242,246,0.95)";
    ctx.font = `300 ${Math.round(R * 0.2)}px "Barlow Condensed", sans-serif`;
    ctx.fillText(postedToday === null ? "–" : String(postedToday), cx, cy - R * 0.06);
    ctx.fillStyle = "rgba(150,162,170,0.85)";
    ctx.font = `${fs(R, 0.042, dpr)}px "JetBrains Mono", monospace`;
    ctx.fillText("POSTED TODAY", cx, cy + R * 0.16);
  };
  return <canvas ref={useCanvas(draw)} className="core" aria-hidden />;
}
