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

import * as THREE from '../lib/three.module.js?v=v54';
import { CFG } from './config.js?v=v54';
import { clamp, lerp, angleDelta, damp } from './util.js?v=v54';
import { FrogModel } from './frog.js?v=v54';
import { ToadModel } from './npc.js?v=v54';
import { findSkin, DEFAULT_SKIN } from './skins.js?v=v54';
import { Audio } from './audio.js?v=v54';

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

    this.hidden = false;
    this.invisible = false;
    this.cloneInvisible = false;
    this.cloneState = null;
    this.cloneModel = null;
    this._hunting = false;
    this._forced = false;
    this.spectating = false;
    this.isJuggernautModel = false;
    // Set by the game: spawns the visual-only kunai this player's clone threw.
    this.onCloneThrow = null;

    this.buffer = [];          // { t, s } ordered by time
    this.lastPacket = 0;
    this.spawned = false;
    this.ascendT = 0;          // divine-skin transformation progress
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
        // Their streak died with them: back to the first form.
        this.ascendT = 0;
        if (this.model.isDivine) this.model.setDivinePhase(1, 1);
        // Teleport rather than interpolate across the map.
        this.buffer.length = 0;
        this.pos.copy(_tmp);
        this.model.root.position.copy(_tmp);
        break;
      }
      case 'abil': {
        // The pop is worth showing even for a vanish you are about to lose
        // sight of — it tells you WHERE they went invisible.
        _tmp.set(ev.x, ev.y + 1.0, ev.z);
        const col = ev.a === 'invisibility' ? 0x8fd8ff : 0x9a7aff;
        this.effects.puff(_tmp, col, 20, 5);
        this.effects.ring(_tmp, 0.4, 3.4, 0.45, col, true);
        Audio.tongueRelease(_tmp);
        break;
      }
      case 'ascend': {
        // Frogath the Divine took a life. Everyone watches them ascend —
        // the whole point of the cosmetic is that it is visible to the room.
        if (!this.model.isDivine) break;
        this.ascendT = CFG.divine.duration;
        this.model.setDivinePhase(2, 0);
        _tmp.copy(this.pos); _tmp.y += 0.9;
        this.effects.puff(_tmp, 0xfff3c4, 60, 14);
        this.effects.ring(_tmp, 1, CFG.divine.shockwave, 0.9, 0xffd76b, true);
        this.effects.ring(_tmp, 1, CFG.divine.shockwave * 0.6, 0.6, 0xffffff, true);
        Audio.headshot(_tmp);
        break;
      }
      case 'leapUp': {
        // The wind-up is the warning. Everyone nearby needs to see and hear
        // it start, because dodging it is the entire counterplay.
        _tmp.set(ev.x, ev.y + 0.15, ev.z);
        this.effects.ring(_tmp, 3.0, 0.5, Math.max(0.2, ev.c || 0.5), 0xffb03c,
          false, { x: 0, y: 1, z: 0 });
        Audio.tone({
          freq: 90, to: 240, dur: ev.c || 0.8,
          type: 'sawtooth', volume: 0.13, pos: _tmp,
        });
        break;
      }
      case 'leap': {
        _tmp.set(ev.x, ev.y + 0.2, ev.z);
        this.effects.dustPuff(_tmp, 20, 6, 0xcfc0a0);
        this.effects.ring(_tmp, 0.4, 5.0, 0.5, 0xffb03c, true);
        Audio.doubleJump(_tmp);
        Audio.land(_tmp, true);
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

    // Their divine ascension, unfolding on our copy of them.
    if (this.ascendT > 0) {
      this.ascendT = Math.max(0, this.ascendT - dt);
      this.model.setDivinePhase(2,
        clamp(1 - this.ascendT / CFG.divine.duration, 0, 1));
    }

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
    this._updateClone(dt);
  }

  /**
   * Swap this player between the frog rig and the juggernaut toad.
   *
   * Done by rebuilding rather than hiding one of two models, so a long match
   * never carries a spare rig around; the swap happens once when a round
   * starts, not per frame.
   */
  setJuggernaut(on) {
    if (this.isJuggernautModel === on) return;
    this.isJuggernautModel = on;
    const old = this.model;
    this.model = on
      ? new ToadModel(true, findSkin('swords', DEFAULT_SKIN.swords))
      : new FrogModel(this.color, this.name, false);
    this.model.root.position.copy(old.root.position);
    this.model.root.rotation.copy(old.root.rotation);
    this.model.root.visible = old.root.visible;
    this.scene.remove(old.root);
    old.dispose();
    this.scene.add(this.model.root);
    this._ghost = undefined;
  }

  /**
   * Tell this player how the local viewer relates to them.
   *
   * @param hunting the viewer is on the side chasing this player, so their
   *                invisibility should hide them outright rather than fade
   * @param forced  hidden regardless (story mode hides players who have not
   *                reached the castle yet)
   */
  setViewer(hunting, forced) {
    this._hunting = !!hunting;
    this._forced = !!forced;
    this._applyVisibility();
  }

  /**
   * Resolve visibility for the frog and its clone independently.
   *
   * They are resolved separately on purpose: the clone replays your pose a
   * beat late, so it must vanish a beat late too. Tying it to the owner's
   * live state would give the trick away — the decoy would blink out at the
   * exact moment the real frog did.
   */
  _applyVisibility() {
    const F = CFG.abilities.invisibility.friendlyOpacity;

    // Spectators are gone to everybody — teammates included. That is what
    // makes being knocked out feel like leaving the fight rather than
    // haunting it.
    const meHidden = this._forced || this.spectating
      || (this.invisible && this._hunting);
    this.hidden = meHidden;
    this.model.root.visible = !meHidden;
    this.model.setGhost(this.invisible && !meHidden ? F : 1);

    if (!this.cloneModel) return;
    const out = !!this.cloneState;
    const cHidden = this._forced || this.spectating
      || (this.cloneInvisible && this._hunting);
    this.cloneModel.root.visible = out && !cHidden;
    this.cloneModel.setGhost(this.cloneInvisible && !cHidden ? F : 1);
  }

  /**
   * Draw this player's shadow clone, if they have one out.
   *
   * Built lazily — most players never use the ability — and deliberately NOT
   * tinted or faded: a decoy that looks like a ghost is not a decoy. It only
   * disappears under the same rule as its owner.
   */
  _updateClone(dt) {
    if (!this.cloneState) {
      this.cloneInvisible = false;
      if (this.cloneModel) this.cloneModel.root.visible = false;
      return;
    }
    if (!this.cloneModel) {
      // Same name and nameplate as its owner: a decoy with no name tag over
      // it would be spotted instantly, which is the whole ability wasted.
      this.cloneModel = new FrogModel(this.color, this.name, false);
      this.scene.add(this.cloneModel.root);
    }
    const [x, y, z, yaw, speed, bits, attackT, attackIndex, throwT, vy,
      atk, thr, tdx, tdy, tdz] = this.cloneState;

    // Bit 64 is the owner's invisibility AS RECORDED, so the clone fades on
    // the same delay it does everything else on.
    this.cloneInvisible = !!(bits & 64);
    this._applyVisibility();
    this.cloneModel.root.position.set(x, y, z);
    this.cloneModel.setFacing(yaw);
    this.cloneModel.update(dt, {
      speed, vy,
      grounded: !!(bits & 1),
      moving: !!(bits & 2),
      sprinting: !!(bits & 4),
      swimming: !!(bits & 8),
      parrying: !!(bits & 16),
      dead: !!(bits & 32),
      attackT, attackIndex, throwT,
    });
    this.cloneModel.drawNameplate(this.hp / this.maxHp);
    this.cloneModel.setTagger(this.model._isTagger);

    // One arc and one kunai per recorded action, however the packets landed.
    _tmp.set(x, y, z);
    if (this._cAtk === undefined) { this._cAtk = atk; this._cThr = thr; }
    if (atk !== this._cAtk) {
      this._cAtk = atk;
      const i = clamp(attackIndex, 0, 2);
      _dir.set(x - Math.sin(yaw) * 1.5, y + 1.1, z - Math.cos(yaw) * 1.5);
      this.effects.slashArc(_dir, yaw, i, i === 2 ? 0xfff0b0 : 0xdff3ff, i === 2 ? 3.8 : 3.0);
      Audio.slash(_tmp, i);
    }
    if (thr !== this._cThr) {
      this._cThr = thr;
      if (this.onCloneThrow) this.onCloneThrow(_tmp, tdx, tdy, tdz);
      Audio.kunaiThrow(_tmp);
    }
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
    this.invisible = !!s.iv;
    this.spectating = !!s.sx;
    this.setJuggernaut(!!s.jg);
    this.cloneState = s.cl || null;
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
    if (this.cloneModel) {
      this.scene.remove(this.cloneModel.root);
      this.cloneModel.dispose();
      this.cloneModel = null;
    }
  }
}
