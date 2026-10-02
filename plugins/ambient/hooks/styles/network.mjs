// network: a mesh of nodes in three layers of depth, requests flying between them
// as comets, and a block chain that locks in a block when a turn completes.

import { CONFIRM_TIME, MESH, clamp01, clampInt, cp, hash, line, mix } from "../lib.mjs";

const LINK_H = cp("─");
const LINK_UP = cp("╱");
const LINK_DOWN = cp("╲");
const LINK_DOT = cp("┄");
const NODE = cp("◆");
const HEAD = cp("•");
const BLOCK = [cp("▐"), cp("█"), cp("▌")];

// ---- Layout -------------------------------------------------------------------------

export function layoutFor(s, columns, rows) {
  if (s.layout && s.layout.columns === columns && s.layout.rows === rows) return s.layout;
  const chainW = Math.max(10, Math.round(columns * 0.2));
  const meshW = Math.max(8, columns - chainW - 3);
  const count = clampInt(Math.round(meshW / 12), 3, 9);
  const spacing = meshW / count;
  const nodes = [];
  for (let i = 0; i < count; i += 1) {
    const x = Math.round((i + 0.5) * spacing + (hash(i * 7.1) - 0.5) * spacing * 0.35);
    let y = rows === 1 ? 0 : Math.round(hash(i * 3.7 + 1) * (rows - 1));
    if (i > 0 && rows > 1 && y === nodes[i - 1].y && hash(i * 1.3) > 0.35) y = y === 0 ? 1 : y - 1;
    nodes.push({ x, y, phase: hash(i * 5.3) * 6.28 });
  }
  const chainRow = rows === 1 ? 0 : Math.floor((rows - 1) / 2);
  const chainX = columns - chainW;
  const edges = [];
  for (let i = 0; i + 1 < count; i += 1) edges.push({ a: i, b: i + 1, cells: linkPath(nodes[i], nodes[i + 1], LINK_H) });
  const last = nodes[count - 1];
  const chainLink = { a: count - 1, b: -1, cells: linkPath(last, { x: chainX - 1, y: chainRow }, LINK_DOT).concat([{ x: chainX - 1, y: chainRow, g: LINK_DOT }]) };
  // Depth: two layers of small pixel nodes behind the mesh.
  const H = rows * 2;
  const layer = (n, seed) => Array.from({ length: n }, (_, i) => ({ x: hash(i * 2.9 + seed) * meshW, y: hash(i * 6.1 + seed) * (H - 1), tw: hash(i * 1.1 + seed) * 6.28 }));
  const far = layer(Math.round(meshW / 5), 11);
  const mid = layer(Math.round(meshW / 9), 37);
  s.layout = { columns, rows, nodes, edges, chainLink, chainX, chainW, chainRow, meshW, far, mid };
  return s.layout;
}

// The cells between two nodes: flat runs with the row changes in the middle.
function linkPath(a, b, flat) {
  const cells = [];
  const n = b.x - a.x - 1;
  const dy = b.y - a.y;
  const steps = Math.min(Math.abs(dy), Math.max(0, n));
  const first = a.x + 1 + Math.floor((n - steps) / 2);
  let y = a.y;
  for (let x = a.x + 1; x < b.x; x += 1) {
    if (x >= first && x < first + steps) {
      cells.push({ x, y, g: dy > 0 ? LINK_DOWN : LINK_UP });
      y += Math.sign(dy);
    } else {
      cells.push({ x, y, g: flat });
    }
  }
  return cells;
}

// ---- Requests -----------------------------------------------------------------------

// A request along a link: any link, one out of a node, or into the chain.
export function packet(s, color, speed, fromNode, toChain) {
  if (toChain) return { e: -1, rev: false, p: 0, speed, color };
  const lay = s.layout;
  if (fromNode !== undefined && lay) {
    const mine = lay.edges.map((e, i) => [e, i]).filter(([e]) => e.a === fromNode || e.b === fromNode);
    if (mine.length) {
      const [e, i] = mine[Math.floor(Math.random() * mine.length)];
      return { e: i, rev: e.b === fromNode, p: 0, speed, color };
    }
  }
  return { e: Math.floor(Math.random() * 64), rev: Math.random() < 0.5, p: 0, speed, color };
}

export function stepNetwork(s, dt) {
  const lay = s.layout;
  s.netDrift += dt * (0.4 + 2.2 * Math.max(s.flow, s.flowSub)) * s.glow;
  for (const [key, lit] of s.netLit) {
    lit.v -= dt / 0.7;
    if (lit.v <= 0) s.netLit.delete(key);
  }
  for (const p of s.packets) {
    if (p.p < 0 || !lay) continue;
    const key = p.e < 0 ? -1 : p.e % lay.edges.length;
    const lit = s.netLit.get(key) ?? { v: 0, color: p.color };
    lit.v = Math.min(1, lit.v + dt * 3);
    lit.color = p.color;
    s.netLit.set(key, lit);
    if (p.p + p.speed * dt >= 1) {
      const edge = p.e < 0 ? lay.chainLink : lay.edges[key];
      s.arrivals.push({ node: p.e < 0 ? -1 : p.rev ? edge.a : edge.b, age: 0, color: p.color });
    }
  }
  for (const a of s.arrivals) a.age += dt;
  s.arrivals = s.arrivals.filter((a) => a.age < 0.45);
  if (s.consensus !== Infinity) {
    s.consensus += dt;
    if (s.consensus > 1.6) s.consensus = Infinity;
  }
  // Now and then while working, the nodes agree: a pulse runs along the mesh.
  if ((s.steps.size > 0 || s.tools.size > 0) && s.consensus === Infinity && Math.random() < dt / 5) s.consensus = 0;
}

export function networkSettled(s) {
  return s.arrivals.length === 0 && s.consensus === Infinity;
}

// ---- Drawing ------------------------------------------------------------------------

export function drawNetwork(s, f) {
  const { k, W, H } = f;
  const lay = layoutFor(s, f.columns, f.rows);
  const live = s.glow;
  const nodePx = (n) => [n.x, n.y * 2 + 0.5];

  // Far and middle layers: small pixel nodes drifting at two speeds, faint links between neighbours.
  const drawLayer = (pts, speed, bright, linked) => {
    const placed = pts.map((p) => ({ x: (((p.x - s.netDrift * speed) % lay.meshW) + lay.meshW) % lay.meshW, y: p.y, tw: p.tw })).sort((a, b) => a.x - b.x);
    if (linked) {
      for (let i = 0; i + 1 < placed.length; i += 1) {
        const a = placed[i];
        const b = placed[i + 1];
        if (b.x - a.x < 9) line(a.x, a.y, b.x, b.y, (x, y) => f.glow(x, y, MESH.purple, bright * 0.35 * k));
      }
    }
    for (const p of placed) {
      const tw = 0.65 + 0.35 * Math.sin(s.t * 1.3 + p.tw);
      f.glow(p.x, p.y, mix(MESH.purple, MESH.blue, 0.4), bright * tw * k * (0.7 + 0.3 * live));
    }
  };
  // Depth needs room: at three rows or fewer the back layers would read as noise.
  if (f.rows >= 4) {
    drawLayer(lay.far, 0.5, 0.14, true);
    drawLayer(lay.mid, 1.2, 0.26, false);
  }

  // Halos: a soft falloff around each mesh node, brighter while busy or pulsing.
  const pulseOf = (n) => (s.consensus === Infinity ? 0 : Math.exp(-(((s.consensus - n * 0.09) / 0.11) ** 2)));
  lay.nodes.forEach((node, n) => {
    const [cx, cy] = nodePx(node);
    const breathe = 0.5 + 0.5 * Math.sin(s.t * 1.6 + node.phase);
    let strength = (0.07 + 0.12 * live * breathe) * k + 0.35 * pulseOf(n);
    let color = live > 0.05 ? MESH.green : MESH.purple;
    for (const a of s.arrivals) if (a.node === n) { strength += 0.3 * (1 - a.age / 0.45); color = a.color; }
    for (const b of s.bursts) if (b.node % lay.nodes.length === n) { strength += 0.22; color = b.color; }
    halo(f, cx, cy, 2.2, 0.85, color, strength);
  });

  // Links: thin and dim, lit up for a moment along a request's path.
  const base = mix(MESH.bg, MESH.purple, 0.28 + 0.1 * k + 0.1 * live);
  lay.edges.forEach((e, i) => {
    const lit = s.netLit.get(i);
    const color = lit ? mix(base, lit.color, 0.45 * lit.v) : base;
    for (const c of e.cells) f.cell(c.x, c.y, c.g, color);
  });
  const chainLit = s.netLit.get(-1);
  const chainBase = mix(MESH.bg, MESH.purple, 0.22 + 0.1 * k);
  for (const c of lay.chainLink.cells) f.cell(c.x, c.y, c.g, chainLit ? mix(chainBase, chainLit.color, 0.5 * chainLit.v) : chainBase);

  // Requests: comets with a bright head and a long gradient tail.
  for (const p of s.packets) {
    if (p.p < 0) continue;
    const edge = p.e < 0 ? lay.chainLink : lay.edges[p.e % lay.edges.length];
    const cells = p.rev ? [...edge.cells].reverse() : edge.cells;
    if (!cells.length) continue;
    const head = Math.min(cells.length - 1, Math.floor(p.p * cells.length));
    const tail = 5;
    for (let j = tail; j >= 1; j -= 1) {
      const c = cells[head - j];
      if (c) f.cell(c.x, c.y, c.g, mix(base, p.color, 0.9 * (1 - j / (tail + 1)) ** 1.3));
    }
    const c = cells[head];
    halo(f, c.x, c.y * 2 + 0.5, 1.1, 0.55, p.color, 0.28 * k);
    f.cell(c.x, c.y, HEAD, mix(p.color, MESH.fg, 0.35));
  }

  // Tool bursts: short sparks flying out from the working node, in the empty
  // cells only, so the wires keep their own colour.
  for (const b of s.bursts) {
    const node = lay.nodes[b.node % lay.nodes.length];
    const [cx, cy] = nodePx(node);
    const age = b.done ? b.age : b.age % 0.7;
    const fade = b.done ? Math.max(0, 1 - b.age / 0.8) : 1 - age / 0.7;
    const r = 1.5 + age * 9;
    for (let a = 0; a < 12; a += 1) {
      const t = (a / 12) * Math.PI * 2 + 0.26;
      for (let j = 0; j < 2; j += 1) {
        const x = Math.round(cx + Math.cos(t) * (r - j * 1.2) * 2.2);
        const y = Math.round(cy + Math.sin(t) * (r - j * 1.2));
        if (x < 0 || y < 0 || x >= W || y >= H || f.hasCell(x, y >> 1)) continue;
        f.glow(x, y, b.color, (j === 0 ? 0.85 : 0.4) * fade * k);
      }
    }
  }

  // Nodes: diamonds; idle lilac, busy green, white at the crest of a pulse.
  lay.nodes.forEach((node, n) => {
    const breathe = 0.5 + 0.5 * Math.sin(s.t * 1.6 + node.phase);
    let color = mix(mix(MESH.bg, MESH.lilac, 0.68 + 0.2 * k), MESH.green, live * (0.75 + 0.25 * breathe));
    color = mix(color, MESH.fg, pulseOf(n) * 0.8);
    for (const a of s.arrivals) if (a.node === n) color = mix(color, MESH.fg, 0.7 * (1 - a.age / 0.45));
    for (const b of s.bursts) {
      if (b.node % lay.nodes.length !== n) continue;
      const fade = b.done ? Math.max(0, 1 - b.age / 0.8) : 0.8 + 0.2 * Math.sin(b.age * 10);
      color = mix(color, b.color, fade);
    }
    f.cell(node.x, node.y, NODE, color);
  });

  drawChain(s, f, lay);
}

// The chain: a genesis block plus one per finished turn. The newest locks in with a
// white flash, a ring, and a shockwave running back along the older blocks.
function drawChain(s, f, lay) {
  const { k } = f;
  const tall = f.rows >= 5;
  const slots = Math.max(1, Math.floor((lay.chainW + 1) / 4));
  const shown = Math.min(s.chain + 1, slots);
  const age = s.confirmAge;
  const fresh = age < CONFIRM_TIME;
  const settled = mix(MESH.bg, MESH.purple, 0.62 + 0.25 * k);
  for (let j = 0; j < shown; j += 1) {
    const x = lay.chainX + j * 4;
    const isNew = j === shown - 1 && fresh;
    let color = settled;
    if (isNew) {
      color = age < 0.18 ? MESH.fg : mix(MESH.green, settled, clamp01((age - 0.18) / (CONFIRM_TIME - 0.18)) ** 2);
      halo(f, x + 1, lay.chainRow * 2 + (tall ? 1.5 : 0.5), 2 + age * 7, 0.9 + age * 1.6, MESH.green, 0.55 * (1 - age / CONFIRM_TIME) ** 2);
    } else if (fresh) {
      // Shockwave: older blocks brighten as the wave passes them.
      const dist = shown - 1 - j;
      const wave = Math.exp(-(((age * 9 - dist) / 0.8) ** 2));
      color = mix(settled, MESH.green, 0.75 * wave);
    }
    for (let r = 0; r < (tall ? 2 : 1); r += 1) BLOCK.forEach((g, d) => f.cell(x + d, lay.chainRow + r, g, color));
    if (j > 0) f.cell(x - 1, lay.chainRow + (tall ? 1 : 0), LINK_H, mix(MESH.bg, MESH.dim, 0.8));
  }
}

function halo(f, cx, cy, rx, ry, color, strength) {
  if (strength <= 0.02) return;
  for (let y = Math.floor(cy - ry * 2); y <= cy + ry * 2; y += 1) {
    for (let x = Math.floor(cx - rx * 2); x <= cx + rx * 2; x += 1) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      f.glow(x, y, color, strength * Math.exp(-d));
    }
  }
}
