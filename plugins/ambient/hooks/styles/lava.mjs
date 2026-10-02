// lava: slow liquid blobs of colour, like a lava lamp laid on its side. They speed
// up and merge with the stream, a tool call bubbles a new blob up from below.

import { CONFIRM_TIME, clamp01, mix } from "../lib.mjs";

function blobs(s) {
  if (!s.lava) {
    s.lava = Array.from({ length: 6 }, (_, i) => ({
      x: (i + 0.5) / 6 + (Math.random() - 0.5) * 0.08,
      y: Math.random(),
      r: 0.55 + Math.random() * 0.4,
      fx: 0.05 + Math.random() * 0.08,
      fy: 0.25 + Math.random() * 0.3,
      ph: Math.random() * 6.28,
      life: Infinity,
    }));
    s.lavaT = 0;
  }
  return s.lava;
}

export function stepLava(s, dt) {
  const list = blobs(s);
  s.lavaT += dt * (0.25 + 1.6 * Math.max(s.flow, s.flowSub * 0.6) + (s.tools.size ? 0.3 : 0)) * s.glow;
  for (const b of s.bursts) {
    if (b.lava) continue;
    b.lava = true;
    list.push({ x: 0.1 + Math.random() * 0.8, y: 1.3, r: 0.45, fx: 0.02, fy: 0, ph: 0, life: 2.5, rise: true, color: b.color });
  }
  for (const b of list) {
    if (b.rise) {
      b.y -= dt * 0.9;
      b.life -= dt;
    }
  }
  s.lava = list.filter((b) => b.life > 0);
}

export function lavaSettled(s) {
  return !s.lava || s.lava.every((b) => !b.rise);
}

export function drawLava(s, f) {
  const { W, H, pal, k } = f;
  const list = blobs(s);
  const live = 0.45 + 0.55 * s.glow;
  const t = s.lavaT;
  const think = s.mode === "thinking";
  const fresh = s.confirmAge < CONFIRM_TIME ? 1 - s.confirmAge / CONFIRM_TIME : 0;
  // Rim, body and core: deep magenta to orange to gold while writing; violet to cyan while thinking.
  const rim = mix(think ? pal.b : mix(pal.bad, pal.b, 0.35), pal.bg, 0.35);
  const body = think ? pal.b : mix(pal.warn, pal.bad, 0.55);
  const core = think ? mix(pal.c ?? pal.a, pal.fg, 0.15) : mix(pal.warn, 0xffe7a3, 0.5);
  const placed = list.map((b) => ({
    x: (b.rise ? b.x : b.x + 0.06 * Math.sin(t * b.fx * 6 + b.ph)) * W,
    y: (b.rise ? b.y : 0.5 + 0.5 * Math.sin(t * b.fy + b.ph)) * H,
    // Reach of the blob's pull, in rows; columns count 2.2 to a row.
    reach: Math.max(1.6, b.r * H * 0.62) * (0.9 + 0.12 * Math.sin(t * 0.7 + b.ph)),
    tool: Boolean(b.color),
  }));
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let field = 0;
      let tool = 0;
      for (const b of placed) {
        const dx = (x - b.x) / 2.2;
        const dy = y + 0.5 - b.y;
        const q = 1 - (dx * dx + dy * dy) / (b.reach * b.reach);
        if (q <= 0) continue;
        const v = q * q;
        field += v;
        if (b.tool) tool += v;
      }
      if (field < 0.08) continue;
      let color;
      let a;
      if (field < 0.3) {
        // Warm light spilling just outside a blob.
        color = rim;
        a = (field - 0.08) * 0.9;
      } else {
        const inside = clamp01((field - 0.3) / 0.2);
        const depth = clamp01((field - 0.45) / 0.35);
        color = depth > 0 ? mix(body, core, depth) : mix(rim, body, inside);
        a = 0.55 + 0.4 * inside;
      }
      if (tool > 0.1) color = mix(color, pal.warn, clamp01(tool / field));
      if (s.flare > 0) color = mix(color, pal.bad, s.flare * 0.8);
      a = clamp01(a * live * (0.8 + 0.25 * k) + fresh * 0.3 * clamp01(field));
      if (a > 0.05) f.dot(x, y, mix(pal.bg, color, a));
    }
  }
}
