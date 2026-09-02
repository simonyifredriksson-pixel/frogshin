/**
 * Small shared helpers: seeded RNG, value noise, easing and math utilities.
 * The RNG is seeded so that every client builds a byte-identical world.
 */

/** Fast, deterministic 32-bit PRNG. Same seed => same sequence everywhere. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const invLerp = (a, b, v) => (b - a === 0 ? 0 : (v - a) / (b - a));

/** Frame-rate independent exponential smoothing. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/** Shortest signed angular difference, wrapped to [-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function dampAngle(a, b, lambda, dt) {
  return a + angleDelta(a, b) * (1 - Math.exp(-lambda * dt));
}

/**
 * The gameplay yaw that makes something at (fx,fz) LOOK AT (tx,tz).
 *
 * Read this before writing any facing code. Every rig in the game is modelled
 * facing +Z and every setFacing() adds a half turn, so a gameplay yaw of 0
 * points along -Z (see FrogModel.setFacing). The consequence is unintuitive:
 *
 *     Math.atan2(tx - fx, tz - fz)      // the direction TO the target
 *
 * is NOT a yaw that looks at the target — used as one it turns the model
 * around and points it directly away. The two arguments have to be
 * subtracted the other way round, which is all this helper does.
 *
 * It exists because that mistake had been made independently in all three
 * boss files, which left every boss in the game fighting with its back to
 * the player.
 */
export function lookYaw(fx, fz, tx, tz) {
  return Math.atan2(fx - tx, fz - tz);
}

/** The yaw that turns a model's BACK to (tx,tz) — the opposite of lookYaw. */
export function awayYaw(fx, fz, tx, tz) {
  return Math.atan2(tx - fx, tz - fz);
}

// ------------------------------------------------------------------ noise

/**
 * Seeded 2D value noise with smooth interpolation.
 * Cheap enough to sample tens of thousands of times at load, and fully
 * deterministic which is what the shared multiplayer map depends on.
 */
export class ValueNoise {
  constructor(seed = 1) {
    const rnd = mulberry32(seed);
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    this.grad = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.grad[i] = rnd() * 2 - 1;
  }

  /** Raw noise in [-1, 1]. */
  noise2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smoothstep(xf), v = smoothstep(yf);
    const X = xi & 255, Y = yi & 255;
    const a = this.grad[this.perm[(X + this.perm[Y & 255]) & 255]];
    const b = this.grad[this.perm[(X + 1 + this.perm[Y & 255]) & 255]];
    const c = this.grad[this.perm[(X + this.perm[(Y + 1) & 255]) & 255]];
    const d = this.grad[this.perm[(X + 1 + this.perm[(Y + 1) & 255]) & 255]];
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }

  /** Fractal brownian motion — layered noise for natural-looking terrain. */
  fbm(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise2(x * freq, y * freq);
      norm += amp;
      amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged noise — produces sharp mountain crests instead of rolling hills. */
  ridged(x, y, octaves = 4) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.noise2(x * freq, y * freq));
      sum += amp * n * n;
      norm += amp;
      amp *= 0.5; freq *= 2.05;
    }
    return sum / norm;
  }
}

// ----------------------------------------------------------------- misc

let _uid = 0;
export const uid = () => `${Date.now().toString(36)}-${(_uid++).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

/** Short, human-typeable room code (unambiguous character set). */
export function roomCode(len = 4) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

/** Pick a random element. */
export const pick = (arr, rnd = Math.random) => arr[Math.floor(rnd() * arr.length) % arr.length];
