// The sky outside, after sunset: blue-violet overhead, salmon-pink streaks of high cloud, pale
// blue to cream to peach towards the horizon, and a sea of cloud below. Shared by the opening
// (through the window) and the board, so the two match when the window opens. Clouds are built
// from shaded "puff" sprites so they have a lit side, a shaded side and a lumpy edge.

type Rgb = [number, number, number];

const mix = (a: Rgb, b: Rgb, t: number) => a.map((value, i) => Math.round(value + (b[i] - value) * t)) as Rgb;
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (from: number, to: number, value: number) => {
  const t = clamp((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};

function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

// Fractal value noise; a cellsX × cellsY lattice for the first octave, wrapping horizontally.
function noise(seed: number, base: [number, number], octaves: number) {
  const next = random(seed);
  const layers = Array.from({ length: octaves }, (_, i) => {
    const cx = base[0] * 2 ** i;
    const cy = base[1] * 2 ** i;
    return { cx, cy, values: Array.from({ length: cx * (cy + 1) }, next) };
  });
  return (u: number, v: number) => {
    let value = 0;
    let weight = 1;
    let total = 0;
    for (const o of layers) {
      const x = u * o.cx;
      const y = Math.min(o.cy - 1e-6, Math.max(0, v * o.cy));
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const at = (i: number, j: number) => o.values[j * o.cx + (((i % o.cx) + o.cx) % o.cx)];
      const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      value += (top + (bottom - top) * sy) * weight;
      total += weight;
      weight *= 0.55;
    }
    return value / total;
  };
}

// Textures are the same on every load; build each once and share it between the cover and the board.
const cache = new Map<string, unknown>();
function once<T>(key: string, build: () => T): T {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key) as T;
}

function canvas(width: number, height: number) {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return element;
}

// ---------------------------------------------------------------------------------------------
// Sky

const horizon = 0.86; // where the sea of cloud begins, as a fraction of the height

export function paintSky(context: CanvasRenderingContext2D, seconds: number) {
  const { width: w, height: h } = context.canvas;
  const sky = context.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#5059a0');
  sky.addColorStop(0.2, '#5e66ab');
  sky.addColorStop(0.42, '#7a7fbb');
  sky.addColorStop(0.6, '#a0b2d9');
  sky.addColorStop(0.72, '#c6d6e6');
  sky.addColorStop(0.79, '#efe6c6');
  sky.addColorStop(horizon, '#f6c48e');
  sky.addColorStop(1, '#eea87a');
  context.fillStyle = sky;
  context.fillRect(0, 0, w, h);
  // The afterglow breathes slowly over a 48 s cycle.
  const breath = 0.5 + 0.5 * Math.sin((seconds / 48) * Math.PI * 2);
  const glow = context.createRadialGradient(w * 0.55, h * horizon, 0, w * 0.55, h * horizon, w * 0.7);
  glow.addColorStop(0, `rgb(255 196 140 / ${0.22 + 0.16 * breath})`);
  glow.addColorStop(1, 'rgb(255 196 140 / 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, w, h);
}

export interface Star { x: number; y: number; size: number; phase: number; rate: number }

export function makeStars(count: number, seed = 5): Star[] {
  const next = random(seed);
  return Array.from({ length: count }, () => ({
    x: next(),
    y: next() ** 2 * 0.3,
    size: 0.3 + next() ** 3 * 0.7,
    phase: next() * Math.PI * 2,
    rate: 0.4 + next() * 1.2,
  }));
}

// Only just there, high up where the sky is darkest.
export function paintStars(context: CanvasRenderingContext2D, stars: Star[], seconds: number, strength = 1) {
  const { width: w, height: h } = context.canvas;
  context.fillStyle = '#f6f2ea';
  for (const star of stars) {
    const twinkle = 0.6 + 0.4 * Math.sin(seconds * star.rate + star.phase);
    context.globalAlpha = strength * 0.45 * twinkle * (1 - star.y / 0.3);
    context.beginPath();
    context.arc(star.x * w, star.y * h, star.size, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
}

// ---------------------------------------------------------------------------------------------
// High streaks: noise stretched along one direction, lit salmon-pink with paler cores.

const streakSize = [1024, 256] as const;

export function cirrusTexture(seed: number): HTMLCanvasElement {
  const [tw, th] = streakSize;
  const sample = noise(seed, [3, 10], 5);
  const element = canvas(tw, th);
  const context = element.getContext('2d');
  if (!context) return element;
  const image = context.createImageData(tw, th);
  const shade: Rgb = [150, 128, 186];
  const lit: Rgb = [246, 140, 122];
  const core: Rgb = [255, 190, 166];
  for (let y = 0; y < th; y += 1) {
    const v = y / th;
    const band = Math.sin(Math.PI * v) ** 1.2;
    for (let x = 0; x < tw; x += 1) {
      const value = sample(x / tw, v) * band;
      const density = smooth(0.34, 0.62, value);
      if (density <= 0) continue;
      const colour = density < 0.6 ? mix(shade, lit, density / 0.6) : mix(lit, core, (density - 0.6) / 0.4);
      const index = (y * tw + x) * 4;
      image.data[index] = colour[0];
      image.data[index + 1] = colour[1];
      image.data[index + 2] = colour[2];
      image.data[index + 3] = density ** 1.4 * 220;
    }
  }
  context.putImageData(image, 0, 0);
  return element;
}

export interface Streak { pattern: CanvasPattern | null; centre: number; height: number; angle: number; speed: number }

export function makeStreaks(context: CanvasRenderingContext2D): Streak[] {
  return [
    { seed: 13, centre: 0.3, height: 0.42, angle: 0.2, speed: 3 },
    { seed: 31, centre: 0.55, height: 0.34, angle: 0.15, speed: 5 },
  ].map((streak) => ({
    ...streak,
    pattern: context.createPattern(once(`cirrus:${streak.seed}`, () => cirrusTexture(streak.seed)), 'repeat-x'),
  }));
}

export function paintStreaks(context: CanvasRenderingContext2D, streaks: Streak[], seconds: number, alpha = 1) {
  const { width: w, height: h } = context.canvas;
  const [tw, th] = streakSize;
  for (const streak of streaks) {
    if (!streak.pattern) continue;
    const k = (h * streak.height) / th;
    const shift = (seconds * streak.speed * (h / 400)) / k;
    context.globalAlpha = alpha;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.translate(w / 2, h * streak.centre);
    context.rotate(streak.angle);
    context.scale(k, k);
    context.translate(-(shift % tw), -th / 2);
    context.fillStyle = streak.pattern;
    const span = (w * 1.6) / k;
    context.fillRect(-span, 0, span * 2 + tw, th);
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
}

// ---------------------------------------------------------------------------------------------
// Puffs: one shaded lump of cloud. Many overlapping puffs make a cloud with volume.

export interface PuffColours { lit: Rgb; shade: Rgb }

// Low sun from the front left: the faces towards us and the horizon are lit pink, the far sides
// and bases fall into lavender shade.
export function puffSprite(seed: number, colours: PuffColours, size = 128): HTMLCanvasElement {
  const element = canvas(size, size);
  const context = element.getContext('2d');
  if (!context) return element;
  const sample = noise(seed, [4, 4], 4);
  const image = context.createImageData(size, size);
  const light = [-0.42, 0.18, 0.89];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      const r = Math.hypot(dx, dy);
      const n = sample(x / size, y / size);
      // A lumpy outline, flatter at the base like cumulus.
      // The second factor keeps the sprite fully clear at its square border.
      const edge = (1 - smooth(0.5, 0.98, r + (n - 0.5) * 0.5 + Math.max(0, dy) * 0.18)) * (1 - smooth(0.82, 0.99, r));
      if (edge <= 0) continue;
      const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, r) ** 2));
      const lambert = Math.max(0, dx * light[0] + dy * light[1] + nz * light[2]);
      const shade = clamp(0.12 + lambert * 0.8 + (n - 0.5) * 0.5 - Math.max(0, dy) * 0.25);
      const colour = mix(colours.shade, colours.lit, shade);
      const index = (y * size + x) * 4;
      image.data[index] = colour[0];
      image.data[index + 1] = colour[1];
      image.data[index + 2] = colour[2];
      image.data[index + 3] = edge * 255;
    }
  }
  context.putImageData(image, 0, 0);
  return element;
}

// Distance tiers for the sea: far puffs melt into the horizon haze, near ones show contrast.
const seaTiers: PuffColours[] = [
  { lit: [248, 206, 176], shade: [196, 176, 196] },
  { lit: [246, 184, 160], shade: [150, 140, 182] },
  { lit: [240, 166, 150], shade: [112, 110, 160] },
];
export const cumulusColours: PuffColours = { lit: [252, 202, 184], shade: [112, 108, 168] };

export function makePuffs(colours: PuffColours, seed: number, count = 4) {
  return once(`puffs:${seed}:${colours.lit}:${colours.shade}:${count}`,
    () => Array.from({ length: count }, (_, i) => puffSprite(seed + i * 7, colours)));
}

// ---------------------------------------------------------------------------------------------
// The sea of cloud: rows of puffs from the horizon down, nearer rows bigger and faster.

interface SeaPuff { x: number; dy: number; r: number; sprite: number }
interface SeaRow { t: number; puffs: SeaPuff[]; period: number }
export interface Sea { rows: SeaRow[]; sprites: HTMLCanvasElement[][] }

export function makeSea(seed = 2, rowCount = 8): Sea {
  return once(`sea:${seed}:${rowCount}`, () => buildSea(seed, rowCount));
}

function buildSea(seed: number, rowCount: number): Sea {
  const next = random(seed);
  const rows = Array.from({ length: rowCount }, (_, i) => {
    const puffs: SeaPuff[] = [];
    let x = 0;
    for (let j = 0; j < 70; j += 1) {
      const r = 0.7 + next() * 0.7;
      puffs.push({ x, dy: (next() - 0.5) * 0.5, r, sprite: Math.floor(next() * 4) });
      x += 0.75 + next() * 0.6;
    }
    return { t: i / (rowCount - 1), puffs, period: x };
  });
  return { rows, sprites: seaTiers.map((tier, i) => makePuffs(tier, 100 + i * 17)) };
}

// Draws the rows whose depth t lies in [from, to); the board splits the sea around the stubs.
export function paintSea(context: CanvasRenderingContext2D, sea: Sea, seconds: number, from = 0, to = 1.01, alpha = 1) {
  const { width: w, height: h } = context.canvas;
  const top = h * horizon;
  context.globalAlpha = alpha;
  for (const row of sea.rows) {
    if (row.t < from || row.t >= to) continue;
    const y = top + (h * 1.04 - top) * row.t ** 1.25;
    const unit = h * (0.012 + 0.07 * row.t ** 1.6);
    const tier = row.t < 0.3 ? 0 : row.t < 0.65 ? 1 : 2;
    const sprites = sea.sprites[tier];
    // Solid cloud below each row, so no gaps open between the rows.
    const base = mix(seaTiers[tier].shade, seaTiers[tier].lit, 0.35);
    const fill = context.createLinearGradient(0, y - unit * 0.1, 0, y + unit * 0.6);
    fill.addColorStop(0, `rgb(${base.join(' ')} / 0)`);
    fill.addColorStop(1, `rgb(${base.join(' ')})`);
    context.fillStyle = fill;
    context.fillRect(0, y - unit * 0.1, w, h - y + unit * 0.1);
    const period = row.period * unit;
    const shift = (seconds * (2 + 20 * row.t) * (h / 400)) % period;
    for (let copy = -1; copy * period < w + period; copy += 1) {
      for (const puff of row.puffs) {
        const x = puff.x * unit + copy * period - shift;
        const r = puff.r * unit * 1.25;
        if (x + r < 0 || x - r > w) continue;
        context.drawImage(sprites[puff.sprite], x - r, y + puff.dy * unit - r, r * 2, r * 2);
      }
    }
  }
  context.globalAlpha = 1;
}

// ---------------------------------------------------------------------------------------------
// Cumulus seen from the window: clusters of puffs placed in depth. The camera drifts sideways
// while the window is closed and flies forward through them as it opens.

interface FieldPuff { x: number; y: number; z: number; r: number; sprite: number }
export interface Field { puffs: FieldPuff[]; sprites: HTMLCanvasElement[] }

const fieldWidth = 9;

export function makeField(seed = 9): Field {
  return once(`field:${seed}`, () => buildField(seed));
}

function buildField(seed: number): Field {
  const next = random(seed);
  const puffs: FieldPuff[] = [];
  for (let c = 0; c < 30; c += 1) {
    const cx = (next() - 0.5) * fieldWidth;
    const cy = -0.5 + next() * 0.75;
    const cz = 1.6 + next() * 12;
    const scale = 0.5 + next() * 0.9;
    const count = 7 + Math.floor(next() * 6);
    for (let i = 0; i < count; i += 1) {
      const spread = next() - 0.5;
      puffs.push({
        x: cx + spread * 1.4 * scale,
        // Heaped in the middle, flat along the base.
        y: cy - (1 - Math.abs(spread) * 1.6) * next() * 0.45 * scale,
        z: cz + (next() - 0.5) * 0.6 * scale,
        r: (0.22 + next() * 0.22) * scale,
        sprite: Math.floor(next() * 4),
      });
    }
  }
  // Far to near, so nearer puffs paint over farther ones.
  puffs.sort((a, b) => b.z - a.z);
  return { puffs, sprites: makePuffs(cumulusColours, 50) };
}

export function paintField(context: CanvasRenderingContext2D, field: Field, seconds: number, forward: number, alpha = 1) {
  const { width: w, height: h } = context.canvas;
  const focal = h * 0.9;
  const camX = seconds * 0.06;
  for (const puff of field.puffs) {
    const depth = puff.z - forward;
    if (depth < 0.12) continue;
    const near = smooth(0.12, 0.7, depth);
    const far = 1 - smooth(9, 14, depth) * 0.7;
    const a = alpha * near * far;
    if (a <= 0.01) continue;
    const x = ((((puff.x - camX) % fieldWidth) + fieldWidth * 1.5) % fieldWidth) - fieldWidth / 2;
    const scale = focal / depth;
    const r = puff.r * scale;
    const sx = w / 2 + x * scale;
    const sy = h * 0.46 + puff.y * scale;
    if (sx + r < 0 || sx - r > w || sy + r < 0 || sy - r > h) continue;
    context.globalAlpha = a;
    context.drawImage(field.sprites[puff.sprite], sx - r, sy - r, r * 2, r * 2);
  }
  context.globalAlpha = 1;
}
