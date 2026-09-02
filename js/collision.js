/**
 * Physics / collision world.
 *
 * Deliberately analytic rather than mesh-based: the world is described as a
 * terrain heightfield plus a list of axis-aligned boxes kept in a uniform
 * spatial hash. That makes both character sweeping and the grapple raycast
 * O(few) instead of O(triangles), which is what lets the map stay large while
 * several networked players are simulating at once.
 */

import { CFG } from './config.js?v=v33';
import { clamp } from './util.js?v=v33';

const EPS = 1e-4;

export class Terrain {
  /**
   * @param {number} size  world extent (world spans -size/2..size/2)
   * @param {number} grid  samples per axis
   * @param {(x:number,z:number)=>number} fn height function in world space
   */
  constructor(size, grid, fn) {
    this.size = size;
    this.grid = grid;
    this.half = size / 2;
    this.cell = size / (grid - 1);
    this.heights = new Float32Array(grid * grid);
    for (let j = 0; j < grid; j++) {
      for (let i = 0; i < grid; i++) {
        const x = -this.half + i * this.cell;
        const z = -this.half + j * this.cell;
        this.heights[j * grid + i] = fn(x, z);
      }
    }
  }

  /** Bilinearly interpolated ground height at a world position. */
  heightAt(x, z) {
    const g = this.grid;
    const fx = clamp((x + this.half) / this.cell, 0, g - 1.001);
    const fz = clamp((z + this.half) / this.cell, 0, g - 1.001);
    const i = fx | 0, j = fz | 0;
    const tx = fx - i, tz = fz - j;
    const h = this.heights;
    const a = h[j * g + i];
    const b = h[j * g + i + 1];
    const c = h[(j + 1) * g + i];
    const d = h[(j + 1) * g + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  /** Surface normal via central differences. Used for slopes and slide dirs. */
  normalAt(x, z, out) {
    const e = this.cell * 0.75;
    const hL = this.heightAt(x - e, z), hR = this.heightAt(x + e, z);
    const hD = this.heightAt(x, z - e), hU = this.heightAt(x, z + e);
    const nx = hL - hR, ny = 2 * e, nz = hD - hU;
    const len = Math.hypot(nx, ny, nz) || 1;
    out.x = nx / len; out.y = ny / len; out.z = nz / len;
    return out;
  }

  /** Steepness in [0,1] where 0 is flat and 1 is a vertical face. */
  slopeAt(x, z) {
    const e = this.cell * 0.75;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.min(1, Math.hypot(dx, dz) / 3);
  }
}

/** A solid axis-aligned box. `tag` lets gameplay treat surfaces differently. */
class Box {
  constructor(minX, minY, minZ, maxX, maxY, maxZ, tag) {
    this.minX = minX; this.minY = minY; this.minZ = minZ;
    this.maxX = maxX; this.maxY = maxY; this.maxZ = maxZ;
    this.tag = tag || 'solid';
    // Two switches used by the story's barred cell door:
    //   disabled       — ignored entirely (an opened door)
    //   rayTransparent — blocks bodies but not rays, so you can see and
    //                    reach a tongue through a portcullis
    this.disabled = false;
    this.rayTransparent = false;
  }
}

export class CollisionWorld {
  constructor(terrain) {
    this.terrain = terrain;
    this.boxes = [];
    this.anchors = [];          // floating grapple targets (spheres)
    this.cellSize = 14;
    this.hash = new Map();
    this._n = { x: 0, y: 0, z: 0 };
    // Starts at 1 so the "already visited this query" mark can never collide
    // with a freshly-created box's undefined `_mark`.
    this._queryId = 1;
  }

  // ------------------------------------------------------------- authoring

  /** Add a box from centre + half-extents (the form most builders produce). */
  addBox(cx, cy, cz, hx, hy, hz, tag) {
    const b = new Box(cx - hx, cy - hy, cz - hz, cx + hx, cy + hy, cz + hz, tag);
    this.boxes.push(b);
    return b;
  }

  /** A floating, always-grappleable point (lanterns, rings, banners). */
  addAnchor(x, y, z, radius = 1.6) {
    this.anchors.push({ x, y, z, r: radius });
  }

  _key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }

  /** Build the broadphase. Call once after all boxes are added. */
  bake() {
    this.hash.clear();
    const cs = this.cellSize;
    for (let n = 0; n < this.boxes.length; n++) {
      const b = this.boxes[n];
      const x0 = Math.floor(b.minX / cs), x1 = Math.floor(b.maxX / cs);
      const z0 = Math.floor(b.minZ / cs), z1 = Math.floor(b.maxZ / cs);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const k = this._key(ix, iz);
          let arr = this.hash.get(k);
          if (!arr) { arr = []; this.hash.set(k, arr); }
          arr.push(b);
        }
      }
    }
  }

  // ------------------------------------------------------------- broadphase

  /** Collect boxes overlapping a world-space AABB into `out`. */
  query(minX, minZ, maxX, maxZ, out) {
    out.length = 0;
    const cs = this.cellSize;
    const x0 = Math.floor(minX / cs), x1 = Math.floor(maxX / cs);
    const z0 = Math.floor(minZ / cs), z1 = Math.floor(maxZ / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.hash.get(this._key(ix, iz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const b = arr[i];
          if (b.disabled) continue;
          if (b._mark === this._queryId) continue;
          b._mark = this._queryId;
          out.push(b);
        }
      }
    }
    this._queryId = (this._queryId || 0) + 1;
    return out;
  }

  // -------------------------------------------------------------- character

  /**
   * Sweep the player's vertical cylinder through the world and resolve
   * penetration axis-by-axis. Axis separation keeps the resolution stable and
   * makes ceilings, walls and step-ups easy to reason about individually.
   *
   * `state` is mutated in place: { pos, vel, grounded, groundTag, wallNormal,
   * onWall, hitCeiling, landedThisFrame }.
   */
  moveCharacter(state, dt) {
    const r = CFG.move.radius;
    const h = CFG.move.height;
    const step = CFG.move.stepHeight;
    const pos = state.pos, vel = state.vel;

    const wasGrounded = state.grounded;
    state.grounded = false;
    state.onWall = false;
    state.hitCeiling = false;
    state.landedThisFrame = false;
    state.bounce = false;
    state.wallNormal.set(0, 0, 0);
    state.groundTag = 'terrain';

    const cand = this._cand || (this._cand = []);

    // ---- escape any existing overlap ------------------------------------
    // Without this, a player who ends up inside geometry (spawned there,
    // knocked in, or wedged in a corner where both axes resolve against each
    // other) has every axis blocked and can never move again.
    this._depenetrate(pos, r, h, step, cand);

    // ---- vertical -------------------------------------------------------
    let dy = vel.y * dt;
    // Clamp per-step movement so we can never tunnel through thin platforms.
    dy = clamp(dy, -2.4, 2.4);
    pos.y += dy;

    this.query(pos.x - r - 1, pos.z - r - 1, pos.x + r + 1, pos.z + r + 1, cand);

    for (let i = 0; i < cand.length; i++) {
      const b = cand[i];
      if (pos.x + r <= b.minX || pos.x - r >= b.maxX) continue;
      if (pos.z + r <= b.minZ || pos.z - r >= b.maxZ) continue;
      if (pos.y >= b.maxY || pos.y + h <= b.minY) continue;

      if (dy <= 0 && pos.y > b.maxY - 0.6) {
        // Landing on top of the box.
        pos.y = b.maxY;
        if (vel.y < 0) vel.y = 0;
        state.grounded = true;
        state.groundTag = b.tag;
      } else if (dy > 0) {
        // Bonked the underside.
        pos.y = b.minY - h;
        if (vel.y > 0) vel.y = 0;
        state.hitCeiling = true;
      }
    }

    // Terrain floor.
    const th = this.terrain.heightAt(pos.x, pos.z);
    if (pos.y <= th) {
      pos.y = th;
      if (vel.y < 0) vel.y = 0;
      state.grounded = true;
      state.groundTag = 'terrain';
    }

    if (state.grounded && !wasGrounded) state.landedThisFrame = true;

    // ---- horizontal -----------------------------------------------------
    // Sub-step so fast dashes still collide reliably.
    const dx = vel.x * dt, dz = vel.z * dt;
    const dist = Math.hypot(dx, dz);
    const steps = Math.min(6, Math.max(1, Math.ceil(dist / (r * 0.8))));
    const sx = dx / steps, sz = dz / steps;

    for (let s = 0; s < steps; s++) {
      this._moveAxis(state, sx, 0, r, h, step, cand);
      this._moveAxis(state, 0, sz, r, h, step, cand);
    }

    return state;
  }

  /** Move on a single horizontal axis and push back out of anything hit. */
  _moveAxis(state, dx, dz, r, h, step, cand) {
    if (dx === 0 && dz === 0) return;
    const pos = state.pos, vel = state.vel;
    const oldX = pos.x, oldZ = pos.z;
    pos.x += dx; pos.z += dz;

    this.query(pos.x - r - 1, pos.z - r - 1, pos.x + r + 1, pos.z + r + 1, cand);

    for (let i = 0; i < cand.length; i++) {
      const b = cand[i];
      if (pos.x + r <= b.minX || pos.x - r >= b.maxX) continue;
      if (pos.z + r <= b.minZ || pos.z - r >= b.maxZ) continue;
      if (pos.y >= b.maxY - EPS || pos.y + h <= b.minY) continue;

      // Small ledge we can just walk up onto.
      const rise = b.maxY - pos.y;
      if (rise > 0 && rise <= step && this._headroom(b.maxY, pos, r, h, cand)) {
        pos.y = b.maxY;
        state.grounded = true;
        state.groundTag = b.tag;
        continue;
      }

      // Otherwise it's a wall: revert this axis and record the surface normal.
      if (dx !== 0) {
        pos.x = oldX;
        state.wallNormal.x = dx > 0 ? -1 : 1;
        state.wallNormal.z = 0;
        vel.x = 0;
      } else {
        pos.z = oldZ;
        state.wallNormal.z = dz > 0 ? -1 : 1;
        state.wallNormal.x = 0;
        vel.z = 0;
      }
      state.onWall = true;
      state.wallTag = b.tag;
      return;
    }

    // Terrain acts as a wall wherever it rises faster than we can step.
    const th = this.terrain.heightAt(pos.x, pos.z);
    if (th > pos.y + step) {
      pos.x = oldX; pos.z = oldZ;
      const n = this.terrain.normalAt(oldX + dx * 2, oldZ + dz * 2, this._n);
      const len = Math.hypot(n.x, n.z) || 1;
      const nx = n.x / len, nz = n.z / len;

      // A true cliff face offers no purchase. Flagging it as `bounce` rather
      // than as a wall is what stops players wall-jumping their way up the
      // mountains — there is nothing to kick off.
      if (this.terrain.slopeAt(oldX + dx * 2, oldZ + dz * 2) > CFG.grapple.noGrappleSlope) {
        state.bounce = true;
        state.bounceX = nx;
        state.bounceZ = nz;
      } else {
        state.wallNormal.x = nx;
        state.wallNormal.z = nz;
        state.onWall = true;
        state.wallTag = 'terrain';
      }
      if (dx !== 0) vel.x = 0; else vel.z = 0;
    } else if (th > pos.y) {
      pos.y = th;                 // walk up the slope
      state.grounded = true;
      state.groundTag = 'terrain';
    }
  }

  /**
   * Push the player out of anything they are currently inside.
   *
   * Resolves along whichever axis needs the least correction, preferring to
   * lift the player onto a box top when that is the cheapest escape. Runs a
   * few iterations because freeing one overlap can reveal another.
   */
  _depenetrate(pos, r, h, step, cand) {
    for (let iter = 0; iter < 4; iter++) {
      this.query(pos.x - r - 1, pos.z - r - 1, pos.x + r + 1, pos.z + r + 1, cand);
      let bestBox = null;
      let bestDepth = Infinity;
      let bestAxis = 0;      // 0:-x 1:+x 2:-z 3:+z 4:up

      for (let i = 0; i < cand.length; i++) {
        const b = cand[i];
        if (pos.x + r <= b.minX || pos.x - r >= b.maxX) continue;
        if (pos.z + r <= b.minZ || pos.z - r >= b.maxZ) continue;
        if (pos.y >= b.maxY - EPS || pos.y + h <= b.minY) continue;

        // Penetration depth on each escape direction.
        const dxNeg = (pos.x + r) - b.minX;   // push toward -X
        const dxPos = b.maxX - (pos.x - r);   // push toward +X
        const dzNeg = (pos.z + r) - b.minZ;
        const dzPos = b.maxZ - (pos.z - r);
        const dUp = b.maxY - pos.y;           // lift onto the top face

        let d = dxNeg, axis = 0;
        if (dxPos < d) { d = dxPos; axis = 1; }
        if (dzNeg < d) { d = dzNeg; axis = 2; }
        if (dzPos < d) { d = dzPos; axis = 3; }
        // Standing up onto a low surface is almost always the nicest escape,
        // so it wins ties generously rather than only on strict depth.
        if (dUp <= step && dUp < d * 1.6) { d = dUp; axis = 4; }

        if (d < bestDepth) { bestDepth = d; bestBox = b; bestAxis = axis; }
      }

      if (!bestBox) return;
      const push = bestDepth + EPS * 4;
      if (bestAxis === 0) pos.x -= push;
      else if (bestAxis === 1) pos.x += push;
      else if (bestAxis === 2) pos.z -= push;
      else if (bestAxis === 3) pos.z += push;
      else pos.y += push;
    }
  }

  /** Is there room for the player to stand with their feet at `y`? */
  _headroom(y, pos, r, h, cand) {
    for (let i = 0; i < cand.length; i++) {
      const b = cand[i];
      if (pos.x + r <= b.minX || pos.x - r >= b.maxX) continue;
      if (pos.z + r <= b.minZ || pos.z - r >= b.maxZ) continue;
      if (y + h > b.minY && y + EPS < b.maxY) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- raycast

  /**
   * Cast a ray against boxes, floating anchors and the terrain.
   * Returns null or { x, y, z, nx, ny, nz, dist, tag, anchor }.
   * This is what the tongue grapple aims with.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist;
    let hit = null;

    // --- floating anchors get a generous radius so they're easy to catch ---
    for (let i = 0; i < this.anchors.length; i++) {
      const a = this.anchors[i];
      const mx = a.x - ox, my = a.y - oy, mz = a.z - oz;
      const proj = mx * dx + my * dy + mz * dz;
      if (proj < 0 || proj > best) continue;
      const perp2 = (mx * mx + my * my + mz * mz) - proj * proj;
      if (perp2 > a.r * a.r) continue;
      const t = proj - Math.sqrt(Math.max(0, a.r * a.r - perp2));
      if (t < 0 || t > best) continue;
      best = t;
      hit = {
        x: ox + dx * t, y: oy + dy * t, z: oz + dz * t,
        nx: 0, ny: 1, nz: 0, dist: t, tag: 'anchor', anchor: a,
      };
    }

    // --- boxes, via a 2D DDA walk over the broadphase grid ---
    const cs = this.cellSize;
    let ix = Math.floor(ox / cs), iz = Math.floor(oz / cs);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dx) < 1e-6 ? Infinity : Math.abs(cs / dx);
    const tDeltaZ = Math.abs(dz) < 1e-6 ? Infinity : Math.abs(cs / dz);
    let tMaxX = Math.abs(dx) < 1e-6 ? Infinity
      : (((dx > 0 ? ix + 1 : ix) * cs) - ox) / dx;
    let tMaxZ = Math.abs(dz) < 1e-6 ? Infinity
      : (((dz > 0 ? iz + 1 : iz) * cs) - oz) / dz;

    let travelled = 0;
    let guard = 0;
    const seen = this._raySeen || (this._raySeen = new Set());
    seen.clear();

    while (travelled <= best && guard++ < 256) {
      const arr = this.hash.get(this._key(ix, iz));
      if (arr) {
        for (let i = 0; i < arr.length; i++) {
          const b = arr[i];
          if (b.disabled || b.rayTransparent) continue;
          if (seen.has(b)) continue;
          seen.add(b);
          const t = rayBox(ox, oy, oz, dx, dy, dz, b, best);
          if (t && t.t < best) {
            best = t.t;
            hit = {
              x: ox + dx * t.t, y: oy + dy * t.t, z: oz + dz * t.t,
              nx: t.nx, ny: t.ny, nz: t.nz, dist: t.t, tag: b.tag, anchor: null,
            };
          }
        }
      }
      if (tMaxX < tMaxZ) { travelled = tMaxX; ix += stepX; tMaxX += tDeltaX; }
      else { travelled = tMaxZ; iz += stepZ; tMaxZ += tDeltaZ; }
    }

    // --- terrain: march forward, then bisect the crossing for accuracy ---
    const marchStep = 0.75;
    let prevT = 0;
    let prevAbove = (oy - this.terrain.heightAt(ox, oz));
    for (let t = marchStep; t <= best; t += marchStep) {
      const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
      const above = py - this.terrain.heightAt(px, pz);
      if (above <= 0 && prevAbove > 0) {
        let lo = prevT, hi = t;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) * 0.5;
          const mx = ox + dx * mid, my = oy + dy * mid, mz = oz + dz * mid;
          if (my - this.terrain.heightAt(mx, mz) > 0) lo = mid; else hi = mid;
        }
        if (hi < best) {
          const px2 = ox + dx * hi, py2 = oy + dy * hi, pz2 = oz + dz * hi;
          const n = this.terrain.normalAt(px2, pz2, this._n);
          best = hi;
          hit = { x: px2, y: py2, z: pz2, nx: n.x, ny: n.y, nz: n.z, dist: hi, tag: 'terrain', anchor: null };
        }
        break;
      }
      prevAbove = above; prevT = t;
    }

    return hit;
  }

  /** Ground height including box tops — used for shadows and spawn placement. */
  groundHeight(x, z, from = 200) {
    const hit = this.raycast(x, from, z, 0, -1, 0, from + 60);
    return hit ? hit.y : this.terrain.heightAt(x, z);
  }
}

/** Slab-method ray/AABB. Returns { t, nx, ny, nz } or null. */
function rayBox(ox, oy, oz, dx, dy, dz, b, maxT) {
  let tmin = 0, tmax = maxT;
  let nx = 0, ny = 0, nz = 0;
  let axis = -1, sign = 1;

  // X slab
  if (Math.abs(dx) < 1e-8) { if (ox < b.minX || ox > b.maxX) return null; }
  else {
    const inv = 1 / dx;
    let t1 = (b.minX - ox) * inv, t2 = (b.maxX - ox) * inv;
    let s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // Y slab
  if (Math.abs(dy) < 1e-8) { if (oy < b.minY || oy > b.maxY) return null; }
  else {
    const inv = 1 / dy;
    let t1 = (b.minY - oy) * inv, t2 = (b.maxY - oy) * inv;
    let s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // Z slab
  if (Math.abs(dz) < 1e-8) { if (oz < b.minZ || oz > b.maxZ) return null; }
  else {
    const inv = 1 / dz;
    let t1 = (b.minZ - oz) * inv, t2 = (b.maxZ - oz) * inv;
    let s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 2; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  if (tmin <= 0 || tmin > maxT) return null;
  if (axis === 0) nx = sign; else if (axis === 1) ny = sign; else nz = sign;
  return { t: tmin, nx, ny, nz };
}
