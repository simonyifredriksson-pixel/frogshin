/**
 * Sky, lighting and ambient world motion.
 *
 * The shadow-casting directional light follows the camera with a tight
 * frustum: a single 2048 map covering ~130 units around the player gives
 * crisp contact shadows without the cost of shadowing the whole 420-unit map.
 */

import * as THREE from '../lib/three.module.js?v=v29';
import { CFG } from './config.js?v=v29';
import { mulberry32 } from './util.js?v=v29';

const SKY_VERT = `
  varying vec3 vWorld;
  void main() {
    vWorld = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = `
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uBottom;
  uniform vec3 uSun;
  uniform vec3 uSunColor;
  varying vec3 vWorld;
  void main() {
    vec3 d = normalize(vWorld);
    float h = d.y * 0.5 + 0.5;
    // Two-stage gradient: deep blue overhead, warm haze at the horizon.
    vec3 col = mix(uBottom, uMid, smoothstep(0.35, 0.52, h));
    col = mix(col, uTop, smoothstep(0.5, 0.95, h));
    // Sun glow.
    float s = max(0.0, dot(d, normalize(uSun)));
    col += uSunColor * pow(s, 90.0) * 1.4;
    col += uSunColor * pow(s, 8.0) * 0.14;
    gl_FragColor = vec4(col, 1.0);
    // Match the tone mapping and output encoding the lit materials get.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const LEAF_VERT = `
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (320.0 / max(0.001, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const LEAF_FRAG = `
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25) discard;
    gl_FragColor = vec4(vColor, 0.85);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Atmosphere {
  constructor(scene, renderer, opts = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.time = 0;
    this.rnd = mulberry32(4242);
    this.windDir = new THREE.Vector2(0.8, 0.35).normalize();
    this.windStrength = 1.0;

    const sunDir = new THREE.Vector3(0.45, 0.62, 0.35).normalize();
    this.sunDir = sunDir;

    this.underwater = false;
    this._buildSky(opts);
    this._buildLights(opts);
    if (opts.underwater !== false) this._buildMotes(140);
    this._buildClouds(opts.cloudCount === undefined ? 26 : opts.cloudCount);
    if (opts.leaves !== false) {
      this._buildLeaves(opts.leafCount === undefined ? 260 : opts.leafCount);
    }
  }

  _buildSky(opts) {
    const geo = new THREE.SphereGeometry(600, 24, 16);
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(opts.skyTop || 0x2f7fd4) },
        uMid: { value: new THREE.Color(opts.skyMid || 0x7cc0ec) },
        uBottom: { value: new THREE.Color(opts.skyBottom || 0xcfe9f5) },
        uSun: { value: this.sunDir.clone() },
        uSunColor: { value: new THREE.Color(0xfff0c8) },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.scene.add(this.sky);

    // Distance fog tinted to the horizon so the map fades instead of ending.
    this.airFog = new THREE.Fog(
      opts.fogColor || 0xa9d4ea,
      opts.fogNear === undefined ? 90 : opts.fogNear,
      opts.fogFar === undefined ? 430 : opts.fogFar
    );
    // Underwater uses exponential fog: it closes in fast and evenly, which is
    // what gives that deep-blue "everything fades into the water" look.
    this.waterFog = new THREE.FogExp2(0x0a6ec4, 0.038);
    this.scene.fog = this.airFog;
  }

  /**
   * Swap the whole scene between the above-water and underwater looks.
   * Cheap enough to call every frame; it early-outs when nothing changed.
   */
  setUnderwater(v) {
    if (v === this.underwater) return;
    this.underwater = v;

    this.scene.fog = v ? this.waterFog : this.airFog;
    // The sky sphere opts out of fog, so it has to be hidden explicitly or it
    // would shine through the water as a bright band.
    if (this.sky) this.sky.visible = !v;
    if (this.cloudMesh) this.cloudMesh.visible = !v;
    if (this.leaves) this.leaves.visible = !v;
    if (this.motes) this.motes.visible = v;

    // Sunlight is absorbed by water: dim and cool the lighting.
    if (this.sun) {
      this.sun.intensity = v ? 0.75 : 1.5;
      this.sun.color.setHex(v ? 0x9fd4ff : 0xfff2d6);
    }
    if (this.hemi) {
      this.hemi.intensity = v ? 0.95 : 0.72;
      this.hemi.color.setHex(v ? 0x59b6ee : 0xbfe0ff);
      this.hemi.groundColor.setHex(v ? 0x0d3f6b : 0x4a5a30);
    }
  }

  /** Suspended particles that drift past the camera underwater. */
  _buildMotes(count) {
    this.moteCount = count;
    this.motePos = new Float32Array(count * 3);
    this.moteVel = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this._resetMote(i, true, { x: 0, y: 0, z: 0 });
      const b = 0.7 + this.rnd() * 0.3;
      col[i * 3] = 0.7 * b; col[i * 3 + 1] = 0.88 * b; col[i * 3 + 2] = b;
      size[i] = 0.05 + this.rnd() * 0.12;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.motePos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      vertexShader: LEAF_VERT, fragmentShader: LEAF_FRAG,
      transparent: true, depthWrite: false,
    });
    this.motes = new THREE.Points(geo, mat);
    this.motes.frustumCulled = false;
    this.motes.visible = false;
    this.scene.add(this.motes);
  }

  _resetMote(i, initial, around) {
    const r = 26;
    this.motePos[i * 3]     = around.x + (this.rnd() * 2 - 1) * r;
    this.motePos[i * 3 + 1] = around.y + (this.rnd() * 2 - 1) * r * 0.7;
    this.motePos[i * 3 + 2] = around.z + (this.rnd() * 2 - 1) * r;
    this.moteVel[i * 3]     = (this.rnd() - 0.5) * 0.35;
    this.moteVel[i * 3 + 1] = 0.15 + this.rnd() * 0.35;   // slow rise
    this.moteVel[i * 3 + 2] = (this.rnd() - 0.5) * 0.35;
  }

  _buildLights(opts) {
    // Sky/ground bounce — gives the shadowed side of the frog a cool tint.
    const hemi = new THREE.HemisphereLight(0xbfe0ff, 0x4a5a30, 0.72);
    this.scene.add(hemi);
    this.hemi = hemi;

    const sun = new THREE.DirectionalLight(0xfff2d6, 1.5);
    sun.position.copy(this.sunDir).multiplyScalar(80);
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    if (CFG.gfx.shadows && opts.shadows !== false) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const d = 78;
      sun.shadow.camera.left = -d;
      sun.shadow.camera.right = d;
      sun.shadow.camera.top = d;
      sun.shadow.camera.bottom = -d;
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = 320;
      sun.shadow.bias = -0.0012;
      sun.shadow.normalBias = 0.035;
    }

    const fill = new THREE.DirectionalLight(0x9fc4e8, 0.28);
    fill.position.set(-0.6, 0.4, -0.5);
    this.scene.add(fill);
  }

  _buildClouds(count) {
    if (count <= 0) return;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshLambertMaterial({
      color: 0xffffff, emissive: 0xdfeaf5, emissiveIntensity: 0.55,
      transparent: true, opacity: 0.95, fog: false,
    });
    // Each cloud is a clump of 4-6 blobs; one InstancedMesh holds them all.
    const blobs = [];
    this.clouds = [];
    for (let i = 0; i < count; i++) {
      const cx = (this.rnd() * 2 - 1) * 360;
      const cz = (this.rnd() * 2 - 1) * 360;
      const cy = 105 + this.rnd() * 85;
      const scale = 9 + this.rnd() * 16;
      const cloud = { x: cx, y: cy, z: cz, parts: [], speed: 0.6 + this.rnd() * 0.9 };
      const n = 4 + Math.floor(this.rnd() * 3);
      for (let k = 0; k < n; k++) {
        const off = {
          x: (this.rnd() - 0.5) * scale * 2.2,
          y: (this.rnd() - 0.5) * scale * 0.45,
          z: (this.rnd() - 0.5) * scale * 1.5,
          s: scale * (0.5 + this.rnd() * 0.6),
        };
        cloud.parts.push(off);
        blobs.push({ cloud, off });
      }
      this.clouds.push(cloud);
    }

    const mesh = new THREE.InstancedMesh(geo, mat, blobs.length);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.scene.add(mesh);
    this.cloudMesh = mesh;
    this.cloudBlobs = blobs;
    this._updateClouds();
  }

  _updateClouds() {
    if (!this.cloudMesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < this.cloudBlobs.length; i++) {
      const b = this.cloudBlobs[i];
      v.set(b.cloud.x + b.off.x, b.cloud.y + b.off.y, b.cloud.z + b.off.z);
      // Squash vertically — chunky, flat-bottomed storybook clouds.
      s.set(b.off.s, b.off.s * 0.55, b.off.s * 0.8);
      m.compose(v, q, s);
      this.cloudMesh.setMatrixAt(i, m);
    }
    this.cloudMesh.instanceMatrix.needsUpdate = true;
  }

  _buildLeaves(count) {
    this.leafCount = count;
    this.leafPos = new Float32Array(count * 3);
    this.leafVel = new Float32Array(count * 3);
    this.leafPhase = new Float32Array(count);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const palette = [
      [0.42, 0.68, 0.26], [0.55, 0.75, 0.28], [0.86, 0.62, 0.22],
      [0.78, 0.38, 0.22], [0.62, 0.78, 0.35],
    ];
    for (let i = 0; i < count; i++) {
      this._resetLeaf(i, true, { x: 0, y: 20, z: 0 });
      const c = palette[Math.floor(this.rnd() * palette.length)];
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      size[i] = 0.16 + this.rnd() * 0.2;
      this.leafPhase[i] = this.rnd() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.leafPos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.ShaderMaterial({
      vertexShader: LEAF_VERT, fragmentShader: LEAF_FRAG,
      transparent: true, depthWrite: false,
    });
    this.leaves = new THREE.Points(geo, mat);
    this.leaves.frustumCulled = false;
    this.scene.add(this.leaves);
  }

  /** Recycle one leaf into the volume above/around the camera. */
  _resetLeaf(i, initial, around) {
    const r = 55;
    const a = this.rnd() * Math.PI * 2;
    const d = this.rnd() * r;
    this.leafPos[i * 3] = around.x + Math.cos(a) * d;
    this.leafPos[i * 3 + 1] = around.y + (initial ? this.rnd() * 40 : 22 + this.rnd() * 16);
    this.leafPos[i * 3 + 2] = around.z + Math.sin(a) * d;
    this.leafVel[i * 3] = (this.rnd() - 0.5) * 0.6;
    this.leafVel[i * 3 + 1] = -(0.7 + this.rnd() * 1.1);
    this.leafVel[i * 3 + 2] = (this.rnd() - 0.5) * 0.6;
  }

  /** Ambient wind gust value in 0..1, shared by cloth and leaves. */
  get gust() {
    return 0.6 + Math.sin(this.time * 0.23) * 0.25 + Math.sin(this.time * 0.71) * 0.15;
  }

  update(dt, cameraPos) {
    this.time += dt;

    // Sky follows the camera so it never gets left behind.
    if (this.sky) this.sky.position.copy(cameraPos);

    // Keep the shadow frustum centred on the action.
    if (this.sun) {
      this.sun.position.set(
        cameraPos.x + this.sunDir.x * 120,
        cameraPos.y + this.sunDir.y * 120,
        cameraPos.z + this.sunDir.z * 120
      );
      this.sun.target.position.copy(cameraPos);
      this.sun.target.updateMatrixWorld();
    }

    // Drifting clouds.
    if (this.clouds) {
      const w = this.gust;
      let moved = false;
      for (const c of this.clouds) {
        c.x += this.windDir.x * c.speed * w * dt * 2.2;
        c.z += this.windDir.y * c.speed * w * dt * 2.2;
        // Wrap around a generous box so clouds never run out.
        if (c.x > 420) c.x -= 840; else if (c.x < -420) c.x += 840;
        if (c.z > 420) c.z -= 840; else if (c.z < -420) c.z += 840;
        moved = true;
      }
      if (moved) this._updateClouds();
    }

    // Suspended motes, only simulated while they are actually visible.
    if (this.motes && this.underwater) {
      for (let i = 0; i < this.moteCount; i++) {
        const i3 = i * 3;
        const ph = this.time * 0.8 + i;
        this.motePos[i3]     += (this.moteVel[i3] + Math.sin(ph) * 0.12) * dt;
        this.motePos[i3 + 1] += this.moteVel[i3 + 1] * dt;
        this.motePos[i3 + 2] += (this.moteVel[i3 + 2] + Math.cos(ph * 0.8) * 0.12) * dt;
        const dx = this.motePos[i3] - cameraPos.x;
        const dy = this.motePos[i3 + 1] - cameraPos.y;
        const dz = this.motePos[i3 + 2] - cameraPos.z;
        if (dx * dx + dy * dy + dz * dz > 30 * 30) this._resetMote(i, false, cameraPos);
      }
      this.motes.geometry.attributes.position.needsUpdate = true;
    }

    // Falling leaves, recycled around the camera so density stays constant.
    if (this.leaves && !this.underwater) {
      const w = this.gust;
      for (let i = 0; i < this.leafCount; i++) {
        const i3 = i * 3;
        const ph = this.leafPhase[i] + this.time * 2.2;
        // Flutter: leaves sway sideways as they fall.
        this.leafPos[i3] += (this.leafVel[i3] + Math.sin(ph) * 1.1 + this.windDir.x * w * 2.4) * dt;
        this.leafPos[i3 + 1] += this.leafVel[i3 + 1] * dt;
        this.leafPos[i3 + 2] += (this.leafVel[i3 + 2] + Math.cos(ph * 0.8) * 1.1 + this.windDir.y * w * 2.4) * dt;

        const dx = this.leafPos[i3] - cameraPos.x;
        const dz = this.leafPos[i3 + 2] - cameraPos.z;
        if (this.leafPos[i3 + 1] < cameraPos.y - 26 || dx * dx + dz * dz > 70 * 70) {
          this._resetLeaf(i, false, cameraPos);
        }
      }
      this.leaves.geometry.attributes.position.needsUpdate = true;
    }
  }

  dispose() {
    if (this.sky) { this.scene.remove(this.sky); this.sky.geometry.dispose(); this.skyMat.dispose(); }
    if (this.leaves) { this.scene.remove(this.leaves); this.leaves.geometry.dispose(); this.leaves.material.dispose(); }
    if (this.cloudMesh) { this.scene.remove(this.cloudMesh); this.cloudMesh.geometry.dispose(); this.cloudMesh.material.dispose(); }
  }
}
