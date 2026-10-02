// Viewfinder: shows the images Claude looks at (browser screenshots, image
// files it reads, image blocks in any tool result) in a pane beside the
// transcript.
//
// Function hooks for Claude Code 2.1.287. Load with --plugin-dir.

import { cellsOf, fromBase64, parseBmp } from "./raster.mjs";

const PANE_ID = "viewfinder";
const PANE_TITLE = "Viewfinder";
const MAX_ENTRIES = 20;
const MAX_INLINE_BYTES = 2 * 1024 * 1024;
// The band's picture stays compact: at most this many rows.
const BAND_PICTURE_ROWS = 8;
// Terminal cells are about twice as tall as they are wide.
const CELL_ASPECT = 2;
// Rows the pane spends on the caption and the two rows of controls.
const CHROME_ROWS = 3;
// Image box limits, and the Raster's.
const IMAGE_MAX = { columns: 255, rows: 255 };
const RASTER_MAX = { columns: 512, rows: 256 };
const PROBE_DELAY_MS = 150;
const PROBE_TRIES = 6;
const BLOCK_CACHE = 4;
const IMAGE_PATH = /\.(png|jpe?g|gif|webp)$/i;
const IMAGE_PATH_IN_TEXT = /(\/[^\s"'`()<>[\]]+\.(?:png|jpe?g|gif|webp))/gi;
const ARG_PATH_FIELDS = ["filePath", "filename", "path", "file_path", "savePath", "outputPath"];

// Module state. `entries` is the history, oldest first; `index` the one shown.
const state = {
  entries: [],
  index: -1,
  isOpen: false,
  isPlaced: false,
  // Set when the person closed the pane: no auto-open until /viewfinder.
  isDismissed: false,
  // The latest image shown in the band above the prompt.
  inBand: false,
  seq: 0,
  tmpDir: null,
  queue: Promise.resolve(),
  // Whether this terminal draws Image pixels: unknown until a blit says.
  imageSupport: "unknown",
  // Whether it reads { file } sources; false: send the bytes instead.
  filesReadable: "unknown",
  probeTimer: null,
  probeTries: 0,
  // Half-block frames by entry and size, and the ones being drawn.
  blocks: new Map(),
  drawing: new Set(),
  failed: new Set(),
  isFull: false,
  viewport: { columns: 0, rows: 0 },
  // The `render` option: auto, image or blocks.
  render: "auto",
};

function baseName(path) {
  const s = String(path || "");
  const cut = s.lastIndexOf("/");
  return cut < 0 ? s : s.slice(cut + 1);
}

function shortTool(tool) {
  const s = String(tool || "");
  const m = /^mcp__.+?__(.+)$/.exec(s);
  return m ? m[1] : s;
}

function isPngPath(path) {
  return /\.png$/i.test(path);
}

function decodeHead(base64, bytes) {
  const head = String(base64).slice(0, Math.ceil(bytes / 3) * 4);
  if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(head);
  const bin = atob(head);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Width and height from a PNG's IHDR chunk, or undefined.
function pngSize(base64) {
  try {
    const b = decodeHead(base64, 24);
    if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return undefined;
    const word = (o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
    const width = word(16), height = word(20);
    return width > 0 && height > 0 ? { width, height } : undefined;
  } catch {
    return undefined;
  }
}

// Image blocks anywhere in a tool result: MCP's `{ type, data, mimeType }`
// and the Messages API's `{ type, source: { data, media_type } }`.
function findImageBlocks(value, depth = 0, out = []) {
  if (!value || typeof value !== "object" || depth > 5 || out.length >= 4) return out;
  if (Array.isArray(value)) {
    for (const v of value) findImageBlocks(v, depth + 1, out);
    return out;
  }
  if (value.type === "image") {
    if (typeof value.data === "string" && value.data) {
      out.push({ data: value.data, mime: String(value.mimeType || value.media_type || "image/png") });
      return out;
    }
    const src = value.source;
    if (src && typeof src.data === "string" && src.data) {
      out.push({ data: src.data, mime: String(src.media_type || src.mimeType || "image/png") });
      return out;
    }
  }
  for (const k of Object.keys(value)) {
    if (k === "data" || k === "base64") continue;
    findImageBlocks(value[k], depth + 1, out);
  }
  return out;
}

function textsOf(result) {
  const texts = [];
  if (typeof result?.text === "string") texts.push(result.text);
  const content = Array.isArray(result?.result) ? result.result : result?.result?.content;
  if (Array.isArray(content)) {
    for (const b of content) if (b && b.type === "text" && typeof b.text === "string") texts.push(b.text);
  } else if (typeof result?.result === "string") {
    texts.push(result.result);
  }
  return texts;
}

// What one finished tool call showed Claude, or undefined. Synchronous and
// cheap: the files and conversions are handled later, off the call's path.
function captureOf(e, r) {
  if (!r || r.deny !== undefined || r.isError) return undefined;
  const tool = String(e.tool);

  if (tool === "Read") {
    const res = r.result;
    const isImage = res?.type === "image" || IMAGE_PATH.test(String(e.file_path || ""));
    if (!isImage) return undefined;
    const dims = res?.file?.dimensions;
    const size = dims?.originalWidth && dims?.originalHeight
      ? { width: dims.originalWidth, height: dims.originalHeight }
      : undefined;
    const blocks = res?.type === "image" && typeof res.file?.base64 === "string"
      ? [{ data: res.file.base64, mime: String(res.file.type || "image/png") }]
      : [];
    return { tool, label: baseName(e.file_path), paths: e.file_path ? [String(e.file_path)] : [], blocks, size };
  }

  const isScreenshot = /screenshot/i.test(tool);
  const blocks = findImageBlocks(r.result);
  if (!isScreenshot && !blocks.length) return undefined;

  const paths = [];
  const texts = textsOf(r);
  if (isScreenshot) {
    for (const f of ARG_PATH_FIELDS) {
      const v = e[f];
      if (typeof v === "string" && v.startsWith("/") && IMAGE_PATH.test(v)) paths.push(v);
    }
    for (const t of texts) for (const m of t.matchAll(IMAGE_PATH_IN_TEXT)) paths.push(m[1]);
  }
  if (!paths.length && !blocks.length) return undefined;

  let label = "";
  for (const t of texts) {
    const m = /Page URL:\s*(\S+)/i.exec(t) || /\burl[:=]\s*(https?:\/\/\S+)/i.exec(t);
    if (m) { label = m[1]; break; }
  }
  if (!label && typeof e.url === "string") label = e.url;
  if (!label && paths.length) label = baseName(paths[0]);
  if (!label) label = shortTool(tool);
  return { tool, label, paths: [...new Set(paths)], blocks, size: undefined };
}

async function tmpDir($) {
  if (state.tmpDir) return state.tmpDir;
  let base = "/tmp";
  try { base = ((await $.env.get("TMPDIR")) || "/tmp").replace(/\/+$/, ""); } catch { /* keep /tmp */ }
  let id = "session";
  try { id = String(await $.session.id()).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "session"; } catch { /* keep */ }
  const dir = `${base}/viewfinder-${id}`;
  const made = await $.process.run(["mkdir", "-p", dir]);
  if (made.exitCode !== 0) throw new Error("mkdir failed");
  state.tmpDir = dir;
  return dir;
}

async function run($, argv, init) {
  const r = await $.process.run(argv, init);
  if (r.exitCode !== 0) throw new Error(`${argv[0]} exited ${r.exitCode}`);
  return r;
}

// A copy of a file Claude looked at, as PNG in our temp folder, so the pane
// shows what Claude saw even if the file changes later.
async function pngCopyOf($, path) {
  const dir = await tmpDir($);
  const out = `${dir}/${++state.seq}.png`;
  if (isPngPath(path)) await run($, ["cp", path, out]);
  else await run($, ["sips", "-s", "format", "png", path, "--out", out]);
  return out;
}

async function pngFileOfBlock($, block) {
  const dir = await tmpDir($);
  const n = ++state.seq;
  const isPng = /png/i.test(block.mime);
  const raw = isPng ? `${dir}/${n}.png` : `${dir}/${n}.src`;
  await run($, ["base64", "-D", "-o", raw], { stdin: block.data });
  if (isPng) return raw;
  const out = `${dir}/${n}.png`;
  await run($, ["sips", "-s", "format", "png", raw, "--out", out]);
  await $.process.run(["rm", "-f", raw]).catch(() => undefined);
  return out;
}

async function sizeOfFile($, path) {
  try {
    const r = await $.process.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", path]);
    const w = /pixelWidth:\s*(\d+)/.exec(r.stdout), h = /pixelHeight:\s*(\d+)/.exec(r.stdout);
    if (w && h) return { width: Number(w[1]), height: Number(h[1]) };
  } catch { /* unknown size: fill the box */ }
  return undefined;
}

// Turns a capture into an entry: a PNG file where possible, bytes otherwise.
async function entryOf($, cap) {
  let file, display, isTemp = false;
  for (const p of cap.paths) {
    let exists = false;
    try { exists = await $.fs.exists(p); } catch { /* treat as missing */ }
    if (!exists) continue;
    display = p;
    try { file = await pngCopyOf($, p); isTemp = true; }
    catch { if (isPngPath(p)) file = p; }
    if (file) break;
  }
  let png;
  if (!file) {
    for (const b of cap.blocks) {
      try { file = await pngFileOfBlock($, b); isTemp = true; break; }
      catch {
        if (/png/i.test(b.mime) && b.data.length * 0.75 <= MAX_INLINE_BYTES) { png = b.data; break; }
      }
    }
  }
  if (!file && !png) return undefined;

  let size = cap.size;
  if (!size && png) size = pngSize(png);
  if (!size) {
    const pngBlock = cap.blocks.find((b) => /png/i.test(b.mime));
    if (pngBlock) size = pngSize(pngBlock.data);
  }
  if (!size && file) size = await sizeOfFile($, file);

  let at = 0;
  try { at = await $.clock.now(); } catch { /* no time */ }
  return {
    id: state.seq,
    tool: shortTool(cap.tool),
    label: cap.label,
    path: display || file || "",
    file,
    png,
    isTemp,
    size,
    at,
  };
}

function addEntry($, entry) {
  state.entries.push(entry);
  while (state.entries.length > MAX_ENTRIES) {
    const old = state.entries.shift();
    if (old.isTemp && old.file) $.process.run(["rm", "-f", old.file]).catch(() => undefined);
  }
  state.index = state.entries.length - 1;
}

// Every new image is shown: in the pane, or, where an unasked pane is not
// placed (a narrow terminal), in the band above the prompt.
async function show($, entry, autoOpen) {
  if (!autoOpen) {
    if (state.isOpen) $.ui.invalidate("ui.render");
    return;
  }
  state.isDismissed = false;
  if (!state.isOpen || !state.isPlaced) {
    const opened = await $.ui.open({ id: PANE_ID, title: PANE_TITLE });
    state.isOpen = true;
    state.isPlaced = opened?.isPlaced === true;
  }
  state.inBand = !state.isPlaced;
  $.ui.invalidate("ui.render");
}

async function processCapture($, cap, autoOpen) {
  const entry = await entryOf($, cap);
  if (!entry) return;
  addEntry($, entry);
  await show($, entry, autoOpen);
}

function timeOf(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const two = (n) => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

// The picture's box in cells: as large as the room allows, aspect kept.
// A cell is about twice as tall as wide, so a half-block pixel is square.
function fitCells(size, cols, rows, max) {
  const maxCols = Math.max(1, Math.min(max.columns, cols));
  const maxRows = Math.max(1, Math.min(max.rows, rows));
  if (!size) return { columns: maxCols, rows: maxRows };
  const ratio = (size.width * CELL_ASPECT) / size.height;
  let h = maxRows;
  let w = Math.round(h * ratio);
  if (w > maxCols) {
    w = maxCols;
    h = Math.round(w / ratio);
  }
  return { columns: Math.max(1, Math.min(maxCols, w)), rows: Math.max(1, Math.min(maxRows, h)) };
}

function current() {
  const n = state.entries.length;
  return n ? state.entries[Math.max(0, Math.min(state.index, n - 1))] : undefined;
}

function go($, to) {
  const n = state.entries.length;
  if (!n) return;
  state.index = Math.max(0, Math.min(n - 1, to));
  $.ui.invalidate("ui.render");
}

function closePane($) {
  state.isOpen = false;
  state.isPlaced = false;
  state.isDismissed = true;
  state.isFull = false;
  $.ui.close({ id: PANE_ID });
}

// Opens the pane as the person asked: the share Claude Code gives it, or
// full, as wide and tall as the layout spares.
async function openPane($, full, columns) {
  state.isDismissed = false;
  state.inBand = false;
  state.isFull = full;
  const size = full
    ? { columns: Math.max(40, (columns || state.viewport.columns || 300) - 1), rows: Math.max(12, state.viewport.rows || 100) }
    : {};
  const opened = await $.ui.open({ id: PANE_ID, title: PANE_TITLE, focus: true, ...size });
  state.isOpen = true;
  state.isPlaced = opened?.isPlaced === true;
  $.ui.invalidate("ui.render");
  return state.isPlaced;
}

function imageSourceOf(entry) {
  if (entry.file && state.filesReadable !== false) return { file: entry.file, format: "png" };
  if (entry.png) return { png: entry.png };
  return undefined;
}

function wantsImage() {
  if (state.render === "blocks") return false;
  if (state.render === "image") return true;
  return state.imageSupport !== "no";
}

// The terminal says through a blit whether the Image drew pixels or its
// alt: no capability flag reaches a plugin, so ask once it is mounted.
function scheduleProbe($, requestId) {
  if (state.probeTimer || state.probeTries >= PROBE_TRIES) return;
  state.probeTimer = $.clock.after(PROBE_DELAY_MS, () => {
    state.probeTimer = null;
    probe($, requestId).catch(() => undefined);
  });
}

async function probe($, requestId) {
  const entry = current();
  const source = entry && imageSourceOf(entry);
  if (!source || !(state.isOpen || state.inBand)) return;
  state.probeTries++;
  const r = await $.ui.blit({ requestId, key: "shot", source });
  const why = r?.deny;
  if (!why) {
    state.imageSupport = "yes";
    if (source.file) state.filesReadable = true;
    state.probeTries = 0;
    return;
  }
  if (/cannot read files/i.test(why)) {
    state.filesReadable = false;
    state.probeTries = 0;
    await ensureBytes($, entry);
    $.ui.invalidate("ui.render");
    return;
  }
  if (/draws its alt/i.test(why)) {
    state.imageSupport = "no";
    $.ui.invalidate("ui.render");
    return;
  }
  // Not mounted yet, or the terminal has not answered: ask again.
  scheduleProbe($, requestId);
}

// PNG bytes for a terminal that cannot read our files.
async function ensureBytes($, entry) {
  if (!entry || entry.png || !entry.file) return;
  try {
    const st = await $.fs.stat(entry.file);
    if (st.size > MAX_INLINE_BYTES) return;
    const read = await $.fs.read(entry.file, { as: "bytes" });
    entry.png = read.base64;
  } catch { /* stays a file source */ }
}

function blockKey(entry, box) {
  return `${entry.id}:${box.columns}x${box.rows}`;
}

// Draws one half-block frame off the render path: sips scales the PNG to
// the box's pixels as a BMP, which is parsed here.
function scheduleBlocks($, entry, box) {
  const key = blockKey(entry, box);
  if (state.drawing.has(key) || state.failed.has(key) || !entry.file) return;
  state.drawing.add(key);
  $.clock.after(0, () => {
    state.queue = state.queue
      .then(() => drawBlocks($, entry, box, key))
      .catch(() => { state.failed.add(key); })
      .then(() => { state.drawing.delete(key); $.ui.invalidate("ui.render"); });
  });
}

async function drawBlocks($, entry, box, key) {
  const dir = await tmpDir($);
  const bmp = `${dir}/frame-${entry.id}.bmp`;
  try {
    await run($, ["sips", "-s", "format", "bmp", "-z", String(box.rows * 2), String(box.columns), entry.file, "--out", bmp]);
    const read = await $.fs.read(bmp, { as: "bytes" });
    const img = parseBmp(fromBase64(read.base64));
    state.blocks.set(key, cellsOf(img, box.columns, box.rows));
    while (state.blocks.size > BLOCK_CACHE) state.blocks.delete(state.blocks.keys().next().value);
  } finally {
    $.process.run(["rm", "-f", bmp]).catch(() => undefined);
  }
}

async function openInPreview($, entry) {
  const r = await $.process.run(["open", "-a", "Preview", entry.file]).catch(() => undefined);
  if (r?.exitCode !== 0) $.ui.toast("Viewfinder: could not open Preview");
}

async function copyImage($, entry) {
  const r = await $.process.run([
    "osascript",
    "-e", "on run argv",
    "-e", "set the clipboard to (read (POSIX file (item 1 of argv)) as «class PNGf»)",
    "-e", "end run",
    entry.file,
  ]).catch(() => undefined);
  $.ui.toast(r?.exitCode === 0 ? "Viewfinder: image copied" : "Viewfinder: could not copy the image");
}

async function copyPath($, entry, surface) {
  const r = await $.ui.copy({ text: entry.path, surface }).catch(() => undefined);
  $.ui.toast(r?.isCopied ? "Viewfinder: path copied" : "Viewfinder: could not copy the path");
}

function pictureOf($, e, entry, cols, rows) {
  const { Text } = $.ui.resolve(e);
  if (e.surface !== "terminal") {
    return Text({ wrap: "truncate-start", children: entry.path || "(image held in memory)" });
  }
  const { Image, Raster } = $.ui.resolve(e);
  const alt = `Image: ${entry.label}`;
  if (wantsImage()) {
    const source = imageSourceOf(entry);
    if (source) {
      const box = fitCells(entry.size, cols, rows, IMAGE_MAX);
      if (state.imageSupport === "unknown" || (source.file && state.filesReadable === "unknown")) scheduleProbe($, e.requestId);
      return Image({ key: "shot", source, columns: box.columns, rows: box.rows, alt });
    }
  }
  const box = fitCells(entry.size, cols, rows, RASTER_MAX);
  const cells = state.blocks.get(blockKey(entry, box));
  if (cells) return Raster({ key: "blocks", columns: box.columns, rows: box.rows, cells });
  const key = blockKey(entry, box);
  if (state.failed.has(key) || !entry.file) return Text({ dimColor: true, children: alt });
  scheduleBlocks($, entry, box);
  return Text({ dimColor: true, children: `Drawing ${entry.label}...` });
}

function paneView($, e) {
  const { Box, Text, Button } = $.ui.resolve(e);
  const cols = Math.max(10, e.props?.bodyColumns || e.viewport?.columns || 60);
  const bodyRows = e.props?.scroll?.bodyRows || e.viewport?.rows || 20;
  if (e.viewport?.columns) state.viewport = { columns: e.viewport.columns, rows: e.viewport.rows };
  const total = state.entries.length;
  const close = Button({ key: "close", label: "Close", hotkey: "c", plain: true, onPress: () => closePane($) });

  if (!total) {
    return Box({ flexDirection: "column", children: [
      Text({ dimColor: true, children: "No images yet. Screenshots and images Claude reads show up here." }),
      Box({ flexDirection: "row", gap: 2, children: [close] }),
    ] });
  }

  const k = Math.max(0, Math.min(state.index, total - 1));
  const entry = state.entries[k];
  const caption = [entry.tool, entry.label, timeOf(entry.at)].filter(Boolean).join(" · ");
  const actions = [
    Button({ key: "full", label: state.isFull ? "Restore" : "Full", hotkey: "f", plain: true,
      onPress: () => openPane($, !state.isFull) }),
  ];
  if (entry.file) {
    actions.push(
      Button({ key: "open", label: "Preview", hotkey: "o", plain: true, onPress: () => openInPreview($, entry) }),
      Button({ key: "copy", label: "Copy image", hotkey: "y", plain: true, onPress: () => copyImage($, entry) }),
    );
  }
  if (entry.path) {
    actions.push(Button({ key: "copy-path", label: "Copy path", hotkey: "w", plain: true,
      onPress: (press) => copyPath($, entry, press.surface) }));
  }

  return Box({ flexDirection: "column", children: [
    pictureOf($, e, entry, cols, Math.max(1, bodyRows - CHROME_ROWS)),
    Text({ key: "caption", dimColor: true, wrap: "truncate-end", children: caption }),
    Box({ flexDirection: "row", gap: 2, children: [
      Text({ key: "count", bold: true, children: `${k + 1} of ${total}` }),
      Button({ key: "prev", label: "Prev", hotkey: "p", plain: true, onPress: () => go($, k - 1) }),
      Button({ key: "next", label: "Next", hotkey: "n", plain: true, onPress: () => go($, k + 1) }),
      close,
    ] }),
    Box({ flexDirection: "row", gap: 2, flexWrap: "wrap", children: actions }),
  ] });
}

function hideBand($) {
  state.inBand = false;
  $.ui.invalidate("ui.render");
}

// The band: the latest image, compact, under whatever the band already holds.
async function bandView($, e, next) {
  const below = await next(e);
  const entry = current();
  if (!entry) return below;
  const { Box, Text, Button } = $.ui.resolve(e);
  const cols = Math.max(10, e.props?.bodyColumns || 80);
  const rows = Math.max(1, Math.min(BAND_PICTURE_ROWS, (e.props?.maxRows || 12) - 3));
  const total = state.entries.length;
  const k = Math.max(0, Math.min(state.index, total - 1));
  const caption = [entry.tool, entry.label, timeOf(entry.at), total > 1 ? `${k + 1} of ${total}` : ""]
    .filter(Boolean).join(" · ");
  const keys = [Button({ key: "band-view", label: "View", hotkey: "v", plain: true, onPress: () => openPane($, false) })];
  if (total > 1) {
    keys.push(
      Button({ key: "band-prev", label: "Prev", hotkey: "p", plain: true, onPress: () => go($, k - 1) }),
      Button({ key: "band-next", label: "Next", hotkey: "n", plain: true, onPress: () => go($, k + 1) }),
    );
  }
  keys.push(Button({ key: "band-dismiss", label: "Dismiss", hotkey: "x", plain: true, onPress: () => hideBand($) }));
  return Box({ flexDirection: "column", children: [
    below,
    Box({ flexDirection: "column", paddingX: 1, children: [
      pictureOf($, e, entry, cols - 2, rows),
      Text({ key: "band-caption", dimColor: true, wrap: "truncate-end", children: caption }),
      Box({ flexDirection: "row", gap: 2, children: keys }),
    ] }),
  ] });
}

export function register(on, options) {
  const autoOpen = options?.autoOpen !== false;
  state.render = ["auto", "image", "blocks"].includes(options?.render) ? options.render : "auto";

  on("session.start", async ($, e, next) => {
    const r = await next(e);
    try {
      await $.command.register({
        name: "viewfinder",
        description: "Show the images Claude has looked at in a pane (full: as large as it goes)",
        argumentHint: "[full]",
        immediate: true,
      });
    } catch { /* the pane still auto-opens */ }
    return r;
  });

  on("command.run", { command: "viewfinder" }, async ($, e) => {
    if (state.entries.length) state.index = state.entries.length - 1;
    const full = /^\s*full\b/i.test(e.args || "");
    const placed = await openPane($, full, e.presentation?.columns);
    const n = state.entries.length;
    if (!placed) return { text: "Viewfinder: this surface has no room for a pane right now." };
    return { text: n ? `Viewfinder: ${n} image${n === 1 ? "" : "s"}.` : "Viewfinder: no images yet." };
  });

  // Observe-only: the call runs and its result goes back untouched. The
  // files and conversions run on a timer, off the call's path.
  on("tool.call", async ($, e, next) => {
    const r = await next(e);
    try {
      const cap = captureOf(e, r);
      if (cap) {
        $.clock.after(0, () => {
          state.queue = state.queue
            .then(() => processCapture($, cap, autoOpen))
            .catch(() => undefined);
        });
      }
    } catch { /* never let capture touch the call */ }
    return r;
  });

  on("ui.render", { component: "Pane", requestId: PANE_ID }, ($, e) => {
    state.isOpen = true;
    state.isPlaced = true;
    state.inBand = false;
    return paneView($, e);
  });

  on("ui.render", { component: "AbovePrompt" }, ($, e, next) => {
    if (!state.inBand || state.isPlaced || !state.entries.length) return next(e);
    return bandView($, e, next);
  });

  // The band's picture goes when the person moves on.
  on("prompt.submit", ($, e, next) => {
    if (state.inBand) hideBand($);
    return next(e);
  });

  // The mod's own close resets state in closePane, so only the person's close
  // and an unload land here (matching the mod's own would re-enter the hook)
  on("ui.close", { id: PANE_ID, origin: { kind: ["person", "unload"] } }, ($, e, next) => {
    state.isOpen = false;
    state.isPlaced = false;
    state.isFull = false;
    if (e.origin?.kind === "person") state.isDismissed = true;
    return next(e);
  });

  on("session.end", async ($, e, next) => {
    const dir = state.tmpDir;
    state.tmpDir = null;
    state.entries = [];
    state.index = -1;
    state.blocks.clear();
    state.failed.clear();
    $.ui.invalidate("ui.render");
    if (dir && /\/viewfinder-[A-Za-z0-9_-]+$/.test(dir)) {
      await $.process.run(["rm", "-rf", dir]).catch(() => undefined);
    }
    return next(e);
  });
}
