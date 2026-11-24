// The 3D dungeon: loads the Kenney models, keeps one group per laid piece in step with the
// game state, frames joined doorways with arches, furnishes finished rooms, draws the ghost
// piece and the doorways it can go, and turns screen points into grid cells.

import * as THREE from 'three';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import { PIECES } from './pieces.js';
import { layout, shapeOf, pieceDoors, pieceAt, depths, DX, DY, key } from './rules.js';
import { DOOR } from './opd.js';

export const CELL = 2; // world units per grid cell (models are 4 units per cell)
const MODEL_SCALE = CELL / 4;
const PROP_SCALE = 1.35;
const TAU = Math.PI * 2;

const KIT = ['corridor', 'corridor-corner', 'corridor-junction', 'corridor-intersection', 'corridor-end',
  'room-small', 'room-small-variation', 'room-corner', 'room-wide', 'room-wide-variation', 'room-large',
  'room-large-variation', 'gate', 'gate-metal-bars', 'stairs'];
const PROPS = ['banner', 'barrel', 'chair', 'character-human', 'character-orc', 'column', 'pot',
  'rocks', 'stones', 'table', 'trap', 'weapon-spear', 'weapon-sword', 'shield-round',
  'shield-rectangle', 'wood-support', 'key', 'stairs'];
// Treasure from the KayKit Dungeon Pack (glTF sharing one texture), in models/treasure/.
const TREASURE = ['chest_gold', 'chest_large_gold', 'chest_mimic', 'coin_stack_small', 'coin_stack_medium',
  'coin_stack_large', 'rocks_gold', 'key_gold'];
const KAYKIT = 0.42; // KayKit pieces are about 2.4 times the size of Kenney's props.

function prng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// Centre of a piece in world space.
export function pieceCenter(kind, rot, x, y) {
  const L = layout(kind, rot);
  return new THREE.Vector3((x + L.w / 2) * CELL, 0, (y + L.h / 2) * CELL);
}

export function centerOf(p) {
  const L = shapeOf(p);
  return new THREE.Vector3((p.x + L.w / 2) * CELL, 0, (p.y + L.h / 2) * CELL);
}

// Imported ruins are drawn from their cells: old stone floor, walls wherever the floor ends.
const RUIN_WALL = { h: 1.7, t: 0.32 };
const ruinFloorGeo = new THREE.BoxGeometry(CELL, 0.1, CELL);
const ruinWallGeo = new THREE.BoxGeometry(CELL + RUIN_WALL.t, RUIN_WALL.h, RUIN_WALL.t);
const ruinFloorMat = new THREE.MeshStandardMaterial({ color: 0x9c7a63, roughness: 1 });
const ruinFloorAlt = new THREE.MeshStandardMaterial({ color: 0x92715b, roughness: 1 });
const ruinWallMat = new THREE.MeshStandardMaterial({ color: 0x7f7898, roughness: 0.95 });

// ---------- furniture ----------
// Positions are in the piece's own unturned frame, in world units from its centre.

function furniture(p, style, R) {
  const room = PIECES[p.kind].room;
  const out = [];
  const add = (m, x, z, ry = 0, s = 1) => out.push({ m, x, z, ry, s });
  const jitter = () => (R() - 0.5) * 0.3;
  switch (room) {
    case 'storeroom':
      add('barrel', -1.7 + jitter(), -1.7 + jitter());
      add('barrel', -1.15, -1.85, R() * TAU);
      add('pot', 1.75, -1.6, R() * TAU);
      add(R() < 0.5 ? 'barrel' : 'pot', 1.7, 1.7, R() * TAU);
      add('pot', -1.75, 1.6, R() * TAU);
      if (style === 'cave') add('stones', 0.9, 1.4, R() * TAU);
      break;
    case 'guardroom':
      add('table', 0.6, 0.6, Math.PI / 4);
      add('chair', 1.4, 0.2, -Math.PI / 2);
      add('chair', 0.2, 1.5, Math.PI);
      add('weapon-spear', 1.9, -0.8);
      add('weapon-sword', -0.6, 1.9, 0.3);
      break;
    case 'armoury':
      for (let i = 0; i < 4; i++) add(i % 2 ? 'shield-round' : 'shield-rectangle', -3 + i * 2, -1.95, 0);
      add('weapon-spear', -3.6, 1.6);
      add('weapon-spear', -3.2, 1.75);
      add('weapon-sword', 3.4, 1.6, 0.4);
      add('barrel', 3.8, -1.7);
      break;
    case 'crypt':
      for (const x of [-2.4, 0, 2.4]) {
        add('column', x, -1.4);
        add('column', x, 1.4);
      }
      add('pot', -3.7, 0.2, R() * TAU);
      add(style === 'cave' ? 'rocks' : 'stones', 3.6, -0.3, R() * TAU, 0.8);
      add('trap', 1.2, 0, 0, 0.8);
      break;
    case 'hall':
      add('table', 0, 0, 0, 1.2);
      add('chair', -0.9, 0, Math.PI / 2);
      add('chair', 0.9, 0, -Math.PI / 2);
      add('chair', 0, 0.8, Math.PI);
      for (const [x, z] of [[-2.9, -2.9], [2.9, -2.9], [-2.9, 2.9], [2.9, 2.9]]) add('column', x, z);
      add('banner', -1.6, -3.7);
      add('banner', 1.6, -3.7);
      add(style === 'cave' ? 'character-orc' : 'character-human', 1.6, 1.8, Math.PI * 0.85);
      break;
  }
  if (p.treasure) out.push(...hoard(room, style, R));
  if (style === 'cave' && room && room !== 'hall') add('character-orc', -0.3, 0.4, R() * TAU);
  return out;
}

// A treasure room's hoard: a gold chest (the big one in halls and crypts; one chest in eight is a
// mimic), coin stacks, a gold key, and gold ore in caves.
// A treasure room's hoard: a gold chest (the big one in halls and crypts; one chest in eight is a
// mimic), coin stacks, a gold key, and gold ore in caves. Halls keep theirs in the corner between
// the table and the east columns: the only spot clear in every large room (both room models have a
// pillar near the middle, and the cave variation has rocks to the west). Crypts keep it west of the
// middle column pair.
const HOARD = {
  hall: { chest: [3.0, -1.3, -Math.PI / 2], coins: [[2.1, -2.2], [2.3, -0.6], [3.4, 0.1]], key: [2.0, -1.4], ore: [3.3, -2.3] },
  crypt: { chest: [-1.1, -0.5, 0], coins: [[-2.15, 0.05], [-0.35, 0.25], [-1.6, 0.75]], key: [-0.4, -0.75], ore: [-2.7, -0.7] },
  room: { chest: [0.3, -1.0, 0], coins: [[-0.75, -0.45], [1.05, -0.25]], key: [1.0, -1.25], ore: [-1.3, -1.2] },
};

function hoard(room, style, R) {
  const out = [];
  const add = (m, [x, z], ry, s = 1) => out.push({ m: `treasure/${m}`, x, z, ry, s: KAYKIT * s });
  const big = room === 'hall' || room === 'crypt';
  const at = HOARD[room] || HOARD.room;
  const chest = R() < 0.125 ? 'chest_mimic' : big ? 'chest_large_gold' : 'chest_gold';
  add(chest, at.chest, at.chest[2] + R() * 0.6 - 0.3);
  const stacks = ['coin_stack_small', 'coin_stack_medium', 'coin_stack_large'];
  at.coins.forEach((c, i) => add(i === 0 ? stacks[big ? 2 : 1] : stacks[Math.floor(R() * (big ? 3 : 2))], c, R() * TAU));
  add('key_gold', at.key, R() * TAU, 0.8);
  if (style === 'cave') add('rocks_gold', at.ore, R() * TAU, 0.8);
  return out;
}

function corridorBits(p, style, R) {
  const out = [];
  if (p.kind === 'stairs') return out;
  const roll = R();
  if (style === 'cave' && roll < 0.35) out.push({ m: 'stones', x: (R() - 0.5) * 0.8, z: (R() - 0.5) * 0.8, ry: R() * TAU, s: 0.7 });
  else if (style === 'dungeon' && roll < 0.12) out.push({ m: 'barrel', x: 0.55, z: 0.55, ry: R() * TAU, s: 0.9 });
  else if (roll > 0.94) out.push({ m: 'key', x: 0, z: 0, ry: R() * TAU, s: 0.9 });
  return out;
}

// ---------- the view ----------

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x1b1724, 45, 110);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
    this.cam = { target: new THREE.Vector3(1, 0, -2), yaw: 0.3, pitch: 1.0, dist: 22 };
    this.camGoal = null;
    this.shift = 0;
    this.shiftGoal = 0;

    this.scene.add(new THREE.HemisphereLight(0xd9d2ff, 0x3a2c22, 1.7));
    const sun = new THREE.DirectionalLight(0xffe7c4, 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 100 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    this.sun = sun;
    this.scene.add(sun, sun.target);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshStandardMaterial({ color: 0x2c2638, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.board = new THREE.Group();
    this.gates = new THREE.Group();
    this.markers = new THREE.Group();
    this.lore = new THREE.Group();
    this.scene.add(this.board, this.gates, this.markers, this.lore);
    this.views = new Map();
    this.anims = [];
    this.templates = {};
    this.offsets = {};
    this.ghost = null;
    this.ghostKey = '';
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.ray = new THREE.Raycaster();
    this.clock = new THREE.Clock();
    this.onFrame = null;

    this.markerGeo = new THREE.PlaneGeometry(CELL * 0.86, CELL * 0.86).rotateX(-Math.PI / 2);
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0xffcf6b, transparent: true, opacity: 0.25, depthWrite: false });
    this.markerDim = new THREE.MeshBasicMaterial({ color: 0xffcf6b, transparent: true, opacity: 0.09, depthWrite: false });
    this.markerHot = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.6, depthWrite: false });
    const h = CELL * 0.43;
    this.ringGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-h, 0.03, -h), new THREE.Vector3(h, 0.03, -h), new THREE.Vector3(h, 0.03, h), new THREE.Vector3(-h, 0.03, h), new THREE.Vector3(-h, 0.03, -h),
    ]);
    this.ringMat = new THREE.LineBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.8 });

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  async load(onProgress) {
    const loader = new GLTFLoader();
    const jobs = [];
    for (const style of ['dungeon', 'cave']) for (const m of KIT) jobs.push([`${style}/${m}`, `models/${style}/${m}.glb`, true]);
    for (const m of PROPS) jobs.push([m, `models/props/${m}.glb`, false]);
    for (const m of TREASURE) jobs.push([`treasure/${m}`, `models/treasure/${m}.gltf`, false]);
    let done = 0;
    await Promise.all(jobs.map(async ([name, url, kit]) => {
      const gltf = await loader.loadAsync(url);
      gltf.scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      if (kit) {
        // Kit pieces are centred on their footprint except the stairs; find the offset.
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const c = box.getCenter(new THREE.Vector3());
        this.offsets[name] = new THREE.Vector3(Math.round(c.x / 2) * 2, 0, Math.round(c.z / 2) * 2);
      }
      this.templates[name] = gltf.scene;
      onProgress?.(++done / jobs.length);
    }));
    this.thumbs = new Thumbs(this);
  }

  model(name) {
    const t = this.templates[name];
    if (!t) throw new Error('missing model ' + name);
    return t.clone(true);
  }

  ruinGroup(p) {
    const g = new THREE.Group();
    const L = p.shape;
    const open = new Set(L.doors.map(([x, y, d]) => `${x},${y},${d}`));
    const mine = new Set(L.cells.map(([x, y]) => `${x},${y}`));
    for (const [cx, cy] of L.cells) {
      const f = new THREE.Mesh(ruinFloorGeo, (p.x + cx + p.y + cy) % 2 ? ruinFloorMat : ruinFloorAlt);
      f.position.set((cx + 0.5) * CELL, 0.05, (cy + 0.5) * CELL);
      f.receiveShadow = true;
      g.add(f);
      for (let d = 0; d < 4; d++) {
        if (open.has(`${cx},${cy},${d}`) || mine.has(`${cx + DX[d]},${cy + DY[d]}`)) continue;
        const w = new THREE.Mesh(ruinWallGeo, ruinWallMat);
        const off = CELL / 2 - RUIN_WALL.t / 2;
        w.position.set((cx + 0.5) * CELL + DX[d] * off, RUIN_WALL.h / 2, (cy + 0.5) * CELL + DY[d] * off);
        if (d % 2 === 0) w.rotation.y = Math.PI / 2;
        w.castShadow = true;
        w.receiveShadow = true;
        g.add(w);
      }
    }
    const prop = (name, x, z, ry = 0, s = 1) => {
      const o = this.model(name);
      o.scale.setScalar(PROP_SCALE * s);
      o.position.set(x, 0.1, z);
      o.rotation.y = ry;
      g.add(o);
    };
    if (p.door) {
      const t = p.door.type;
      const along = p.door.dir.x !== 0; // passage runs east-west
      if (t !== DOOR.SECRET && t !== DOOR.EMPTY) {
        const gate = this.model(`dungeon/${t === DOOR.PORTCULLIS || t === DOOR.BARRED ? 'gate-metal-bars' : 'gate'}`);
        gate.scale.setScalar(MODEL_SCALE * 0.92);
        gate.position.set(CELL / 2, 0, CELL / 2);
        gate.rotation.y = along ? Math.PI / 2 : 0;
        g.add(gate);
      }
      // The steps climb out through the door, towards the side that leads off the map (the
      // import lists it last), or along the door's axis. The model's high end is its north (-z).
      const { x: ax, y: ay } = p.door.dir;
      const sides = L.doors.filter(([x, y, d]) => x === 0 && y === 0 && Math.abs(DX[d]) === Math.abs(ax) && Math.abs(DY[d]) === Math.abs(ay));
      const out = sides.length ? { x: DX[sides[sides.length - 1][2]], y: DY[sides[sides.length - 1][2]] } : p.door.dir;
      const climb = Math.atan2(-out.x, -out.y);
      if (t === DOOR.STAIRS || t === DOOR.STEPS || t === DOOR.EXIT) prop('stairs', CELL / 2, CELL / 2, climb, 0.9);
    }
    if (p.rect?.ending) {
      prop('treasure/chest_gold', (L.w / 2) * CELL, (L.h / 2) * CELL - 0.3, 0, KAYKIT);
      prop('treasure/coin_stack_medium', (L.w / 2) * CELL + 0.8, (L.h / 2) * CELL + 0.2, 0.5, KAYKIT);
    }
    if (p.rect?.rotunda) prop('column', (L.w / 2) * CELL, (L.h / 2) * CELL);
    g.userData.top = new THREE.Group();
    g.position.set(p.x * CELL, 0, p.y * CELL);
    return g;
  }

  // A piece's group, centred on its footprint, turned.
  pieceGroup(p, extras = []) {
    if (p.kind === 'ruin') return this.ruinGroup(p);
    const name = `${p.style}/${PIECES[p.kind].model}`;
    const g = new THREE.Group();
    const inner = new THREE.Group();
    const m = this.model(name);
    m.scale.setScalar(MODEL_SCALE);
    m.position.copy(this.offsets[name]).multiplyScalar(-MODEL_SCALE);
    inner.add(m);
    const top = new THREE.Group();
    for (const d of extras) {
      const o = this.model(d.m);
      o.scale.setScalar(PROP_SCALE * (d.s || 1));
      o.position.set(d.x, 0, d.z);
      o.rotation.y = d.ry || 0;
      top.add(o);
    }
    inner.add(top);
    inner.rotation.y = -p.rot * Math.PI / 2;
    g.add(inner);
    g.userData.top = top;
    g.position.copy(pieceCenter(p.kind, p.rot, p.x, p.y));
    return g;
  }

  sync(state, { animate = true } = {}) {
    const seen = new Set();
    for (const p of Object.values(state.pieces)) {
      const k = String(p.id);
      seen.add(k);
      const vis = [p.kind, p.style, p.rot, p.x, p.y, p.done, p.treasure, p.shape?.doors.length].join('|');
      const cur = this.views.get(k);
      if (cur && cur.vis === vis) continue;
      const R = prng(p.v * 7919 + 13);
      const extras = PIECES[p.kind].room ? (p.done ? furniture(p, p.style, R) : []) : corridorBits(p, p.style, R);
      const g = this.pieceGroup(p, extras);
      this.board.add(g);
      if (cur) {
        this.board.remove(cur.group);
        if (animate) this.furnish(g);
      } else if (animate) {
        this.drop(g);
      }
      this.views.set(k, { group: g, vis });
    }
    for (const [k, v] of this.views) {
      if (!seen.has(k)) {
        this.board.remove(v.group);
        this.views.delete(k);
      }
    }
    this.syncGates(state);
    this.syncLore(state);
  }

  // An arch in every joined doorway that leads into a room; bars on treasure rooms.
  syncGates(state) {
    this.gates.clear();
    const done = new Set();
    for (const p of Object.values(state.pieces)) {
      if (!PIECES[p.kind].room) continue;
      for (const [x, y, d] of pieceDoors(p)) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        const o = pieceAt(state, nx, ny);
        if (!o) continue;
        const k = [key(x, y), key(nx, ny)].sort().join('|');
        if (done.has(k)) continue;
        done.add(k);
        const gate = this.model(`${p.style}/${p.treasure ? 'gate-metal-bars' : 'gate'}`);
        gate.scale.setScalar(MODEL_SCALE);
        gate.position.set((x + 0.5 + DX[d] * 0.5) * CELL, 0, (y + 0.5 + DY[d] * 0.5) * CELL);
        gate.rotation.y = d % 2 === 0 ? Math.PI / 2 : 0;
        this.gates.add(gate);
      }
    }
  }

  // Columns from an imported map.
  syncLore(state) {
    const k = state.opd ? state.seed : '';
    if (this.loreKey === k) return;
    this.loreKey = k;
    this.lore.clear();
    for (const c of state.opd?.columns || []) {
      const o = this.model('column');
      o.scale.setScalar(PROP_SCALE);
      o.position.set(c.x * CELL, 0.1, c.y * CELL);
      this.lore.add(o);
    }
  }

  clear() {
    for (const v of this.views.values()) this.board.remove(v.group);
    this.views.clear();
    this.gates.clear();
    this.lore.clear();
    this.loreKey = null;
  }

  drop(g) {
    const y0 = 2.2;
    g.position.y = y0;
    this.tween(0.36, (k) => { g.position.y = y0 * (1 - easeOutBack(k)); });
  }

  furnish(g) {
    const top = g.userData.top;
    top.children.forEach((o, i) => {
      const s = o.scale.x;
      o.scale.setScalar(0.001);
      this.tween(0.3, (k) => o.scale.setScalar(Math.max(0.001, s * easeOutBack(k))), 0.15 + i * 0.05);
    });
  }

  tween(dur, fn, delay = 0) {
    this.anims.push({ t: -delay, dur, fn });
  }

  // ---------- spots and ghost ----------

  setSpots(spots, hot) {
    this.markers.clear();
    for (const s of spots) {
      const isHot = hot && hot.x === s.x && hot.y === s.y;
      const m = new THREE.Mesh(this.markerGeo, isHot ? this.markerHot : s.breach ? this.markerDim : this.markerMat);
      m.position.set((s.x + 0.5) * CELL, 0.03, (s.y + 0.5) * CELL);
      m.renderOrder = 1;
      this.markers.add(m);
      if (s.breach && !isHot) continue;
      const line = new THREE.LineLoop(this.ringGeo, this.ringMat);
      line.position.copy(m.position);
      this.markers.add(line);
    }
  }

  setGhost(piece, option) {
    if (!piece || !option) {
      if (this.ghost) this.ghost.visible = false;
      return;
    }
    const k = [piece.kind, piece.style, option.rot, option.x, option.y].join('|');
    if (k !== this.ghostKey) {
      if (this.ghost) this.scene.remove(this.ghost);
      const g = this.pieceGroup({ ...piece, ...option });
      g.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = false;
        o.material = ghostMaterial(o.material);
      });
      this.ghost = g;
      this.ghostKey = k;
      this.scene.add(g);
    }
    this.ghost.visible = true;
  }

  // ---------- camera and picking ----------

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 55 : 40;
    this.applyShift();
  }

  // On a tall screen the HUD covers the top and the bottom: keep the scene centred in the
  // space between them by shifting the projection (picking follows, it uses the same matrix).
  setInsets(top, bottom) {
    this.insets = { top, bottom };
    const tall = window.innerWidth < window.innerHeight;
    this.shiftGoal = tall ? (top - bottom) / 2 : 0;
  }

  applyShift() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (Math.abs(this.shift) > 0.5) this.camera.setViewOffset(w, h, 0, -this.shift, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  updateCamera() {
    const c = this.cam;
    c.pitch = Math.min(1.4, Math.max(0.55, c.pitch));
    c.dist = Math.min(90, Math.max(8, c.dist));
    const cp = Math.cos(c.pitch);
    this.camera.position.set(
      c.target.x + Math.sin(c.yaw) * cp * c.dist,
      c.target.y + Math.sin(c.pitch) * c.dist,
      c.target.z + Math.cos(c.yaw) * cp * c.dist,
    );
    this.camera.lookAt(c.target);
    // Fog stays behind what is in view, however far out the camera is.
    this.scene.fog.near = Math.max(45, c.dist + 25);
    this.scene.fog.far = this.scene.fog.near + 65;
    this.sun.position.set(c.target.x + 16, 34, c.target.z + 12);
    this.sun.target.position.copy(c.target);
  }

  groundAt(x, y) {
    const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.groundPlane, p) ? p : null;
  }

  cellAt(x, y) {
    const p = this.groundAt(x, y);
    return p ? { x: Math.floor(p.x / CELL), y: Math.floor(p.z / CELL) } : null;
  }

  toScreen(wx, wz, wy = 0) {
    const p = new THREE.Vector3(wx, wy, wz).project(this.camera);
    return { x: (p.x + 1) / 2 * window.innerWidth, y: (1 - p.y) / 2 * window.innerHeight };
  }

  cellToScreen(x, y, wy = 0) {
    return this.toScreen((x + 0.5) * CELL, (y + 0.5) * CELL, wy);
  }

  frame(state) {
    const box = new THREE.Box3();
    const points = [];
    for (const p of Object.values(state.pieces)) {
      const L = shapeOf(p);
      for (const [x, y] of [[p.x, p.y], [p.x + L.w, p.y], [p.x, p.y + L.h], [p.x + L.w, p.y + L.h]]) {
        for (const h of [0, 1.7]) points.push(new THREE.Vector3(x * CELL, h, y * CELL));
      }
    }
    for (const q of points) box.expandByPoint(q);
    const c = box.getCenter(new THREE.Vector3()).setY(0);
    this.camGoal = { target: c, dist: this.fitDistance(c, points, 20, 90) };
  }

  // The camera distance at which every point fits on screen, between the HUD bars on a tall
  // screen, seen from the current angle.
  fitDistance(target, points, min, max) {
    const keep = { target: this.cam.target.clone(), dist: this.cam.dist, shift: this.shift };
    const h = window.innerHeight;
    const tall = window.innerWidth < h && this.insets;
    const top = tall ? 1 - (2 * (this.insets.top + 10)) / h : 0.88;
    const bottom = tall ? -1 + (2 * (this.insets.bottom + 10)) / h : -0.88;
    this.shift = this.shiftGoal;
    this.applyShift();
    const v = new THREE.Vector3();
    const fits = (d) => {
      this.cam.target.copy(target);
      this.cam.dist = d;
      this.updateCamera();
      this.camera.updateMatrixWorld();
      return points.every((p) => {
        v.copy(p).project(this.camera);
        return v.z < 1 && Math.abs(v.x) <= 0.92 && v.y <= top && v.y >= bottom;
      });
    };
    let lo = min;
    let hi = max;
    if (fits(lo)) hi = lo;
    else for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
    this.cam.target.copy(keep.target);
    this.cam.dist = keep.dist;
    this.shift = keep.shift;
    this.applyShift();
    this.updateCamera();
    return hi;
  }


  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, this.clock.getDelta());
      const now = this.clock.elapsedTime;
      this.anims = this.anims.filter((a) => {
        a.t += dt;
        if (a.t < 0) return true;
        const k = Math.min(1, a.t / a.dur);
        a.fn(k);
        return k < 1;
      });
      if (this.shift !== this.shiftGoal) {
        const d = this.shiftGoal - this.shift;
        this.shift = Math.abs(d) < 0.5 ? this.shiftGoal : this.shift + d * (1 - Math.exp(-dt * 8));
        this.applyShift();
      }
      if (this.camGoal) {
        const g = this.camGoal;
        const f = 1 - Math.exp(-dt * 5);
        this.cam.target.lerp(g.target, f);
        this.cam.dist += (g.dist - this.cam.dist) * f;
        if (this.cam.target.distanceTo(g.target) < 0.01 && Math.abs(g.dist - this.cam.dist) < 0.02) this.camGoal = null;
      }
      if (this.ghost?.visible) this.ghost.position.y = 0.25 + Math.sin(now * 3) * 0.08;
      this.markerMat.opacity = 0.2 + Math.sin(now * 2.5) * 0.08;
      this.updateCamera();
      this.onFrame?.(dt);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }
}

const ghostCache = new Map();
function ghostMaterial(mat) {
  if (!ghostCache.has(mat.uuid)) {
    const m = mat.clone();
    m.transparent = true;
    m.opacity = 0.72;
    m.emissive = new THREE.Color(0x3a2a10);
    ghostCache.set(mat.uuid, m);
  }
  return ghostCache.get(mat.uuid);
}

function easeOutBack(k) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
}

// Small renders of upcoming pieces for the hand.
class Thumbs {
  constructor(view) {
    this.view = view;
    this.canvas = document.createElement('canvas');
    this.size = 192;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.size, this.size, false);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xe6e0ff, 0x4a3a2c, 2.0));
    const sun = new THREE.DirectionalLight(0xffe7c4, 2.2);
    sun.position.set(4, 8, 5);
    this.scene.add(sun);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  }

  draw(target, piece, rot = 0) {
    const ctx = target.getContext('2d');
    ctx.clearRect(0, 0, target.width, target.height);
    if (!piece) return;
    const L = layout(piece.kind, rot);
    const g = this.view.pieceGroup({ ...piece, rot, x: -L.w / 2, y: -L.h / 2 });
    const span = Math.max(L.w, L.h) * CELL;
    this.camera.position.set(0, span * 2.1 + 5.5, span * 1.3 + 3.6);
    this.camera.lookAt(0, 0.4, 0);
    this.scene.add(g);
    this.renderer.render(this.scene, this.camera);
    this.scene.remove(g);
    ctx.drawImage(this.canvas, 0, 0, target.width, target.height);
  }
}

export { depths };
