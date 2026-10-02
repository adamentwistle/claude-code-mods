// Shared drawing pieces: palettes, glyphs, the cell and pixel frame, and color math.

export const INTENSITY = { soft: 0.6, bright: 0.85, vivid: 1 };

export const DEFAULT_COLOR = 0x01000000;
export const BLANK = 0x20;

// Mirrors the themes ccs-theme switches between (claude-rig/claude/bin/ccs-theme).
export const PALETTES = {
  nightshade: { bg: 0x24222c, fg: 0xe8e6ef, a: 0x76ea6a, b: 0xa17af2, c: 0x7de8e1, warn: 0xf2d57f, bad: 0xff7b75 },
  "rose-pine": { bg: 0x191724, fg: 0xe0def4, a: 0x9ccfd8, b: 0xc4a7e7, c: 0xebbcba, warn: 0xf6c177, bad: 0xeb6f92 },
  "kanagawa-wave": { bg: 0x1f1f28, fg: 0xdcd7ba, a: 0x7e9cd8, b: 0x957fb8, c: 0x7fb4ca, warn: 0xe6c384, bad: 0xff5d62 },
  "kanagawa-dragon": { bg: 0x181616, fg: 0xc5c9c5, a: 0x87a987, b: 0x8992a7, c: 0x8ea4a2, warn: 0xe6c384, bad: 0xe46876 },
  "catppuccin-mocha": { bg: 0x1e1e2e, fg: 0xcdd6f4, a: 0xa6e3a1, b: 0xcba6f7, c: 0x89dceb, warn: 0xfab387, bad: 0xf38ba8 },
  "catppuccin-latte": { bg: 0xeff1f5, fg: 0x4c4f69, a: 0x40a02b, b: 0x8839ef, c: 0x04a5e5, warn: 0xdf8e1d, bad: 0xd20f39 },
  dusk: { bg: 0x1a1b26, fg: 0xc0caf5, a: 0x7dcfff, b: 0xbb9af7, c: 0x73daca, warn: 0xe0af68, bad: 0xf7768e },
};
export const FALLBACK = "dusk";

// The network style always wears the Nightshade theme's own colors.
export const MESH = { bg: 0x24222c, fg: 0xe8e6ef, dim: 0x736d82, green: 0x76ea6a, green2: 0x5fcf55, purple: 0xa17af2, lilac: 0xb995ff, cyan: 0x7de8e1, blue: 0x8bbcff, yellow: 0xf2d57f, red: 0xff7b75 };

// The critter's orange.
export const CLAWD = 0xd77757;
export const CLAWD_KID = 0xeba487;

export const EFFORT = { low: 0.1, medium: 0.35, high: 0.6, xhigh: 0.8, max: 1 };
export const CONFIRM_TIME = 1.4;
export const CELEBRATE_TIME = 1.8;
export const TRIP_TIME = 0.9;

export const WAVE = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"].map(cp);
export const SPARK_MAIN = ["⠂", "⠒", "⠖", "⠶"].map(cp);
export const SPARK_SUB = ["⠁", "⠂"].map(cp);
export const INK = ["⠁", "⠃", "⠇", "⠏", "⠟", "⠿"].map(cp);
export const PULSE_HEAD = cp("━");
export const PULSE_TRAIL = cp("─");
export const HORIZON = cp("▁");
export const UPPER = cp("▀");
export const LOWER = cp("▄");
// Quadrant glyphs by bits: 1 upper left, 2 upper right, 4 lower left, 8 lower right.
export const QUAD = [" ", "▘", "▝", "▀", "▖", "▌", "▞", "▛", "▗", "▚", "▐", "▜", "▄", "▙", "▟", "█"].map(cp);

export function cp(c) {
  return c.codePointAt(0);
}

export class Frame {
  constructor(columns, rows, look) {
    this.columns = columns;
    this.rows = rows;
    this.W = columns;
    this.H = rows * 2;
    this.pal = look.palette;
    this.k = look.intensity;
    const n = columns * rows;
    this.glyph = new Uint32Array(n);
    this.fg = new Uint32Array(n).fill(DEFAULT_COLOR);
    this.bg = new Uint32Array(n).fill(DEFAULT_COLOR);
    this.px = new Int32Array(this.W * this.H).fill(-1);
    this.quad = new Uint8Array(n);
    this.quadColor = new Uint32Array(n);
  }

  // A half-block pixel (W x 2*rows grid); -1 leaves the terminal's background.
  dot(x, y, color) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    this.px[y * this.W + x] = color;
  }

  // Adds light to a pixel, over the background color.
  glow(x, y, color, amount) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.W || y >= this.H || amount <= 0.02) return;
    const i = y * this.W + x;
    const under = this.px[i] < 0 ? this.pal.bg : this.px[i];
    this.px[i] = add(under, color, amount);
  }

  // Blends a pixel toward a color, over the background color when empty.
  tint(x, y, color, amount) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.W || y >= this.H || amount <= 0.02) return;
    const i = y * this.W + x;
    this.px[i] = mix(this.px[i] < 0 ? this.pal.bg : this.px[i], color, amount);
  }

  getPx(x, y) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return 0;
    return this.px[y * this.W + x];
  }

  // A quadrant pixel (2W x 2*rows grid), one color per cell.
  q(x, y, color) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.W * 2 || y >= this.H) return;
    const i = (y >> 1) * this.columns + (x >> 1);
    this.quad[i] |= 1 << ((y & 1) * 2 + (x & 1));
    this.quadColor[i] = color;
  }

  // A whole cell's glyph; wins over pixels.
  cell(cx, cy, glyph, fg, bg) {
    cx = Math.round(cx);
    cy = Math.round(cy);
    if (cx < 0 || cy < 0 || cx >= this.columns || cy >= this.rows) return;
    const i = cy * this.columns + cx;
    this.glyph[i] = glyph;
    this.fg[i] = fg;
    if (bg !== undefined) this.bg[i] = bg;
  }

  hasCell(cx, cy) {
    return this.glyph[cy * this.columns + cx] !== 0 || this.quad[cy * this.columns + cx] !== 0;
  }

  resolve() {
    const { columns, rows } = this;
    for (let cy = 0; cy < rows; cy += 1) {
      for (let cx = 0; cx < columns; cx += 1) {
        const i = cy * columns + cx;
        const top = this.px[cy * 2 * this.W + cx];
        const bottom = this.px[(cy * 2 + 1) * this.W + cx];
        if (this.glyph[i] !== 0) {
          if (this.bg[i] === DEFAULT_COLOR && (top >= 0 || bottom >= 0)) this.bg[i] = quantize(top >= 0 ? top : bottom);
          continue;
        }
        if (this.quad[i] !== 0) {
          this.glyph[i] = QUAD[this.quad[i]];
          this.fg[i] = this.quadColor[i];
          continue;
        }
        if (top < 0 && bottom < 0) {
          this.glyph[i] = BLANK;
        } else if (bottom < 0) {
          this.glyph[i] = UPPER;
          this.fg[i] = quantize(top);
        } else if (top < 0) {
          this.glyph[i] = LOWER;
          this.fg[i] = quantize(bottom);
        } else {
          this.glyph[i] = UPPER;
          this.fg[i] = quantize(top);
          this.bg[i] = quantize(bottom);
        }
      }
    }
    return { columns, rows, glyph: this.glyph, fg: this.fg, bg: this.bg };
  }
}

export function flareBackground(s, f) {
  if (s.flare <= 0) return;
  const spread = 0.12 + (1 - s.flare) * 0.5;
  for (let x = 0; x < f.columns; x += 1) {
    const d = ((x + 0.5) / f.columns - s.flareX) / spread;
    const a = s.flare * Math.exp(-d * d) * 0.6;
    if (a < 0.03) continue;
    for (let r = 0; r < f.rows; r += 1) {
      const i = r * f.columns + x;
      f.bg[i] = mix(f.pal.bg, f.pal.bad, a);
    }
  }
}


export function horizonLine(s, f, color) {
  if (s.horizon === null) return;
  const fillTo = Math.round(s.horizon * f.W);
  const y = f.H - 1;
  for (let x = 0; x < fillTo; x += 1) if (f.getPx(x, y) < 0) f.dot(x, y, mix(f.pal.bg, color, 0.28));
}

// ---- Helpers -----------------------------------------------------------------------

export function line(x0, y0, x1, y1, plot) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= n; i += 1) plot(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
}

export function modeColor(s, pal) {
  let c = s.mode === "thinking" ? pal.b : pal.a;
  if (s.lean) c = mix(c, pal[s.lean], 0.2);
  return mix(c, pal.fg, s.tint * 0.3);
}

export function mix(c1, c2, f) {
  const k = clamp01(f);
  const r = ((c1 >> 16) & 255) + (((c2 >> 16) & 255) - ((c1 >> 16) & 255)) * k;
  const g = ((c1 >> 8) & 255) + (((c2 >> 8) & 255) - ((c1 >> 8) & 255)) * k;
  const b = (c1 & 255) + ((c2 & 255) - (c1 & 255)) * k;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

export function add(c1, c2, f) {
  const k = clamp01(f);
  const r = Math.min(255, ((c1 >> 16) & 255) + ((c2 >> 16) & 255) * k);
  const g = Math.min(255, ((c1 >> 8) & 255) + ((c2 >> 8) & 255) * k);
  const b = Math.min(255, (c1 & 255) + (c2 & 255) * k);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

// Fewer distinct colors keeps the terminal's color pairs in budget.
export function quantize(c) {
  return c & 0xf8f8f8;
}

export function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

export function clampInt(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toBase64(bytes) {
  if (typeof bytes.toBase64 === "function") return bytes.toBase64();
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const v = bytes[i] << 16;
    out += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + "==";
  } else if (rest === 2) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + "=";
  }
  return out;
}
