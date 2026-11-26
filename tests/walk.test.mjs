import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newGame, place, discard, preview, legalSpots, key, DX, DY, depths, pieceAt } from '../js/rules.js';
import { importOPD } from '../js/opd.js';
import { walkCells, spawn, stairsFrame, stairsDistance, stairsHeight, STAIRS } from '../js/walk.js';

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

// Cells reachable from the start through sides that are not shut.
function reach(state) {
  const cells = walkCells(state);
  const s = spawn(state);
  const start = key(Math.floor(s.x), Math.floor(s.y));
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const k = queue.shift();
    const [x, y] = k.split(',').map(Number);
    cells.get(k).sides.forEach((side, d) => {
      const n = key(x + DX[d], y + DY[d]);
      if (side !== 'shut' && !seen.has(n)) { seen.add(n); queue.push(n); }
    });
  }
  return { cells, seen };
}

test('sides match on both cells: what leads from one leads back from the other', () => {
  const s = autoplay('walk-1');
  const cells = walkCells(s);
  for (const [k, c] of cells) {
    const [x, y] = k.split(',').map(Number);
    c.sides.forEach((side, d) => {
      const n = cells.get(key(x + DX[d], y + DY[d]));
      if (side === 'shut') return;
      assert.ok(n, `${k} leads ${d} into rock`);
      assert.equal(n.sides[(d + 2) % 4], side, `${k} side ${d}`);
      assert.equal(side === 'own', n.id === c.id);
    });
  }
});

test('the walk starts on the landing, facing the door, and the stairs climb away from it', () => {
  const s = newGame('walk-2');
  const sp = spawn(s);
  const stairs = s.pieces[s.entrance];
  assert.equal(stairs.kind, 'stairs');
  assert.equal(sp.face, 3); // north, through the stairs' door
  const f = stairsFrame(stairs);
  const at = stairsDistance(f, sp.x, sp.y);
  assert.ok(at < STAIRS.low, 'starts before the first step');
  assert.equal(stairsHeight(at), 0);
  assert.ok(stairsHeight(STAIRS.out) > 1, 'the way out is up');
});

test('every piece joined to the stairs by doors can be walked to, treasure rooms too', () => {
  for (const seed of ['walk-3', 'walk-4', 'walk-5']) {
    const s = autoplay(seed);
    const { cells, seen } = reach(s);
    const reached = new Set([...seen].map((k) => cells.get(k).id));
    const joined = Object.keys(depths(s)).map(Number);
    assert.deepEqual([...reached].sort((a, b) => a - b), joined.sort((a, b) => a - b), seed);
    assert.ok(Object.values(s.pieces).some((p) => p.treasure && reached.has(p.id)), `${seed}: a treasure room to walk into`);
  }
});

test('a door onto bare rock is shut, and so is a wall between two pieces', () => {
  const s = newGame('walk-6');
  const cells = walkCells(s);
  const stairs = s.pieces[s.entrance];
  const [x, y] = [stairs.x, stairs.y];
  // The stairs' door leads north into rock: shut until something is laid there.
  assert.equal(cells.get(key(x, y)).sides[3], 'shut');
  assert.equal(cells.get(key(x, y)).sides[1], 'own');
  const spot = legalSpots(s, s.queue[0])[0];
  const o = spot.options[0];
  place(s, o.rot, o.x, o.y);
  assert.equal(walkCells(s).get(key(x, y)).sides[3], 'pass');
  // Sides between different pieces without a door are always shut.
  for (const [k, c] of walkCells(autoplay('walk-7'))) {
    const [cx, cy] = k.split(',').map(Number);
    c.sides.forEach((side, d) => {
      const n = pieceAt(s, cx + DX[d], cy + DY[d]);
      if (side === 'pass') assert.ok(!n || n.id !== c.id);
    });
  }
});

test('an imported map can be walked from its entrance', () => {
  const json = JSON.parse(readFileSync(new URL('./fixtures/small-opd.json', import.meta.url)));
  const s = importOPD(json);
  const sp = spawn(s);
  assert.ok(sp);
  const { cells, seen } = reach(s);
  assert.ok(cells.has(key(Math.floor(sp.x), Math.floor(sp.y))));
  assert.equal(seen.size, cells.size, 'every cell of the ruins is open to the others');
});
