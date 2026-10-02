// synthwave: a perspective neon grid racing toward a striped sun on the horizon.
// States show in the grid's colour, the sun's glow and how fast the road scrolls.

import { CONFIRM_TIME, clamp01, hash, mix } from "../lib.mjs";

const SKY_TOP = 0x12082a;
const SKY_LOW = 0x5a1a58;
const SUN_TOP = 0xffd34e;
const SUN_LOW = 0xff2a7a;
const MAGENTA = 0xff3d9a;
const VIOLET = 0x9a6bff;
const CYAN = 0x2de2e6;
const MOUNTAIN = 0x24113c;
const FLOOR = 0x0d0618;

export function stepSynthwave(s, dt) {
  const think = s.mode === "thinking" && s.tools.size === 0;
  s.road += dt * (think ? 0.3 : 0.6 + 3.2 * Math.max(s.flow, s.flowSub * 0.6)) * s.glow;
}

export function drawSynthwave(s, f) {
  const { W, H, pal, k } = f;
  const live = 0.45 + 0.55 * s.glow;
  const hy = Math.max(2, Math.round(H * 0.4));
  const depth = H - 1 - hy;
  const think = s.mode === "thinking" && s.tools.size === 0;
  const fresh = s.confirmAge < CONFIRM_TIME ? 1 - s.confirmAge / CONFIRM_TIME : 0;
  const put = (x, y, color, a) => f.dot(x, y, mix(pal.bg, color, clamp01(a * live * (0.8 + 0.25 * k))));
  let grid = s.tools.size > 0 ? CYAN : think ? VIOLET : MAGENTA;
  if (s.flare > 0) grid = mix(grid, pal.bad, s.flare);
  const vx = Math.round(W * 0.5);

  // Sky: deep violet down to magenta at the horizon.
  for (let y = 0; y < hy; y += 1) {
    const t = hy === 1 ? 1 : y / (hy - 1);
    for (let x = 0; x < W; x += 1) put(x, y, mix(SKY_TOP, think ? 0x35266e : SKY_LOW, t * t), 0.6 + 0.3 * t);
  }

  // Sun on the vanishing point, yellow to pink, cut by scanlines in its lower half.
  const r = Math.max(2.5, hy * 1.2);
  for (let y = Math.max(0, Math.floor(hy - r)); y < hy; y += 1) {
    const dy = hy - 0.5 - y;
    const half = Math.sqrt(Math.max(0, r * r - dy * dy)) * 1.6;
    const t = 1 - dy / r;
    if (t > 0.4 && (hy - y) % 2 === 1) continue;
    for (let x = Math.floor(vx - half); x <= vx + half; x += 1) put(x, y, mix(SUN_TOP, SUN_LOW, t), 1);
  }
  // Its glow; a finished turn flares it.
  for (let y = 0; y <= hy; y += 1) {
    for (let x = Math.floor(vx - r * 6); x <= vx + r * 6; x += 1) {
      const d = Math.hypot((x - vx) / (r * (3 + 2 * fresh)), (y - hy) / (r * 1.4));
      if (d < 1) f.glow(x, y, SUN_LOW, (0.14 + 0.45 * fresh) * (1 - d) * live);
    }
  }

  // A dark ridge on the horizon, low in front of the sun.
  for (let x = 0; x < W; x += 1) {
    const u = x / W;
    const ridge = (0.5 + 0.5 * Math.sin(u * 13 + 1.3)) * (0.5 + 0.5 * Math.sin(u * 5.1 + 0.4)) + 0.25 * hash(Math.floor(x / 3));
    const h = Math.round(ridge * (hy - 1) * 0.55 * clamp01(Math.abs(x - vx) / (r * 2.2)));
    for (let y = hy - h; y < hy; y += 1) put(x, y, MOUNTAIN, 1);
  }

  // The floor: dark, the grid drawn over it in single-pixel lines.
  for (let y = hy; y < H; y += 1) for (let x = 0; x < W; x += 1) put(x, y, FLOOR, 0.92);

  // Lines running back to a vanishing point behind the sun, fanning out toward the
  // viewer. Only lines steep enough to read as lines are drawn; in a strip this
  // wide the shallower ones would smear into stripes.
  // Far enough above the horizon that the steepest drawable lines still reach both edges.
  const lift = Math.max(depth * 2.5, Math.max(vx, W - vx) / 2.4 - depth);
  const spacing = Math.max(5, depth * 1.1);
  for (let kx = -30; kx <= 30; kx += 1) {
    const bx = vx + kx * spacing;
    const slope = Math.abs(bx - vx) / (lift + depth);
    if (slope > 2.4) continue;
    const x0 = vx + (bx - vx) * (lift / (lift + depth));
    const y0 = hy + 1;
    const y1 = H - 1;
    const steps = Math.ceil(Math.max(Math.abs(bx - x0), y1 - y0));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = Math.round(x0 + (bx - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      if (x < 0 || x >= W) continue;
      put(x, y, grid, 0.25 + 0.7 * ((y - hy) / depth));
    }
  }

  // Lines across, closer together toward the horizon, scrolling toward the viewer.
  const phase = s.road % 1;
  let last = H;
  for (let i = 0; i < 12; i += 1) {
    const d = i + 1 - phase;
    const y = Math.round(hy + depth / d);
    if (y >= H) continue;
    if (y <= hy || last - y < 2) break;
    last = y;
    for (let x = 0; x < W; x += 1) put(x, y, grid, 0.3 + 0.65 * clamp01(1.3 / d));
  }

  // The horizon: one bright line, whiter as the sun flares.
  for (let x = 0; x < W; x += 1) put(x, hy, mix(grid, 0xffffff, 0.2 + 0.5 * fresh), 0.9);
}
