import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { newGame, place, discard, legalSpots, freePorts, depths, pieceCells, key } from '../js/rules.js';
import { importOPD, exportOPD, isOPD, DOOR } from '../js/opd.js';
import { toGeoJSON } from '../js/geojson.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/small-opd.json', import.meta.url)));

function play(s, n) {
  for (let i = 0; i < n && !s.over; i++) {
    const spot = legalSpots(s, s.queue[0])[0];
    if (!spot) { discard(s); continue; }
    const o = spot.options[0];
    assert.ok(place(s, o.rot, o.x, o.y));
  }
  return s;
}

const cellSet = (s) => new Set(Object.values(s.pieces).flatMap((p) => pieceCells(p).map(([x, y]) => key(x, y))));

test('a One Page Dungeon map imports as ruins you can dig on from', () => {
  const s = importOPD(fixture());
  assert.equal(Object.keys(s.pieces).length, 6);
  assert.equal(cellSet(s).size, 3 + 9 + 6 + 3);
  assert.equal(s.opd.title, 'Little Crypt of the Test Suite');
  // The way on is out of the entrance, to the west, or through any of the old walls.
  const ports = freePorts(s).map((p) => key(p.x, p.y));
  assert.ok(ports.includes(key(-1, 0)));
  assert.ok(ports.includes(key(2, -1)), 'north wall of the corridor');
  const d = depths(s);
  const at = (x, y) => s.cells[key(x, y)];
  assert.equal(d[at(0, 0)], 0);
  assert.equal(d[at(6, 0)], 3);
  assert.equal(d[at(6, 4)], 5);
  assert.equal(s.over, false);
  assert.ok(s.queue.length > 0);
});

test('a door laid against a ruin wall breaks through it', () => {
  const s = importOPD(fixture());
  // A dead end turned to open south, just north of the corridor at (2, 0).
  s.queue[0] = { kind: 'deadend', style: 'cave', v: 1 };
  const events = place(s, 1, 2, -1);
  assert.ok(events, 'breach is legal');
  assert.ok(events.some((e) => e.type === 'breach'));
  const corridor = s.pieces[s.cells[key(2, 0)]];
  assert.ok(corridor.shape.doors.some(([x, y, d]) => corridor.x + x === 2 && corridor.y + y === 0 && d === 3));
  const d = depths(s);
  assert.equal(d[s.cells[key(2, -1)]], d[corridor.id] + 1);
});

test('an empty map can be looked at but not played', () => {
  const s = importOPD({ title: 'Nothing', rects: [], doors: [] });
  assert.equal(s.sealed, true);
  assert.equal(s.over, true);
});

test('rejects files that are not maps', () => {
  assert.equal(isOPD({ foo: 1 }), false);
  assert.throws(() => importOPD({ type: 'FeatureCollection' }));
});

test('an imported map exports back unchanged, plus what was dug', () => {
  const src = fixture();
  const s = importOPD(src);
  const untouched = exportOPD(s);
  assert.deepEqual(untouched.rects, src.rects);
  assert.deepEqual(untouched.doors, src.doors);
  assert.deepEqual(untouched.notes, src.notes);
  assert.equal(untouched.story, src.story);
  play(s, 12);
  const out = exportOPD(s);
  assert.ok(out.rects.length > src.rects.length);
  for (const r of src.rects) assert.ok(out.rects.some((q) => q.x === r.x && q.y === r.y && q.w === r.w && q.h === r.h));
  assert.match(out.story, /delvers dug on/);
});

test('a delve exports in the generator format and imports back', () => {
  const s = play(newGame('roundtrip'), 30);
  const out = exportOPD(s);
  assert.equal(typeof out.version, 'string');
  for (const k of ['title', 'story']) assert.equal(typeof out[k], 'string');
  for (const k of ['rects', 'doors', 'notes', 'columns', 'water']) assert.ok(Array.isArray(out[k]));
  // Rects never overlap; every door sits on floor; exactly one stairs entrance.
  const seen = new Set();
  for (const r of out.rects) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      assert.ok(!seen.has(key(x, y)), `overlap at ${x},${y}`);
      seen.add(key(x, y));
    }
  }
  for (const d of out.doors) {
    assert.ok(seen.has(key(d.x, d.y)), 'door on floor');
    assert.equal(Math.abs(d.dir.x) + Math.abs(d.dir.y), 1);
  }
  assert.equal(out.doors.filter((d) => d.type === DOOR.STAIRS).length, 1);
  // Importing it gives the same floor (less the upper flight of stairs).
  const back = importOPD(JSON.parse(JSON.stringify(out)));
  const before = cellSet(s);
  before.delete(key(0, 1));
  assert.deepEqual([...cellSet(back)].sort(), [...before].sort());
  assert.ok(freePorts(back).length >= 1);
});

test('the dungeon exports as valid GeoJSON', () => {
  const s = play(importOPD(fixture()), 15);
  const g = toGeoJSON(s, { origin: [11.34, 44.49] });
  const area = (r) => r.slice(0, -1).reduce((a, p, i) => a + p[0] * r[i + 1][1] - r[i + 1][0] * p[1], 0) / 2;
  for (const f of g.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const rings of polys) rings.forEach((r, i) => {
      assert.deepEqual(r[0], r[r.length - 1]);
      assert.ok(i === 0 ? area(r) > 0 : area(r) < 0);
    });
  }
  const layers = new Set(g.features.map((f) => f.properties.layer));
  for (const l of ['dungeon', 'piece', 'passage', 'door', 'entrance', 'note', 'column', 'area']) assert.ok(layers.has(l), l);
  assert.equal(g.features.filter((f) => f.properties.layer === 'piece').length, Object.keys(s.pieces).length);
});

// A real export from the generator, if one is around (not shipped: OPD_SAMPLE=path npm test).
const sample = process.env.OPD_SAMPLE;
test('imports a real generator export', { skip: !sample || !existsSync(sample) }, () => {
  const src = JSON.parse(readFileSync(sample));
  const s = importOPD(src);
  assert.equal(Object.keys(s.pieces).length, src.rects.length);
  assert.ok(freePorts(s).length >= 1);
  const out = exportOPD(play(s, 20));
  for (const r of src.rects) assert.ok(out.rects.some((q) => q.x === r.x && q.y === r.y));
  assert.equal(out.title, src.title);
});
