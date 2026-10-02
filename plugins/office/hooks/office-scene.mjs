// Office: the scene painter. Lays out a room for every layout but `grid`
// (which office-model.mjs paints), builds its static background once per
// size, seating and time of day, and paints the animated sprites over it
// each frame. Pure: the pane and bin/office-monitor both call it.

import {
  BOLD_HEADS,
  BOLD_SMALL_HEADS,
  CLOTHES,
  CONFETTI,
  COOLER,
  FURS,
  HAIR_COLOURS,
  HAIRS,
  HEAD_BACKS,
  HEADS,
  MINION,
  MUG,
  PALETTES,
  PLANT,
  SKIN_TONES,
  SMALL_HAIRS,
  SMALL_HEADS,
  SMALL_MINION,
  SMALL_TORSO,
  TORSO,
  mix,
  skyAt,
} from "./office-art.mjs";
import { CHARACTER_KINDS, HOTKEYS, bubbleFor, hash, kindFor, layoutFor, paintWords, tagLines } from "./office-model.mjs";

const UPPER_HALF = 0x2580;
const OUTLINE = 0x1a1420;
const EYE = 0x17131c;
export { CHARACTER_KINDS, kindFor };

// ---- canvas ---------------------------------------------------------------

/** A pixel canvas two pixels per cell high, with text cells laid over it. */
export class Canvas {
  constructor(w, h, fill = 0) {
    this.w = w;
    this.h = h;
    this.px = new Uint32Array(w * h).fill(fill);
    this.glyphs = new Map();
    // 0 lit, towards 1 dark: what night does to everything not emissive.
    this.dark = 0;
    this.nightTint = 0x0a0c1e;
  }
  shade(c) {
    return this.dark > 0 ? mix(c, this.nightTint, this.dark) : c;
  }
  set(x, y, c, isEmissive = false) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || c == null) return;
    this.px[y * this.w + x] = isEmissive ? c : this.shade(c);
  }
  get(x, y) {
    x = Math.max(0, Math.min(this.w - 1, x | 0));
    y = Math.max(0, Math.min(this.h - 1, y | 0));
    return this.px[y * this.w + x];
  }
  // Mixes `c` into what is there: light, glow, shadow.
  tint(x, y, c, a) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = y * this.w + x;
    this.px[i] = mix(this.px[i], c, a);
  }
  rect(x, y, w, h, c, isEmissive = false) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c, isEmissive);
  }
  line(x0, y0, x1, y1, c, isEmissive = false) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= n; s++) this.set(Math.round(x0 + ((x1 - x0) * s) / n), Math.round(y0 + ((y1 - y0) * s) / n), c, isEmissive);
  }
  glow(cx, cy, r, c, a) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r * 1.4); x <= cx + r * 1.4; x++) {
        const d = Math.hypot((x - cx) / 1.4, y - cy) / r;
        if (d < 1) this.tint(x, y, c, a * (1 - d) * (1 - d));
      }
    }
  }
  /** Draws a palette-indexed map; `pal` maps a key to a colour. */
  sprite(map, x, y, pal, opts = {}) {
    for (let j = 0; j < map.length; j++) {
      const row = map[j];
      for (let i = 0; i < row.length; i++) {
        const k = row[opts.flip ? row.length - 1 - i : i];
        if (k === "." || k === " ") continue;
        const c = pal[k];
        if (c == null) continue;
        this.set(x + i, y + j, c, opts.isEmissive);
      }
    }
  }
  /** A character over a cell; `bg` absent takes the pixel beneath. */
  glyph(col, row, ch, fg, bg) {
    if (col < 0 || row < 0 || col >= this.w || row * 2 >= this.h) return;
    this.glyphs.set(row * this.w + col, { ch, fg, bg });
  }
  text(col, row, str, fg, bg) {
    for (let i = 0; i < str.length; i++) this.glyph(col + i, row, str[i], fg, bg);
  }
  copyFrom(other) {
    this.px.set(other.px);
    this.glyphs = new Map(other.glyphs);
  }
  /** `[codePoint, fg, bg]` per cell, row-major. */
  pack() {
    const rows = this.h >> 1;
    const W = this.w;
    const words = new Uint32Array(W * rows * 3);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < W; c++) {
        const at = (r * W + c) * 3;
        const g = this.glyphs.get(r * W + c);
        const top = this.px[2 * r * W + c];
        if (g) {
          words[at] = g.ch.codePointAt(0);
          words[at + 1] = g.fg;
          words[at + 2] = g.bg ?? mix(top, this.px[(2 * r + 1) * W + c], 0.5);
        } else {
          words[at] = UPPER_HALF;
          words[at + 1] = top;
          words[at + 2] = this.px[(2 * r + 1) * W + c];
        }
      }
    }
    return words;
  }
}

// ---- looks ------------------------------------------------------------------

/** A stable look per session: the same seed always draws the same person. */
export function lookFor(desk, characters, style) {
  const seed = hash(`look:${desk.sessionId || desk.paneId || desk.name}`);
  const kind = kindFor(desk, characters);
  const isBold = style !== "detailed";
  const pick = (list, shift) => list[(seed >>> shift) % list.length];
  return {
    kind,
    skin: pick(SKIN_TONES, 0),
    hair: pick(HAIR_COLOURS, 4),
    hairStyle: pick(Object.keys(HAIRS), 8),
    clothes: pick(CLOTHES, 12),
    fur: kind in FURS ? pick(FURS[kind], 16) : null,
    isBold,
  };
}

function palFor(look, status, isProcess) {
  const [cl, cs, ck] = look.clothes;
  const base = { o: OUTLINE, e: EYE, c: cl, C: cs, k: ck };
  switch (look.kind) {
    case "robot": {
      const visor = isProcess ? 0xffa53a : status === "blocked" ? 0xff4d4d : 0x5ee7ff;
      const body = isProcess ? [0xc0703a, 0x8f4f26, 0xdd925a] : [0x7d8494, 0x5b6170, 0x9aa1b0];
      return { ...base, m: 0xa9b0be, M: 0x6e7584, h: 0xd5dbe5, v: visor, V: 0xffffff, a: 0xff5c5c, s: 0xa9b0be, S: 0x6e7584, c: body[0], C: body[1], k: body[2] };
    }
    case "critter":
      return { ...base, q: 0xde7a4a, Q: 0xb35a30, s: 0xde7a4a, S: 0xb35a30, h: 0xf09a6a, c: 0xde7a4a, C: 0xb35a30, k: 0xf09a6a };
    case "cat":
    case "dog":
    case "owl": {
      const [f, d] = look.fur;
      return { ...base, F: f, D: d, W: f, p: 0xf0a0b4, n: 0x3a2a2a, m: 0x5a3030, y: 0xf2c94c, b: 0xe0a030, s: f, S: d, h: mix(f, 0xffffff, 0.25) };
    }
    default:
      return { ...base, s: look.skin[0], S: look.skin[1], h: look.skin[2], m: 0x9a4a4a, r: look.hair[0], R: look.hair[1] };
  }
}

// ---- time and light -----------------------------------------------------------

/** The hour the room is lit for: the clock, or noon/midnight when fixed. */
export function lightingHour(lighting, nowMs) {
  if (lighting === "day") return 12;
  if (lighting === "night") return 23;
  const d = new Date(nowMs);
  return d.getHours() + d.getMinutes() / 60;
}

function darknessAt(hour) {
  const sky = skyAt(hour);
  if (hour >= 7.5 && hour <= 17.5) return 0;
  if (sky.isNight) return 0.55;
  return 0.25;
}

// ---- plans --------------------------------------------------------------------

/**
 * Lays out a scene: where every desk sits, where its name tag goes, and the
 * key its background is cached under. `seats` is the desk list in seat order;
 * a `null` is an empty seat. `cols` x `rows` is the drawing size in cells.
 */
export function planScene(layout, seats, cols, rows, opts = {}) {
  const W = Math.max(20, Math.min(512, Math.floor(cols)));
  const Hrows = Math.max(6, Math.min(256, Math.floor(rows)));
  // A room needs some width; a narrow pane gets the grid instead.
  if (layout === "tiles") return planTiles(seats, W, Hrows, opts);
  if (layout === "grid" || ((layout === "office" || layout === "war-room") && W < 48)) return planGrid(seats, W, Hrows, opts);
  if (layout === "strip") return planStrip(seats, W, opts);
  const plan = planRoomScaled(layout === "war-room" ? planWarRoom : planOffice, seats, W, Hrows, opts);
  if (opts.hybrid) markHybrid(plan);
  // A Raster is at most 256 rows: past that the room is cut, tags with it.
  if (plan.rows > 256) {
    plan.rows = 256;
    plan.tags = plan.tags.filter((t) => t.top < 256);
  }
  return plan;
}

/**
 * The hybrid view: which desks get their person as a picture, and the box of
 * cells each picture covers, from the top of the chair to the desk top. A
 * box smaller than a 16-pixel person gets a finer picture (office-pictures).
 */
function markHybrid(plan) {
  const k = plan.k ?? 1;
  const portraits = [];
  plan.desks.forEach((d, i) => {
    if (!d.seat || d.seat.kind === "shell" || portraits.length >= MAX_PORTRAITS) return;
    let box;
    if (plan.layout === "war-room") {
      if (d.side !== "far") return;
      box = plan.size === "small" ? { x: d.x - 1, y: d.y, w: 14, h: 12 } : { x: d.x - 1, y: d.y - 2, w: 18, h: 20 };
    } else {
      box = plan.size === "small" ? { x: d.x + 6, y: d.y, w: 12, h: 10 } : { x: d.x + 11, y: d.y, w: 18, h: 18 };
    }
    // Too small even for a finer picture (a 16-pixel person in under 6 x 3 cells).
    if (box.w * k < 6 || box.h * k < 6) return;
    d.isHybrid = true;
    portraits.push({ index: i, left: box.x * k, top: (box.y * k) >> 1, columns: Math.min(255, box.w * k), rows: Math.min(255, (box.h * k) >> 1), isHybrid: true });
  });
  plan.portraits = portraits;
  plan.isHybrid = portraits.length > 0;
}

// The room at the largest whole-number scale at which every desk fits: few
// desks in a big pane get big desks, big names and big drag targets.
function planRoomScaled(build, seats, W, Hrows, opts) {
  let best = null;
  for (const k of [3, 2, 1]) {
    const w = Math.floor(W / k);
    const h = Math.floor(Hrows / k);
    if (k > 1 && (w < 60 || h < 14)) continue;
    const inner = build(seats, w, h, opts);
    const fits = inner.rows <= h;
    const size = (inner.size === "small" ? 18 : 30) * k;
    if ((fits || k === 1) && (!best || size > best.size)) best = { inner, k, size };
  }
  const { inner, k } = best;
  if (k === 1) return { ...inner, k: 1 };
  const tags = inner.tags.map((t) => {
    const desk = inner.seats[t.index];
    const width = t.width * k;
    return { ...t, left: t.left * k, top: t.top * k + k - 1, width, ...tagLines(desk, t.index, width), second: undefined };
  });
  return { ...inner, k, logicalColumns: inner.columns, logicalRows: inner.rows, columns: Math.min(512, inner.columns * k), rows: inner.rows * k, tags };
}

function planGrid(seats, W, Hrows, opts) {
  const g = layoutFor(seats.length, W, Hrows, { isFull: opts.isFull });
  const tags = [];
  seats.slice(0, g.shown).forEach((desk, i) => {
    if (!desk) return;
    const lines = tagLines(desk, i, g.tileW);
    tags.push({
      index: i,
      left: (i % g.perRow) * (g.tileW + 1),
      top: Math.floor(i / g.perRow) * g.tileH + g.artRows,
      width: g.tileW,
      ...lines,
    });
  });
  return { layout: "grid", grid: g, columns: g.columns, rows: g.rows, seats, tags, opts };
}

// At most this many tile pictures in one drawing; past it, cells characters.
export const MAX_PORTRAITS = 24;

/**
 * Tiles: the grid's cards, each with a box where the character's own little
 * picture goes (`portraits`), in cells. Where pictures cannot be drawn
 * (`opts.portraits === false`) it is the grid with bold characters.
 */
function planTiles(seats, W, Hrows, opts) {
  const base = planGrid(seats, W, Hrows, opts);
  if (opts.portraits === false) return { ...base, layout: "grid", isTiles: true };
  const g = base.grid;
  const box = { compact: [0, 0, 4, 3], normal: [1, 1, 8, 6], large: [2, 2, 16, 12] }[g.scale.name];
  const portraits = [];
  const marked = seats.map((desk, i) => {
    if (!desk || desk.kind === "shell" || i >= g.shown || portraits.length >= MAX_PORTRAITS) return desk;
    const [dx, dy, cols, rows] = box;
    portraits.push({ index: i, left: (i % g.perRow) * (g.tileW + 1) + dx, top: Math.floor(i / g.perRow) * g.tileH + dy, columns: Math.min(255, cols), rows: Math.min(255, rows) });
    return { ...desk, hasPortrait: true };
  });
  return { ...base, seats: marked, portraits, isTiles: true };
}

function planStrip(seats, W, opts) {
  const n = Math.max(1, seats.length);
  if (n * 11 - 1 <= W) {
    const tile = 10;
    const grid = { scale: { name: "compact", pw: 10, ph: 8, k: 1, tagRows: 2 }, tileW: tile, tileH: 6, artRows: 4, shown: n, perRow: n, deskRows: 1, columns: n * 11 - 1, rows: 6 };
    const tags = seats.map((desk, i) => (desk ? { index: i, left: i * 11, top: 4, width: tile, ...tagLines(desk, i, tile) } : null)).filter(Boolean);
    return { layout: "grid", grid, columns: grid.columns, rows: 6, seats, tags, opts };
  }
  // Too many for desks: a pip per session, a head over its state bar.
  const per = Math.max(1, Math.min(n, Math.floor((W + 1) / 7)));
  const lines = Math.ceil(n / per);
  const tags = seats
    .map((desk, i) => (desk ? { index: i, left: (i % per) * 7, top: Math.floor(i / per) * 5 + 4, width: 6, hotkey: HOTKEYS[i], label: desk.name.slice(0, 3), first: `${HOTKEYS[i] ?? " "}:${desk.name.slice(0, 4)}` } : null))
    .filter(Boolean);
  return { layout: "pips", per, columns: per * 7 - 1, rows: lines * 5, seats, tags, opts };
}

// Workstation sizes, in pixels: the desk sprite and the slot it sits in.
const WS = {
  regular: { w: 30, h: 28, slotW: 32, slotH: 32 },
  small: { w: 18, h: 16, slotW: 21, slotH: 20 },
};

function planOffice(seats, W, Hrows, opts) {
  const H = Hrows * 2;
  const wallH = Math.max(18, Math.min(46, Math.round(H * 0.3))) & ~1;
  const floorTop = wallH + 6;
  const floorH = H - floorTop - 2;
  const n = Math.max(1, seats.length);
  const tries = [];
  for (const size of ["regular", "small"]) {
    for (const style of n <= 6 ? ["bench", "rows"] : ["pods", "rows"]) tries.push([size, style]);
  }
  let pick = null;
  for (const [size, style] of tries) {
    const p = arrange(n, size, style, W, floorH);
    if (p.fits) {
      pick = p;
      break;
    }
    pick = pick ?? p;
  }
  if (!pick.fits) pick = arrange(n, "small", "rows", W, floorH);
  const rowsNeeded = Math.max(Hrows, Math.ceil((floorTop + pick.height + 2) / 2));
  // Centre the arrangement in the floor, leaving the aisle at the back.
  const drop = Math.max(0, Math.floor((floorH - pick.height) / 2)) & ~1;
  const desks = pick.spots.map((s, i) => ({ ...s, y: s.y + floorTop + drop, seat: seats[i] ?? null }));
  const tags = [];
  desks.forEach((d, i) => {
    if (!d.seat) return;
    const width = Math.max(6, pick.step - 1);
    const left = Math.max(0, Math.min(W - width, d.x - Math.floor((pick.step - pick.ws.w) / 2)));
    const lines = tagLines(d.seat, i, width);
    tags.push({ index: i, left, top: (d.y + pick.ws.h) >> 1, width, ...lines, second: undefined });
  });
  const zones = zonesFor(desks, pick.ws, opts);
  return {
    layout: "office",
    size: pick.size,
    style: pick.style,
    ws: pick.ws,
    columns: W,
    rows: rowsNeeded,
    wallH,
    desks,
    zones,
    tags,
    seats,
    opts,
  };
}

// Places `n` workstations in a floor `W` x `floorH` pixels: a long bench, rows,
// or pods of four with an aisle between pods.
function arrange(n, size, style, W, floorH) {
  const ws = WS[size];
  const spots = [];
  if (style === "pods") {
    const podW = ws.slotW * 2 + 8;
    const podH = ws.slotH * 2;
    const podsPerRow = Math.max(1, Math.floor((W - 4) / podW));
    const pods = Math.ceil(n / 4);
    const podRows = Math.ceil(pods / podsPerRow);
    const podGap = podRows > 1 ? Math.max(4, Math.min(12, Math.floor((floorH - podRows * podH) / (podRows - 1)))) & ~1 : 4;
    const usedW = Math.min(pods, podsPerRow) * podW;
    const x0 = Math.floor((W - usedW) / 2) + 4;
    for (let i = 0; i < n; i++) {
      const p = Math.floor(i / 4);
      const q = i % 4;
      const px = x0 + (p % podsPerRow) * podW + (q % 2) * ws.slotW;
      const py = Math.floor(p / podsPerRow) * (podH + podGap) + Math.floor(q / 2) * ws.slotH;
      spots.push({ x: px, y: py & ~1, pod: p });
    }
    const height = podRows * podH + (podRows - 1) * podGap;
    return { size, style, ws, step: ws.slotW, spots, height, fits: height <= floorH && podW <= W };
  }
  const gap = style === "bench" ? 0 : ws.slotW - ws.w;
  const step = ws.w + gap;
  const perRow = Math.max(1, Math.floor((W - 4 + gap) / step));
  const rowsN = Math.ceil(n / perRow);
  const inRow = Math.min(n, perRow);
  const x0 = Math.floor((W - (inRow * step - gap)) / 2);
  const vGap = rowsN > 1 ? Math.max(0, Math.min(10, Math.floor((floorH - rowsN * ws.slotH) / (rowsN - 1)))) & ~1 : 0;
  for (let i = 0; i < n; i++) {
    spots.push({ x: x0 + (i % perRow) * step, y: (Math.floor(i / perRow) * (ws.slotH + vGap)) & ~1, pod: Math.floor(i / perRow) });
  }
  const height = rowsN * ws.slotH + (rowsN - 1) * vGap;
  return { size, style, ws, step, spots, height, fits: height <= floorH };
}

// Rugs: one per pod or bench row; with seating by project or workspace, one
// per group, labelled.
function zonesFor(desks, ws, opts) {
  const groups = new Map();
  desks.forEach((d) => {
    const key = opts.zoneBy && d.seat ? String(d.seat[opts.zoneBy] ?? "") : `pod${d.pod}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  });
  let i = 0;
  return [...groups.entries()].map(([key, list]) => {
    const x0 = Math.min(...list.map((d) => d.x)) - 3;
    const y0 = Math.min(...list.map((d) => d.y)) + Math.floor(ws.h * 0.45);
    const x1 = Math.max(...list.map((d) => d.x + ws.w)) + 3;
    const y1 = Math.max(...list.map((d) => d.y + ws.h)) + 1;
    return { key, label: opts.zoneBy ? key : "", x: x0, y: y0, w: x1 - x0, h: y1 - y0, colour: i++ };
  });
}

function planWarRoom(seats, W, Hrows, opts) {
  const H = Hrows * 2;
  const wallH = Math.max(18, Math.min(46, Math.round(H * 0.3))) & ~1;
  const n = Math.max(1, seats.length);
  const size = n > 16 || W < 120 ? "small" : "regular";
  const seatW = size === "regular" ? 24 : 14;
  const perSide = Math.max(1, Math.min(Math.ceil(n / 2), Math.floor((W - 16) / seatW)));
  const tables = Math.ceil(n / (perSide * 2));
  const tableW = perSide * seatW + 10;
  const farH = size === "regular" ? 18 : 12;
  const nearH = size === "regular" ? 20 : 12;
  const tableH = size === "regular" ? 12 : 8;
  const blockH = farH + tableH + nearH + 6;
  const top = wallH + 6;
  const tx = Math.floor((W - tableW) / 2);
  const desks = [];
  for (let i = 0; i < n; i++) {
    const t = Math.floor(i / (perSide * 2));
    const j = i % (perSide * 2);
    const isFar = j < perSide;
    const k = isFar ? j : j - perSide;
    const by = top + t * blockH;
    desks.push({
      x: tx + 5 + k * seatW,
      y: (isFar ? by : by + farH + tableH) & ~1,
      side: isFar ? "far" : "near",
      table: t,
      seat: seats[i] ?? null,
    });
  }
  const tags = [];
  desks.forEach((d, i) => {
    if (!d.seat) return;
    const width = seatW - 1;
    const y = d.side === "far" ? d.y - 2 : d.y + nearH;
    tags.push({ index: i, left: Math.max(0, d.x - 1), top: Math.max(0, y >> 1), width, ...tagLines(d.seat, i, width), second: undefined });
  });
  const rowsNeeded = Math.max(Hrows, Math.ceil((top + tables * blockH + 4) / 2));
  return {
    layout: "war-room",
    size,
    columns: W,
    rows: rowsNeeded,
    wallH,
    seatW,
    farH,
    nearH,
    tableH,
    tables: Array.from({ length: tables }, (_, t) => ({ x: tx, y: top + t * blockH + farH, w: tableW, h: tableH })),
    desks,
    tags,
    seats,
    opts,
  };
}

// ---- painting ---------------------------------------------------------------

/**
 * One frame of a plan as `[codePoint, fg, bg]` words. `nowMs` drives the
 * clock, the sky and the after-a-change animations; `tick` the rest.
 */
export function paintPlan(plan, tick, nowMs = Date.now()) {
  const words = paintBase(plan, tick, nowMs);
  // While a desk is dragged: its own place dimmed, the place under the pointer lit.
  if (plan.drag) {
    const hits = hitRects(plan);
    const from = hits.find((h) => h.index === plan.drag.from);
    const over = hits.find((h) => h.index === plan.drag.over);
    if (from) outline(words, plan.columns, plan.rows, from, 0x8a8494);
    if (over && over !== from) outline(words, plan.columns, plan.rows, over, 0xffd23f);
  }
  return words;
}

/**
 * Where each seat sits, in cells: `{ index, left, top, width, height }`,
 * art and name tag together, empty seats included. What a pointer is
 * tested against.
 */
export function hitRects(plan) {
  if (plan.hits) return plan.hits;
  const out = [];
  if (plan.layout === "grid") {
    const g = plan.grid;
    for (let i = 0; i < Math.min(plan.seats.length, g.shown); i++) {
      out.push({ index: i, left: (i % g.perRow) * (g.tileW + 1), top: Math.floor(i / g.perRow) * g.tileH, width: g.tileW, height: g.tileH });
    }
  } else if (plan.layout === "pips") {
    plan.seats.forEach((_, i) => out.push({ index: i, left: (i % plan.per) * 7, top: Math.floor(i / plan.per) * 5, width: 6, height: 5 }));
  } else if (plan.layout === "war-room") {
    const k = plan.k ?? 1;
    plan.desks.forEach((d, i) => {
      const top = d.side === "far" ? Math.max(0, (d.y >> 1) - 2) : (d.y >> 1);
      out.push({ index: i, left: Math.max(0, d.x - 1) * k, top: top * k, width: (plan.seatW - 1) * k, height: (plan.size === "small" ? 8 : 12) * k });
    });
  } else {
    const k = plan.k ?? 1;
    // The whole workstation and its tag: a big target to drag.
    plan.desks.forEach((d, i) => out.push({ index: i, left: d.x * k, top: (d.y >> 1) * k, width: plan.ws.w * k, height: ((plan.ws.h >> 1) + 1) * k }));
  }
  plan.hits = out.map((h) => ({ ...h, width: Math.max(1, Math.min(h.width, plan.columns - h.left)), height: Math.max(1, Math.min(h.height, plan.rows - h.top)) }));
  return plan.hits;
}

/** The seat under a cell, or -1. */
export function seatAt(plan, x, y) {
  const h = hitRects(plan).find((r) => x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height);
  return h ? h.index : -1;
}

// A one-pixel frame round a rect of cells, drawn into packed words.
function outline(words, cols, rows, r, colour) {
  const put = (c, row, part) => {
    if (c < 0 || row < 0 || c >= cols || row >= rows) return;
    const at = (row * cols + c) * 3;
    if (words[at] !== UPPER_HALF) {
      words[at + 2] = colour;
      return;
    }
    if (part !== "bottom") words[at + 1] = colour;
    if (part !== "top") words[at + 2] = colour;
  };
  for (let c = r.left; c < r.left + r.width; c++) {
    put(c, r.top, "top");
    put(c, r.top + r.height - 1, "bottom");
  }
  for (let row = r.top; row < r.top + r.height; row++) {
    put(r.left, row, "both");
    put(r.left + r.width - 1, row, "both");
  }
}

function paintBase(plan, tick, nowMs) {
  if (plan.layout === "grid") return paintWords(plan.grid, plan.seats.slice(0, plan.grid.shown), tick, plan.opts);
  const canvas = new Canvas(plan.columns, plan.rows * 2, 0);
  if (plan.layout === "pips") {
    paintPips(canvas, plan, tick);
    return canvas.pack();
  }
  const final = paintRoomCanvas(plan, tick, nowMs);
  paintBubbles(final, plan);
  paintTags(final, plan);
  return final.pack();
}

/**
 * The room's picture without its words, at the plan's full size: drawn at
 * the logical size, then each pixel made a k x k block. What the hybrid
 * view crops a character's background from.
 */
export function paintRoomCanvas(plan, tick, nowMs) {
  const k = plan.k ?? 1;
  const lw = plan.logicalColumns ?? plan.columns;
  const lh = plan.logicalRows ?? plan.rows;
  const canvas = new Canvas(lw, lh * 2, 0);
  const hour = lightingHour(plan.opts.lighting, nowMs);
  const bgKey = `${plan.layout}:${lw}x${lh}:${Math.floor(hour * 4)}:${plan.opts.palette}:${plan.desks.map((d) => (d.seat ? `${d.x},${d.y}` : "-")).join(";")}`;
  if (!plan.bg || plan.bgKey !== bgKey) {
    plan.bg = new Canvas(lw, lh * 2, 0);
    paintRoom(plan.bg, plan, hour);
    plan.bgKey = bgKey;
  }
  canvas.copyFrom(plan.bg);
  canvas.dark = darknessAt(hour) * 0.8;
  const t = plan.opts.reducedMotion ? Math.floor(tick / 4) : tick;
  paintRoomLife(canvas, plan, t, nowMs, hour);
  if (plan.layout === "war-room") paintWarRoomPeople(canvas, plan, t, nowMs);
  else for (const d of plan.desks) paintWorkstation(canvas, plan, d, t, nowMs);
  return k === 1 ? canvas : upscaleCanvas(canvas, k, plan.columns, plan.rows);
}

// Each pixel a k x k block; a character over a cell lands in the middle of its block.
function upscaleCanvas(src, k, columns, rows) {
  const out = new Canvas(columns, rows * 2, 0);
  for (let y = 0; y < out.h; y++) {
    const sy = Math.min(src.h - 1, Math.floor(y / k));
    for (let x = 0; x < out.w; x++) out.px[y * out.w + x] = src.px[sy * src.w + Math.min(src.w - 1, Math.floor(x / k))];
  }
  for (const [i, g] of src.glyphs) {
    const col = (i % src.w) * k + Math.floor(k / 2);
    const row = Math.floor(i / src.w) * k + Math.floor(k / 2);
    out.glyph(col, row, g.ch, g.fg, g.bg);
  }
  return out;
}

// The bubbles' words, in cells over the picture: what each session is doing.
const BUBBLE_TONES = {
  alert: [0xffffff, 0xd8352a],
  work: [0x1e1a26, 0xf4f2ee],
  party: [0x1e1a26, 0xffd23f],
  quiet: [0x4a4658, 0xc8c4d4],
};

export function bubbleSpots(plan) {
  const k = plan.k ?? 1;
  const out = [];
  if (plan.layout === "pips" || plan.layout === "grid") return out;
  plan.desks.forEach((d, i) => {
    const bubble = d.seat && bubbleFor(d.seat);
    if (!bubble) return;
    if (plan.layout === "war-room" && d.side === "near" && d.seat.status !== "blocked") return;
    const isSmall = plan.size === "small";
    const headX = plan.layout === "war-room" ? d.x + 2 : d.x + (isSmall ? 8 : 13);
    const headY = plan.layout === "war-room" ? (d.side === "far" ? d.y - 4 : d.y - 2) : d.y - 1;
    // Above a hybrid picture, never under it.
    const box = plan.portraits?.find((p) => p.index === i);
    const row = Math.floor((headY * k) / 2);
    out.push({ index: i, col: Math.max(0, headX * k), row: Math.max(0, box ? Math.min(row, box.top - 1) : row), ...bubble });
  });
  return out;
}

function paintBubbles(c, plan) {
  for (const b of bubbleSpots(plan)) {
    const [fg, bg] = BUBBLE_TONES[b.tone];
    const text = ` ${b.text} `;
    const col = Math.max(0, Math.min(c.w - text.length, b.col));
    c.text(col, b.row, text, fg, bg);
  }
}

function pal(plan) {
  return PALETTES[plan.opts.palette] ?? PALETTES.nightshade;
}

// ---- the room ---------------------------------------------------------------

function paintRoom(c, plan, hour) {
  const P = pal(plan);
  const W = c.w;
  const H = c.h;
  const wallH = plan.wallH;
  const sky = skyAt(hour);
  c.dark = darknessAt(hour);

  // Back wall: a soft vertical gradient, a dado rail, the baseboard.
  for (let y = 0; y < wallH; y++) {
    const col = mix(P.wallShade, P.wall, Math.min(1, y / (wallH * 0.7)));
    for (let x = 0; x < W; x++) c.set(x, y, (x + y * 3) % 17 === 0 ? mix(col, P.wallShade, 0.3) : col);
  }
  for (let x = 0; x < W; x++) {
    c.set(x, Math.floor(wallH * 0.62), P.trim);
    c.set(x, wallH - 3, P.trim);
    c.set(x, wallH - 2, P.baseboard);
    c.set(x, wallH - 1, P.baseboard);
  }

  // Floor: wooden planks in perspective toward a point above the room.
  const vx = W / 2;
  const vy = wallH - (H - wallH) * 1.6;
  let y = wallH;
  let row = 0;
  while (y < H) {
    const depth = (y - wallH) / Math.max(1, H - wallH);
    const ph = 2 + Math.round(depth * 3);
    for (let j = 0; j < ph && y + j < H; j++) {
      const yy = y + j;
      // Plank seams: lines from the vanishing point, staggered per row.
      for (let x = 0; x < W; x++) {
        const fx = vx + ((x - vx) * (wallH - vy)) / (yy - vy);
        const seamW = 9;
        const lane = Math.floor((fx + (row % 2) * (seamW / 2)) / seamW);
        const tone = hash(`${lane}:${row}`) % 3;
        let col = tone === 0 ? P.floorA : tone === 1 ? P.floorB : mix(P.floorA, P.floorB, 0.5);
        const onSeam = Math.abs(((fx + (row % 2) * (seamW / 2)) % seamW)) < 0.6;
        if (onSeam || j === ph - 1) col = P.floorSeam;
        else if (j === 0) col = mix(col, 0xffffff, 0.06);
        c.set(x, yy, mix(col, P.dark, 0.25 * (1 - depth)));
      }
    }
    y += ph;
    row++;
  }
  // Skirting shadow where floor meets wall.
  for (let x = 0; x < W; x++) {
    c.tint(x, wallH, P.dark, 0.5);
    c.tint(x, wallH + 1, P.dark, 0.25);
  }

  // Windows, with the sky of the hour.
  const props = wallProps(plan);
  for (const w of props.windows) paintWindow(c, w, sky, hour, P);
  // Sun patches below the windows by day.
  if (!sky.isNight && hour > 7 && hour < 18) {
    const slant = (hour - 12.5) * 1.2;
    for (const w of props.windows) {
      for (let j = 0; j < Math.min(14, H - wallH); j++) {
        for (let i = 0; i < w.w; i++) c.tint(Math.round(w.x + i + slant * j * 0.4), wallH + 2 + j, 0xfff1c8, 0.16 * (1 - j / 14));
      }
    }
  }

  // Wall furniture.
  if (props.shelf) paintBookshelf(c, props.shelf, P);
  if (props.poster) paintPoster(c, props.poster, P);
  if (props.clock) paintClockFace(c, props.clock, P);
  if (props.rack) paintRack(c, props.rack, P);
  if (props.cooler) c.sprite(COOLER, props.cooler.x, props.cooler.y, { o: OUTLINE, w: 0x8fd3ff, W: 0xc8ecff, x: 0xdedede, X: 0xb4b4b4, b: 0x3b82f6, r: 0xef4444 });
  for (const p of props.plants) c.sprite(PLANT, p.x, p.y, { o: OUTLINE, g: 0x4f9a4f, G: 0x3a7a3e, L: 0x7cc46c, P: 0xb8693e, p: 0xd88a5a });

  // Rugs (pods, benches, or one per workspace or project).
  if (plan.layout === "office") {
    for (const z of plan.zones) {
      const col = P.rugs[z.colour % P.rugs.length];
      for (let j = 0; j < z.h; j++) {
        for (let i = 0; i < z.w; i++) {
          const edge = i === 0 || j === 0 || i === z.w - 1 || j === z.h - 1;
          const inner = i === 2 || j === 2 || i === z.w - 3 || j === z.h - 3;
          c.set(z.x + i, z.y + j, edge ? mix(col, P.dark, 0.4) : inner ? mix(col, 0xffffff, 0.15) : col);
        }
      }
      if (z.label) c.text(Math.max(0, z.x + 2), (z.y + z.h + 1) >> 1, ` ${z.label.slice(0, Math.max(1, z.w - 4))} `, 0xe8e6ef, mix(col, P.dark, 0.4));
    }
    // Desks' static parts and their floor shadows.
    for (const d of plan.desks) paintDeskStatic(c, plan, d, P);
  } else {
    for (const t of plan.tables) paintTable(c, t, P);
  }

  // Ceiling lights: warm pools over the desks, stronger at night.
  const pools = plan.layout === "office" ? plan.zones.map((z) => [z.x + z.w / 2, z.y + z.h / 2, Math.max(z.w, z.h) * 0.55]) : plan.tables.map((t) => [t.x + t.w / 2, t.y + t.h / 2, t.w * 0.45]);
  const strength = sky.isNight ? 0.3 : 0.08;
  for (const [x, yc, r] of pools) c.glow(x, yc, r, 0xffd9a0, strength);
  c.dark = 0;
}

// Where the windows and the wall furniture go for this width.
function wallProps(plan) {
  const W = plan.columns;
  const wallH = plan.wallH;
  const out = { windows: [], plants: [] };
  const winH = Math.max(8, Math.floor(wallH * 0.5));
  const winY = Math.max(2, Math.floor(wallH * 0.12));
  // Left: bookshelf; right: server rack; middle: windows around a clock.
  const shelfW = W >= 70 ? 22 : 0;
  const rackW = W >= 50 ? 11 : 0;
  if (shelfW) out.shelf = { x: 4, y: Math.max(1, wallH - 3 - Math.floor(wallH * 0.75)), w: shelfW, h: Math.floor(wallH * 0.75) };
  if (rackW) out.rack = { x: W - rackW - 3, y: Math.max(1, wallH - Math.floor(wallH * 0.9) + 2), w: rackW, h: Math.floor(wallH * 0.9) + 2 };
  const left = 4 + shelfW + 6;
  const right = W - rackW - 8 - (W >= 90 ? 14 : 0);
  const span = right - left;
  const nWin = Math.max(1, Math.min(4, Math.floor(span / 46)));
  const winW = Math.min(34, Math.floor(span / nWin) - 10);
  const clockAt = W >= 60 ? Math.floor(nWin / 2) : -1;
  for (let i = 0; i < nWin; i++) {
    const slot = left + Math.floor((span * (i + 0.5)) / nWin);
    out.windows.push({ x: slot - Math.floor(winW / 2) + (clockAt >= 0 && i >= clockAt ? 6 : clockAt >= 0 ? -6 : 0), y: winY, w: Math.max(8, winW), h: winH });
  }
  if (clockAt >= 0) out.clock = { x: left + Math.floor((span * clockAt) / nWin), y: winY + Math.floor(winH / 2), r: 4 };
  if (W >= 90) out.poster = { x: right + 3, y: winY + 1, w: 10, h: 13 };
  if (W >= 60) out.cooler = { x: 4 + shelfW + 1, y: wallH - 9 };
  out.plants.push({ x: 0, y: wallH - 8 });
  if (W >= 50) out.plants.push({ x: W - rackW - 15, y: wallH - 8 });
  plan.props = out;
  return out;
}

function paintWindow(c, w, sky, hour, P) {
  c.rect(w.x - 1, w.y - 1, w.w + 2, w.h + 3, P.trim);
  for (let j = 0; j < w.h; j++) {
    const col = mix(sky.top, sky.bottom, j / w.h);
    for (let i = 0; i < w.w; i++) c.set(w.x + i, w.y + j, col, true);
  }
  // City skyline at the bottom of the window.
  for (let i = 0; i < w.w; i++) {
    const bh = 2 + (hash(`b${Math.floor((w.x + i) / 3)}`) % Math.max(2, Math.floor(w.h / 3)));
    for (let j = 0; j < bh; j++) {
      const y = w.y + w.h - 1 - j;
      const lit = sky.isNight && hash(`l${w.x + i},${j}`) % 7 === 0;
      c.set(w.x + i, y, lit ? 0xffd27a : mix(sky.bottom, 0x1a1a2e, sky.isNight ? 0.75 : 0.45), true);
    }
  }
  if (sky.isNight) {
    for (let k = 0; k < Math.floor(w.w / 4); k++) {
      const h = hash(`s${w.x},${k}`);
      c.set(w.x + (h % w.w), w.y + ((h >> 8) % Math.max(1, w.h - 5)), 0xf2f0ff, true);
    }
    if (w.x % 3 === 0) {
      c.rect(w.x + w.w - 6, w.y + 2, 3, 3, 0xf4efd0, true);
      c.set(w.x + w.w - 6, w.y + 2, mix(sky.top, 0xf4efd0, 0.3), true);
    }
  } else if (hour >= 6 && hour < 19) {
    // Clouds.
    for (let k = 0; k < 2; k++) {
      const h = hash(`c${w.x},${k}`);
      const cx = w.x + (h % Math.max(1, w.w - 8));
      const cy = w.y + 2 + ((h >> 6) % Math.max(1, Math.floor(w.h / 3)));
      c.rect(cx + 1, cy, 4, 1, 0xffffff, true);
      c.rect(cx, cy + 1, 7, 1, 0xf2f6ff, true);
    }
  }
  // Mullions and a sill.
  const mid = w.x + Math.floor(w.w / 2);
  for (let j = 0; j < w.h; j++) c.set(mid, w.y + j, P.trim);
  for (let i = 0; i < w.w; i++) c.set(w.x + i, w.y + Math.floor(w.h / 2), P.trim);
  for (let i = -2; i < w.w + 2; i++) {
    c.set(w.x + i, w.y + w.h + 1, mix(P.trim, 0xffffff, 0.2));
    c.set(w.x + i, w.y + w.h + 2, P.baseboard);
  }
}

function paintBookshelf(c, s, P) {
  c.rect(s.x, s.y, s.w, s.h, P.woodDark);
  c.rect(s.x + 1, s.y + 1, s.w - 2, s.h - 2, mix(P.woodDark, 0x000000, 0.35));
  const shelves = Math.max(2, Math.floor(s.h / 6));
  const sh = Math.floor((s.h - 2) / shelves);
  const spines = [0xb5442b, 0x2f6f9a, 0xd9b25e, 0x4f8a4f, 0x7a4f9a, 0xe0e0d0, 0x9a6a3a, 0x3a3a4a];
  for (let k = 0; k < shelves; k++) {
    const by = s.y + 1 + (k + 1) * sh - 1;
    c.rect(s.x + 1, by, s.w - 2, 1, P.wood);
    let x = s.x + 2;
    while (x < s.x + s.w - 3) {
      const h = hash(`book${s.x},${k},${x}`);
      const bw = 1 + (h % 2);
      const bh = Math.max(2, sh - 1 - ((h >> 3) % 3));
      if (h % 11 === 0) {
        x += 2;
        continue;
      }
      const col = spines[(h >> 5) % spines.length];
      c.rect(x, by - bh, bw, bh, col);
      c.set(x, by - bh, mix(col, 0xffffff, 0.3));
      x += bw;
    }
  }
}

function paintPoster(c, p, P) {
  c.rect(p.x, p.y, p.w, p.h, P.trim);
  c.rect(p.x + 1, p.y + 1, p.w - 2, p.h - 2, 0x24222c);
  // A small pixel mascot: the orange critter.
  c.sprite(HEADS.critter, p.x, p.y + 2, { o: 0x24222c, q: 0xde7a4a, Q: 0xb35a30, e: 0x1a1420 });
}

function paintClockFace(c, k, P) {
  for (let y = -k.r - 1; y <= k.r + 1; y++) {
    for (let x = -k.r - 1; x <= k.r + 1; x++) {
      const d = Math.hypot(x, y);
      if (d <= k.r + 0.6) c.set(k.x + x, k.y + y, d > k.r - 0.6 ? P.dark : 0xf2efe6);
    }
  }
}

function paintRack(c, r, P) {
  c.rect(r.x, r.y, r.w, r.h, 0x1b1c22);
  c.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 0x26272f);
  for (let y = r.y + 2; y < r.y + r.h - 2; y += 3) {
    c.rect(r.x + 2, y, r.w - 4, 2, 0x31333d);
    c.set(r.x + 2, y, 0x454857);
  }
  c.rect(r.x, r.y + r.h, r.w, 1, P.dark);
}

function paintTable(c, t, P) {
  c.rect(t.x + 2, t.y + t.h, t.w - 4, 3, mix(P.dark, 0x000000, 0.2));
  c.rect(t.x, t.y, t.w, t.h, P.woodTop);
  for (let i = 0; i < t.w; i++) {
    c.set(t.x + i, t.y, P.woodLight);
    c.set(t.x + i, t.y + t.h - 1, P.woodDark);
  }
  for (let j = 1; j < t.h - 1; j++) {
    c.set(t.x, t.y + j, P.woodDark);
    c.set(t.x + t.w - 1, t.y + j, P.woodDark);
    for (let i = 4; i < t.w - 4; i += 11) c.set(t.x + i + (j % 3), t.y + j, mix(P.woodTop, P.woodDark, 0.25));
  }
  // Papers, a pen pot and a plant on the table.
  for (let k = 0; k < Math.floor(t.w / 30); k++) {
    const h = hash(`paper${t.x},${t.y},${k}`);
    const px = t.x + 6 + (h % Math.max(1, t.w - 14));
    const py = t.y + 4 + ((h >> 6) % Math.max(1, t.h - 7));
    c.rect(px, py, 3, 2, 0xece8de);
    c.set(px + 2, py + 1, 0xc9c3b4);
  }
  const mid = t.x + Math.floor(t.w / 2);
  c.rect(mid - 1, t.y + Math.floor(t.h / 2) - 1, 3, 2, 0xb8693e);
  c.set(mid, t.y + Math.floor(t.h / 2) - 2, 0x4f9a4f);
  c.set(mid - 1, t.y + Math.floor(t.h / 2) - 3, 0x7cc46c);
  c.set(mid + 1, t.y + Math.floor(t.h / 2) - 3, 0x3a7a3e);
}

function paintDeskStatic(c, plan, d, P) {
  const s = plan.size === "small";
  const ws = plan.ws;
  // Shadow under the desk.
  for (let i = 1; i < ws.w - 1; i++) {
    c.tint(d.x + i, d.y + ws.h, P.dark, 0.45);
    c.tint(d.x + i, d.y + ws.h + 1, P.dark, 0.2);
  }
  if (!d.seat) {
    // An empty seat: the desk alone, chair tucked in, screen off.
    paintDesk(c, d.x, d.y, s, P, 0x555566);
    paintMonitor(c, d.x, d.y, s, null, 0);
  }
}

// ---- workstations -------------------------------------------------------------

// The desk: a top in light wood seen a little from above, the front panel,
// the state's accent stripe, legs.
function paintDesk(c, x, y, isSmall, P, accent) {
  const w = isSmall ? 18 : 30;
  const top = isSmall ? 10 : 18;
  const depth = isSmall ? 2 : 4;
  const front = isSmall ? 3 : 5;
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < depth; j++) c.set(x + i, y + top + j, j === depth - 1 ? P.woodLight : i === 0 || i === w - 1 ? P.wood : P.woodTop);
    for (let j = 0; j < front; j++) c.set(x + i, y + top + depth + j, j === 1 ? accent : i === 0 || i === w - 1 ? P.woodDark : j === front - 1 ? P.woodDark : P.wood);
  }
  c.set(x, y + top, OUTLINE);
  c.set(x + w - 1, y + top, OUTLINE);
  const legY = y + top + depth + front;
  for (let j = 0; j < (isSmall ? 1 : 2); j++) {
    c.set(x + 1, legY + j, P.woodDark);
    c.set(x + w - 2, legY + j, P.woodDark);
  }
}

// A monitor three-quarters on, its screen showing the state.
function paintMonitor(c, x, y, isSmall, desk, t, status) {
  const sx = isSmall ? 1 : 2;
  const sy = isSmall ? 3 : 7;
  const sw = isSmall ? 5 : 8;
  const sh = isSmall ? 6 : 9;
  c.rect(x + sx - 1, y + sy - 1, sw + 2, sh + 2, 0x23252e);
  for (let j = 0; j < sh + 1; j++) c.set(x + sx + sw + 1, y + sy + j, 0x15161c);
  c.set(x + sx - 1, y + sy - 1, 0x3a3d4a);
  c.rect(x + sx + Math.floor(sw / 2) - 1, y + sy + sh + 1, 2, 1, 0x2b2d36);
  c.rect(x + sx + Math.floor(sw / 2) - 2, y + sy + sh + 2, 4, 1, 0x3a3d4a);
  if (!desk) {
    c.rect(x + sx, y + sy, sw, sh, 0x0b0c10);
    c.set(x + sx + sw - 2, y + sy + 1, 0x262a36);
    return;
  }
  screenPixels(c, x + sx, y + sy, sw, sh, desk, t, status);
}

export function screenPixels(c, x, y, w, h, desk, t, status) {
  const isRobot = desk.kind === "process";
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let col = 0x07080c;
      if (isRobot) {
        const ln = j + Math.floor(t / 2);
        const hh = hash(`${desk.paneId}:${ln}`);
        col = i < 1 + (hh % (w - 1)) ? [0x4ade80, 0x22c55e, 0x86efac][(hh >> 4) % 3] : 0x041008;
      } else if (status === "working") {
        const ln = j + t;
        const hh = hash(`${desk.paneId}:${ln}`);
        const indent = hh % 3;
        const len = 1 + ((hh >> 3) % Math.max(1, w - indent - 1));
        col = i >= indent && i < indent + len ? [0x7ab8ff, 0xb3d4ff, 0xc4a8ff, 0x7ef0a0, 0xffd27a, 0xff9ac8][(hh >> 7) % 6] : 0x0d1428;
      } else if (status === "idle" || status === "unknown") {
        const k = Math.floor(t / 3);
        const dx = Math.abs((k % (2 * (w - 1))) - (w - 1));
        const dy = Math.abs(((k + 3) % (2 * (h - 1))) - (h - 1));
        col = i === dx && j === dy ? 0x9be7ff : 0x13254a;
      } else if (status === "blocked") {
        const on = t % 4 < 2;
        const midX = Math.floor(w / 2);
        const bang = i === midX && (j < h - 3 || j === h - 2);
        col = bang ? 0xffffff : on ? 0xb91c1c : 0x6b1414;
      } else if (status === "celebrate") {
        col = CONFETTI[(i + j + t) % CONFETTI.length];
      }
      c.set(x + i, y + j, col, true);
    }
  }
}

function screenColour(desk, status) {
  if (desk.kind === "process") return 0x4ade80;
  return { working: 0x6aa8ff, idle: 0x3a6fd0, unknown: 0x3a6fd0, blocked: 0xff3b3b, celebrate: 0xffd23f }[status] ?? null;
}

// What a desk is doing this frame, with the after-a-change moments.
// A finished session nobody has looked at yet keeps celebrating: 4 s of
// cheering, 3 s of stretching, round again, until its pane is focused.
export function poseFor(desk, nowMs, reducedMotion) {
  if (desk.status === "done" && desk.unseenDone) {
    if (reducedMotion) return "stretch";
    const since = Math.max(0, nowMs - (desk.changedAt ?? nowMs));
    return since % 7000 < 4000 ? "celebrate" : "stretch";
  }
  if (desk.kind === "process") return "type";
  return { working: "type", idle: "lean", unknown: "lean", done: "sleep", blocked: "wave" }[desk.status] ?? "lean";
}

function paintWorkstation(c, plan, d, t, nowMs) {
  const desk = d.seat;
  if (!desk) return;
  const P = pal(plan);
  const isSmall = plan.size === "small";
  const status = desk.status;
  const pose = poseFor(desk, nowMs, plan.opts.reducedMotion);
  const look = lookFor(desk, plan.opts.characters, plan.opts.style);
  const palette = palFor(look, status, desk.kind === "process");
  const accent = P.accent[status] ?? P.accent.unknown;
  const x = d.x;
  const y = d.y;
  const blink = t % 4 < 2;
  const screenStatus = pose === "celebrate" ? "celebrate" : status === "done" ? "done" : status;

  // Red light thrown round a desk that needs you.
  if (status === "blocked") c.glow(x + (isSmall ? 9 : 15), y + (isSmall ? 8 : 12), isSmall ? 12 : 20, blink ? 0xff2a2a : 0xff9a1a, blink ? 0.4 : 0.22);

  // In the hybrid view the person is a picture laid over this spot.
  const drawsPerson = !d.isHybrid;
  if (drawsPerson) paintChair(c, x, y, isSmall, pose, t, plan.opts.reducedMotion);
  if (drawsPerson && pose !== "sleep") paintPerson(c, x, y, isSmall, pose, look, palette, t, desk);
  paintDesk(c, x, y, isSmall, P, accent);
  if (drawsPerson && pose === "sleep") paintSleeper(c, x, y, isSmall, look, palette);
  if (!isSmall) {
    if (pose !== "lean" || !drawsPerson) c.sprite(MUG, x + 25, y + 15, { o: OUTLINE, w: 0xeeeae2, c: 0x5b3a22 });
    paintKeyboard(c, x, y, pose, t);
    if (drawsPerson && pose === "lean") paintFeetUp(c, x, y, look, t, plan.opts.reducedMotion);
  }
  if (drawsPerson && (pose === "type" || pose === "lean" || pose === "stretch" || pose === "celebrate")) paintArms(c, x, y, isSmall, pose, palette, t, plan.opts.reducedMotion);
  paintMonitor(c, x, y, isSmall, desk, t, screenStatus);

  // Screen light on the face and the desk.
  const glowC = screenColour(desk, screenStatus);
  if (glowC && pose !== "sleep") {
    const fx = x + (isSmall ? 9 : 15);
    const fy = y + (isSmall ? 4 : 8);
    c.glow(fx, fy, isSmall ? 4 : 7, glowC, 0.22 + (t % 3 === 0 && status === "working" ? 0.08 : 0));
    c.glow(x + (isSmall ? 4 : 7), y + (isSmall ? 11 : 19), isSmall ? 4 : 7, glowC, 0.18);
  }

  // Life: typing sparks, steam, zZ, beacon, confetti.
  const reduced = plan.opts.reducedMotion;
  if (pose === "type" && !reduced && !isSmall) {
    for (let k = 0; k < 2; k++) {
      const h = hash(`spark${desk.paneId}${t}${k}`);
      if (h % 3 === 0) c.set(x + 13 + (h % 10), y + 17 - ((h >> 4) % 3), [0xfff3a0, 0x9be7ff, 0xffffff][(h >> 8) % 3], true);
    }
  }
  if (pose === "lean" && !reduced) {
    const sip = t % 24 >= 20;
    const mx = isSmall ? x + 13 : sip ? x + 19 : x + 23;
    const my = isSmall ? y + 6 : sip ? y + 9 : y + 13;
    for (let k = 0; k < 4; k++) {
      const ph = (t + k * 3) % 12;
      const sy = my - 1 - Math.floor(ph * 0.6);
      const sx = mx + Math.round(Math.sin((t + k * 5) / 2.5));
      if (sy > y - 2) c.tint(sx, sy, 0xe8ecf5, 0.75 * (1 - ph / 12));
    }
  }
  if (pose === "sleep") {
    const cols = [x + (isSmall ? 12 : 22), x + (isSmall ? 13 : 24), x + (isSmall ? 14 : 26)];
    for (let k = 0; k < 3; k++) {
      const ph = (Math.floor(t / 2) + k * 4) % 12;
      const gy = y + (isSmall ? 6 : 12) - Math.floor(ph * 0.9);
      if (gy >= 0 && !reduced) c.glyph(cols[k], gy >> 1, ph < 5 ? "z" : "Z", mix(0xd8ccff, 0x6a6a88, ph / 13));
    }
    if (reduced) c.glyph(cols[1], (y + (isSmall ? 2 : 6)) >> 1, "z", 0xd8ccff);
  }
  if (status === "blocked") {
    const bx = x + (isSmall ? 3 : 6);
    const by = y + (isSmall ? 0 : 2);
    c.rect(bx - 1, by + 2, 4, 1, 0x3a3d4a);
    c.rect(bx, by, 2, 2, blink || reduced ? 0xff3b3b : 0xffb020, true);
    c.set(bx, by, 0xffffff, true);
    c.glyph(x + (isSmall ? 15 : 26), (y + (isSmall ? 0 : 1)) >> 1, "!", blink ? 0xffb020 : 0xff3b3b);
  }
  if (pose === "celebrate" && !reduced) {
    for (let k = 0; k < (isSmall ? 6 : 14); k++) {
      const h = hash(`conf${desk.paneId}${k}`);
      const cx = x + (h % (isSmall ? 18 : 30));
      const cy = y - 4 + ((h >> 5) + t * (1 + (k % 3))) % (isSmall ? 18 : 28);
      c.set(cx + Math.round(Math.sin((t + k) / 2)), cy, CONFETTI[k % CONFETTI.length], true);
    }
  }

  // Helpers: minions around the desk, and a count.
  const n = desk.helpers || 0;
  if (n > 0) {
    const spots = isSmall ? [[-3, 12], [19, 12], [-3, 7]] : [[-5, 21], [30, 21], [-5, 14], [30, 14]];
    spots.slice(0, Math.min(spots.length, n)).forEach(([dx, dy], i) => {
      const hop = !reduced && (t + i * 2) % 6 === 0 ? 1 : 0;
      if (isSmall) c.sprite(SMALL_MINION, x + dx, y + dy - hop, { y: 0xfacc15, u: 0x2563eb });
      else c.sprite(MINION, x + dx, y + dy - hop, { y: 0xfacc15, G: 0xe5e7eb, g: (t + i) % 9 === 0 ? 0xfacc15 : 0x1f2937, u: 0x2563eb, o: OUTLINE });
    });
    const label = `x${n}`;
    c.text(x + (isSmall ? 18 : 29) - label.length, y >> 1, label, 0xfacc15, null);
  }
  if (desk.isSelf && drawsPerson) {
    const cx = x + (isSmall ? 11 : 18);
    const cy = y + (pose === "wave" ? 0 : isSmall ? 1 : 3);
    c.set(cx, cy, 0xfacc15, true);
    c.set(cx + 2, cy, 0xfacc15, true);
    c.set(cx + 4, cy, 0xfacc15, true);
    c.rect(cx, cy + 1, 5, 1, 0xe0b010, true);
  }
}

function paintChair(c, x, y, isSmall, pose, t, reduced) {
  const swivel = pose === "lean" && !reduced ? Math.round(Math.sin(t / 6)) : 0;
  const pushed = pose === "wave" ? 3 : 0;
  const cx = x + (isSmall ? 8 : 13) + swivel + pushed;
  const cy = y + (isSmall ? 4 : 8) + pushed;
  const w = isSmall ? 9 : 13;
  const h = isSmall ? 7 : 11;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const corner = (j === 0 || j === h - 1) && (i === 0 || i === w - 1);
      if (corner) continue;
      const edge = i === 0 || i === w - 1 || j === 0;
      c.set(cx + i, cy + j, edge ? 0x1e2129 : i < 2 ? 0x454b5c : j < 2 ? 0x4c5366 : 0x363b49);
    }
  }
}

function paintPerson(c, x, y, isSmall, pose, look, palette, t, desk) {
  const isLean = pose === "lean";
  const isWave = pose === "wave";
  const lift = isWave ? (isSmall ? 3 : 5) : 0;
  if (isSmall) {
    const hx = x + 9 + (isLean ? 1 : 0);
    const hy = y + 2 - lift + (isLean ? -1 : 0);
    c.sprite(SMALL_TORSO, x + 8, y + 7 - lift, palette);
    paintHead(c, hx, hy, look, palette, pose, t, true, desk, look.isBold);
    if (isWave) {
      const up = t % 2 === 0;
      c.line(x + 8, y + 7 - lift, x + (up ? 6 : 7), y + (up ? 0 : 2) - lift, palette.c);
      c.line(x + 15, y + 7 - lift, x + (up ? 17 : 16), y + (up ? 2 : 0) - lift, palette.c);
      c.set(x + (up ? 6 : 7), y + (up ? -1 : 1) - lift, palette.s);
      c.set(x + (up ? 17 : 16), y + (up ? 1 : -1) - lift, palette.s);
    }
    return;
  }
  const hx = x + 14 + (isLean ? 1 : 0);
  const hy = y + 3 - lift + (isLean ? -1 : 0);
  c.sprite(TORSO, x + 13, y + 12 - lift, palette);
  paintHead(c, hx, hy, look, palette, pose, t, false, desk, look.isBold);
  if (isWave) {
    // Both arms up, waving out of step.
    const a = t % 2 === 0;
    const L = a ? [10, -1] : [8, 2];
    const R = a ? [28, 2] : [27, -1];
    for (const [sx, [hx2, hy2]] of [[14, L], [23, R]]) {
      c.line(x + sx, y + 13 - lift, x + hx2, y + hy2 + 2 - lift, OUTLINE);
      c.line(x + sx, y + 12 - lift, x + hx2, y + hy2 + 1 - lift, palette.c);
      c.rect(x + hx2 - 1, y + hy2 - lift, 2, 2, palette.s);
    }
  }
}

function paintHead(c, x, y, look, palette, pose, t, isSmall, desk, isBold) {
  const kind = look.kind;
  const p = { ...palette };
  if (isBold) {
    // Bold: one chunky block per kind, the hair or ears part of it.
    if (pose === "stretch" || pose === "celebrate" || (pose === "lean" && t % 18 >= 16)) p.e = p.S ?? p.e;
    if (kind === "robot") p.v = t % 6 < 3 ? p.v : mix(p.v, 0xffffff, 0.4);
    c.sprite((isSmall ? BOLD_SMALL_HEADS : BOLD_HEADS)[kind] ?? BOLD_HEADS.critter, x, y, p);
    return;
  }
  const blinkNow = (t + (desk.look ?? 0)) % 23 === 0;
  if (pose === "stretch" || pose === "celebrate" || blinkNow || (pose === "lean" && t % 18 >= 16)) p.e = p.S ?? p.e;
  if (kind === "robot") p.v = t % 6 < 3 ? p.v : mix(p.v, 0xffffff, 0.4);
  if (isSmall) {
    c.sprite(SMALL_HEADS[kind] ?? SMALL_HEADS.human, x, y, p);
    if (kind === "human") c.sprite(SMALL_HAIRS[look.hairStyle] ?? SMALL_HAIRS.short, x, y, p);
    return;
  }
  c.sprite(HEADS[kind] ?? HEADS.human, x, y, p);
  if (kind === "human") c.sprite(HAIRS[look.hairStyle] ?? HAIRS.short, x, y, p);
  if (kind === "critter") {
    // Little legs under the critter's block, and arms that wave about.
    c.set(x + 2, y + 10, p.Q);
    c.set(x + 7, y + 10, p.Q);
  }
  if ((pose === "celebrate" || pose === "stretch") && kind !== "robot") {
    c.set(x + 4, y + 7, 0x5a2020);
    c.set(x + 5, y + 7, 0x5a2020);
  }
}

function paintArms(c, x, y, isSmall, pose, palette, t, reduced) {
  if (isSmall) {
    if (pose === "type") {
      // Forearms down to the desk, one hand lifted, swapping every frame.
      const a = reduced || t % 2 === 0;
      const hands = [
        [9, a ? 11 : 8],
        [14, a ? 8 : 11],
      ];
      hands.forEach(([hx, hy], k) => {
        c.line(x + (k ? 16 : 7), y + 8, x + hx, y + hy, palette.C ?? palette.c);
        c.rect(x + hx - (k ? 0 : 1), y + hy, 2, 1, palette.s);
        if (hy === 11 && !reduced) c.set(x + hx, y + 12, 0xfff3a0, true);
      });
    } else if (pose === "stretch" || pose === "celebrate") {
      c.line(x + 8, y + 7, x + 8, y + 0, palette.c);
      c.line(x + 15, y + 7, x + 15, y + 0, palette.c);
    } else {
      // Coffee in hand, feet up on the desk.
      c.line(x + 15, y + 8, x + 13, y + 7, palette.c);
      c.set(x + 13, y + 7, palette.s);
      c.rect(x + 12, y + 5, 2, 2, 0xeeeae2);
      c.rect(x + 14, y + 9, 2, 1, 0xf2f0ea);
      c.rect(x + 16, y + 9, 2, 1, 0xf2f0ea);
      c.set(x + 15, y + 9, 0xd04a4a);
    }
    return;
  }
  if (pose === "type") {
    // Two hands on the keys, one up one down, swapping every frame.
    const a = reduced || t % 2 === 0;
    const hands = [
      [15, a ? 19 : 15],
      [21, a ? 15 : 19],
    ];
    // Upper arm in the sleeve out to the elbow, bare forearm in to the keys.
    const arms = [
      [13, 14, 11, 17],
      [24, 14, 26, 17],
    ];
    hands.forEach(([hx, hy], k) => {
      const [sx, sy, ex, ey] = arms[k];
      c.line(x + sx, y + sy, x + ex, y + ey, palette.C ?? palette.c);
      c.line(x + sx + (k ? 1 : -1), y + sy + 1, x + ex + (k ? 1 : -1), y + ey, OUTLINE);
      c.line(x + ex, y + ey, x + hx + (k ? 2 : 0), y + hy, palette.s);
      c.line(x + ex, y + ey + 1, x + hx + (k ? 2 : 0), y + hy + 1, palette.S ?? palette.s);
      c.rect(x + hx, y + hy - 1, 3, 2, palette.s);
      c.set(x + hx + 1, y + hy - 1, palette.h ?? palette.s);
    });
  } else if (pose === "lean") {
    // A coffee in hand; lifted for a sip now and then.
    const sip = !reduced && t % 24 >= 20;
    const hand = sip ? [20, 11] : [24, 15];
    c.line(x + 22, y + 15, x + hand[0], y + hand[1] + 1, palette.c);
    c.rect(x + hand[0] - 1, y + hand[1], 2, 2, palette.s);
    c.sprite(MUG, x + hand[0] - 1, y + hand[1] - 3, { o: OUTLINE, w: 0xeeeae2, c: 0x5b3a22 });
    c.line(x + 14, y + 15, x + 16, y + 18, palette.c);
    c.rect(x + 16, y + 18, 2, 1, palette.s);
  } else {
    // Stretching or cheering: both arms straight up.
    const up = pose === "celebrate" && !reduced ? t % 2 : 0;
    for (const [sx, hx] of [
      [14, 13],
      [23, 24],
    ]) {
      const top = 1 + (up && sx === 14 ? 1 : 0);
      c.line(x + sx, y + 13, x + hx, y + top + 1, palette.c);
      c.rect(x + hx - (sx === 14 ? 1 : 0), y + top - 1, 2, 2, palette.s);
    }
  }
}

// Idle: feet up on the desk, crossed at the ankles, rocking slowly.
function paintFeetUp(c, x, y, look, t, reduced) {
  const rock = reduced ? 0 : Math.round(Math.sin(t / 5));
  const shoe = 0xf2f0ea;
  const sole = 0xd04a4a;
  for (const [dx, dy] of [
    [20, 16],
    [23, 15],
  ]) {
    c.rect(x + dx + rock, y + dy, 4, 2, shoe);
    c.rect(x + dx + rock, y + dy + 2, 4, 1, sole);
    c.set(x + dx + rock, y + dy, OUTLINE);
    c.set(x + dx + rock + 3, y + dy + 1, 0x9aa4b8);
  }
}

function paintKeyboard(c, x, y, pose, t) {
  c.rect(x + 13, y + 19, 10, 2, 0x5a5e6e);
  for (let i = 0; i < 10; i += 2) c.set(x + 13 + i, y + 19, 0x7a7e8e);
  if (pose === "type") {
    const k = hash(`kb${x}${t}`) % 10;
    c.set(x + 13 + k, y + 19, 0xfff3a0, true);
  }
}

function paintSleeper(c, x, y, isSmall, look, palette) {
  if (look.isBold) {
    const shut = { ...palette, e: palette.S ?? palette.e };
    if (isSmall) {
      c.rect(x + 8, y + 9, 8, 2, palette.c);
      c.sprite(BOLD_SMALL_HEADS[look.kind] ?? BOLD_SMALL_HEADS.critter, x + 9, y + 5, shut);
      return;
    }
    c.rect(x + 12, y + 18, 13, 2, palette.c);
    c.sprite(BOLD_HEADS[look.kind] ?? BOLD_HEADS.critter, x + 14, y + 10, shut);
    return;
  }
  if (isSmall) {
    c.rect(x + 8, y + 9, 8, 2, palette.c);
    c.sprite((HEAD_BACKS[look.kind] ?? HEAD_BACKS.human).slice(2, 8).map((r) => r.slice(2, 8)), x + 9, y + 5, palette);
    return;
  }
  c.sprite(TORSO.slice(0, 5), x + 13, y + 13, palette);
  // Folded arms on the desk, the head laid on them.
  c.rect(x + 12, y + 18, 13, 2, palette.c);
  c.rect(x + 12, y + 18, 13, 1, palette.k);
  c.sprite(HEAD_BACKS[look.kind] ?? HEAD_BACKS.human, x + 14, y + 9, palette);
}

// ---- war room -------------------------------------------------------------

function paintWarRoomPeople(c, plan, t, nowMs) {
  const P = pal(plan);
  const isSmall = plan.size === "small";
  // Far side first (behind the table), then the table's laptops, then the near side.
  for (const d of plan.desks) {
    if (d.side !== "far" || !d.seat) continue;
    const desk = d.seat;
    const look = lookFor(desk, plan.opts.characters, plan.opts.style);
    const palette = palFor(look, desk.status, desk.kind === "process");
    const pose = poseFor(desk, nowMs, plan.opts.reducedMotion);
    const ox = d.x - (isSmall ? 7 : 12);
    const oy = d.y - (isSmall ? 0 : 2);
    if (desk.status === "blocked") c.glow(d.x + 6, d.y + 8, 14, t % 4 < 2 ? 0xff2a2a : 0xff9a1a, 0.35);
    if (d.isHybrid) continue;
    paintChair(c, ox, oy, isSmall, pose, t, plan.opts.reducedMotion);
    if (pose === "sleep") paintSleeper(c, ox, oy - (isSmall ? 2 : 4), isSmall, look, palette);
    else paintPerson(c, ox, oy, isSmall, pose, look, palette, t, desk);
  }
  // The table hides the far side's laps: put it back over them.
  for (const t of plan.tables) {
    for (let y = t.y; y < t.y + t.h + 3; y++) for (let x = t.x; x < t.x + t.w; x++) c.px[y * c.w + x] = plan.bg.px[y * c.w + x];
  }
  for (const d of plan.desks) {
    if (!d.seat) continue;
    const isFar = d.side === "far";
    const table = plan.tables[d.table];
    const lx = d.x + 1;
    const ly = isFar ? table.y + 1 : table.y + table.h - (isSmall ? 4 : 6);
    const lw = isSmall ? 6 : 10;
    const lh = isSmall ? 3 : 5;
    const pose = poseFor(d.seat, nowMs, plan.opts.reducedMotion);
    const status = pose === "celebrate" ? "celebrate" : d.seat.status;
    if (isFar) {
      // The laptop's lid, its logo lit by the state.
      c.rect(lx, ly, lw, lh, 0x9aa0ad);
      c.rect(lx, ly + lh - 1, lw, 1, 0x6b7180);
      c.set(lx + (lw >> 1), ly + (lh >> 1), P.accent[d.seat.status] ?? 0xffffff, true);
    } else {
      // From behind its user, the laptop's screen faces us.
      c.rect(lx - 1, ly - 1, lw + 2, lh + 2, 0x2a2d36);
      screenPixels(c, lx, ly, lw, lh, d.seat, t, status);
    }
    const accent = P.accent[d.seat.status] ?? P.accent.unknown;
    const stripeY = isFar ? table.y - 1 : table.y + table.h;
    c.rect(d.x, stripeY, lw + 2, 1, accent, true);
  }
  for (const d of plan.desks) {
    if (d.side !== "near" || !d.seat) continue;
    paintBackSeat(c, plan, d, t, nowMs, isSmall);
  }
}

function paintBackSeat(c, plan, d, t, nowMs, isSmall) {
  const desk = d.seat;
  const look = lookFor(desk, plan.opts.characters, plan.opts.style);
  const palette = palFor(look, desk.status, desk.kind === "process");
  const pose = poseFor(desk, nowMs, plan.opts.reducedMotion);
  const x = d.x - (isSmall ? 1 : 2);
  const y = d.y + 2;
  const head = HEAD_BACKS[look.kind] ?? HEAD_BACKS.human;
  if (desk.status === "blocked") c.glow(d.x + 6, d.y + 8, 14, t % 4 < 2 ? 0xff2a2a : 0xff9a1a, 0.35);
  const lift = pose === "wave" ? 3 : 0;
  const headY = pose === "sleep" ? y - 2 : y - lift;
  if (isSmall) {
    c.sprite(head.slice(2).map((r) => r.slice(2, 8)), x + 2, headY - 2, palette);
  } else {
    c.sprite(head, x + 1, headY - 2, palette);
  }
  // Arms reaching to the laptop, or up.
  const a = t % 2 === 0;
  if (pose === "type") {
    c.set(x + 1, y + (a ? 4 : 5), palette.s);
    c.set(x + (isSmall ? 9 : 11), y + (a ? 5 : 4), palette.s);
  } else if (pose === "wave" || pose === "celebrate" || pose === "stretch") {
    c.line(x, y + 5, x - 1, y - 3 - (a ? 1 : 0), palette.c);
    c.line(x + (isSmall ? 10 : 12), y + 5, x + (isSmall ? 11 : 13), y - 3 - (a ? 0 : 1), palette.c);
  }
  // Shoulders, then the chair's back hides the rest.
  if (!isSmall) {
    c.rect(x, y + 6 - lift, 12, 3, palette.c);
    c.rect(x, y + 6 - lift, 12, 1, palette.k ?? palette.c);
    c.set(x - 1, y + 7 - lift, OUTLINE);
    c.set(x + 12, y + 7 - lift, OUTLINE);
  }
  const cw = isSmall ? 10 : 13;
  const ch = isSmall ? 6 : 10;
  const cy = y + (isSmall ? 4 : 8);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) if (!((j === 0 || j === ch - 1) && (i === 0 || i === cw - 1))) c.set(x + i, cy + j, i === 0 || i === cw - 1 || j === 0 ? 0x1e2129 : j < 2 ? 0x4c5366 : 0x363b49);
  c.rect(x + (cw >> 1) - 1, cy + ch, 2, 2, 0x1e2129);
  if (pose === "sleep" && !plan.opts.reducedMotion) c.glyph(x + cw, (y - 2) >> 1, (t >> 2) % 2 ? "z" : "Z", 0xd8ccff);
}

// ---- moving bits of the room -----------------------------------------------

function paintRoomLife(c, plan, t, nowMs, hour) {
  const props = plan.props ?? wallProps(plan);
  const reduced = plan.opts.reducedMotion;
  if (props.clock) {
    const d = new Date(nowMs);
    const k = props.clock;
    const m = (d.getMinutes() / 60) * Math.PI * 2;
    const h = (((d.getHours() % 12) + d.getMinutes() / 60) / 12) * Math.PI * 2;
    c.line(k.x, k.y, k.x + Math.round(Math.sin(m) * (k.r - 1)), k.y - Math.round(Math.cos(m) * (k.r - 1)), 0x2a2830, true);
    c.line(k.x, k.y, k.x + Math.round(Math.sin(h) * (k.r - 2)), k.y - Math.round(Math.cos(h) * (k.r - 2)), 0xb5442b, true);
    c.set(k.x, k.y, 0x1a1420, true);
  }
  if (props.rack) {
    const r = props.rack;
    for (let y = r.y + 2, i = 0; y < r.y + r.h - 2; y += 3, i++) {
      for (let k = 0; k < 3; k++) {
        const on = reduced ? (i + k) % 2 === 0 : hash(`led${i},${k},${Math.floor(t / (1 + k))}`) % 3 !== 0;
        const col = k === 2 ? 0xffb020 : k === 1 ? 0x38bdf8 : 0x4ade80;
        c.set(r.x + r.w - 3 - k * 2, y, on ? col : mix(col, 0x000000, 0.75), true);
      }
    }
  }
  if (props.cooler && !reduced && t % 30 < 6) {
    const b = props.cooler;
    c.set(b.x + 4, b.y + 3 - Math.floor((t % 30) / 2), 0xffffff, true);
  }
  if (skyAt(hour).isNight && !reduced) {
    for (const w of props.windows) {
      const h = hash(`tw${w.x},${Math.floor(t / 5)}`);
      c.set(w.x + (h % w.w), w.y + ((h >> 8) % Math.max(1, w.h - 5)), 0xffffff, true);
    }
  }
}

function paintTags(c, plan) {
  const P = pal(plan);
  for (const tag of plan.tags) {
    const desk = plan.seats[tag.index];
    if (!desk) continue;
    const bg = mix(P.accent[desk.status] ?? 0x888888, 0x0b0b10, 0.62);
    const text = (tag.first ?? "").padEnd(tag.width, " ").slice(0, tag.width);
    for (let i = 0; i < text.length; i++) {
      const isKey = tag.hotkey && i < tag.hotkey.length;
      c.glyph(tag.left + i, tag.top, text[i], isKey ? P.accent[desk.status] ?? 0xffffff : desk.status === "done" ? 0xb4b0c0 : 0xf3f1f8, bg);
    }
  }
}

function paintPips(c, plan, t) {
  plan.seats.forEach((desk, i) => {
    if (!desk) return;
    const x = (i % plan.per) * 7;
    const y = Math.floor(i / plan.per) * 10;
    const look = lookFor(desk, plan.opts.characters, plan.opts.style);
    const palette = palFor(look, desk.status, desk.kind === "process");
    const P = pal(plan);
    c.rect(x, y, 6, 8, 0x16151c);
    if (desk.status === "blocked" && t % 4 < 2) c.rect(x, y, 6, 8, 0x5a1414);
    if (look.isBold) c.sprite(BOLD_SMALL_HEADS[look.kind] ?? BOLD_SMALL_HEADS.critter, x, y + 1, palette);
    else {
      c.sprite(SMALL_HEADS[look.kind] ?? SMALL_HEADS.human, x, y + 1, palette);
      if (look.kind === "human") c.sprite(SMALL_HAIRS[look.hairStyle] ?? SMALL_HAIRS.short, x, y + 1, palette);
    }
    c.rect(x, y + 7, 6, 1, P.accent[desk.status] ?? 0x888888, true);
  });
  paintTags(c, plan);
}
