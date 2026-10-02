// murmuration: a flock of starlings swirling over a sunset; they gather with the
// stream, circle while thinking, scatter on tool calls and roost when done.

import { CONFIRM_TIME, clamp01, mix } from "../lib.mjs";

const SKY_LOW = 0xff8a5c;
const SKY_MID = 0xd2557a;
const SKY_TOP = 0x4a2a6e;
const BIRD = 0x0d0a14;

function flock(s, W, H) {
  const n = Math.max(50, Math.min(160, Math.round((W * H) / 9)));
  if (!s.boids || s.boids.n !== n) {
    // A loose ribbon of specks across the middle of the strip, one bird to a spot.
    const birds = Array.from({ length: n }, (_, i) => {
      const u = (i + Math.random()) / n;
      return {
        x: W * (0.12 + 0.76 * u),
        y: H * (0.5 + 0.22 * Math.sin(u * 9.4) + (Math.random() - 0.5) * 0.3),
        vx: 2 + Math.random(),
        vy: (Math.random() - 0.5) * 0.5,
      };
    });
    s.boids = { n, birds, W, H };
  }
  if (s.boids.W !== W || s.boids.H !== H) {
    for (const b of s.boids.birds) {
      b.x *= W / s.boids.W;
      b.y *= H / s.boids.H;
    }
    s.boids.W = W;
    s.boids.H = H;
  }
  return s.boids;
}

export function stepMurmuration(s, dt) {
  if (!s.boids) return;
  const { birds, W, H } = s.boids;
  const energy = Math.max(s.flow, s.flowSub * 0.6);
  const pace = s.glow;
  if (pace <= 0) return;
  const t = s.t;
  const think = s.mode === "thinking" && s.tools.size === 0;
  const done = s.confirmAge < CONFIRM_TIME || (!s.steps.size && !s.tools.size);
  // Where the flock is drawn: a wandering point, a roost once the turn is over.
  // A figure of eight across the whole strip; once the turn is over, a lazy drift.
  const ax = W * (0.5 + 0.42 * Math.sin(t * (done ? 0.08 : 0.21)));
  const ay = H * (0.5 + 0.25 * Math.sin(t * (done ? 0.16 : 0.42)));
  const vmax = (done ? 4 : 7 + 22 * energy + (think ? 6 : 0)) * pace;

  // Tool calls: scatter the birds away from a point.
  for (const b of s.bursts) {
    if (b.flock) continue;
    b.flock = true;
    const px = W * (0.2 + Math.random() * 0.6);
    const py = H * 0.5;
    for (const bird of birds) {
      const dx = bird.x - px;
      const dy = (bird.y - py) * 2;
      const d = Math.hypot(dx, dy) + 0.5;
      if (d < W * 0.25) {
        bird.vx += (dx / d) * 30;
        bird.vy += (dy / d) * 8;
      }
    }
  }

  for (let i = 0; i < birds.length; i += 1) {
    const b = birds[i];
    let cx = 0;
    let cy = 0;
    let avx = 0;
    let avy = 0;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let j = 0; j < birds.length; j += 1) {
      if (i === j) continue;
      const o = birds[j];
      const dx = o.x - b.x;
      const dy = (o.y - b.y) * 2;
      const d2 = dx * dx + dy * dy;
      if (d2 > 160) continue;
      n += 1;
      cx += o.x;
      cy += o.y;
      avx += o.vx;
      avy += o.vy;
      if (d2 < 14) {
        sx -= dx;
        sy -= dy / 2;
      }
    }
    if (n) {
      b.vx += ((cx / n - b.x) * 0.25 + (avx / n - b.vx) * 1.2) * dt;
      b.vy += ((cy / n - b.y) * 0.25 + (avy / n - b.vy) * 1.2) * dt;
    }
    b.vx += sx * 6 * dt + (ax - b.x) * 0.12 * dt;
    b.vy += sy * 4 * dt + (ay - b.y) * 0.7 * dt;
    // A slow swirl about the gathering point keeps the flock rolling.
    b.vx += -(b.y - ay) * 0.9 * dt;
    b.vy += ((b.x - ax) / W) * H * 0.5 * dt;
    if (think) {
      // Circling: a swirl around the gathering point.
      b.vx += -(b.y - ay) * 2.2 * dt;
      b.vy += ((b.x - ax) / W) * H * 1.6 * dt;
    }
    // Soft walls: turn back well before the edges of the strip.
    if (b.y < 1.5) b.vy += 18 * dt;
    if (b.y > H - 2.5) b.vy -= 18 * dt;
    if (b.x < 2) b.vx += 12 * dt;
    if (b.x > W - 3) b.vx -= 12 * dt;
    const sp = Math.hypot(b.vx, b.vy * 2);
    if (sp > vmax) {
      b.vx *= vmax / sp;
      b.vy *= vmax / sp;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < 0 || b.x > W - 1) {
      b.x = Math.max(0, Math.min(W - 1, b.x));
      b.vx = -b.vx * 0.5;
    }
    if (b.y < 0 || b.y > H - 1) {
      b.y = Math.max(0, Math.min(H - 1, b.y));
      b.vy = -b.vy * 0.5;
    }
  }
}

export function drawMurmuration(s, f) {
  const { W, H, pal, k } = f;
  const live = 0.6 + 0.4 * s.glow;
  const { birds } = flock(s, W, H);
  const fresh = s.confirmAge < CONFIRM_TIME ? 1 - s.confirmAge / CONFIRM_TIME : 0;
  const think = s.mode === "thinking";

  // A sunset: warm low, violet high; it warms further when a turn completes.
  const sky = (y) => {
    const t = H === 1 ? 0.5 : y / (H - 1);
    const low = think ? mix(SKY_MID, pal.b, 0.5) : SKY_LOW;
    return t > 0.55 ? mix(SKY_MID, low, (t - 0.55) / 0.45) : mix(SKY_TOP, SKY_MID, t / 0.55);
  };
  for (let y = 0; y < H; y += 1) {
    const color = s.flare > 0 ? mix(sky(y), pal.bad, s.flare * 0.7) : sky(y);
    const a = (0.62 + 0.3 * (y / H) + 0.1 * fresh) * live * (0.85 + 0.2 * k);
    for (let x = 0; x < W; x += 1) {
      const sun = Math.exp(-(((x - W * 0.82) / (W * 0.12)) ** 2) - (((y - H) / (H * 0.6)) ** 2));
      f.dot(x, y, mix(pal.bg, mix(color, 0xffd27a, sun * 0.6), clamp01(a + sun * 0.25)));
    }
  }

  // The birds: dark points; denser spots read darker.
  for (const b of birds) {
    const x = Math.round(b.x);
    const y = Math.round(b.y);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    // One speck per bird, dark against the sky.
    f.dot(x, y, mix(sky(y), BIRD, 0.88));
  }
}
