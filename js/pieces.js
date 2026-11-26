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

  // Ancient rooms: the same Kenney rooms, standing in the ruins of an older people
  // (js/ruins.js dresses them with Quaternius' ruins).
  library: { model: 'room-wide-variation', w: 5, h: 3, doors: [[4, 1, E], [0, 1, W]], room: 'library' },
  shrine: { model: 'room-corner', w: 3, h: 3, doors: [[0, 1, W], [1, 0, N]], room: 'shrine' },
  gallery: { model: 'room-wide', w: 5, h: 3, doors: [[4, 1, E], [2, 2, S], [0, 1, W], [2, 0, N]], room: 'gallery' },

  // Monster homes: rooms that monsters move into once what they need is near (HOMES below).
  // Each keeps to one style: the dead to dressed stone, orcs and their mushrooms to caves.
  ossuary: { model: 'room-small-variation', w: 3, h: 3, doors: [[2, 1, E], [1, 2, S], [0, 1, W], [1, 0, N]], room: 'ossuary', style: 'dungeon' },
  pit: { model: 'room-corner', w: 3, h: 3, doors: [[0, 1, W], [1, 0, N]], room: 'pit', style: 'cave' },
  coffins: { model: 'room-wide-variation', w: 5, h: 3, doors: [[4, 1, E], [0, 1, W]], room: 'coffins', style: 'dungeon' },
  warren: { model: 'room-large-variation', w: 5, h: 5, doors: [[4, 2, E], [2, 4, S], [0, 2, W], [2, 0, N]], room: 'warren', style: 'cave' },
  grove: { model: 'room-small', w: 3, h: 3, doors: [[2, 1, E], [1, 2, S], [0, 1, W], [1, 0, N]], room: 'grove', style: 'cave' },

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
  { kind: 'small', w: 4.5 },
  { kind: 'small_b', w: 2.5 },
  { kind: 'cornerroom', w: 3.5 },
  { kind: 'wide', w: 2.5 },
  { kind: 'wide_b', w: 2 },
  { kind: 'large', w: 1.4 },
  { kind: 'large_b', w: 1 },
  { kind: 'library', w: 2 },
  { kind: 'shrine', w: 2.5 },
  { kind: 'gallery', w: 1.6 },
  { kind: 'ossuary', w: 1.6 },
  { kind: 'pit', w: 1.4 },
  { kind: 'coffins', w: 0.9 },
  { kind: 'warren', w: 0.9 },
  { kind: 'grove', w: 1.8 },
];

// A room with every door joined is finished and gets furnished. Ancient rooms are found already
// in ruins; finished, they give up their finds.
export const ROOMS = {
  storeroom: { name: 'Storeroom', pts: 6, tiles: 1 },
  guardroom: { name: 'Guardroom', pts: 6, tiles: 1 },
  armoury: { name: 'Armoury', pts: 10, tiles: 1, plural: 'Armouries' },
  crypt: { name: 'Crypt', pts: 10, tiles: 1 },
  hall: { name: 'Great hall', pts: 16, tiles: 2 },
  library: { name: 'Lost library', pts: 10, tiles: 1, ancient: true, plural: 'Lost libraries' },
  shrine: { name: 'Shrine', pts: 8, tiles: 1, ancient: true },
  gallery: { name: 'Fallen gallery', pts: 12, tiles: 1, ancient: true, plural: 'Fallen galleries' },
  ossuary: { name: 'Ossuary', pts: 6, tiles: 1, plural: 'Ossuaries' },
  pit: { name: 'Burial pit', pts: 6, tiles: 1 },
  coffins: { name: 'Coffin hall', pts: 8, tiles: 1 },
  warren: { name: 'Orc warren', pts: 10, tiles: 1 },
  grove: { name: 'Mushroom grove', pts: 6, tiles: 1 },
};

// Who lives where. A finished home fills once each of its `needs` (a list of alternatives) is
// met by a finished room within HOME_REACH steps: a room type, 'treasure' (any treasure room),
// or another home that has filled. Orcs and the dead won't settle within HOSTILE_REACH steps of
// each other's homes; a home waits until it can fill, and a filled home never empties. A
// finished ancient room from depth 6 down with no filled home within HOSTILE_REACH is haunted
// by ghosts, who like the quiet and the dark. Every monster that moves in is worth glory.
export const HOME_REACH = 3;
export const HOSTILE_REACH = 2;
export const HOMES = {
  ossuary: { mob: 'skeleton', n: 3, pts: 8, tiles: 1, kin: 'dead', needs: [['crypt', 'storeroom']] },
  pit: { mob: 'zombie', n: 3, pts: 8, tiles: 1, kin: 'dead', needs: [['storeroom'], ['crypt', 'ossuary']] },
  coffins: { mob: 'vampire', n: 1, pts: 14, tiles: 1, kin: 'dead', needs: [['treasure'], ['ossuary', 'pit']] },
  warren: { mob: 'orc', n: 4, pts: 12, tiles: 2, kin: 'orc', needs: [['grove'], ['armoury', 'guardroom']] },
  haunt: { mob: 'ghost', n: 2, pts: 6, tiles: 0, kin: 'spirit', needs: [], depth: 6 },
};
export const HOSTILE = { dead: 'orc', orc: 'dead' };
export const MOBS = {
  skeleton: { name: 'Skeleton', plural: 'Skeletons' },
  zombie: { name: 'Zombie', plural: 'Zombies' },
  vampire: { name: 'Vampire', plural: 'Vampires' },
  orc: { name: 'Orc', plural: 'Orcs' },
  ghost: { name: 'Ghost', plural: 'Ghosts' },
};

// Ancient rooms near each other found societies of scholars. Distances are counted in steps
// from piece to piece through joined doors (a room next door is 1 step away).
// Academy: a finished lost library and a finished shrine within REACH of each other.
// Archaeological Society: a finished fallen gallery with a finished lost library and a finished
// crypt (the dig) each within REACH of it. From then on every treasure found is worth FIND more.
// A room joins at most one Academy and at most one Society.
export const COMBOS = {
  academy: { name: 'Academy', pts: 15, tiles: 1, reach: 3 },
  society: { name: 'Archaeological Society', pts: 22, tiles: 2, reach: 3, find: 6 },
};

// Rooms finished this deep hold treasure.
export const TREASURE_DEPTH = 9;
export const TREASURE = { pts: 12, tiles: 0 };
