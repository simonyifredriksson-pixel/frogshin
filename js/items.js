/**
 * Items: the hotbar inventory, thrown kunai, and the kunai pickup crates.
 *
 * Networking split:
 *   - Throws are broadcast as events so every client sees the projectile,
 *     but only the thrower runs hit detection (attacker-detects, same model
 *     as the katana). Remote kunai are visual-only.
 *   - Crates are owned by one authority (the host, or the local player when
 *     offline). It picks spawn points, runs the 30s cycle, and rebroadcasts
 *     the set periodically so late joiners converge without special-casing.
 */

import * as THREE from '../lib/three.module.js?v=v49';
import { CFG } from './config.js?v=v49';
import { clamp } from './util.js?v=v49';

const _v = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _aim = new THREE.Vector3();

// --------------------------------------------------------------- hotbar

/** Six slots, mapped to the number row as 1 2 3 4 5 0. */
export const SLOT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit0'];
export const SLOT_LABELS = ['1', '2', '3', '4', '5', '0'];

export const ITEMS = {
  katana: { id: 'katana', name: 'Katana', infinite: true },
  kunai: { id: 'kunai', name: 'Kunai', infinite: false },
  // Abilities sit in the hotbar too, but pressing their key FIRES them
  // rather than selecting them — there is nothing else to do with one.
  invisibility: { id: 'invisibility', name: 'Vanish', infinite: true, ability: true },
  shadowclone: { id: 'shadowclone', name: 'Clone', infinite: true, ability: true },
};

/** Inline SVG icons, drawn to read clearly at hotbar size. */
export const ITEM_ICONS = {
  kunai: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <polygon points="16,2 22.5,15 16,18 9.5,15" fill="#31353d"/>
    <polygon points="16,2 16,18 9.5,15" fill="#5d6672"/>
    <rect x="13" y="16.5" width="6" height="3" fill="#14161a"/>
    <rect x="14" y="19" width="4" height="7.5" fill="#c0392b"/>
    <rect x="13.6" y="20.5" width="4.8" height="1" fill="#8f2418"/>
    <rect x="13.6" y="23" width="4.8" height="1" fill="#8f2418"/>
    <circle cx="16" cy="28.5" r="2.7" fill="none" stroke="#14161a" stroke-width="1.9"/>
  </svg>`,
  katana: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <polygon points="27,3.5 29.5,6 13,22.5 10.5,20" fill="#dfe7f0"/>
    <polygon points="27,3.5 29.5,6 21,14.5 18.5,12" fill="#ffffff"/>
    <rect x="8.2" y="19.4" width="8" height="3" fill="#c9a227"
          transform="rotate(-45 12.2 20.9)"/>
    <rect x="3" y="22.6" width="8" height="3.6" fill="#22242b"
          transform="rotate(-45 7 24.4)"/>
    <rect x="1.6" y="25.4" width="3" height="3" fill="#c9a227"
          transform="rotate(-45 3.1 26.9)"/>
  </svg>`,
  invisibility: `<svg viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true">
    <g fill="#8fd8ff" opacity="0.55">
      <rect x="10" y="5" width="12" height="4"/><rect x="7" y="9" width="18" height="13"/>
      <rect x="9" y="22" width="14" height="5"/>
    </g>
    <g fill="#0d1a22"><rect x="11" y="13" width="3" height="4"/><rect x="18" y="13" width="3" height="4"/></g>
    <g fill="#ffffff" opacity="0.9"><rect x="4" y="12" width="2" height="8"/><rect x="26" y="12" width="2" height="8"/></g>
  </svg>`,
  shadowclone: `<svg viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true">
    <g fill="#2a2a44" opacity="0.9">
      <rect x="3" y="7" width="10" height="4"/><rect x="1" y="11" width="14" height="11"/>
      <rect x="3" y="22" width="10" height="4"/>
    </g>
    <g fill="#6cc24a">
      <rect x="19" y="7" width="10" height="4"/><rect x="17" y="11" width="14" height="11"/>
      <rect x="19" y="22" width="10" height="4"/>
    </g>
    <g fill="#12121a"><rect x="20" y="14" width="3" height="3"/><rect x="26" y="14" width="3" height="3"/></g>
  </svg>`,
};

export class Inventory {
  constructor() {
    // Slot 0 is the katana, slot 1 the kunai stack; the rest start empty.
    this.slots = [
      { item: ITEMS.katana, count: -1 },
      { item: ITEMS.kunai, count: CFG.kunai.startCount },
      null, null, null, null,
    ];
    this.selected = 0;
    this.dirty = true;        // tells the HUD to redraw
    // Taggers get an endless supply, so the chase never stalls for ammo.
    this.unlimitedKunai = false;
  }

  setUnlimitedKunai(v) {
    if (this.unlimitedKunai === v) return;
    this.unlimitedKunai = v;
    this.dirty = true;
  }

  /** Index of the kunai stack, or -1. */
  kunaiSlotIndex() {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s && s.item === ITEMS.kunai) return i;
    }
    return -1;
  }

  get selectedSlot() { return this.slots[this.selected] || null; }
  get selectedItem() {
    const s = this.selectedSlot;
    return s ? s.item : null;
  }

  select(index) {
    if (index < 0 || index >= this.slots.length) return false;
    // Abilities are fired, never held. Selecting one would leave you with
    // no weapon in hand, which is not a state the game should allow.
    const s = this.slots[index];
    if (s && s.item.ability) return false;
    if (index === this.selected) return false;
    this.selected = index;
    this.dirty = true;
    return true;
  }

  /** Total kunai held, wherever they sit. */
  get kunaiCount() {
    let n = 0;
    for (const s of this.slots) if (s && s.item === ITEMS.kunai) n += s.count;
    return n;
  }

  addKunai(n) {
    for (const s of this.slots) {
      if (s && s.item === ITEMS.kunai) { s.count += n; this.dirty = true; return true; }
    }
    // The stack was emptied and removed — put it back in the first free slot.
    for (let i = 0; i < this.slots.length; i++) {
      if (!this.slots[i]) {
        this.slots[i] = { item: ITEMS.kunai, count: n };
        this.dirty = true;
        return true;
      }
    }
    return false;
  }

  /** Consume one kunai from the selected slot. */
  useSelectedKunai() {
    const s = this.selectedSlot;
    if (!s || s.item !== ITEMS.kunai) return false;
    if (this.unlimitedKunai) return true;      // taggers never run dry
    if (s.count <= 0) return false;
    s.count--;
    this.dirty = true;
    return true;
  }

  /**
   * Put the chosen abilities into slots 3 and 4 (keys 3 and 4), capped at
   * CFG.abilities.maxEquipped. Anything already there is cleared first, so
   * this is safe to call whenever the loadout changes.
   */
  setAbilities(ids) {
    const max = CFG.abilities.maxEquipped;
    const wanted = (ids || []).slice(0, max);
    for (let i = 2; i < 2 + max; i++) {
      const chosen = wanted[i - 2];
      this.slots[i] = chosen && ITEMS[chosen]
        ? { item: ITEMS[chosen], count: -1 }
        : null;
    }
    // Never leave the cursor parked on a slot that just emptied.
    if (!this.slots[this.selected]) this.selected = 0;
    this.dirty = true;
  }

  /** Ability ids currently in the hotbar, in slot order. */
  equippedAbilities() {
    const out = [];
    for (const s of this.slots) {
      if (s && s.item.ability) out.push(s.item.id);
    }
    return out;
  }

  reset() {
    this.slots[0] = { item: ITEMS.katana, count: -1 };
    this.slots[1] = { item: ITEMS.kunai, count: CFG.kunai.startCount };
    this.selected = 0;
    this.dirty = true;
  }
}

// ----------------------------------------------------------- kunai mesh

let _kunaiGeo = null;
function kunaiGeometries() {
  if (_kunaiGeo) return _kunaiGeo;
  _kunaiGeo = {
    // Four-sided blade gives the flat, faceted diamond profile.
    blade: new THREE.ConeGeometry(0.115, 0.42, 4),
    grip: new THREE.CylinderGeometry(0.042, 0.042, 0.34, 6),
    ring: new THREE.TorusGeometry(0.075, 0.028, 5, 10),
    collar: new THREE.CylinderGeometry(0.055, 0.055, 0.05, 6),
    // Extra profiles, so a kunai skin changes the BLADE and not just its
    // colour — a recolour is free, and free is not worth 1500 froglets.
    broad: new THREE.ConeGeometry(0.19, 0.36, 4),
    needle: new THREE.ConeGeometry(0.07, 0.62, 4),
    crystal: new THREE.OctahedronGeometry(0.20, 0),
    point: new THREE.ConeGeometry(0.09, 0.24, 4),
    ribbon: new THREE.BoxGeometry(0.05, 0.02, 0.30),
  };
  return _kunaiGeo;
}

let _kunaiMats = null;
/**
 * Kunai materials are shared by every blade on screen, so a skin change
 * repaints them in place rather than rebuilding the pool.
 */
function kunaiMaterials() {
  if (_kunaiMats) return _kunaiMats;
  _kunaiMats = {
    steel: new THREE.MeshLambertMaterial({ color: 0x2b2f36 }),
    edge: new THREE.MeshLambertMaterial({ color: 0x5a626d }),
    wrap: new THREE.MeshLambertMaterial({ color: 0xc0392b }),
    ring: new THREE.MeshLambertMaterial({ color: 0x14161a }),
    // A glowing blade is lit rather than shaded; a skin toggles which is used.
    lit: new THREE.MeshBasicMaterial({ color: 0x5a626d }),
    ribbon: new THREE.MeshLambertMaterial({
      color: 0xc0392b, transparent: true, opacity: 0.9,
    }),
  };
  return _kunaiMats;
}

/**
 * The shape the current kunai skin asks for.
 *
 * Held at module level because every blade in the pool is built from it, and
 * the pool is rebuilt when it changes.
 */
let _kunaiFx = {};
export function kunaiFx() { return _kunaiFx; }

/**
 * Apply a kunai skin to every existing and future blade.
 * @returns true if the SHAPE changed and the pool must be rebuilt
 */
export function setKunaiSkin(skin) {
  if (!skin) return false;
  const M = kunaiMaterials();
  M.steel.color.setHex(skin.blade);
  M.edge.color.setHex(skin.facet);
  M.lit.color.setHex(skin.facet);
  M.wrap.color.setHex(skin.wrap);
  M.ring.color.setHex(skin.ring);
  const fx = skin.fx || {};
  M.ribbon.color.setHex(fx.ribbon || skin.wrap);
  const changed = fx.shape !== _kunaiFx.shape
    || !!fx.glow !== !!_kunaiFx.glow
    || (fx.big || 1) !== (_kunaiFx.big || 1)
    || !!fx.ribbon !== !!_kunaiFx.ribbon;
  _kunaiFx = fx;
  return changed;
}

/**
 * Build one kunai: dark faceted blade, red-wrapped grip, black ring pommel.
 * The group points along +Z so it can be aimed with lookAt/quaternion.
 */
export function createKunaiMesh() {
  const G = kunaiGeometries();
  const M = kunaiMaterials();
  const F = _kunaiFx;
  const g = new THREE.Group();
  const big = F.big || 1;
  const edgeMat = F.glow ? M.lit : M.edge;

  // ---- blade: a genuinely different profile per skin ----
  let bladeGeo = G.blade;
  let bladeZ = 0.21;
  if (F.shape === 'broad') { bladeGeo = G.broad; bladeZ = 0.18; }
  else if (F.shape === 'needle') { bladeGeo = G.needle; bladeZ = 0.31; }
  else if (F.shape === 'crystal') { bladeGeo = G.crystal; bladeZ = 0.20; }

  const blade = new THREE.Mesh(bladeGeo, F.glow ? M.lit : M.steel);
  if (F.shape !== 'crystal') blade.rotation.x = Math.PI / 2;
  blade.position.z = bladeZ;
  blade.scale.setScalar(big);
  g.add(blade);

  if (F.shape === 'crystal') {
    // A shard rather than a blade: a second, sharper spike out the front.
    const spike = new THREE.Mesh(G.needle, edgeMat);
    spike.rotation.x = Math.PI / 2;
    spike.position.z = 0.42 * big;
    spike.scale.setScalar(big * 0.8);
    g.add(spike);
  } else if (F.shape === 'star') {
    // Four points around the collar — a shuriken, not a knife.
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(G.point, edgeMat);
      const a = (i / 4) * Math.PI * 2;
      p.position.set(Math.cos(a) * 0.16 * big, Math.sin(a) * 0.16 * big, 0.06);
      p.rotation.z = -a + Math.PI / 2;
      p.rotation.x = Math.PI / 2;
      p.scale.setScalar(big);
      g.add(p);
    }
  } else {
    // Slim lighter facet so the blade reads as edged rather than a flat cone.
    const facet = new THREE.Mesh(bladeGeo, edgeMat);
    facet.rotation.x = Math.PI / 2;
    facet.rotation.z = Math.PI / 4;
    facet.scale.set(0.55 * big, 1.005 * big, 0.55 * big);
    facet.position.z = bladeZ - 0.002;
    g.add(facet);
  }

  // A streamer trailing off the ring.
  if (F.ribbon) {
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(G.ribbon, M.ribbon);
      r.position.set(0, 0, -0.50 - i * 0.26);
      r.scale.set(1, 1, 1 - i * 0.2);
      r.castShadow = false;
      g.add(r);
    }
  }

  const collar = new THREE.Mesh(G.collar, M.ring);
  collar.rotation.x = Math.PI / 2;
  collar.position.z = 0.0;
  g.add(collar);

  const grip = new THREE.Mesh(G.grip, M.wrap);
  grip.rotation.x = Math.PI / 2;
  grip.position.z = -0.19;
  g.add(grip);

  const ring = new THREE.Mesh(G.ring, M.ring);
  ring.position.z = -0.40;
  g.add(ring);

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ------------------------------------------------------ kunai projectiles

/**
 * Pooled thrown kunai.
 *
 * Collision is a swept segment test against the world each frame plus a
 * radius check against players and dummies, so a fast throw can never
 * tunnel through a wall or a target.
 */
export class KunaiSystem {
  constructor(scene, collision, effects) {
    this.scene = scene;
    this.collision = collision;
    this.effects = effects;
    this.pool = [];
    this.active = [];
    // (id, outVec3) => bool — supplied by the game so a kunai can follow a
    // moving target without this module knowing what a player is.
    this.resolveTarget = null;

    for (let i = 0; i < CFG.kunai.maxInFlight; i++) {
      const mesh = createKunaiMesh();
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({
        mesh,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        stuck: false,
        spin: 0,
        owner: null,
        local: false,
      });
    }
  }

  /**
   * Rebuild every blade in the pool.
   *
   * Colour changes repaint shared materials in place, but a SHAPE change
   * needs new geometry — and the pool is built once at startup, so without
   * this a bought kunai skin would only ever recolour the old silhouette.
   */
  rebuild() {
    for (const k of this.pool) {
      const wasVisible = k.mesh.visible;
      this.scene.remove(k.mesh);
      k.mesh.traverse((o) => { if (o.geometry && o.geometry.dispose) o.geometry = o.geometry; });
      const mesh = createKunaiMesh();
      mesh.visible = wasVisible;
      mesh.position.copy(k.mesh.position);
      mesh.quaternion.copy(k.mesh.quaternion);
      this.scene.add(mesh);
      k.mesh = mesh;
    }
  }

  _take() {
    for (const k of this.pool) if (!k.mesh.visible) return k;
    // All in use — recycle the oldest so a throw is never silently dropped.
    const oldest = this.active.shift();
    if (oldest) return oldest;
    return this.pool[0];
  }

  /**
   * @param origin   world position to launch from
   * @param dir      normalised direction
   * @param ownerId  who threw it
   * @param local    true if this client owns hit detection for it
   * @param targetId id of the assisted target, or null for a straight throw.
   *                 Sent over the wire too, so onlookers see the same curve.
   */
  throw_(origin, dir, ownerId, local, targetId) {
    const k = this._take();
    k.targetId = targetId || null;
    k.pos.copy(origin);
    k.vel.copy(dir).multiplyScalar(CFG.kunai.speed);
    // Flight time is exactly the time needed to cover `range` at `speed`,
    // so changing either value keeps the stated range honest.
    k.life = CFG.kunai.range / CFG.kunai.speed;
    k.stuck = false;
    k.spin = 0;
    k.owner = ownerId;
    k.local = local;
    k.mesh.visible = true;
    k.mesh.position.copy(origin);
    k.mesh.scale.setScalar(1);
    if (this.active.indexOf(k) === -1) this.active.push(k);
    return k;
  }

  /**
   * @param targets array of { id, pos, dead, onHit(damage, dirX, dirZ) }
   *                only consulted for locally-owned kunai
   */
  update(dt, targets) {
    const K = CFG.kunai;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const k = this.active[i];
      k.life -= dt;

      if (k.life <= 0) {
        k.mesh.visible = false;
        this.active.splice(i, 1);
        continue;
      }

      if (k.stuck) {
        // Fade out the last half second so it does not blink away.
        if (k.life < 0.5) k.mesh.scale.setScalar(clamp(k.life / 0.5, 0, 1));
        continue;
      }

      _prev.copy(k.pos);
      this._steer(k, dt);
      k.vel.y += K.gravity * dt;
      k.pos.addScaledVector(k.vel, dt);

      // ---- targets (only the owner resolves damage) ----
      let hitTarget = null;
      let hitPart = null;
      if (k.local && targets) {
        for (let t = 0; t < targets.length; t++) {
          const tgt = targets[t];
          if (!tgt || tgt.dead || tgt.id === k.owner) continue;
          const part = this._hitPart(_prev, k.pos, tgt);
          if (part) { hitTarget = tgt; hitPart = part; break; }
        }
      }

      if (hitTarget) {
        const head = hitPart === 'head';
        const box = hitTarget.hitbox;
        _seg.subVectors(k.pos, _prev).normalize();
        _v.set(
          hitTarget.pos.x,
          hitTarget.pos.y + (head ? box.headOffset : box.bodyOffset),
          hitTarget.pos.z
        );
        this.effects.hitBurst(_v, { x: _seg.x, y: 0, z: _seg.z }, head);
        if (hitTarget.onHit) {
          hitTarget.onHit(head ? K.headshotDamage : K.damage, _seg.x, _seg.z, head, _v);
        }
        k.mesh.visible = false;
        this.active.splice(i, 1);
        continue;
      }

      // ---- world ----
      _seg.subVectors(k.pos, _prev);
      const dist = _seg.length();
      if (dist > 1e-5) {
        _seg.multiplyScalar(1 / dist);
        const hit = this.collision.raycast(
          _prev.x, _prev.y, _prev.z, _seg.x, _seg.y, _seg.z, dist);
        if (hit) {
          // Bury the tip slightly so it looks embedded rather than floating.
          k.pos.set(hit.x, hit.y, hit.z).addScaledVector(_seg, 0.12);
          k.stuck = true;
          // Restart the clock: how long it lingers in a wall is independent
          // of how much flight time was left when it landed.
          k.life = K.stickTime;
          k.mesh.position.copy(k.pos);
          this.effects.puff(k.pos, 0xd8d2c4, 5, 2.5);
          continue;
        }
      }

      k.mesh.position.copy(k.pos);
      // Aim along travel, with a slow roll so it reads as spinning.
      if (k.vel.lengthSq() > 1e-4) {
        _v.copy(k.pos).add(k.vel);
        k.mesh.lookAt(_v);
        k.spin += dt * 14;
        k.mesh.rotateZ(k.spin);
      }
    }
  }

  /**
   * Curve an assisted kunai toward its target.
   *
   * The turn rate is capped, so the blade arcs in over its flight rather
   * than snapping onto the target — a hard lock would look like a homing
   * missile. It also gives up if the target ends up too far off to the side,
   * so a badly-aimed throw still misses.
   */
  _steer(k, dt) {
    if (!k.targetId || !this.resolveTarget) return;
    if (!this.resolveTarget(k.targetId, _aim)) { k.targetId = null; return; }

    _v.subVectors(_aim, k.pos);
    const dist = _v.length();
    const K = CFG.kunai;
    if (dist < K.homingStopDist) { k.targetId = null; return; }
    _v.multiplyScalar(1 / dist);

    _seg.copy(k.vel);
    const speed = _seg.length();
    if (speed < 1e-4) return;
    _seg.multiplyScalar(1 / speed);

    const angle = Math.acos(clamp(_seg.dot(_v), -1, 1));
    if (angle > K.homingGiveUpAngle) { k.targetId = null; return; }
    if (angle < 1e-4) return;

    // Rotate the heading toward the target by at most turnRate * dt.
    const t = Math.min(1, (K.homingTurnRate * dt) / angle);
    _seg.lerp(_v, t).normalize();
    k.vel.copy(_seg).multiplyScalar(speed);
  }

  /**
   * Which body part this frame's travel segment passed through.
   * The head is tested first so a shot that grazes both counts as the
   * headshot — the more skilful read of an ambiguous hit.
   * @returns 'head' | 'body' | null
   */
  _hitPart(a, b, tgt) {
    const box = tgt.hitbox || CFG.hitbox.player;
    const r = CFG.kunai.radius;
    if (this._segmentSphere(a, b, tgt.pos.x, tgt.pos.y + box.headOffset, tgt.pos.z,
      box.headRadius + r)) return 'head';
    if (this._segmentSphere(a, b, tgt.pos.x, tgt.pos.y + box.bodyOffset, tgt.pos.z,
      box.bodyRadius + r)) return 'body';
    return null;
  }

  /** Closest-approach test between segment a->b and a sphere. */
  _segmentSphere(a, b, cx, cy, cz, radius) {
    _v.subVectors(b, a);
    const lenSq = _v.lengthSq();
    const px = cx - a.x;
    const py = cy - a.y;
    const pz = cz - a.z;
    let t = lenSq > 1e-9 ? (px * _v.x + py * _v.y + pz * _v.z) / lenSq : 0;
    t = clamp(t, 0, 1);
    const dx = px - _v.x * t;
    const dy = py - _v.y * t;
    const dz = pz - _v.z * t;
    return (dx * dx + dy * dy + dz * dz) <= radius * radius;
  }

  clear() {
    for (const k of this.active) k.mesh.visible = false;
    this.active.length = 0;
  }
}

// ---------------------------------------------------------- pickup crates

let _crateGeo = null;
function crateParts() {
  if (_crateGeo) return _crateGeo;
  _crateGeo = {
    body: new THREE.BoxGeometry(1, 1, 1),
    band: new THREE.BoxGeometry(1, 1, 1),
    matWood: new THREE.MeshLambertMaterial({ color: 0x9a6f3c }),
    matTrim: new THREE.MeshLambertMaterial({ color: 0x5d4022 }),
    matGlow: new THREE.MeshBasicMaterial({
      color: 0xffd76b, transparent: true, opacity: 0.28,
      depthWrite: false, side: THREE.BackSide,
    }),
  };
  return _crateGeo;
}

function createCrateMesh() {
  const P = crateParts();
  const g = new THREE.Group();

  const body = new THREE.Mesh(P.body, P.matWood);
  body.scale.set(0.95, 0.8, 0.95);
  body.castShadow = true;
  g.add(body);

  // Corner banding so it reads as a crate, not a plain cube.
  for (const y of [-0.34, 0.34]) {
    const band = new THREE.Mesh(P.band, P.matTrim);
    band.scale.set(1.0, 0.13, 1.0);
    band.position.y = y;
    g.add(band);
  }
  const post = new THREE.Mesh(P.band, P.matTrim);
  post.scale.set(0.16, 0.82, 1.0);
  g.add(post);
  const post2 = new THREE.Mesh(P.band, P.matTrim);
  post2.scale.set(1.0, 0.82, 0.16);
  g.add(post2);

  // Soft outward glow so crates are findable across the valley.
  const glow = new THREE.Mesh(P.body, P.matGlow);
  glow.scale.set(1.5, 1.35, 1.5);
  g.add(glow);

  // A kunai riding on top advertises what is inside.
  const k = createKunaiMesh();
  k.scale.setScalar(0.85);
  k.position.y = 0.85;
  k.rotation.x = -Math.PI / 2;
  g.add(k);
  g.userData.topKunai = k;

  return g;
}

export class PickupSystem {
  /**
   * @param authority true when this client owns crate spawning
   */
  constructor(scene, world, effects, authority) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.authority = authority;
    this.crates = new Map();     // id -> { id, pos, mesh, phase }
    this.timer = 0;
    this.syncTimer = 0;
    this.nextId = 1;
    this.pool = [];
    this.onSpawnWave = null;     // (list) => void, for broadcasting
    this.onCollected = null;     // (id) => void
  }

  _takeMesh() {
    for (const m of this.pool) if (!m.visible) { m.visible = true; return m; }
    const m = createCrateMesh();
    this.scene.add(m);
    this.pool.push(m);
    return m;
  }

  /** Authority: replace the whole set with a fresh wave. */
  spawnWave() {
    this.clear();
    const list = [];
    for (let i = 0; i < CFG.pickups.boxes; i++) {
      const p = this.world.randomGroundPoint(Math.random, CFG.pickups.spawnRadius);
      const id = this.nextId++;
      list.push({ id, x: +p.x.toFixed(2), y: +(p.y + 1.1).toFixed(2), z: +p.z.toFixed(2) });
    }
    this.applyWave(list);
    if (this.onSpawnWave) this.onSpawnWave(list);
    return list;
  }

  /** Everyone: rebuild local crates from an authoritative list. */
  applyWave(list) {
    this.clear();
    for (const c of list) this._add(c.id, c.x, c.y, c.z);
    this.timer = 0;
  }

  _add(id, x, y, z) {
    if (this.crates.has(id)) return;
    const mesh = this._takeMesh();
    mesh.position.set(x, y, z);
    this.crates.set(id, {
      id, mesh,
      pos: new THREE.Vector3(x, y, z),
      baseY: y,
      phase: Math.random() * Math.PI * 2,
    });
  }

  /** Remove one crate (picked up, locally or remotely). */
  remove(id, withEffect) {
    const c = this.crates.get(id);
    if (!c) return false;
    if (withEffect) {
      this.effects.puff(c.pos, 0xffd76b, 16, 6);
      this.effects.ring(c.pos, 0.4, 3.0, 0.4, 0xffd76b, true);
    }
    c.mesh.visible = false;
    this.crates.delete(id);
    return true;
  }

  clear() {
    for (const c of this.crates.values()) c.mesh.visible = false;
    this.crates.clear();
  }

  /** Nearest crate within pickup range of a position, or null. */
  nearest(pos) {
    let best = null, bestD = CFG.pickups.range * CFG.pickups.range;
    for (const c of this.crates.values()) {
      const dx = c.pos.x - pos.x;
      const dy = c.pos.y - (pos.y + 0.9);
      const dz = c.pos.z - pos.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  update(dt, time) {
    // Bob and turn.
    for (const c of this.crates.values()) {
      c.mesh.position.y = c.baseY + Math.sin(time * 1.6 + c.phase) * CFG.pickups.bobHeight;
      c.mesh.rotation.y += dt * 0.8;
      const k = c.mesh.userData.topKunai;
      if (k) k.rotation.z += dt * 2.2;
    }

    if (!this.authority) return;

    this.timer += dt;
    if (this.timer >= CFG.pickups.cycle) {
      // Whole set expires together and a fresh wave appears elsewhere.
      this.spawnWave();
    }

    this.syncTimer += dt;
    if (this.syncTimer >= CFG.pickups.syncInterval) {
      this.syncTimer = 0;
      if (this.onSpawnWave && this.crates.size) {
        const list = [];
        for (const c of this.crates.values()) {
          list.push({ id: c.id, x: c.pos.x, y: c.baseY, z: c.pos.z });
        }
        this.onSpawnWave(list);
      }
    }
  }
}
