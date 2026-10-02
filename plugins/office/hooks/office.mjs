// Office: a pixel-art office of every busy terminal in herdr. One desk per
// agent pane (and per plain pane running something), each worker animated by
// its pane's state, minions for a session's active subagents. Name tags are
// buttons: a desk's hotkey jumps to its pane. `/office` opens it, `/office
// full` makes it as big as a pane can be, `s` opens the settings, `/office
// close` closes it.
//
// herdr is polled, subagent folders listed and the animation run only while
// the pane is on screen; every timer stops when it closes.

import {
  ACCENT,
  CHARACTER_KINDS,
  FRAME_MS,
  HOTKEYS,
  OPTIONS,
  STATUS_WORD,
  STATUSES,
  applyOverrides,
  VIEW_KEYS,
  activityFromTail,
  activityOfTool,
  bubbleFor,
  buildDesks,
  pageOf,
  busyFromTitle,
  countActiveSubagents,
  cycleOption,
  deskKey,
  hideStaleDone,
  parsePaneList,
  projectDirName,
  resolveOptions,
  seatDesks,
  tally,
  toBase64,
  trackChanges,
} from "./office-model.mjs";
import { characterBox, loadAtlas, portraitMoves, sharpPng } from "./office-pictures.mjs";
import { demoPanes } from "./office-demo.mjs";
import { hitRects, paintPlan, paintRoomCanvas, planScene } from "./office-scene.mjs";
import {
  HEARTBEAT_MS,
  REGISTRY_TTL_MS,
  alivePids,
  claudeSessionPanes,
  isSessionRecord,
  liveEntries,
  recentTranscripts,
  recordPids,
  registryDir,
  registryEntry,
  resumeHint,
  sessionPanes,
} from "./office-sessions.mjs";

const PANE = "office";
const RASTER = "office-floor";
// One `herdr pane list` per poll and nothing else spawned: every 3 s, every 4 s full size.
const POLL_MS = 3000;
const POLL_FULL_MS = 4000;
const HELPERS_EVERY = 3; // polls between subagent scans
const ACTIVE_MS = 60000;
const DIR_RETRY_MS = 600000;
const SOUND = "sounds/needs-you.wav";
const PROBE_MS = 400;
// Outside herdr: project folders listed for recent transcripts per poll.
const SCAN_PER_POLL = 25;
const HERDR_RETRY_MS = 60000;
const PORTRAIT_MS = 1000;
// Transcript tails read per poll, at most, to tell thinking from coding.
const TAILS_PER_POLL = 3;

// Module state. A reload starts it over and drops the timers with it; the
// pane's next draw starts them again. What must outlive a reload is in $.store.
const state = {
  userConfig: {},
  stored: {},
  options: resolveOptions(),
  overrides: {},
  seatMemory: {},
  changeMemory: {},
  unseen: {},
  isLoaded: false,
  panes: [],
  procs: {},
  helpers: {},
  sessionDirs: new Map(),
  projectNames: new Map(),
  roots: null,
  desks: [],
  seats: [],
  idleShells: 0,
  error: null,
  hasData: false,
  isFull: false,
  view: "office",
  picked: null,
  polls: 0,
  selfPaneId: undefined,
  isPolling: false,
  poll: null,
  pollMs: 0,
  frame: null,
  isBlitting: false,
  frameMs: 0,
  tick: 0,
  minute: "",
  lastColumns: 0,
  plan: null,
  atlas: null,
  isAtlasTried: false,
  // Where the desks come from: herdr's panes, or the sessions registry.
  source: "herdr",
  sourceNote: "",
  herdrMissingUntil: 0,
  scans: new Map(),
  recent: new Map(),
  // This session's own registry entry, and its heartbeat.
  reg: null,
  heartbeat: null,
  // Tiles: what each tile's picture last showed, and whether pictures draw.
  portraitSent: new Map(),
  portraitTimer: null,
  tileSupport: "unknown",
  // Paging through the desks, a few at a time.
  page: 0,
  pageInfo: { page: 0, pages: 1, total: 0 },
  // How many desks fit the pane without scrolling (0: all of a page), and the
  // header's height as last measured.
  // Demo mode: a scripted minute instead of herdr (`OFFICE_DEMO=1`, `/office
  // demo`): when it started, and the real memories it set aside.
  demo: null,
  isDemoEnvRead: false,
  fitCap: 0,
  ordered: [],
  pageSize: 0,
  headerRows: 2,
  // Why the people are cells where pictures were asked for, shown in the header.
  pictureNote: "",
  pictureDeny: "",
  // What each session is doing (thinking, coding...), and the transcripts read for it.
  activity: new Map(),
  transcripts: new Map(),
};

const hex = (n) => `#${n.toString(16).padStart(6, "0")}`;

async function load($) {
  if (state.isLoaded) return;
  state.isLoaded = true;
  const [stored, overrides, seats, unseen, seenConfig] = await Promise.all([
    $.store.get("options").catch(() => undefined),
    $.store.get("sessions").catch(() => undefined),
    $.store.get("seats").catch(() => undefined),
    $.store.get("unseen").catch(() => undefined),
    $.store.get("optionsConfig").catch(() => undefined),
  ]);
  state.unseen = unseen && typeof unseen === "object" ? unseen : {};
  state.stored = stored && typeof stored === "object" ? stored : {};
  // A setting changed in the plugin's config since the settings view saved
  // its own value wins: the stored one is dropped. Without a record of the
  // config (before v10), the config in force now is taken as the one seen.
  const was = seenConfig && typeof seenConfig === "object" ? seenConfig : configSnapshot();
  const now = configSnapshot();
  const kept = { ...state.stored };
  for (const o of OPTIONS) if (String(was[o.field] ?? "") !== String(now[o.field] ?? "")) delete kept[o.key];
  if (Object.keys(kept).length !== Object.keys(state.stored).length) {
    state.stored = kept;
    await $.store.set("options", kept).catch(() => {});
  }
  if (JSON.stringify(was) !== JSON.stringify(now) || !seenConfig) await $.store.set("optionsConfig", now).catch(() => {});
  state.overrides = overrides && typeof overrides === "object" ? overrides : {};
  state.seatMemory = seats && typeof seats === "object" ? seats : {};
  state.options = resolveOptions(state.userConfig, state.stored);
  await migrateSeats($);
}

// The plugin's config values for the options, as they are now.
function configSnapshot() {
  const out = {};
  for (const o of OPTIONS) if (state.userConfig?.[o.field] !== undefined) out[o.field] = state.userConfig[o.field];
  return out;
}

// Before v10 a dragged desk was pinned to an absolute seat number (25, 49),
// and the office drew every seat up to it, mostly empty. Seats are packed
// now and a pin is a place in that order: the old numbers are dropped once,
// names and characters kept.
async function migrateSeats($) {
  const version = await $.store.get("seatingVersion").catch(() => undefined);
  if (version === 2) return;
  const next = {};
  for (const [k, o] of Object.entries(state.overrides)) {
    if (!o || typeof o !== "object") continue;
    const { seat, ...rest } = o;
    if (Object.keys(rest).length) next[k] = rest;
  }
  state.overrides = next;
  await $.store.set("sessions", next).catch(() => {});
  await $.store.set("seatingVersion", 2).catch(() => {});
}

function signature() {
  if (state.error) return state.error;
  if (state.source !== "herdr" && !state.seats.length) return `none:${state.sourceNote}`;
  const seats = state.seats.map((d) => (d ? `${d.paneId}:${d.kind}:${d.status}:${d.name}:${d.helpers}:${d.character ?? ""}:${d.unseenDone ? 1 : 0}` : "-")).join("|");
  return `${seats}#${state.idleShells}#${state.isFull ? state.minute : ""}`;
}

async function runQuiet($, argv) {
  try {
    return await $.process.run(argv, { timeoutMs: 5000 });
  } catch {
    return null;
  }
}

// The Claude config folders to look in for session transcripts.
async function configRoots($) {
  if (state.roots) return state.roots;
  const home = (await $.env.get("HOME")) ?? "";
  const custom = (await $.env.get("CLAUDE_CONFIG_DIR")) ?? "";
  const roots = [custom, home && `${home}/.claude-work`, home && `${home}/.claude`].filter(Boolean);
  state.roots = [...new Set(roots.map((r) => r.replace(/\/+$/, "")))];
  return state.roots;
}

// A session's transcript folder. Claude Code names it after the folder the
// session started in: the pane's cwd, or one above it. Looked up with $.fs
// alone, and remembered either way (a miss is tried again after ten minutes).
async function sessionDir($, sessionId, cwd, now) {
  const cached = state.sessionDirs.get(sessionId);
  if (cached && (cached.dir || now - cached.at < DIR_RETRY_MS)) return cached.dir;
  let dir = null;
  const roots = await configRoots($);
  const parts = String(cwd ?? "").split("/").filter(Boolean);
  const names = [];
  for (let i = parts.length; i >= 1 && names.length < 6; i--) names.push(projectDirName(`/${parts.slice(0, i).join("/")}`));
  search: for (const root of roots) {
    // Only the folders that exist: one listing per config folder, kept a while.
    const known = await projectNames($, root, now);
    for (const name of names.filter((n) => known.has(n))) {
      const candidate = `${root}/projects/${name}/${sessionId}`;
      if (await $.fs.exists(candidate).catch(() => false)) {
        dir = candidate;
        break search;
      }
    }
  }
  state.sessionDirs.set(sessionId, { dir, at: now });
  return dir;
}

// The project folder names under a config folder, listed once every ten minutes.
async function projectNames($, root, now) {
  const cached = state.projectNames.get(root);
  if (cached && now - cached.at < DIR_RETRY_MS) return cached.names;
  const entries = await $.fs.list(`${root}/projects`).catch(() => []);
  const names = new Set(entries.filter((e) => e.kind === "dir").map((e) => e.name));
  state.projectNames.set(root, { names, at: now });
  return names;
}

// Subagent transcripts written to in the last minute, per session.
async function scanHelpers($, panes, now) {
  const agents = panes.filter((p) => p.agent === "claude" && p.sessionId);
  const counts = await Promise.all(
    agents.map(async (p) => {
      const dir = await sessionDir($, p.sessionId, p.cwd, now);
      if (!dir) return [p.sessionId, 0];
      const entries = await $.fs.list(`${dir}/subagents`).catch(() => []);
      return [p.sessionId, countActiveSubagents(entries, now, ACTIVE_MS)];
    }),
  );
  state.helpers = Object.fromEntries(counts);
}

// From the last poll to the seats on screen: which panes, overrides, state
// changes, hiding, seating. Returns the state changes since last time.
async function recompute($, now) {
  const o = state.options;
  const built = buildDesks(state.panes, state.procs, state.helpers, o.show);
  const tracked = trackChanges(applyOverrides(built.desks, state.overrides), state.changeMemory, now, state.unseen);
  state.changeMemory = tracked.memory;
  // Finished sessions not yet looked at, kept so a reload goes on celebrating them.
  if (JSON.stringify(tracked.unseen) !== JSON.stringify(state.unseen)) {
    state.unseen = tracked.unseen;
    if (!state.demo) await $.store.set("unseen", tracked.unseen).catch(() => {});
  }
  const shown = hideStaleDone(tracked.desks, Number(o.hideDoneMinutes) || 0, now).map((d) => ({ ...d, activity: d.activity ?? state.activity.get(d.sessionId)?.activity ?? null }));
  // Packed in order from the first desk, then the page on show: at most
  // `desks` at a time, and no more than fit the pane without scrolling.
  const seated = seatDesks(shown, o.seating, state.seatMemory, now);
  const cap = Number(o.desks) || Infinity;
  const size = Math.min(cap, state.fitCap || Infinity);
  const page = pageOf(seated.seats, Number.isFinite(size) ? size : "all", state.page, true);
  state.page = page.page;
  state.pageInfo = page;
  state.desks = shown;
  state.ordered = seated.seats;
  state.pageSize = Number.isFinite(size) ? size : seated.seats.length;
  state.seats = page.desks;
  state.idleShells = built.idleShells;
  if (JSON.stringify(seated.memory) !== JSON.stringify(state.seatMemory)) {
    state.seatMemory = seated.memory;
    if (!state.demo) await $.store.set("seats", seated.memory).catch(() => {});
  }
  return tracked.changes;
}

// Toasts and the chime for state changes, as the options say. The chime is
// not awaited, so the poll never waits on a sound.
function announce($, changes) {
  const o = state.options;
  for (const ch of changes) {
    const needsYou = ch.to === "blocked";
    if (needsYou && o.notify !== "off") $.ui.toast(`${ch.desk.name} needs you`);
    else if (o.notify === "changes") $.ui.toast(`${ch.desk.name}: ${STATUS_WORD[ch.from] ?? ch.from} to ${STATUS_WORD[ch.to] ?? ch.to}`);
    if (needsYou && o.sound) $.audio.play({ asset: SOUND }).catch(() => {});
  }
}

// One poll. Returns true when what the office shows changed.
async function refresh($) {
  if (state.isPolling) return false;
  state.isPolling = true;
  const before = state.hasData ? signature() : null;
  try {
    await load($);
    if (state.selfPaneId === undefined) state.selfPaneId = (await $.env.get("HERDR_PANE_ID")) ?? null;
    const now = await $.clock.now();
    if (!state.isDemoEnvRead) {
      state.isDemoEnvRead = true;
      if ((await $.env.get("OFFICE_DEMO")) === "1") startDemo(now);
    }
    // Demo mode: the scripted minute, and nothing asked of herdr or the disk.
    if (state.demo) {
      const demo = demoPanes(now - state.demo.start, state.options.characters);
      state.source = "demo";
      state.sourceNote = "";
      state.error = null;
      state.procs = {};
      state.helpers = demo.helpers;
      state.panes = demo.panes;
      state.polls++;
      const changes = await recompute($, now);
      if (state.hasData) announce($, changes);
      const d = new Date(now);
      state.minute = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      return signature() !== before;
    }
    // Without herdr (missing, or failing), the sessions registry and recent
    // transcripts stand in; herdr is asked again a minute later.
    const run = now < state.herdrMissingUntil ? null : await runQuiet($, ["herdr", "pane", "list"]);
    let parsed = null;
    let why = "";
    if (!run) why = "herdr is not available";
    else if (run.exitCode !== 0) why = `herdr pane list failed: ${String(run.stderr || run.stdout || "").trim().split("\n")[0].slice(0, 80)}`;
    else {
      parsed = parsePaneList(run.stdout, state.selfPaneId);
      if (parsed.error) why = parsed.error;
    }
    if (why) {
      if (run !== null || now >= state.herdrMissingUntil) state.herdrMissingUntil = now + HERDR_RETRY_MS;
      state.source = "sessions";
      state.sourceNote = why;
      const fallback = await readSessions($, now);
      state.error = null;
      state.helpers = fallback.helpers;
      state.procs = {};
      state.panes = fallback.panes;
      state.polls++;
      const changes = await recompute($, now);
      if (state.hasData) announce($, changes);
      return signature() !== before;
    }
    state.source = "herdr";
    state.sourceNote = "";
    state.error = null;
    // Busy terminals from their titles: no process spawned per pane.
    state.procs = Object.fromEntries(parsed.panes.filter((p) => !p.agent).map((p) => [p.paneId, busyFromTitle(p.terminalTitle)]));
    // Not on the first poll: the first draw waits for it.
    if (state.polls % HELPERS_EVERY === 1) await scanHelpers($, parsed.panes, now).catch(() => {});
    await readActivities($, parsed.panes, now).catch(() => {});
    state.polls++;
    state.panes = parsed.panes;
    const changes = await recompute($, now);
    if (state.hasData) announce($, changes);
    const d = new Date(now);
    state.minute = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } finally {
    state.isPolling = false;
    state.hasData = true;
  }
  return signature() !== before;
}

// ---- sessions without herdr ---------------------------------------------------

// The registry's live entries and the recent transcripts, read with $.fs.
async function readSessions($, now) {
  const roots = await configRoots($);
  const ownEntries = await readRegistry($, roots, now);
  const selfId = state.reg?.id ?? null;
  // Claude Code's own records of its running sessions, when there are any.
  const records = await readClaudeSessions($, roots);
  if (records.length) {
    const pids = recordPids(records);
    const ps = pids.length ? await runQuiet($, ["ps", "-o", "pid=", "-p", pids.join(",")]) : null;
    const result = claudeSessionPanes(records, alivePids(ps?.stdout), now, selfId, ownEntries);
    await addTailActivities($, result.panes, now);
    state.sourceKind = "claude";
    return result;
  }
  state.sourceKind = "registry";
  const texts = [];
  for (const root of roots) {
    const dir = registryDir(root);
    const entries = await $.fs.list(dir).catch(() => []);
    for (const e of entries) {
      if (e.kind !== "file" || !e.name.endsWith(".json") || now - Number(e.mtimeMs || 0) > REGISTRY_TTL_MS) continue;
      const text = await $.fs.read(`${dir}/${e.name}`).catch(() => null);
      if (typeof text === "string") texts.push(text);
    }
  }
  await scanTranscripts($, roots, now);
  return sessionPanes(liveEntries(texts, now), state.recent.values(), now, selfId);
}

// `<config>/sessions/*.json`: Claude Code's record of each running session.
// The folder also holds .key files, which are secrets: only *.json is read.
async function readClaudeSessions($, roots) {
  const records = [];
  for (const root of roots) {
    const dir = `${root}/sessions`;
    const entries = await $.fs.list(dir).catch(() => []);
    for (const e of entries) {
      if (e.kind !== "file" || !isSessionRecord(e.name)) continue;
      const text = await $.fs.read(`${dir}/${e.name}`).catch(() => null);
      try {
        if (typeof text === "string") records.push(JSON.parse(text));
      } catch {
        // a record being rewritten: next poll
      }
    }
  }
  return records;
}

// This mod's registry entries: richer state, and what each session is doing.
async function readRegistry($, roots, now) {
  const texts = [];
  for (const root of roots) {
    const dir = registryDir(root);
    const entries = await $.fs.list(dir).catch(() => []);
    for (const e of entries) {
      if (e.kind !== "file" || !e.name.endsWith(".json") || now - Number(e.mtimeMs || 0) > REGISTRY_TTL_MS) continue;
      const text = await $.fs.read(`${dir}/${e.name}`).catch(() => null);
      if (typeof text === "string") texts.push(text);
    }
  }
  return liveEntries(texts, now);
}

// In herdr: what each working session is doing, from its registry entry when
// it runs this mod, else from the tail of its transcript.
async function readActivities($, panes, now) {
  const roots = await configRoots($);
  const entries = await readRegistry($, roots, now);
  for (const e of entries) if (e.activity) state.activity.set(e.id, { activity: e.activity, at: now });
  await addTailActivities($, panes.filter((p) => p.agent === "claude" && p.sessionId && !entries.some((e) => e.id === p.sessionId && e.activity)), now);
}

// One `tail` of a transcript per working session whose transcript changed,
// a few per poll at most: the last assistant block says thinking, writing or a tool.
async function addTailActivities($, panes, now) {
  let budget = TAILS_PER_POLL;
  for (const p of panes) {
    if (p.status !== "working" || !p.sessionId || p.activity) continue;
    const path = await transcriptPath($, p.sessionId, p.cwd, now);
    if (!path) continue;
    const stat = await $.fs.stat(path).catch(() => null);
    if (!stat) continue;
    const known = state.transcripts.get(p.sessionId);
    if (known && known.mtimeMs === stat.mtimeMs) {
      p.activity = known.activity;
      continue;
    }
    if (budget-- <= 0) continue;
    const run = await runQuiet($, ["tail", "-c", "32768", path]);
    const activity = run?.exitCode === 0 ? activityFromTail(run.stdout) : null;
    state.transcripts.set(p.sessionId, { mtimeMs: stat?.mtimeMs ?? 0, activity, path });
    if (activity) state.activity.set(p.sessionId, { activity, at: now });
    p.activity = activity;
  }
}

// A session's transcript: `<config>/projects/<folder>/<id>.jsonl`, the folder
// named after the cwd or a folder above it. Cached, misses included.
async function transcriptPath($, sessionId, cwd, now) {
  const cached = state.transcripts.get(`path:${sessionId}`);
  if (cached && (cached.path || now - cached.at < DIR_RETRY_MS)) return cached.path;
  let path = null;
  const roots = await configRoots($);
  const parts = String(cwd ?? "").split("/").filter(Boolean);
  const names = [];
  for (let i = parts.length; i >= 1 && names.length < 6; i--) names.push(projectDirName(`/${parts.slice(0, i).join("/")}`));
  search: for (const root of roots) {
    const known = await projectNames($, root, now);
    for (const name of names.filter((n) => known.has(n))) {
      const candidate = `${root}/projects/${name}/${sessionId}.jsonl`;
      if (await $.fs.exists(candidate).catch(() => false)) {
        path = candidate;
        break search;
      }
    }
  }
  state.transcripts.set(`path:${sessionId}`, { path, at: now });
  return path;
}

// A few project folders per poll, round the list, for transcripts written in
// the last half hour: all of them every few minutes, never all at once.
async function scanTranscripts($, roots, now) {
  for (const root of roots) {
    let scan = state.scans.get(root);
    let perPoll = SCAN_PER_POLL;
    if (!scan || now - scan.at > DIR_RETRY_MS) {
      // Newest folders first (a new transcript touches its folder), so recent
      // sessions show on the first poll; one stat per folder, every ten minutes.
      const entries = await $.fs.list(`${root}/projects`).catch(() => []);
      const dirs = entries.filter((e) => e.kind === "dir").map((e) => e.name);
      const stamped = await Promise.all(dirs.map(async (name) => [name, (await $.fs.stat(`${root}/projects/${name}`).catch(() => null))?.mtimeMs ?? 0]));
      stamped.sort((a, b) => b[1] - a[1]);
      scan = { names: stamped.map(([name]) => name), at: now, i: 0 };
      state.scans.set(root, scan);
      perPoll = SCAN_PER_POLL * 2;
    }
    for (let k = 0; k < Math.min(perPoll, scan.names.length); k++) {
      const name = scan.names[scan.i % scan.names.length];
      scan.i++;
      const files = await $.fs.list(`${root}/projects/${name}`).catch(() => []);
      for (const r of recentTranscripts(name, files, now)) state.recent.set(r.id, r);
    }
  }
  for (const [id, r] of state.recent) if (now - r.mtimeMs > 30 * 60000) state.recent.delete(id);
}

// This session's own entry in the registry, so other sessions' offices see it.
async function registryRoot($) {
  const custom = (await $.env.get("CLAUDE_CONFIG_DIR")) ?? "";
  const home = (await $.env.get("HOME")) ?? "";
  return custom || (home ? `${home}/.claude` : "");
}

// Writes the entry as it stands when called: a state that moves on while the
// write waits does not change what this write says.
// Writes go out one after another, so the last word written is the last said.
let regWrites = Promise.resolve();
function writeEntry($, isLeaving = false) {
  const reg = state.reg ? { ...state.reg } : null;
  if (!reg?.root) return regWrites;
  regWrites = regWrites
    .then(async () => {
      const now = isLeaving ? 0 : await $.clock.now();
      await $.fs.write(`${registryDir(reg.root)}/${reg.id}.json`, JSON.stringify(registryEntry({ id: reg.id, cwd: reg.cwd, state: reg.state, helpers: reg.helpers, activity: reg.activity ?? null, now })));
    })
    .catch(() => {});
  return regWrites;
}

function setRegState($, next, activity) {
  if (!state.reg) return;
  const nextActivity = next === "working" ? activity ?? state.reg.activity ?? null : null;
  if (state.reg.state === next && state.reg.activity === nextActivity) return;
  state.reg.state = next;
  state.reg.activity = nextActivity;
  writeEntry($).catch(() => {});
}

// ---- pictures -------------------------------------------------------------------

async function ensureAtlas($) {
  if (state.atlas || state.isAtlasTried) return state.atlas;
  state.isAtlasTried = true;
  try {
    const [json, bin] = await Promise.all([
      $.fs.read(`${$.plugin.root}/assets/office-atlas.json`),
      $.fs.read(`${$.plugin.root}/assets/office-atlas.bin`, { as: "bytes" }),
    ]);
    state.atlas = loadAtlas(json, Uint8Array.fromBase64(bin.base64));
  } catch {
    state.atlas = null;
  }
  return state.atlas;
}

// Sends one frame of the current plan, never two at once: a slow terminal
// skips frames instead of piling them up. A plan replaced meanwhile (a new
// layout, size or seating) is not sent.
async function pushFrame($) {
  const plan = state.plan;
  if (!plan || state.view !== "office" || state.isBlitting) return;
  state.isBlitting = true;
  try {
    const now = await $.clock.now();
    if (state.plan !== plan) return;
    state.tick++;
    await $.ui.blit({ requestId: PANE, key: RASTER, columns: plan.columns, rows: plan.rows, cells: toBase64(new Uint8Array(paintPlan(plan, state.tick, now).buffer)) });
  } catch {
    // a frame lost: the next one follows
  } finally {
    state.isBlitting = false;
  }
}

function seatIn(plan, x, y) {
  const h = hitRects(plan).find((r) => x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height);
  return h ? h.index : -1;
}

// ---- tile pictures -----------------------------------------------------------

// A tile's picture, kept as last sent while it shows the same thing: a redraw
// then sends nothing, and only a changed or moving tile is sent again.
function portraitSource(desk, p, now, isForTree, bg) {
  const key = `${p.isHybrid ? "h" : "t"}:${p.index}:${desk.paneId}:${p.columns}x${p.rows}`;
  const moves = portraitMoves(desk, state.options.reducedMotion);
  const sig = `${desk.status}:${desk.unseenDone ? 1 : 0}:${desk.isSelf ? 1 : 0}:${state.options.characters}:${desk.character ?? ""}:${moves ? state.tick : 0}`;
  const last = state.portraitSent.get(key);
  if (last && (isForTree || last.sig === sig)) return last.source;
  // The hybrid view's picture carries the room's own pixels under it; a
  // tile's, the card's colour. Enlarged pixel for pixel, so it stays sharp.
  const room = p.isHybrid ? (bg ?? paintRoomCanvas(state.plan, state.tick, now)) : null;
  const pic = characterBox(state.atlas, desk, state.options.characters, state.tick, now, state.options.reducedMotion, p, room);
  const source = { png: toBase64(sharpPng(pic)) };
  state.portraitSent.set(key, { sig, source });
  return source;
}

// Once a second at most, each tile whose picture changed or moves; none when still.
function startPortraits($) {
  if (state.portraitTimer) return;
  state.portraitTimer = $.clock.every(PORTRAIT_MS, () => {
    pushPortraits($).catch(() => {});
  });
}

async function pushPortraits($) {
  const plan = state.plan;
  // One blit in flight at a time, the office's frames and the tiles' together.
  if (!plan?.portraits?.length || state.view !== "office" || state.isBlitting || state.tileSupport === "no") return;
  state.isBlitting = true;
  try {
    const now = await $.clock.now();
    let bg = null;
    for (const p of plan.portraits) {
      if (state.plan !== plan) return;
      const desk = plan.isHybrid ? plan.desks[p.index]?.seat : plan.seats[p.index];
      if (!desk) continue;
      const key = `${p.isHybrid ? "h" : "t"}:${p.index}:${desk.paneId}:${p.columns}x${p.rows}`;
      const before = state.portraitSent.get(key)?.source;
      if (p.isHybrid && !bg) bg = paintRoomCanvas(plan, state.tick, now);
      const source = portraitSource(desk, p, now, false, bg);
      if (source === before) continue;
      await $.ui.blit({ requestId: PANE, key: `portrait-${p.index + 1}`, source });
    }
  } finally {
    state.isBlitting = false;
  }
}

// The first tile picture tells whether pictures draw here.
async function probeTiles($) {
  const plan = state.plan;
  const p = plan?.portraits?.[0];
  if (!p || state.tileSupport !== "unknown") return;
  if (state.isBlitting) {
    $.clock.after(PROBE_MS, () => probeTiles($).catch(() => {}));
    return;
  }
  const desk = plan.isHybrid ? plan.desks[p.index]?.seat : plan.seats[p.index];
  state.isBlitting = true;
  let r;
  try {
    r = await $.ui.blit({ requestId: PANE, key: `portrait-${p.index + 1}`, source: portraitSource(desk, p, await $.clock.now(), true) });
  } catch (err) {
    r = { deny: String(err?.message ?? err) };
  } finally {
    state.isBlitting = false;
  }
  if (!r?.deny) state.tileSupport = "yes";
  else if (/alt/i.test(r.deny)) {
    state.tileSupport = "no";
    state.pictureDeny = String(r.deny).slice(0, 60);
    $.ui.invalidate("ui.render");
  }
}

function startTimers($) {
  // The demo's script moves by the second: it is read every second.
  const pollMs = state.demo ? 1000 : state.isFull ? POLL_FULL_MS : POLL_MS;
  if (state.poll && state.pollMs !== pollMs) {
    state.poll.cancel();
    state.poll = null;
  }
  if (!state.poll) {
    state.pollMs = pollMs;
    state.poll = $.clock.every(pollMs, () => {
      refresh($)
        .then((changed) => {
          if (changed) $.ui.invalidate("ui.render");
        })
        .catch(() => {});
    });
  }
  const ms = FRAME_MS[state.options.speed] ?? FRAME_MS.normal;
  if (state.frame && state.frameMs !== ms) {
    state.frame.cancel();
    state.frame = null;
  }
  if (!state.frame) {
    state.frameMs = ms;
    state.frame = $.clock.every(ms, () => {
      const plan = state.plan;
      if (!plan || state.view !== "office") return;
      pushFrame($).catch(() => {});
    });
  }
}

function stopTimers() {
  state.portraitTimer?.cancel();
  state.portraitTimer = null;
  state.poll?.cancel();
  state.frame?.cancel();
  state.poll = null;
  state.frame = null;
  state.plan = null;
}

// Focus a desk's pane: its workspace, its tab, then the pane itself.
async function jumpTo($, desk) {
  if (state.demo) {
    $.ui.toast(`demo: would jump to ${desk.name}`);
    return;
  }
  // Outside herdr there is no pane to focus: copy the command that resumes it.
  if (desk.source) {
    const hint = resumeHint(desk);
    await $.ui.copy({ text: hint.text }).catch(() => {});
    $.ui.toast(`${desk.name} (${desk.sessionId}) in ${hint.where}: copied "${hint.text}"`);
    return;
  }
  const steps = [];
  if (desk.workspaceId) steps.push(["herdr", "workspace", "focus", desk.workspaceId]);
  if (desk.tabId) steps.push(["herdr", "tab", "focus", desk.tabId]);
  // An agent pane is focused as the agent; a plain pane has no agent to name.
  if (desk.kind === "agent") steps.push(["herdr", "agent", "focus", desk.paneId]);
  for (const argv of steps) {
    const run = await runQuiet($, argv);
    if (!run || run.exitCode !== 0) {
      const why = run ? String(run.stderr || "").trim().split("\n")[0].slice(0, 100) : "herdr is not available";
      await $.ui.toast(`Could not jump to ${desk.name}${why ? `: ${why}` : "."}`);
      return;
    }
  }
}

// Demo mode on: the loop starts at 0 now, from a clean slate (no pins,
// no remembered seats or finishes), the real ones set aside until it ends.
function startDemo(now) {
  if (!state.demo) state.demo = { saved: { overrides: state.overrides, seatMemory: state.seatMemory, changeMemory: state.changeMemory, unseen: state.unseen } };
  state.demo.start = now;
  state.overrides = {};
  state.seatMemory = {};
  state.changeMemory = {};
  state.unseen = {};
  state.page = 0;
  state.plan = null;
}

function stopDemo() {
  if (!state.demo) return;
  Object.assign(state, state.demo.saved);
  state.demo = null;
  state.page = 0;
  state.plan = null;
}

async function openOffice($, isFull, columns) {
  state.isFull = isFull;
  // A take starts at second 0 each time the office opens.
  if (state.demo) {
    startDemo(await $.clock.now());
    await refresh($).catch(() => {});
  }
  const wide = Math.max(60, (columns || 120) - 30);
  const placed = await $.ui.open(
    isFull
      ? { id: PANE, title: "Office", focus: true, columns: wide, rows: 200 }
      : { id: PANE, title: "Office", focus: true, columns: 66, rows: 28 },
  );
  $.ui.invalidate("ui.render");
  return placed;
}

async function closeOffice($) {
  stopTimers();
  state.view = "office";
  await $.ui.close({ id: PANE });
}

// ---- arranging by drag ----------------------------------------------------------

// Moves the desk at seat `from` to the place of seat `to` (both on the page
// on show): the desks between shift up one, nothing is left empty. The moved
// desk is pinned to that place in the packed order, so it stays there while
// the others reorder by state; nobody else keeps a pin on the same place.
async function moveDesk($, from, to) {
  const a = state.seats[from];
  if (!a || from === to || !state.seats[to]) return;
  const place = state.page * (state.pageSize || state.seats.length) + to + 1;
  const keyA = deskKey(a);
  const next = { ...state.overrides };
  for (const [k, o] of Object.entries(next)) {
    if (k !== keyA && o.seat === place) {
      const { seat, ...rest } = o;
      if (Object.keys(rest).length) next[k] = rest;
      else delete next[k];
    }
  }
  next[keyA] = { ...(next[keyA] ?? {}), seat: place };
  state.overrides = next;
  if (!state.demo) await $.store.set("sessions", next);
  await recompute($, await $.clock.now());
  $.ui.invalidate("ui.render");
}

const cell = (v) => Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && Math.abs(n) < 2000);

// What the drag layer posted: a hover to light up, a drop to act on, a click.
// The drag layer names the seats itself, from the very hits it was drawn
// with; the cells are the fallback.
const seatOf = (plan, seat, at) => (Number.isInteger(seat) && seat >= -1 && seat < state.seats.length ? seat : cell(at) ? seatIn(plan, at[0], at[1]) : -1);

async function onDragMessage($, data) {
  const plan = state.plan;
  if (!plan || !data || typeof data !== "object") return;
  if (data.type === "hover" && cell(data.from) && cell(data.at)) {
    const next = { from: seatOf(plan, data.fromSeat, data.from), over: seatOf(plan, data.atSeat, data.at) };
    if (plan.drag?.from !== next.from || plan.drag?.over !== next.over) {
      plan.drag = next;
      plan.isDirty = true;
      await pushFrame($);
    }
  } else if (data.type === "drop" && cell(data.from) && cell(data.to)) {
    plan.drag = null;
    plan.isDirty = true;
    const from = seatOf(plan, data.fromSeat, data.from);
    const to = seatOf(plan, data.toSeat, data.to);
    if (from >= 0 && to >= 0) await moveDesk($, from, to);
    else $.ui.invalidate("ui.render");
  } else if (data.type === "click" && cell(data.at)) {
    const desk = state.seats[seatOf(plan, data.atSeat, data.at)];
    if (desk) await jumpTo($, desk);
  }
}

async function nextPage($) {
  state.page = (state.page + 1) % Math.max(1, state.pageInfo.pages);
  state.plan = null;
  await recompute($, await $.clock.now());
  $.ui.invalidate("ui.render");
}

// ---- settings -----------------------------------------------------------------

async function setOption($, key) {
  // A frame of the old scene may be in flight: it is dropped, not sent.
  state.plan = null;
  if (key === "render") {
    state.tileSupport = "unknown";
    state.pictureDeny = "";
  }
  state.options = cycleOption(state.options, key);
  state.stored = { ...state.stored, [key]: state.options[key] };
  await $.store.set("options", state.stored);
  await $.store.set("optionsConfig", configSnapshot());
  await recompute($, await $.clock.now());
  state.plan = null;
  if (key === "speed") startTimers($);
  $.ui.invalidate("ui.render");
}

async function setOverride($, key, patch) {
  const next = { ...(state.overrides[key] ?? {}), ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === "") delete next[k];
  state.overrides = { ...state.overrides };
  if (Object.keys(next).length) state.overrides[key] = next;
  else delete state.overrides[key];
  if (!state.demo) await $.store.set("sessions", state.overrides);
  await recompute($, await $.clock.now());
  $.ui.invalidate("ui.render");
}

function settingsView($, e) {
  const { Box, Text, Button, Select, Input } = $.ui.resolve(e);
  const o = state.options;
  const rows = OPTIONS.map((opt) =>
    Box({
      key: `opt-${opt.key}`,
      flexDirection: "row",
      columnGap: 1,
      children: [
        Button({ key: `set-${opt.key}`, label: opt.title, hotkey: opt.hotkey, plain: true, onPress: () => setOption($, opt.key) }),
        Text({ color: "#76ea6a", children: String(o[opt.key]) }),
      ],
    }),
  );
  const desks = state.desks;
  const pickedKey = state.picked && desks.some((d) => deskKey(d) === state.picked) ? state.picked : desks[0] ? deskKey(desks[0]) : null;
  const picked = desks.find((d) => deskKey(d) === pickedKey);
  const own = (pickedKey && state.overrides[pickedKey]) || {};
  const perSession = picked
    ? [
        Text({ bold: true, children: "This session" }),
        Select && Select({
          key: "session",
          label: "Session",
          value: pickedKey,
          options: desks.map((d) => ({ value: deskKey(d), label: `${d.name} (${STATUS_WORD[d.status]})` })),
          onSelect: (value) => {
            state.picked = value;
            $.ui.invalidate("ui.render");
          },
        }),
        Select && Select({
          key: "character",
          label: "Character",
          value: own.character ?? "default",
          options: [{ value: "default", label: `default (${o.characters})` }, ...CHARACTER_KINDS.map((k) => ({ value: k, label: k }))],
          onSelect: (value) => setOverride($, pickedKey, { character: value === "default" ? undefined : value }),
        }),
        Input && Input({
          key: "label",
          label: "Label",
          placeholder: picked.name,
          value: own.label ?? "",
          onSubmit: (value) => setOverride($, pickedKey, { label: value.trim() || undefined }),
        }),
        Input && Input({
          key: "seat",
          label: "Pin to a place in the order, 1 first (empty to unpin)",
          value: own.seat ? String(own.seat) : "",
          onSubmit: (value) => {
            const n = Number.parseInt(value, 10);
            return setOverride($, pickedKey, { seat: Number.isInteger(n) && n > 0 ? n : undefined });
          },
        }),
        Button({ key: "reset-session", label: "Forget this session's settings", hotkey: "z", plain: true, dimColor: true, onPress: () => setOverride($, pickedKey, { label: undefined, character: undefined, seat: undefined }) }),
      ].filter(Boolean)
    : [Text({ dimColor: true, children: "No sessions to set up yet." })];
  return Box({
    flexDirection: "column",
    children: [
      Box({
        flexDirection: "row",
        columnGap: 2,
        children: [
          Text({ bold: true, children: "Office settings" }),
          Button({ key: "back", label: "Back to the office", hotkey: "s", plain: true, onPress: () => showView("office", $) }),
        ],
      }),
      Text({ dimColor: true, children: "Press a key to cycle an option. Saved for every session." }),
      ...rows,
      Text({ children: " " }),
      ...perSession,
    ],
  });
}

function showView(view, $) {
  state.view = view;
  state.plan = null;
  $.ui.invalidate("ui.render");
}

// ---- the office ---------------------------------------------------------------

// The header strip: a coloured count per state, idle shells, the clock in full mode.
function headerStrip(Box, Text, Button, $, columns = 0) {
  const t = tally(state.desks);
  const isNarrow = columns > 0 && columns < 100;
  const parts = STATUSES.filter((s) => t[s] > 0 && s !== "unknown").map((s) =>
    Text({ color: hex(ACCENT[s]), bold: s === "blocked", children: `■ ${t[s] + (s === "idle" ? t.unknown : 0)} ${STATUS_WORD[s]}` }),
  );
  if (t.unknown && !t.idle) parts.push(Text({ color: hex(ACCENT.unknown), children: `■ ${t.unknown} idle` }));
  if (state.idleShells) parts.push(Text({ dimColor: true, children: `${state.idleShells} idle shell${state.idleShells === 1 ? "" : "s"}` }));
  if (!parts.length) parts.push(Text({ dimColor: true, children: "Nobody is in yet." }));
  if (state.isFull && state.minute) parts.push(Text({ bold: true, children: state.minute }));
  if (state.demo) parts.unshift(Text({ bold: true, inverse: true, children: " demo " }));
  if (state.source === "demo") {
    // Said once, at the front.
  } else if (state.source !== "herdr" && state.sourceKind === "claude") {
    parts.push(Text({ dimColor: true, children: `no herdr: Claude Code sessions (${state.desks.length} running)` }));
  } else if (state.source !== "herdr") {
    const live = state.desks.filter((d) => d.source === "registry").length;
    const recent = state.desks.filter((d) => d.source === "transcript").length;
    parts.push(Text({ dimColor: true, children: `no herdr: ${live} live session${live === 1 ? "" : "s"} running this mod, ${recent} recent transcript${recent === 1 ? "" : "s"}` }));
  }
  if (state.pictureNote) parts.push(Text({ color: "#e0a040", children: `pictures off: ${state.pictureNote}` }));
  // More desks than a page: say how many, and page on with m.
  const info = state.pageInfo;
  const pageButton =
    info.pages > 1
      ? [Button({ key: "page", label: `+${info.total - state.seats.filter(Boolean).length} more (page ${info.page + 1}/${info.pages})`, hotkey: "m", plain: true, onPress: () => nextPage($) })]
      : [];
  return Box({
    key: "header",
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 2,
    children: [
      ...parts,
      ...pageButton,
      // The view's own keys: letters, never a desk's.
      // In a sidebar the keys show their values alone, to keep the header short.
      ...Object.entries(VIEW_KEYS).map(([key, option]) =>
        Button({ key: `view-${option}`, label: isNarrow ? String(state.options[option]) : `${option} ${state.options[option]}`, hotkey: key, plain: true, dimColor: true, onPress: () => setOption($, option) }),
      ),
      Button({ key: "full", label: state.isFull ? "Sidebar" : "Full", hotkey: "f", plain: true, dimColor: true, onPress: () => openOffice($, !state.isFull, state.lastColumns) }),
      Button({ key: "settings", label: "Settings", hotkey: "s", plain: true, dimColor: true, onPress: () => showView("settings", $) }),
      Button({ key: "close", label: "Close", hotkey: "x", plain: true, dimColor: true, onPress: () => closeOffice($) }),
    ],
  });
}

/**
 * How many rows the header wraps to in `columns`, from its items' widths
 * and the 2-column gap. A plain Button reads `k: label`. Wide glyphs (the
 * state squares) count as two, so the guess errs tall, never short.
 */
function headerRowsFor(widths, columns) {
  if (!columns) return 2;
  let rows = 1;
  let used = 0;
  for (const w of widths) {
    const need = used ? used + 2 + w : w;
    if (need > columns && used) {
      rows++;
      used = Math.min(w, columns);
    } else used = need;
  }
  return rows;
}

function textWidth(text) {
  let n = 0;
  for (const ch of String(text)) {
    const c = ch.codePointAt(0) ?? 0;
    n += (c >= 0x2580 && c <= 0x25ff) || c >= 0x2e80 ? 2 : 1;
  }
  return n;
}

// The widths of a header tree's items, for headerRowsFor. An element keeps
// its children beside its props (a Text's strings, a Box's elements).
function headerWidths(header) {
  const textOf = (el) => {
    if (typeof el === "string" || typeof el === "number") return String(el);
    const kids = el?.children ?? el?.props?.children ?? [];
    return Array.isArray(kids) ? kids.map(textOf).join("") : String(kids);
  };
  return (header?.children ?? header?.props?.children ?? []).map((el) => {
    const p = el?.props ?? {};
    if (typeof p.label === "string") return textWidth(p.hotkey ? `${p.hotkey}: ${p.label}` : p.label);
    return textWidth(textOf(el));
  });
}

export function register(on, options) {
  state.userConfig = options ?? {};
  state.options = resolveOptions(state.userConfig, state.stored);

  on("session.start", async ($, e, next) => {
    const r = await next(e);
    await $.command.register({
      name: "office",
      description: "Open a pixel-art office of every busy herdr pane (\"full\" for the big view, \"settings\", \"demo\" for a scripted loop, \"close\")",
      argumentHint: "[full|settings|demo|close]",
    });
    // Into the sessions registry, so offices outside herdr see this session.
    try {
      const root = await registryRoot($);
      if (root) {
        state.reg = { root, id: await $.session.id(), cwd: await $.session.cwd(), state: "idle", helpers: 0 };
        await writeEntry($);
        state.heartbeat?.cancel();
        state.heartbeat = $.clock.every(HEARTBEAT_MS, () => {
          $.agent
            .list()
            .then((agents) => {
              if (state.reg) state.reg.helpers = agents.length;
            })
            .catch(() => {})
            .finally(() => writeEntry($).catch(() => {}));
        });
      }
    } catch {
      state.reg = null;
    }
    return r;
  });

  // The registry follows this session's own state. Every hook here passes its
  // event straight on, and none waits on a write.
  on("turn.start", ($, e, next) => {
    if (!e.agentId) setRegState($, "working");
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    const r = await next(e);
    if (!e.agentId) setRegState($, "done");
    return r;
  });

  on("tool.call", async ($, e, next) => {
    if (e.agentId || !state.reg) return next(e);
    const asks = e.tool === "AskUserQuestion";
    setRegState($, asks ? "needs-you" : "working", activityOfTool(e.tool));
    const r = await next(e);
    if (asks) setRegState($, "working");
    return r;
  });

  // Thinking or writing, from the model's own stream; every chunk passed on as it came.
  on("turn.step", async function* ($, e, next) {
    const stream = next(e);
    if (e.agentId || !state.reg) return yield* stream;
    let step = await stream.next();
    while (!step.done) {
      const kind = step.value?.kind;
      if (kind === "thinking") setRegState($, "working", "thinking");
      else if (kind === "text") setRegState($, "working", "writing");
      yield step.value;
      step = await stream.next();
    }
    return step.value;
  });

  on("classic.Notification", ($, e, next) => {
    if (e.notification_type === "permission_prompt") setRegState($, "needs-you");
    return next(e);
  });

  on("command.run", { command: "office" }, async ($, e) => {
    const arg = String(e.args ?? "").trim().toLowerCase();
    if (arg === "close") {
      await closeOffice($);
      return { text: "Office closed." };
    }
    if (arg === "demo") {
      await load($);
      state.isDemoEnvRead = true;
      if (state.demo) stopDemo();
      else startDemo(await $.clock.now());
      state.hasData = false;
      state.lastColumns = e.presentation?.columns ?? 0;
      state.view = "office";
      // Opening restarts the loop at 0; closing demo mode goes back to herdr.
      if (state.demo) await openOffice($, state.isFull, e.presentation?.columns);
      else {
        await refresh($).catch(() => {});
        $.ui.invalidate("ui.render");
      }
      return { text: state.demo ? "Office demo mode on: a scripted 60-second loop, starting now." : "Office demo mode off." };
    }
    state.lastColumns = e.presentation?.columns ?? 0;
    state.view = arg === "settings" ? "settings" : "office";
    const placed = await openOffice($, arg === "full", e.presentation?.columns);
    if (placed?.isPlaced === false) return { text: "The office pane is waiting for room on screen." };
    if (arg === "settings") return { text: "Office settings opened." };
    return { text: arg === "full" ? "Office opened full size. Press a desk's key to jump to it." : "Office opened. Press a desk's key to jump to it." };
  });

  on("ui.message", async ($, e, next) => {
    if (e.requestId !== PANE || e.element !== "drag") return next(e);
    await onDragMessage($, e.data);
    return {};
  });

  // The person's close only: the office's own $.ui.close stops the timers
  // itself, so this hook is never raised from inside its own close.
  on("ui.close", { id: PANE, origin: { kind: "person" } }, ($, e, next) => {
    stopTimers();
    return next(e);
  });

  on("session.end", ($, e, next) => {
    stopTimers();
    state.heartbeat?.cancel();
    state.heartbeat = null;
    // Leave the registry: an entry last heard from at 0 is never live.
    if (state.reg?.root) {
      state.reg.state = "done";
      writeEntry($, true);
      state.reg = null;
    }
    return next(e);
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    try {
      return await drawPane($, e);
    } catch (err) {
      // A drawing that fails must not take the session with it: say so in one line.
      state.plan = null;
      const { Text } = $.ui.resolve(e);
      return Text({ color: "#e0a040", wrap: "truncate-end", children: `The office could not draw: ${String(err?.message ?? err).slice(0, 120)}` });
    }
  });
}

// The most desks (at most `want`, and at most the desks there are) whose
// plan fits `rows` without scrolling; 0 when every desk of the page fits.
// The order is the plan's: bigger desks for fewer of them.
function fitCount(layout, columns, rows, opts, want) {
  const total = Math.min(want, state.ordered.length);
  if (total <= 1) return 0;
  const fits = (n) => planScene(layout, state.ordered.slice(0, n), columns, rows, opts).rows <= rows;
  if (fits(total)) return 0;
  let lo = 1;
  let hi = total - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

async function drawPane($, e) {
  const { Box, Text, Button } = $.ui.resolve(e);
  await load($);
  if (!state.hasData) await refresh($);
  startTimers($);
  if (e.viewport?.columns) state.lastColumns = e.viewport.columns;

  if (state.view === "settings") {
    state.plan = null;
    return settingsView($, e);
  }

  if (state.error) {
    state.plan = null;
    return Box({
      flexDirection: "column",
      children: [
        Text({ color: "#e0a040", wrap: "truncate-end", children: state.error }),
        Box({ children: [Button({ key: "close", label: "Close", hotkey: "x", plain: true, dimColor: true, onPress: () => closeOffice($) })] }),
      ],
    });
  }

  const columns = e.props?.bodyColumns ?? 60;
  let seats = state.seats;
  let header = headerStrip(Box, Text, Button, $, columns);
  if (!seats.some(Boolean)) {
    state.plan = null;
    const none = state.source === "herdr" ? "No agent or busy terminal panes in herdr." : "No sessions found: none running this mod, and no transcript written in the last half hour.";
    return Box({ flexDirection: "column", children: [header, Text({ dimColor: true, children: none })] });
  }

  if (e.surface !== "terminal") {
    // No Raster off the terminal: one row per desk, each a button.
    state.plan = null;
    return Box({
      flexDirection: "column",
      children: [
        header,
        ...seats.flatMap((desk, i) =>
          desk
            ? [
                Button({
                  key: `desk-${i + 1}`,
                  label: `${desk.name}  ${bubbleFor(desk)?.text ?? STATUS_WORD[desk.status]}${desk.kind === "process" ? `  ${desk.detail}` : ""}${desk.helpers ? `  ${desk.helpers} helpers` : ""}${desk.isSelf ? "  (this session)" : ""}`,
                  hotkey: HOTKEYS[i],
                  plain: true,
                  dimColor: desk.status === "done",
                  onPress: () => jumpTo($, desk),
                }),
              ]
            : [],
        ),
      ],
    });
  }

  const { Raster, Image } = $.ui.resolve(e);
  const o = state.options;
  const sceneOpts = {
    isFull: state.isFull,
    lighting: o.lighting,
    palette: o.palette,
    characters: o.characters,
    style: o.style,
    reducedMotion: o.reducedMotion,
    zoneBy: o.seating === "workspace" ? "workspaceId" : o.seating === "project" ? "project" : undefined,
  };
  const isRoom = o.layout === "office" || o.layout === "war-room";
  const now = await $.clock.now();
  // Tiles: each card's character as its own small picture, where pictures draw.
  const tilesOk = o.layout === "tiles" && state.tileSupport !== "no" && (await ensureAtlas($));
  // Hybrid: the cell room with each person a small real picture over it.
  const wantsPictures = isRoom && o.render !== "cells";
  const hybridOk = wantsPictures && state.tileSupport !== "no" && (await ensureAtlas($));
  const planOpts = { ...sceneOpts, hybrid: Boolean(hybridOk), portraits: o.layout === "tiles" && !tilesOk ? false : undefined };

  // The floor gets the rows the header leaves, and never more desks than fit
  // them: past that the pane would scroll, and the rest are a page away (m).
  let bodyRows = Math.max(6, (e.props?.scroll?.bodyRows ?? 30) - headerRowsFor(headerWidths(header), columns));
  // A room too short for even one desk: the grid, which fits anywhere.
  const tooShort = isRoom && state.ordered.length > 0 && planScene(o.layout, state.ordered.slice(0, 1), columns, bodyRows, planOpts).rows > bodyRows;
  const layout = tooShort ? "grid" : o.layout;
  const fit = fitCount(layout, columns, bodyRows, planOpts, Number(o.desks) || Infinity);
  if (fit !== state.fitCap) {
    state.fitCap = fit;
    await recompute($, now);
    seats = state.seats;
    header = headerStrip(Box, Text, Button, $, columns);
    bodyRows = Math.max(6, (e.props?.scroll?.bodyRows ?? 30) - headerRowsFor(headerWidths(header), columns));
  }
  const plan = planScene(layout, seats, columns, bodyRows, planOpts);
  // Pictures asked for but not drawn: say why, in the header.
  const note = !wantsPictures ? "" : state.tileSupport === "no" ? `this terminal draws no images${state.pictureDeny ? ` (${state.pictureDeny})` : ""}` : !hybridOk ? "the character art did not load" : !plan.isHybrid && plan.layout !== o.layout ? "the pane is too small for the room" : !plan.isHybrid ? "desks too small here" : "";
  if (note !== state.pictureNote) {
    state.pictureNote = note;
    header = headerStrip(Box, Text, Button, $, columns);
  }
  state.plan = plan;
  startTimers($);
  const portraits = [];
  if (plan.portraits?.length) {
    const bg = plan.isHybrid ? paintRoomCanvas(plan, state.tick, now) : null;
    for (const p of plan.portraits) {
      const desk = plan.isHybrid ? plan.desks[p.index].seat : plan.seats[p.index];
      const source = portraitSource(desk, p, now, true, bg);
      portraits.push(
        Box({
          key: `portrait-box-${p.index + 1}`,
          position: "absolute",
          top: p.top,
          left: p.left,
          children: [Image({ key: `portrait-${p.index + 1}`, source, columns: p.columns, rows: p.rows, alt: " " })],
        }),
      );
    }
    startPortraits($);
    if (state.tileSupport === "unknown") $.clock.after(PROBE_MS, () => probeTiles($).catch(() => {}));
  }

  // Each name tag is a button laid over the tag the Raster paints, so its
  // hotkey and a click both jump to the desk.
  const tags = plan.tags.map((tag) => {
    const desk = seats[tag.index];
    return Box({
      key: `tag-${tag.index + 1}`,
      position: "absolute",
      top: tag.top,
      left: tag.left,
      width: tag.width,
      height: 1,
      children: [
        Button({
          key: `desk-${tag.index + 1}`,
          label: tag.hotkey ? tag.label : tag.first,
          ...(tag.hotkey ? { hotkey: tag.hotkey } : {}),
          plain: true,
          dimColor: desk.status === "done",
          onPress: () => jumpTo($, desk),
        }),
      ],
    });
  });

  // The drag layer over the picture: press a desk, drag it to another seat.
  const { Client } = $.ui.resolve(e);
  const hits = hitRects(plan).map((h) => [h.left, h.top, h.width, h.height, seats[h.index]?.name ?? "empty desk", h.index]);
  const dragLayer = Box({
    key: "drag-layer",
    position: "absolute",
    top: 0,
    left: 0,
    children: [Client({ key: "drag", module: "./office-drag.mjs", props: { hits }, width: plan.columns, height: plan.rows })],
  });

  return Box({
    flexDirection: "column",
    children: [
      header,
      Box({
        key: "floor",
        width: plan.columns,
        height: plan.rows,
        children: [
          Raster({ key: RASTER, columns: plan.columns, rows: plan.rows, cells: toBase64(new Uint8Array(paintPlan(plan, state.tick, now).buffer)) }),
          ...portraits,
          ...tags,
          dragLayer,
        ],
      }),
    ],
  });
}
