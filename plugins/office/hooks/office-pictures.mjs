// Office: the picture characters. Kenney's CC0 people (assets/office-atlas.*)
// and the mod's own robots, critters and animals, each drawn as a small
// picture for one box of cells: the hybrid view's people and the tiles'
// portraits. Pure: the pane and bin/office-monitor both call it.
//
// Sharpness: a mod cannot learn a cell's size in pixels, so a picture is
// composed at one pixel per half cell, then enlarged pixel for pixel by a
// large whole number and sent as a PNG. The terminal then only ever shrinks
// a crisp picture, never smooths up a tiny one; enlarged pixels compress to
// almost nothing.

import { CAT, CONFETTI_HD, CRITTER, CROWN, DOG, HD_FURS, OWL, ROBOT } from "./office-art-hd.mjs";
import { mix } from "./office-art.mjs";
import { hash, kindFor } from "./office-model.mjs";
import { poseFor } from "./office-scene.mjs";

// ---- atlas ------------------------------------------------------------------

/**
 * The sprite atlas from its JSON (text or parsed) and its index bytes: every
 * tile by name (`chr:0,0`), each pixel a palette index, 0 clear.
 */
export function loadAtlas(json, bytes) {
  const meta = typeof json === "string" ? JSON.parse(json) : json;
  if (!meta || !Array.isArray(meta.palette) || !meta.sprites) throw new Error("not an office atlas");
  if (!bytes || bytes.length !== meta.width * meta.height) throw new Error("atlas size does not match its bytes");
  const rgb = meta.palette.map(([r, g, b, a]) => (a ? (r << 16) | (g << 8) | b : -1));
  return { width: meta.width, height: meta.height, idx: bytes, rgb, sprites: meta.sprites };
}

// ---- a small picture ----------------------------------------------------------------

// Pixels as 0xRRGGBB, -1 for clear.
class Pic {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Int32Array(w * h).fill(-1);
  }
  set(x, y, c) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || c == null || c < 0) return;
    this.px[y * this.w + x] = c;
  }
  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  tile(atlas, name, x, y, rows = 16) {
    const r = atlas.sprites[name];
    if (!r) return;
    const [sx, sy, w, h] = r;
    for (let j = 0; j < Math.min(h, rows); j++) {
      for (let i = 0; i < w; i++) {
        const k = atlas.idx[(sy + j) * atlas.width + sx + i];
        if (k) this.set(x + i, y + j, atlas.rgb[k]);
      }
    }
  }
  map(rows, pal, x, y) {
    rows.forEach((row, j) => [...row].forEach((k, i) => k !== "." && pal[k] != null && this.set(x + i, y + j, pal[k])));
  }
}

// ---- looks ------------------------------------------------------------------------

/**
 * A person's layers, picked from the session's hash so a session always
 * looks the same: body (skin), trousers, shoes, top, hair, maybe a beard.
 */
export function pictureLook(desk, characters) {
  const seed = hash(`hd:${desk.sessionId || desk.paneId || desk.name}`);
  const kind = kindFor(desk, characters);
  const pick = (n, shift) => (seed >>> shift) % n;
  const leg = 1 + pick(9, 3);
  const hairCol = [19, 20, 23, 24][pick(4, 14)];
  const hairRow = [0, 1, 4, 5, 8, 9][pick(6, 17)];
  const beard = pick(5, 21) === 0 ? `chr:${hairCol < 23 ? 21 : 25},${hairRow - (hairRow % 4)}` : null;
  const furs = HD_FURS[kind];
  return {
    kind,
    layers: [`chr:${pick(2, 0)},${pick(3, 1)}`, `chr:3,${leg}`, `chr:4,${leg}`, `chr:${6 + pick(12, 7)},${[0, 1, 2, 5, 6, 7][pick(6, 11)]}`, `chr:${hairCol},${hairRow}`, ...(beard ? [beard] : [])],
    fur: furs ? furs[pick(furs.length, 24)] : null,
  };
}

function creaturePal(look, desk) {
  const isProcess = desk.kind === "process";
  switch (look.kind) {
    case "robot": {
      const visor = isProcess ? 0xffa53a : desk.status === "blocked" ? 0xff4d4d : 0x5ee7ff;
      return isProcess
        ? { m: 0xd98a4a, M: 0xa8622c, v: visor, V: 0xffffff, c: 0xe8a060, L: 0xfff1a0, a: 0xff5c5c }
        : { m: 0xb4bcc8, M: 0x7d8594, v: visor, V: 0xffffff, c: 0x96a0b0, L: 0x5fcf55, a: 0xff5c5c };
    }
    case "critter":
      return { q: 0xd97757, Q: 0xa8553a, e: 0x2a1a14, h: 0xf09a78 };
    default: {
      const [f, d] = look.fur ?? [0xd2a676, 0x8a5c38];
      return { F: f, D: d, E: mix(d, 0x000000, 0.2), w: 0xf6f0e6, e: 0x1e1a1c, n: 0x3a2a2a, m: 0x8a4a4a, p: 0xf0a0b4, y: 0xf2c94c, b: 0xe0a030 };
    }
  }
}

const CREATURES = { robot: ROBOT, critter: CRITTER, cat: CAT, dog: DOG, owl: OWL };

// One person, 16 x 20, chair behind, in the pose of the moment.
function personPic(atlas, desk, characters, tick, nowMs, reducedMotion) {
  const one = new Pic(16, 20);
  const look = pictureLook(desk, characters);
  const pose = poseFor(desk, nowMs, reducedMotion);
  const t = reducedMotion ? 0 : tick;
  const dy = { type: t % 2, wave: [0, -1, -2, -1][t % 4], celebrate: [0, -2, -1][t % 3], sleep: 3 }[pose] ?? 0;
  one.tile(atlas, "ind:0,8", 0, 5);
  if (look.kind === "human") for (const name of look.layers) one.tile(atlas, name, 0, 4 + dy);
  else one.map(CREATURES[look.kind] ?? CRITTER, creaturePal(look, desk), 0, 4 + dy);
  if (pose === "stretch" || pose === "celebrate" || pose === "wave") {
    const sk = look.kind === "human" ? 0xe5c49d : creaturePal(look, desk).F ?? 0xd97757;
    const up = t % 2;
    one.rect(0, 1 + dy + up, 2, 7, sk);
    one.rect(14, 1 + dy + (1 - up), 2, 7, sk);
  }
  if (desk.isSelf) one.map(CROWN, { y: 0xffd23f, Y: 0xe0a810 }, 5, 1 + dy);
  if (pose === "celebrate" && t) {
    for (let k = 0; k < 6; k++) {
      const h = hash(`pc${desk.paneId}${k}`);
      one.set(h % 16, ((h >>> 5) + t * (1 + (k % 2))) % 20, CONFETTI_HD[k % CONFETTI_HD.length]);
    }
  }
  return one;
}

/**
 * A character for one box of cells, at one pixel per half cell (finer for a
 * box smaller than a person): the box's
 * background (the room's own pixels beneath it, from `bg`, or a plain
 * `fill`), the person laid in at the largest whole-number scale that fits,
 * standing on the box's bottom edge (the desk top). Returns the small picture.
 */
export function characterBox(atlas, desk, characters, tick, nowMs, reducedMotion, box, bg, fill = 0x1d1f2c) {
  // A box smaller than a person (a sidebar's small desks, a tile) is drawn
  // a whole number of times finer, keeping its shape: `m` pixels per half
  // cell. The background is the room's pixel beneath, repeated m x m, so it
  // still lines up exactly with the cells around the box.
  const m = Math.max(1, Math.ceil(Math.max(16 / box.columns, 16 / (box.rows * 2))));
  const W = box.columns * m;
  const H = box.rows * 2 * m;
  const pic = new Pic(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const by = Math.min(bg ? bg.h - 1 : 0, box.top * 2 + Math.floor(y / m));
      const bx = Math.min(bg ? bg.w - 1 : 0, box.left + Math.floor(x / m));
      pic.px[y * W + x] = bg ? bg.px[by * bg.w + bx] & 0xffffff : fill;
    }
  }
  const one = personPic(atlas, desk, characters, tick, nowMs, reducedMotion);
  const scale = Math.max(1, Math.floor(Math.min(W / 16, (H + 4) / 20)));
  const ox = Math.floor((W - 16 * scale) / 2);
  // The last four rows (legs) go below the box: the desk hides them.
  const oy = H - 16 * scale;
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 16; x++) {
      const c = one.px[y * 16 + x];
      if (c < 0) continue;
      for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) pic.set(ox + x * scale + i, oy + y * scale + j, c);
    }
  }
  return pic;
}

/** Whether a desk's picture moves (and so is sent again now and then). */
export function portraitMoves(desk, reducedMotion) {
  if (reducedMotion || !desk) return false;
  return desk.status === "working" || desk.status === "blocked" || desk.status === "running" || Boolean(desk.unseenDone);
}

// ---- sharp PNGs -----------------------------------------------------------------------

/**
 * How much to enlarge a box's picture. A mod cannot know a cell's size in
 * pixels; a half cell on a Retina screen is about 16 by 17, so 16 times keeps
 * the terminal shrinking the picture, never stretching it, at most 640 wide.
 */
export function sharpFactor(pic) {
  return Math.max(4, Math.min(16, Math.floor(640 / Math.max(pic.w, pic.h))));
}

/**
 * The picture enlarged `factor` times pixel for pixel, as a whole PNG. Each
 * row is filtered against its left neighbour, or the row above when equal,
 * so enlarged pixels become runs of zero bytes, which the deflate below
 * stores as back-references: 3 to 11 KB for a character.
 */
export function sharpPng(pic, factor = sharpFactor(pic)) {
  const W = pic.w * factor;
  const H = pic.h * factor;
  const stride = W * 4 + 1;
  const raw = new Uint8Array(stride * H);
  const row = new Uint8Array(W * 4);
  for (let y = 0; y < pic.h; y++) {
    for (let x = 0; x < pic.w; x++) {
      const c = pic.px[y * pic.w + x];
      const r = c < 0 ? 0 : (c >> 16) & 255;
      const g = c < 0 ? 0 : (c >> 8) & 255;
      const b = c < 0 ? 0 : c & 255;
      const a = c < 0 ? 0 : 255;
      for (let i = 0; i < factor; i++) {
        const at = (x * factor + i) * 4;
        row[at] = r;
        row[at + 1] = g;
        row[at + 2] = b;
        row[at + 3] = a;
      }
    }
    // First copy of the row: Sub filter (each byte less the one four before).
    const first = y * factor * stride;
    raw[first] = 1;
    for (let i = 0; i < row.length; i++) raw[first + 1 + i] = (row[i] - (i >= 4 ? row[i - 4] : 0)) & 255;
    // The repeats: Up filter, all zeros.
    for (let j = 1; j < factor; j++) raw[first + j * stride] = 2;
  }
  return png(W, H, deflate(raw));
}

// zlib, one fixed-Huffman block, literals and distance-1 runs.
function deflate(data) {
  const out = [];
  let bits = 0;
  let nbits = 0;
  const put = (value, n) => {
    bits |= value << nbits;
    nbits += n;
    while (nbits >= 8) {
      out.push(bits & 255);
      bits >>>= 8;
      nbits -= 8;
    }
  };
  // Huffman codes go most significant bit first.
  const code = (c, n) => {
    let r = 0;
    for (let i = 0; i < n; i++) r |= ((c >> i) & 1) << (n - 1 - i);
    put(r, n);
  };
  const literal = (v) => (v < 144 ? code(0x30 + v, 8) : code(0x190 + v - 144, 9));
  const symbol = (s) => (s < 280 ? code(s - 256, 7) : code(0xc0 + s - 280, 8));
  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const length = (len) => {
    let i = LBASE.length - 1;
    while (LBASE[i] > len) i--;
    symbol(257 + i);
    if (LEXTRA[i]) put(len - LBASE[i], LEXTRA[i]);
    code(0, 5); // distance 1
  };
  out.push(0x78, 0x01);
  put(1, 1);
  put(1, 2);
  let i = 0;
  while (i < data.length) {
    if (i > 0) {
      let run = 0;
      while (run < 258 && i + run < data.length && data[i + run] === data[i - 1]) run++;
      if (run >= 3) {
        length(run);
        i += run;
        continue;
      }
    }
    literal(data[i]);
    i++;
  }
  symbol(256);
  if (nbits) out.push(bits & 255);
  let a = 1;
  let b = 0;
  for (let k = 0; k < data.length; k++) {
    a = (a + data[k]) % 65521;
    b = (b + a) % 65521;
  }
  out.push((b >>> 8) & 255, b & 255, (a >>> 8) & 255, a & 255);
  return Uint8Array.from(out);
}

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function png(W, H, idat) {
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    let c = -1;
    for (let i = 4; i < 8 + data.length; i++) c = CRC[(c ^ out[i]) & 255] ^ (c >>> 8);
    dv.setUint32(8 + data.length, (c ^ -1) >>> 0);
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, W);
  dv.setUint32(4, H);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
