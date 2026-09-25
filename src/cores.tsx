// The centrepiece of the home screen: one particle field, drawn in a different
// shape for each mode. Same twinkle, glow and state colours everywhere (amber
// while something runs, red on an alert). Holds still under reduced motion.
import { useEffect, useRef } from "react";

export type CoreShape = "spiral" | "globe" | "orbits" | "wave";
export type CoreState = "idle" | "working" | "alert";

const RED = "255,110,110";
const AMBER = "255,190,70";
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

interface P { a: number; b: number; c: number; s: number; tw: number }

function particles(shape: CoreShape): P[] {
  const rnd = Math.random;
  const s = () => rnd() * 1.4 + 0.3;
  switch (shape) {
    case "spiral": // three arms, denser toward the centre
      return Array.from({ length: 1400 }, (_, i) => {
        const t = rnd();
        return { a: Math.pow(t, 0.7), b: (i % 3) * ((Math.PI * 2) / 3) + t * 5.2 + (rnd() - 0.5) * 0.55, c: 0, s: s(), tw: rnd() * 6 };
      });
    case "globe": // points spread evenly over a sphere (a Fibonacci lattice)
      return Array.from({ length: 1300 }, (_, i) => {
        const y = 1 - (2 * (i + 0.5)) / 1300;
        return { a: y, b: i * GOLDEN, c: 1 + (rnd() - 0.5) * 0.05, s: s(), tw: rnd() * 6 };
      });
    case "orbits": // three tilted rings around a small nucleus
      return Array.from({ length: 1300 }, (_, i) => i < 220
        ? { a: -1, b: rnd() * Math.PI * 2, c: Math.pow(rnd(), 1.6) * 0.14, s: s(), tw: rnd() * 6 }
        : { a: i % 3, b: rnd() * Math.PI * 2, c: 1 + (rnd() - 0.5) * 0.06, s: s(), tw: rnd() * 6 });
    case "wave": // two rings whose radius moves like a voice
      return Array.from({ length: 1400 }, (_, i) => ({
        a: i % 10 < 7 ? 0 : 1, b: rnd() * Math.PI * 2, c: (rnd() + rnd() + rnd() - 1.5) / 1.5, s: s(), tw: rnd() * 6,
      }));
  }
}

export function Core({ shape, state, rgb = "235,242,246", small = false }: { shape: CoreShape; state: CoreState; rgb?: string; small?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ shape, state, rgb, pts: particles(shape) });
  if (live.current.shape !== shape) live.current.pts = particles(shape);
  Object.assign(live.current, { shape, state, rgb });

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, rot = 0;
    const draw = () => {
      const { shape, state, rgb, pts } = live.current;
      const dpr = window.devicePixelRatio || 1;
      const w = (c.width = Math.round(c.clientWidth * dpr)), h = (c.height = Math.round(c.clientHeight * dpr));
      const R = Math.min(w, h) * 0.46, cx = w / 2, cy = h / 2;
      const col = state === "alert" ? RED : state === "working" ? AMBER : rgb;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.5);
      glow.addColorStop(0, `rgba(${col},0.35)`);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      const dot = (x: number, y: number, p: P, fade: number) => {
        ctx.fillStyle = `rgba(${col},${(0.35 + 0.65 * Math.abs(Math.sin(p.tw + rot * 3))) * fade})`;
        ctx.fillRect(x, y, p.s * dpr, p.s * dpr);
      };

      if (shape === "spiral") {
        for (const p of pts) {
          const a = p.b + rot * (1.2 - p.a * 0.6);
          dot(cx + Math.cos(a) * p.a * R, cy + Math.sin(a) * p.a * R * 0.92, p, 1 - p.a * 0.5);
        }
      } else if (shape === "globe") {
        const tilt = 0.38, ct = Math.cos(tilt), st = Math.sin(tilt), r = R * 0.8;
        for (const p of pts) {
          const ring = Math.sqrt(1 - p.a * p.a), phi = p.b + rot * 2.2;
          const x = Math.cos(phi) * ring * p.c, y = p.a * p.c, z = Math.sin(phi) * ring * p.c;
          const y2 = y * ct - z * st, z2 = y * st + z * ct;
          dot(cx + x * r, cy + y2 * r, p, 0.18 + 0.82 * ((z2 + 1) / 2));
        }
      } else if (shape === "orbits") {
        const r = R * 0.88;
        for (const p of pts) {
          if (p.a < 0) { // nucleus
            const a = p.b + rot * 4;
            dot(cx + Math.cos(a) * p.c * R, cy + Math.sin(a) * p.c * R, p, 1);
            continue;
          }
          const node = p.a * ((Math.PI * 2) / 3) + rot * 0.6, incl = 1.18;
          const th = p.b + rot * (6 + p.a * 1.5);
          const x0 = Math.cos(th) * p.c, y0 = Math.sin(th) * p.c;
          const y1 = y0 * Math.cos(incl), z1 = y0 * Math.sin(incl);
          const x = x0 * Math.cos(node) - y1 * Math.sin(node), y = x0 * Math.sin(node) + y1 * Math.cos(node);
          dot(cx + x * r, cy + y * r, p, 0.3 + 0.7 * ((z1 + 1) / 2));
        }
      } else {
        const loud = state === "working" ? 1.8 : 1;
        const t = rot * 14;
        for (const p of pts) {
          const th = p.b + rot * (p.a ? -0.8 : 0.8);
          const inner = p.a === 1;
          const amp = (inner ? 0.5 : 1) * loud;
          const wobble = 0.08 * Math.sin(5 * th + 2.1 * t) + 0.05 * Math.sin(9 * th - 3.3 * t) + 0.03 * Math.sin(13 * th + 1.3 * t);
          const rr = R * (inner ? 0.42 : 0.72) * (1 + wobble * amp) + p.c * R * 0.045;
          dot(cx + Math.cos(th) * rr, cy + Math.sin(th) * rr, p, inner ? 0.6 : 1 - Math.abs(p.c) * 0.4);
        }
      }

      rot += state === "working" ? 0.006 : 0.0018;
      if (!still && !document.hidden) raf = requestAnimationFrame(draw);
    };
    draw();
    const slow = still ? window.setInterval(draw, 1000) : 0;
    const onVis = () => { if (!document.hidden && !still) { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelAnimationFrame(raf); clearInterval(slow); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  return <canvas ref={canvas} className={small ? "core core-mini" : "core"} aria-hidden />;
}
