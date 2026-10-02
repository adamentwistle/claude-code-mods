// Half-block pictures: decode a BMP and pack it as Raster cells, two pixels
// a cell ('▀', foreground the top pixel, background the bottom one).

const UPPER_HALF = 0x2580;
const LOWER_HALF = 0x2584;
const SPACE = 0x20;
const DEFAULT_COLOR = 0x01000000;
// The Raster paints 1024 colour pairs at once; 31 colours plus the
// terminal's default make exactly that many.
const MAX_PAIRS = 1024;
const PALETTE_SIZE = 31;

export function fromBase64(base64) {
  if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(base64);
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toBase64(bytes) {
  if (typeof bytes.toBase64 === "function") return bytes.toBase64();
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function maskShift(mask) {
  if (!mask) return { shift: 0, max: 0 };
  let shift = 0;
  while (((mask >>> shift) & 1) === 0) shift++;
  return { shift, max: mask >>> shift };
}

// An uncompressed BMP (24 or 32 bits, BI_RGB or bitfields, either row
// order) as RGBA pixels, top row first.
export function parseBmp(bytes) {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) throw new Error("not a BMP");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = view.getUint32(10, true);
  const headerSize = view.getUint32(14, true);
  const width = view.getInt32(18, true);
  const rawHeight = view.getInt32(22, true);
  const bpp = view.getUint16(28, true);
  const compression = view.getUint32(30, true);
  const height = Math.abs(rawHeight);
  const isTopDown = rawHeight < 0;
  if (width <= 0 || height <= 0 || (bpp !== 24 && bpp !== 32)) throw new Error(`unsupported BMP (${bpp} bits)`);
  if (compression !== 0 && compression !== 3 && compression !== 6) throw new Error("compressed BMP");

  let masks = bpp === 32 ? [0xff0000, 0xff00, 0xff, 0] : [0xff0000, 0xff00, 0xff, 0];
  if (compression === 3 || compression === 6) {
    // Masks follow a 40-byte header, or sit inside a V4/V5 one.
    const at = 54;
    masks = [view.getUint32(at, true), view.getUint32(at + 4, true), view.getUint32(at + 8, true),
      headerSize >= 56 || compression === 6 ? view.getUint32(at + 12, true) : 0];
  }
  const [r, g, b, a] = masks.map(maskShift);
  const stride = Math.ceil((bpp * width) / 32) * 4;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = offset + (isTopDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (bpp === 24) {
        const p = row + x * 3;
        rgba[o] = bytes[p + 2];
        rgba[o + 1] = bytes[p + 1];
        rgba[o + 2] = bytes[p];
        rgba[o + 3] = 255;
      } else {
        const v = view.getUint32(row + x * 4, true);
        const ch = (m) => (m.max ? Math.round((((v >>> m.shift) & m.max) * 255) / m.max) : 255);
        rgba[o] = ch(r);
        rgba[o + 1] = ch(g);
        rgba[o + 2] = ch(b);
        rgba[o + 3] = a.max ? ch(a) : 255;
      }
    }
  }
  return { width, height, rgba };
}

// Nearest-neighbour resample, for a picture that came back another size.
function resample(img, width, height) {
  if (img.width === width && img.height === height) return img;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(img.height - 1, Math.floor(((y + 0.5) * img.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(img.width - 1, Math.floor(((x + 0.5) * img.width) / width));
      const s = (sy * img.width + sx) * 4, o = (y * width + x) * 4;
      rgba[o] = img.rgba[s]; rgba[o + 1] = img.rgba[s + 1]; rgba[o + 2] = img.rgba[s + 2]; rgba[o + 3] = img.rgba[s + 3];
    }
  }
  return { width, height, rgba };
}

// A median-cut palette over the given colours (0xRRGGBB).
function medianCut(colors, size) {
  let boxes = [colors];
  while (boxes.length < size) {
    let best = -1, bestRange = 0, bestCh = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0;
        for (const c of box) { const v = (c >> (16 - ch * 8)) & 255; if (v < lo) lo = v; if (v > hi) hi = v; }
        if (hi - lo > bestRange) { bestRange = hi - lo; best = i; bestCh = ch; }
      }
    });
    if (best < 0) break;
    const shift = 16 - bestCh * 8;
    const box = boxes[best].slice().sort((p, q) => ((p >> shift) & 255) - ((q >> shift) & 255));
    const mid = box.length >> 1;
    boxes.splice(best, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.filter((b) => b.length).map((box) => {
    let r = 0, g = 0, b = 0;
    for (const c of box) { r += (c >> 16) & 255; g += (c >> 8) & 255; b += c & 255; }
    const n = box.length;
    return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
  });
}

function nearest(palette, c) {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  let best = palette[0], bestD = Infinity;
  for (const p of palette) {
    const dr = ((p >> 16) & 255) - r, dg = ((p >> 8) & 255) - g, db = (p & 255) - b;
    const d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

// RGBA pixels as `columns x rows` half-block cells, base64 for a Raster.
// Transparent pixels show the terminal's own background.
export function cellsOf(img, columns, rows) {
  const px = resample(img, columns, rows * 2);
  const at = (x, y) => {
    const o = (y * columns + x) * 4;
    return px.rgba[o + 3] < 128 ? -1 : (px.rgba[o] << 16) | (px.rgba[o + 1] << 8) | px.rgba[o + 2];
  };
  const tops = new Int32Array(columns * rows), bottoms = new Int32Array(columns * rows);
  const pairs = new Set();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const i = y * columns + x;
      tops[i] = at(x, y * 2);
      bottoms[i] = at(x, y * 2 + 1);
      if (pairs.size <= MAX_PAIRS) pairs.add(tops[i] * 16777217 + bottoms[i]);
    }
  }
  // Too many pairs for the Raster's palette: map to a palette of our own,
  // so the picture degrades evenly instead of by draw order.
  if (pairs.size > MAX_PAIRS) {
    const seen = new Set();
    for (let i = 0; i < tops.length; i++) {
      if (tops[i] >= 0) seen.add(tops[i]);
      if (bottoms[i] >= 0) seen.add(bottoms[i]);
    }
    const palette = medianCut([...seen], PALETTE_SIZE);
    const memo = new Map();
    const map = (c) => {
      if (c < 0) return c;
      let m = memo.get(c);
      if (m === undefined) { m = nearest(palette, c); memo.set(c, m); }
      return m;
    };
    for (let i = 0; i < tops.length; i++) { tops[i] = map(tops[i]); bottoms[i] = map(bottoms[i]); }
  }

  const words = new Uint32Array(columns * rows * 3);
  for (let i = 0; i < tops.length; i++) {
    const t = tops[i], b = bottoms[i], o = i * 3;
    if (t < 0 && b < 0) { words[o] = SPACE; words[o + 1] = DEFAULT_COLOR; words[o + 2] = DEFAULT_COLOR; }
    else if (t < 0) { words[o] = LOWER_HALF; words[o + 1] = b; words[o + 2] = DEFAULT_COLOR; }
    else { words[o] = UPPER_HALF; words[o + 1] = t; words[o + 2] = b < 0 ? DEFAULT_COLOR : b; }
  }
  return toBase64(new Uint8Array(words.buffer));
}
