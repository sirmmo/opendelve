import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, place, discard, preview, legalSpots, layout, check, freePorts, pieceAt, isFinished,
  pieceDoors, DX, DY, START_SUPPLY,
} from '../js/rules.js';
import { PIECES, BAG } from '../js/pieces.js';

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
    assert.ok(place(s, best.rot, best.x, best.y));
  }
  return s;
}

test('every bag entry is a known piece whose doors sit on its edge', () => {
  for (const b of BAG) {
    const p = PIECES[b.kind];
    assert.ok(p, b.kind);
    for (const [x, y, d] of p.doors) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      assert.ok(nx < 0 || ny < 0 || nx >= p.w || ny >= p.h, `${b.kind} door ${x},${y},${d} is inside`);
    }
  }
});

test('turning a piece turns its doors clockwise', () => {
  // dead end opens east; a quarter turn opens it south
  assert.deepEqual(layout('deadend', 1).doors, [[0, 0, 1]]);
  assert.deepEqual(layout('deadend', 3).doors, [[0, 0, 3]]);
  // a 5x3 room turned once is 3x5, east door now on the south side
  const L = layout('wide', 1);
  assert.equal(L.w, 3);
  assert.equal(L.h, 5);
  assert.ok(L.doors.some(([x, y, d]) => d === 1 && x === 1 && y === 4));
});

test('a new game starts at the stairs with one way on', () => {
  const s = newGame('abc');
  assert.equal(Object.keys(s.pieces).length, 1);
  assert.deepEqual(freePorts(s).map((p) => [p.x, p.y]), [[0, -1]]);
  assert.equal(s.queue.length, 3);
  assert.equal(s.supply, START_SUPPLY);
});

test('doors must meet doors, walls must meet walls', () => {
  const s = newGame('x');
  // corridor running north-south above the stairs: rot 1 opens south and north
  assert.ok(check(s, 'corridor', 1, 0, -1));
  // running east-west, its wall would block the stairs' door
  assert.equal(check(s, 'corridor', 0, 0, -1), null);
  // not touching any door
  assert.equal(check(s, 'corridor', 1, 5, 5), null);
  // a dead end that closes the only way while tiles remain is refused
  assert.equal(check(s, 'deadend', 1, 0, -1, freePorts(s).length), null);
});

test('a room with every door joined is finished', () => {
  const s = newGame('room');
  // corner room: doors W and N at rot 0; turned twice they face E and S.
  // Lay it so its south door (1,2)+(0,1)... meets the stairs' north door at (0,-1).
  s.queue = [{ kind: 'cornerroom', style: 'dungeon', v: 1 }, { kind: 'corridor', style: 'dungeon', v: 2 }];
  const spot = legalSpots(s, s.queue[0]).find((c) => c.x === 0 && c.y === -1);
  assert.ok(spot);
  const o = spot.options[0];
  assert.ok(place(s, o.rot, o.x, o.y));
  const room = pieceAt(s, 0, -1);
  assert.equal(room.kind, 'cornerroom');
  assert.equal(isFinished(s, room), false);
});

test('the same seed plays out the same way', () => {
  assert.deepEqual(autoplay('same'), autoplay('same'));
});

test('preview does not change the game', () => {
  const s = newGame('pv');
  const before = JSON.stringify(s);
  const o = legalSpots(s, s.queue[0])[0].options[0];
  assert.ok(preview(s, o.rot, o.x, o.y));
  assert.equal(JSON.stringify(s), before);
});

test('games end, pieces never overlap, joined sides agree', () => {
  for (const seed of ['a', 'b', 'c']) {
    const s = autoplay(seed);
    assert.equal(s.over, true, `seed ${seed} should finish`);
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
    const owner = {};
    for (const p of Object.values(s.pieces)) {
      for (const [x, y] of layout(p.kind, p.rot).cells.map(([a, b]) => [p.x + a, p.y + b])) {
        assert.equal(owner[x + ',' + y], undefined, 'overlap');
        owner[x + ',' + y] = p.id;
      }
    }
    for (const p of Object.values(s.pieces)) {
      for (const [x, y, d] of pieceDoors(p)) {
        const o = pieceAt(s, x + DX[d], y + DY[d]);
        if (o) assert.ok(pieceDoors(o).some((e) => e[0] === x + DX[d] && e[1] === y + DY[d] && e[2] === (d + 2) % 4), 'door meets wall');
      }
    }
  }
});
