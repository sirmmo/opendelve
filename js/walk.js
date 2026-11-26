// Walking the dungeon: which cells can be walked, and which of their sides can be crossed.
// Pure, like the rules: the view casts rays at the models for what stands inside each cell
// (walls, rocks, furniture, ruins); this says where one cell leads to the next.
//
// A side is 'own' (the next cell is the same piece), 'pass' (a joined door: both pieces have a
// door there) or 'shut' (a wall, or a door onto bare rock). A treasure room's barred gates are
// doors like any other: the dungeon goes on beyond them, and the walker lifts their bars.

import { PIECES } from './pieces.js';
import { shapeOf, pieceDoors, pieceAt, key, DX, DY } from './rules.js';

const doorSet = (p) => new Set(pieceDoors(p).map(([x, y, d]) => `${x},${y},${d}`));

// key "x,y" -> { id, sides: ['own'|'pass'|'shut' x4] }
export function walkCells(state) {
  const doors = new Map(Object.values(state.pieces).map((p) => [p.id, doorSet(p)]));
  const out = new Map();
  for (const p of Object.values(state.pieces)) {
    const mine = doors.get(p.id);
    for (const [cx, cy] of shapeOf(p).cells) {
      const x = p.x + cx;
      const y = p.y + cy;
      const sides = [0, 1, 2, 3].map((d) => {
        const o = pieceAt(state, x + DX[d], y + DY[d]);
        if (o && o.id === p.id) return 'own';
        if (!o || !mine.has(`${x},${y},${d}`)) return 'shut';
        return doors.get(o.id).has(`${x + DX[d]},${y + DY[d]},${(d + 2) % 4}`) ? 'pass' : 'shut';
      });
      out.set(key(x, y), { id: p.id, sides });
    }
  }
  return out;
}

// The stairs down: a ramp from the landing (by the door) up to the surface. `s` is how far a
// point is from the door side of the piece, in cells (0 to 2); the steps rise from LOW to HIGH
// (measured on the Kenney model), to RISE world units.
export const STAIRS = { low: 0.62, high: 1.88, rise: 2.0, out: 1.6 };

export function stairsFrame(p) {
  const [dx, dy, d] = pieceDoors(p)[0];
  const L = shapeOf(p);
  // The door's side of the piece, as a line, and the way up (away from it).
  const up = (d + 2) % 4;
  const edge = DX[d] === 0 ? (DY[d] < 0 ? p.y : p.y + L.h) : (DX[d] < 0 ? p.x : p.x + L.w);
  return { door: d, up, edge, cell: [dx, dy] };
}

// How far (in cells) a point (u, v, in cells) is up the stairs from the door side.
export function stairsDistance(f, u, v) {
  if (DX[f.door] === 0) return DY[f.door] < 0 ? v - f.edge : f.edge - v;
  return DX[f.door] < 0 ? u - f.edge : f.edge - u;
}

export function stairsHeight(s) {
  const k = Math.min(1, Math.max(0, (s - STAIRS.low) / (STAIRS.high - STAIRS.low)));
  return k * STAIRS.rise;
}

// Where a walk starts: on the dungeon's entrance (the landing at the foot of the stairs, or an
// imported map's way in), facing into the dungeon. Returns { x, y } (cells, centre of the start
// spot) and `face`, a direction index.
export function spawn(state) {
  const p = state.pieces[state.entrance] || Object.values(state.pieces)[0];
  if (!p) return null;
  if (p.kind === 'stairs') {
    const f = stairsFrame(p);
    const [cx, cy] = f.cell;
    // A third of a cell in from the door: on the flat landing, before the first step.
    return { x: cx + 0.5 + DX[f.door] * 0.15, y: cy + 0.5 + DY[f.door] * 0.15, face: f.door, id: p.id };
  }
  const cells = walkCells(state);
  const [cx, cy] = shapeOf(p).cells[0];
  const c = cells.get(key(p.x + cx, p.y + cy));
  const face = c ? Math.max(0, c.sides.findIndex((s) => s !== 'shut')) : 0;
  return { x: p.x + cx + 0.5, y: p.y + cy + 0.5, face, id: p.id };
}

// What a piece is called, for the label shown on walking into it.
export function placeName(state, p, rooms, depth) {
  const room = PIECES[p.kind].room;
  if (p.kind === 'stairs') return 'The stairs';
  if (p.kind === 'ruin') return state.opd?.title || 'Ruins';
  if (!room) return p.style === 'cave' ? 'A tunnel' : 'A corridor';
  const name = rooms[room].name;
  return p.done ? (p.treasure ? `${name} · treasure` : name) : `${name} (unfinished)`;
}
