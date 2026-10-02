// aurora: curtains of light drifting over a sparse starfield.

import {
  B64,
  BLANK,
  CELEBRATE_TIME,
  CLAWD,
  CLAWD_KID,
  CONFIRM_TIME,
  DEFAULT_COLOR,
  EFFORT,
  FALLBACK,
  Frame,
  HORIZON,
  INK,
  INTENSITY,
  LOWER,
  MESH,
  PALETTES,
  PULSE_HEAD,
  PULSE_TRAIL,
  QUAD,
  SPARK_MAIN,
  SPARK_SUB,
  TRIP_TIME,
  UPPER,
  WAVE,
  add,
  clamp01,
  clampInt,
  cp,
  flareBackground,
  hash,
  horizonLine,
  line,
  mix,
  modeColor,
  quantize,
  toBase64,
} from "../lib.mjs";


export function drawAurora(s, f) {
  const { W, H, pal, k } = f;
  const live = 0.22 + 0.78 * s.glow;
  const energy = Math.max(s.flow, s.flowSub * 0.6);
  const t = s.at;
  // Bottom edge, body, crown: green to cyan to violet; thinking shifts it all toward violet.
  const thinking = s.mode === "thinking";
  const edgeC = mix(thinking ? pal.b : pal.a, pal.fg, 0.15 + s.tint * 0.15);
  const bodyC = thinking ? mix(pal.b, pal.bad, 0.35) : pal.c ?? pal.a;
  const crownC = thinking ? mix(pal.b, pal.bg, 0.2) : pal.b;
  const lit = new Float32Array(W * H);
  const rise = new Float32Array(W * H); // how far above the lower edge the light mostly is, 0..1

  // Two curtains, each a drifting patch with a wavy lower edge and light fading upward.
  for (let r = 0; r < 2; r += 1) {
    const ph = r * 2.7;
    for (let x = 0; x < W; x += 1) {
      const u = x / W;
      const patch = Math.max(0, Math.sin(u * (2.2 + r * 0.9) * Math.PI - t * (0.12 + 0.05 * r) + ph));
      const reach = patch * patch;
      if (reach < 0.02) continue;
      const ray = 0.72 + 0.28 * Math.sin(u * (47 + 13 * r) + 2.2 * Math.sin(u * 7 + t * 0.4 + ph) + t * 0.8);
      const edge = (H - 1) * (0.78 - 0.12 * r + 0.14 * Math.sin(u * 6.5 + t * 0.35 + ph));
      const fall = H * (0.42 + 0.3 * energy + 0.08 * r);
      for (let y = 0; y < H; y += 1) {
        const above = edge - y;
        const a = above >= 0 ? Math.exp(-above / fall) : Math.exp(-((above / 0.7) ** 2));
        const i = y * W + x;
        const add = a * reach * ray * (r === 0 ? 1 : 0.8);
        if (add > 0) rise[i] = (rise[i] * lit[i] + clamp01(above / (fall * 2)) * add) / (lit[i] + add);
        lit[i] = 1 - (1 - lit[i]) * (1 - add);
      }
    }
  }

  // Sparse twinkling stars, only where the sky is dark.
  const stars = Math.max(3, Math.round((W * H) / 70));
  for (let i = 0; i < stars; i += 1) {
    const x = Math.floor(hash(i * 2.3) * W);
    const y = Math.floor(hash(i * 4.1) * H);
    const tw = 0.5 + 0.5 * Math.sin(s.t * (1.5 + hash(i) * 3) + i * 1.7);
    if (lit[y * W + x] < 0.15) f.dot(x, y, mix(pal.bg, pal.fg, (0.2 + 0.55 * tw * tw) * (0.5 + 0.5 * live) * k));
  }

  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const h = rise[y * W + x];
      const ramp = h < 0.35 ? mix(edgeC, bodyC, h / 0.35) : mix(bodyC, crownC, (h - 0.35) / 0.65);
      const l = lit[y * W + x];
      const a = Math.min(1, l * live * (1.15 + 0.5 * energy) * (0.8 + 0.3 * k));
      if (a > 0.07) f.dot(x, y, mix(pal.bg, l > 0.85 ? mix(ramp, pal.fg, (l - 0.85) * 2) : ramp, a));
    }
  }

  // A tool call is a soft pillar of light gliding across; a failure, a red one.
  for (const sh of s.shocks) {
    const color = sh.color === "bad" ? pal.bad : pal.warn;
    const cx = sh.x * W;
    for (let x = Math.floor(cx - 6); x <= cx + 6; x += 1) {
      const d = (x - cx) / 2.4;
      const a = Math.exp(-d * d) * sh.life * (0.55 + 0.35 * k);
      if (a < 0.04) continue;
      for (let y = 0; y < H; y += 1) {
        const height = H === 1 ? 1 : y / (H - 1);
        f.tint(x, y, color, a * (0.35 + 0.65 * height));
      }
    }
  }
  if (s.flare > 0) for (let x = 0; x < W; x += 1) for (let y = 0; y < H; y += 1) if (f.getPx(x, y) >= 0) f.tint(x, y, pal.bad, s.flare * 0.25);

  horizonLine(s, f, pal.fg);
}

