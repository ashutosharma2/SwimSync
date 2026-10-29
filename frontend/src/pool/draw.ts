// Drawing helpers shared by the pool header and the pool floor.

export type Pt = [number, number];

/** The pool's colours, read from the CSS variables of the current theme. */
export interface PoolColors {
  [name: string]: string;
}
export interface PoolLevels {
  glow: number; // how strong the light effects are (lower at night)
  vig: number; // how dark the edges get
  shadowA: number; // how dark a swimmer's shadow on the floor is
}

/** A repeatable pseudo-random number in [0, 1) for a given seed, so a scene looks the same every frame. */
export const rnd = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};
const hexRgb = (h: string) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
/** Mixes two #RRGGBB colours: f = 0 gives a, f = 1 gives b. */
export const mix = (a: string, b: string, f: number) =>
  "#" + hexRgb(a).map((v, k) => Math.round(v + (hexRgb(b)[k] - v) * f).toString(16).padStart(2, "0")).join("");
export const rgba = (hex: string, a: number) => `rgba(${hexRgb(hex).join(",")},${a})`;
/** The same rgba() colour, fully transparent: the far end of a fade. */
export const clear = (color: string) => color.replace(/[\d.]+\)$/, "0)");
export const lerp2 = (a: Pt, b: Pt, f: number): Pt => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
export const ease = (f: number) => f * f * (3 - 2 * f);

export function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
  ctx.fill();
}
export function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fill();
}
/** A limb: a tapered shape from a (radius r1) to b (radius r2). */
export function capsule(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, r1: number, r2: number) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  ctx.beginPath();
  ctx.moveTo(a[0] + nx * r1, a[1] + ny * r1);
  ctx.lineTo(b[0] + nx * r2, b[1] + ny * r2);
  ctx.lineTo(b[0] - nx * r2, b[1] - ny * r2);
  ctx.lineTo(a[0] - nx * r1, a[1] - ny * r1);
  ctx.closePath();
  ctx.fill();
  blob(ctx, a[0], a[1], r1);
  blob(ctx, b[0], b[1], r2);
}
/** A closed shape with rounded corners through the given points. */
export function smoothShape(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const n = pts.length;
  ctx.beginPath();
  ctx.moveTo(...mid(pts[n - 1], pts[0]));
  for (let k = 0; k < n; k++) ctx.quadraticCurveTo(pts[k][0], pts[k][1], ...mid(pts[k], pts[(k + 1) % n]));
  ctx.closePath();
  ctx.fill();
}

export function readPoolColors(): { c: PoolColors; levels: PoolLevels } {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  const c: PoolColors = {};
  for (const k of ["stand", "aisle", "seat", "seat-2", "steel", "clock-face", "clock-ink", "wall", "deck", "far", "near", "mark", "float", "float-2", "ripple", "light", "shade", "floor-deep", "tile-line"])
    c[k] = v("--pool-" + k);
  c.floor = v("--page");
  c.red = v("--red");
  c.pool = mix(c.far, c.near, 0.5);
  const levels = { glow: parseFloat(v("--pool-glow")), vig: parseFloat(v("--pool-vig")), shadowA: parseFloat(v("--pool-shadow-a")) };
  return { c, levels };
}

// Caustics: the bright net that rippling water focuses onto the pool floor. One tile is made once:
// brightness peaks along the borders between random cells (where the nearest and second-nearest
// points are equally far), and distances wrap around so the tile repeats without seams.
let causticMask: HTMLCanvasElement | null = null;
function makeCaustics(size: number) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const cx = cv.getContext("2d")!, img = cx.createImageData(size, size), pts: Pt[] = [];
  for (let k = 0; k < 18; k++) pts.push([rnd(k + 50) * size, rnd(k + 90) * size]);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let d1 = Infinity, d2 = Infinity;
      for (const [qx, qy] of pts) {
        let dx = Math.abs(x - qx), dy = Math.abs(y - qy);
        if (dx > size / 2) dx = size - dx;
        if (dy > size / 2) dy = size - dy;
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      const o = (y * size + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(255 * Math.max(0, 1 - (Math.sqrt(d2) - Math.sqrt(d1)) / 9) ** 2.6);
    }
  cx.putImageData(img, 0, 0);
  return cv;
}
/** The caustic tile in one colour, as a repeating pattern. */
export function causticPattern(ctx: CanvasRenderingContext2D, color: string) {
  causticMask ??= makeCaustics(200);
  const cv = document.createElement("canvas");
  cv.width = cv.height = 200;
  const x = cv.getContext("2d")!;
  x.drawImage(causticMask, 0, 0);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = color;
  x.fillRect(0, 0, 200, 200);
  return ctx.createPattern(cv, "repeat");
}
