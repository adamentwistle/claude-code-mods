// Office: sessions without herdr. Every session running this mod keeps a
// small file in a shared registry folder (its id, cwd, project, state,
// helpers, last heartbeat); recently written transcripts fill in sessions
// that do not run the mod. Pure: the pane and bin/office-monitor both use it.
//
// A file per session, not $.store: the store is one JSON file per plugin,
// and sessions writing their own keys into it at once would overwrite each
// other's copies.

export const REGISTRY_TTL_MS = 2 * 60000;
export const HEARTBEAT_MS = 30000;
export const RECENT_MS = 30 * 60000;
const IDLE_MS = 5 * 60000;

// The registry's states, as the office's statuses.
const STATUS_OF = { working: "working", idle: "idle", "needs-you": "blocked", done: "done" };

/** Where the registry lives under a Claude config folder. */
export function registryDir(root) {
  return `${String(root).replace(/\/+$/, "")}/plugins/data/office-registry`;
}

/** A project's name from Claude Code's folder for it (`-Users-me-Projects-qube` is qube). */
export function projectFromDir(dir) {
  const parts = String(dir ?? "").split("-").filter(Boolean);
  return parts[parts.length - 1] ?? String(dir ?? "");
}

function baseName(path) {
  return String(path ?? "").split("/").filter(Boolean).pop() ?? "";
}

/** One registry entry, the session's own word, as a file's text. */
export function registryEntry({ id, cwd, state, helpers = 0, activity = null, now }) {
  return { id, cwd, project: baseName(cwd), state, helpers, activity, lastSeen: now };
}

/**
 * Parses registry files (text) into live entries: well formed, heard from in
 * the last two minutes, not ended.
 */
export function liveEntries(texts, now) {
  const out = new Map();
  for (const text of texts) {
    let e;
    try {
      e = JSON.parse(text);
    } catch {
      continue;
    }
    if (!e || typeof e.id !== "string" || !STATUS_OF[e.state]) continue;
    if (!(now - Number(e.lastSeen || 0) < REGISTRY_TTL_MS)) continue;
    const was = out.get(e.id);
    if (!was || was.lastSeen < e.lastSeen) out.set(e.id, e);
  }
  return [...out.values()];
}

/**
 * The panes the office draws when herdr is not there: the registry's live
 * sessions, then recent transcripts of sessions not in it (idle when written
 * in the last five minutes, done before that). `recent` holds
 * `{ id, dir, mtimeMs }` per transcript.
 */
export function sessionPanes(entries, recent, now, selfId) {
  const panes = [];
  const helpers = {};
  const seen = new Set();
  for (const e of entries) {
    seen.add(e.id);
    helpers[e.id] = Math.max(0, Number(e.helpers) || 0);
    panes.push({
      paneId: `session:${e.id}`,
      tabId: "",
      workspaceId: "",
      agent: "claude",
      status: STATUS_OF[e.state],
      name: e.project || baseName(e.cwd) || e.id.slice(0, 8),
      cwd: e.cwd ?? "",
      sessionId: e.id,
      isSelf: e.id === selfId,
      isFocused: false,
      order: panes.length,
      source: "registry",
      activity: e.activity ?? null,
      terminalTitle: "",
    });
  }
  for (const r of [...recent].sort((a, b) => b.mtimeMs - a.mtimeMs)) {
    if (seen.has(r.id) || now - r.mtimeMs > RECENT_MS) continue;
    seen.add(r.id);
    panes.push({
      paneId: `session:${r.id}`,
      tabId: "",
      workspaceId: "",
      agent: "claude",
      status: now - r.mtimeMs < IDLE_MS ? "idle" : "done",
      name: projectFromDir(r.dir),
      cwd: "",
      sessionId: r.id,
      isSelf: r.id === selfId,
      isFocused: false,
      order: panes.length,
      source: "transcript",
      projectDir: r.dir,
      terminalTitle: "",
    });
  }
  return { panes, helpers };
}

/** The transcripts in a project folder's listing written in the last half hour. */
export function recentTranscripts(dir, entries, now) {
  return (entries ?? [])
    .filter((e) => e && e.kind === "file" && /^[0-9a-f-]{20,}\.jsonl$/i.test(String(e.name)) && now - Number(e.mtimeMs || 0) < RECENT_MS)
    .map((e) => ({ id: String(e.name).replace(/\.jsonl$/, ""), dir, mtimeMs: Number(e.mtimeMs) }));
}

/** What to say about a session outside herdr, and the command that resumes it. */
export function resumeHint(desk) {
  const where = desk.cwd || (desk.projectDir ? `project ${projectFromDir(desk.projectDir)}` : "an unknown folder");
  return { text: `claude --resume ${desk.sessionId}`, where };
}

// ---- Claude Code's own registry of running sessions ------------------------------
// `<config>/sessions/<pid>.json`, one per running session. Only the .json
// files are read: the .key files beside them are secrets, never opened.

/** Whether a file in a sessions folder may be read: a .json record, nothing else. */
export function isSessionRecord(name) {
  return /^[0-9]+\.json$/.test(String(name));
}

/** The pids to ask `ps` about, from the records. */
export function recordPids(records) {
  return [...new Set(records.map((r) => Number(r?.pid)).filter((n) => Number.isInteger(n) && n > 0))];
}

/** Which of the asked pids `ps -o pid= -p a,b,c` says are running. */
export function alivePids(stdout) {
  return new Set(String(stdout ?? "").split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger));
}

// Claude Code's statuses, as the office's: busy is working; anything waiting
// on the person (permission, input, a question) needs you.
export function statusOfRecord(status) {
  const s = String(status ?? "").toLowerCase();
  if (s === "busy" || s === "working" || s === "running") return "working";
  if (/wait|permission|input|ask|block|approv/.test(s)) return "blocked";
  return "idle";
}

/**
 * The panes the office draws from Claude Code's session records: live when
 * the pid runs or the record was updated in the last two minutes. A session
 * that also runs this mod adds its richer state and activity from `entries`.
 */
export function claudeSessionPanes(records, alive, now, selfId, entries = []) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const panes = [];
  const helpers = {};
  const seen = new Set();
  for (const r of records) {
    if (!r || typeof r.sessionId !== "string" || seen.has(r.sessionId)) continue;
    const isLive = alive.has(Number(r.pid)) || now - Number(r.updatedAt || 0) < REGISTRY_TTL_MS;
    if (!isLive) continue;
    seen.add(r.sessionId);
    const own = byId.get(r.sessionId);
    helpers[r.sessionId] = Math.max(0, Number(own?.helpers) || 0);
    const named = r.nameSource && r.nameSource !== "derived" && typeof r.name === "string" ? r.name : "";
    panes.push({
      paneId: `session:${r.sessionId}`,
      tabId: "",
      workspaceId: "",
      agent: "claude",
      status: own ? STATUS_OF[own.state] ?? statusOfRecord(r.status) : statusOfRecord(r.status),
      name: named || baseName(r.cwd) || r.sessionId.slice(0, 8),
      cwd: typeof r.cwd === "string" ? r.cwd : "",
      sessionId: r.sessionId,
      isSelf: r.sessionId === selfId,
      isFocused: false,
      order: panes.length,
      source: "claude",
      activity: own?.activity ?? null,
      terminalTitle: "",
    });
  }
  return { panes, helpers };
}
