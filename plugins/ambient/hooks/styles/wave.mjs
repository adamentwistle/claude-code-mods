// wave: a low flowing wave with sparks, the original strip.

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


export function drawWave(s, f) {
  const { columns, rows, pal, k } = f;
  const base = pal.bg;
  const bottom = rows - 1;
  if (s.horizon !== null) {
    const fillTo = Math.round(s.horizon * columns);
    for (let x = 0; x < fillTo; x += 1) f.cell(x, bottom, HORIZON, mix(base, pal.fg, 0.22 * k + 0.05));
  }
  const color = modeColor(s, pal);
  if (s.glow > 0) {
    const amp = s.glow * (0.2 + 0.8 * Math.max(s.flow, s.flowSub * 0.6));
    const levels = Math.max(5, Math.round(rows * 8 * 0.8));
    for (let x = 0; x < columns; x += 1) {
      const h = amp * waveHeight(s.t, (x + 0.5) / columns);
      let level = Math.round(h * levels);
      const shade = mix(base, color, (0.35 + 0.65 * h) * k);
      for (let r = bottom; r >= 0 && level > 0; r -= 1) {
        f.cell(x, r, WAVE[Math.min(8, level) - 1], shade);
        level -= 8;
      }
    }
    const subColor = mix(pal.b, pal.fg, 0.4);
    for (const p of s.particles) {
      const x = clampInt(Math.floor(p.x * columns), 0, columns - 1);
      const r = Math.min(rows - 1, Math.floor(p.row * rows));
      const set = p.sub ? SPARK_SUB : SPARK_MAIN;
      f.cell(x, r, set[Math.min(set.length - 1, Math.floor(p.life * set.length))], mix(base, p.sub ? subColor : color, (0.45 + 0.55 * p.life) * s.glow * k));
    }
  }
  for (const p of s.pulses) {
    const head = Math.floor(p.x * columns);
    const trail = p.sub ? 4 : 9;
    const c = p.sub ? mix(pal.warn, pal.fg, 0.35) : pal.warn;
    for (let j = 0; j <= trail; j += 1) {
      const x = head - j;
      if (x >= 0 && x < columns) f.cell(x, bottom, j === 0 ? PULSE_HEAD : PULSE_TRAIL, mix(base, c, j === 0 ? 1 : 0.85 * (1 - j / (trail + 1)) * k));
    }
  }
  flareBackground(s, f);
}

function waveHeight(t, u) {
  const a = 0.5 + 0.5 * Math.sin(u * 11 + t * 2.1);
  const b = 0.6 + 0.4 * Math.sin(u * 29 - t * 3.3);
  const c = 0.75 + 0.25 * Math.sin(u * 5 - t * 0.9);
  return a * b * c;
}

