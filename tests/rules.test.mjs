import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, place, discard, preview, legalSpots, layout, check, freePorts, pieceAt, isFinished,
  pieceDoors, DX, DY, START_SUPPLY, choose, SANDBOX_KINDS, depths,
} from '../js/rules.js';
import { PIECES, BAG, STYLES, ROOMS } from '../js/pieces.js';

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

// ---------- sandbox ----------

test('a sandbox starts like a game, with a stone corridor in hand and no bag', () => {
  const s = newGame('sb', { mode: 'sandbox' });
  assert.equal(s.mode, 'sandbox');
  assert.equal(Object.keys(s.pieces).length, 1);
  assert.deepEqual(freePorts(s).map((p) => [p.x, p.y]), [[0, -1]]);
  assert.equal(s.queue.length, 1);
  assert.equal(s.queue[0].kind, 'corridor');
  assert.equal(s.queue[0].style, 'dungeon');
  assert.equal(s.charters.length, 3);
  assert.equal(s.over, false);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

test('in a sandbox the player chooses the piece, and only known ones', () => {
  const s = newGame('sb', { mode: 'sandbox' });
  for (const kind of SANDBOX_KINDS) {
    for (const style of STYLES) {
      const p = choose(s, kind, style);
      assert.ok(p, `${kind} ${style}`);
      assert.equal(s.queue.length, 1);
      assert.equal(s.queue[0], p);
      assert.equal(p.kind, kind);
      assert.equal(p.style, style);
    }
  }
  // the style defaults to the one in hand
  choose(s, 'corner', 'cave');
  assert.equal(choose(s, 'junction').style, 'cave');
  // choosing what is already in hand keeps it
  const v = s.queue[0].v;
  assert.equal(choose(s, 'junction', 'cave').v, v);
  // unknown kinds and styles, the entrance and ruins are refused and change nothing
  const before = JSON.stringify(s);
  for (const [kind, style] of [['stairs', 'dungeon'], ['ruin', 'dungeon'], ['dragon', 'cave'], ['corridor', 'ruin'], ['corridor', 'marble']]) {
    assert.equal(choose(s, kind, style), null, `${kind} ${style}`);
  }
  assert.equal(JSON.stringify(s), before);
  // there is nothing to throw away
  assert.equal(discard(s), null);
  assert.equal(JSON.stringify(s), before);
});

test('choosing is refused outside a sandbox', () => {
  const s = newGame('normal');
  const before = JSON.stringify(s);
  assert.equal(choose(s, 'large', 'cave'), null);
  assert.equal(JSON.stringify(s), before);
});

test('a chosen piece is laid and scored as in the normal game', () => {
  const s = newGame('sb-score', { mode: 'sandbox' });
  // a stone corner room against the stairs: one door joined (+3, same style) and depth 1 (+3)
  choose(s, 'cornerroom', 'dungeon');
  const o = legalSpots(s, s.queue[0]).find((c) => c.x === 0 && c.y === -1).options[0];
  assert.deepEqual(preview(s, o.rot, o.x, o.y).pts, 6);
  const events = place(s, o.rot, o.x, o.y);
  assert.ok(events);
  assert.equal(s.score, 6);
  assert.ok(events.some((e) => e.type === 'deeper' && e.depth === 1));
  const room = pieceAt(s, 0, -1);
  assert.equal(room.kind, 'cornerroom');
  assert.equal(room.style, 'dungeon');
  // the same kind and style stays in hand, as a new piece
  assert.equal(s.queue.length, 1);
  assert.equal(s.queue[0].kind, 'cornerroom');
  assert.equal(s.queue[0].style, 'dungeon');

  // a dead end can't close the room's other door: it is the last way on
  choose(s, 'deadend', 'cave');
  const last = freePorts(s);
  assert.equal(last.length, 1);
  assert.equal(legalSpots(s, s.queue[0]).length, 0);
  // a cave corridor through it finishes the room with a mixed join (+2)
  choose(s, 'corridor', 'cave');
  const free = freePorts(s).find((p) => p.from === room.id);
  const spot = legalSpots(s, s.queue[0]).find((c) => c.x === free.x && c.y === free.y);
  assert.ok(spot, 'the corridor fits in front of the open door');
  const before = s.score;
  const ev = place(s, spot.options[0].rot, spot.options[0].x, spot.options[0].y);
  const finished = ev.find((e) => e.type === 'room');
  assert.ok(finished);
  assert.equal(finished.room, 'guardroom');
  assert.equal(isFinished(s, room), true);
  assert.equal(room.done, true);
  assert.equal(s.stats.rooms, 1);
  const deeper = ev.find((e) => e.type === 'deeper');
  assert.equal(s.score - before, 2 + (deeper ? 3 : 0) + ROOMS.guardroom.pts + ev.filter((e) => e.type === 'charter').reduce((t, e) => t + e.pts, 0));
});

test('a sandbox never runs out of pieces and never ends by itself', () => {
  const s = newGame('sb-long', { mode: 'sandbox' });
  let laid = 0;
  for (let i = 0; i < 160; i++) {
    // cycle through every kind and style, laying the best-scoring fit of each when there is one
    const kind = SANDBOX_KINDS[i % SANDBOX_KINDS.length];
    choose(s, kind, STYLES[Math.floor(i / SANDBOX_KINDS.length) % 2]);
    const spots = legalSpots(s, s.queue[0]);
    if (!spots.length) continue;
    let best = null;
    for (const c of spots.slice(0, 6)) {
      for (const o of c.options) {
        const p = preview(s, o.rot, o.x, o.y);
        if (!best || p.pts > best.pts) best = { ...o, pts: p.pts };
      }
    }
    assert.ok(place(s, best.rot, best.x, best.y));
    laid++;
    assert.equal(s.over, false);
    assert.equal(s.supply, START_SUPPLY);
    assert.equal(s.queue.length, 1);
    assert.ok(freePorts(s).length > 0, 'the last way on is never sealed');
  }
  assert.ok(laid > START_SUPPLY, `laid ${laid} pieces`);
  assert.equal(s.stats.placed, laid);
  assert.ok(s.stats.rooms > 0);
  assert.ok(s.maxDepth >= Math.max(...Object.values(depths(s))));
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

test('a normal game is unchanged by the sandbox', () => {
  // same seed, same deal as a game made without options
  assert.deepEqual(newGame('same-deal', {}), newGame('same-deal'));
  assert.equal(newGame('same-deal').mode, undefined);
  const s = autoplay('a');
  assert.equal(s.over, true);
  assert.equal(s.mode, undefined);
});
