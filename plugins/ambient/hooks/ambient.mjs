// Ambient: an animated strip above the prompt that moves with the work.
//
// turn.step: counts the streamed pieces (re-yielding each one untouched).
// tool.call: marks a tool running, and a failed or denied call.
// turn.complete: the turn settles; session.measure: the context fill.
// ui.render (AbovePrompt): the strip is one Raster, the last rows of the band,
// below whatever sibling mods draw there. $.ui.blit repaints it at about 14 fps
// while something is happening; once it settles the timer stops.
// /ambient picks a style, lists them, previews them all, or turns the strip off.
//
// scene.mjs holds the simulation and the drawing. The host reads on(...) and
// $.noun.method(...) from source, so they are spelled literally, and helpers
// that take $ are top-level functions.

import {
  FALLBACK,
  INTENSITY,
  PALETTES,
  STYLES,
  STYLE_INFO,
  chunkSeen,
  createScene,
  drawFrame,
  horizonSeen,
  isSettled,
  packCells,
  rowsFor,
  stepBegan,
  stepEnded,
  still,
  tick,
  toolBegan,
  toolEnded,
  turnCompleted,
} from "./scene.mjs";

const STRIP_KEY = "ambient";
const FRAME_MS = 70;

let enabled = true;
let style = "network";
let rowsWanted = 3;
let paletteChoice = "auto";
let paletteName = FALLBACK;
let intensityName = "bright";
let look = { palette: PALETTES[FALLBACK], intensity: INTENSITY.bright };

// Where the strip is mounted, as the last render drew it: { requestId, columns, rows }.
let mounted = null;
let timer = null;
const scene = createScene();

// A running /ambient preview: which style, how far into its demo, what to go back to.
const PREVIEW_SECONDS = 4.5;
const PREVIEW_ONE_SECONDS = 6.5;
let preview = null;

export function register(on, options) {
  rowsWanted = Math.max(1, Math.min(6, Number(options?.rows ?? 3) || 3));
  paletteChoice = String(options?.palette ?? "auto");
  style = STYLES.includes(String(options?.style)) ? String(options.style) : "network";
  intensityName = INTENSITY[String(options?.intensity)] ? String(options.intensity) : "bright";
  paletteName = PALETTES[paletteChoice] ? paletteChoice : FALLBACK;
  look = { palette: PALETTES[paletteName], intensity: INTENSITY[intensityName] };

  on("session.start", async ($, e, next) => {
    try {
      await $.command.register({ name: "ambient", description: "Pick the ambient strip's style, preview styles live, or turn it off", argumentHint: "[<style> | styles | preview [<style>] | on | off]", immediate: true });
    } catch {
      // the command is optional; the strip still works
    }
    try {
      const saved = await $.store.get("enabled");
      if (typeof saved === "boolean") enabled = saved;
      const savedStyle = await $.store.get("style");
      if (STYLES.includes(savedStyle)) style = savedStyle;
    } catch {
      // nothing stored yet
    }
    if (paletteChoice === "auto") {
      paletteName = await themePalette($);
      look = { ...look, palette: PALETTES[paletteName] };
    }
    return next(e);
  });

  on("command.run", { command: "ambient" }, async ($, e) => {
    const arg = String(e.args ?? "").trim().toLowerCase();
    const [word, rest = ""] = arg.split(/\s+/, 2);
    if (word === "styles" || word === "list") {
      return { text: stylesText() };
    }
    if (word === "preview") {
      if (rest && !STYLES.includes(rest)) {
        return { text: `Unknown style "${rest}".\n\n${stylesText()}` };
      }
      endPreview($, false);
      enabled = true;
      const order = rest ? [rest] : [...STYLES];
      // One style gets time to settle after its demo turn; a tour keeps moving.
      preview = { order, i: 0, t: 0, seconds: rest ? PREVIEW_ONE_SECONDS : PREVIEW_SECONDS, restore: style, step: null, tool: null };
      style = order[0];
      previewStatus($);
      $.ui.invalidate("ui.render");
      ensureTimer($);
      return {
        text: rest
          ? `Previewing ${rest} through a demo turn: thinking, writing, a tool, a failed tool, done, then settling. Your style comes back after.`
          : `Previewing all ${STYLES.length} styles, ${PREVIEW_SECONDS} seconds each, with a short demo turn. /ambient <style> keeps the one you like.`,
      };
    }
    endPreview($, false);
    if (arg === "off") {
      enabled = false;
    } else if (arg === "on") {
      enabled = true;
    } else if (STYLES.includes(arg)) {
      style = arg;
      enabled = true;
    } else if (arg === "") {
      // Cycle to the next style.
      style = enabled ? STYLES[(STYLES.indexOf(style) + 1) % STYLES.length] : style;
      enabled = true;
    } else {
      return { text: `Unknown style "${arg}".\n\n${stylesText()}` };
    }
    try {
      await $.store.set("enabled", enabled);
      await $.store.set("style", style);
    } catch {
      // stays set for this session even if the store refuses
    }
    if (!enabled) {
      stopTimer();
      still(scene);
    }
    $.ui.invalidate("ui.render");
    return { text: enabled ? `Ambient strip: ${style}, ${STYLE_INFO[style]}.` : "Ambient strip off" };
  });

  on("turn.step", async function* ($, e, next) {
    if (!enabled) {
      return yield* next(e);
    }
    let token;
    try {
      token = stepBegan(scene, { sub: Boolean(e.agentId), model: e.model, effort: e.effort });
      ensureTimer($);
    } catch {
      return yield* next(e);
    }
    const stream = next(e);
    let done = false;
    let observing = true;
    try {
      let sent;
      while (true) {
        const step = await stream.next(sent);
        if (step.done) {
          done = true;
          return step.value;
        }
        if (observing) {
          try {
            const c = step.value;
            chunkSeen(scene, token, c.kind, typeof c.text === "string" ? c.text.length : 0);
          } catch {
            observing = false; // stop watching, keep passing everything through
          }
        }
        sent = yield step.value;
      }
    } finally {
      stepEnded(scene, token);
      if (!done) {
        try {
          await stream.return?.(undefined);
        } catch {
          // the stream beneath is already closed
        }
      }
    }
  });

  on("tool.call", async ($, e, next) => {
    if (!enabled) {
      return next(e);
    }
    let token = null;
    try {
      token = toolBegan(scene, { sub: Boolean(e.agentId) });
      ensureTimer($);
    } catch {
      token = null;
    }
    let result;
    try {
      result = await next(e);
      return result;
    } finally {
      try {
        const failed = result === undefined || result === null || typeof result.deny === "string" || result.isError === true;
        if (token) toolEnded(scene, token, failed);
      } catch {
        // observe only
      }
    }
  });

  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    try {
      if (!e.agentId && enabled) {
        turnCompleted(scene);
        ensureTimer($);
      }
    } catch {
      // observe only
    }
    return result;
  });

  on("session.measure", async ($, e, next) => {
    const result = await next(e);
    try {
      const c = e.context;
      const fill = typeof c?.percent === "number" ? c.percent / 100 : c?.tokens && c?.window ? c.tokens / c.window : null;
      if (fill !== null) {
        horizonSeen(scene, fill);
        if (enabled && timer === null) paint($);
      }
    } catch {
      // observe only
    }
    return result;
  });

  on("session.end", async ($, e, next) => {
    preview = null;
    stopTimer();
    still(scene);
    return next(e);
  });

  // The styles list in the transcript, drawn as a list rather than as Markdown.
  on("ui.render", { component: "CommandOutput", props: { command: "ambient" } }, async ($, e, next) => {
    if (e.props.isErrored || !String(e.props.text ?? "").includes(STYLES_TITLE)) {
      return next(e);
    }
    return stylesTree($, e);
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (!enabled || e.surface !== "terminal" || e.props.hasSurvey) {
      mounted = null;
      return next(e);
    }
    const theirs = await next(e);
    const { Box, Raster } = $.ui.resolve(e);
    const columns = Math.max(1, Math.min(512, Math.floor(e.props.bodyColumns || 80)));
    const rows = rowsFor(style, rowsWanted);
    mounted = { requestId: e.requestId, columns, rows };
    const strip = Raster({ key: STRIP_KEY, columns, rows, cells: packCells(drawFrame(scene, style, columns, rows, look)) });
    return Box({ flexDirection: "column", children: [theirs, strip] });
  });
}

function ensureTimer($) {
  if (timer !== null) {
    return;
  }
  timer = $.clock.every(FRAME_MS, () => {
    try {
      if (preview !== null) {
        previewTick($, FRAME_MS / 1000);
      }
      tick(scene, FRAME_MS / 1000, style);
      if (preview === null && isSettled(scene)) {
        stopTimer();
        still(scene);
      }
      paint($);
    } catch {
      stopTimer();
    }
  });
}

// What /ambient styles prints: Markdown tables, which the transcript and a headless
// run both show cleanly. In the terminal and desktop the CommandOutput hook below
// draws the same content as a laid-out list instead.
const STYLES_TITLE = "**Ambient styles**";
const COMMANDS = [
  ["/ambient <style>", "switch to a style, saved for new sessions"],
  ["/ambient preview", "show every style for a few seconds"],
  ["/ambient preview <style>", "play one style through a demo turn"],
  ["/ambient", "next style"],
  ["/ambient off, /ambient on", "hide or show the strip"],
];

function settingsLine() {
  const palette = paletteChoice === "auto" ? `auto (${paletteName})` : paletteName;
  return `Height ${rowsWanted} row${rowsWanted === 1 ? "" : "s"}, intensity ${intensityName}, palette ${palette}${enabled ? "" : ", strip off"}`;
}

function stylesText() {
  return [
    STYLES_TITLE,
    "",
    "| Style | What it shows |",
    "| --- | --- |",
    ...STYLES.map((s) => `| ${s === style ? `**${s}** (current)` : s} | ${STYLE_INFO[s]} |`),
    "",
    "| Command | Does |",
    "| --- | --- |",
    ...COMMANDS.map(([c, d]) => `| \`${c}\` | ${d} |`),
    "",
    `Settings: ${settingsLine()}`,
  ].join("\n");
}

// Two colours that stand for each style in the list's swatch.
const SWATCH = {
  network: ["#76ea6a", "#a17af2"],
  critter: ["#d77757", "#eba487"],
  aurora: ["#a6e3a1", "#cba6f7"],
  synthwave: ["#ff3d9a", "#2de2e6"],
  warp: ["#8bbcff", "#e8e6ef"],
  murmuration: ["#ff8a5c", "#4a2a6e"],
  lava: ["#fab387", "#f38ba8"],
  wave: ["#89dceb", "#a6e3a1"],
};

// The styles list as a tree, read back from the row's own text so an old row
// keeps showing what was current when it was printed.
function stylesTree($, e) {
  const { Box, Text } = $.ui.resolve(e);
  const text = e.props.text;
  const notice = text.slice(0, text.indexOf(STYLES_TITLE)).trim();
  const current = /\*\*([a-z]+)\*\* \(current\)/.exec(text)?.[1];
  const settings = /^Settings: (.*)$/m.exec(text)?.[1];
  const nameWidth = Math.max(...STYLES.map((s) => s.length)) + 2;
  const commandWidth = Math.max(...COMMANDS.map(([c]) => c.length)) + 2;
  const rows = STYLES.map((s) => {
    const [a, b] = SWATCH[s] ?? ["#888888", "#888888"];
    return Box({
      flexDirection: "row",
      children: [
        Text(s === current ? { color: "#76ea6a", children: ["● "] } : { children: ["  "] }),
        Text({ color: a, children: ["▆"] }),
        Text({ color: b, children: ["▆ "] }),
        Box({ width: nameWidth, flexShrink: 0, children: [Text({ bold: true, children: [s] })] }),
        Text({ dimColor: true, wrap: "truncate-end", children: [STYLE_INFO[s] + (s === current ? "  (current)" : "")] }),
      ],
    });
  });
  const commands = COMMANDS.map(([c, d]) =>
    Box({
      flexDirection: "row",
      children: [
        Box({ width: commandWidth + 2, flexShrink: 0, children: [Text({ dimColor: true, children: ["  " + c] })] }),
        Text({ dimColor: true, children: [d] }),
      ],
    }),
  );
  return Box({
    flexDirection: "column",
    children: [
      ...(notice ? [Text({ color: "#ff7b75", children: [notice] }), Text({ children: [" "] })] : []),
      Text({ bold: true, children: ["Ambient styles"] }),
      ...rows,
      Text({ children: [" "] }),
      ...commands,
      ...(settings ? [Text({ children: [" "] }), Text({ dimColor: true, children: [settings] })] : []),
    ],
  });
}

// The preview's demo turn for each style: think, write, run a tool, fail one, finish.
function previewTick($, dt) {
  const p = preview;
  const before = p.t;
  p.t += dt;
  const at = (mark) => before < mark && p.t >= mark;
  if (at(0.05)) p.step = stepBegan(scene, { sub: false, model: "", effort: "high" });
  if (p.step && p.t < 1.2) chunkSeen(scene, p.step, "thinking", 30);
  else if (p.step && p.t < 2.4) chunkSeen(scene, p.step, "text", 50);
  if (at(2.4)) {
    if (p.step) stepEnded(scene, p.step);
    p.step = null;
    p.tool = toolBegan(scene, { sub: false });
  }
  if (at(2.9)) {
    toolEnded(scene, p.tool, false);
    p.tool = toolBegan(scene, { sub: false });
  }
  if (at(3.25)) {
    toolEnded(scene, p.tool, true);
    p.tool = null;
  }
  if (at(3.5)) turnCompleted(scene);
  if (p.t >= p.seconds) {
    p.i += 1;
    p.t = 0;
    if (p.i >= p.order.length) {
      endPreview($, true);
      return;
    }
    style = p.order[p.i];
    previewStatus($);
    $.ui.invalidate("ui.render");
  }
}

function previewStatus($) {
  const of = preview.order.length > 1 ? ` (${preview.i + 1} of ${preview.order.length})` : "";
  $.ui.status(`ambient preview: ${style}${of}`);
}

function endPreview($, restore) {
  if (preview === null) {
    return;
  }
  if (preview.step) stepEnded(scene, preview.step);
  if (preview.tool) toolEnded(scene, preview.tool, false);
  if (restore) {
    style = preview.restore;
    $.ui.invalidate("ui.render");
  }
  preview = null;
  $.ui.status(undefined);
}

function stopTimer() {
  if (timer !== null) {
    try {
      timer.cancel();
    } catch {
      // already gone
    }
    timer = null;
  }
}

function paint($) {
  if (mounted === null) {
    return;
  }
  const { requestId, columns, rows } = mounted;
  const cells = packCells(drawFrame(scene, style, columns, rows, look));
  $.ui.blit({ requestId, key: STRIP_KEY, columns, rows, cells }).catch(() => {});
}

// The name of the palette ccs-theme last applied, read once per session start.
async function themePalette($) {
  try {
    const home = await $.env.get("HOME");
    if (!home) {
      return FALLBACK;
    }
    const name = String(await $.fs.read(`${home}/.config/ccstatusline/.theme`)).trim();
    return PALETTES[name] ? name : FALLBACK;
  } catch {
    return FALLBACK;
  }
}
