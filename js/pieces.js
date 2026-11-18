// Piece catalogue.
//
// The board is a square grid. A piece covers w x h cells; x grows east (+x in 3D) and y grows
// south (+z in 3D). Directions: 0 east, 1 south, 2 west, 3 north. A door is an opening on one
// side of one of the piece's cells: [x, y, dir] in the piece's own (unturned) layout.
//
// Sizes and doors were measured from the Kenney meshes (tools/ports.py): one cell is 4 model
// units, corridors are 1x1 and rooms open in the middle of each open side.

export const E = 0, S = 1, W = 2, N = 3;

export const PIECES = {
  corridor: { model: 'corridor', w: 1, h: 1, doors: [[0, 0, E], [0, 0, W]], room: null },
  corner: { model: 'corridor-corner', w: 1, h: 1, doors: [[0, 0, W], [0, 0, N]], room: null },
  junction: { model: 'corridor-junction', w: 1, h: 1, doors: [[0, 0, E], [0, 0, W], [0, 0, N]], room: null },
  crossing: { model: 'corridor-intersection', w: 1, h: 1, doors: [[0, 0, E], [0, 0, S], [0, 0, W], [0, 0, N]], room: null },
  deadend: { model: 'corridor-end', w: 1, h: 1, doors: [[0, 0, E]], room: null },

  small: { model: 'room-small', w: 3, h: 3, doors: [[2, 1, E], [1, 2, S], [0, 1, W], [1, 0, N]], room: 'storeroom' },
  small_b: { model: 'room-small-variation', w: 3, h: 3, doors: [[2, 1, E], [1, 2, S], [0, 1, W], [1, 0, N]], room: 'storeroom' },
  cornerroom: { model: 'room-corner', w: 3, h: 3, doors: [[0, 1, W], [1, 0, N]], room: 'guardroom' },
  wide: { model: 'room-wide', w: 5, h: 3, doors: [[4, 1, E], [2, 2, S], [0, 1, W], [2, 0, N]], room: 'armoury' },
  wide_b: { model: 'room-wide-variation', w: 5, h: 3, doors: [[4, 1, E], [0, 1, W]], room: 'crypt' },
  large: { model: 'room-large', w: 5, h: 5, doors: [[4, 2, E], [2, 4, S], [0, 2, W], [2, 0, N]], room: 'hall' },
  large_b: { model: 'room-large-variation', w: 5, h: 5, doors: [[4, 2, E], [2, 4, S], [0, 2, W], [2, 0, N]], room: 'hall' },

  // The way in: stairs coming down from the surface, open to the north.
  stairs: { model: 'stairs', w: 1, h: 2, doors: [[0, 0, N]], room: null },

  // Part of an imported One Page Dungeon map; its shape is stored on the piece.
  ruin: { model: null, w: 1, h: 1, doors: [], room: null },
};

export const STYLES = ['dungeon', 'cave'];

// What the dungeon's diggers bring, with relative weights.
export const BAG = [
  { kind: 'corridor', w: 13 },
  { kind: 'corner', w: 10 },
  { kind: 'junction', w: 6 },
  { kind: 'crossing', w: 2.5 },
  { kind: 'deadend', w: 3.5 },
  { kind: 'small', w: 5 },
  { kind: 'small_b', w: 3 },
  { kind: 'cornerroom', w: 4.5 },
  { kind: 'wide', w: 3 },
  { kind: 'wide_b', w: 2 },
  { kind: 'large', w: 1.4 },
  { kind: 'large_b', w: 1 },
];

// A room with every door joined is finished and gets furnished.
export const ROOMS = {
  storeroom: { name: 'Storeroom', pts: 6, tiles: 1 },
  guardroom: { name: 'Guardroom', pts: 6, tiles: 1 },
  armoury: { name: 'Armoury', pts: 10, tiles: 1 },
  crypt: { name: 'Crypt', pts: 10, tiles: 1 },
  hall: { name: 'Great hall', pts: 16, tiles: 2 },
};

// Rooms finished this deep hold treasure.
export const TREASURE_DEPTH = 9;
export const TREASURE = { pts: 12, tiles: 0 };
