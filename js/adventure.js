// Adventure: the dungeon as a place to explore and clear. The pure part: digging an adventure's
// dungeon from a seed, and who lives where. Like the rules, everything comes from the seed, so
// the same seed is the same adventure (js/fight.js does the fighting).

import * as R from './rules.js';
import { PIECES } from './pieces.js';

// The adventurer: hearts, and the sword's reach (world units) and rhythm (seconds).
export const HERO = { hp: 10, damage: 1, reach: 1.7, arc: 1.35, swing: 0.5, hitAt: 0.2 };

// Monsters: hearts, speed (world units a second), hit, reach, how far they notice you (world
// units), the pause before a blow lands and the rest after it. Deeper monsters are tougher.
export const MOB_STATS = {
  zombie: { hp: 3, speed: 1.2, damage: 1, reach: 1.1, sight: 5, windup: 0.6, rest: 1.2, gold: 2 },
  skeleton: { hp: 2, speed: 2.1, damage: 1, reach: 1.1, sight: 7, windup: 0.45, rest: 1.0, gold: 3 },
  orc: { hp: 4, speed: 2.3, damage: 1, reach: 1.2, sight: 7, windup: 0.5, rest: 0.9, gold: 4 },
  ghost: { hp: 2, speed: 2.7, damage: 1, reach: 1.1, sight: 9, windup: 0.4, rest: 1.3, gold: 3 },
  vampire: { hp: 8, speed: 2.5, damage: 2, reach: 1.25, sight: 8, windup: 0.5, rest: 0.8, gold: 20 },
};
export const toughness = (depth) => Math.floor(depth / 8);

// A chest in a treasure room: gold, and every heart back.
export const CHEST_GOLD = 25;
// A mushroom grove feeds a hungry adventurer once.
export const GROVE_HEAL = 4;

const ADVENTURE_PIECES = 60;

// Digs an adventure's dungeon: a delve played from `seed` by a digger who likes to finish what it
// starts (the best of a few ways, as the greedy test games do), up to ADVENTURE_PIECES pieces.
export function dig(seed) {
  const s = R.newGame(`adventure-${seed}`);
  for (let k = 0; k < 400 && !s.over && Object.keys(s.pieces).length < ADVENTURE_PIECES; k++) {
    const spots = R.legalSpots(s, s.queue[0]);
    if (!spots.length) { R.discard(s); continue; }
    let best = null;
    // A few spots, the ones the seed picks, each in every way it fits.
    const tries = Math.min(spots.length, 5);
    for (let i = 0; i < tries; i++) {
      const c = spots[Math.floor(R.rand(s) * spots.length)];
      for (const o of c.options) {
        const p = R.preview(s, o.rot, o.x, o.y);
        if (p && (!best || p.pts > best.pts)) best = { ...o, pts: p.pts };
      }
    }
    if (best) R.place(s, best.rot, best.x, best.y);
    else R.discard(s);
  }
  return s;
}

function rng(seed) {
  let x = R.hashSeed(seed);
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = Math.imul(x ^ (x >>> 15), x | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Who lives in a room that is nobody's home, by what the room is.
const ROOM_MOBS = {
  storeroom: (cave) => [cave ? 'orc' : 'zombie'],
  guardroom: (cave) => (cave ? ['orc', 'orc'] : ['skeleton', 'skeleton']),
  armoury: () => ['orc', 'orc'],
  crypt: () => ['skeleton', 'zombie'],
  hall: (cave) => (cave ? ['orc', 'orc', 'orc'] : ['skeleton', 'skeleton', 'zombie']),
  library: () => ['ghost'],
  shrine: () => ['ghost'],
  gallery: () => ['ghost', 'skeleton'],
  ossuary: () => ['skeleton'],
  pit: () => ['zombie'],
  coffins: () => ['skeleton'],
  warren: () => ['orc', 'orc'],
  grove: () => [],
};
const SAFE_DEPTH = 2; // the first pieces past the stairs are quiet
const VAMPIRE_DEPTH = 12;

// Every monster of a dungeon: { id, mob, piece, x, y } with x, y in cells (where it stands at
// first). Homes hold their residents; other finished rooms what suits them; deep treasure rooms
// a vampire; now and then something prowls a corridor.
export function populate(state) {
  const R2 = rng(`mobs-${state.seed}`);
  const depth = R.depths(state);
  const out = [];
  for (const p of Object.values(state.pieces).sort((a, b) => a.id - b.id)) {
    const d = depth[p.id];
    if (d === undefined || d <= SAFE_DEPTH || p.kind === 'stairs' || p.kind === 'ruin') continue;
    const room = PIECES[p.kind].room;
    const cave = p.style === 'cave';
    let mobs = [];
    if (p.home) mobs = Array(p.home.n).fill(p.home.mob);
    else if (room && p.done) mobs = ROOM_MOBS[room](cave);
    else if (room) mobs = R2() < 0.5 ? ROOM_MOBS[room](cave).slice(0, 1) : [];
    else if (R2() < 0.14) mobs = [cave ? 'orc' : R2() < 0.5 ? 'zombie' : 'skeleton'];
    if (p.treasure) mobs.push(d >= VAMPIRE_DEPTH && !mobs.includes('vampire') ? 'vampire' : mobs[0] || 'skeleton');
    const cells = R.pieceCells(p);
    const doors = new Set(R.pieceDoors(p).map(([x, y]) => R.key(x, y)));
    // Stand away from the doors where there is room to.
    const spots = cells.filter(([x, y]) => !doors.has(R.key(x, y)));
    const pool = spots.length ? spots : cells;
    mobs.forEach((mob, i) => {
      const [cx, cy] = pool[(i * 3 + Math.floor(R2() * pool.length)) % pool.length];
      out.push({ id: `${p.id}-${i}`, mob, piece: p.id, x: cx + 0.3 + R2() * 0.4, y: cy + 0.3 + R2() * 0.4, depth: d });
    });
  }
  return out;
}

// A monster's hearts, deeper ones tougher.
export const mobHp = (m) => MOB_STATS[m.mob].hp + toughness(m.depth);

