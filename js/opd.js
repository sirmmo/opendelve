// One Page Dungeon (watabou.github.io/one-page-dungeon) JSON: import a generated map as the
// start of a delve, and export any delve in the same format.
//
// The format, as the generator writes it (press J there):
//   { version, title, story,
//     rects:   [{ x, y, w, h, rotunda?, ending? }]   floor, in grid cells, y down
//     doors:   [{ x, y, dir: { x, y }, type }]      each door is also a 1x1 rect;
//                                                   dir points away from the entrance
//     notes:   [{ text, ref, pos: { x, y } }]
//     columns: [{ x, y }],  water: [...] }
// The floor is the union of the rects: rects that touch are open to each other.

import { PIECES, ROOMS } from './pieces.js';
import { emptyGame, finishSetup, key, DX, DY, shapeOf, depths, pieceAt } from './rules.js';

export const DOOR = { EMPTY: 0, NORMAL: 1, ARCHWAY: 2, STAIRS: 3, PORTCULLIS: 4, SPECIAL: 5, SECRET: 6, BARRED: 7, EXIT: 8, STEPS: 9 };
export const OPD_VERSION = '1.2.7';

const dirIndex = (v) => (v.x > 0 ? 0 : v.y > 0 ? 1 : v.x < 0 ? 2 : 3);
const dirVec = (d) => ({ x: DX[d], y: DY[d] });

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'dungeon';
}

export function isOPD(json) {
  return !!json && Array.isArray(json.rects) && Array.isArray(json.doors);
}

// ---------- import ----------

// A new game whose dungeon starts as the imported map. Each rect becomes a "ruin" piece; you
// dig on from the map's entrance (and any exit) with a fresh supply of pieces.
export function importOPD(json) {
  if (!isOPD(json)) throw new Error('This is not a One Page Dungeon map: it has no rects or doors.');
  const title = String(json.title || 'Imported dungeon');
  const state = emptyGame(`opd-${slug(title)}-${json.rects.length}`);
  const doorAt = new Map(json.doors.map((d) => [key(d.x, d.y), d]));

  json.rects.forEach((r, i) => {
    if (![r.x, r.y, r.w, r.h].every(Number.isInteger) || r.w < 1 || r.h < 1) return;
    const cells = [];
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        if (!state.cells[key(r.x + x, r.y + y)]) cells.push([x, y]);
      }
    }
    if (!cells.length) return;
    const p = {
      id: state.nextId++, kind: 'ruin', style: 'ruin', v: 1000 + i, rot: 0, x: r.x, y: r.y,
      rect: { x: r.x, y: r.y, w: r.w, h: r.h, ...(r.rotunda ? { rotunda: true } : {}), ...(r.ending ? { ending: true } : {}) },
      shape: { w: r.w, h: r.h, cells, doors: [] },
    };
    const d = doorAt.get(key(r.x, r.y));
    if (d && r.w === 1 && r.h === 1) p.door = { x: d.x, y: d.y, dir: { x: d.dir.x, y: d.dir.y }, type: d.type };
    state.pieces[p.id] = p;
    for (const [x, y] of cells) state.cells[key(r.x + x, r.y + y)] = p.id;
  });

  // Touching rects are open to each other.
  for (const p of Object.values(state.pieces)) {
    for (const [cx, cy] of p.shape.cells) {
      for (let d = 0; d < 4; d++) {
        const o = state.cells[key(p.x + cx + DX[d], p.y + cy + DY[d])];
        if (o && o !== p.id) p.shape.doors.push([cx, cy, d]);
      }
    }
  }

  // The entrance and exits lead out of the map: that is where digging carries on.
  let entrance = null;
  for (const p of Object.values(state.pieces)) {
    if (!p.door || (p.door.type !== DOOR.STAIRS && p.door.type !== DOOR.EXIT)) continue;
    const axis = dirIndex(p.door.dir);
    for (const d of [(axis + 2) % 4, axis]) {
      if (!state.cells[key(p.x + DX[d], p.y + DY[d])]) {
        p.shape.doors.push([0, 0, d]);
        break;
      }
    }
    if (!entrance || (p.door.type === DOOR.STAIRS && state.pieces[entrance].door.type !== DOOR.STAIRS)) entrance = p.id;
  }
  state.entrance = entrance || Number(Object.keys(state.pieces)[0]) || 1;

  state.opd = {
    version: String(json.version || OPD_VERSION),
    title,
    story: String(json.story || ''),
    notes: Array.isArray(json.notes) ? json.notes : [],
    columns: Array.isArray(json.columns) ? json.columns : [],
    water: Array.isArray(json.water) ? json.water : [],
  };
  return finishSetup(state);
}

// ---------- export ----------

// Column positions (in cells, from the piece centre, unturned) for rooms that have them.
const COLUMNS = {
  hall: [[-1.45, -1.45], [1.45, -1.45], [-1.45, 1.45], [1.45, 1.45]],
  crypt: [[-1.2, -0.7], [0, -0.7], [1.2, -0.7], [-1.2, 0.7], [0, 0.7], [1.2, 0.7]],
};

function turn([x, y], rot) {
  for (let i = 0; i < rot; i++) [x, y] = [-y, x];
  return [x, y];
}

const isRoom = (p) => !!PIECES[p.kind].room;
const single = (p) => p.kind !== 'stairs' && shapeOf(p).cells.length === 1;
const round2 = (v) => Math.round(v * 100) / 100;

export function exportOPD(state) {
  const opd = state.opd || {};
  const depth = depths(state);
  const rects = [];
  const doors = [];
  const doorCells = new Set();
  const notes = [...(opd.notes || [])];
  const columns = [...(opd.columns || [])];
  let ref = notes.reduce((m, n) => Math.max(m, Number(n.ref) || 0), 0);
  const pieces = Object.values(state.pieces).sort((a, b) => a.id - b.id);

  const addDoor = (x, y, dir, type) => {
    if (doorCells.has(key(x, y))) return;
    doorCells.add(key(x, y));
    doors.push({ x, y, dir, type });
  };

  for (const p of pieces) {
    if (p.kind === 'ruin') {
      rects.push({ ...p.rect });
      if (p.door) addDoor(p.door.x, p.door.y, { ...p.door.dir }, p.door.type);
    } else if (p.kind === 'stairs') {
      // The landing at the foot of the stairs is the dungeon's entrance door.
      rects.push({ x: p.x, y: p.y, w: 1, h: 1 });
      addDoor(p.x, p.y, dirVec(PIECES.stairs.doors[0][2]), DOOR.STAIRS);
    } else {
      const L = shapeOf(p);
      rects.push({ x: p.x, y: p.y, w: L.w, h: L.h });
    }
  }

  // Doorways into rooms. Corridors that meet are simply open floor, as in the generator.
  const seen = new Set();
  for (const p of pieces) {
    if (p.kind === 'ruin') continue;
    for (const [x, y, d] of shapeOf(p).doors.map(([a, b, c]) => [p.x + a, p.y + b, c])) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      const o = pieceAt(state, nx, ny);
      if (!o || o.kind === 'ruin' || (!isRoom(p) && !isRoom(o))) continue;
      const pair = [key(x, y), key(nx, ny)].sort().join('|');
      if (seen.has(pair)) continue;
      seen.add(pair);
      // The door sits on the corridor side when there is one.
      const [cx, cy] = single(p) && !isRoom(p) ? [x, y] : [nx, ny];
      const outward = (depth[p.id] ?? 0) <= (depth[o.id] ?? 0) ? d : (d + 2) % 4;
      const treasure = p.treasure || o.treasure;
      const type = treasure ? DOOR.PORTCULLIS : p.style === 'cave' || o.style === 'cave' ? DOOR.ARCHWAY : DOOR.NORMAL;
      addDoor(cx, cy, dirVec(outward), type);
    }
  }

  // Notes and columns for finished rooms; the deepest one is the dungeon's ending.
  let deepest = null;
  for (const p of pieces) {
    const room = PIECES[p.kind].room;
    if (!room || !p.done) continue;
    const L = shapeOf(p);
    const cx = p.x + L.w / 2;
    const cy = p.y + L.h / 2;
    const d = depth[p.id] ?? 0;
    const text = `${ROOMS[room].name}${p.treasure ? ', its treasure kept behind a portcullis' : ''}. Depth ${d}.`;
    notes.push({ text, ref: String(++ref), pos: { x: cx, y: cy } });
    for (const c of COLUMNS[room] || []) {
      const [dx, dy] = turn(c, p.rot);
      columns.push({ x: round2(cx + dx), y: round2(cy + dy) });
    }
    if (!deepest || d > deepest.d) deepest = { p, d };
  }
  if (deepest && !rects.some((r) => r.ending)) {
    const r = rects.find((q) => q.x === deepest.p.x && q.y === deepest.p.y);
    if (r) r.ending = true;
  }

  const s = state.stats;
  const tale = `Dug down to depth ${state.maxDepth}: ${s.rooms} room${s.rooms === 1 ? '' : 's'} finished, ${s.treasure} treasure${s.treasure === 1 ? '' : 's'} found.`;
  return {
    version: opd.version || OPD_VERSION,
    title: opd.title || `The Delve of ${state.seed}`,
    story: opd.story ? (s.placed ? `${opd.story} Later, delvers dug on. ${tale}` : opd.story) : tale,
    rects,
    doors,
    notes,
    columns,
    water: opd.water || [],
  };
}
