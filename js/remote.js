/**
 * A networked player other than you.
 *
 * Position is rendered from a small snapshot buffer, played back
 * CFG.net.interpDelay seconds in the past. That deliberate delay is what
 * turns 20Hz network updates into smooth motion — we always have two real
 * samples to interpolate between instead of extrapolating into guesses.
 *
 * Discrete actions (dash, attack, jump, death) arrive as events and are
 * replayed through the same effects/audio systems the local player uses, so
 * a remote frog's dash looks and sounds identical to your own.
 */

import * as THREE from '../lib/three.module.js?v=v10';
import { CFG } from './config.js?v=v10';
import { clamp, lerp, angleDelta, damp } from './util.js?v=v10';
import { FrogModel } from './frog.js?v=v10';
import { Audio } from './audio.js?v=v10';

const _tmp = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class RemotePlayer {
  constructor(id, name, color, scene, effects) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.scene = scene;
    this.effects = effects;

    this.model = new FrogModel(color, name, false);
    scene.add(this.model.root);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.hp = CFG.combat.maxHealth;
    this.maxHp = CFG.combat.maxHealth;
    this.dead = false;
    this.grounded = true;
    this.dashing = false;
    this.attackIndex = -1;
    this.attackTimer = 0;
    this.kills = 0;

    this.grappleActive = false;
    this.grappleTip = new THREE.Vector3();

    this.buffer = [];          // { t, s } ordered by time
    this.lastPacket = 0;
    this.spawned = false;
    this.dashFxTimer = 0;
    this.speed = 0;
    this._prev = new THREE.Vector3();
  }

  /** Store an incoming state snapshot. */
  pushSnapshot(s, now) {
    this.lastPacket = now;
    this.buffer.push({ t: now, s });
    // Keep about half a second of history; more is wasted memory.
    while (this.buffer.length > 2 && now - this.buffer[0].t > 0.6) this.buffer.shift();
    if (this.buffer.length > 24) this.buffer.shift();

    this.hp = s.hp;
    this.kills = s.k || 0;
    if (!this.spawned) {
      this.spawned = true;
      this.pos.set(s.x, s.y, s.z);
      this.yaw = s.yaw;
      this.model.root.position.copy(this.pos);
    }
  }

  /** Replay a discrete action broadcast by that player's client. */
  applyEvent(ev) {
    switch (ev.t) {
      case 'dash': {
        _dir.set(ev.dx || 0, 0, ev.dz || -1);
        _tmp.set(ev.x, ev.y, ev.z);
        this.effects.dashBurst(_tmp, _dir, 0x8ce8ff);
        Audio.dash(_tmp);
        this.dashFxTimer = CFG.dash.duration;
        this.dashDir = _dir.clone();
        break;
      }
      case 'jump': {
        _tmp.set(ev.x, ev.y, ev.z);
        if (ev.k === 0) {
          this.effects.dustPuff(_tmp, 6, 2.0, 0xcfc0a0);
          Audio.jump(_tmp);
        } else if (ev.k === 2) {
          this.effects.puff(_tmp, 0xd8e8ff, 8, 4);
          Audio.wallJump(_tmp);
        } else {
          this.effects.ring(_tmp, 0.4, 3.0, 0.35, 0xbdf5a0, true);
          Audio.doubleJump(_tmp);
          this.model.triggerFlip();
        }
        this.model.croak();
        break;
      }
      case 'land': {
        _tmp.set(ev.x, ev.y, ev.z);
        this.effects.dustPuff(_tmp, ev.hard ? 14 : 6, ev.hard ? 4 : 2, 0xcfc0a0);
        Audio.land(_tmp, !!ev.hard);
        break;
      }
      case 'attack': {
        this.attackIndex = ev.i;
        this.attackTimer = CFG.combat.attackCooldown[ev.i];
        this.attackDuration = this.attackTimer;
        _tmp.set(
          this.pos.x - Math.sin(ev.yaw) * 1.5,
          this.pos.y + 1.1,
          this.pos.z - Math.cos(ev.yaw) * 1.5
        );
        this.effects.slashArc(_tmp, ev.yaw, ev.i, ev.i === 2 ? 0xfff0b0 : 0xdff3ff, ev.i === 2 ? 3.8 : 3.0);
        Audio.slash(this.pos, ev.i);
        break;
      }
      case 'die': {
        _tmp.set(ev.x, ev.y, ev.z);
        this.effects.deathBurst(_tmp, this.color);
        Audio.death(_tmp);
        this.dead = true;
        break;
      }
      case 'respawn': {
        _tmp.set(ev.x, ev.y, ev.z);
        this.effects.respawnBurst(_tmp, this.color);
        Audio.respawn(_tmp);
        this.dead = false;
        this.hp = this.maxHp;
        // Teleport rather than interpolate across the map.
        this.buffer.length = 0;
        this.pos.copy(_tmp);
        this.model.root.position.copy(_tmp);
        break;
      }
      case 'grapEnd':
        this.grappleActive = false;
        Audio.tongueRelease(this.pos);
        break;
      case 'grapple':
        Audio.tongueFire(this.pos);
        break;
      default:
        break;
    }
  }

  /**
   * @param dt frame delta
   * @param now shared clock in seconds
   */
  update(dt, now) {
    if (!this.spawned) return;

    this._prev.copy(this.pos);
    this._interpolate(now - CFG.net.interpDelay);

    // Derive speed from actual rendered motion so the run cycle always
    // matches what the viewer sees, even through packet loss.
    this.speed = this._prev.distanceTo(this.pos) / Math.max(dt, 1e-5);
    if (this.speed > 60) this.speed = 60;

    if (this.dashFxTimer > 0) {
      this.dashFxTimer -= dt;
      if (this.dashDir) this.effects.dashTrail(this.pos, this.dashDir, 0x8ce8ff);
    }

    // Mirror the local sprint wake so other players visibly tear along too.
    if (this.sprinting && this.speed > 4) {
      this._sprintTrail = (this._sprintTrail || 0) - dt;
      if (this._sprintTrail <= 0) {
        this._sprintTrail = CFG.sprint.trailInterval;
        _dir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        this.effects.sprintTrail(this.pos, _dir);
      }
    }
    if (this.attackTimer > 0) this.attackTimer -= dt;

    this.model.root.position.copy(this.pos);
    this.model.setFacing(this.yaw);

    this.model.update(dt, {
      speed: this.speed,
      vy: this.vel.y,
      grounded: this.grounded,
      moving: this.speed > 1.2 && this.grounded,
      dashT: Math.max(0, this.dashFxTimer),
      attackT: this.attackDuration ? clamp(this.attackTimer / this.attackDuration, 0, 1) : 0,
      attackIndex: this.attackIndex,
      grappling: this.grappleActive,
      tongueTo: this.grappleActive ? this.grappleTip : null,
      wallSliding: false,
      sprinting: this.sprinting,
      swimming: this.swimming,
      swimPitch: this.swimming ? clamp(this.vel.y / 10, -1, 1) : 0,
      dead: this.dead,
    });

    this.model.drawNameplate(this.hp / this.maxHp);
  }

  /** Find the two snapshots bracketing `renderTime` and blend them. */
  _interpolate(renderTime) {
    const buf = this.buffer;
    if (!buf.length) return;

    if (buf.length === 1 || renderTime <= buf[0].t) {
      this._applyState(buf[0].s, buf[0].s, 0);
      return;
    }
    const last = buf[buf.length - 1];
    if (renderTime >= last.t) {
      // Ran out of buffer: extrapolate briefly using the last known velocity
      // rather than freezing, but cap it so a dropped peer doesn't fly away.
      const ahead = Math.min(renderTime - last.t, 0.2);
      const s = last.s;
      this.pos.set(s.x + s.vx * ahead, s.y + s.vy * ahead, s.z + s.vz * ahead);
      this._applyMeta(s);
      this.yaw += angleDelta(this.yaw, s.yaw) * 0.35;
      return;
    }

    for (let i = 0; i < buf.length - 1; i++) {
      const a = buf[i], b = buf[i + 1];
      if (renderTime >= a.t && renderTime <= b.t) {
        const span = b.t - a.t;
        const t = span > 1e-6 ? (renderTime - a.t) / span : 0;
        this._applyState(a.s, b.s, t);
        return;
      }
    }
  }

  _applyState(a, b, t) {
    this.pos.set(
      lerp(a.x, b.x, t),
      lerp(a.y, b.y, t),
      lerp(a.z, b.z, t)
    );
    this.vel.set(lerp(a.vx, b.vx, t), lerp(a.vy, b.vy, t), lerp(a.vz, b.vz, t));
    // Interpolate the shortest way around the circle.
    this.yaw = a.yaw + angleDelta(a.yaw, b.yaw) * t;
    this._applyMeta(t < 0.5 ? a : b);
  }

  _applyMeta(s) {
    this.grounded = !!s.g;
    this.dead = !!s.d;
    this.hp = s.hp;
    this.dashing = !!s.dt;
    this.swimming = !!s.sw;
    this.sprinting = !!s.sp;
    this.storyPhase = s.st || 0;
    if (s.at) this.attackIndex = s.at - 1;

    if (s.gr) {
      this.grappleActive = s.gr[0] !== 0;
      this.grappleTip.set(s.gr[1], s.gr[2], s.gr[3]);
    } else {
      this.grappleActive = false;
    }
  }

  /** Targeting shim so Combat.resolve can treat remotes like plain targets. */
  get alive() { return !this.dead; }

  dispose() {
    this.scene.remove(this.model.root);
    this.model.dispose();
  }
}
