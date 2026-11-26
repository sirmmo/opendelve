import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, place, discard, preview, legalSpots, depths, nearby, pieceCells, key, countMobs, homeOf } from '../js/rules.js';
import { PIECES, HOMES, HOME_REACH, HOSTILE_REACH, HOSTILE, ROOMS } from '../js/pieces.js';
import { dig, populate, MOB_STATS, mobHp } from '../js/adventure.js';

function autoplay(seed, limit = 400) {
  const s = newGame(seed);
  for (let i = 0; i < limit && !s.over; i++) {
    const spots = legalSpots(s, s.queue[0]);
    if (!spots.length) { discard(s); continue; }
    let best = null;
    for (const c of spots.slice(0, 8)) {
      for (const o of c.options) {
        const p = preview(s, o.rot, o.x, o.y);
        if (!best || p.pts > best.pts) best = { ...o, pts: p.pts };
      }
    }
    place(s, best.rot, best.x, best.y);
  }
  return s;
}

const games = ['1', '3', '5'].map((seed) => autoplay(seed));

test('homes fill only with what they need near and no enemies close, and never empty', () => {
  let filled = 0;
  for (const s of games) {
    const depth = depths(s);
    for (const p of Object.values(s.pieces)) {
      if (!p.home) continue;
      filled++;
      const home = HOMES[p.home.kind];
      assert.equal(p.home.kind, homeOf(p));
      assert.ok(p.done, 'a home is a finished room');
      assert.equal(p.home.mob, home.mob);
      if (home.depth) assert.ok(depth[p.id] >= home.depth, 'haunts are deep');
      const near = nearby(s, p, HOME_REACH);
      for (const alts of home.needs) {
        assert.ok(near.some(({ p: o }) => o.done && alts.some((a) => (a === 'treasure' ? o.treasure : PIECES[o.kind].room === a))), `${p.home.kind} needs ${alts}`);
      }
      const foe = HOSTILE[home.kin];
      // An enemy home may have filled close by only after this one did; never both from the start.
      if (foe) {
        const close = near.filter(({ d, p: o }) => d <= HOSTILE_REACH && o.home && HOMES[o.home.kind].kin === foe);
        assert.ok(close.length === 0, `${p.home.kind} ${p.id} has enemies within ${HOSTILE_REACH}`);
      }
    }
    assert.equal(countMobs(s), s.stats.mobs);
  }
  assert.ok(filled > 5, `homes filled: ${filled}`);
});

test('homes keep their own style', () => {
  for (const s of games) {
    for (const p of Object.values(s.pieces)) {
      if (PIECES[p.kind].style) assert.equal(p.style, PIECES[p.kind].style, p.kind);
    }
  }
});

test('an adventure is dug the same from the same seed, and populated the same', () => {
  const a = dig('x1');
  const b = dig('x1');
  assert.deepEqual(a.pieces, b.pieces);
  assert.deepEqual(populate(a), populate(b));
  assert.notDeepEqual(Object.keys(dig('x2').pieces).length && dig('x2').pieces, a.pieces);
  assert.ok(Object.keys(a.pieces).length <= 61);
});

test('monsters stand in their pieces, none by the stairs, and every one can be fought', () => {
  for (const seed of ['m1', 'm2', 'm3']) {
    const s = dig(seed);
    const mobs = populate(s);
    const depth = depths(s);
    assert.ok(mobs.length >= 8, `${seed}: ${mobs.length} monsters`);
    const ids = new Set();
    for (const m of mobs) {
      assert.ok(!ids.has(m.id), 'unique ids');
      ids.add(m.id);
      assert.ok(MOB_STATS[m.mob], m.mob);
      assert.ok(depth[m.piece] > 2, 'the first pieces are quiet');
      const cells = new Set(pieceCells(s.pieces[m.piece]).map(([x, y]) => key(x, y)));
      assert.ok(cells.has(key(Math.floor(m.x), Math.floor(m.y))), `${m.id} stands in its piece`);
      assert.ok(mobHp(m) >= MOB_STATS[m.mob].hp);
    }
    // A home's residents are all there.
    for (const p of Object.values(s.pieces)) {
      if (p.home && depth[p.id] > 2) assert.ok(mobs.filter((m) => m.piece === p.id && m.mob === p.home.mob).length >= p.home.n);
      if (p.treasure) assert.ok(mobs.some((m) => m.piece === p.id), 'treasure is guarded');
    }
  }
});

test('every room kind has a name', () => {
  for (const k of Object.keys(HOMES)) if (k !== 'haunt') assert.ok(ROOMS[k], k);
});
