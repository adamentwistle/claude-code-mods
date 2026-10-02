// The strip's simulation, with no engine calls: ambient.mjs feeds it events and a
// clock, and asks it for cells. Every style shares one scene, so a switch mid-turn
// carries on where the last style was. The styles live in ./styles.

import { CELEBRATE_TIME, CONFIRM_TIME, EFFORT, Frame, MESH, PALETTES, TRIP_TIME, clamp01, toBase64 } from "./lib.mjs";
import { drawAurora } from "./styles/aurora.mjs";
import { critterPose, drawCritter } from "./styles/critter.mjs";
import { drawLava, lavaSettled, stepLava } from "./styles/lava.mjs";
import { drawMurmuration, stepMurmuration } from "./styles/murmuration.mjs";
import { drawNetwork, networkSettled, packet, stepNetwork } from "./styles/network.mjs";
import { drawSynthwave, stepSynthwave } from "./styles/synthwave.mjs";
import { drawWarp, stepWarp } from "./styles/warp.mjs";
import { drawWave } from "./styles/wave.mjs";

export { FALLBACK, INTENSITY, PALETTES } from "./lib.mjs";

export const STYLE_INFO = {
  network: "a mesh of nodes in depth with requests flying between them; each turn locks a block onto a chain",
  critter: "a small orange creature that acts out the work, then naps",
  aurora: "curtains of light drifting over a starfield",
  synthwave: "a neon grid racing toward a striped sun, faster as the answer streams",
  warp: "hyperspace streaks that stretch with the stream; a jump flash when a turn completes",
  murmuration: "a flock of starlings over a sunset, circling while thinking and scattering on tool calls",
  lava: "slow liquid blobs of colour, like a lava lamp",
  wave: "a low flowing wave with sparks, the quietest",
};
export const STYLES = Object.keys(STYLE_INFO);

// ---- Scene state and events -------------------------------------------------------

export function createScene() {
  return {
    t: 0,
    steps: new Set(),
    tools: new Set(),
    glow: 0,
    flow: 0,
    flowSub: 0,
    linger: 0,
    mode: "writing",
    tint: 0,
    lean: null,
    horizon: null,
    flare: 0,
    flareX: 0.5,
    particles: [],
    pulses: [],
    // network
    packets: [],
    bursts: [],
    chain: 0,
    confirmAge: Infinity,
    layout: null,
    // critter
    cx: 0.3,
    dir: 1,
    walk: 0,
    celebrate: 0,
    trip: 0,
    ink: [],
    // network depth, comets, consensus
    netDrift: 0,
    netLit: new Map(),
    arrivals: [],
    consensus: Infinity,
    // aurora
    at: 0,
    shocks: [],
    // synthwave, warp, murmuration, lava
    road: 0,
    warpStars: null,
    boids: null,
    lava: null,
    lavaT: 0,
  };
}

export function isActive(s) {
  return s.steps.size + s.tools.size > 0;
}

export function stepBegan(s, { sub, model, effort }) {
  const token = { sub: Boolean(sub) };
  s.steps.add(token);
  if (!token.sub) {
    s.tint = typeof effort === "number" ? clamp01(effort / 32000) : EFFORT[effort] ?? 0.3;
    s.lean = /haiku/i.test(model ?? "") ? "a" : /opus|fable/i.test(model ?? "") ? "b" : null;
  }
  return token;
}

export function stepEnded(s, token) {
  s.steps.delete(token);
}

export function chunkSeen(s, token, kind, length) {
  s.linger = 0.6;
  if (kind !== "text" && kind !== "thinking" && kind !== "tool") return;
  const n = kind === "tool" ? 20 : Math.min(length, 60);
  if (token.sub) {
    s.flowSub = Math.min(1, s.flowSub + n / 260);
  } else {
    s.flow = Math.min(1, s.flow + n / 160);
    if (kind !== "tool") s.mode = kind === "thinking" ? "thinking" : "writing";
  }
  // Roughly one particle or packet per 24 characters streamed.
  const want = Math.floor(n / 24) + (Math.random() < (n % 24) / 24 ? 1 : 0);
  for (let i = 0; i < want; i += 1) {
    if (s.particles.length < 40) {
      s.particles.push({ x: token.sub ? 1 : 0, v: (token.sub ? -1 : 1) * (0.12 + Math.random() * 0.22), life: 1, sub: token.sub, row: Math.random() });
    }
    if (s.packets.length < 16 && Math.random() < 0.5) s.packets.push(packet(s, token.sub ? MESH.cyan : s.mode === "thinking" ? MESH.lilac : MESH.green, 0.7 + Math.random() * 0.8));
    if (!token.sub && kind === "text" && s.ink.length < 24) {
      s.ink.push({ x: s.cx - s.dir * 0.02, y: Math.random(), vx: -s.dir * (0.03 + Math.random() * 0.05), life: 1 });
    }
  }
}

export function toolBegan(s, { sub }) {
  const token = { sub: Boolean(sub) };
  s.tools.add(token);
  s.linger = 0.6;
  s.pulses.push({ x: 0, speed: token.sub ? 0.5 : 0.75, sub: token.sub, token, done: false });
  const node = s.layout ? Math.floor(Math.random() * s.layout.nodes.length) : 0;
  s.bursts.push({ node, age: 0, token, color: token.sub ? MESH.cyan : MESH.yellow, done: false });
  for (let i = 0; i < (token.sub ? 2 : 4); i += 1) s.packets.push(packet(s, token.sub ? MESH.cyan : MESH.yellow, 1.1, node));
  s.shocks.push({ x: -0.05, speed: token.sub ? 0.45 : 0.6, color: "warn", life: 1 });
  return token;
}

export function toolEnded(s, token, failed) {
  s.tools.delete(token);
  for (const p of s.pulses) if (p.token === token) p.done = true;
  for (const b of s.bursts) if (b.token === token) b.done = true;
  if (!failed) return;
  s.flare = 1;
  const pulse = s.pulses.find((p) => p.token === token);
  s.flareX = pulse ? Math.min(1, pulse.x) : 0.5;
  const burst = s.bursts.find((b) => b.token === token);
  const node = burst ? burst.node : 0;
  s.bursts.push({ node, age: 0, token: null, color: MESH.red, done: true });
  for (let i = 0; i < 3; i += 1) s.packets.push(packet(s, MESH.red, 1.2, node));
  s.shocks.push({ x: -0.05, speed: 0.9, color: "bad", life: 1 });
  s.trip = TRIP_TIME;
}

export function turnCompleted(s) {
  for (const t of s.steps) if (!t.sub) s.steps.delete(t);
  for (const t of s.tools) if (!t.sub) s.tools.delete(t);
  for (const p of s.pulses) if (!p.sub) p.done = true;
  for (const b of s.bursts) if (b.token && !b.token.sub) b.done = true;
  s.chain += 1;
  s.confirmAge = 0;
  s.consensus = 0;
  s.celebrate = CELEBRATE_TIME;
  // The last few requests settle into the new block.
  for (let i = 0; i < 3; i += 1) {
    const p = packet(s, MESH.green, 1.6, undefined, true);
    p.p = -i * 0.3;
    s.packets.push(p);
  }
}

export function horizonSeen(s, fill) {
  s.horizon = clamp01(fill);
}

// Drops all motion; the chain and the horizon stay.
export function still(s) {
  s.steps.clear();
  s.tools.clear();
  Object.assign(s, { glow: 0, flow: 0, flowSub: 0, linger: 0, flare: 0, particles: [], pulses: [], packets: [], bursts: [], confirmAge: Infinity, celebrate: 0, trip: 0, ink: [], shocks: [], arrivals: [], consensus: Infinity });
  s.netLit.clear();
  if (s.lava) s.lava = s.lava.filter((b) => !b.rise);
}

export function isSettled(s) {
  return (
    !isActive(s) && s.linger <= 0 && s.glow <= 0 && s.flare <= 0 && s.celebrate <= 0 && s.trip <= 0 && s.confirmAge >= CONFIRM_TIME &&
    s.particles.length === 0 && s.pulses.length === 0 && s.packets.length === 0 && s.bursts.length === 0 && s.ink.length === 0 && s.shocks.length === 0 &&
    networkSettled(s) && lavaSettled(s)
  );
}

// ---- Time -------------------------------------------------------------------------

export function tick(s, dt, style) {
  s.t += dt;
  const active = isActive(s) || s.linger > 0;
  s.linger = Math.max(0, s.linger - dt);
  s.glow = active ? Math.min(1, s.glow + dt / 0.4) : Math.max(0, s.glow - dt / 1.2);
  const decay = Math.exp(-dt / 0.6);
  s.flow *= decay;
  s.flowSub *= decay;
  s.flare = Math.max(0, s.flare - dt / 0.8);
  s.celebrate = Math.max(0, s.celebrate - dt);
  s.trip = Math.max(0, s.trip - dt);
  if (s.confirmAge < CONFIRM_TIME) s.confirmAge += dt;

  for (const p of s.particles) {
    p.x += p.v * dt;
    p.life -= dt / (p.sub ? 1.4 : 1.8);
  }
  s.particles = s.particles.filter((p) => p.life > 0 && p.x >= 0 && p.x <= 1);

  for (const p of s.pulses) {
    p.x += p.speed * dt;
    if (p.x > 1.15 && !p.done) p.x = 0;
  }
  s.pulses = s.pulses.filter((p) => !(p.done && p.x > 1.15));

  stepNetwork(s, dt);
  if (style === "synthwave") stepSynthwave(s, dt);
  else if (style === "warp") stepWarp(s, dt);
  else if (style === "murmuration") stepMurmuration(s, dt);
  else if (style === "lava") stepLava(s, dt);
  for (const p of s.packets) p.p += p.speed * dt;
  s.packets = s.packets.filter((p) => p.p < 1);
  // Keep a trickle of requests while working, more as the stream speeds up.
  if (active && Math.random() < dt * (0.8 + 12 * Math.max(s.flow, s.flowSub)) && s.packets.length < 16) {
    s.packets.push(packet(s, s.mode === "thinking" ? MESH.lilac : MESH.green, 0.7 + Math.random() * 0.8));
  }

  for (const b of s.bursts) b.age += dt;
  s.bursts = s.bursts.filter((b) => !(b.done && b.age > 0.8) && b.age < 120);

  for (const k of s.shocks) {
    k.x += k.speed * dt;
    k.life = Math.min(1, (k.x + 0.05) / 0.15, (1.15 - k.x) / 0.25);
  }
  s.shocks = s.shocks.filter((k) => k.x < 1.15);
  s.at += dt * (0.5 + 2.5 * Math.max(s.flow, s.flowSub * 0.6)) * (0.3 + 0.7 * s.glow);

  // The critter walks while the answer streams.
  if (critterPose(s) === "walk") {
    s.walk += dt * (4 + 8 * s.flow);
    s.cx += s.dir * dt * (0.03 + 0.07 * s.flow);
    if (s.cx > 0.9) s.dir = -1;
    if (s.cx < 0.05) s.dir = 1;
  } else {
    s.walk += dt * 6;
  }
  for (const k of s.ink) {
    k.x += k.vx * dt;
    k.life -= dt / 1.6;
  }
  s.ink = s.ink.filter((k) => k.life > 0);
}

// ---- Drawing ----------------------------------------------------------------------

// Rows the strip needs for a style, from the rows asked for.
export function rowsFor(style, rows) {
  const r = Math.max(1, Math.min(6, Math.round(rows) || 3));
  // The critter needs three rows to stand in, synthwave four for its sun and road.
  return style === "critter" ? Math.max(3, r) : style === "synthwave" ? Math.max(4, r) : r;
}

// One frame as cells: { columns, rows, glyph, fg, bg }.
export function drawFrame(s, style, columns, rows, look) {
  const palette = style === "network" ? PALETTES.nightshade : look.palette;
  const f = new Frame(columns, rows, { ...look, palette });
  if (style === "network") drawNetwork(s, f);
  else if (style === "critter") drawCritter(s, f);
  else if (style === "aurora") drawAurora(s, f);
  else if (style === "synthwave") drawSynthwave(s, f);
  else if (style === "warp") drawWarp(s, f);
  else if (style === "murmuration") drawMurmuration(s, f);
  else if (style === "lava") drawLava(s, f);
  else drawWave(s, f);
  return f.resolve();
}

// Raster `cells`: base64 of little-endian u32 triplets.
export function packCells(frame) {
  const n = frame.columns * frame.rows;
  const words = new Uint32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    words[i * 3] = frame.glyph[i];
    words[i * 3 + 1] = frame.fg[i];
    words[i * 3 + 2] = frame.bg[i];
  }
  return toBase64(new Uint8Array(words.buffer));
}
