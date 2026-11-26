// Walking the dungeon in 3D: an adventurer (Kenney's animated human) at the foot of the stairs,
// a camera that follows, and a floor map made by casting rays down at the laid pieces, so walls,
// cave rocks, furniture and ruins all stand in the way. Which sides of a cell lead on comes from
// js/walk.js: joined doors do, bare rock and barred treasure gates don't. Climbing the stairs
// leaves.

import * as THREE from 'three';
import { clone as cloneSkinned } from '../vendor/jsm/utils/SkeletonUtils.js';
import { walkCells, spawn, stairsFrame, stairsDistance, stairsHeight, STAIRS, placeName } from './walk.js';
import { key, DX, DY, depths } from './rules.js';
import { ROOMS } from './pieces.js';

const RES = 8; // floor samples per cell side
const BLOCK_Y = 0.32; // anything standing higher than this (world units) is in the way
const SPEED = { walk: 2.4, run: 4.8 }; // world units a second
const STAIRS_HALF = 0.34; // half the stairway's width, in cells (the corridor walls, measured)
const TURN = 10; // how fast the adventurer turns to face where they go
const HERO_SCALE = 1.25;
const BARS_NEAR = 2.6; // world units from a barred gate at which its bars lift
const BARS_LIFT = 3.7; // how far, in the gate model's units (it is drawn at half size)

// Heights, encoded in the red channel: from -HEIGHT_FLOOR to HEIGHT_RANGE - HEIGHT_FLOOR.
const HEIGHT_RANGE = 5;
const HEIGHT_FLOOR = 0.5;
const HEIGHT = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  vertexShader: `varying float vY;
    void main() { vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `varying float vY;
    void main() { gl_FragColor = vec4(clamp((vY + ${HEIGHT_FLOOR.toFixed(2)}) / ${HEIGHT_RANGE.toFixed(1)}, 0.0, 1.0), 0.0, 0.0, 1.0); }`,
});

export class Walker {
  constructor(view, cell) {
    this.view = view;
    this.CELL = cell;
    this.active = false;
    this.cam = { yaw: 0, pitch: 0.82, dist: 6.5 };
    this.look = new THREE.Vector3();
    this.onEnter = null; // (name, depth) when walking into another piece
    this.onExit = null; // when climbing out up the stairs
  }

  start(state) {
    this.state = state;
    this.cells = walkCells(state);
    this.depths = depths(state);
    this.buildGrid();
    const s = spawn(state);
    const C = this.CELL;
    this.pos = new THREE.Vector3(s.x * C, this.floorAt(s.x * C, s.y * C), s.y * C);
    this.heading = Math.atan2(DX[s.face], DY[s.face]);
    // Behind the adventurer, looking the way they face.
    this.cam.yaw = Math.atan2(-DX[s.face], -DY[s.face]);
    this.cam.dist = 6.5;
    this.look.set(this.pos.x, this.pos.y + 0.9, this.pos.z);
    this.here = null;
    this.speed = 0;
    this.makeHero();
    this.bars = this.view.gates.children.filter((g) => g.userData.bars).map((g) => ({ gate: g, bars: g.userData.bars, lift: 0 }));
    this.active = true;
    this.enter(s.id);
  }

  stop() {
    this.active = false;
    for (const b of this.bars || []) b.bars.position.y = 0;
    this.bars = [];
    if (this.hero) this.view.scene.remove(this.hero);
    this.hero = null;
    this.mixer = null;
  }

  // ---------- the floor ----------

  // A grid over the dungeon's bounding box, RES samples a cell: 1 where one can stand, with the
  // floor's height. Built once, on starting a walk (nothing is laid while walking).
  buildGrid() {
    const C = this.CELL;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const k of this.cells.keys()) {
      const [x, y] = k.split(',').map(Number);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    this.gx = x0 - 1;
    this.gy = y0 - 1;
    this.gw = (x1 - x0 + 3) * RES;
    this.gh = (y1 - y0 + 3) * RES;
    const open = new Uint8Array(this.gw * this.gh);
    this.floor = new Float32Array(this.gw * this.gh);
    const top = this.heightMap();
    for (const [k, c] of this.cells) {
      const [cx, cy] = k.split(',').map(Number);
      const p = this.state.pieces[c.id];
      const stairs = p.kind === 'stairs' ? stairsFrame(p) : null;
      for (let j = 0; j < RES; j++) {
        for (let i = 0; i < RES; i++) {
          const u = cx + (i + 0.5) / RES;
          const v = cy + (j + 0.5) / RES;
          const idx = this.index(u, v);
          let ok = false;
          let h = 0;
          if (stairs) {
            // The steps are a ramp; the stairway is as wide as a corridor.
            const s = stairsDistance(stairs, u, v);
            const lateral = DX[stairs.door] === 0 ? Math.abs(u - (p.x + 0.5)) : Math.abs(v - (p.y + 0.5));
            ok = lateral <= STAIRS_HALF && s <= STAIRS.out + 0.3;
            h = stairsHeight(s);
          } else {
            h = top[idx];
            ok = h < BLOCK_Y;
            h = Math.max(0, h);
          }
          // The edge of a side that doesn't lead on is a wall (a barred gate, the end of a
          // corridor open onto rock), even where the model leaves a gap.
          if (ok && ((i === RES - 1 && c.sides[0] === 'shut') || (j === RES - 1 && c.sides[1] === 'shut')
            || (i === 0 && c.sides[2] === 'shut') || (j === 0 && c.sides[3] === 'shut'))) ok = false;
          open[idx] = ok ? 1 : 0;
          this.floor[idx] = h;
        }
      }
    }
    // Keep the adventurer's body clear of what is in the way: one sample all round.
    this.open = new Uint8Array(open.length);
    for (let y = 1; y < this.gh - 1; y++) {
      for (let x = 1; x < this.gw - 1; x++) {
        const i = y * this.gw + x;
        if (!open[i]) continue;
        let clear = 1;
        for (let dy = -1; dy <= 1 && clear; dy++) for (let dx = -1; dx <= 1; dx++) if (!open[i + dy * this.gw + dx]) { clear = 0; break; }
        this.open[i] = clear;
      }
    }
  }

  // The height of whatever stands highest at each sample, seen from straight above: the laid
  // pieces, drawn once on the GPU, a pixel a sample. Nothing drawn there reads as a wall.
  heightMap() {
    const v = this.view;
    const C = this.CELL;
    const w = this.gw;
    const h = this.gh;
    const span = { x: (w / RES) * C, z: (h / RES) * C };
    const cam = new THREE.OrthographicCamera(0, span.x, 0, -span.z, 1, 100);
    cam.position.set(this.gx * C, 50, this.gy * C);
    cam.up.set(0, 0, -1);
    cam.lookAt(this.gx * C, 0, this.gy * C);
    const target = new THREE.WebGLRenderTarget(w, h);
    const scene = new THREE.Scene();
    scene.overrideMaterial = HEIGHT;
    const parent = v.board.parent;
    for (const a of v.anims) a.fn(1); // finish any piece still dropping into place
    v.anims = [];
    scene.add(v.board);
    const r = v.renderer;
    const clear = r.getClearColor(new THREE.Color());
    const alpha = r.getClearAlpha();
    r.setRenderTarget(target);
    r.setClearColor(0xffffff, 1);
    r.clear();
    r.render(scene, cam);
    const px = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(target, 0, 0, w, h, px);
    r.setRenderTarget(null);
    r.setClearColor(clear, alpha);
    parent.add(v.board);
    target.dispose();
    // Rows come bottom first: the bottom of the picture is the south (+z) edge.
    const out = new Float32Array(w * h);
    for (let row = 0; row < h; row++) {
      for (let x = 0; x < w; x++) out[(h - 1 - row) * w + x] = (px[(row * w + x) * 4] / 255) * HEIGHT_RANGE - HEIGHT_FLOOR;
    }
    return out;
  }

  index(u, v) {
    const x = Math.floor((u - this.gx) * RES);
    const y = Math.floor((v - this.gy) * RES);
    if (x < 0 || y < 0 || x >= this.gw || y >= this.gh) return -1;
    return y * this.gw + x;
  }

  // Can one stand at world (wx, wz), coming from cell `from` ("x,y")?
  free(wx, wz, from) {
    const u = wx / this.CELL;
    const v = wz / this.CELL;
    const i = this.index(u, v);
    if (i < 0 || !this.open[i]) return false;
    const cx = Math.floor(u);
    const cy = Math.floor(v);
    const k = key(cx, cy);
    if (k === from) return true;
    const [fx, fy] = from.split(',').map(Number);
    const d = DX.findIndex((dx, n) => dx === cx - fx && DY[n] === cy - fy);
    const c = this.cells.get(from);
    return d >= 0 && !!c && c.sides[d] !== 'shut' && this.cells.has(k);
  }

  floorAt(wx, wz) {
    const i = this.index(wx / this.CELL, wz / this.CELL);
    return i < 0 ? 0 : this.floor[i];
  }

  cellOf(pos) {
    return key(Math.floor(pos.x / this.CELL), Math.floor(pos.z / this.CELL));
  }

  // ---------- the adventurer ----------

  makeHero() {
    const t = this.view.templates['character-human'];
    const hero = cloneSkinned(t);
    hero.scale.setScalar(HERO_SCALE);
    hero.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    // A torch's warm light, a little above and ahead of them.
    const torch = new THREE.PointLight(0xffc27a, 3.2, 7, 1.6);
    torch.position.set(0.25, 1.15, 0.35);
    hero.add(torch);
    this.mixer = new THREE.AnimationMixer(hero);
    const clips = this.view.clips['character-human'] || [];
    this.actions = {};
    for (const name of ['idle', 'walk', 'sprint']) {
      const clip = clips.find((c) => c.name === name);
      if (clip) this.actions[name] = this.mixer.clipAction(clip);
    }
    this.anim = null;
    this.play('idle');
    hero.position.copy(this.pos);
    hero.rotation.y = this.heading;
    this.view.scene.add(hero);
    this.hero = hero;
  }

  play(name) {
    if (this.anim === name || !this.actions[name]) return;
    const next = this.actions[name];
    next.reset().setEffectiveWeight(1).fadeIn(0.18).play();
    if (this.anim) this.actions[this.anim].fadeOut(0.18);
    this.anim = name;
  }

  enter(id) {
    if (this.here === id) return;
    this.here = id;
    const p = this.state.pieces[id];
    this.onEnter?.(placeName(this.state, p, ROOMS), this.depths[id] ?? null);
  }

  // ---------- each frame ----------

  // `input`: { x, z } (strafe right, forward; -1 to 1, from keys or the stick), run, turn (yaw
  // speed, radians a second).
  update(dt, input) {
    if (!this.active) return;
    const C = this.cam;
    C.yaw += (input.turn || 0) * dt;
    const fwd = { x: -Math.sin(C.yaw), z: -Math.cos(C.yaw) };
    const right = { x: -fwd.z, z: fwd.x };
    let mx = fwd.x * input.z + right.x * input.x;
    let mz = fwd.z * input.z + right.z * input.x;
    const mag = Math.min(1, Math.hypot(mx, mz));
    let moving = false;
    if (mag > 0.08) {
      const len = Math.hypot(mx, mz);
      mx /= len;
      mz /= len;
      const speed = (input.run ? SPEED.run : SPEED.walk) * mag;
      const step = speed * dt;
      const from = this.cellOf(this.pos);
      const nx = this.pos.x + mx * step;
      const nz = this.pos.z + mz * step;
      // Slide along walls: try the whole step, then each half of it.
      if (this.free(nx, nz, from)) { this.pos.x = nx; this.pos.z = nz; moving = true; }
      else if (Math.abs(mx) > 0.05 && this.free(nx, this.pos.z, from)) { this.pos.x = nx; moving = true; }
      else if (Math.abs(mz) > 0.05 && this.free(this.pos.x, nz, from)) { this.pos.z = nz; moving = true; }
      const want = Math.atan2(mx, mz);
      let d = want - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * TURN);
      this.play(moving ? (input.run && mag > 0.6 ? 'sprint' : 'walk') : 'idle');
      // Walking on, the view swings round behind them (gently, and not while it is being turned
      // by hand), so forward stays forward along a winding corridor.
      if (moving && input.steer && input.z > 0.2) {
        let b = this.heading + Math.PI - C.yaw;
        b = Math.atan2(Math.sin(b), Math.cos(b));
        C.yaw += b * Math.min(1, dt * 1.6 * input.z);
      }
    } else {
      this.play('idle');
    }
    const y = this.floorAt(this.pos.x, this.pos.z);
    this.pos.y += (y - this.pos.y) * Math.min(1, dt * 14);

    this.hero.position.copy(this.pos);
    this.hero.rotation.y = this.heading;
    this.mixer.update(dt);

    const c = this.cells.get(this.cellOf(this.pos));
    if (c) {
      this.enter(c.id);
      const p = this.state.pieces[c.id];
      if (p.kind === 'stairs' && stairsDistance(stairsFrame(p), this.pos.x / this.CELL, this.pos.z / this.CELL) > STAIRS.out) {
        this.onExit?.();
        return;
      }
    }
    this.liftBars(dt);
    this.place(dt);
  }

  // A treasure room's bars rise as the adventurer comes up to them, and drop behind them.
  liftBars(dt) {
    for (const b of this.bars) {
      const near = Math.hypot(b.gate.position.x - this.pos.x, b.gate.position.z - this.pos.z) < BARS_NEAR;
      b.lift += ((near ? 1 : 0) - b.lift) * Math.min(1, dt * (near ? 5 : 2.5));
      b.bars.position.y = b.lift * BARS_LIFT;
    }
  }

  // The camera behind and above, easing after the adventurer.
  place(dt) {
    const C = this.cam;
    C.pitch = Math.min(1.25, Math.max(0.35, C.pitch));
    C.dist = Math.min(14, Math.max(3.2, C.dist));
    const goal = new THREE.Vector3(this.pos.x, this.pos.y + 0.9, this.pos.z);
    this.look.lerp(goal, 1 - Math.exp(-dt * 10));
    const cp = Math.cos(C.pitch);
    const v = this.view;
    v.camera.position.set(
      this.look.x + Math.sin(C.yaw) * cp * C.dist,
      this.look.y + Math.sin(C.pitch) * C.dist,
      this.look.z + Math.cos(C.yaw) * cp * C.dist,
    );
    v.camera.lookAt(this.look);
    v.scene.fog.near = C.dist + 6;
    v.scene.fog.far = C.dist + 30;
    v.sun.position.set(this.look.x + 16, 34, this.look.z + 12);
    v.sun.target.position.copy(this.look);
  }
}
