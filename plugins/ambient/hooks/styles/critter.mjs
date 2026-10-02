// critter: a small orange creature acting out the work.

import {
  B64,
  BLANK,
  CELEBRATE_TIME,
  CLAWD,
  CLAWD_KID,
  CONFIRM_TIME,
  DEFAULT_COLOR,
  EFFORT,
  FALLBACK,
  Frame,
  HORIZON,
  INK,
  INTENSITY,
  LOWER,
  MESH,
  PALETTES,
  PULSE_HEAD,
  PULSE_TRAIL,
  QUAD,
  SPARK_MAIN,
  SPARK_SUB,
  TRIP_TIME,
  UPPER,
  WAVE,
  add,
  clamp01,
  clampInt,
  cp,
  flareBackground,
  hash,
  horizonLine,
  line,
  mix,
  modeColor,
  quantize,
  toBase64,
} from "../lib.mjs";


// Quadrant pixels, 17 wide: the startup logo's creature.
const BODY = [
  "...############..",
  "...##.######.##..",
  ".################",
  "...############..",
];
const LEGS = ["....#.#....#.#...", "...#.#......#.#.."];

export function critterPose(s) {
  if (s.trip > 0) return "trip";
  if (s.celebrate > 0) return "celebrate";
  if ([...s.tools].some((t) => !t.sub)) return "hammer";
  if ([...s.steps].some((t) => !t.sub) || s.linger > 0) return s.mode === "thinking" ? "think" : "walk";
  if (s.glow > 0) return "stand";
  return "nap";
}

export function drawCritter(s, f) {
  const { W, H, k, pal } = f;
  const QW = W * 2;
  const pose = critterPose(s);
  const frame = Math.floor(s.walk) % 2;
  const dir = s.dir;
  // Snap to whole cells so the eyes line up with the logo's.
  let ox = Math.round((s.cx * (QW - 18)) / 2) * 2;
  let oy = H - 5;
  const body = BODY.map((r) => r.split(""));
  let legs = LEGS[0];
  let lean = 0;

  if (pose === "walk") {
    legs = LEGS[frame];
  } else if (pose === "celebrate") {
    oy -= frame;
    body[2][1] = body[2][2] = body[2][15] = body[2][16] = ".";
  } else if (pose === "think") {
    body[2][15] = body[2][16] = ".";
  } else if (pose === "hammer") {
    body[2][16] = frame ? "#" : ".";
  } else if (pose === "trip") {
    ox += frame ? 1 : -1;
    lean = 1;
  } else if (pose === "nap") {
    oy += 1;
    body[1][5] = body[1][12] = "#";
    legs = null;
  }
  const flip = (x) => (dir >= 0 ? x : 16 - x);
  const color = pose === "nap" ? mix(pal.bg, CLAWD, 0.75 + 0.15 * k) : mix(pal.bg, CLAWD, 0.85 + 0.15 * k);

  body.forEach((row, y) => row.forEach((c, x) => c === "#" && f.q(ox + flip(x) + (y < 2 ? lean : 0), oy + y, color)));
  if (legs) legs.split("").forEach((c, x) => c === "#" && f.q(ox + flip(x), oy + 4, color));

  const cellX = (qx) => Math.floor((ox + flip(qx)) / 2);
  const topRow = Math.floor(oy / 2);
  const aboveRow = topRow - 1 >= 0 ? topRow - 1 : null;
  const side = (n) => cellX(dir >= 0 ? 17 + n * 2 : -1 - n * 2);
  const accent = (c, a) => mix(pal.bg, c, a * k + (1 - k) * 0.4);

  if (pose === "celebrate") {
    // Arms up and confetti.
    for (const [x, y] of [[1, 1], [2, 0], [15, 0], [16, 1]]) f.q(ox + flip(x), oy + y, color);
    const bits = ["*", "+", ".", "*"].map(cp);
    const colors = [pal.a, pal.b, pal.warn, pal.c ?? pal.a];
    for (let j = 0; j < 6; j += 1) {
      const cx = cellX(0) - 2 + Math.floor(hash(j * 3.3 + Math.floor(s.t * 5)) * 13);
      const cy = Math.floor(hash(j * 7.7 + Math.floor(s.t * 5)) * Math.max(1, topRow + 1));
      if (!f.hasCell(cx, cy)) f.cell(cx, cy, bits[j % 4], accent(colors[j % 4], 1));
    }
  } else if (pose === "think") {
    // A hand scratching the head, and a question.
    const up = frame ? [[15, 1], [16, 0]] : [[16, 1], [16, 0]];
    for (const [x, y] of up) f.q(ox + flip(x), oy + y, color);
    const qx = side(1);
    const qy = aboveRow ?? topRow;
    f.cell(qx, qy, cp("?"), accent(pal.b, 1));
    if (aboveRow !== null) f.cell(dir >= 0 ? qx - 1 : qx + 1, topRow, cp("o"), accent(pal.b, 0.6));
  } else if (pose === "hammer") {
    // A hammer in the forward hand, sparks on the strike.
    const steel = accent(pal.fg, 0.8);
    const pts = frame
      ? [[18, 2], [19, 2], [20, 2], [21, 1], [21, 2], [21, 3], [22, 1], [22, 2], [22, 3]]
      : [[18, 1], [18, 0], [19, -1], [20, -1], [19, 0], [20, 0], [21, -1], [21, 0]];
    for (const [x, y] of pts) f.q(ox + flip(x), oy + y, steel);
    if (frame) {
      const sx = side(3);
      f.cell(sx, Math.floor((oy + 4) / 2), cp("*"), accent(pal.warn, 1));
      f.cell(sx + dir, Math.floor((oy + 2) / 2), cp("+"), accent(pal.warn, 0.7));
    }
  } else if (pose === "trip") {
    f.cell(side(1), aboveRow ?? topRow, cp("!"), accent(pal.bad, 1));
    f.cell(side(2), Math.floor((oy + 4) / 2), cp("*"), accent(pal.bad, 0.9));
    f.cell(cellX(0) - dir * 2, Math.floor((oy + 4) / 2), cp("*"), accent(pal.warn, 0.8));
  } else if (pose === "nap") {
    const zx = side(0);
    f.cell(zx, topRow, cp("z"), accent(pal.b, 0.55));
    f.cell(zx + dir, aboveRow ?? topRow, cp("Z"), accent(pal.b, 0.75));
  }

  // Ink: what it writes floats off behind it.
  for (const p of s.ink) {
    const cx = Math.floor(p.x * W);
    const cy = Math.floor(p.y * Math.max(1, f.rows - 1));
    if (cx >= 0 && cx < W && !f.hasCell(cx, cy)) f.cell(cx, cy, INK[Math.min(INK.length - 1, Math.floor(p.life * INK.length))], mix(pal.bg, pal.a, (0.3 + 0.7 * p.life) * k));
  }

  // A small companion trots along while subagents work.
  if (s.flowSub > 0.04 || [...s.steps].some((t) => t.sub)) {
    const kid = ["######", "#.##.#", frame ? ".#..#." : "#....#"];
    const kx = ox - dir * 12 + (dir >= 0 ? 0 : 10);
    kid.forEach((row, y) => row.split("").forEach((c, x) => c === "#" && f.q(kx + x, H - 3 + y, mix(pal.bg, CLAWD_KID, 0.9 * k + 0.1))));
  }

  // The ground: context fill along the bottom row.
  if (s.horizon !== null) {
    const fillTo = Math.round(s.horizon * W);
    for (let x = 0; x < fillTo; x += 1) if (!f.hasCell(x, f.rows - 1)) f.cell(x, f.rows - 1, HORIZON, mix(pal.bg, pal.fg, 0.2));
  }
  flareBackground(s, f);
}

