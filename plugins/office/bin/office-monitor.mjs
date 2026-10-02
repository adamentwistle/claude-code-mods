// The office as a standalone full-screen terminal monitor. Same desks, room
// and sprites as the /office pane (hooks/office-scene.mjs), drawn with
// truecolor half blocks on the alternate screen. Needs herdr; no Claude session.
//
//   bin/office-monitor [--layout office] [--characters humans] [--lighting clock]
//                      [--palette nightshade] [--show busy] [--seating stable]
//   bin/office-monitor --once [--size 200x56]   print one frame and exit
//   --pictures draws the office's people as sharp pictures (kitty graphics)
//   over the half-block room, as the pane's hybrid view does.
//
// Keys, as in the pane: q quits; digits jump to a desk; l, c, t, p and g
// cycle the layout, characters, lighting, palette and picture.

import { execFile } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  ACCENT,
  FRAME_MS,
  HOTKEYS,
  STATUS_WORD,
  STATUSES,
  buildDesks,
  countActiveSubagents,
  cycleOption,
  parsePaneList,
  VIEW_KEYS,
  activityFromTail,
  bubbleFor,
  pageOf,
  busyFromTitle,
  projectDirName,
  resolveOptions,
  seatDesks,
  tally,
  trackChanges,
} from "../hooks/office-model.mjs";
import { characterBox, loadAtlas, sharpPng } from "../hooks/office-pictures.mjs";
import { paintPlan, paintRoomCanvas, planScene } from "../hooks/office-scene.mjs";
import {
  alivePids,
  claudeSessionPanes,
  isSessionRecord,
  liveEntries,
  recentTranscripts,
  recordPids,
  registryDir,
  resumeHint,
  sessionPanes,
} from "../hooks/office-sessions.mjs";
import { demoPanes } from "../hooks/office-demo.mjs";

// --pictures: the people as pictures, kitty graphics (which herdr passes
// through to Ghostty), over the half-block room. Half blocks alone otherwise.
const HERE = new URL("..", import.meta.url).pathname;
const ATLAS = (() => {
  try {
    return loadAtlas(readFileSync(join(HERE, "assets/office-atlas.json"), "utf8"), new Uint8Array(readFileSync(join(HERE, "assets/office-atlas.bin"))));
  } catch {
    return null;
  }
})();
let usePictures = process.argv.includes("--pictures") && !process.argv.includes("--cells");

const POLL_MS = process.argv.includes("--demo") ? 1000 : 2000;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(`office-monitor: the office as a full-screen terminal monitor (no Claude session needed)

Usage: bin/office-monitor [flags]

Flags:
  --layout <grid|tiles|office|war-room|strip>   default office
  --characters <critters|humans|robots|animals|mixed>
  --lighting <clock|day|night>
  --palette <nightshade|warm|cool|mono>
  --show <claude|agents|busy|all>   default claude
  --desks <4|6|8|12|all>             default 8
  --seating <state|stable|project|workspace>
  --speed <slow|normal|fast>
  --pictures draw the people as sharp pictures over the room (kitty graphics,
             as in Ghostty or kitty; elsewhere they would not show)
  --cells    half blocks only (the default)
  --demo     a scripted 60-second loop of eight sessions instead of herdr,
             for a screen recording (starts at second 0 on launch)
  --once     print one frame and exit
  --size WxH the size for --once, in cells (default: the terminal's)
  -h, --help this text

Keys:
  1-9, 0     jump to that desk's pane (outside herdr: show its resume command)
  m          the next page of desks
  l d c b t p  cycle layout, desks at a time, characters, style, lighting, palette
  g          pictures on or off
  q, ctrl+c  quit

Without herdr it reads the sessions registry and recent transcripts.
`);
  process.exit(0);
}
const ONCE = process.argv.includes("--once");
const flag = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
let options = resolveOptions(
  {},
  {
    layout: flag("layout") ?? "office",
    characters: flag("characters"),
    lighting: flag("lighting"),
    palette: flag("palette"),
    show: flag("show"),
    desks: flag("desks"),
    seating: flag("seating"),
    speed: flag("speed"),
  },
);
// The monitor's own pane is a shell running node: leave it out of the office.
const OWN_PANE = process.env.HERDR_PANE_ID ?? "";
const ROOTS = [
  ...new Set(
    [process.env.CLAUDE_CONFIG_DIR, join(homedir(), ".claude-work"), join(homedir(), ".claude")]
      .filter(Boolean)
      .map((r) => r.replace(/\/+$/, "")),
  ),
];

const state = { desks: [], seats: [], idleShells: 0, error: "Looking around the office...", procs: {}, helpers: {}, polls: 0, tick: 0, dirs: new Map(), changes: {}, seatMemory: {}, plan: null, planKey: "" };

function run(argv) {
  return new Promise((resolve) => {
    execFile(argv[0], argv.slice(1), { timeout: 5000, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
      resolve({ exitCode: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr), missing: err?.code === "ENOENT" });
    });
  });
}

function sessionDir(sessionId, cwd) {
  const cached = state.dirs.get(sessionId);
  if (cached && (cached.dir || Date.now() - cached.at < 300000)) return cached.dir;
  let dir = null;
  for (const root of ROOTS) {
    const candidate = join(root, "projects", projectDirName(cwd), sessionId);
    if (existsSync(candidate)) {
      dir = candidate;
      break;
    }
  }
  for (const root of dir ? [] : ROOTS) {
    let names = [];
    try {
      names = readdirSync(join(root, "projects"));
    } catch {
      continue;
    }
    const hit = names.find((n) => existsSync(join(root, "projects", n, sessionId)));
    if (hit) {
      dir = join(root, "projects", hit, sessionId);
      break;
    }
  }
  state.dirs.set(sessionId, { dir, at: Date.now() });
  return dir;
}

function scanHelpers(panes) {
  const now = Date.now();
  const out = {};
  for (const p of panes) {
    if (p.agent !== "claude" || !p.sessionId) continue;
    const dir = sessionDir(p.sessionId, p.cwd);
    if (!dir) continue;
    try {
      const sub = join(dir, "subagents");
      const entries = readdirSync(sub).map((name) => {
        const st = statSync(join(sub, name));
        return { name, kind: st.isDirectory() ? "dir" : "file", mtimeMs: st.mtimeMs };
      });
      out[p.sessionId] = countActiveSubagents(entries, now);
    } catch {
      out[p.sessionId] = 0;
    }
  }
  state.helpers = out;
}

// Without herdr: the sessions registry every session running the mod writes,
// and transcripts written in the last half hour, read straight from disk.
let lastScan = 0;
// What a working session is doing, from the last 32 KB of its transcript.
function tailActivity(sessionId, cwd) {
  for (const root of ROOTS) {
    const path = join(root, "projects", projectDirName(cwd), `${sessionId}.jsonl`);
    try {
      const size = statSync(path).size;
      const fd = openSync(path, "r");
      const length = Math.min(size, 32768);
      const buf = Buffer.alloc(length);
      readSync(fd, buf, 0, length, size - length);
      closeSync(fd);
      return activityFromTail(buf.toString("utf8"));
    } catch {
      // not under this root
    }
  }
  return null;
}

function withActivities(panes) {
  for (const p of panes) if (p.agent === "claude" && p.status === "working" && p.sessionId && !p.activity) p.activity = tailActivity(p.sessionId, p.cwd);
  return panes;
}

// Claude Code's records of its running sessions: *.json only, never the .key files.
function readClaudeSessions() {
  const records = [];
  for (const root of ROOTS) {
    const dir = join(root, "sessions");
    let names = [];
    try {
      names = readdirSync(dir).filter(isSessionRecord);
    } catch {
      continue;
    }
    for (const n of names) {
      try {
        records.push(JSON.parse(readFileSync(join(dir, n), "utf8")));
      } catch {
        // being rewritten
      }
    }
  }
  return records;
}

async function pollClaudeSessions(why, records) {
  const now = Date.now();
  const pids = recordPids(records);
  const ps = pids.length ? await run(["ps", "-o", "pid=", "-p", pids.join(",")]) : null;
  const texts = [];
  for (const root of ROOTS) {
    try {
      for (const n of readdirSync(registryDir(root)).filter((x) => x.endsWith(".json"))) texts.push(readFileSync(join(registryDir(root), n), "utf8"));
    } catch {
      // no registry here
    }
  }
  const { panes, helpers } = claudeSessionPanes(records, alivePids(ps?.stdout), now, null, liveEntries(texts, now));
  state.helpers = helpers;
  state.procs = {};
  state.panes = withActivities(panes);
  state.source = `no herdr (${why}): Claude Code sessions, ${panes.length} running`;
  reseat();
  state.error = null;
}

function pollSessions(why) {
  const now = Date.now();
  const texts = [];
  for (const root of ROOTS) {
    const dir = registryDir(root);
    let names = [];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith(".json"));
    } catch {
      continue;
    }
    for (const n of names) {
      try {
        if (now - statSync(join(dir, n)).mtimeMs < 2 * 60000) texts.push(readFileSync(join(dir, n), "utf8"));
      } catch {
        // gone meanwhile
      }
    }
  }
  if (now - lastScan > 15000) {
    lastScan = now;
    state.recent = new Map();
    for (const root of ROOTS) {
      let dirs = [];
      try {
        dirs = readdirSync(join(root, "projects"));
      } catch {
        continue;
      }
      for (const d of dirs) {
        let files = [];
        try {
          files = readdirSync(join(root, "projects", d), { withFileTypes: true })
            .filter((f) => f.isFile() && f.name.endsWith(".jsonl"))
            .map((f) => ({ name: f.name, kind: "file", mtimeMs: statSync(join(root, "projects", d, f.name)).mtimeMs }));
        } catch {
          continue;
        }
        for (const r of recentTranscripts(d, files, now)) state.recent.set(r.id, r);
      }
    }
  }
  const { panes, helpers } = sessionPanes(liveEntries(texts, now), (state.recent ?? new Map()).values(), now, null);
  state.helpers = helpers;
  state.procs = {};
  state.panes = panes;
  state.source = `no herdr (${why}): ${panes.filter((p) => p.source === "registry").length} live, ${panes.filter((p) => p.source === "transcript").length} recent transcripts`;
  reseat();
  state.error = null;
}

// --demo: the scripted loop, from second 0 at launch; herdr is never asked.
const DEMO = process.argv.includes("--demo");
const DEMO_START = Date.now();

async function poll() {
  if (DEMO) {
    const demo = demoPanes(Date.now() - DEMO_START, options.characters);
    state.source = "demo";
    state.procs = {};
    state.helpers = demo.helpers;
    state.panes = demo.panes;
    state.polls++;
    reseat();
    state.error = null;
    return;
  }
  const list = await run(["herdr", "pane", "list"]);
  const why = list.missing ? "herdr is not on PATH" : list.exitCode !== 0 ? `herdr pane list failed: ${(list.stderr || list.stdout).trim().split("\n")[0]}` : "";
  const parsed = why ? null : parsePaneList(list.stdout, OWN_PANE);
  if (why || parsed.error) {
    const records = readClaudeSessions();
    return records.length ? pollClaudeSessions(why || parsed.error, records) : pollSessions(why || parsed.error);
  }
  state.source = "";
  const panes = parsed.panes.filter((p) => p.agent || p.paneId !== OWN_PANE);
  // Busy terminals from their titles: one herdr call per poll, nothing per pane.
  state.procs = Object.fromEntries(panes.filter((p) => !p.agent).map((p) => [p.paneId, busyFromTitle(p.terminalTitle)]));
  if (state.polls % 3 === 0) scanHelpers(panes);
  state.polls++;
  state.panes = withActivities(panes);
  reseat();
  state.error = null;
}

function reseat() {
  const now = Date.now();
  const built = buildDesks(state.panes ?? [], state.procs, state.helpers, options.show);
  const tracked = trackChanges(built.desks, state.changes, now);
  state.changes = tracked.memory;
  // Packed in order from the first desk, then a page at a time (m pages on).
  const seated = seatDesks(tracked.desks, options.seating, state.seatMemory, now);
  state.seatMemory = seated.memory;
  const page = pageOf(seated.seats, options.desks, state.page ?? 0, true);
  state.page = page.page;
  state.pageInfo = page;
  state.desks = tracked.desks;
  state.seats = page.desks;
  state.idleShells = built.idleShells;
}

// ---- drawing ----------------------------------------------------------------

const ESC = "\x1b[";
const fg = (c) => (c >= 0x1000000 ? `${ESC}39m` : `${ESC}38;2;${(c >> 16) & 255};${(c >> 8) & 255};${c & 255}m`);
const bg = (c) => (c >= 0x1000000 ? `${ESC}49m` : `${ESC}48;2;${(c >> 16) & 255};${(c >> 8) & 255};${c & 255}m`);

function footNote() {
  const info = state.pageInfo;
  const more = info && info.pages > 1 ? `+${info.total - state.seats.filter(Boolean).length} more, m: page ${info.page + 1}/${info.pages}` : "";
  const bits = [more, state.source, state.message].filter(Boolean);
  return bits.length ? `   ${bits.join("   ")}` : "";
}

function header(cols) {
  const t = tally(state.desks);
  const clock = new Date().toTimeString().slice(0, 5);
  let out = `${ESC}1m Office ${ESC}22m ${DEMO ? `${ESC}7m demo ${ESC}27m ` : ""}`;
  let width = DEMO ? 15 : 8;
  for (const s of STATUSES) {
    const n = s === "idle" ? t.idle + t.unknown : t[s];
    if (!n || s === "unknown") continue;
    const text = `■ ${n} ${STATUS_WORD[s]}  `;
    out += `${fg(ACCENT[s])}${text}`;
    width += text.length;
  }
  if (state.idleShells) {
    const text = `${state.idleShells} idle shells  `;
    out += `${ESC}2m${fg(0x1000000)}${text}${ESC}22m`;
    width += text.length;
  }
  const pad = Math.max(1, cols - width - clock.length - 2);
  return `${out}${fg(0x1000000)}${" ".repeat(pad)}${ESC}1m${clock}${ESC}22m`;
}

// ---- picture characters ---------------------------------------------------------
// Each desk's person as a sharp PNG over its box of cells. Two kitty image
// ids per desk, used in turn: the new picture goes to the spare id, is placed
// over the box, and only then is the old one freed, so nothing flickers. A
// picture is sent only when it changed.

const pictures = new Map();

function pictureIds(index) {
  return [1000 + index * 2, 1001 + index * 2];
}

function clearPictures() {
  let out = "";
  for (const [index, p] of pictures) out += `\x1b_Ga=d,d=I,i=${p.id},q=2\x1b\\`;
  pictures.clear();
  return out;
}

function pictureFrame(plan, left, visible, now) {
  if (!usePictures || !ATLAS || !plan.portraits?.length) return "";
  let room = null;
  let out = "";
  for (const p of plan.portraits) {
    const desk = plan.desks[p.index]?.seat;
    if (!desk || p.top + p.rows > visible) continue;
    room = room ?? paintRoomCanvas(plan, state.tick, now);
    const pic = characterBox(ATLAS, desk, options.characters, state.tick, now, options.reducedMotion, p, room);
    let print = 2166136261;
    for (let i = 0; i < pic.px.length; i++) print = Math.imul(print ^ pic.px[i], 16777619);
    const was = pictures.get(p.index);
    const place = `${p.left},${p.top},${p.columns},${p.rows}`;
    if (was && was.print === print && was.place === place) continue;
    const [a, b] = pictureIds(p.index);
    const id = was?.id === a ? b : a;
    const data = Buffer.from(sharpPng(pic)).toString("base64");
    for (let i = 0; i < data.length; i += 4096) {
      const more = i + 4096 < data.length ? 1 : 0;
      out += `\x1b_G${i === 0 ? `a=t,f=100,i=${id},q=2,` : ""}m=${more};${data.slice(i, i + 4096)}\x1b\\`;
    }
    out += `${ESC}${p.top + 2};${left + p.left + 1}H\x1b_Ga=p,i=${id},p=1,c=${p.columns},r=${p.rows},C=1,q=2\x1b\\`;
    if (was) out += `\x1b_Ga=d,d=I,i=${was.id},q=2\x1b\\`;
    pictures.set(p.index, { id, print, place });
    state.lastPayload = data.length;
  }
  return out;
}

function frame() {
  const [fw, fh] = String(flag("size") ?? "").split("x").map(Number);
  const cols = fw || process.stdout.columns || 100;
  const rows = fh || process.stdout.rows || 30;
  const lines = [header(cols)];
  let extra = "";
  if (state.error || !state.desks.length) {
    extra = clearPictures();
    lines.push("", `  ${state.error ?? "No agent or busy terminal panes in herdr."}`);
  } else {
    const key = `${cols}x${rows}:${JSON.stringify(options)}:${state.seats.map((d) => (d ? `${d.paneId}${d.status}${d.helpers}${d.name}` : "-")).join("|")}`;
    if (!state.plan || state.planKey !== key) {
      // No tile pictures here: the tiles layout draws its characters in cells.
      state.plan = planScene(options.layout, state.seats, cols, rows - 2, { ...options, isFull: true, portraits: false, hybrid: usePictures && Boolean(ATLAS) });
      state.planKey = key;
      extra = clearPictures();
    }
    const layout = state.plan;
    const words = paintPlan(layout, state.tick, Date.now());
    const left = " ".repeat(Math.max(0, Math.floor((cols - layout.columns) / 2)));
    const visible = Math.min(layout.rows, rows - 2);
    for (let r = 0; r < visible; r++) {
      let line = left;
      let lastFg = -1;
      let lastBg = -1;
      for (let c = 0; c < layout.columns; c++) {
        const at = (r * layout.columns + c) * 3;
        if (words[at + 1] !== lastFg) line += fg((lastFg = words[at + 1]));
        if (words[at + 2] !== lastBg) line += bg((lastBg = words[at + 2]));
        line += String.fromCodePoint(words[at]);
      }
      lines.push(`${line}${ESC}0m`);
    }
    if (layout.rows > visible) lines.push(`${ESC}2m  ${state.desks.length} desks; widen or heighten the pane to see them all${ESC}22m`);
    extra += pictureFrame(layout, left.length, visible, Date.now());
  }
  while (lines.length < rows - 1) lines.push("");
  lines.push(`${ESC}2m q quit   1-9 0 jump to a desk   l ${options.layout}  c ${options.characters}  t ${options.lighting}  p ${options.palette}${footNote()}${ESC}22m`);
  return `${ESC}H${lines.map((l) => `${l}${ESC}0m${ESC}K`).join("\r\n")}${extra}`;
}

async function jump(index) {
  const desk = state.seats[index];
  if (!desk) return;
  if (DEMO) {
    state.message = `demo: would jump to ${desk.name}`;
    return;
  }
  // Outside herdr there is no pane to focus: show how to resume it.
  if (desk.source) {
    const hint = resumeHint(desk);
    state.message = `${desk.name} in ${hint.where}: ${hint.text}`;
    return;
  }
  if (desk.workspaceId) await run(["herdr", "workspace", "focus", desk.workspaceId]);
  if (desk.tabId) await run(["herdr", "tab", "focus", desk.tabId]);
  if (desk.kind === "agent") await run(["herdr", "agent", "focus", desk.paneId]);
}

// ---- main -----------------------------------------------------------------

// A frame drawn as one synchronized update: the terminal shows it whole.
const sync = (text) => `\x1b[?2026h${text}\x1b[?2026l`;

if (ONCE) {
  await poll();
  process.stdout.write(`${frame().replace(`${ESC}H`, "")}${ESC}0m\n`);
  if (state.lastPayload) process.stderr.write(`picture: ${state.lastPayload} bytes of kitty graphics per character, sent only when it changes\n`);
  process.exit(0);
}

const out = process.stdout;
let timers = [];
function quit(code = 0) {
  for (const t of timers) clearInterval(t);
  // Take the pictures down with us.
  out.write(`${clearPictures()}${ESC}0m${ESC}?25h${ESC}?1049l`);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(code);
}

out.write(`${ESC}?1049h${ESC}?25l${ESC}2J`);
process.on("SIGINT", () => quit(0));
process.on("SIGTERM", () => quit(0));
process.on("uncaughtException", (err) => {
  out.write(`${ESC}0m${ESC}?25h${ESC}?1049l`);
  console.error(err);
  process.exit(1);
});
// Clearing the screen takes the pictures with it: send them again.
out.on("resize", () => out.write(sync(`${clearPictures()}${ESC}2J${frame()}`)));
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (buf) => {
    const key = buf.toString();
    if (key === "q" || key === "\x03") return quit(0);
    if (VIEW_KEYS[key] === "render") {
      usePictures = !usePictures;
      state.plan = null;
      process.stdout.write(sync(clearPictures()));
      return;
    }
    if (VIEW_KEYS[key]) {
      options = cycleOption(options, VIEW_KEYS[key]);
      reseat();
      return;
    }
    if (key === "m") {
      state.page = (state.page ?? 0) + 1;
      reseat();
      return;
    }
    const i = HOTKEYS.indexOf(key);
    if (i >= 0) jump(i);
  });
}

let busy = false;
const tickPoll = async () => {
  if (busy) return;
  busy = true;
  try {
    await poll();
  } finally {
    busy = false;
  }
};
await tickPoll();
out.write(sync(frame()));
timers = [
  setInterval(tickPoll, POLL_MS),
  setInterval(() => {
    state.tick++;
    out.write(sync(frame()));
  }, FRAME_MS[options.speed] ?? 150),
];
