import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { ruinDressing, floorOf, doorCells, isAncient, RUIN_MODELS, ANCIENT_HOARD, CELL } from '../js/ruins.js';
import { PIECES, ROOMS, BAG } from '../js/pieces.js';

const ANCIENT = Object.keys(PIECES).filter(isAncient);

// Every item of a room, with the hoard of a treasure room (radii of the KayKit pieces at their
// size in the game).
function itemsOf(kind, v) {
  const { ruin, finds } = ruinDressing({ kind, v, done: true });
  const h = ANCIENT_HOARD[PIECES[kind].room];
  const hoard = [
    { m: 'chest', x: h.chest[0], z: h.chest[1], r: 0.36 },
    ...h.coins.map(([x, z]) => ({ m: 'coins', x, z, r: 0.17 })),
    { m: 'key', x: h.key[0], z: h.key[1], r: 0.14 },
    { m: 'ore', x: h.ore[0], z: h.ore[1], r: 0.22 },
  ];
  return { ruin, finds, hoard };
}

test('there are three ancient rooms, in the bag', () => {
  assert.deepEqual(ANCIENT.sort(), ['gallery', 'library', 'shrine']);
  for (const k of ANCIENT) {
    assert.ok(BAG.some((b) => b.kind === k), k);
    assert.ok(ROOMS[PIECES[k].room].ancient, k);
  }
});

test('every ruins model the dressing uses is shipped, with the pack licence', () => {
  const used = new Set();
  for (const k of ANCIENT) for (let v = 0; v < 300; v++) for (const d of Object.values(itemsOf(k, v)).flat()) if (d.m.startsWith('ruins/')) used.add(d.m.slice(6));
  for (const m of used) {
    assert.ok(RUIN_MODELS.includes(m), m);
    assert.ok(existsSync(new URL(`../models/ruins/${m}.glb`, import.meta.url)), m);
  }
  for (const m of RUIN_MODELS) assert.ok(used.has(m), `${m} is loaded but never used`);
  assert.match(readFileSync(new URL('../models/ruins/License.txt', import.meta.url), 'utf8'), /CC0/);
});

test('the dressing is deterministic and the ruins stay the same when the room is finished', () => {
  for (const k of ANCIENT) {
    for (const v of [1, 77, 123456]) {
      assert.deepEqual(ruinDressing({ kind: k, v }), ruinDressing({ kind: k, v }));
      assert.deepEqual(ruinDressing({ kind: k, v, done: false }).ruin, ruinDressing({ kind: k, v, done: true }).ruin);
      assert.equal(ruinDressing({ kind: k, v }).finds.length, 0);
      assert.ok(ruinDressing({ kind: k, v, done: true }).finds.length > 0);
    }
  }
  assert.deepEqual(ruinDressing({ kind: 'small', v: 5, done: true }), { ruin: [], finds: [] });
});

test('ruins stand on the floor, out of the doorways and clear of each other and the hoard', () => {
  for (const k of ANCIENT) {
    const { hx, hz } = floorOf(k);
    const doors = doorCells(k);
    for (let v = 0; v < 400; v++) {
      const all = Object.values(itemsOf(k, v)).flat();
      for (const d of all) {
        const where = `${k} v${v} ${d.m} at ${d.x},${d.z}`;
        assert.ok(Math.abs(d.x) + d.r <= hx && Math.abs(d.z) + d.r <= hz, `${where} is off the floor`);
        // The room's corners are rounded: keep out of a quarter circle of radius 1 in each.
        const cx = Math.max(0, Math.abs(d.x) - (hx - 1));
        const cz = Math.max(0, Math.abs(d.z) - (hz - 1));
        assert.ok(Math.hypot(cx, cz) + d.r <= 1.05, `${where} is in a corner`);
        for (const c of doors) {
          // The doorway cell, from the wall to its inner edge.
          const ex = Math.max(Math.abs(d.x - c.x) - CELL / 2, 0);
          const ez = Math.max(Math.abs(d.z - c.z) - CELL / 2, 0);
          assert.ok(Math.hypot(ex, ez) >= d.r, `${where} blocks the door at ${c.x},${c.z}`);
        }
      }
      // The gallery's arch stands across the middle, its legs on the long axis.
      const arch = all.find((d) => d.m.endsWith('Arch_Round'));
      if (arch) {
        for (const d of all) {
          if (d === arch) continue;
          assert.ok(Math.abs(d.x) >= 0.35 + d.r || Math.abs(d.z) >= 0.8 + d.r, `${k} v${v}: ${d.m} at ${d.x},${d.z} is under the arch`);
        }
      }
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const a = all[i];
          const b = all[j];
          // Rubble may lean on the stump it fell from.
          const slack = a.m.endsWith('Bricks') || b.m.endsWith('Bricks') ? 0.1 : 0.02;
          assert.ok(Math.hypot(a.x - b.x, a.z - b.z) + slack >= a.r + b.r, `${k} v${v}: ${a.m} at ${a.x},${a.z} hits ${b.m} at ${b.x},${b.z}`);
        }
      }
    }
  }
});
