// warp: a hyperspace starfield; streaks stretch with the stream, and a completed
// turn is a jump flash.

import { CONFIRM_TIME, clamp01, line, mix } from "../lib.mjs";


function spawn(star, far) {
  // Wide in x so the field fills a strip far wider than it is tall.
  star.x = (Math.random() * 2 - 1) * 3.2;
  star.y = (Math.random() * 2 - 1) * 1.2;
  star.z = far ? 1 : 0.15 + Math.random() * 0.85;
  star.pz = star.z;
  star.hue = Math.random();
}

function stars(s) {
  // Sparse enough that each streak reads on its own: about one star per 9 pixels.
  const count = s.warpDims ? Math.max(24, Math.min(160, Math.round((s.warpDims.W * s.warpDims.H) / 9))) : 60;
  if (!s.warpStars || s.warpStars.length !== count) {
    s.warpStars = Array.from({ length: count }, () => {
      const star = {};
      spawn(star, false);
      return star;
    });
  }
  return s.warpStars;
}

function speedOf(s) {
  const jump = s.confirmAge < CONFIRM_TIME ? Math.max(0, 1 - s.confirmAge / 0.9) : 0;
  const tool = s.tools.size > 0 ? 0.25 : 0;
  return (0.06 + 1.3 * Math.max(s.flow, s.flowSub * 0.6) + tool + 3 * jump) * s.glow;
}

export function stepWarp(s, dt) {
  const v = speedOf(s);
  for (const star of stars(s)) {
    star.pz = star.z;
    star.z -= v * dt;
    // Gone past the edge of the strip, or past the viewer: start again far away.
    const off = s.warpDims && Math.abs((star.x / star.z) * s.warpDims.W * 0.16) > s.warpDims.W * 0.55;
    if (star.z <= 0.04 || off) spawn(star, true);
  }
}

export function drawWarp(s, f) {
  const { W, H, pal, k } = f;
  const live = 0.35 + 0.65 * s.glow;
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  s.warpDims = { W, H };
  const v = speedOf(s);
  const think = s.mode === "thinking";
  const tool = s.tools.size > 0;
  const cool = think ? pal.b : pal.c ?? pal.fg;
  const proj = (x, y, z) => [cx + (x / z) * W * 0.16, cy + (y / z) * H * 0.42];

  // A faint tunnel glow at the centre, stronger at speed.
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const d = Math.hypot((x - cx) / (W * 0.22), (y - cy) / (H * 0.9));
      if (d < 1) f.glow(x, y, think ? pal.b : 0x3a4cff, (1 - d) ** 2 * (0.08 + 0.35 * clamp01(v)) * live);
    }
  }

  for (const star of stars(s)) {
    const [x1, y1] = proj(star.x, star.y, star.z);
    if (x1 < -2 || x1 > W + 1 || y1 < -1 || y1 > H) continue;
    const near = clamp01(1.15 - star.z);
    let color = mix(pal.fg, cool, 0.35 + 0.4 * star.hue);
    if (tool) color = mix(color, pal.warn, 0.55);
    if (s.flare > 0) color = mix(color, pal.bad, s.flare);
    const bright = (0.12 + 0.88 * near * near) * live * (0.75 + 0.25 * k);
    // Streak from where the star was a moment ago; longer the faster we go.
    const back = Math.min(1, star.z + v * 0.18 + 0.004);
    const [x0, y0] = proj(star.x, star.y, back);
    const len = Math.max(1, Math.hypot(x1 - x0, y1 - y0));
    let i = 0;
    line(x0, y0, x1, y1, (x, y) => {
      i += 1;
      f.glow(x, y, color, bright * (0.15 + 0.85 * (i / (len + 1))));
    });
    f.glow(x1, y1, mix(color, 0xffffff, 0.4), bright);
  }

  // The jump: a white flash from the centre that fades out.
  if (s.confirmAge < 0.6) {
    const a = 1 - s.confirmAge / 0.6;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const d = Math.abs(x - cx) / (W * 0.5);
        f.tint(x, y, 0xffffff, a * a * (0.85 - 0.6 * d));
      }
    }
  }
}
