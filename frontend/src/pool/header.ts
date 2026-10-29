// The pool header: a lane swim seen from the side.
//
// Each swimmer's place, stroke and turns are worked out from the clock, so a paused frame and a
// running one use the same code. Only loose spray is simulated frame by frame: every droplet gets a
// speed and then falls under gravity until it drops back into the water. The water stops when the
// viewer pauses it, asks for reduced motion, hides the tab, or scrolls the header out of view.

import { settings } from "../settings";
import {
  blob, capsule, causticPattern, clear, ease, lerp2, mix, pill, readPoolColors, rgba, rnd, smoothShape,
  type PoolColors, type PoolLevels, type Pt,
} from "./draw";

export const STROKE_MS = 1500;
const GLIDE_MS = 1200, TUCK_MS = 650, DIVE_MS = 700;
const DPS = 3; // distance per stroke cycle, in body units (u)
const SKIN = ["#F2CBA8", "#D9A27A", "#B47A4E", "#8C5634", "#5F3B24"];
const CAPS = ["#F2B705", "#0E8C92", "#2F5FC4", "#D33A45", "#FFFFFF"];
const SUITS = ["#1C2E4A", "#7A1F2B", "#0B4F55", "#3D2C63", "#22303A"];
// Where the hand is, relative to the shoulder, through one arm stroke (p from 0 to 1; units of u; y down)
const HAND: [number, number, number][] = [
  [0, -0.82, 0.1], // leaves the water at the hip, elbow first
  [0.08, -0.35, -0.12], // elbow high, hand trailing
  [0.16, 0.42, -0.18], // swings forward over the water
  [0.24, 0.85, -0.06],
  [0.3, 1, 0.03], // goes in in front of the head
  [0.42, 1.08, 0.1], // stretches forward
  [0.55, 0.85, 0.42], // catches the water
  [0.75, 0.1, 0.58], // pulls under the body
  [0.9, -0.75, 0.3], // pushes back past the hip
];

type Geo = { w: number; h: number; standsH: number; deckTop: number; yW: number; lanes: number; lh: number; u: number };
type Phase = "ready" | "dive" | "glide" | "swim" | "tuck";
type Swimmer = { i: number; dir: number; y: number; x: number; phase: Phase; k: number; strokes: number; first: boolean };
type Drop = { x: number; y: number; floor: number; life: number; max: number; r: number; vx: number; vy: number };
type Tap = { x: number; y: number; t: number; big: boolean };

/** The hand's place at p, on a smooth curve through the HAND points (Catmull-Rom). */
function handAt(p: number): Pt {
  const n = HAND.length;
  let k = n - 1;
  while (HAND[k][0] > p) k--;
  const q = (p - HAND[k][0]) / ((k + 1 < n ? HAND[k + 1][0] : 1) - HAND[k][0]), P = (j: number) => HAND[(j + n) % n];
  const [a, b, c, d] = [P(k - 1), P(k), P(k + 1), P(k + 2)];
  const at = (i: number) => 0.5 * (2 * b[i] + (c[i] - a[i]) * q + (2 * a[i] - 5 * b[i] + 4 * c[i] - d[i]) * q * q + (3 * b[i] - a[i] - 3 * c[i] + d[i]) * q * q * q);
  return [at(1), at(2)];
}
// Two-bone inverse kinematics: the elbow is where two 0.55 u bones from the shoulder and the hand meet.
// Of the two answers, the higher one, so the elbow leads.
function elbowFor(sh: Pt, h: Pt): Pt {
  const dx = h[0] - sh[0], dy = h[1] - sh[1], a = Math.acos(Math.min(Math.hypot(dx, dy), 1.099) / 1.1), base = Math.atan2(dy, dx);
  const [e1, e2] = [base - a, base + a].map((b): Pt => [sh[0] + 0.55 * Math.cos(b), sh[1] + 0.55 * Math.sin(b)]);
  return e1[1] < e2[1] ? e1 : e2;
}

export function createPoolHeader(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const S = {
    w: 0, h: 0, raf: 0, last: 0, onScreen: true,
    t0: null as number | null, // the first animated frame: the opening dive is timed from it
    drops: [] as Drop[], taps: [] as Tap[],
    c: {} as PoolColors, lv: { glow: 1, vig: 1, shadowA: 0.2 } as PoolLevels,
    caustics: null as CanvasPattern | null,
    stands: null as HTMLCanvasElement | null, standsKey: "",
  };

  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    S.w = canvas.clientWidth;
    S.h = canvas.clientHeight;
    canvas.width = S.w * dpr;
    canvas.height = S.h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function geometry(): Geo {
    const { w, h } = S, standsH = Math.round(0.26 * h), yW = Math.round(0.36 * h);
    const lanes = Math.max(3, Math.min(5, Math.round(w / 280))), lh = (h - yW) / lanes;
    return { w, h, standsH, deckTop: standsH + Math.round(0.03 * h), yW, lanes, lh, u: Math.min(0.85 * lh, w / 12) }; // u: swimmer scale in px
  }

  function drawStands(x: CanvasRenderingContext2D, g: Geo, c: PoolColors) {
    const rows = 3, rowH = g.standsH / (rows + 0.45), sw = rowH * 0.78, pitch = sw * 1.22, block = 8, aisle = pitch * 1.3, blockW = block * pitch + aisle;
    x.fillStyle = c.stand;
    x.fillRect(0, 0, g.w, g.standsH);
    const first = g.w / 2 - (block * pitch) / 2; // a block of seats sits behind the clock
    for (let bx = first - Math.ceil(first / blockW) * blockW; bx < g.w; bx += blockW) {
      x.fillStyle = c.aisle;
      x.fillRect(bx + block * pitch, 0, aisle - (pitch - sw), g.standsH);
      for (let r = 0; r < rows; r++)
        for (let k = 0; k < block; k++) {
          const sx = bx + k * pitch, sy = rowH * (0.3 + r), rr = Math.min(4, sw / 3);
          x.fillStyle = c["seat-2"];
          pill(x, sx, sy + rowH * 0.1, sw, rowH * 0.6, rr);
          x.fillStyle = c.seat;
          pill(x, sx, sy, sw, rowH * 0.55, rr);
        }
    }
    const fog = x.createLinearGradient(0, 0, 0, g.standsH); // fade the stands back so the water stays in front
    fog.addColorStop(0, rgba(c.stand, 0.6));
    fog.addColorStop(1, rgba(c.stand, 0.15));
    x.fillStyle = fog;
    x.fillRect(0, 0, g.w, g.standsH);
    x.fillStyle = c.steel;
    x.fillRect(0, g.standsH - 3, g.w, 2);
  }
  // The stands drawn once per size and theme, slightly out of focus so the water is the subject
  function standsLayer(g: Geo, c: PoolColors) {
    const dpr = canvas.width / g.w, key = [g.w, g.h, dpr, c.stand, c.seat].join();
    if (S.standsKey === key && S.stands) return S.stands;
    const layer = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
      const cv = document.createElement("canvas");
      cv.width = Math.ceil(g.w * dpr);
      cv.height = Math.ceil(g.standsH * dpr);
      const x = cv.getContext("2d")!;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      return [cv, x];
    };
    const [sharp, sx] = layer(), [soft, bx] = layer();
    drawStands(sx, g, c);
    bx.fillStyle = c.stand;
    bx.fillRect(0, 0, g.w, g.standsH);
    bx.filter = "blur(1.5px)";
    bx.drawImage(sharp, 0, 0, g.w, g.standsH);
    bx.filter = "none";
    S.standsKey = key;
    S.stands = soft;
    return soft;
  }

  // The pace clock lane swimmers use to time their lengths. It shows the real time.
  function drawClock(g: Geo, c: PoolColors) {
    const R = Math.min(g.standsH * 0.42, 56), cx = g.w / 2, cy = g.standsH * 0.5;
    ctx.fillStyle = c["clock-ink"];
    blob(ctx, cx, cy, R + Math.max(2, R * 0.08));
    ctx.fillStyle = c["clock-face"];
    blob(ctx, cx, cy, R);
    ctx.strokeStyle = c["clock-ink"];
    for (let k = 0; k < 60; k++) {
      const a = (k / 60) * Math.PI * 2, big = k % 5 === 0, r0 = R * (big ? 0.78 : 0.87);
      ctx.lineWidth = big ? Math.max(1.5, R * 0.05) : 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0);
      ctx.lineTo(cx + Math.sin(a) * R * 0.94, cy - Math.cos(a) * R * 0.94);
      ctx.stroke();
    }
    if (R >= 24) {
      ctx.fillStyle = c["clock-ink"];
      ctx.font = `800 ${Math.round(R * 0.26)}px "Big Shoulders Display", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      [60, 15, 30, 45].forEach((n, q) => {
        const a = (q * Math.PI) / 2;
        ctx.fillText(String(n), cx + Math.sin(a) * R * 0.56, cy - Math.cos(a) * R * 0.56);
      });
    }
    const now = new Date(), sec = now.getSeconds() + now.getMilliseconds() / 1000, min = now.getMinutes() + sec / 60;
    const hand = (turns: number, len: number, tail: number, width: number, color: string) => {
      const a = turns * Math.PI * 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx - Math.sin(a) * tail, cy + Math.cos(a) * tail);
      ctx.lineTo(cx + Math.sin(a) * len, cy - Math.cos(a) * len);
      ctx.stroke();
    };
    hand(min / 60, R * 0.6, 0, Math.max(2, R * 0.07), c["clock-ink"]);
    hand(sec / 60, R * 0.86, R * 0.18, Math.max(1.5, R * 0.035), c.red);
    ctx.fillStyle = c.red;
    blob(ctx, cx, cy, Math.max(2, R * 0.07));
    ctx.lineCap = "butt";
  }

  function drawLadder(g: Geo, x: number, c: PoolColors) {
    const half = Math.max(7, 0.3 * g.u), top = g.deckTop - 0.1 * g.u, rad = Math.max(4, 0.22 * g.u);
    ctx.strokeStyle = c.steel;
    ctx.lineWidth = Math.max(2, 0.07 * g.u);
    ctx.lineCap = "round";
    for (const xr of [x - half, x + half]) {
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(xr, g.yW + 0.75 * g.lh);
      ctx.lineTo(xr, g.yW);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(xr, g.yW);
      ctx.lineTo(xr, top + rad);
      ctx.arc(xr + rad, top + rad, rad, Math.PI, 0);
      ctx.lineTo(xr + 2 * rad, g.yW - 0.25 * (g.yW - g.deckTop));
      ctx.stroke();
    }
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    for (const f of [0.25, 0.5, 0.75]) {
      const y = g.yW + f * g.lh;
      ctx.moveTo(x - half, y);
      ctx.lineTo(x + half, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
  }

  // Red floats near both walls, like the last places on the board. The rope rides one slow wave and
  // lifts a little beside a passing swimmer, and bobs as a touch ripple passes under it.
  function drawRope(g: Geo, y: number, t: number, c: PoolColors, n: number, swimmers: Swimmer[]) {
    const u = g.u, fw = Math.max(5, 0.28 * u), fh = Math.max(4, 0.19 * u), pitch = fw + Math.max(1, 0.05 * u);
    for (let k = 0, x = 0; x < g.w; k++, x += pitch) {
      let dy = 0.035 * u * Math.sin((x / (6 * u) - t / 2600) * Math.PI * 2 + n * 1.3);
      for (const s of swimmers) {
        if (s.phase !== "swim" || (s.i !== n && s.i !== n - 1)) continue;
        const d = (x - (s.x - s.dir * 1.2 * u)) / (1.6 * u);
        dy -= 0.07 * u * Math.exp(-d * d);
      }
      for (const p of S.taps) {
        const age = (t - p.t) / 1800;
        if (age <= 0 || age >= 1) continue;
        const r = (p.big ? 2.2 : 1.2) * u * Math.sqrt(age), d = (Math.hypot(x - p.x, (y - p.y) / 0.32) - r) / (0.35 * u);
        dy -= (p.big ? 0.14 : 0.07) * u * (1 - age) * Math.exp(-d * d);
      }
      ctx.fillStyle = x < 0.15 * g.w || x + fw > 0.85 * g.w ? c.red : Math.floor(k / 6) % 2 ? c["float-2"] : c.float;
      pill(ctx, x, y - fh / 2 + dy, fw, fh, fh / 2);
      ctx.fillStyle = "#FFFFFF";
      ctx.globalAlpha = 0.3;
      pill(ctx, x + fw * 0.2, y - fh / 2 + dy + fh * 0.12, fw * 0.6, fh * 0.28, fh * 0.14);
      ctx.globalAlpha = 1;
    }
  }

  // Where swimmer i is at time t. One length: push off the wall in a streamline, swim, then tuck and
  // turn. The turn somersaults about the hips, which leaves the head about 2 u back from where it was,
  // facing the other way, upside down; the push-off twists back upright. The first length starts with
  // a dive: swimmers go in one after another from the left wall, timed from the first animated frame.
  // Until then (paused, or reduced motion) everyone is shown mid-length.
  function swimmerAt(g: Geo, i: number, t: number): Swimmer {
    const u = g.u, cycle = STROKE_MS * (0.92 + rnd(i + 0.1) * 0.16), v = (DPS * u) / cycle; // px per ms
    const G = 2.2 * u, start = 3 * u + G, end = g.w - 0.9 * u, D = Math.max(u, end - start), SWIM = D / v;
    const lap = GLIDE_MS + SWIM + TUCK_MS, tt = t - (S.t0 ?? t - 9000) - 500 - i * 320;
    const s: Swimmer = { i, dir: 1, y: g.yW + (i + 0.45) * g.lh, x: 0, phase: "swim", k: 0, strokes: 0.42, first: false };
    if (tt < -DIVE_MS) return { ...s, phase: "ready" }; // still on the side, out of view
    if (tt < 0) {
      const k = (tt + DIVE_MS) / DIVE_MS;
      return { ...s, phase: "dive", k, x: (-1.4 + 4.4 * k) * u };
    }
    const n = Math.floor(tt / lap), tau = tt - n * lap;
    const dir = n % 2 ? -1 : 1, along = (d: number) => (dir > 0 ? d : g.w - d); // distance from the wall this length started at
    s.dir = dir;
    s.first = n === 0;
    if (tau < GLIDE_MS) {
      // gliding off the wall, slowing down
      s.phase = "glide";
      s.k = tau / GLIDE_MS;
      s.x = along(3 * u + G * (1 - (1 - s.k) ** 2));
    } else if (tau < GLIDE_MS + SWIM) {
      // swimming: speed rises a little on each pull
      const ts = tau - GLIDE_MS, f = ts / SWIM;
      s.k = ts;
      s.strokes = 0.42 + ts / cycle; // the first stroke starts from the stretch
      const surge = ((0.25 * DPS * u) / (4 * Math.PI)) * Math.sin(4 * Math.PI * (s.strokes - 0.75)) * Math.sin(Math.PI * f);
      s.x = along(start + D * f + surge);
    } else {
      // tuck and turn at the wall
      s.phase = "tuck";
      s.k = (tau - GLIDE_MS - SWIM) / TUCK_MS;
      s.strokes = 0.42 + SWIM / cycle;
      s.x = along(end);
    }
    return s;
  }

  // Front crawl from the side, drawn facing right and mirrored for swimmers going left. Units are u.
  function drawSwimmer(g: Geo, s: Swimmer, t: number, c: PoolColors) {
    if (s.phase === "ready") return;
    const u = g.u, swim = s.phase === "swim", glide = s.phase === "glide", tuck = s.phase === "tuck", dive = s.phase === "dive";
    const deep = tuck ? Math.min(1, s.k * 1.6) : glide ? (s.k < 0.55 ? 1 : 1 - (s.k - 0.55) / 0.45) : dive ? Math.max(0, (s.k - 0.8) / 0.2) : 0;
    const tone = (hex: string, under: number) => mix(hex, c.pool, Math.min(0.7, under + 0.5 * deep)); // under the water, colours fade into it
    const skin = SKIN[(s.i * 2) % 5], far = mix(skin, "#000000", 0.2), X = ([x, y]: Pt): Pt => [x * u, y * u];
    const pA = ((s.strokes % 1) + 1) % 1;
    const bob = swim ? 0.025 * Math.sin(4 * Math.PI * s.strokes) : 0; // the body rises a little on each pull
    const roll = swim ? 0.035 * Math.cos(2 * Math.PI * (pA - 0.15)) : 0; // and rolls towards the arm that is recovering

    const STREAM: Pt = [1.2, 0], TUCKED: Pt = [-0.55, 0.3];
    const armAt = (p: number, sh: Pt) => {
      const o = handAt(p);
      let h: Pt = [sh[0] + o[0], sh[1] + o[1]];
      if (swim && s.k < 350) h = lerp2(STREAM, h, ease(s.k / 350)); // out of the streamline into the first stroke
      if (tuck) h = lerp2(h, TUCKED, ease(Math.min(1, s.k * 2.5)));
      if (glide) h = s.first ? STREAM : lerp2(TUCKED, STREAM, ease(Math.min(1, s.k / 0.25)));
      if (dive) h = STREAM;
      const dx = h[0] - sh[0], dy = h[1] - sh[1], d = Math.hypot(dx, dy);
      if (d > 1.09) h = [sh[0] + (dx / d) * 1.09, sh[1] + (dy / d) * 1.09]; // keep the hand within reach
      return { over: swim && p < 0.3, sh, e: elbowFor(sh, h), h };
    };
    const legAt = (off: number) => {
      let a: number, b: number;
      if (swim) {
        // six kicks a stroke, knees bend on the way up
        const k = 6 * Math.PI * s.strokes + off;
        a = 0.1 * Math.sin(k);
        b = 0.08 + 0.2 * Math.max(0, Math.sin(k + 0.6));
      } else if (dive) {
        a = 0.04; // straight, toes pointed
        b = 0.06;
      } else if (glide) {
        const k = (t / 480) * Math.PI * 2; // legs together
        a = 0.12 * Math.sin(k);
        b = 0.12 + 0.1 * Math.sin(k + 0.8);
      } else {
        const f = Math.sin(Math.PI * Math.min(1, s.k * 1.25)); // knees to the chest
        a = 2 * f;
        b = 0.1 - 2.4 * f;
      }
      const hip: Pt = [-1.38, 0.1], knee: Pt = [hip[0] - 0.6 * Math.cos(a), hip[1] + 0.6 * Math.sin(a)];
      const ankle: Pt = [knee[0] - 0.55 * Math.cos(a + b), knee[1] + 0.55 * Math.sin(a + b)];
      const toe: Pt = [ankle[0] - 0.2 * Math.cos(a + b - 0.25), ankle[1] + 0.2 * Math.sin(a + b - 0.25)];
      return { hip, knee, ankle, toe };
    };
    const drawArm = (a: ReturnType<typeof armAt>, color: string) => {
      ctx.fillStyle = color;
      capsule(ctx, X(a.sh), X(a.e), 0.1 * u, 0.08 * u);
      capsule(ctx, X(a.e), X(a.h), 0.075 * u, 0.06 * u);
      ctx.beginPath();
      ctx.ellipse(a.h[0] * u, a.h[1] * u, 0.1 * u, 0.065 * u, Math.atan2(a.h[1] - a.e[1], a.h[0] - a.e[0]), 0, Math.PI * 2);
      ctx.fill();
    };
    const drawLeg = (l: ReturnType<typeof legAt>, color: string) => {
      ctx.fillStyle = color;
      capsule(ctx, X(l.hip), X(l.knee), 0.125 * u, 0.09 * u);
      capsule(ctx, X(l.knee), X(l.ankle), 0.085 * u, 0.06 * u);
      capsule(ctx, X(l.ankle), X(l.toe), 0.06 * u, 0.035 * u);
    };

    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.scale(s.dir, 1);

    // Soft shadow on the pool floor
    ctx.save();
    ctx.translate(-1.1 * u, 0.5 * u);
    ctx.scale(1, 0.07);
    const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.9 * u);
    sg.addColorStop(0, c.mark);
    sg.addColorStop(1, clear(c.mark));
    ctx.fillStyle = sg;
    ctx.globalAlpha = 1 - 0.5 * deep;
    blob(ctx, 0, 0, 1.9 * u);
    ctx.restore();
    ctx.globalAlpha = 1;

    // Wake trailing off behind
    if (swim) {
      ctx.lineWidth = Math.max(1, 0.045 * u);
      ctx.lineCap = "round";
      for (const [y0, y1, len, a] of [[0.27, 0.36, 3.6, 0.85], [-0.15, -0.24, 2.8, 0.5]]) {
        const wg = ctx.createLinearGradient(-0.2 * u, 0, -len * u, 0);
        wg.addColorStop(0, c.ripple);
        wg.addColorStop(1, clear(c.ripple));
        ctx.strokeStyle = wg;
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.moveTo(-0.2 * u, (y0 + bob) * u);
        ctx.quadraticCurveTo(-len * 0.5 * u, (y0 + 0.02) * u, -len * u, y1 * u);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = "butt";
    }

    // The swimmer: far side first, then the body, then the near side
    ctx.save();
    const C = X([-1.05, 0.1]);
    const turnAbout = (a: number) => {
      ctx.translate(C[0], C[1]);
      ctx.rotate(a);
      ctx.translate(-C[0], -C[1]);
    };
    if (dive) {
      ctx.translate(0, (-1.4 + 1.7 * s.k - 1.2 * s.k * (1 - s.k)) * u); // an arc, head going down
      turnAbout(0.1 + 0.6 * s.k * s.k);
    } else ctx.translate(0, (bob + 0.3 * deep) * u);
    if (tuck) turnAbout(Math.PI * ease(s.k));
    if (glide && s.first) turnAbout(0.7 * (1 - ease(Math.min(1, s.k / 0.3)))); // levelling out after the dive
    if (glide && !s.first) {
      ctx.translate(0, C[1]);
      ctx.scale(1, -Math.cos(Math.PI * Math.min(1, s.k / 0.45)));
      ctx.translate(0, -C[1]);
    }
    const near = armAt(pA, [-0.12, 0.03 - roll]), farArm = armAt((pA + 0.5) % 1, [-0.16, roll]), nearLeg = legAt(0);
    drawArm(farArm, tone(far, farArm.over ? 0.05 : 0.45));
    drawLeg(legAt(Math.PI), tone(far, 0.4));
    ctx.fillStyle = tone(skin, 0.05);
    smoothShape(ctx, ([[-0.05, -0.15], [-0.55, -0.15], [-1.15, -0.1], [-1.52, -0.02], [-1.5, 0.23], [-1.05, 0.29], [-0.5, 0.31], [-0.1, 0.23]] as Pt[]).map(X));
    ctx.fillStyle = tone(SUITS[(s.i + 2) % 5], 0.05);
    smoothShape(ctx, ([[-1.02, -0.11], [-1.54, -0.02], [-1.52, 0.23], [-1.04, 0.3]] as Pt[]).map(X));
    drawLeg(nearLeg, tone(skin, 0.28));
    if (!near.over) drawArm(near, tone(skin, 0.35));

    // Head with cap and goggles; every other stroke it turns up to breathe as the near arm comes out
    const bp = (pA + 0.1) % 1;
    const breathe = swim && bp < 0.38 && Math.floor(s.strokes + 0.1) % 2 === 0 ? Math.sin((Math.PI * bp) / 0.38) : 0;
    ctx.save();
    ctx.translate(-0.04 * u, 0.03 * u);
    ctx.rotate(-0.5 * breathe);
    ctx.translate(0.04 * u, -0.03 * u);
    ctx.fillStyle = tone(skin, 0);
    capsule(ctx, X([-0.04, 0.03]), X([0.13, -0.05]), 0.11 * u, 0.11 * u);
    blob(ctx, 0.13 * u, -0.05 * u, 0.21 * u);
    ctx.fillStyle = tone(CAPS[s.i % 5], 0);
    ctx.beginPath();
    ctx.arc(0.13 * u, -0.05 * u, 0.22 * u, Math.PI * 0.6, Math.PI * 1.9);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = ctx.fillStyle = tone("#0F2A3A", 0);
    ctx.lineWidth = Math.max(1, 0.03 * u);
    ctx.beginPath();
    ctx.moveTo(-0.07 * u, -0.03 * u);
    ctx.lineTo(0.26 * u, -0.06 * u);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0.27 * u, -0.06 * u, 0.06 * u, 0.045 * u, 0, 0, Math.PI * 2);
    ctx.fill();
    if (breathe > 0.35) blob(ctx, 0.27 * u, 0.07 * u, 0.035 * u * breathe);
    ctx.fillStyle = "#FFFFFF";
    ctx.globalAlpha = 0.7;
    blob(ctx, 0.285 * u, -0.072 * u, 0.016 * u);
    ctx.globalAlpha = 1;
    ctx.restore();
    if (near.over) drawArm(near, tone(skin, 0));
    ctx.restore();

    // White water: a bow wave at the head, a crown of spray where each hand goes in, foam at the kick
    if (swim) {
      ctx.fillStyle = c.ripple;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.ellipse(0.39 * u, (0.13 + bob) * u, 0.17 * u, 0.065 * u, 0, -Math.PI / 2, Math.PI / 2);
      ctx.fill();
      for (const p of [pA, (pA + 0.5) % 1]) {
        const age = (p - 0.3) / 0.14;
        if (age < 0 || age >= 1) continue;
        const x0 = 0.73 - DPS * (p - 0.3), y0 = 0.05; // stays where the hand went in while the body moves on
        ctx.globalAlpha = 0.7 * (1 - age);
        ctx.beginPath();
        ctx.ellipse(x0 * u, y0 * u, (0.1 + 0.15 * age) * u, 0.045 * u, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1 - age;
        for (let j = 0; j < 7; j++) {
          const a = Math.PI * (0.22 + 0.093 * j), sp = 0.55 + 0.35 * rnd(j + s.i * 3);
          blob(ctx, (x0 + Math.cos(a) * sp * age * 0.8) * u, (y0 - Math.sin(a) * sp * age * 1.3 + 1.1 * age * age) * u, (0.045 - 0.02 * age) * u);
        }
      }
      ctx.globalAlpha = 0.45;
      for (let j = 0; j < 4; j++)
        blob(ctx, (nearLeg.toe[0] + 0.1 - j * 0.12) * u, (0.08 + bob + (j % 2) * 0.05) * u, 0.07 * u * (1 + 0.35 * Math.sin(6 * Math.PI * s.strokes + j * 1.7)));
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function spray(x: number, y: number, n: number, u: number, up: number, drift: number) {
    if (S.drops.length > 600) return;
    for (let k = 0; k < n; k++) {
      const life = 0.45 + Math.random() * 0.4;
      S.drops.push({
        x, y, floor: y + 0.12 * u, life, max: life, r: (0.04 + Math.random() * 0.05) * u,
        vx: (drift + (Math.random() - 0.5) * 1.2) * u, vy: -(0.45 + Math.random() * 0.55) * up * u,
      });
    }
  }
  // Throws spray at each turn, as a swimmer comes up, where a hand goes in and on each kick, then moves every droplet on.
  function step(t: number) {
    const g = geometry(), u = g.u, dt = S.last ? Math.min(0.05, (t - S.last) / 1000) : 0;
    if (S.last && t - S.last < 200) {
      for (let i = 0; i < g.lanes; i++) {
        const a = swimmerAt(g, i, S.last), b = swimmerAt(g, i, t), f = b.dir;
        if (a.phase === "swim" && b.phase === "tuck") spray(b.x + f * 0.2 * u, b.y, 16, u, 2.6, -0.3 * f);
        if (a.phase === "tuck" && b.phase === "tuck" && a.k < 0.5 && b.k >= 0.5) spray(b.x + f * 0.4 * u, b.y, 22, u, 3.2, -0.5 * f); // legs coming over
        if (a.phase === "glide" && b.phase === "swim") spray(b.x + f * 0.2 * u, b.y, 10, u, 1.8, 0.3 * f);
        if (a.phase === "dive" && b.phase === "dive" && a.k < 0.72 && b.k >= 0.72) {
          spray(b.x, b.y, 34, u, 3.6, 0.3); // the dive goes in
          S.taps.push({ x: b.x, y: b.y, t, big: true });
        }
        if (a.phase !== "swim" || b.phase !== "swim") continue;
        for (const off of [0.7, 0.2])
          if (Math.floor(a.strokes + off) !== Math.floor(b.strokes + off)) spray(b.x + f * 0.73 * u, b.y + 0.05 * u, 5, u, 2.2, 0.2 * f);
        if (Math.floor(a.strokes * 6) !== Math.floor(b.strokes * 6)) spray(b.x - f * 2.7 * u, b.y + 0.1 * u, 2, u, 1.5, -0.4 * f);
      }
    }
    S.last = t;
    for (const d of S.drops) {
      d.vy += 9 * u * dt; // gravity
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.life -= dt;
    }
    S.drops = S.drops.filter((d) => d.life > 0 && !(d.vy > 0 && d.y > d.floor));
  }

  // Two copies of the caustic tile drifting different ways; where they cross the light seems to shift and focus
  function drawCaustics(g: Geo, t: number) {
    if (!S.caustics) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, g.yW, g.w, g.h - g.yW);
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = S.caustics;
    for (const [sx, sy, vx, vy, a] of [[0.62, 0.3, 0.012, 0.004, 0.12], [0.85, 0.4, -0.009, 0.006, 0.08]]) {
      const ox = (t * vx) % 200, oy = (t * vy) % 200;
      ctx.save();
      ctx.translate(0, g.yW);
      ctx.scale(sx, sy);
      ctx.translate(ox, oy);
      ctx.globalAlpha = a * S.lv.glow;
      ctx.fillRect(-ox - 200, -oy - 200, g.w / sx + 400, (g.h - g.yW) / sy + 400);
      ctx.restore();
    }
    ctx.restore();
  }
  // Slanting light shafts under the surface, swaying and breathing slowly
  function drawShafts(g: Geo, t: number, c: PoolColors) {
    const H = g.h - g.yW;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let k = 0; k < 5; k++) {
      const x0 = (rnd(k + 200) * 1.1 - 0.05) * g.w + Math.sin(t / 7000 + k * 1.7) * 0.025 * g.w, wd = (0.025 + 0.04 * rnd(k + 210)) * g.w, slant = 0.35 * H;
      const gr = ctx.createLinearGradient(0, g.yW, 0, g.h);
      gr.addColorStop(0, rgba(c.light, S.lv.glow * 0.09 * (0.6 + 0.4 * Math.sin(t / 4300 + k * 2.3))));
      gr.addColorStop(1, rgba(c.light, 0));
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(x0, g.yW);
      ctx.lineTo(x0 + wd, g.yW);
      ctx.lineTo(x0 + wd + slant, g.h);
      ctx.lineTo(x0 + slant * 0.85, g.h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  // The surface: brighter at the far side (water reflects more at a low angle), a shadow under the pool's
  // edge, and the ceiling lights reflected as streaks broken up by the ripples
  function drawSurface(g: Geo, t: number, c: PoolColors) {
    const H = g.h - g.yW, sheen = ctx.createLinearGradient(0, g.yW, 0, g.yW + 0.35 * H), edge = ctx.createLinearGradient(0, g.yW, 0, g.yW + 8);
    sheen.addColorStop(0, rgba(c.light, 0.28 * S.lv.glow));
    sheen.addColorStop(1, rgba(c.light, 0));
    ctx.fillStyle = sheen;
    ctx.fillRect(0, g.yW, g.w, 0.35 * H);
    edge.addColorStop(0, rgba(c.shade, 0.25));
    edge.addColorStop(1, rgba(c.shade, 0));
    ctx.fillStyle = edge;
    ctx.fillRect(0, g.yW, g.w, 8);
    ctx.fillStyle = c.light;
    const n = Math.max(3, Math.round(g.w / 220));
    for (let k = 0; k < n; k++) {
      const x = ((k + 0.5) / n) * g.w;
      for (let j = 0; j < 6; j++) {
        const y = g.yW + 5 + j * Math.max(3, 0.11 * g.u) * (1 + j * 0.25), wob = Math.sin(t / 650 + j * 1.4 + k * 2) * (1 + j) * 0.8;
        const wd = (0.55 - j * 0.07) * g.u * (0.8 + 0.2 * Math.sin(t / 900 + j + k));
        ctx.globalAlpha = (0.55 - j * 0.08) * S.lv.glow;
        pill(ctx, x - wd / 2 + wob, y, wd, Math.max(1.5, 0.05 * g.u), 1);
      }
    }
    ctx.globalAlpha = 1;
  }
  // Glints: brief twinkles of light that come and go in new places
  function drawGlints(g: Geo, t: number, c: PoolColors) {
    ctx.fillStyle = c.light;
    for (let k = 0; k < 26; k++) {
      const P = 2200 + rnd(k + 300) * 2600, cyc = t / P + rnd(k + 310), b = Math.sin(Math.PI * 2 * cyc);
      if (b < 0.6) continue;
      const a = ((b - 0.6) / 0.4) ** 2, n = Math.floor(cyc), r = (1 + 1.5 * rnd(k + 340)) * a;
      const x = rnd(k + 320 + n * 7) * g.w, y = g.yW + (0.05 + 0.9 * rnd(k + 330 + n * 7)) * (g.h - g.yW);
      ctx.globalAlpha = 0.9 * a * S.lv.glow;
      ctx.fillRect(x - 3 * r, y - 0.5, 6 * r, 1);
      ctx.fillRect(x - 0.5, y - 2 * r, 1, 4 * r);
      blob(ctx, x, y, r * 0.6);
    }
    ctx.globalAlpha = 1;
  }
  // Ripples from touching the water: rings that spread out and slow down
  function drawTaps(g: Geo, t: number, c: PoolColors) {
    S.taps = S.taps.filter((p) => t - p.t < 1800);
    const lw = Math.max(1.5, 0.06 * g.u);
    for (const p of S.taps) {
      const age = (t - p.t) / 1800;
      for (const lag of [0, 0.15, 0.3]) {
        const a = age - lag;
        if (a <= 0) continue;
        const r = (p.big ? 2.2 : 1.2) * g.u * Math.sqrt(a), fade = (p.big ? 1 : 0.75) * (1 - a) ** 1.5;
        ctx.lineWidth = lw; // each ring: a bright crest with a darker trough just inside
        ctx.strokeStyle = c.shade;
        ctx.globalAlpha = 0.18 * fade;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + lw * 0.6, Math.max(0, r - lw), Math.max(0, r - lw) * 0.32, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = c.light;
        ctx.globalAlpha = 0.85 * fade;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, r, r * 0.32, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  // A soft darkening at the edges, so the eye settles on the middle of the pool
  function drawVignette(g: Geo, c: PoolColors) {
    ctx.save();
    ctx.translate(g.w / 2, g.h * 0.55);
    ctx.scale(g.w / 2, g.h * 0.75);
    const vg = ctx.createRadialGradient(0, 0, 0.55, 0, 0, 1.25);
    vg.addColorStop(0, rgba(c.shade, 0));
    vg.addColorStop(1, rgba(c.shade, 0.3 * S.lv.vig));
    ctx.fillStyle = vg;
    ctx.fillRect(-1.2, -1.2, 2.4, 2.4);
    ctx.restore();
  }

  function draw(t: number) {
    if (!S.w || !S.h) return;
    const c = S.c, g = geometry(), { w, h, yW, lanes, lh, u } = g;
    ctx.drawImage(standsLayer(g, c), 0, 0, w, g.standsH);
    drawClock(g, c);
    ctx.fillStyle = c.wall;
    ctx.fillRect(0, g.standsH, w, g.deckTop - g.standsH);
    ctx.fillStyle = c.deck;
    ctx.fillRect(0, g.deckTop, w, yW - g.deckTop);
    ctx.fillStyle = c.wall;
    ctx.fillRect(0, yW - 3, w, 3); // the pool's edge

    const wg = ctx.createLinearGradient(0, yW, 0, h);
    wg.addColorStop(0, c.far);
    wg.addColorStop(1, c.near);
    ctx.fillStyle = wg;
    ctx.fillRect(0, yW, w, h - yW);
    ctx.fillStyle = c.mark;
    ctx.fillRect(0, yW, w, 2);
    ctx.globalAlpha = 0.45; // lane lines on the floor, faint through the water
    for (let i = 0; i < lanes; i++) {
      const y = yW + (i + 0.62) * lh, bh = Math.max(3, 0.12 * lh), tb = 0.42 * lh, x0 = 0.06 * w, x1 = 0.94 * w;
      ctx.fillRect(x0, y - bh / 2, x1 - x0, bh);
      ctx.fillRect(x0 - bh, y - tb / 2, bh, tb);
      ctx.fillRect(x1, y - tb / 2, bh, tb);
    }
    ctx.globalAlpha = 1;
    drawCaustics(g, t);
    drawShafts(g, t, c);
    drawSurface(g, t, c);
    ctx.strokeStyle = c.ripple; // a few highlights swaying on the surface
    ctx.lineWidth = 1.2;
    ctx.lineCap = "round";
    for (let i = 0; i < lanes; i++)
      for (let k = 0; k < 3; k++) {
        const n = i * 7 + k, len = (1.5 + 2 * rnd(n)) * u, cx = rnd(n + 0.3) * w + Math.sin(t / 5000 + n) * 0.5 * u, y = yW + (0.15 + 0.7 * rnd(n + 0.6)) * lh;
        ctx.globalAlpha = 0.18 + 0.14 * Math.sin(t / 3200 + n * 2.1);
        ctx.beginPath();
        ctx.moveTo(cx - len / 2, y);
        ctx.quadraticCurveTo(cx, y - 0.07 * u, cx + len / 2, y);
        ctx.stroke();
      }
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
    drawLadder(g, 0.1 * w, c);
    drawLadder(g, 0.9 * w, c);

    // Lanes from the back wall forwards: the rope behind a lane, then its swimmer, so nearer things cover further ones
    const swimmers = Array.from({ length: lanes }, (_, i) => swimmerAt(g, i, t));
    for (let i = 0; i < lanes; i++) {
      if (i) drawRope(g, yW + i * lh, t, c, i, swimmers);
      drawSwimmer(g, swimmers[i], t, c);
    }
    drawTaps(g, t, c);
    ctx.fillStyle = c.ripple;
    for (const d of S.drops) {
      ctx.globalAlpha = Math.min(1, (d.life / d.max) * 1.6);
      blob(ctx, d.x, d.y, d.r);
    }
    ctx.globalAlpha = 1;
    drawGlints(g, t, c);
    drawVignette(g, c);
  }

  function loop(t: number) {
    S.t0 ??= t; // the opening dive starts on the first animated frame
    step(t);
    draw(t);
    S.raf = requestAnimationFrame(loop);
  }
  function restart() {
    cancelAnimationFrame(S.raf);
    S.raf = 0;
    S.last = 0;
    if (settings.waterMoves() && S.onScreen) S.raf = requestAnimationFrame(loop);
    else draw(performance.now());
  }
  /** Re-reads the theme's colours and starts or stops the water to match the settings. */
  function update() {
    const { c, levels } = readPoolColors();
    S.c = c;
    S.lv = levels;
    S.caustics = causticPattern(ctx, c.light);
    restart();
  }

  // Touch the water: moving over it leaves small ripples, a click or tap makes a splash
  function touch(e: PointerEvent, big: boolean) {
    if (!S.raf) return; // not while paused or with reduced motion
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, g = geometry(), now = performance.now();
    if (y < g.yW + 4) return;
    const last = S.taps[S.taps.length - 1];
    if (!big && last && now - last.t < 90 && Math.hypot(x - last.x, y - last.y) < 0.6 * g.u) return;
    if (S.taps.length > 40) S.taps.shift();
    S.taps.push({ x, y, t: now, big });
    if (big) spray(x, y, 14, g.u, 2.6, 0);
  }
  const onMove = (e: PointerEvent) => touch(e, false);
  const onDown = (e: PointerEvent) => touch(e, true);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onDown);

  const seen = new IntersectionObserver(([e]) => {
    S.onScreen = e.isIntersecting;
    restart();
  });
  seen.observe(canvas);
  const resized = new ResizeObserver(() => {
    size();
    if (!S.raf) draw(performance.now());
  });
  resized.observe(canvas);
  document.fonts.ready.then(() => {
    if (!S.raf) draw(performance.now());
  });

  size();
  update();

  return {
    update,
    destroy() {
      cancelAnimationFrame(S.raf);
      S.raf = 0;
      seen.disconnect();
      resized.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
    },
  };
}
