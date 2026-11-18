// OpenDelve rules. Pure and deterministic: the game is a plain JSON object, every random choice
// comes from the seeded generator inside it, so a seed always plays out the same way and a
// game can be saved, restored and undone by copying the object.

import { PIECES, BAG, ROOMS, TREASURE, TREASURE_DEPTH } from './pieces.js';

export const DX = [1, 0, -1, 0];
export const DY = [0, 1, 0, -1];
export const START_SUPPLY = 45;
export const HAND = 3;

export const key = (x, y) => x + ',' + y;
export const unkey = (k) => k.split(',').map(Number);

// ---------- random ----------

export function hashSeed(s) {
  let h = 2166136261 >>> 0;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h || 1;
}

export function rand(state) {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function pick(state, items) {
  const total = items.reduce((s, x) => s + x.w, 0);
  let roll = rand(state) * total;
  for (const x of items) if ((roll -= x.w) < 0) return x;
  return items[items.length - 1];
}

// ---------- shapes ----------

const layoutCache = new Map();

// A piece's cells and doors after turning it `rot` quarter turns clockwise (seen from above).
export function layout(kind, rot) {
  const k = kind + rot;
  if (layoutCache.has(k)) return layoutCache.get(k);
  const p = PIECES[kind];
  let w = p.w;
  let h = p.h;
  let cells = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push([x, y]);
  let doors = p.doors.map((d) => [...d]);
  for (let i = 0; i < rot; i++) {
    cells = cells.map(([x, y]) => [h - 1 - y, x]);
    doors = doors.map(([x, y, d]) => [h - 1 - y, x, (d + 1) % 4]);
    [w, h] = [h, w];
  }
  const out = { w, h, cells, doors };
  layoutCache.set(k, out);
  return out;
}

export function pieceCells(p) {
  return layout(p.kind, p.rot).cells.map(([x, y]) => [p.x + x, p.y + y]);
}

export function pieceDoors(p) {
  return layout(p.kind, p.rot).doors.map(([x, y, d]) => [p.x + x, p.y + y, d]);
}

function hasDoor(p, x, y, d) {
  return pieceDoors(p).some((e) => e[0] === x && e[1] === y && e[2] === d);
}

export function pieceAt(state, x, y) {
  const id = state.cells[key(x, y)];
  return id ? state.pieces[id] : null;
}

// Doors that open onto empty rock: where the dungeon can grow.
export function freePorts(state) {
  const out = [];
  for (const p of Object.values(state.pieces)) {
    for (const [x, y, d] of pieceDoors(p)) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (!state.cells[key(nx, ny)]) out.push({ x: nx, y: ny, from: p.id });
    }
  }
  return out;
}

// Can `kind` go here? Returns the doors it would join, or null.
// Doors must meet doors and walls must meet walls; the piece must join at least one door; and
// it may not seal the last way on while tiles remain.
export function check(state, kind, rot, ax, ay, freeBefore) {
  const L = layout(kind, rot);
  const mine = new Set();
  for (const [x, y] of L.cells) {
    if (state.cells[key(ax + x, ay + y)]) return null;
    mine.add(key(ax + x, ay + y));
  }
  const myDoors = new Set(L.doors.map(([x, y, d]) => `${ax + x},${ay + y},${d}`));
  const links = [];
  let openToRock = 0;
  for (const [x0, y0] of L.cells) {
    const x = ax + x0;
    const y = ay + y0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (mine.has(key(nx, ny))) continue;
      const open = myDoors.has(`${x},${y},${d}`);
      const other = pieceAt(state, nx, ny);
      if (!other) {
        if (open) openToRock++;
        continue;
      }
      if (open !== hasDoor(other, nx, ny, (d + 2) % 4)) return null;
      if (open) links.push(other.id);
    }
  }
  if (!links.length) return null;
  if (freeBefore !== undefined && state.supply > 1 && freeBefore - links.length + openToRock <= 0) return null;
  return links;
}

// Every distinct way to lay `piece` so that it covers cell (cx, cy).
export function optionsAt(state, piece, cx, cy, freeBefore = freePorts(state).length) {
  const out = [];
  const seen = new Set();
  for (let rot = 0; rot < 4; rot++) {
    const L = layout(piece.kind, rot);
    for (const [i, j] of L.cells) {
      const ax = cx - i;
      const ay = cy - j;
      if (!check(state, piece.kind, rot, ax, ay, freeBefore)) continue;
      // Symmetric pieces look the same turned; keep one of each.
      const sig = L.doors.map(([x, y, d]) => `${ax + x},${ay + y},${d}`).sort().join(';')
        + '|' + L.cells.map(([x, y]) => key(ax + x, ay + y)).sort().join(';');
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push({ rot, x: ax, y: ay });
    }
  }
  return out;
}

// Cells in front of free doors, with the ways the piece fits there.
export function legalSpots(state, piece) {
  const ports = freePorts(state);
  const free = ports.length;
  const done = new Set();
  const out = [];
  for (const p of ports) {
    const k = key(p.x, p.y);
    if (done.has(k)) continue;
    done.add(k);
    const options = optionsAt(state, piece, p.x, p.y, free);
    if (options.length) out.push({ x: p.x, y: p.y, options });
  }
  return out;
}

// ---------- connections ----------

export function linksOf(state, p) {
  const out = [];
  for (const [x, y, d] of pieceDoors(p)) {
    const o = pieceAt(state, x + DX[d], y + DY[d]);
    if (o && hasDoor(o, x + DX[d], y + DY[d], (d + 2) % 4)) out.push(o);
  }
  return out;
}

export function isFinished(state, p) {
  return pieceDoors(p).every(([x, y, d]) => {
    const o = pieceAt(state, x + DX[d], y + DY[d]);
    return o && hasDoor(o, x + DX[d], y + DY[d], (d + 2) % 4);
  });
}

// Steps from the stairs, through joined doors.
export function depths(state) {
  const out = { [state.entrance]: 0 };
  const queue = [state.pieces[state.entrance]];
  while (queue.length) {
    const p = queue.shift();
    for (const o of linksOf(state, p)) {
      if (out[o.id] !== undefined) continue;
      out[o.id] = out[p.id] + 1;
      queue.push(o);
    }
  }
  return out;
}

// Pieces of one style joined door to door.
export function styleGroups(state, style) {
  const seen = new Set();
  const out = [];
  for (const p of Object.values(state.pieces)) {
    if (p.style !== style || seen.has(p.id) || p.kind === 'stairs') continue;
    const g = [];
    const stack = [p];
    seen.add(p.id);
    while (stack.length) {
      const q = stack.pop();
      g.push(q.id);
      for (const o of linksOf(state, q)) {
        if (o.style !== style || seen.has(o.id)) continue;
        seen.add(o.id);
        stack.push(o);
      }
    }
    out.push(g);
  }
  return out;
}

export function largestStyle(state, style) {
  return styleGroups(state, style).reduce((m, g) => Math.max(m, g.length), 0);
}

export function countRooms(state, room) {
  let n = 0;
  for (const p of Object.values(state.pieces)) if (p.done && (!room || PIECES[p.kind].room === room)) n++;
  return n;
}

export function countTreasure(state) {
  return Object.values(state.pieces).filter((p) => p.treasure).length;
}

// ---------- new game ----------

export function newGame(seed = String(Date.now() % 1e9)) {
  const state = {
    version: 1,
    seed: String(seed),
    rng: hashSeed(seed),
    pieces: {},
    cells: {},
    nextId: 1,
    entrance: 1,
    queue: [],
    supply: START_SUPPLY,
    score: 0,
    turn: 0,
    maxDepth: 0,
    charters: [],
    nextCharter: 1,
    last: null,
    over: false,
    stats: { placed: 0, discarded: 0, rooms: 0, treasure: 0, charters: 0 },
  };
  addPiece(state, { kind: 'stairs', style: 'dungeon', v: 7 }, 0, 0, 0);
  refill(state);
  for (const kind of ['depth', 'rooms', 'cave']) state.charters.push(makeCharter(state, kind));
  return state;
}

function addPiece(state, piece, rot, x, y) {
  const p = { id: state.nextId++, kind: piece.kind, style: piece.style, v: piece.v, rot, x, y };
  state.pieces[p.id] = p;
  for (const [cx, cy] of pieceCells(p)) state.cells[key(cx, cy)] = p.id;
  return p;
}

function draw(state) {
  let piece;
  for (let i = 0; i < 4; i++) {
    const kind = pick(state, BAG).kind;
    const style = rand(state) < 0.58 ? 'dungeon' : 'cave';
    piece = { kind, style, v: Math.floor(rand(state) * 1e6) };
    if (legalSpots(state, piece).length) break;
  }
  return piece;
}

function refill(state) {
  while (state.queue.length < Math.min(HAND, state.supply)) state.queue.push(draw(state));
  if (state.supply <= 0) state.over = true;
}

// ---------- playing ----------

// Lays the current piece. Returns the events, or null if the move is not legal.
export function place(state, rot, x, y) {
  const piece = state.queue[0];
  if (state.over || !piece) return null;
  const links = check(state, piece.kind, rot, x, y, freePorts(state).length);
  if (!links) return null;
  const events = [];
  const p = addPiece(state, piece, rot, x, y);
  state.last = { x, y };
  state.turn++;
  state.stats.placed++;

  let pts = 0;
  for (const id of links) pts += state.pieces[id].style === p.style ? 3 : 2;
  const depth = depths(state);
  const d = depth[p.id] ?? 0;
  if (d > state.maxDepth) {
    pts += 3 * (d - state.maxDepth);
    state.maxDepth = d;
    events.push({ type: 'deeper', depth: d, id: p.id });
  }
  state.score += pts;
  events.push({ type: 'place', id: p.id, pts });

  state.queue.shift();
  state.supply--;

  for (const r of [p, ...links.map((id) => state.pieces[id])]) {
    const room = PIECES[r.kind].room;
    if (!room || r.done || !isFinished(state, r)) continue;
    r.done = true;
    const info = ROOMS[room];
    state.score += info.pts;
    state.supply += info.tiles;
    state.stats.rooms++;
    const ev = { type: 'room', id: r.id, room, pts: info.pts, tiles: info.tiles };
    if ((depth[r.id] ?? 0) >= TREASURE_DEPTH) {
      r.treasure = true;
      state.score += TREASURE.pts;
      state.supply += TREASURE.tiles;
      state.stats.treasure++;
      ev.treasure = true;
      ev.pts += TREASURE.pts;
      ev.tiles += TREASURE.tiles;
    }
    events.push(ev);
  }

  checkCharters(state, events);
  refill(state);
  if (state.over) events.push({ type: 'over', score: state.score });
  return events;
}

export function discard(state) {
  if (state.over || !state.queue.length) return null;
  state.queue.shift();
  state.supply--;
  state.turn++;
  state.stats.discarded++;
  refill(state);
  const events = [{ type: 'discard' }];
  if (state.over) events.push({ type: 'over', score: state.score });
  return events;
}

export function preview(state, rot, x, y) {
  const copy = structuredClone(state);
  const before = copy.score;
  const events = place(copy, rot, x, y);
  if (!events) return null;
  return { pts: copy.score - before, events };
}

// ---------- charters ----------

const CHARTER_KINDS = ['depth', 'rooms', 'cave', 'dungeon', 'hall', 'treasure', 'crypt', 'armoury'];

export function charterProgress(state, c) {
  switch (c.kind) {
    case 'depth': return state.maxDepth;
    case 'rooms': return countRooms(state);
    case 'cave': return largestStyle(state, 'cave');
    case 'dungeon': return largestStyle(state, 'dungeon');
    case 'treasure': return countTreasure(state);
    default: return countRooms(state, c.kind);
  }
}

export function charterText(c) {
  const n = c.n;
  switch (c.kind) {
    case 'depth': return `Reach depth ${n}`;
    case 'rooms': return `Finish ${n} rooms`;
    case 'cave': return `Open a cavern of ${n} pieces`;
    case 'dungeon': return `Build ${n} stone pieces together`;
    case 'treasure': return n === 1 ? 'Find a treasure' : `Find ${n} treasures`;
    default: {
      const name = ROOMS[c.kind].name;
      return n === 1 ? `Finish a ${name}` : `Finish ${n} ${name}s`;
    }
  }
}

function makeCharter(state, kind) {
  const c = { id: state.nextCharter++, kind };
  const now = charterProgress(state, c);
  const r = rand(state);
  if (kind === 'depth') c.n = now + 4 + Math.floor(r * 3);
  else if (kind === 'rooms') c.n = now + 2 + Math.floor(r * 2);
  else if (kind === 'cave' || kind === 'dungeon') c.n = Math.max(now + 3 + Math.floor(r * 3), 4);
  else c.n = now + 1;
  const step = c.n - now;
  c.pts = kind === 'hall' || kind === 'treasure' ? 18 : 10 + 2 * step;
  c.tiles = step >= 5 ? 3 : 2;
  return c;
}

function checkCharters(state, events) {
  for (let i = 0; i < state.charters.length; i++) {
    const c = state.charters[i];
    if (charterProgress(state, c) < c.n) continue;
    state.score += c.pts;
    state.supply += c.tiles;
    state.stats.charters++;
    events.push({ type: 'charter', text: charterText(c), pts: c.pts, tiles: c.tiles });
    const active = new Set(state.charters.map((x) => x.kind));
    const options = CHARTER_KINDS.filter((k) => !active.has(k));
    state.charters[i] = makeCharter(state, options[Math.floor(rand(state) * options.length)]);
  }
}
