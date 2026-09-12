/**
 * Start-screen background: the camera drifts through the game's own map on a
 * looping spline.
 *
 * It used to be a hand-composed diorama — a shrine terrace above a lake, with
 * torii standing in the water — on the grounds that "the menu appears
 * instantly instead of waiting on full world generation". That reason had
 * stopped being true: the whole valley builds in 67ms, measured, against 20ms
 * for the diorama it replaced. What the trade actually bought was a title
 * screen advertising places the game does not contain, which is worse than a
 * slightly slower one.
 *
 * So this builds the real World, from the real map entry, with the same seed
 * every client generates. Everything the camera flies past — the Lotus Arena
 * and its gateway torii, the temple village, the Sky Shrine, the bamboo
 * grove, the rope bridges — is somewhere you can stand in a match.
 *
 * The menu owns only what is NOT part of the map: the camera path, the frog
 * posed on the dais, and the two sparring in front of it.
 */

import * as THREE from '../lib/three.module.js?v=v126';
import { lerp, lookYaw } from './util.js?v=v126';
import { Atmosphere } from './atmosphere.js?v=v126';
import { FrogModel } from './frog.js?v=v126';
import { World } from './world.js?v=v126';
import { DEFAULT_MAP } from './maps.js?v=v126';

const _v = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _down = new THREE.Vector3(0, -1, 0);
// The camera's flattened facing and its right, for placing the fireflies.
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

/**
 * How far the menu camera stays above the ground beneath it.
 *
 * Enough to clear the pines it drifts past as well as the hillside itself —
 * skimming a treetop reads as a mistake almost as much as sinking into a hill.
 */
const MENU_CAM_CLEARANCE = 11;

/**
 * Where the frogs stand on the arena dais, and how big they are on screen.
 *
 * The scale is 2.0 rather than the 1.35 the old diorama used because the
 * stage moved: that scene was 260 across with the camera 30 from its subject,
 * this map is 420 with the camera 46 from the dais at its closest. At 1.35 the
 * frogs measured about twenty pixels and read as insects. This is a title
 * card, not a scale model — nothing here touches the gameplay frog.
 */
const STAGE = { x: 0, z: 0, heroX: -6.5, heroZ: 6.5, scale: 2.0 };

export class MenuScene {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.2, 900);
    this.time = 0;

    // The map itself, generated exactly as a match generates it. Synchronous
    // on purpose: it is 67ms, and splitting it across frames would mean the
    // title screen assembling itself in front of the player.
    this.world = new World(this.scene, DEFAULT_MAP).build();

    this._buildHero();
    this._buildDuel();
    this._buildFireflies();
    /**
     * The map's own sky and fog, so the menu is lit the way the match is.
     *
     * Same shape as the game's call in main.js — spread the map's preset, then
     * fill in the leaf count, which is a quality setting rather than a map
     * one. A map that asks for no leaves still gets none.
     */
    const A = this.world.map.atmosphere || {};
    this.atmo = new Atmosphere(this.scene, renderer, {
      ...A,
      leafCount: A.leaves === false ? 0 : 180,
    });

    this._buildCameraPath();
  }

  // ------------------------------------------------------------------ scene

  /** Terrain height, straight off the map. */
  height(x, z) {
    return this.world ? this.world.heightAt(x, z) : 0;
  }

  /**
   * The top of whatever solid thing is under (x, z) — dais, platform or bare
   * ground.
   *
   * The frogs are staged on the arena's stone dais, which stands 1.5 above the
   * terrain, so placing them by terrain height alone buries them to the knee.
   * Measured off the built world rather than written down, so moving the arena
   * moves the frogs with it.
   *
   * The ray starts 15 above the ground and not higher: the arena hangs a ring
   * of grapple lanterns 20 up, and a ray from the sky would land on one of
   * those and stand the frogs in mid-air.
   */
  _standingY(x, z) {
    const targets = [];
    if (this.world.terrainMesh) targets.push(this.world.terrainMesh);
    for (const k in this.world.batches) {
      const m = this.world.batches[k].mesh;
      if (m) targets.push(m);
    }
    const ground = this.world.heightAt(x, z);
    _ray.set(_v.set(x, ground + 15, z), _down);
    _ray.far = 40;
    const hit = _ray.intersectObjects(targets, false)[0];
    return hit ? hit.point.y : ground;
  }

  /** A ninja frog posed on the arena dais, idling and looking around. */
  _buildHero() {
    this.hero = new FrogModel(0x6cc24a, 'Frogshin', true);
    this.heroY = this._standingY(STAGE.heroX, STAGE.heroZ);
    this.hero.root.position.set(STAGE.heroX, this.heroY, STAGE.heroZ);
    this.hero.root.scale.setScalar(STAGE.scale);
    this.hero.root.rotation.y = 0.5;
    this.scene.add(this.hero.root);
    this.heroTimer = 3;
    this.heroAttack = 0;
  }

  /**
   * Two frogs sparring in the clearing below the shrine.
   *
   * They circle, rush in, trade a blow and drift apart again, so the title
   * screen has a fight going on in it rather than one frog standing on a
   * ledge. Driven by the same FrogModel the game uses, so they run, swing and
   * land with the real animation rather than a bespoke one.
   */
  _buildDuel() {
    /**
     * On the Lotus Arena's dais, which is where the game's own fights happen.
     *
     * The dais is stone and dead level, so one standing height serves the
     * whole circle — the test samples the ring and says so. It is also wide
     * enough (16 across) that the widest point of their orbit, 5.2 from the
     * centre, still leaves them a stride from the edge.
     */
    this.duelCentre = new THREE.Vector2(STAGE.x, STAGE.z);
    this.duelY = this._standingY(STAGE.x, STAGE.z);
    this.duel = [];
    for (let i = 0; i < 2; i++) {
      const m = new FrogModel(i ? 0xd9743a : 0x53b7e8, '', true);
      m.root.scale.setScalar(STAGE.scale);
      this.scene.add(m.root);
      this.duel.push({
        model: m, pos: new THREE.Vector3(), attack: 0, cooldown: i * 0.9,
        atkIndex: i, started: false,
      });
    }
    this.duelT = 0;
  }

  _updateDuel(dt) {
    if (!this.duel) return;
    this.duelT += dt;
    const t = this.duelT;
    /**
     * One pass every seven seconds: circle wide, rush in, trade, drift out.
     *
     * A curve rather than a state machine — it cannot get stuck between
     * states, and it loops with nothing to reset. The sixth power is what
     * makes the approach a sharp lunge instead of a slow drift: they spend
     * most of the cycle circling and only a moment inside each other's reach.
     */
    const close = Math.pow(Math.sin(((t % 7) / 7) * Math.PI), 6);
    const r = lerp(5.2, 1.7, close);
    const spin = t * 0.5 + Math.sin(t * 0.27) * 0.6;
    const C = this.duelCentre;

    for (let i = 0; i < 2; i++) {
      const d = this.duel[i];
      const a = spin + i * Math.PI;
      const x = C.x + Math.cos(a) * r, z = C.y + Math.sin(a) * r;
      _v.set(x, this.duelY, z);

      // Speed is taken from how far it ACTUALLY moved, so the legs cycle at
      // the rate the frog is travelling instead of a number picked to match.
      const step = _v.distanceTo(d.pos) / Math.max(dt, 1e-4);
      const speed = d.started ? Math.min(step, 20) : 0;
      d.pos.copy(_v);
      d.started = true;
      d.model.root.position.copy(_v);

      // Face the other one. lookYaw exists because subtracting these the
      // intuitive way turns the model around and points it away.
      const o = this.duel[1 - i];
      d.model.setFacing(lookYaw(d.pos.x, d.pos.z, o.pos.x, o.pos.z));

      if (close > 0.7 && d.attack <= 0 && d.cooldown <= 0) {
        d.attack = 1;
        d.cooldown = 2.4;
        d.atkIndex = (d.atkIndex + 1) % 3;
      }
      if (d.attack > 0) d.attack = Math.max(0, d.attack - dt / 0.34);
      if (d.cooldown > 0) d.cooldown -= dt;

      d.model.update(dt, {
        speed, moving: speed > 1.2, grounded: true, vy: 0, dashT: 0,
        attackT: d.attack, attackIndex: d.atkIndex,
        sprinting: speed > 11, throwT: 0, parrying: false,
        grappling: false, tongueTo: null, wallSliding: false,
        swimming: false, dead: false,
      });
    }
  }

  // ------------------------------------------------------------ camera path

  _buildCameraPath() {
    /**
     * A long, slow orbit of the Lotus Arena, breathing in and out.
     *
     * The radius wanders between 46 and 70 rather than holding steady, so the
     * loop does not read as a turntable: it swings in until the dais and the
     * sparring frogs fill the frame, then back out for the valley. It stays
     * inside 85 deliberately — measured around the arena, the ground holds
     * between -3 and 13 out to there, then climbs to 42 by 100 and 62 by 120
     * as the valley turns into the mountains that ring it. Flying out into
     * those means flying into them.
     *
     * The altitudes are 29-36 for a reason that only shows up in a picture:
     * the valley is forested, the pines top out near 20, and a camera level
     * with them spends half the loop looking at the back of a tree. From up
     * here the sight line to the arena clears the canopy and foliage passes
     * through the bottom of frame instead of across the middle.
     */
    this.path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(42, 30, 18),
      new THREE.Vector3(18, 30, 56),
      new THREE.Vector3(-40, 32, 52),
      new THREE.Vector3(-68, 36, 16),
      new THREE.Vector3(-46, 31, -32),
      new THREE.Vector3(-14, 29, -44),
      new THREE.Vector3(42, 32, -52),
      new THREE.Vector3(70, 35, -6),
    ], true, 'catmullrom', 0.5);

    // The look-at target orbits a smaller, offset loop so the framing keeps
    // changing instead of the camera simply circling a fixed point. It stays
    // low over the arena, which is where the frogs are and where the four
    // gateway torii stand — aiming high would tip the canopy back into shot.
    this.lookPath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 7, 0),
      new THREE.Vector3(16, 6, 10),
      new THREE.Vector3(-14, 9, -8),
      new THREE.Vector3(0, 7, -20),
      new THREE.Vector3(-18, 6, 12),
      new THREE.Vector3(14, 10, -14),
    ], true, 'catmullrom', 0.5);

    this.pathT = 0;
    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();
    this.updateCamera(0);
  }

  updateCamera(dt) {
    // ~90 seconds for a full loop: slow enough to feel cinematic.
    this.pathT = (this.pathT + dt / 90) % 1;
    this.path.getPointAt(this.pathT, this._camPos);
    this.lookPath.getPointAt((this.pathT * 0.7 + 0.15) % 1, this._camLook);

    // A gentle float on top of the spline.
    this._camPos.y += Math.sin(this.time * 0.35) * 1.4;

    /**
     * Never fly through the scenery.
     *
     * Several points on the spline sit BELOW the ground it is supposed to be
     * circling — the one at (46, 26, 52) is thirteen units inside a hillside,
     * and the camera spends about a third of the loop underground. From in
     * there the back faces of the terrain are culled, so the camera looks out
     * through the ground and sees sky: that pale slab with a hard edge along
     * the bottom of the title screen is not a hole in the world, it is the
     * view from inside one.
     *
     * Clamped here rather than by moving the spline, so the framing is
     * untouched everywhere it was already flying clear, and so a later edit
     * to the path cannot put the camera back inside a hill.
     */
    const ground = this.height(this._camPos.x, this._camPos.z);
    if (this._camPos.y < ground + MENU_CAM_CLEARANCE) {
      this._camPos.y = ground + MENU_CAM_CLEARANCE;
    }
    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this._camLook);
    this.camera.rotateZ(Math.sin(this.time * 0.21) * 0.012);
  }

  /**
   * FIREFLIES.
   *
   * The map already animates its own lanterns, water and grass, and two frogs
   * spar on the dais — but all of that is far away down the valley, and the
   * air between the camera and it was empty. A drifting light close to the
   * lens is what makes a background read as a place you are standing in
   * rather than a picture you are looking at, because it is the only thing
   * with visible parallax against the camera's own motion.
   *
   * One InstancedMesh, ninety of them, no shadows and no depth writes: a
   * firefly is a light, not a thing that is lit, and ninety shadow casters
   * for specks would cost more than everything else on this screen.
   *
   * They travel WITH the camera — see `_updateFireflies` — so the swarm is
   * always in shot without seeding them over the whole 420-unit map.
   */
  _buildFireflies() {
    const COUNT = 90;
    const geo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xd8ff9a, transparent: true, opacity: 0.9, depthWrite: false,
    });
    this.flies = new THREE.InstancedMesh(geo, mat, COUNT);
    this.flies.frustumCulled = false;
    this.flies.castShadow = false;
    this.flies.receiveShadow = false;
    this.scene.add(this.flies);

    // Each keeps its own drift, bob and blink so the swarm never pulses as
    // one — which is the thing that would make them read as a shader effect.
    /**
     * Placed in the CAMERA'S OWN AXES — ahead, beside, above — not in a box
     * centred on it.
     *
     * A centred box puts two thirds of the swarm behind the lens or out to
     * the sides: measured, 24 of 90 were ever in frame, and the nearest sat
     * 3.5 units from the camera where a firefly is a seventeen-pixel glowing
     * cube in your face. Ahead-only, at 20 to 52 units, they are between one
     * and seven pixels — which is what a firefly should be.
     */
    this._flyData = [];
    for (let i = 0; i < COUNT; i++) {
      this._flyData.push({
        ahead: 20 + Math.random() * 32,      // along the camera's forward
        side: (Math.random() - 0.5) * 52,    // along its right
        rise: -9 + Math.random() * 17,       // and plain world up
        drift: 0.35 + Math.random() * 0.9,
        phase: Math.random() * Math.PI * 2,
        bob: 0.6 + Math.random() * 1.6,
        blink: 0.5 + Math.random() * 1.7,
        size: 0.5 + Math.random() * 0.5,
      });
    }
    this._flyM = new THREE.Matrix4();
  }

  _updateFireflies(dt) {
    if (!this.flies) return;
    const cam = this.camera.position;
    const t = this.time;
    // The camera's own axes this frame, so the swarm sits in front of the
    // lens wherever the path has turned it.
    _fwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
    _fwd.normalize();
    _right.set(_fwd.z, 0, -_fwd.x);

    for (let i = 0; i < this._flyData.length; i++) {
      const f = this._flyData[i];
      // A slow circling wander, so they drift rather than slide.
      f.side += Math.sin(t * f.drift + f.phase) * dt * 1.6;
      f.ahead += Math.cos(t * f.drift * 0.8 + f.phase) * dt * 1.6;
      /**
       * Blinking is done with SCALE, not opacity: all ninety share one
       * material, so there is no per-instance opacity to animate — and
       * shrinking to nothing reads as a firefly going out just as well.
       */
      const lit = 0.35 + 0.65 * Math.max(0, Math.sin(t * f.blink + f.phase));
      const s = f.size * lit;
      this._flyM.makeScale(s, s, s);
      this._flyM.setPosition(
        cam.x + _fwd.x * f.ahead + _right.x * f.side,
        cam.y + f.rise + Math.sin(t * f.bob + f.phase) * 1.4,
        cam.z + _fwd.z * f.ahead + _right.z * f.side,
      );
      this.flies.setMatrixAt(i, this._flyM);
    }
    this.flies.instanceMatrix.needsUpdate = true;
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    this.time += dt;
    this.updateCamera(dt);
    this.atmo.update(dt, this.camera.position);
    // The world animates its own lanterns, water and practice ring, so the
    // menu no longer keeps a second copy of any of that.
    if (this.world) this.world.update(dt, this.camera.position);

    this._updateFireflies(dt);
    this._updateDuel(dt);

    // Hero frog: idles, and now and then hops or does a little flourish.
    // Guarded because dispose() drops it, and update can still be called once
    // more after the menu is torn down.
    if (!this.hero) return;
    this.heroTimer -= dt;
    if (this.heroTimer <= 0) {
      this.heroTimer = 4 + Math.random() * 5;
      if (Math.random() < 0.5) {
        this.hero.triggerFlip();
        this.hero.croak();
      } else {
        this.heroAttack = 0.35;
      }
    }
    if (this.heroAttack > 0) this.heroAttack -= dt;

    this.hero.root.rotation.y = 0.5 + Math.sin(this.time * 0.28) * 0.55;
    this.hero.update(dt, {
      speed: 0, vy: 0, grounded: true, moving: false,
      dashT: 0,
      attackT: this.heroAttack > 0 ? this.heroAttack / 0.35 : 0,
      attackIndex: 0,
      grappling: false, tongueTo: null, wallSliding: false, dead: false,
    });
  }

  dispose() {
    this.atmo.dispose();
    /**
     * The frogs dispose themselves, and go before the sweep below.
     *
     * Their geometry is SHARED with every frog in the game — FrogModel.dispose
     * knows to skip it, and the blanket traverse here does not, so leaving
     * them in it frees buffers the gameplay models are still using. It was
     * already doing that to the hero; the two duellists would have made it
     * three times over.
     */
    for (const f of [this.hero, ...(this.duel || []).map((d) => d.model)]) {
      if (!f) continue;
      this.scene.remove(f.root);
      f.dispose();
    }
    this.hero = null;
    this.duel = null;
    /**
     * Dropped before the sweep for the same reason the hero is guarded in
     * `update`: the loop can call update once more after a teardown, and
     * writing instance matrices into a disposed buffer is a crash on the
     * frame the match starts. The geometry and material are the fireflies'
     * own — nothing else uses them — so the blanket traverse below is the
     * right thing to free them.
     */
    this.flies = null;
    this._flyData = null;
    // The map gives back its own terrain, batches, water and lanterns. It has
    // to go before the sweep for the same reason the frogs do — it knows what
    // is safe to free and the blanket traverse does not.
    if (this.world) this.world.dispose();
    this.world = null;
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    this.scene.clear();
  }
}
