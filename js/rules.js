// OpenDelve rules. Pure and deterministic: the game is a plain JSON object, every random choice
// comes from the seeded generator inside it, so a seed always plays out the same way and a
// game can be saved, restored and undone by copying the object.

import { PIECES, BAG, ROOMS, STYLES, TREASURE, TREASURE_DEPTH, COMBOS, HOMES, HOME_REACH, HOSTILE_REACH, HOSTILE, MOBS } from './pieces.js';

export const DX = [1, 0, -1, 0];
export const DY = [0, 1, 0, -1];
export const START_SUPPLY = 45;
export const HAND = 3;

// Sandbox mode (state.mode === 'sandbox'): no bag. The player chooses every piece from these
// kinds, in either style; the supply never runs out and the delve never ends by itself.
export const SANDBOX = 'sandbox';
export const SANDBOX_KINDS = BAG.map((b) => b.kind);
export const isSandbox = (state) => state.mode === SANDBOX;

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

// Imported pieces (ruins from a One Page Dungeon map) carry their own shape.
export function shapeOf(p) {
  return p.shape || layout(p.kind, p.rot);
}

export function pieceCells(p) {
  return shapeOf(p).cells.map(([x, y]) => [p.x + x, p.y + y]);
}

export function pieceDoors(p) {
  return shapeOf(p).doors.map(([x, y, d]) => [p.x + x, p.y + y, d]);
}

function hasDoor(p, x, y, d) {
  return pieceDoors(p).some((e) => e[0] === x && e[1] === y && e[2] === d);
}

export function pieceAt(state, x, y) {
  const id = state.cells[key(x, y)];
  return id ? state.pieces[id] : null;
}

// Doors that open onto empty rock: where the dungeon can grow.
// Ruins (pieces of an imported map) can also be broken into: every wall of theirs that faces
// rock counts as a way in.
export function freePorts(state) {
  const out = [];
  for (const p of Object.values(state.pieces)) {
    if (p.kind === 'ruin') {
      for (const [x, y] of pieceCells(p)) {
        for (let d = 0; d < 4; d++) {
          if (!state.cells[key(x + DX[d], y + DY[d])]) out.push({ x: x + DX[d], y: y + DY[d], from: p.id, breach: !hasDoor(p, x, y, d) });
        }
      }
      continue;
    }
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
// it may not seal the last way on while tiles remain (in a sandbox they always do).
export function check(state, kind, rot, ax, ay, freeBefore) {
  const L = layout(kind, rot);
  const mine = new Set();
  for (const [x, y] of L.cells) {
    if (state.cells[key(ax + x, ay + y)]) return null;
    mine.add(key(ax + x, ay + y));
  }
  const myDoors = new Set(L.doors.map(([x, y, d]) => `${ax + x},${ay + y},${d}`));
  const links = [];
  const breaches = [];
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
      const theirs = hasDoor(other, nx, ny, (d + 2) % 4);
      if (open && !theirs && other.kind === 'ruin') {
        // A door laid against a ruin wall breaks through it.
        links.push(other.id);
        breaches.push([nx, ny, (d + 2) % 4, other.id]);
        continue;
      }
      if (open !== theirs) return null;
      if (open) links.push(other.id);
    }
  }
  if (!links.length) return null;
  if (freeBefore !== undefined && state.supply > 1 && freeBefore - links.length + openToRock <= 0) return null;
  links.breaches = breaches;
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
  const doorway = new Set(ports.filter((p) => !p.breach).map((p) => key(p.x, p.y)));
  for (const p of ports) {
    const k = key(p.x, p.y);
    if (done.has(k)) continue;
    done.add(k);
    const options = optionsAt(state, piece, p.x, p.y, free);
    if (options.length) out.push({ x: p.x, y: p.y, options, ...(doorway.has(k) ? {} : { breach: true }) });
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
  if (!state.pieces[state.entrance]) return {};
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

// Academies and Archaeological Societies founded so far (saves from before them have none).
export const countCombo = (state, combo) => state.stats[combo === 'academy' ? 'academies' : 'societies'] || 0;

// Pieces within `reach` steps of `from` through joined doors, nearest first (then oldest).
export function nearby(state, from, reach) {
  const dist = { [from.id]: 0 };
  const out = [];
  let ring = [from];
  for (let d = 1; d <= reach && ring.length; d++) {
    const next = [];
    for (const p of ring) {
      for (const o of linksOf(state, p)) {
        if (dist[o.id] !== undefined) continue;
        dist[o.id] = d;
        next.push(o);
      }
    }
    next.sort((a, b) => a.id - b.id);
    for (const o of next) out.push({ p: o, d });
    ring = next;
  }
  return out;
}

// ---------- new game ----------

// `opts.mode`: 'sandbox' for a sandbox game, anything else (or nothing) for the normal one.
export function emptyGame(seed = String(Date.now() % 1e9), opts = {}) {
  return {
    version: 1,
    ...(opts.mode === SANDBOX ? { mode: SANDBOX } : {}),
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
    stats: { placed: 0, discarded: 0, rooms: 0, treasure: 0, charters: 0, academies: 0, societies: 0, mobs: 0 },
  };
}

export function newGame(seed = String(Date.now() % 1e9), opts = {}) {
  const state = emptyGame(seed, opts);
  addPiece(state, { kind: 'stairs', style: 'dungeon', v: 7 }, 0, 0, 0);
  return finishSetup(state);
}

// Deals the first hand and quests once the starting pieces are down.
export function finishSetup(state) {
  state.maxDepth = Math.max(0, ...Object.values(depths(state)));
  if (!freePorts(state).length) {
    // Nothing to dig from (an imported map with no way out): look, don't play.
    state.sealed = true;
    state.over = true;
    return state;
  }
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

function freshPiece(state, kind, style) {
  return { kind, style: PIECES[kind].style || style, v: Math.floor(rand(state) * 1e6) };
}

// Pieces brought by rewards. A sandbox's supply never changes.
function gain(state, n) {
  if (!isSandbox(state)) state.supply += n;
}

function draw(state) {
  let piece;
  for (let i = 0; i < 4; i++) {
    const kind = pick(state, BAG).kind;
    const roll = rand(state) < 0.58 ? 'dungeon' : 'cave';
    // Homes keep to their own style.
    piece = { kind, style: PIECES[kind].style || roll, v: Math.floor(rand(state) * 1e6) };
    if (legalSpots(state, piece).length) break;
  }
  return piece;
}

function refill(state) {
  if (isSandbox(state)) {
    // The piece in hand stays the player's choice; a new sandbox starts with a stone corridor.
    if (!state.queue.length) state.queue.push(freshPiece(state, 'corridor', 'dungeon'));
    return;
  }
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
  for (const [bx, by, bd, id] of links.breaches || []) {
    const ruin = state.pieces[id];
    ruin.shape.doors.push([bx - ruin.x, by - ruin.y, bd]);
    events.push({ type: 'breach', id });
  }
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

  if (isSandbox(state)) {
    // Keep the same kind and style in hand, so a run of corridors needs no new choice.
    state.queue[0] = freshPiece(state, piece.kind, piece.style);
  } else {
    state.queue.shift();
    state.supply--;
  }

  const society = countCombo(state, 'society') > 0;
  for (const r of [p, ...links.map((id) => state.pieces[id])]) {
    const room = PIECES[r.kind].room;
    if (!room || r.done || !isFinished(state, r)) continue;
    r.done = true;
    const info = ROOMS[room];
    state.score += info.pts;
    gain(state, info.tiles);
    state.stats.rooms++;
    const ev = { type: 'room', id: r.id, room, pts: info.pts, tiles: info.tiles };
    if ((depth[r.id] ?? 0) >= TREASURE_DEPTH) {
      r.treasure = true;
      state.score += TREASURE.pts;
      gain(state, TREASURE.tiles);
      state.stats.treasure++;
      ev.treasure = true;
      ev.pts += TREASURE.pts;
      ev.tiles += TREASURE.tiles;
      if (society) {
        // The Archaeological Society buys every find.
        state.score += COMBOS.society.find;
        ev.find = COMBOS.society.find;
        ev.pts += COMBOS.society.find;
      }
    }
    events.push(ev);
  }

  checkCombos(state, events);
  checkHomes(state, events);
  checkCharters(state, events);
  refill(state);
  if (state.over) events.push({ type: 'over', score: state.score });
  return events;
}

export function discard(state) {
  if (state.over || !state.queue.length || isSandbox(state)) return null;
  state.queue.shift();
  state.supply--;
  state.turn++;
  state.stats.discarded++;
  refill(state);
  const events = [{ type: 'discard' }];
  if (state.over) events.push({ type: 'over', score: state.score });
  return events;
}

// Sandbox only: puts a piece of `kind` and `style` in hand (style defaults to the current one).
// Returns the piece, or null if this isn't a sandbox, the game is over or the piece is unknown.
// Choosing the piece already in hand keeps it as it is.
export function choose(state, kind, style = state.queue[0]?.style || 'dungeon') {
  if (!isSandbox(state) || state.over) return null;
  if (!SANDBOX_KINDS.includes(kind) || !STYLES.includes(style)) return null;
  style = PIECES[kind].style || style; // homes keep to their own style
  const cur = state.queue[0];
  if (cur && cur.kind === kind && cur.style === style) return cur;
  state.queue = [freshPiece(state, kind, style)];
  return state.queue[0];
}

export function preview(state, rot, x, y) {
  const copy = structuredClone(state);
  const before = copy.score;
  const events = place(copy, rot, x, y);
  if (!events) return null;
  return { pts: copy.score - before, events };
}

// ---------- academies and societies ----------

const roomOf = (p) => PIECES[p.kind].room;

// The nearest finished room of type `room` within `reach` of `from` not yet in a `combo`.
function partner(state, from, room, combo, reach) {
  const hit = nearby(state, from, reach).find(({ p }) => p.done && roomOf(p) === room && !p[combo]);
  return hit ? hit.p : null;
}

function found(state, events, combo, members) {
  const info = COMBOS[combo];
  const stat = combo === 'academy' ? 'academies' : 'societies';
  const n = (state.stats[stat] || 0) + 1;
  state.stats[stat] = n;
  for (const m of members) m[combo] = n;
  state.score += info.pts;
  gain(state, info.tiles);
  events.push({ type: combo, n, ids: members.map((m) => m.id), id: members[0].id, pts: info.pts, tiles: info.tiles });
}

function checkCombos(state, events) {
  for (const p of Object.values(state.pieces)) {
    if (!p.done) continue;
    if (roomOf(p) === 'library' && !p.academy) {
      const shrine = partner(state, p, 'shrine', 'academy', COMBOS.academy.reach);
      if (shrine) found(state, events, 'academy', [p, shrine]);
    }
    if (roomOf(p) === 'gallery' && !p.society) {
      const library = partner(state, p, 'library', 'society', COMBOS.society.reach);
      const crypt = partner(state, p, 'crypt', 'society', COMBOS.society.reach);
      if (library && crypt) found(state, events, 'society', [p, library, crypt]);
    }
  }
}

// ---------- monster homes ----------

// The home a finished piece could be: its room's, or a haunt for an ancient room.
export function homeOf(p) {
  const room = roomOf(p);
  if (HOMES[room]) return room;
  return ROOMS[room]?.ancient ? 'haunt' : null;
}

// Monsters housed so far (saves from before homes have none).
export const countMobs = (state, mob) => Object.values(state.pieces)
  .reduce((n, p) => n + (p.home && (!mob || p.home.mob === mob) ? p.home.n : 0), 0);

// Does `p` (a finished room) have what its home needs nearby, and no enemies too close?
function canFill(state, p, kind, depth) {
  const home = HOMES[kind];
  if (home.depth && (depth[p.id] ?? 0) < home.depth) return false;
  const near = nearby(state, p, HOME_REACH);
  const close = near.filter(({ d }) => d <= HOSTILE_REACH).map(({ p: o }) => o);
  if (kind === 'haunt') return !close.some((o) => o.home);
  const foe = HOSTILE[home.kin];
  if (foe && close.some((o) => o.home && HOMES[o.home.kind].kin === foe)) return false;
  return home.needs.every((alts) => near.some(({ p: o }) => o.done && alts.some((a) =>
    (a === 'treasure' ? o.treasure : roomOf(o) === a && (!HOMES[a] || o.home)))));
}

// Fills every home that can be filled, again and again, since one home filling can be what
// another needs (a vampire wants skeletons or zombies nearby).
function checkHomes(state, events) {
  const depth = depths(state);
  for (let changed = true; changed;) {
    changed = false;
    for (const p of Object.values(state.pieces)) {
      if (!p.done || p.home) continue;
      const kind = homeOf(p);
      if (!kind || !canFill(state, p, kind, depth)) continue;
      const home = HOMES[kind];
      p.home = { kind, mob: home.mob, n: home.n };
      state.score += home.pts;
      gain(state, home.tiles);
      state.stats.mobs = (state.stats.mobs || 0) + home.n;
      events.push({ type: 'home', id: p.id, home: kind, mob: home.mob, n: home.n, pts: home.pts, tiles: home.tiles });
      changed = true;
    }
  }
}

export function mobText(mob, n) {
  return n === 1 ? `a ${MOBS[mob].name.toLowerCase()}` : `${n} ${MOBS[mob].plural.toLowerCase()}`;
}

// ---------- charters ----------

const CHARTER_KINDS = ['depth', 'rooms', 'cave', 'dungeon', 'hall', 'treasure', 'crypt', 'armoury', 'library', 'academy', 'mobs', 'warren'];

export function charterProgress(state, c) {
  switch (c.kind) {
    case 'depth': return state.maxDepth;
    case 'rooms': return countRooms(state);
    case 'cave': return largestStyle(state, 'cave');
    case 'dungeon': return largestStyle(state, 'dungeon');
    case 'treasure': return countTreasure(state);
    case 'academy': return countCombo(state, 'academy');
    case 'mobs': return countMobs(state);
    case 'warren': return countMobs(state, 'orc');
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
    case 'academy': return n === 1 ? 'Found an Academy' : `Found ${n} Academies`;
    case 'mobs': return `House ${n} monsters`;
    case 'warren': return `House ${n} orcs`;
    default: {
      const r = ROOMS[c.kind];
      return n === 1 ? `Finish a ${r.name}` : `Finish ${n} ${r.plural || r.name + 's'}`;
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
  else if (kind === 'mobs') c.n = now + 3 + Math.floor(r * 3);
  else if (kind === 'warren') c.n = now + 4;
  else c.n = now + 1;
  const step = c.n - now;
  c.pts = kind === 'hall' || kind === 'treasure' || kind === 'academy' ? 18 : 10 + 2 * step;
  c.tiles = step >= 5 ? 3 : 2;
  return c;
}

function checkCharters(state, events) {
  for (let i = 0; i < state.charters.length; i++) {
    const c = state.charters[i];
    if (charterProgress(state, c) < c.n) continue;
    state.score += c.pts;
    gain(state, c.tiles);
    state.stats.charters++;
    events.push({ type: 'charter', text: charterText(c), pts: c.pts, tiles: c.tiles });
    const active = new Set(state.charters.map((x) => x.kind));
    const options = CHARTER_KINDS.filter((k) => !active.has(k));
    state.charters[i] = makeCharter(state, options[Math.floor(rand(state) * options.length)]);
  }
}
