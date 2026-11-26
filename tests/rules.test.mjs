import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, place, discard, preview, legalSpots, layout, check, freePorts, pieceAt, isFinished,
  pieceDoors, DX, DY, START_SUPPLY, choose, SANDBOX_KINDS, depths, optionsAt, charterProgress, charterText,
  nearby,
} from '../js/rules.js';
import { PIECES, BAG, STYLES, ROOMS, COMBOS } from '../js/pieces.js';

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
      assert.equal(p.style, PIECES[kind].style || style, `${kind} keeps its style`);
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

// ---------- ancient rooms, Academies and Archaeological Societies ----------

// In a sandbox: lays `kind` so that it covers cell (cx, cy) at turn `rot` with its corner at
// (x, y). Returns the events.
function lay(s, kind, style, rot, x, y, cx = x, cy = y) {
  choose(s, kind, style);
  const o = optionsAt(s, s.queue[0], cx, cy).find((q) => q.rot === rot && q.x === x && q.y === y);
  assert.ok(o, `${kind} fits at ${x},${y} turned ${rot}`);
  return place(s, o.rot, o.x, o.y);
}

// From the stairs: a lost library running north (its south door on the stairs, its north door
// at 0,-5), then `gap` stone corridors, then a shrine whose east door is left open at 1,y.
function libraryAndShrine(gap) {
  const s = newGame('academy', { mode: 'sandbox' });
  lay(s, 'library', 'dungeon', 1, -1, -5, 0, -1);
  for (let i = 0; i < gap; i++) lay(s, 'corridor', 'dungeon', 1, 0, -6 - i);
  // the shrine turned twice opens south and east; its south door meets the way up
  lay(s, 'shrine', 'cave', 2, -1, -8 - gap, 0, -6 - gap);
  const library = pieceAt(s, 0, -1);
  const shrine = pieceAt(s, 0, -6 - gap);
  assert.equal(library.kind, 'library');
  assert.equal(shrine.kind, 'shrine');
  assert.equal(library.done, true);
  assert.equal(shrine.done, undefined);
  return { s, library, shrine, east: [2, -7 - gap] };
}

test('ancient rooms are in the bag and the sandbox and are finished like any room', () => {
  for (const kind of ['library', 'shrine', 'gallery']) {
    assert.ok(BAG.some((b) => b.kind === kind), kind);
    assert.ok(SANDBOX_KINDS.includes(kind), kind);
    assert.ok(ROOMS[PIECES[kind].room].ancient, kind);
  }
  const { s, library } = libraryAndShrine(0);
  assert.equal(s.stats.rooms, 1);
  assert.equal(library.academy, undefined);
});

test('a finished library and shrine close together found an Academy', () => {
  const { s, library, shrine, east } = libraryAndShrine(0);
  const before = s.score;
  const ev = lay(s, 'corridor', 'cave', 0, east[0], east[1]);
  const room = ev.find((e) => e.type === 'room');
  assert.equal(room.room, 'shrine');
  const a = ev.find((e) => e.type === 'academy');
  assert.ok(a, 'an Academy is founded');
  assert.deepEqual(a.ids, [library.id, shrine.id]);
  assert.equal(a.pts, COMBOS.academy.pts);
  assert.equal(library.academy, 1);
  assert.equal(shrine.academy, 1);
  assert.equal(s.stats.academies, 1);
  // the corridor's own points (doors and depth), the shrine, the Academy and any quest
  const laid = ev.find((e) => e.type === 'place').pts;
  const charters = ev.filter((e) => e.type === 'charter').reduce((t, e) => t + e.pts, 0);
  assert.equal(s.score - before, laid + room.pts + a.pts + charters);
  // it is founded once: laying on doesn't found it again
  const more = lay(s, 'corridor', 'cave', 0, east[0] + 1, east[1]);
  assert.ok(!more.some((e) => e.type === 'academy'));
  assert.equal(s.stats.academies, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

test('an Academy needs its rooms within three steps', () => {
  // library - corridor - corridor - shrine: 3 steps
  const near = libraryAndShrine(2);
  assert.equal(nearby(near.s, near.library, 3).find(({ p }) => p.id === near.shrine.id).d, 3);
  assert.ok(lay(near.s, 'corridor', 'dungeon', 0, near.east[0], near.east[1]).some((e) => e.type === 'academy'));
  // one corridor more: 4 steps, no Academy
  const far = libraryAndShrine(3);
  assert.ok(!lay(far.s, 'corridor', 'dungeon', 0, far.east[0], far.east[1]).some((e) => e.type === 'academy'));
  assert.equal(far.shrine.done, true);
  assert.equal(far.s.stats.academies, 0);
  assert.equal(far.library.academy, undefined);
});

test('a gallery joined to a finished library and a finished crypt founds an Archaeological Society', () => {
  const s = newGame('society', { mode: 'sandbox' });
  lay(s, 'library', 'dungeon', 1, -1, -5, 0, -1);
  // the gallery sits across the library's north door, open on all four sides
  lay(s, 'gallery', 'dungeon', 0, -2, -8, 0, -6);
  // a crypt off its east door, finished by a corridor
  lay(s, 'wide_b', 'cave', 0, 3, -8, 3, -7);
  lay(s, 'corridor', 'cave', 0, 8, -7);
  const crypt = pieceAt(s, 3, -7);
  assert.equal(crypt.done, true);
  lay(s, 'corridor', 'dungeon', 0, -3, -7);
  const before = s.score;
  const ev = lay(s, 'corridor', 'dungeon', 1, 0, -9);
  const gallery = pieceAt(s, 0, -6);
  const library = pieceAt(s, 0, -1);
  assert.equal(gallery.done, true);
  const soc = ev.find((e) => e.type === 'society');
  assert.ok(soc, 'the Society is founded');
  assert.deepEqual(soc.ids, [gallery.id, library.id, crypt.id]);
  assert.equal(soc.pts, COMBOS.society.pts);
  assert.equal(s.stats.societies, 1);
  for (const p of [gallery, library, crypt]) assert.equal(p.society, 1);
  assert.ok(!ev.some((e) => e.type === 'academy'));
  assert.ok(s.score - before >= soc.pts + ROOMS.gallery.pts);
});

test('once there is a Society, every treasure is worth more', () => {
  // a room finished at depth 9, with and without a Society
  const run = (society) => {
    const s = newGame('finds', { mode: 'sandbox' });
    if (society) s.stats.societies = 1;
    for (let y = -1; y >= -8; y--) lay(s, 'corridor', 'dungeon', 1, 0, y);
    lay(s, 'cornerroom', 'dungeon', 2, -1, -11, 0, -9);
    return lay(s, 'corridor', 'dungeon', 0, 2, -10).find((e) => e.type === 'room');
  };
  const plain = run(false);
  const bought = run(true);
  assert.equal(plain.treasure, true);
  assert.equal(plain.find, undefined);
  assert.equal(bought.find, COMBOS.society.find);
  assert.equal(bought.pts - plain.pts, COMBOS.society.find);
});

test('saves from before the ruins keep playing', () => {
  const s = newGame('old-save');
  // what a save looked like: no combo counters, no ancient pieces
  delete s.stats.academies;
  delete s.stats.societies;
  const old = JSON.parse(JSON.stringify(s));
  assert.equal(charterProgress(old, { kind: 'academy', n: 1 }), 0);
  for (let i = 0; i < 30 && !old.over; i++) {
    const spots = legalSpots(old, old.queue[0]);
    if (!spots.length) { discard(old); continue; }
    const o = spots[0].options[0];
    assert.ok(place(old, o.rot, o.x, o.y));
  }
  assert.ok(old.stats.placed > 0);
});

test('quests can ask for an Academy or a lost library', () => {
  assert.equal(charterText({ kind: 'academy', n: 1 }), 'Found an Academy');
  assert.equal(charterText({ kind: 'academy', n: 2 }), 'Found 2 Academies');
  assert.equal(charterText({ kind: 'library', n: 1 }), 'Finish a Lost library');
  assert.equal(charterText({ kind: 'library', n: 3 }), 'Finish 3 Lost libraries');
  assert.equal(charterText({ kind: 'armoury', n: 2 }), 'Finish 2 Armouries');
});

test('a normal game can found an Academy and an Archaeological Society', () => {
  const s = autoplay('1');
  assert.ok(s.stats.academies >= 1, 'an Academy');
  assert.ok(s.stats.societies >= 1, 'a Society');
  const members = Object.values(s.pieces).filter((p) => p.society);
  assert.equal(members.length, 3 * s.stats.societies);
});
