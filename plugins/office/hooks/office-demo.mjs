// Office: demo mode. A scripted minute of eight sessions, in place of herdr
// and the session records, for a screen recording: every state, bubble and
// helper shows within one 60-second loop, the same on every take.
//
// Each session's script is a list of steps [fromSecond, status, activity,
// helpers]; a step lasts until the next one. `seen` is the second the person
// "looks at" a finished session, which ends its celebration.

export const DEMO_LOOP_MS = 60_000;

const SCRIPT = [
  { name: "api-refactor", isSelf: true, steps: [[0, "working", "coding"], [8, "working", "reading"], [14, "working", "thinking"], [20, "working", "coding"], [30, "working", "writing"], [38, "working", "coding"]] },
  { name: "docs-site", steps: [[0, "working", "writing"], [12, "working", "searching"], [18, "working", "writing"], [44, "working", "reading"], [52, "working", "writing"]] },
  { name: "bug-triage", steps: [[0, "working", "searching"], [10, "working", "reading"], [15, "blocked", null], [27, "working", "thinking"], [35, "working", "coding"]] },
  { name: "release-notes", seen: 40, steps: [[0, "working", "writing"], [30, "done", null]] },
  { name: "test-suite", steps: [[0, "working", "thinking"], [6, "working", "coding"], [20, "working", "reading"], [26, "working", "coding"], [44, "working", "thinking"], [50, "working", "coding"]] },
  { name: "db-migration", steps: [[0, "idle", null], [20, "working", "thinking"], [28, "working", "coding"], [46, "idle", null]] },
  { name: "security-review", steps: [[0, "working", "delegating", 3], [30, "working", "delegating", 2], [45, "working", "writing", 0]] },
  { name: "onboarding", steps: [[0, "idle", null]] },
];

// Under `characters: mixed`, one of each kind, so the cast shows the range.
const MIXED = ["human", "robot", "critter", "cat", "human", "dog", "owl", "robot"];

/** The demo's names, in script order. */
export const DEMO_NAMES = SCRIPT.map((s) => s.name);

/**
 * The demo sessions at `elapsedMs` since demo mode turned on, as panes in
 * the shape herdr's give (plus `activity`), and the helper counts by session.
 * The loop repeats every 60 s. With `characters` "mixed" each gets a kind of
 * its own; any other value is left to the option, as for real sessions.
 */
export function demoPanes(elapsedMs, characters = "") {
  const t = ((Math.max(0, elapsedMs) % DEMO_LOOP_MS) + DEMO_LOOP_MS) % DEMO_LOOP_MS / 1000;
  const helpers = {};
  const panes = SCRIPT.map((s, i) => {
    let step = s.steps[0];
    for (const st of s.steps) if (st[0] <= t) step = st;
    const [, status, activity, n = 0] = step;
    const sessionId = `demo-${i + 1}-${s.name}`;
    if (n) helpers[sessionId] = n;
    return {
      paneId: `demo:p${i + 1}`,
      tabId: `demo:t${i + 1}`,
      workspaceId: "demo",
      agent: "claude",
      status,
      name: s.name,
      cwd: `/demo/${s.name}`,
      sessionId,
      isSelf: Boolean(s.isSelf),
      // Looked at: a finished session's celebration ends.
      isFocused: s.seen !== undefined && t >= s.seen,
      order: i,
      activity: status === "working" ? activity : null,
      ...(characters === "mixed" ? { character: MIXED[i] } : {}),
    };
  });
  return { panes, helpers, second: Math.floor(t) };
}
