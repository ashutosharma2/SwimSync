// Behind the cards: the same pool seen from above.
//
// The floor scrolls at 60% of the page's speed, so the cards seem to float above it. Bubbles and
// ripples are kept in page coordinates, so they move with the cards. It's drawn at 1x pixel density
// and about 30 frames a second, because it's soft and mostly covered.

import { settings } from "../settings";
import { blob, capsule, causticPattern, mix, readPoolColors, rnd, smoothShape, type PoolColors, type PoolLevels } from "./draw";
import { STROKE_MS } from "./header";

const FLOOR_LANE = 240, PARALLAX = 0.6, TILE = 44;

type Bubble = { x: number; y: number; r: number; ph: number; born: number };
type Ring = { x: number; y: number; t: number };

// A swimmer's shadow seen from above, painted solid on a small canvas, head at (290, 80) facing right.
// It's then drawn onto the floor blurred and see-through, so overlapping parts don't double up.
const shadowCanvas = document.createElement("canvas");
shadowCanvas.width = 380;
shadowCanvas.height = 160;
function shadowSwimmer(strokes: number, t: number, color: string) {
  const x = shadowCanvas.getContext("2d")!;
  x.clearRect(0, 0, 380, 160);
  x.save();
  x.translate(290, 80);
  x.fillStyle = color;
  x.beginPath();
  x.ellipse(8, 0, 15, 13, 0, 0, Math.PI * 2); // head
  x.fill();
  smoothShape(x, [[-10, -18], [-30, -25], [-60, -21], [-90, -15], [-112, -16], [-125, -9], [-125, 9], [-112, 16], [-90, 15], [-60, 21], [-30, 25], [-10, 18]]);
  for (const side of [-1, 1]) {
    capsule(x, [-118, side * 7], [-205, side * (9 + 3 * Math.sin(t / 130 + side))], 8, 5); // legs, kicking
    const p = (((strokes + (side > 0 ? 0.5 : 0)) % 1) + 1) % 1, sh: [number, number] = [-24, side * 21];
    let h: [number, number], out: number;
    if (p < 0.15) {
      h = [80, side * 12]; // stretched forward
      out = 4;
    } else if (p < 0.6) {
      const q = (p - 0.15) / 0.45; // pulling back under the body
      h = [80 - 185 * q, side * (12 - 6 * Math.sin(Math.PI * q))];
      out = 4;
    } else {
      const q = (p - 0.6) / 0.4; // swinging forward out to the side
      h = [-105 + 185 * q, side * (14 + 40 * Math.sin(Math.PI * q))];
      out = 6 + 18 * Math.sin(Math.PI * q);
    }
    const e: [number, number] = [(sh[0] + h[0]) / 2, (sh[1] + h[1]) / 2 + side * out];
    capsule(x, sh, e, 8, 6);
    capsule(x, e, h, 6, 5);
  }
  x.restore();
  return shadowCanvas;
}

interface Floor {
  update(): void;
  bubblesBeside(el: Element, n: number, spread: number): void;
  ringFrom(el: Element): void;
  destroy(): void;
}
let active: Floor | null = null;

export function createPoolFloor(canvas: HTMLCanvasElement): Floor {
  const ctx = canvas.getContext("2d")!;
  const S = {
    w: 0, h: 0, raf: 0, last: 0, drawn: 0, dirty: false, pending: 0,
    bubbles: [] as Bubble[], rings: [] as Ring[],
    c: {} as PoolColors, lv: { glow: 1, vig: 1, shadowA: 0.2 } as PoolLevels,
    caustics: null as CanvasPattern | null,
  };

  function size() {
    S.w = canvas.width = innerWidth;
    S.h = canvas.height = innerHeight;
  }

  function draw(t: number) {
    const { w, h, c } = S, top = scrollY * PARALLAX; // where the window is on the floor
    const depth = Math.min(1, scrollY / Math.max(1, document.documentElement.scrollHeight - h));
    const bg = ctx.createLinearGradient(0, 0, 0, h); // deeper colour further down the page
    bg.addColorStop(0, mix(c.floor, c["floor-deep"], depth * 0.5));
    bg.addColorStop(1, mix(c.floor, c["floor-deep"], 0.5 + depth * 0.5));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = c["tile-line"]; // tiles
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = (w / 2) % TILE; x < w; x += TILE) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, h);
    }
    for (let y = -(top % TILE); y < h; y += TILE) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
    }
    ctx.stroke();

    const first = Math.max(0, Math.floor(top / FLOOR_LANE) - 1), last = Math.ceil((top + h) / FLOOR_LANE);
    ctx.fillStyle = c.mark; // the lane lines, a T at each end
    for (let k = first; k <= last; k++) {
      const y = FLOOR_LANE * (k + 0.5) - top, x0 = 0.05 * w, x1 = 0.95 * w;
      ctx.fillRect(x0, y - 8, x1 - x0, 16);
      ctx.fillRect(x0, y - 45, 16, 90);
      ctx.fillRect(x1 - 16, y - 45, 16, 90);
    }

    if (S.caustics) {
      // light on the floor, the same tile as the header
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = S.caustics;
      for (const [sc, vx, vy, a] of [[1.3, 0.01, 0.006, 0.12], [1.75, -0.008, 0.007, 0.08]]) {
        const span = 200 * sc, ox = (t * vx) % span, oy = (t * vy - top) % span;
        ctx.save();
        ctx.translate(ox, oy);
        ctx.scale(sc, sc);
        ctx.globalAlpha = a * S.lv.glow;
        ctx.fillRect(-ox / sc - 200, -oy / sc - 200, w / sc + 400, h / sc + 400);
        ctx.restore();
      }
      ctx.restore();
    }

    // Swimmers passing overhead: every so often a shadow glides along a lane, one way then the other
    for (let k = first; k <= last; k++) {
      const P = 30000 + rnd(k + 500) * 20000, speed = 0.1, cross = (w + 500) / speed, tt = t + rnd(k + 510) * P, n = Math.floor(tt / P), tau = tt - n * P;
      if (tau >= cross) continue;
      const dir = n % 2 ? -1 : 1, x = dir > 0 ? -250 + speed * tau : w + 250 - speed * tau;
      ctx.save();
      ctx.translate(x, FLOOR_LANE * (k + 0.5) - top - 34);
      ctx.scale(1.35 * dir, 1.35);
      ctx.filter = "blur(3px)";
      ctx.globalAlpha = S.lv.shadowA;
      ctx.drawImage(shadowSwimmer(tt / STROKE_MS, t, c.shade), -290, -80);
      ctx.restore();
    }

    ctx.lineWidth = 3; // ripples from capacity changes
    for (const r of S.rings) {
      const a = (t - r.t) / 2600, rad = a * Math.max(w, h) * 0.8, y = r.y - scrollY;
      if (a <= 0 || a >= 1) continue;
      ctx.strokeStyle = c.shade;
      ctx.globalAlpha = 0.12 * (1 - a) ** 2;
      ctx.beginPath();
      ctx.arc(r.x, y, Math.max(0, rad - 5), 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = c.light;
      ctx.globalAlpha = 0.5 * (1 - a) ** 2;
      ctx.beginPath();
      ctx.arc(r.x, y, rad, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    for (const b of S.bubbles) {
      if (b.born > t) continue;
      const x = b.x + Math.sin(b.ph + t / 400) * 1.5, y = b.y - scrollY;
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = c.light;
      ctx.beginPath();
      ctx.arc(x, y, b.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = c.light;
      ctx.fill();
      ctx.globalAlpha = 0.8;
      blob(ctx, x - b.r * 0.35, y - b.r * 0.35, b.r * 0.3);
    }
    ctx.globalAlpha = 1;
  }
  function step(t: number) {
    const dt = S.last ? Math.min(0.1, (t - S.last) / 1000) : 0;
    S.last = t;
    if (Math.random() < dt * 1.5 && S.bubbles.length < 250)
      // now and then one rises from below
      S.bubbles.push({ x: Math.random() * S.w, y: scrollY + S.h + 10, r: 1.5 + Math.random() * 4, ph: Math.random() * 6, born: 0 });
    for (const b of S.bubbles) if (b.born <= t) b.y -= (25 + 12 * b.r) * dt;
    S.bubbles = S.bubbles.filter((b) => b.y - scrollY > -20);
    S.rings = S.rings.filter((r) => t - r.t < 2600);
  }
  function loop(t: number) {
    if (S.dirty || t - S.drawn >= 32) {
      step(t);
      draw(t);
      S.drawn = t;
      S.dirty = false;
    }
    S.raf = requestAnimationFrame(loop);
  }
  function restart() {
    cancelAnimationFrame(S.raf);
    S.raf = 0;
    S.last = 0;
    if (settings.waterMoves()) S.raf = requestAnimationFrame(loop);
    else draw(performance.now());
  }
  function update() {
    const { c, levels } = readPoolColors();
    S.c = c;
    S.lv = levels;
    S.caustics = causticPattern(ctx, c.light);
    restart();
  }

  const onScroll = () => {
    if (S.raf) S.dirty = true;
    else if (!S.pending)
      S.pending = requestAnimationFrame(() => {
        S.pending = 0;
        draw(performance.now());
      });
  };
  const onResize = () => {
    size();
    if (!S.raf) draw(performance.now());
  };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onResize);
  size();
  update();

  const floor: Floor = {
    update,
    /** Bubbles rising beside the panel that holds el, spread over `spread` ms. */
    bubblesBeside(el: Element, n: number, spread: number) {
      if (!S.raf) return; // no motion while paused or with reduced motion
      const r = el.getBoundingClientRect(), p = (el.closest(".panel") ?? el).getBoundingClientRect(), now = performance.now();
      for (let k = 0; k < n && S.bubbles.length < 250; k++) {
        const x = k % 2 ? p.right + 4 + Math.random() * 10 : p.left - 4 - Math.random() * 10;
        S.bubbles.push({ x, y: r.top + Math.random() * r.height + scrollY, r: 1.5 + Math.random() * 4, ph: Math.random() * 6, born: now + Math.random() * spread });
      }
    },
    /** A ripple spreading out across the floor from the middle of el. */
    ringFrom(el: Element) {
      if (!S.raf) return;
      const r = el.getBoundingClientRect();
      S.rings.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 + scrollY, t: performance.now() });
    },
    destroy() {
      cancelAnimationFrame(S.raf);
      cancelAnimationFrame(S.pending);
      S.raf = 0;
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onResize);
      if (active === floor) active = null;
    },
  };
  active = floor;
  return floor;
}

// The pool answers the app. These do nothing if no floor is showing.
export const bubblesBeside = (el: Element | null, n = 22, spread = 500) => el && active?.bubblesBeside(el, n, spread);
export const ringFrom = (el: Element | null) => el && active?.ringFrom(el);
