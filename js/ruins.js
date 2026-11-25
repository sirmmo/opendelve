// Ancient rooms: how the lost library, the shrine and the fallen gallery are dressed with pieces
// of Quaternius' Ultimate Modular Ruins Pack (models/ruins/). Pure and deterministic, so the
// tests can check that nothing stands outside the floor, in a doorway or inside something else.
//
// Every item is { m, x, z, ry, s, r }: model, position in world units from the piece's centre in
// its own unturned frame (x east, z south), turn about the vertical, size in world units per metre
// of the model, and the radius of its footprint on the floor (world units).
// The `ruin` part stands from the moment the room is laid (it is what makes it ancient); the
// `finds` part appears when the room is finished, like the furniture of the other rooms.

import { PIECES } from './pieces.js';

export const CELL = 2;
// The ruins are modelled in metres: a person is about 1.8 m, a Kenney character about 1 world
// unit, and a 4 m column reaches the top of a Kenney wall (2.1 units).
export const RU = 0.55;

// Models from the pack used by the game (models/ruins/<name>.glb).
export const RUIN_MODELS = ['Column_Round', 'Column_Round_Short', 'Statue_Fox', 'Statue_Stag',
  'Bookcase_Full', 'Bookcase_Empty', 'Pot1', 'Pot2', 'Pot3', 'Pot1_Broken', 'Pot2_Broken', 'Pot3_Broken',
  'Bricks', 'Skull', 'Candles_1', 'Candles_2', 'Arch_Round'];

const TAU = Math.PI * 2;

export function prng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// Half the size of a room's open floor, inside its walls (world units, unturned).
export function floorOf(kind) {
  const p = PIECES[kind];
  return { hx: p.w - 0.55, hz: p.h - 0.55 };
}

// The cell just inside each door (its centre, in world units from the piece's centre): the way
// in, where nothing may stand.
export function doorCells(kind) {
  const p = PIECES[kind];
  return p.doors.map(([x, y, d]) => ({ x: (x + 0.5 - p.w / 2) * CELL, z: (y + 0.5 - p.h / 2) * CELL, d }));
}

// Where a treasure room's hoard goes in each ancient room (same shape as view.js's HOARD).
export const ANCIENT_HOARD = {
  library: { chest: [0, -0.35, 0], coins: [[-0.95, -0.2], [0.95, -0.05], [0.55, 0.6]], key: [-0.45, 0.45], ore: [-1.0, 0.65] },
  shrine: { chest: [-0.1, 0.45, Math.PI * 0.75], coins: [[-0.55, -0.3], [0.85, -0.5], [-0.65, 1.05]], key: [0.55, 0.15], ore: [0.2, -0.6] },
  gallery: { chest: [-1.7, 0.15, Math.PI / 2], coins: [[-2.6, 0.5], [-0.95, -0.55], [1.6, -0.45]], key: [1.7, 0.45], ore: [-1.0, 0.6] },
};

const POTS = ['Pot1_Broken', 'Pot2_Broken', 'Pot3_Broken', 'Pot2', 'Pot3'];

function adder(list) {
  return (m, x, z, ry = 0, s = 1, r = 0.3) => list.push({ m: `ruins/${m}`, x, z, ry, s: RU * s, r });
}

// Rubble or a pot in a few of the given spots.
function scatter(add, R, spots, n) {
  const free = spots.slice();
  for (let i = 0; i < n && free.length; i++) {
    const [x, z] = free.splice(Math.floor(R() * free.length), 1)[0];
    if (R() < 0.3) add('Bricks', x, z, R() * TAU, 0.55, 0.4);
    else add(POTS[Math.floor(R() * POTS.length)], x, z, R() * TAU, 0.9, 0.2);
  }
}

// The lost library: a 5x3 room open at both ends, shelves along its long walls either side of
// their alcoves, the shelves facing in. One in three has been emptied; one in eight has
// collapsed into a heap of bricks.
function library(R, done, a, f) {
  for (const [x, z, ry] of [[-2.55, -1.85, 0], [2.55, -1.85, 0], [-2.55, 1.85, Math.PI], [2.55, 1.85, Math.PI]]) {
    const roll = R();
    if (roll < 0.12) a('Bricks', x, z * 0.92, R() * TAU, 0.8, 0.5);
    else a(roll < 0.45 ? 'Bookcase_Empty' : 'Bookcase_Full', x, z, ry, 1, 0.6);
  }
  // A column broken off in front of one alcove, and rubble in the corners of the reading room.
  a('Column_Round_Short', 0, R() < 0.5 ? -1.45 : 1.45, R() * TAU, 1, 0.16);
  scatter(a, R, [[-1.45, -1.2], [1.45, -1.2], [-1.45, 1.25], [1.45, 1.25]], 2);
  if (!done) return;
  f('Candles_2', R() < 0.5 ? -2.2 : 2.2, R() < 0.5 ? -0.65 : 0.65, R() * TAU, 0.8, 0.28);
  f('Candles_1', 0, R() < 0.5 ? -0.95 : 0.95, R() * TAU, 0.6, 0.2);
  f('Skull', -0.65, -0.95, R() * TAU, 0.8, 0.15);
}

// The shrine: a 3x3 corner room, its statue in the far corner facing the two doors, a broken
// column either side.
function shrine(R, done, a, f) {
  // The fox looks south (+z) and the stag west (-x); both are turned to face north-west.
  if (R() < 0.5) a('Statue_Fox', 1.0, 1.0, -Math.PI * 0.75, 1, 0.68);
  else a('Statue_Stag', 1.05, 1.05, -Math.PI * 0.25, 0.9, 0.68);
  a('Column_Round_Short', -0.9, 1.7, 0, 1, 0.16);
  a('Column_Round_Short', 1.7, -0.9, 0, 1, 0.16);
  scatter(a, R, [[-1.75, -1.75], [-1.8, 1.45], [1.45, -1.8], [-0.35, 1.85]], 1 + Math.floor(R() * 2));
  if (!done) return;
  f('Candles_2', 1.55, 0.15, R() * TAU, 0.7, 0.26);
  f('Candles_1', 0.15, 1.55, R() * TAU, 0.6, 0.2);
  f('Skull', 2.05, -1.35, R() * TAU, 0.7, 0.13);
}

// The fallen gallery: a 5x3 colonnade open on all four sides, an arch still standing across the
// middle. Some of the columns have fallen (at least two, at most six), leaving stumps and rubble.
export const GALLERY_COLUMNS = [[-3.45, -1.65], [-1.8, -1.65], [1.8, -1.65], [3.45, -1.65],
  [-3.45, 1.65], [-1.8, 1.65], [1.8, 1.65], [3.45, 1.65]];

function gallery(R, done, a, f) {
  const fall = GALLERY_COLUMNS.map(() => R() < 0.45);
  while (fall.filter(Boolean).length < 2) fall[Math.floor(R() * fall.length)] = true;
  while (fall.filter(Boolean).length > 6) fall[fall.indexOf(true)] = false;
  const heaps = new Set();
  GALLERY_COLUMNS.forEach(([x, z], i) => {
    if (!fall[i]) {
      a('Column_Round', x, z, 0, 1, 0.2);
      return;
    }
    a('Column_Round_Short', x, z, R() * TAU, 1, 0.16);
    // The rest of it lies in a heap against the wall, between this column and its neighbour.
    const heap = `${Math.sign(x)},${Math.sign(z)}`;
    if (heaps.has(heap)) return;
    heaps.add(heap);
    a('Bricks', Math.sign(x) * 2.62, Math.sign(z) * 1.9, R() * TAU, 0.6, 0.42);
  });
  a('Arch_Round', 0, 0, Math.PI / 2, 0.85, 0.3);
  if (!done) return;
  f(R() < 0.5 ? 'Pot1' : 'Pot1_Broken', -2.55, -0.65, R() * TAU, 0.8, 0.25);
  f('Pot3', 2.6, 0.65, R() * TAU, 0.9, 0.18);
  f('Skull', 2.5, -0.55, R() * TAU, 0.8, 0.15);
  f('Candles_1', 0.85, 0.3, R() * TAU, 0.6, 0.2);
}

const DRESS = { library, shrine, gallery };

// The ruin pieces of an ancient room, and its finds once finished. Empty for any other piece.
export function ruinDressing(p) {
  const room = PIECES[p.kind]?.room;
  const ruin = [];
  const finds = [];
  if (DRESS[room]) DRESS[room](prng((p.v || 0) * 104729 + 7), !!p.done, adder(ruin), adder(finds));
  return { ruin, finds };
}

export const isAncient = (kind) => !!DRESS[PIECES[kind]?.room];
