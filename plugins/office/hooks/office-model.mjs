// Office: the pure half. Parses herdr's JSON, builds the desk list, lays out
// the grid and paints each frame as the packed cells a Raster takes. Nothing
// here touches `$`, so the tests and bin/office-monitor import it directly.

import { BOLD_SMALL_HEADS, FURS, HAIR_COLOURS, SKIN_TONES, SMALL_HEADS } from "./office-art.mjs";

export const GAP = 1;
export const MAX_PER_ROW = 12;

// Three sizes of desk. `pw` x `ph` is the sprite in pixels, `k` how many
// terminal cells across (and half-cells down) one pixel takes.
export const SCALES = {
  large: { name: "large", pw: 20, ph: 18, k: 2, tagRows: 2 },
  normal: { name: "normal", pw: 20, ph: 18, k: 1, tagRows: 2 },
  compact: { name: "compact", pw: 10, ph: 8, k: 1, tagRows: 2 },
};

// Most interesting first.
// The order desks sort in: needs you, working, done (not yet looked at, or
// resting), idle, then busy terminals, which are long-running and rarely news.
export const STATUSES = ["blocked", "working", "done", "idle", "unknown", "running"];
const RANK = Object.fromEntries(STATUSES.map((s, i) => [s, i]));

export const STATUS_WORD = {
  blocked: "needs you",
  working: "working",
  running: "running",
  idle: "idle",
  unknown: "idle?",
  done: "done",
};

// Each state's accent: the desk stripe, the header dot, the name tag.
export const ACCENT = {
  blocked: 0xff4d4d,
  working: 0x4ade80,
  running: 0xf59e0b,
  idle: 0x60a5fa,
  unknown: 0x94a3b8,
  done: 0x8b8fa8,
};
export const TAG_BG = {
  blocked: 0x6b1515,
  working: 0x14532d,
  running: 0x5a3a06,
  idle: 0x1e3a64,
  unknown: 0x2a2f3a,
  done: 0x26262f,
};
const TAG_FG = { done: 0xa1a1aa };

const DEFAULT_COLOR = 0x01000000;
const UPPER_HALF = 0x2580; // '▀': the top pixel is the fg, the bottom the bg

const C = {
  gap: 0x0d0e14,
  wall: 0x1a1c29,
  wallDark: 0x13141d,
  floor: 0x121219,
  floorEdge: 0x1d1d27,
  lampWarm: 0xffc874,
  lampShade: 0xd9973a,
  bulbOn: 0xfff4cf,
  bulbOff: 0x5b4a2e,
  frame: 0x2d3240,
  frameHi: 0x3b4152,
  screenBg: 0x0b1020,
  screenOff: 0x05060a,
  screenGlare: 0x1c2030,
  termBg: 0x050a06,
  code: [0x60a5fa, 0x93c5fd, 0xc4b5fd, 0x4ade80, 0xfbbf24, 0xf472b6],
  termGreen: [0x4ade80, 0x22c55e, 0x166534],
  saver: 0x0d1b36,
  saverDot: 0x7dd3fc,
  keys: 0x4b5060,
  keysHi: 0x6b7184,
  spark: 0xfff3a0,
  mug: 0xeeeae2,
  mugShade: 0xb9b2a5,
  coffee: 0x5b3a22,
  steam: 0xc9cedb,
  deskTop: 0x9a6640,
  deskTopHi: 0xb57a4d,
  deskFront: 0x6b4429,
  deskShadow: 0x3e2717,
  chair: 0x394050,
  chairDark: 0x232833,
  skin: 0xf1c27d,
  skinShade: 0xc99a5b,
  eye: 0x1b1b22,
  pants: 0x2b3245,
  shoe: 0x111116,
  crown: 0xfacc15,
  zzz: 0xc4b5fd,
  alertRed: 0xff3b3b,
  alertAmber: 0xffb020,
  alertWall: 0x3a1418,
  white: 0xf8fafc,
  metal: 0xa3aab8,
  metalDark: 0x6b7280,
  metalDeep: 0x4b5160,
  led: 0x22d3ee,
  minion: 0xfacc15,
  minionShade: 0xd4a90f,
  goggle: 0xe5e7eb,
  overalls: 0x2563eb,
};
const CONFETTI_GRID = [0xff5c8a, 0xffd23f, 0x4ade80, 0x60a5fa, 0xc084fc, 0xff8c42];
const SHIRTS = [0x4f7cac, 0xa05a7c, 0x5f9e6e, 0xc07a3e, 0x7a6fc0, 0x3fa0a0, 0xb0524f, 0x8a8f3c];
const HAIRS = [0x3b2a20, 0x1f1a17, 0x8c5a2b, 0xc9a25a, 0x6b3a2a, 0x9a9a9a, 0x5a2e5e];
const SHELLS = new Set(["zsh", "-zsh", "bash", "-bash", "fish", "-fish", "sh", "-sh", "dash", "login", "nu", "tmux"]);
const RUNTIMES = new Set(["node", "python", "python3", "Python", "bun", "deno", "ruby", "perl", "java", "npx", "uv", "npm", "pnpm", "yarn", "make", "cargo", "go"]);

// ---- herdr data -----------------------------------------------------------

/** The status a desk animates: herdr's own, anything new read as unknown. */
export function statusOf(raw) {
  return Object.prototype.hasOwnProperty.call(RANK, raw) && raw !== "running" ? raw : "unknown";
}

function printable(s) {
  return String(s ?? "")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function baseName(path) {
  return String(path ?? "").split("/").filter(Boolean).pop() ?? "";
}

/** A printable name: herdr's name or title, else the cwd's last folder. */
export function shortName(pane) {
  return printable(pane.name) || printable(pane.title) || printable(baseName(pane.cwd)) || String(pane.pane_id ?? "?");
}

export function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Reads `herdr pane list` into plain panes, in herdr's order.
 * Returns `{ panes }` or `{ error }`.
 */
export function parsePaneList(stdout, selfPaneId) {
  let doc;
  try {
    doc = JSON.parse(stdout);
  } catch {
    return { error: "herdr pane list returned something that is not JSON." };
  }
  const raw = doc?.result?.panes;
  if (!Array.isArray(raw)) return { error: "herdr pane list returned no panes." };
  const panes = raw
    .filter((p) => p && typeof p.pane_id === "string")
    .map((p, order) => ({
      paneId: p.pane_id,
      tabId: typeof p.tab_id === "string" ? p.tab_id : "",
      workspaceId: typeof p.workspace_id === "string" ? p.workspace_id : "",
      agent: typeof p.agent === "string" && p.agent ? p.agent : null,
      status: statusOf(p.agent_status),
      name: shortName(p),
      terminalTitle: printable(p.terminal_title_stripped ?? p.terminal_title ?? ""),
      cwd: typeof p.cwd === "string" ? p.cwd : "",
      sessionId: typeof p.agent_session?.value === "string" ? p.agent_session.value : null,
      isSelf: Boolean(selfPaneId) && p.pane_id === selfPaneId,
      isFocused: p.focused === true,
      order,
    }));
  return { panes };
}

/**
 * Reads `herdr pane process-info --pane <id>`: whether the pane's shell is
 * running something in the foreground, and a short name for it.
 */
export function parseProcessInfo(stdout) {
  let info;
  try {
    info = JSON.parse(stdout)?.result?.process_info;
  } catch {
    return { isRunning: false, name: "" };
  }
  const procs = Array.isArray(info?.foreground_processes) ? info.foreground_processes : [];
  if (!procs.length || info.foreground_process_group_id === info.shell_pid) return { isRunning: false, name: "" };
  const busy = procs
    .filter((p) => !SHELLS.has(String(p.name ?? p.argv0 ?? "")))
    .sort((a, b) => (a.pid ?? 0) - (b.pid ?? 0));
  if (!busy.length) return { isRunning: false, name: "" };
  const lead = busy.find((p) => p.pid === info.foreground_process_group_id) ?? busy[0];
  const argv = Array.isArray(lead.argv) ? lead.argv : String(lead.cmdline ?? lead.argv0 ?? "").split(" ");
  let name = baseName(argv[0] || lead.argv0 || lead.name);
  // `node vite`, `npm run dev`: the arguments say more than the runtime.
  if (RUNTIMES.has(name)) {
    const rest = argv.slice(1).filter((a) => a && !a.startsWith("-"));
    name = [name, ...rest.slice(0, 2).map(baseName)].join(" ").slice(0, 32);
  }
  return { isRunning: true, name: printable(name) || printable(lead.name) || "process" };
}

/**
 * Whether a plain pane's shell is running something, read from its terminal
 * title alone (no process spawned): shells title an idle prompt as
 * `user@host:path`, a path, or the shell's name, and a running command as
 * the command. Returns `{ isRunning, name }` as parseProcessInfo does.
 */
export function busyFromTitle(title) {
  const t = printable(title);
  if (!t) return { isRunning: false, name: "" };
  const idle =
    /^[\w.-]+@[\w.-]+(:|\s|$)/.test(t) || // user@host:~/path
    /^(~|\/)[^\s]*$/.test(t) || // a bare path
    SHELLS.has(t) ||
    SHELLS.has(t.split(/\s/)[0]) && t.split(/\s/).length === 1;
  if (idle) return { isRunning: false, name: "" };
  return { isRunning: true, name: t.slice(0, 32) };
}

/** Claude Code's folder name for a project: every non-alphanumeric is a dash. */
export function projectDirName(cwd) {
  return String(cwd ?? "").replace(/[^a-zA-Z0-9]/g, "-");
}

/** Subagent transcripts written to within `windowMs` of `now`. */
export function countActiveSubagents(entries, now, windowMs = 60000) {
  let n = 0;
  for (const e of entries ?? []) {
    if (e && e.kind !== "dir" && /\.jsonl$/.test(String(e.name)) && now - Number(e.mtimeMs || 0) <= windowMs) n++;
  }
  return n;
}

/**
 * The desks, most interesting first. `show` says which panes get one:
 * `claude` (the default) only Claude sessions; `agents` any coding agent;
 * `busy` also plain panes whose shell runs something (`procs` by pane id);
 * `all` also idle shells, as empty desks. Idle shells are counted in
 * `idleShells` either way.
 */
export function buildDesks(panes, procs = {}, helpers = {}, show = "claude") {
  const desks = [];
  let idleShells = 0;
  for (const p of panes) {
    const look = hash(p.paneId);
    const project = baseName(p.cwd);
    if (p.agent && show === "claude" && p.agent !== "claude") continue;
    if (p.agent) {
      desks.push({
        ...p,
        project,
        kind: "agent",
        detail: p.agent === "claude" ? "" : p.agent,
        helpers: helpers[p.sessionId] ?? 0,
        look,
      });
    } else if (procs[p.paneId]?.isRunning) {
      if (show !== "busy" && show !== "all") continue;
      desks.push({
        ...p,
        project,
        kind: "process",
        status: "running",
        name: procs[p.paneId].name,
        detail: baseName(p.cwd),
        helpers: 0,
        look,
      });
    } else {
      idleShells++;
      // Shown as an empty desk only when asked for.
      if (show === "all" && !procs[p.paneId]?.isRunning) {
        desks.push({ ...p, project, kind: "shell", status: "done", name: project || p.name, detail: "idle shell", helpers: 0, look });
      }
    }
  }
  desks.sort((a, b) => rankOf(a) - rankOf(b) || a.order - b.order);
  return { desks, idleShells };
}

/** Counts per status, for the header strip. */
export function tally(desks) {
  const out = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  // An idle shell drawn as an empty desk is no session: not counted as done.
  for (const d of desks) if (d.kind !== "shell") out[d.status]++;
  return out;
}

// Desk hotkeys: digits only, 0 for the tenth. Letters are the view's own keys.
export const HOTKEYS = [..."1234567890"];

// The view's keys, the same in the pane and in bin/office-monitor.
export const VIEW_KEYS = { l: "layout", d: "desks", c: "characters", b: "style", t: "lighting", p: "palette", g: "render" };

// What a desk's bubble says: what the session is doing, in words.
export const ACTIVITY_WORDS = {
  thinking: "Thinking...",
  writing: "Writing...",
  coding: "Coding...",
  reading: "Reading...",
  searching: "Searching...",
  running: "Running...",
  delegating: "Delegating...",
};

/** The bubble's words for a desk, and its kind (for the colours), or null. */
export function bubbleFor(desk) {
  if (!desk || desk.kind === "shell") return null;
  if (desk.status === "blocked") return { text: "Help please", tone: "alert" };
  if (desk.status === "done") return { text: desk.unseenDone ? "Done!" : "Done", tone: desk.unseenDone ? "party" : "quiet" };
  if (desk.status === "working") return { text: ACTIVITY_WORDS[desk.activity] ?? "Working...", tone: "work" };
  return null;
}

/** An activity from a tool's name: what the bubble says while it runs. */
export function activityOfTool(tool) {
  const t = String(tool ?? "");
  if (/^(Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell)$/.test(t)) return "coding";
  if (/^(Read|NotebookRead)$/.test(t)) return "reading";
  if (/^(Grep|Glob|WebFetch|WebSearch|LS)$/.test(t)) return "searching";
  if (/^(Agent|Task)$/.test(t)) return "delegating";
  return t ? "running" : null;
}

/**
 * What a session was doing, from the tail of its transcript: the last
 * assistant block (thinking, text, or a tool by name). Lines that do not
 * parse (the first, cut mid-way) are skipped.
 */
export function activityFromTail(text) {
  const lines = String(text ?? "").split("\n").filter(Boolean).reverse();
  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const content = row?.message?.content;
    if (row?.type !== "assistant" || !Array.isArray(content) || !content.length) continue;
    const last = content[content.length - 1];
    if (last?.type === "thinking" || last?.type === "redacted_thinking") return "thinking";
    if (last?.type === "text") return "writing";
    if (last?.type === "tool_use") return activityOfTool(last.name);
  }
  return null;
}

/**
 * The page of desks on show, `size` at a time: in the order given when
 * `isOrdered` (seatDesks's), else the most relevant first (needs you,
 * working, done, idle). Returns the desks, the page and how many pages.
 */
export function pageOf(desks, size, page = 0, isOrdered = false) {
  const sorted = isOrdered ? [...desks] : [...desks].sort((a, b) => rankOf(a) - rankOf(b) || (a.order ?? 0) - (b.order ?? 0));
  if (size === "all" || !Number(size)) return { desks: sorted, page: 0, pages: 1, total: sorted.length };
  const n = Number(size);
  const pages = Math.max(1, Math.ceil(sorted.length / n));
  const p = ((page % pages) + pages) % pages;
  return { desks: sorted.slice(p * n, p * n + n), page: p, pages, total: sorted.length };
}

/** Where a desk sorts: by its state, empty shell desks last. */
export function rankOf(d) {
  return d.kind === "shell" ? STATUSES.length : RANK[d.status] ?? STATUSES.length;
}

// ---- layout ---------------------------------------------------------------

function tileOf(scale) {
  const artRows = (scale.ph * scale.k) / 2;
  return { tileW: scale.pw * scale.k, artRows, tileH: artRows + scale.tagRows };
}

/**
 * Picks the largest desk size at which every desk fits the body, and cuts the
 * grid. Nothing is left out: when even compact desks overflow the height, the
 * pane scrolls.
 */
export function layoutFor(count, bodyColumns, bodyRows, options = {}) {
  const width = Math.max(10, Math.floor(bodyColumns || 0));
  const height = Math.max(6, Math.floor(bodyRows || 30));
  // The biggest desks that fit, in a sidebar too.
  const order = ["large", "normal", "compact"];
  let pick = null;
  for (const name of order) {
    const scale = SCALES[name];
    const t = tileOf(scale);
    const perRow = Math.max(1, Math.min(MAX_PER_ROW, Math.floor((width + GAP) / (t.tileW + GAP))));
    const deskRows = Math.max(1, Math.ceil(count / perRow));
    pick = { scale, ...t, perRow, deskRows };
    if (deskRows * t.tileH <= height && (name !== "large" || t.tileW <= width)) break;
  }
  // A Raster is at most 512 x 256 cells; past that (hundreds of desks) the rest are cut.
  const maxRows = Math.floor(256 / pick.tileH);
  const shown = Math.min(count, pick.perRow * maxRows);
  const perRow = Math.max(1, Math.min(pick.perRow, shown || 1));
  const deskRows = Math.max(1, Math.ceil(shown / perRow));
  return {
    scale: pick.scale,
    tileW: pick.tileW,
    tileH: pick.tileH,
    artRows: pick.artRows,
    shown,
    perRow,
    deskRows,
    columns: Math.min(512, perRow * pick.tileW + (perRow - 1) * GAP),
    rows: deskRows * pick.tileH,
  };
}

/** Where desk `i`'s name tag sits in the grid, in cells. */
export function tagPlace(layout, i) {
  return {
    left: (i % layout.perRow) * (layout.tileW + GAP),
    top: Math.floor(i / layout.perRow) * layout.tileH + layout.artRows,
  };
}

/**
 * The two lines of a desk's name tag. The first starts `1: ` for a desk with
 * a hotkey, as a plain Button draws its label; a long name runs on into the
 * second line, else the second line says what the desk is doing.
 */
export function tagLines(desk, i, width) {
  const key = HOTKEYS[i];
  const prefix = key ? `${key}: ` : "";
  const room = Math.max(1, width - prefix.length);
  const name = desk.name;
  const first = name.slice(0, room);
  let second;
  if (name.length > room) {
    const rest = name.slice(room).trimStart();
    second = rest.length > width ? `${rest.slice(0, width - 1)}~` : rest;
  } else {
    const bits = [bubbleFor(desk)?.text ?? STATUS_WORD[desk.status]];
    if (desk.kind === "process" && desk.detail) bits.push(desk.detail);
    else if (desk.detail) bits.push(desk.detail);
    if (desk.helpers) bits.push(`${desk.helpers} helper${desk.helpers === 1 ? "" : "s"}`);
    if (desk.isSelf) bits.push("you");
    second = bits.join(" / ").slice(0, width);
  }
  return { hotkey: key, label: first, first: `${prefix}${first}`, second };
}

// ---- painting -------------------------------------------------------------

function blend(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  const ch = (s) => {
    const x = (a >> s) & 255;
    const y = (b >> s) & 255;
    return Math.round(x + (y - x) * k) << s;
  };
  return ch(16) | ch(8) | ch(0);
}

// A deterministic flicker, so a frame is a function of the tick.
function noise(a, b) {
  return hash(`${a}:${b}`) & 255;
}

/**
 * Paints one frame: `[codePoint, fg, bg]` per cell, row-major, as a
 * Uint32Array. `desks` are in grid order; `tick` advances the animation.
 */
export function paintWords(layout, desks, tick, opts = {}) {
  const W = layout.columns;
  const H = layout.rows * 2;
  const px = new Uint32Array(W * H).fill(C.gap);
  const glyphs = new Map();

  desks.slice(0, layout.shown).forEach((desk, i) => {
    if (!desk) return;
    const ox = (i % layout.perRow) * (layout.tileW + GAP);
    const oyRow = Math.floor(i / layout.perRow) * layout.tileH;
    if (ox + layout.tileW > W) return;
    paintDesk(px, glyphs, W, layout, ox, oyRow, desk, opts.reducedMotion ? Math.floor(tick / 4) : tick, opts);
    paintTag(glyphs, W, layout, ox, oyRow + layout.artRows, desk, i);
    // The bubble's words along the card's top, over the wall.
    const bubble = bubbleFor(desk);
    if (bubble && layout.tileW >= 10) {
      const text = ` ${bubble.text} `.slice(0, layout.tileW - 1);
      const [fg, bg] = { alert: [0xffffff, 0xd8352a], work: [0x1e1a26, 0xf4f2ee], party: [0x1e1a26, 0xffd23f], quiet: [0x4a4658, 0xc8c4d4] }[bubble.tone];
      const col = ox + layout.tileW - text.length - 1;
      for (let x = 0; x < text.length; x++) glyphs.set(oyRow * W + col + x, { ch: text[x], fg, bg });
    }
  });

  const words = new Uint32Array(W * layout.rows * 3);
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < W; c++) {
      const at = (r * W + c) * 3;
      const g = glyphs.get(r * W + c);
      if (g) {
        words[at] = g.ch.codePointAt(0);
        words[at + 1] = g.fg;
        words[at + 2] = g.bg;
      } else {
        words[at] = UPPER_HALF;
        words[at + 1] = px[2 * r * W + c];
        words[at + 2] = px[(2 * r + 1) * W + c];
      }
    }
  }
  return words;
}

/** paintWords packed as RasterProps `cells`. */
export function paintFrame(layout, desks, tick, opts) {
  return toBase64(new Uint8Array(paintWords(layout, desks, tick, opts).buffer));
}

export function toBase64(bytes) {
  if (typeof bytes.toBase64 === "function") return bytes.toBase64();
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function paintTag(glyphs, W, layout, ox, row, desk, i) {
  const { first, second } = tagLines(desk, i, layout.tileW);
  const bg = TAG_BG[desk.status];
  const fg = TAG_FG[desk.status] ?? C.white;
  const key = HOTKEYS[i];
  const lines = [first, second];
  for (let l = 0; l < layout.scale.tagRows; l++) {
    const text = (lines[l] ?? "").padEnd(layout.tileW, " ");
    for (let x = 0; x < layout.tileW; x++) {
      const isKey = l === 0 && key && x < key.length;
      const color = isKey ? ACCENT[desk.status] : l === 1 ? blend(fg, bg, 0.3) : fg;
      glyphs.set((row + l) * W + ox + x, { ch: text[x], fg: color, bg });
    }
  }
}

// One desk's art. `set` and `glyph` take sprite pixels; the scale maps them.
function paintDesk(px, glyphs, W, layout, ox, oyRow, desk, tick, opts = {}) {
  const { pw, ph, k } = layout.scale;
  const oy = oyRow * 2;
  const set = (x, y, color) => {
    if (x < 0 || x >= pw || y < 0 || y >= ph) return;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) px[(oy + y * k + dy) * W + ox + x * k + dx] = color;
  };
  const get = (x, y) => px[(oy + Math.max(0, Math.min(ph - 1, y)) * k) * W + ox + Math.max(0, Math.min(pw - 1, x)) * k];
  // A character over the cell holding sprite pixel (x, y).
  const glyph = (x, y, ch, fg) => {
    if (x < 0 || x >= pw || y < 0 || y >= ph) return;
    const col = ox + x * k;
    const row = oyRow + Math.floor((y * k) / 2);
    const bg = px[row * 2 * W + col];
    glyphs.set(row * W + col, { ch, fg, bg: bg ?? DEFAULT_COLOR });
  };
  const line = (x0, y0, x1, y1, color) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= n; s++) set(Math.round(x0 + ((x1 - x0) * s) / n), Math.round(y0 + ((y1 - y0) * s) / n), color);
  };
  const look = {
    shirt: SHIRTS[desk.look % SHIRTS.length],
    hair: HAIRS[(desk.look >>> 8) % HAIRS.length],
  };
  // A tile whose character is a picture leaves the chair empty for it.
  const kind = desk.kind === "shell" ? "empty" : desk.hasPortrait ? "none" : kindFor(desk, opts.characters);
  const api = { set, get, glyph, line, look, tick, desk, kind, isBold: opts.style !== "detailed" };
  if (pw <= 10) paintCompact(api);
  else paintFull(api);
}

/** Which creature sits at a desk: its override, the character set, or a robot for a terminal. */
export const CHARACTER_KINDS = ["human", "robot", "critter", "cat", "dog", "owl"];
export function kindFor(desk, characters) {
  if (desk.character && CHARACTER_KINDS.includes(desk.character)) return desk.character;
  if (desk.kind === "process") return "robot";
  const h = hash(desk.sessionId || desk.paneId || desk.name || "");
  if (characters === "robots") return "robot";
  if (characters === "critters") return "critter";
  if (characters === "animals") return ["cat", "dog", "owl"][h % 3];
  if (characters === "mixed") {
    const p = hash(desk.project || desk.cwd || "");
    return ["human", "robot", "critter", ["cat", "dog", "owl"][h % 3]][p % 4];
  }
  return "human";
}

// A 6 x 6 front head for the grid's workers: every kind in bold, the
// non-human ones in detailed.
function smallHead(set, x, y, kind, desk, isBold) {
  const map = (isBold ? BOLD_SMALL_HEADS : SMALL_HEADS)[kind];
  if (!map) return;
  const furs = FURS[kind];
  const [f, d] = furs ? furs[desk.look % furs.length] : [0xde7a4a, 0xb35a30];
  const skin = SKIN_TONES[desk.look % SKIN_TONES.length];
  const hair = HAIR_COLOURS[(desk.look >>> 4) % HAIR_COLOURS.length];
  const pal = {
    o: 0x1a1420, e: 0x17131c, F: f, D: d, W: f, y: 0xf2c94c, b: 0xe0a030, n: 0x3a2a2a, m: 0x5a3030, p: 0xf0a0b4, q: 0xde7a4a, Q: 0xb35a30,
    s: skin[0], S: skin[1], r: hair[0], R: hair[1],
    ...(kind === "robot" ? { m: 0xa9b0be, M: 0x6e7584, v: desk.kind === "process" ? 0xffa53a : 0x5ee7ff, V: 0xffffff, a: 0xff5c5c } : {}),
  };
  map.forEach((row, j) => [...row].forEach((k, i) => k !== "." && pal[k] != null && set(x + i, y + j, pal[k])));
}

// ---- the 20 x 18 desk -------------------------------------------------------

function paintFull({ set, get, glyph, line, look, tick, desk, kind, isBold }) {
  const s = desk.status;
  const isRobot = kind === "robot";
  const isEmpty = kind === "empty";
  const noWorker = kind === "none";
  const blink = tick % 4 < 2;
  const fast = tick % 2 === 0;
  const lampOn = s !== "done";

  // Wall, warmed by the desk lamp on the right; floor below.
  for (let y = 0; y < 18; y++) {
    for (let x = 0; x < 20; x++) {
      if (y >= 13) {
        set(x, y, y === 13 ? C.floorEdge : C.floor);
        continue;
      }
      const d = Math.hypot(x - 9, (y - 1) * 1.2);
      let c = blend(C.wall, C.wallDark, y / 26);
      if (lampOn && d < 9) c = blend(c, C.lampWarm, (1 - d / 9) * 0.28);
      set(x, y, c);
    }
  }

  // Needs you: the alert light on the monitor throws red and amber on the wall.
  if (s === "blocked") {
    const hue = blink ? C.alertRed : C.alertAmber;
    for (let y = 0; y < 13; y++) {
      for (let x = 0; x < 20; x++) {
        const d = Math.hypot(x - 13, (y - 2) * 1.1);
        if (d < 10) set(x, y, blend(get(x, y), hue, (1 - d / 10) * (blink ? 0.55 : 0.3)));
      }
    }
    for (let x = 0; x < 20; x++) set(x, 17, blink ? C.alertWall : C.floor);
  }

  // Desk: top, the state's accent stripe, a front panel, two legs.
  for (let x = 8; x < 20; x++) {
    set(x, 12, x === 8 ? C.deskTopHi : C.deskTop);
    set(x, 13, x % 4 === 1 ? blend(C.deskFront, ACCENT[s], 0.15) : ACCENT[s]);
    set(x, 14, C.deskFront);
  }
  for (let y = 15; y <= 17; y++) {
    set(9, y, C.deskShadow);
    set(19, y, C.deskShadow);
  }

  // A pendant lamp over the keyboard.
  set(8, 0, C.lampShade);
  set(9, 0, C.lampShade);
  set(10, 0, C.lampShade);
  set(9, 1, lampOn ? C.bulbOn : C.bulbOff);

  // Monitor: frame, stand, keyboard.
  for (let y = 4; y <= 10; y++) for (let x = 10; x <= 16; x++) set(x, y, y === 4 ? C.frameHi : C.frame);
  set(13, 11, C.frame);
  set(12, 11, C.frameHi);
  set(14, 11, C.frameHi);
  for (let x = 8; x <= 11; x++) set(x, 11, (x + tick) % 5 === 0 && s === "working" ? C.keysHi : C.keys);
  paintScreen(set, isEmpty ? "done" : s === "done" && desk.unseenDone ? "celebrate" : s, isRobot && desk.kind === "process", tick, desk);

  // Mug on the right of the monitor (in hand while idle).
  if (s !== "idle" && s !== "unknown") {
    set(18, 10, C.mug);
    set(18, 11, C.mugShade);
    set(19, 10, C.mugShade);
    set(18, 9, C.coffee);
  }

  // The worker.
  if (isEmpty) chairUpright(set);
  else if (noWorker) {
    // The picture sits here.
  } else if (isRobot) paintRobot({ set, line, tick, s });
  else if (s === "working") paintTyping({ set, line, look, tick });
  else if (s === "idle" || s === "unknown") paintLeaning({ set, line, look, tick, s });
  else if (s === "done" && desk.unseenDone) paintWaving({ set, line, look, blink, fast });
  else if (s === "done") paintAsleep({ set, look });
  else if (s === "blocked") paintWaving({ set, line, look, blink, fast });
  // Critters and animals (and in bold, everyone): their own head on the same body.
  if (!isEmpty && !noWorker && (isBold || (!isRobot && kind !== "human"))) {
    const at = isRobot ? [3, 0] : desk.status === "done" && desk.unseenDone ? [4, 0] : ({ working: [3, 1], idle: [1, 1], unknown: [1, 1], done: [6, 6], blocked: [4, 0] }[s] ?? [3, 1]);
    smallHead(set, at[0], at[1], kind, desk, isBold);
  }

  // Steam curling off the mug in hand while idle.
  if ((s === "idle" || s === "unknown") && !isRobot && !isEmpty) {
    const sip = tick % 24 >= 20;
    const [mx, my] = sip ? [6, 4] : [7, 8];
    for (let p = 0; p < 4; p++) {
      const phase = (tick + p * 3) % 12;
      const y = my - 1 - Math.floor(phase * 0.5);
      const x = mx + Math.round(Math.sin((tick + p * 5) / 2.5));
      if (y >= 1 && x >= 6) set(x, y, blend(C.steam, get(x, y), phase / 14));
    }
  }

  // Confetti over a session that finished and has not been looked at yet.
  if (s === "done" && desk.unseenDone && !isEmpty) {
    for (let k = 0; k < 10; k++) {
      const h = hash(`cf${desk.paneId}${k}`);
      set((h % 20) + Math.round(Math.sin((tick + k) / 2)), ((h >> 5) + tick * (1 + (k % 3))) % 13, CONFETTI_GRID[k % CONFETTI_GRID.length]);
    }
  }
  // zZ floating up off a sleeper.
  if (s === "done" && !isEmpty && !desk.unseenDone) {
    for (let p = 0; p < 3; p++) {
      const phase = (Math.floor(tick / 2) + p * 4) % 12;
      const y = 7 - Math.floor(phase * 0.6);
      const x = 7 - Math.floor(phase / 4);
      if (y >= 0) glyph(x, y, phase < 5 ? "z" : "Z", blend(C.zzz, C.wall, phase / 13));
    }
  }

  // The alert light, and a "!" over the worker's head.
  if (s === "blocked") {
    set(12, 3, C.metalDark);
    set(13, 3, blink ? C.alertRed : C.alertAmber);
    set(14, 3, C.metalDark);
    set(13, 2, blink ? C.white : C.alertRed);
    glyph(3, 0, "!", blink ? C.alertAmber : C.alertRed);
  }

  if (desk.isSelf && !isRobot && !noWorker) paintCrown(set, s);

  // Helpers: a minion per active subagent in front of the desk, and a count.
  const n = desk.helpers || 0;
  if (n > 0) {
    // Two on the floor in front, a third up on the monitor.
    const spots = [
      [11, 17],
      [15, 17],
      [15, 3],
    ];
    spots.slice(0, Math.min(3, n)).forEach(([x, foot], i) => paintMinion(set, x, foot - ((tick + i) % 3 === 0 ? 1 : 0), tick + i));
    const label = `x${n}`;
    for (let i = 0; i < label.length; i++) glyph(20 - label.length + i, 0, label[i], C.minion);
  }
}

function paintScreen(set, s, isRobot, tick, desk) {
  for (let y = 5; y <= 9; y++) {
    for (let x = 11; x <= 15; x++) {
      let c = C.screenOff;
      if (s === "celebrate") {
        c = CONFETTI_GRID[(x + y + tick) % CONFETTI_GRID.length];
      } else if (isRobot) {
        // A terminal: green output scrolling up.
        const ln = y - 5 + Math.floor(tick / 2);
        const h = hash(`${desk.paneId}:${ln}`);
        const len = 1 + (h % 5);
        c = x - 11 < len ? C.termGreen[(h >> 4) % 3] : C.termBg;
        if (y === 9 && x === 11 + (len % 5) && tick % 2) c = C.termGreen[0];
      } else if (s === "working") {
        // Code scrolling up a line a frame.
        const ln = y - 5 + tick;
        const h = hash(`${desk.paneId}:${ln}`);
        const indent = h % 3;
        const len = 1 + ((h >> 3) % (5 - indent));
        const col = x - 11;
        c = col >= indent && col < indent + len ? C.code[(h >> 7) % C.code.length] : C.screenBg;
      } else if (s === "idle" || s === "unknown") {
        // A screensaver: one dot drifting round the screen.
        const t = Math.floor(tick / 2);
        const dx = Math.abs((t % 8) - 4);
        const dy = Math.abs(((t + 2) % 8) - 4);
        c = x - 11 === dx && y - 5 === dy ? C.saverDot : C.saver;
      } else if (s === "blocked") {
        const on = tick % 4 < 2;
        const bang = x === 13 && (y <= 7 || y === 9);
        c = bang ? C.white : on ? 0x8f1d1d : 0x5a1414;
      } else {
        c = x === 15 && y === 5 ? C.screenGlare : C.screenOff;
      }
      set(x, y, c);
    }
  }
  // A working screen lights the wall above it, flickering.
  if (s === "working" || isRobot) {
    const glow = isRobot ? C.termGreen[0] : C.code[0];
    const amount = noise(tick, 31) & 1 ? 0.22 : 0.12;
    for (let x = 10; x <= 16; x++) {
      set(x, 3, blend(C.wall, glow, amount));
      set(x, 2, blend(C.wall, glow, amount / 2));
    }
  }
}

function chairUpright(set) {
  for (let y = 5; y <= 11; y++) set(1, y, C.chair);
  for (let y = 6; y <= 10; y++) set(2, y, C.chairDark);
  for (let x = 1; x <= 6; x++) set(x, 12, C.chair);
  set(4, 13, C.chairDark);
  set(4, 14, C.chairDark);
  set(4, 15, C.chairDark);
  for (let x = 2; x <= 6; x++) set(x, 16, C.chairDark);
  set(2, 17, C.shoe);
  set(6, 17, C.shoe);
}

function seatedLegs(set) {
  for (let x = 3; x <= 7; x++) set(x, 11, C.pants);
  for (let y = 12; y <= 15; y++) set(7, y, C.pants);
  set(7, 16, C.shoe);
  set(8, 16, C.shoe);
}

function paintTyping({ set, line, look, tick }) {
  chairUpright(set);
  seatedLegs(set);
  // Head leaning in to the screen.
  set(4, 2, look.hair);
  set(5, 2, look.hair);
  set(6, 2, look.hair);
  set(4, 3, look.hair);
  set(4, 4, look.hair);
  for (let y = 3; y <= 5; y++) for (let x = 5; x <= 7; x++) set(x, y, C.skin);
  set(7, 4, C.eye);
  set(6, 5, C.skinShade);
  for (let y = 6; y <= 10; y++) for (let x = 3; x <= 6; x++) set(x, y, look.shirt);
  // Two arms, hands alternating on the keys every frame.
  const nearDown = tick % 2 === 0;
  const far = blend(look.shirt, 0x000000, 0.25);
  const farHand = nearDown ? [11, 7] : [11, 10];
  const nearHand = nearDown ? [9, 10] : [9, 7];
  line(6, 7, farHand[0] - 1, farHand[1], far);
  set(farHand[0], farHand[1], C.skinShade);
  line(5, 8, nearHand[0] - 1, nearHand[1], look.shirt);
  set(nearHand[0], nearHand[1], C.skin);
  // A key flash under whichever hand is down.
  const down = nearDown ? nearHand : farHand;
  if (down[1] === 10) set(down[0], 11, C.spark);
}

function paintLeaning({ set, line, look, tick, s }) {
  // Chair tipped back.
  set(0, 4, C.chair);
  set(0, 5, C.chair);
  set(0, 6, C.chair);
  set(1, 7, C.chair);
  set(1, 8, C.chair);
  set(1, 9, C.chair);
  set(2, 10, C.chair);
  set(2, 11, C.chair);
  for (let x = 2; x <= 6; x++) set(x, 12, C.chair);
  set(4, 13, C.chairDark);
  set(4, 14, C.chairDark);
  set(4, 15, C.chairDark);
  for (let x = 2; x <= 6; x++) set(x, 16, C.chairDark);
  seatedLegs(set);
  // Head back, hands behind it, a slow blink.
  set(2, 2, look.hair);
  set(3, 2, look.hair);
  set(4, 2, look.hair);
  set(2, 3, look.hair);
  for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) set(x, y, C.skin);
  const isBlinking = tick % 18 >= 16;
  set(5, 4, isBlinking ? C.skinShade : C.eye);
  set(5, 5, C.skinShade);
  for (let y = 6; y <= 10; y++) for (let x = 2; x <= 5; x++) set(x, y, look.shirt);
  // Coffee in hand, lifted for a sip now and then.
  const sip = tick % 24 >= 20;
  if (sip) {
    line(4, 7, 5, 5, look.shirt);
    set(5, 5, C.skin);
    set(6, 4, C.mug);
    set(6, 5, C.mugShade);
  } else {
    line(4, 7, 6, 9, look.shirt);
    set(6, 9, C.skin);
    set(7, 8, C.mug);
    set(7, 9, C.mugShade);
    set(8, 8, C.mugShade);
  }
  if (s === "unknown") set(5, 4, C.skinShade);
}

function paintAsleep({ set, look }) {
  chairUpright(set);
  seatedLegs(set);
  // Slumped forward, head on folded arms.
  for (let y = 7; y <= 10; y++) for (let x = 3; x <= 6; x++) set(x, y, look.shirt);
  for (let x = 6; x <= 10; x++) set(x, 11, look.shirt);
  set(7, 8, look.hair);
  set(8, 8, look.hair);
  set(9, 8, look.hair);
  set(7, 9, look.hair);
  set(8, 9, C.skin);
  set(9, 9, C.skin);
  set(7, 10, C.skin);
  set(8, 10, C.skin);
  set(9, 10, C.skinShade);
}

function paintWaving({ set, line, look, blink, fast }) {
  // Chair pushed back, standing, both arms up and waving.
  for (let y = 7; y <= 12; y++) set(0, y, C.chair);
  set(1, 12, C.chair);
  set(2, 12, C.chair);
  set(1, 16, C.chairDark);
  for (let y = 13; y <= 15; y++) set(1, y, C.chairDark);
  set(5, 1, look.hair);
  set(6, 1, look.hair);
  set(7, 1, look.hair);
  for (let y = 2; y <= 4; y++) for (let x = 5; x <= 7; x++) set(x, y, C.skin);
  set(5, 2, look.hair);
  set(6, 3, C.eye);
  set(7, 3, C.eye);
  set(6, 4, blink ? C.eye : C.skinShade);
  for (let y = 5; y <= 9; y++) for (let x = 4; x <= 7; x++) set(x, y, look.shirt);
  for (let y = 10; y <= 15; y++) {
    set(5, y, C.pants);
    set(6, y, C.pants);
  }
  set(4, 16, C.shoe);
  set(5, 16, C.shoe);
  set(6, 16, C.shoe);
  set(7, 16, C.shoe);
  const left = fast ? [2, 1] : [1, 3];
  const right = fast ? [10, 4] : [9, 2];
  line(4, 5, left[0], left[1] + 1, look.shirt);
  set(left[0], left[1], C.skin);
  line(7, 5, right[0], right[1] + 1, look.shirt);
  set(right[0], right[1], C.skin);
}

function paintRobot({ set, line, tick, s }) {
  chairUpright(set);
  // Legs: metal struts.
  for (let x = 3; x <= 7; x++) set(x, 11, C.metalDeep);
  for (let y = 12; y <= 15; y++) set(7, y, C.metalDeep);
  set(7, 16, C.metalDark);
  set(8, 16, C.metalDark);
  // Antenna with a blinking tip.
  set(5, 0, tick % 6 < 3 ? 0xef4444 : 0x22c55e);
  set(5, 1, C.metalDark);
  // Square head, scanning eye.
  for (let y = 2; y <= 5; y++) for (let x = 3; x <= 7; x++) set(x, y, y === 2 ? C.metal : C.metalDark);
  const eye = 5 + (Math.floor(tick / 2) % 3);
  set(eye, 3, C.led);
  set(4, 5, C.metalDeep);
  set(6, 5, C.metalDeep);
  // Body with a chest light.
  for (let y = 6; y <= 10; y++) for (let x = 3; x <= 6; x++) set(x, y, C.metalDark);
  set(4, 8, tick % 2 ? C.led : 0x0e7490);
  set(5, 8, s === "running" ? 0xf59e0b : C.metalDeep);
  // Piston arms, typing.
  const down = tick % 2 === 0;
  line(6, 7, 9, down ? 10 : 9, C.metal);
  line(6, 8, 11, down ? 9 : 10, C.metalDeep);
  set(9, down ? 10 : 9, C.led);
}

function paintCrown(set, s) {
  // This session: a small gold crown on the worker's head.
  const spots = {
    working: [4, 1],
    idle: [2, 1],
    unknown: [2, 1],
    done: [7, 7],
    blocked: [5, 0],
  }[s] ?? [4, 1];
  const [x, y] = spots;
  set(x, y, C.crown);
  set(x + 2, y, C.crown);
  set(x + 1, y, blend(C.crown, C.wall, 0.4));
}

function paintMinion(set, x, footY, t) {
  // 3 wide, 4 tall: yellow head with a goggle, blue overalls, feet.
  const y = footY - 3;
  set(x - 1, y, C.minion);
  set(x, y, C.minion);
  set(x + 1, y, C.minion);
  set(x - 1, y + 1, C.minionShade);
  set(x, y + 1, t % 8 === 0 ? C.minion : C.goggle);
  set(x + 1, y + 1, C.minionShade);
  set(x - 1, y + 2, C.overalls);
  set(x, y + 2, C.overalls);
  set(x + 1, y + 2, C.overalls);
  set(x - 1, y + 3, C.shoe);
  set(x + 1, y + 3, C.shoe);
}

// ---- the 10 x 8 desk --------------------------------------------------------

function paintCompact({ set, glyph, look, tick, desk, kind }) {
  const s = kind === "empty" ? "done" : desk.status;
  const isRobot = kind === "robot";
  const blink = tick % 4 < 2;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 10; x++) set(x, y, y >= 6 ? C.floor : C.wall);
  if (s === "blocked") for (let x = 0; x < 10; x++) set(x, 0, blink ? C.alertRed : C.alertAmber);
  // Desk with its accent stripe, monitor.
  for (let x = 4; x < 10; x++) {
    set(x, 5, C.deskTop);
    set(x, 6, ACCENT[s]);
  }
  for (let y = 1; y <= 4; y++) for (let x = 5; x <= 8; x++) set(x, y, C.frame);
  for (let y = 2; y <= 3; y++) {
    for (let x = 6; x <= 7; x++) {
      let c = C.screenOff;
      if (isRobot) c = (x + y + tick) % 2 ? C.termGreen[0] : C.termBg;
      else if (s === "working") c = C.code[noise(tick, x * 5 + y) % C.code.length];
      else if (s === "idle" || s === "unknown") c = (Math.floor(tick / 2) + x + y) % 4 === 0 ? C.saverDot : C.saver;
      else if (s === "blocked") c = blink ? C.alertRed : 0x5a1414;
      set(x, y, c);
    }
  }
  // Worker or robot; a tile's picture takes the worker's place.
  if (kind === "none") return;
  if (kind === "empty") {
    set(0, 4, C.chair);
    set(1, 4, C.chair);
    set(0, 5, C.chair);
    return;
  }
  if (kind !== "human" && !isRobot) {
    const furs = FURS[kind];
    look = { ...look, hair: furs ? furs[desk.look % furs.length][1] : 0xb35a30 };
  }
  set(0, 2, C.chair);
  set(0, 3, C.chair);
  set(0, 4, C.chair);
  set(0, 5, C.chair);
  const head = isRobot ? C.metal : kind === "human" ? C.skin : kind === "critter" ? 0xde7a4a : (FURS[kind]?.[desk.look % FURS[kind].length]?.[0] ?? C.skin);
  const body = isRobot ? C.metalDark : look.shirt;
  if (s === "done" && desk.unseenDone && !isRobot) {
    // Finished and not looked at: arms up, the screen a party.
    set(2, 1, look.hair);
    set(2, 2, head);
    set(2, 3, body);
    set(2, 4, body);
    set(blink ? 1 : 3, 0, C.skin);
    set(blink ? 3 : 1, 1, C.skin);
    set(6, 2, CONFETTI_GRID[tick % 6]);
    set(7, 3, CONFETTI_GRID[(tick + 2) % 6]);
    set(6 + (tick % 3), 0, CONFETTI_GRID[(tick + 4) % 6]);
  } else if (s === "done" && !isRobot) {
    set(1, 3, body);
    set(2, 4, body);
    set(3, 4, look.hair);
    set(4, 4, look.hair);
    set(1, 4, body);
    if (Math.floor(tick / 3) % 2) glyph(4, 0, "z", C.zzz);
  } else if (s === "blocked" && !isRobot) {
    set(2, 1, look.hair);
    set(2, 2, head);
    set(2, 3, body);
    set(2, 4, body);
    set(blink ? 1 : 3, 0, C.skin);
    set(blink ? 3 : 1, 1, C.skin);
  } else {
    const back = s === "idle" || s === "unknown" ? 1 : 2;
    set(back, 1, isRobot ? C.metal : look.hair);
    set(back, 2, head);
    if (isRobot) set(back + 1, 2, C.led);
    set(back, 3, body);
    set(back, 4, body);
    set(back + 1, 3, body);
    if (s === "working" || isRobot) set(tick % 2 ? 3 : 4, 4, isRobot ? C.metal : C.skin);
    if (s === "idle" || s === "unknown") {
      set(9, 4, C.mug);
      set(9, 3 - (tick % 3), blend(C.steam, C.wall, (tick % 3) / 3));
    }
  }
  if (desk.isSelf && !isRobot) set(2, 0, C.crown);
  const n = desk.helpers || 0;
  for (let i = 0; i < Math.min(5, n); i++) set(5 + i, 7, (tick + i) % 4 === 0 ? C.minionShade : C.minion);
  if (n > 5) glyph(9, 0, n > 9 ? "+" : String(n), C.minion);
}

// ---- options ----------------------------------------------------------------

// Every option: its manifest field, the values the settings view cycles
// through, the default, and the key that cycles it there.
export const OPTIONS = [
  { key: "layout", field: "layout", title: "Layout", values: ["grid", "tiles", "office", "war-room", "strip"], fallback: "grid", hotkey: "l" },
  { key: "characters", field: "characters", title: "Characters", values: ["critters", "humans", "robots", "animals", "mixed"], fallback: "critters", hotkey: "c" },
  { key: "style", field: "style", title: "Character style in cells", values: ["bold", "detailed"], fallback: "bold", hotkey: "b" },
  { key: "lighting", field: "lighting", title: "Lighting", values: ["clock", "day", "night"], fallback: "clock", hotkey: "t" },
  { key: "palette", field: "palette", title: "Palette", values: ["nightshade", "warm", "cool", "mono"], fallback: "nightshade", hotkey: "p" },
  { key: "show", field: "show", title: "Show", values: ["claude", "agents", "busy", "all"], fallback: "claude", hotkey: "w" },
  { key: "desks", field: "desks", title: "Desks at a time", values: [4, 6, 8, 12, "all"], fallback: 8, hotkey: "d" },
  { key: "hideDoneMinutes", field: "hide_done_minutes", title: "Hide done after (min)", values: [0, 5, 15, 30, 60], fallback: 0, hotkey: "h" },
  { key: "seating", field: "seating", title: "Seating", values: ["state", "stable", "project", "workspace"], fallback: "state", hotkey: "o" },
  { key: "speed", field: "speed", title: "Animation speed", values: ["slow", "normal", "fast"], fallback: "normal", hotkey: "m" },
  { key: "reducedMotion", field: "reduced_motion", title: "Reduced motion", values: [false, true], fallback: false, hotkey: "r" },
  { key: "notify", field: "notify", title: "Toasts", values: ["needs-you", "changes", "off"], fallback: "needs-you", hotkey: "n" },
  { key: "render", field: "render", title: "Characters as pictures (hybrid) or cells", values: ["hybrid", "cells"], fallback: "hybrid", hotkey: "g" },
  { key: "sound", field: "sound", title: "Sound when someone needs you", values: [false, true], fallback: false, hotkey: "u" },
];

export const FRAME_MS = { slow: 260, normal: 150, fast: 90 };

/**
 * The options in force: what the settings view stored, else the manifest's
 * userConfig value, else the built-in default. A value outside the list is ignored.
 */
export function resolveOptions(userConfig = {}, stored = {}) {
  const out = {};
  for (const o of OPTIONS) {
    const pick = [stored?.[o.key], userConfig?.[o.field]].find((v) => o.values.some((x) => String(x) === String(v)));
    const value = pick === undefined ? o.fallback : o.values.find((x) => String(x) === String(pick));
    out[o.key] = value;
  }
  return out;
}

/** The next value of an option, as its settings key cycles it. */
export function cycleOption(options, key) {
  const o = OPTIONS.find((x) => x.key === key);
  if (!o) return options;
  const i = o.values.findIndex((v) => String(v) === String(options[key]));
  return { ...options, [key]: o.values[(i + 1) % o.values.length] };
}

// ---- sessions: keys, overrides, changes, seats --------------------------------

/** What a desk is remembered by: its Claude session, else its pane. */
export function deskKey(desk) {
  return desk.sessionId ? `s:${desk.sessionId}` : `p:${desk.paneId}`;
}

/** Applies per-session settings: a label, a character, a pinned seat. */
export function applyOverrides(desks, overrides = {}) {
  return desks.map((d) => {
    const o = overrides[deskKey(d)];
    if (!o) return d;
    return {
      ...d,
      name: typeof o.label === "string" && o.label.trim() ? o.label.trim().slice(0, 40) : d.name,
      character: CHARACTER_KINDS.includes(o.character) ? o.character : d.character,
      pin: Number.isInteger(o.seat) && o.seat > 0 ? o.seat : undefined,
    };
  });
}

/**
 * Notes when each desk's state last changed, and whether a finished session
 * has been looked at. Returns the desks with `changedAt`, `prevStatus` and
 * `unseenDone`, the memory to keep, the changes since last time (a desk seen
 * for the first time is not a change), and `unseen`: the finished sessions
 * nobody has looked at yet, by key, to keep across reloads.
 *
 * A session becomes unseen-done when it moves to done; it is seen once herdr
 * reports its pane focused, or it moves on from done. A session first met
 * already done counts as seen, unless `unseen` (from before a reload) says not.
 */
export function trackChanges(desks, memory = {}, now = 0, unseen = {}) {
  const next = {};
  const changes = [];
  const stillUnseen = {};
  const out = desks.map((d) => {
    const key = deskKey(d);
    const was = memory[key];
    let entry;
    if (!was) {
      const wasUnseen = d.status === "done" && unseen[key] != null;
      entry = { status: d.status, at: wasUnseen ? Number(unseen[key]) : now, prev: wasUnseen ? "working" : null, unseen: wasUnseen };
    } else if (was.status !== d.status) {
      entry = { status: d.status, at: now, prev: was.status, unseen: d.status === "done" };
      changes.push({ desk: d, from: was.status, to: d.status });
    } else {
      entry = { ...was };
    }
    if (entry.unseen && (d.status !== "done" || d.isFocused)) entry.unseen = false;
    next[key] = entry;
    if (entry.unseen) stillUnseen[key] = entry.at;
    return { ...d, changedAt: entry.at, prevStatus: entry.prev, unseenDone: entry.unseen };
  });
  return { desks: out, memory: next, changes, unseen: stillUnseen };
}

/** Leaves out sessions that have been done for longer than `minutes`. */
export function hideStaleDone(desks, minutes, now) {
  if (!minutes) return desks;
  return desks.filter((d) => d.kind === "shell" || d.status !== "done" || now - (d.changedAt ?? now) < minutes * 60000);
}

const FORGET_MS = 24 * 3600000;

/**
 * Puts the desks in order, packed from the first seat with no gaps: the
 * returned `seats` has exactly one entry per desk. `state` (the default):
 * needs you, working, done, idle. `project`, `workspace`: grouped, then by
 * state. `stable`: the order each session last had (remembered in `seats`),
 * newcomers after, by state. A desk dragged to a place (`pin`, from 1) is
 * put back at that place in the packed order, or last when fewer desks are
 * left, so a pin never opens a gap. Returns the order and the memory to keep.
 */
export function seatDesks(desks, mode = "state", seats = {}, now = 0) {
  const memory = {};
  for (const [k, v] of Object.entries(seats ?? {})) if (v && now - (v.seen ?? 0) < FORGET_MS) memory[k] = v;
  const keyOf = mode === "project" ? (d) => d.project || "" : mode === "workspace" ? (d) => d.workspaceId || "" : () => "";
  const was = (d) => {
    const m = memory[deskKey(d)];
    return mode === "stable" && m && Number.isFinite(m.seat) ? m.seat : Infinity;
  };
  const free = desks.filter((d) => !(Number.isInteger(d.pin) && d.pin > 0));
  const list = [...free].sort((a, b) => was(a) - was(b) || keyOf(a).localeCompare(keyOf(b)) || rankOf(a) - rankOf(b) || (a.order ?? 0) - (b.order ?? 0));
  const pinned = desks.filter((d) => !free.includes(d)).sort((a, b) => a.pin - b.pin || rankOf(a) - rankOf(b) || (a.order ?? 0) - (b.order ?? 0));
  for (const d of pinned) list.splice(Math.min(d.pin - 1, list.length), 0, d);
  list.forEach((d, i) => {
    memory[deskKey(d)] = { seat: i, seen: now };
  });
  return { seats: list, memory };
}
