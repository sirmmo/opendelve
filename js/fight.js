// Adventure in 3D: the monsters, the fight, and the dark. Rides on the walker (js/walker.js): it
// moves the adventurer and keeps the floor map; this adds monsters that notice you and give
// chase through the dungeon, the sword, the chests and groves, and hides every room until you
// have been in it or looked through its door.

import * as THREE from 'three';
import { clone as cloneSkinned } from '../vendor/jsm/utils/SkeletonUtils.js';
import { MOB_MODEL } from './view.js';
import { RES } from './walker.js';
import { HERO, MOB_STATS, mobHp, CHEST_GOLD, GROVE_HEAL } from './adventure.js';
import { linksOf } from './rules.js';
import { PIECES, MOBS } from './pieces.js';

const MOB_SCALE = 1.25; // as the adventurer
const FLOW_EVERY = 0.25; // seconds between working out the ways to the adventurer
const FLOW_FAR = 120; // samples: monsters further than this by the floor lose the trail
const INVULNERABLE = 0.8; // seconds after a blow before the next can land
const KNOCK = 0.5; // world units a blow pushes
const SPREAD = 0.75; // monsters keep this far apart

export class Fight {
  constructor(view, walker, cell) {
    this.view = view;
    this.walker = walker;
    this.CELL = cell;
    this.active = false;
    // Callbacks: the HUD, a blow taken, a line to show, the end either way, something to save.
    this.onHud = null;
    this.onHurt = null;
    this.onNews = null;
    this.onDefeat = null;
    this.onVictory = null;
    this.onSave = null;
  }

  // `mobs`: from populate(); `saved`: what an earlier visit left ({ slain, hp, gold, revealed,
  // opened, fed }), or nothing.
  start(state, mobs, saved = {}) {
    this.state = state;
    this.hp = saved.hp ?? HERO.hp;
    this.gold = saved.gold ?? 0;
    this.slain = new Set(saved.slain || []);
    this.opened = new Set(saved.opened || []);
    this.fed = new Set(saved.fed || []);
    this.revealed = new Set();
    this.total = mobs.length;
    this.cool = 0;
    this.swing = -1;
    this.invulnerable = 0;
    this.flowIn = 0;
    this.over = false;
    this.dist = null;
    this.walker.frozen = false;
    // Everything dark, then light what the adventurer can see.
    for (const v of this.view.views.values()) v.group.visible = false;
    for (const g of this.view.gates.children) g.visible = false;
    this.view.lore.visible = false;
    this.mobs = mobs.filter((m) => !this.slain.has(m.id)).map((m) => this.spawn(m));
    for (const id of saved.revealed || []) this.reveal(id, false);
    if (this.walker.here) this.reveal(this.walker.here);
    this.sword();
    this.active = true;
    this.hud();
  }

  stop() {
    this.active = false;
    for (const m of this.mobs || []) this.view.scene.remove(m.obj);
    this.mobs = [];
    for (const v of this.view.views.values()) v.group.visible = true;
    for (const g of this.view.gates.children) g.visible = true;
    this.view.lore.visible = true;
  }

  // What to keep, to carry on later.
  snapshot() {
    return {
      hp: this.hp, gold: this.gold, slain: [...this.slain], revealed: [...this.revealed],
      opened: [...this.opened], fed: [...this.fed],
    };
  }

  // ---------- the dark ----------

  // A piece seen: it and every piece through its doors. Entering a piece reveals it, and the
  // monsters in what comes into view are shown.
  reveal(id, enter = true) {
    const p = this.state.pieces[id];
    if (!p) return;
    const show = (q) => {
      const v = this.view.views.get(String(q.id));
      if (v) v.group.visible = true;
    };
    if (!this.revealed.has(id)) {
      this.revealed.add(id);
      show(p);
      for (const o of linksOf(this.state, p)) show(o);
      const seen = (q) => this.view.views.get(String(q))?.group.visible;
      for (const g of this.view.gates.children) {
        const [a, b] = g.userData.between || [];
        if (seen(a) || seen(b)) g.visible = true;
      }
      for (const m of this.mobs) m.obj.visible = !!seen(m.piece) || m.obj.visible;
    }
    if (enter) this.arrive(p);
  }

  // Walking into a treasure room opens its chest; into a mushroom grove, a meal.
  arrive(p) {
    if (p.treasure && !this.opened.has(p.id)) {
      this.opened.add(p.id);
      this.gold += CHEST_GOLD;
      this.hp = HERO.hp;
      this.walker.oneShot('pick-up', 1.4);
      this.onNews?.(`<b>A chest!</b> +${CHEST_GOLD} gold, and every heart back`);
      this.hud();
      this.onSave?.();
    }
    if (PIECES[p.kind].room === 'grove' && p.done && !this.fed.has(p.id) && this.hp < HERO.hp) {
      this.fed.add(p.id);
      this.hp = Math.min(HERO.hp, this.hp + GROVE_HEAL);
      this.onNews?.(`<b>Mushrooms</b> · +${GROVE_HEAL} hearts`);
      this.hud();
    }
  }

  // ---------- the monsters ----------

  spawn(m) {
    const obj = cloneSkinned(this.view.templates[MOB_MODEL[m.mob]]);
    obj.scale.setScalar(MOB_SCALE);
    // Their own materials, to flash red when struck; ghosts see-through.
    const ghost = m.mob === 'ghost';
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false;
      o.material = o.material.clone();
      if (ghost) Object.assign(o.material, { transparent: true, opacity: 0.72 });
    });
    const mixer = new THREE.AnimationMixer(obj);
    const clips = this.view.clips[MOB_MODEL[m.mob]] || [];
    const actions = {};
    for (const name of ['idle', 'walk', 'sprint', 'attack-melee-right', 'die']) {
      const clip = clips.find((c) => c.name === name);
      if (clip) actions[name] = mixer.clipAction(clip);
    }
    const stats = MOB_STATS[m.mob];
    const C = this.CELL;
    const at = this.nearestOpen(m.x * C, m.y * C);
    const mob = {
      ...m, obj, mixer, actions, stats, hp: mobHp(m), max: mobHp(m), anim: null,
      pos: new THREE.Vector3(at.x, 0, at.z), home: at.clone(), heading: Math.random() * Math.PI * 2,
      state: 'idle', t: Math.random() * 3, flash: 0, wander: null,
    };
    obj.position.copy(mob.pos);
    obj.visible = false;
    this.view.scene.add(obj);
    this.animate(mob, 'idle');
    mob.actions.idle && (mob.actions.idle.time = Math.random() * 2);
    return mob;
  }

  // The open floor nearest a point (monsters are placed by cell, the floor knows better).
  nearestOpen(x, z) {
    const w = this.walker;
    const C = this.CELL;
    for (let r = 0; r <= 12; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const px = x + (dx * C) / RES;
          const pz = z + (dz * C) / RES;
          const i = w.index(px / C, pz / C);
          if (i >= 0 && w.open[i]) return new THREE.Vector3(px, 0, pz);
        }
      }
    }
    return new THREE.Vector3(x, 0, z);
  }

  animate(m, name, once = false) {
    if (m.anim === name && !once) return;
    const a = m.actions[name];
    if (!a) return;
    a.reset();
    if (once) {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    } else {
      a.setLoop(THREE.LoopRepeat, Infinity);
    }
    a.timeScale = name === 'walk' && m.mob === 'zombie' ? 0.6 : 1;
    a.fadeIn(0.12).play();
    if (m.anim && m.actions[m.anim] && m.anim !== name) m.actions[m.anim].fadeOut(0.12);
    m.anim = name;
  }

  // ---------- the adventurer's sword ----------

  sword() {
    const hero = this.walker.hero;
    const arm = hero?.getObjectByName('arm-right');
    if (!arm || arm.getObjectByName('adventure-sword')) return;
    const s = this.view.model('weapon-sword');
    s.name = 'adventure-sword';
    s.scale.setScalar(0.85);
    s.position.set(-0.02, -0.11, 0.03);
    s.rotation.set(Math.PI / 2, 0, 0); // the blade forward from the fist
    arm.add(s);
  }

  attack() {
    const w = this.walker;
    if (!this.active || this.over || this.cool > 0 || w.frozen) return;
    this.cool = HERO.swing;
    this.swing = 0;
    // Turn to the nearest monster in reach, so a thumb need not aim.
    let best = null;
    for (const m of this.mobs) {
      if (m.state === 'dead' || !m.obj.visible) continue;
      const d = Math.hypot(m.pos.x - w.pos.x, m.pos.z - w.pos.z);
      if (d < HERO.reach + 0.8 && (!best || d < best.d)) best = { m, d };
    }
    if (best) w.heading = Math.atan2(best.m.pos.x - w.pos.x, best.m.pos.z - w.pos.z);
    w.oneShot('attack-melee-right', 1.6);
  }

  strike() {
    const w = this.walker;
    this.flow(); // where everything stands now
    for (const m of this.mobs) {
      if (m.state === 'dead') continue;
      const dx = m.pos.x - w.pos.x;
      const dz = m.pos.z - w.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > HERO.reach || !this.within(m.pos, HERO.reach)) continue; // not through a wall
      let a = Math.atan2(dx, dz) - w.heading;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(a) > HERO.arc && d > 0.6) continue;
      m.hp -= HERO.damage;
      m.flash = 0.18;
      m.state = m.hp > 0 ? 'chase' : m.state;
      if (d > 0.01) this.push(m, (dx / d) * KNOCK, (dz / d) * KNOCK);
      if (m.hp <= 0) this.kill(m);
    }
  }

  kill(m) {
    m.state = 'dead';
    m.t = 0;
    this.animate(m, 'die', true);
    this.slain.add(m.id);
    this.gold += m.stats.gold;
    const left = this.mobs.filter((x) => x.state !== 'dead').length;
    this.onNews?.(`${MOBS[m.mob].name} slain · +${m.stats.gold} gold`);
    this.hud();
    this.onSave?.();
    if (!left) {
      this.over = true;
      setTimeout(() => this.onVictory?.(), 1200);
    }
  }

  push(m, dx, dz) {
    const w = this.walker;
    const from = w.cellOf(m.pos);
    for (let k = 1; k > 0.1; k /= 2) {
      if (w.free(m.pos.x + dx * k, m.pos.z + dz * k, from)) {
        m.pos.x += dx * k;
        m.pos.z += dz * k;
        return;
      }
    }
  }

  // A monster's blow lands on the adventurer.
  hurt(m) {
    const w = this.walker;
    if (this.invulnerable > 0 || this.over) return;
    this.hp = Math.max(0, this.hp - m.stats.damage);
    this.invulnerable = INVULNERABLE;
    const dx = w.pos.x - m.pos.x;
    const dz = w.pos.z - m.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    w.knock((dx / d) * KNOCK, (dz / d) * KNOCK);
    this.onHurt?.();
    this.hud();
    if (this.hp <= 0) {
      this.over = true;
      w.frozen = true;
      w.oneShot('die', 0.9);
      setTimeout(() => this.onDefeat?.(), 2200);
    }
  }

  hud() {
    this.onHud?.({ hp: this.hp, max: HERO.hp, gold: this.gold, slain: this.slain.size, total: this.total });
  }

  // ---------- the trail ----------

  // How many samples each bit of floor is from the adventurer, out to FLOW_FAR: monsters follow
  // it downhill, round corners and through doors.
  flow() {
    const w = this.walker;
    const n = w.gw * w.gh;
    if (!this.dist || this.dist.length !== n) {
      this.dist = new Int16Array(n);
      this.queue = new Int32Array(n);
    }
    const dist = this.dist;
    dist.fill(-1);
    const start = w.index(w.pos.x / this.CELL, w.pos.z / this.CELL);
    if (start < 0) return;
    let head = 0;
    let tail = 0;
    dist[start] = 0;
    this.queue[tail++] = start;
    const W = w.gw;
    while (head < tail) {
      const i = this.queue[head++];
      const d = dist[i];
      if (d >= FLOW_FAR) continue;
      for (const j of [i + 1, i - 1, i + W, i - W]) {
        if (j < 0 || j >= n || dist[j] >= 0 || !w.open[j]) continue;
        dist[j] = d + 1;
        this.queue[tail++] = j;
      }
    }
  }

  // Is `pos` at most `reach` world units from the adventurer along the floor (so no blow passes
  // through a wall)?
  within(pos, reach) {
    const i = this.walker.index(pos.x / this.CELL, pos.z / this.CELL);
    const steps = i < 0 || !this.dist ? -1 : this.dist[i];
    return steps >= 0 && steps <= (reach * RES) / this.CELL + 2;
  }

  // The way to go from `pos`: towards the neighbouring sample nearest the adventurer.
  downhill(pos) {
    const w = this.walker;
    const i = w.index(pos.x / this.CELL, pos.z / this.CELL);
    if (i < 0 || this.dist[i] < 0) return null;
    const W = w.gw;
    let best = i;
    for (const j of [i + 1, i - 1, i + W, i - W, i + W + 1, i + W - 1, i - W + 1, i - W - 1]) {
      if (j >= 0 && j < this.dist.length && this.dist[j] >= 0 && this.dist[j] < this.dist[best]) best = j;
    }
    if (best === i) return null;
    const C = this.CELL;
    const x = ((best % W) + 0.5) / RES + w.gx;
    const z = (Math.floor(best / W) + 0.5) / RES + w.gy;
    return { x: x * C, z: z * C, steps: this.dist[i] };
  }

  // ---------- each frame ----------

  update(dt) {
    if (!this.active) return;
    const w = this.walker;
    this.cool -= dt;
    this.invulnerable -= dt;
    if (this.swing >= 0) {
      this.swing += dt;
      if (this.swing >= HERO.hitAt) {
        this.swing = -1;
        this.strike();
      }
    }
    this.flowIn -= dt;
    if (this.flowIn <= 0) {
      this.flowIn = FLOW_EVERY;
      this.flow();
    }
    // The hero blinks while a blow can't land.
    if (w.hero) w.hero.visible = this.invulnerable <= 0 || this.over || Math.floor(this.invulnerable * 12) % 2 === 0;
    for (const m of this.mobs) this.think(m, dt);
    this.mobs = this.mobs.filter((m) => !m.gone);
    // Keep out of each other's way.
    for (let i = 0; i < this.mobs.length; i++) {
      for (let j = i + 1; j < this.mobs.length; j++) {
        const a = this.mobs[i];
        const b = this.mobs[j];
        if (a.state === 'dead' || b.state === 'dead') continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.001 && d < SPREAD) {
          const k = (SPREAD - d) / 2 / d;
          this.push(a, -dx * k, -dz * k);
          this.push(b, dx * k, dz * k);
        }
      }
    }
  }

  think(m, dt) {
    const w = this.walker;
    m.t += dt;
    m.mixer.update(dt);
    if (m.flash > 0) {
      m.flash -= dt;
      const on = m.flash > 0;
      m.obj.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setRGB(on ? 0.9 : 0, on ? 0.1 : 0, on ? 0.05 : 0); });
    }
    if (m.state === 'dead') {
      // Down, then into the floor.
      if (m.t > 1.4) m.obj.position.y -= dt * 0.7;
      if (m.t > 2.6) {
        this.view.scene.remove(m.obj);
        m.gone = true;
      }
      return;
    }
    const dx = w.pos.x - m.pos.x;
    const dz = w.pos.z - m.pos.z;
    const d = Math.hypot(dx, dz);
    const seen = m.obj.visible;
    const step = m.stats.speed * dt;
    if (m.state === 'idle' || m.state === 'wander') {
      // Notice the adventurer when near, by the floor, in a room that has been seen.
      const trail = this.downhill(m.pos);
      if (seen && !this.over && d < m.stats.sight && trail && trail.steps < (m.stats.sight * RES * 1.6) / this.CELL) {
        m.state = 'chase';
      } else {
        this.idle(m, dt);
      }
    }
    if (m.state === 'chase') {
      if (this.over) { m.state = 'idle'; this.animate(m, 'idle'); return; }
      if (d < m.stats.reach && this.within(m.pos, m.stats.reach)) {
        m.state = 'windup';
        m.t = 0;
        this.animate(m, 'attack-melee-right', true);
      } else {
        const to = d < 1.4 ? { x: w.pos.x, z: w.pos.z } : this.downhill(m.pos);
        if (!to) {
          m.state = 'idle';
          this.animate(m, 'idle');
        } else {
          this.move(m, to.x - m.pos.x, to.z - m.pos.z, step);
          this.animate(m, m.stats.speed > 2 ? 'sprint' : 'walk');
        }
      }
    }
    if (m.state === 'windup') {
      m.heading = turnTo(m.heading, Math.atan2(dx, dz), dt * 10);
      if (m.t >= m.stats.windup) {
        if (d < m.stats.reach + 0.35 && this.within(m.pos, m.stats.reach + 0.35)) this.hurt(m);
        m.state = 'rest';
        m.t = 0;
      }
    }
    if (m.state === 'rest' && m.t >= m.stats.rest) {
      m.state = 'chase';
      this.animate(m, 'idle');
    }
    // Ghosts float and bob.
    const lift = m.mob === 'ghost' ? 0.25 + Math.sin(m.t * 2.2 + m.home.x) * 0.08 : 0;
    m.obj.position.set(m.pos.x, w.floorAt(m.pos.x, m.pos.z) + lift, m.pos.z);
    m.obj.rotation.y = m.heading;
  }

  // Standing about at home, now and then a few steps somewhere near.
  idle(m, dt) {
    if (!m.wander && m.t > 2.5 + (m.home.x % 2)) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.4 + Math.random() * 1.2;
      m.wander = { x: m.home.x + Math.sin(a) * r, z: m.home.z + Math.cos(a) * r, until: 3 };
      m.t = 0;
    }
    if (m.wander) {
      const dx = m.wander.x - m.pos.x;
      const dz = m.wander.z - m.pos.z;
      m.wander.until -= dt;
      if (Math.hypot(dx, dz) < 0.1 || m.wander.until <= 0 || !this.move(m, dx, dz, m.stats.speed * 0.4 * dt)) {
        m.wander = null;
        m.t = 0;
        this.animate(m, 'idle');
      } else {
        this.animate(m, 'walk');
      }
    } else {
      this.animate(m, 'idle');
    }
  }

  // A step towards (dx, dz), sliding along walls. False if stuck.
  move(m, dx, dz, step) {
    const w = this.walker;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return false;
    const ux = dx / len;
    const uz = dz / len;
    const s = Math.min(step, len);
    const from = w.cellOf(m.pos);
    m.heading = turnTo(m.heading, Math.atan2(ux, uz), 0.25);
    const nx = m.pos.x + ux * s;
    const nz = m.pos.z + uz * s;
    if (w.free(nx, nz, from)) { m.pos.x = nx; m.pos.z = nz; return true; }
    if (Math.abs(ux) > 0.1 && w.free(nx, m.pos.z, from)) { m.pos.x = nx; return true; }
    if (Math.abs(uz) > 0.1 && w.free(m.pos.x, nz, from)) { m.pos.z = nz; return true; }
    return false;
  }
}

function turnTo(from, to, k) {
  let d = to - from;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return from + d * Math.min(1, k);
}
