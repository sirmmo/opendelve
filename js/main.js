import { View, CELL, pieceCenter, centerOf } from './view.js';
import { importOPD, exportOPD, isOPD } from './opd.js';
import { toGeoJSON } from './geojson.js';
import * as R from './rules.js';
import { PIECES, ROOMS, STYLES, COMBOS } from './pieces.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const PREFIX = 'opendelve.';
// The sandbox keeps its own save, so trying it never overwrites the delve.
const slot = (mode) => PREFIX + (mode === R.SANDBOX ? 'sandbox.' : '');

const view = new View($('scene'));
let state = null;
let undoJSON = null;
let spots = new Map(); // "x,y" -> options for the current piece
let breaches = new Set(); // spots that break through an old wall rather than meet a door
let hover = null;
let selected = null;
let optIdx = 0;
let wantRot = 0;
let lastCell = '';
let touchMode = false;
let previewCache = { k: '', v: null };
let seenCharters = new Set();
const floaters = [];

// ---------- game flow ----------

const randomSeed = () => Math.random().toString(36).slice(2, 8);
function todaySeed() {
  const d = new Date();
  return `day-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function setURL(seed) {
  const u = new URL(location.href);
  // An imported map can't be rebuilt from a seed, so don't offer one.
  if (state?.opd) u.searchParams.delete('seed');
  else u.searchParams.set('seed', seed);
  if (state && R.isSandbox(state)) u.searchParams.set('mode', R.SANDBOX);
  else u.searchParams.delete('mode');
  history.replaceState(null, '', u);
}

const sandbox = () => !!state && R.isSandbox(state);

function startGame(seed, mode) {
  state = R.newGame(seed, { mode });
  undoJSON = null;
  selected = null;
  seenCharters = new Set(state.charters.map((c) => c.id));
  view.clear();
  view.sync(state, { animate: false });
  view.cam.target.set(1, 0, -2);
  view.cam.dist = 22;
  $('over').hidden = true;
  setURL(state.seed);
  save();
  onTurn();
}

function resume(saved, undo) {
  state = saved;
  undoJSON = undo || null;
  seenCharters = new Set(state.charters.map((c) => c.id));
  view.clear();
  view.sync(state, { animate: false });
  view.frame(state);
  setURL(state.seed);
  store.set(PREFIX + 'mode', state.mode || 'delve');
  onTurn();
}

function save() {
  const s = slot(state.mode);
  store.set(s + 'save', JSON.stringify(state));
  store.set(s + 'undo', undoJSON || '');
  store.set(PREFIX + 'mode', state.mode || 'delve');
}

// The saved game of a mode, if it can still be played (or looked at, if it is a sealed map).
function loadSaved(mode, seed) {
  let saved = null;
  try { saved = JSON.parse(store.get(slot(mode) + 'save') || 'null'); } catch { saved = null; }
  if (!saved || saved.version !== 1 || (saved.over && !saved.sealed)) return null;
  if ((saved.mode || null) !== (mode === R.SANDBOX ? R.SANDBOX : null)) return null;
  if (seed && saved.seed !== seed) return null;
  return saved;
}

// Into the sandbox (a new one, or the one saved) and back to the delve.
function enterSandbox(fresh) {
  $('menu').hidden = true;
  const saved = !fresh && loadSaved(R.SANDBOX);
  if (saved) resume(saved, store.get(slot(R.SANDBOX) + 'undo'));
  else startGame(randomSeed(), R.SANDBOX);
  toast('<b>Sandbox</b> · choose every piece from the tray');
}

function leaveSandbox() {
  $('menu').hidden = true;
  const saved = loadSaved(null);
  if (saved) resume(saved, store.get(slot(null) + 'undo'));
  else startGame(randomSeed());
}

// `keepFits`: what fits where is still known (only the piece in hand changed).
function onTurn(keepFits) {
  fits = keepFits || null;
  const piece = state.queue[0];
  spots = new Map();
  breaches = new Set();
  if (piece) {
    for (const s of R.legalSpots(state, piece)) {
      spots.set(R.key(s.x, s.y), s.options);
      if (s.breach) breaches.add(R.key(s.x, s.y));
    }
  }
  lastCell = '';
  hud();
  palette();
  refreshGhost();
  view.thumbs.draw($('thumb1'), state.queue[1], 0);
  view.thumbs.draw($('thumb2'), state.queue[2], 0);
  $('bUndo').disabled = !undoJSON;
  if (state.over && !state.sealed) setTimeout(showOver, 900);
  lore();
}

const target = () => (touchMode ? selected : hover);

function currentOption() {
  const c = target();
  const opts = c && spots.get(R.key(c.x, c.y));
  if (!opts) return null;
  return opts[((optIdx % opts.length) + opts.length) % opts.length];
}

function refreshGhost() {
  const c = target();
  const piece = state.queue[0];
  const tip = $('tip');
  const k = c ? R.key(c.x, c.y) : '';
  const opts = c && spots.get(k);
  if (k !== lastCell) {
    lastCell = k;
    // Start from the turn the player last chose, if it fits here.
    optIdx = opts ? Math.max(0, opts.findIndex((o) => o.rot === wantRot)) : 0;
  }
  const o = currentOption();
  view.setGhost(piece, o);
  if (o) {
    const p = previewAt(o);
    const lines = [];
    for (const e of p.events) {
      if (e.type === 'room') lines.push(`<span class="b">finishes a ${ROOMS[e.room].name}${e.treasure ? ' with treasure' : ''}</span>`);
      if (e.type === 'deeper') lines.push(`<span class="b">reaches depth ${e.depth}</span>`);
      if (e.type === 'charter') lines.push('<span class="b">fulfils a charter</span>');
      if (COMBOS[e.type]) lines.push(`<span class="b">founds ${e.type === 'academy' ? 'an' : 'the'} ${COMBOS[e.type].name}</span>`);
    }
    const n = opts.length > 1 ? `<span class="n">${(optIdx % opts.length + opts.length) % opts.length + 1}/${opts.length}</span>` : '';
    tip.innerHTML = `<span class="pts">+${p.pts}</span>${n}${lines.join('')}`;
    tip.hidden = false;
  } else {
    tip.hidden = true;
  }
  view.setSpots([...spots.keys()].map((s) => { const [x, y] = R.unkey(s); return { x, y, breach: breaches.has(s) }; }), c);
  $('bPlace').hidden = !(touchMode && selected && o);
  view.thumbs.draw($('thumb0'), piece, o ? o.rot : wantRot);
}

function previewAt(o) {
  // In a sandbox the piece in hand can change within a turn.
  const p = state.queue[0];
  const k = `${state.turn}|${p.kind}|${p.style}|${o.rot}|${o.x}|${o.y}`;
  if (previewCache.k !== k) previewCache = { k, v: R.preview(state, o.rot, o.x, o.y) };
  return previewCache.v;
}

function rotate(dir) {
  const c = target();
  const opts = c && spots.get(R.key(c.x, c.y));
  if (opts && opts.length) {
    optIdx += dir;
    wantRot = currentOption().rot;
  } else {
    wantRot = (wantRot + dir + 4) % 4;
  }
  refreshGhost();
}

function placeOption(o) {
  if (!o || state.over) return;
  const before = JSON.stringify(state);
  const events = R.place(state, o.rot, o.x, o.y);
  if (!events) return;
  undoJSON = before;
  selected = null;
  view.sync(state);
  react(events);
  save();
  onTurn();
}

function discardTile() {
  if (state.over) return;
  const before = JSON.stringify(state);
  if (!R.discard(state)) return;
  undoJSON = before;
  toast('Piece thrown away');
  save();
  onTurn();
}

function undo() {
  if (!undoJSON) return;
  state = JSON.parse(undoJSON);
  undoJSON = null;
  $('over').hidden = true;
  view.sync(state, { animate: false });
  save();
  onTurn();
}

function at(id) {
  return centerOf(state.pieces[id]);
}

function react(events) {
  let delay = 0;
  for (const e of events) {
    if (e.type === 'place') floater(at(e.id), `+${e.pts}`, '', 0);
    if (e.type === 'deeper') {
      floater(at(e.id), `Depth ${e.depth}`, 'build', 0.35);
    }
    if (e.type === 'room') {
      delay += 0.5;
      const name = ROOMS[e.room].name;
      floater(at(e.id), e.treasure ? `${name} · treasure!` : name, 'build', delay);
      toast(`<b>${name}</b> finished${e.treasure ? ', with treasure' : ''}${e.find ? ' (bought by the Society)' : ''} · +${e.pts}${piecesText(e.tiles)}`);
    }
    if (COMBOS[e.type]) {
      // An Academy or an Archaeological Society: shown over each of its rooms.
      delay += 0.5;
      const name = COMBOS[e.type].name;
      for (const id of e.ids) floater(at(id), name, 'build', delay);
      const why = e.type === 'academy'
        ? 'scholars gather between the library and the shrine'
        : 'every treasure found from now on is worth more';
      toast(`<b>${name}</b> founded: ${why} · +${e.pts}${piecesText(e.tiles)}`);
    }
    if (e.type === 'charter') toast(`Charter fulfilled: ${e.text} · <b>+${e.pts}</b>${piecesText(e.tiles)}`);
  }
  bump('score');
  if (events.some((e) => e.type === 'room' || e.type === 'charter' || COMBOS[e.type])) bump('supply');
}

// ---------- HUD ----------

// " · +2 pieces", or nothing in a sandbox, where pieces never run out.
const piecesText = (n) => (sandbox() || !n ? '' : ` · +${n} piece${n === 1 ? '' : 's'}`);

// Tell the view how much of the screen the HUD covers at the top and the bottom.
function insets() {
  if ($('hud').hidden) return;
  const top = Math.max($('scorecard').getBoundingClientRect().bottom, $('charters').getBoundingClientRect().bottom);
  const bottom = $('palette').hidden ? $('hand').getBoundingClientRect().top : $('palette').getBoundingClientRect().top;
  view.setInsets(top, window.innerHeight - bottom);
}
window.addEventListener('resize', insets);

function hud() {
  $('score').textContent = state.score;
  const sb = sandbox();
  $('supply').textContent = sb ? '∞' : state.supply;
  $('depth').textContent = state.maxDepth;
  $('supply').classList.toggle('low', !sb && state.supply <= 5);
  $('modeTag').hidden = !sb;
  document.body.classList.toggle('sandbox', sb);
  const box = $('charters');
  box.innerHTML = '';
  for (const c of state.charters) {
    const now = Math.min(R.charterProgress(state, c), c.n);
    const el = document.createElement('div');
    el.className = 'charter card' + (seenCharters.has(c.id) ? '' : ' fresh');
    el.innerHTML = `<div class="head"><span class="seal">Quest</span><span class="reward">+${c.pts}${piecesText(c.tiles)}</span></div>
      <div class="txt">${R.charterText(c)} <small>(${now}/${c.n})</small></div>
      <div class="prog"><i style="width:${(100 * now) / c.n}%"></i></div>`;
    box.appendChild(el);
    seenCharters.add(c.id);
  }
  $('seedLabel').textContent = state.seed;
  $('best').textContent = store.get(PREFIX + 'best') || 0;
  insets();
}

// ---------- sandbox tray ----------

const KIND_NAMES = { corridor: 'Corridor', corner: 'Corner', junction: 'Junction', crossing: 'Crossing', deadend: 'Dead end' };
const STYLE_NAMES = { dungeon: 'Stone', cave: 'Cave' };

function kindName(kind) {
  const p = PIECES[kind];
  if (!p.room) return KIND_NAMES[kind] || kind;
  return `${ROOMS[p.room].name}, ${p.w}×${p.h}${kind.endsWith('_b') ? ' (variant)' : ''}`;
}

let trayStyle = '';
let trayBuilt = false;
let fits = null; // kind -> fits somewhere, for this turn (choosing a piece doesn't change it)

function buildTray() {
  const box = $('paletteKinds');
  for (const kind of R.SANDBOX_KINDS) {
    const b = document.createElement('button');
    b.className = 'pk';
    b.dataset.kind = kind;
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 96;
    b.appendChild(c);
    b.onclick = () => pickPiece(kind);
    box.appendChild(b);
  }
  // A mouse wheel scrolls the tray sideways when it doesn't fit.
  box.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    box.scrollLeft += e.deltaY;
  }, { passive: false });
  for (const style of STYLES) $('pStyle-' + style).onclick = () => pickPiece(state.queue[0]?.kind || 'corridor', style);
  trayBuilt = true;
}

// Shows the tray in a sandbox: the piece in hand marked, pieces that fit nowhere dimmed.
function palette() {
  const sb = sandbox() && !state.over;
  $('palette').hidden = !sb;
  if (!sb) return;
  if (!trayBuilt) buildTray();
  const cur = state.queue[0];
  const style = cur ? cur.style : 'dungeon';
  if (style !== trayStyle) {
    trayStyle = style;
    for (const b of $('paletteKinds').children) view.thumbs.draw(b.firstChild, { kind: b.dataset.kind, style, v: 1 }, 0);
  }
  for (const st of STYLES) {
    $('pStyle-' + st).classList.toggle('on', st === style);
    $('pStyle-' + st).setAttribute('aria-pressed', String(st === style));
  }
  // Style never changes where a piece fits.
  if (!fits) fits = Object.fromEntries(R.SANDBOX_KINDS.map((k) => [k, R.legalSpots(state, { kind: k, style, v: 0 }).length > 0]));
  for (const b of $('paletteKinds').children) {
    const kind = b.dataset.kind;
    const on = !!cur && kind === cur.kind;
    b.classList.toggle('on', on);
    b.classList.toggle('nofit', !fits[kind]);
    b.setAttribute('aria-pressed', String(on));
    const label = `${STYLE_NAMES[style]} ${kindName(kind).toLowerCase()}${fits[kind] ? '' : ' · fits nowhere now'}`;
    b.title = label;
    b.setAttribute('aria-label', label);
  }
  const box = $('paletteKinds');
  const onBtn = box.querySelector('.pk.on');
  if (onBtn) {
    const br = box.getBoundingClientRect();
    const r = onBtn.getBoundingClientRect();
    if (r.left < br.left) box.scrollLeft += r.left - br.left - 8;
    else if (r.right > br.right) box.scrollLeft += r.right - br.right + 8;
  }
}

function pickPiece(kind, style) {
  if (!sandbox() || !R.choose(state, kind, style)) return;
  const keep = fits;
  save();
  onTurn(keep);
  // A spot picked on a touch screen stays picked if the new piece fits there too.
  if (selected && !spots.has(R.key(selected.x, selected.y))) {
    selected = null;
    refreshGhost();
  }
}

function cyclePiece(dir) {
  if (!sandbox()) return;
  const kinds = R.SANDBOX_KINDS;
  const i = kinds.indexOf(state.queue[0]?.kind);
  pickPiece(kinds[(i + dir + kinds.length) % kinds.length]);
}

function toggleStyle() {
  if (!sandbox() || !state.queue[0]) return;
  pickPiece(state.queue[0].kind, state.queue[0].style === 'dungeon' ? 'cave' : 'dungeon');
}

function bump(id) {
  const el = $(id);
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function toast(html) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = html;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3300);
  while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
}

function floater(pos, text, cls, delay) {
  const el = document.createElement('div');
  el.className = 'floater ' + cls;
  el.textContent = text;
  el.style.opacity = 0;
  $('floaters').appendChild(el);
  floaters.push({ el, pos, t: -delay, life: 1.5 });
}

view.onFrame = (dt) => {
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.t += dt;
    if (f.t < 0) continue;
    const k = f.t / f.life;
    if (k >= 1) {
      f.el.remove();
      floaters.splice(i, 1);
      continue;
    }
    const p = view.toScreen(f.pos.x, f.pos.z, 2.6 + k * 1.6);
    f.el.style.left = p.x + 'px';
    f.el.style.top = p.y + 'px';
    f.el.style.opacity = k < 0.15 ? k / 0.15 : k > 0.7 ? (1 - k) / 0.3 : 1;
  }
  for (const el of noteEls) {
    const p = view.toScreen(Number(el.dataset.x) * CELL, Number(el.dataset.y) * CELL, 0.4);
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
  }
  const o = currentOption();
  const tip = $('tip');
  if (o && !tip.hidden) {
    const c = pieceCenter(state.queue[0].kind, o.rot, o.x, o.y);
    const p = view.toScreen(c.x, c.z, 3.4);
    tip.style.left = p.x + 'px';
    tip.style.top = p.y + 'px';
  }
};

function showOver() {
  if (!state.over) return;
  const best = Math.max(Number(store.get(PREFIX + 'best') || 0), state.score);
  store.set(PREFIX + 'best', String(best));
  $('finalScore').textContent = state.score;
  $('finalBest').textContent = best === state.score && state.score > 0 ? 'A new best delve!' : `Best delve: ${best}`;
  const s = state.stats;
  $('finalStats').innerHTML = `<li>${s.placed} pieces laid · depth ${state.maxDepth}</li><li>${s.rooms} rooms finished</li><li>${s.treasure} treasures found</li>${s.academies || s.societies ? `<li>${s.academies || 0} ${s.academies === 1 ? 'Academy' : 'Academies'} · ${s.societies || 0} Archaeological ${s.societies === 1 ? 'Society' : 'Societies'}</li>` : ''}<li>${s.charters} quests fulfilled</li><li>Seed <code>${state.seed}</code></li>`;
  $('over').hidden = false;
}

// ---------- input ----------

const canvas = $('scene');
const pointers = new Map();
let drag = null;
let pinch = null;

function setTouch(on) {
  if (touchMode === on) return;
  touchMode = on;
  document.body.classList.toggle('touch', on);
  hover = null;
  selected = null;
  refreshGhost();
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  setTouch(e.pointerType === 'touch');
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  view.camGoal = null;
  if (pointers.size === 1) {
    drag = { button: e.button, x0: e.clientX, y0: e.clientY, moved: false, ground: view.groundAt(e.clientX, e.clientY), yaw0: view.cam.yaw, pitch0: view.cam.pitch };
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), a0: Math.atan2(b.y - a.y, b.x - a.x), dist0: view.cam.dist, yaw0: view.cam.yaw, ground: view.groundAt((a.x + b.x) / 2, (a.y + b.y) / 2) };
    if (drag) drag.moved = true;
  }
});

function panTo(ground, x, y) {
  if (!ground) return;
  const p = view.groundAt(x, y);
  if (!p) return;
  view.cam.target.x += ground.x - p.x;
  view.cam.target.z += ground.z - p.z;
  view.updateCamera();
}

canvas.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    view.cam.dist = pinch.dist0 * (pinch.d0 / Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1));
    view.cam.yaw = pinch.yaw0 - (Math.atan2(b.y - a.y, b.x - a.x) - pinch.a0);
    view.updateCamera();
    panTo(pinch.ground, (a.x + b.x) / 2, (a.y + b.y) / 2);
    return;
  }
  if (drag) {
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) > (touchMode ? 10 : 5)) drag.moved = true;
    if (drag.moved) {
      if (drag.button === 2 || drag.button === 1) {
        view.cam.yaw = drag.yaw0 - dx * 0.008;
        view.cam.pitch = drag.pitch0 + dy * 0.005;
        view.updateCamera();
      } else {
        panTo(drag.ground, e.clientX, e.clientY);
      }
    }
  }
  if (!touchMode) {
    const c = view.cellAt(e.clientX, e.clientY);
    if (!c || !hover || c.x !== hover.x || c.y !== hover.y) {
      hover = c;
      refreshGhost();
    }
  }
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  const wasTap = drag && !drag.moved && pointers.size === 1;
  pointers.delete(e.pointerId);
  if (wasTap && e.type === 'pointerup') {
    if (drag.button === 2) rotate(1);
    else if (drag.button === 0) tap(view.cellAt(e.clientX, e.clientY));
  }
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 1) {
    const [p] = [...pointers.values()];
    drag = { button: 0, x0: p.x, y0: p.y, moved: true, ground: view.groundAt(p.x, p.y), yaw0: view.cam.yaw, pitch0: view.cam.pitch };
  } else if (pointers.size === 0) {
    drag = null;
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => {
  if (!touchMode && !drag) {
    hover = null;
    refreshGhost();
  }
});

function tap(c) {
  if (!c) return;
  if (!touchMode) {
    if (c.x === hover?.x && c.y === hover?.y) placeOption(currentOption());
    return;
  }
  if (selected && selected.x === c.x && selected.y === c.y) {
    placeOption(currentOption());
    return;
  }
  selected = spots.has(R.key(c.x, c.y)) ? c : null;
  refreshGhost();
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  view.camGoal = null;
  view.cam.dist *= Math.exp(e.deltaY * 0.0012);
}, { passive: false });

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'escape') {
    $('help').hidden = true;
    $('menu').hidden = true;
    selected = null;
    refreshGhost();
    return;
  }
  if (!$('help').hidden || !$('menu').hidden) return;
  const step = 2.5;
  const fwd = { x: -Math.sin(view.cam.yaw), z: -Math.cos(view.cam.yaw) };
  const right = { x: -fwd.z, z: fwd.x };
  const move = (f, s) => {
    view.camGoal = null;
    view.cam.target.x += (fwd.x * f + right.x * s) * step;
    view.cam.target.z += (fwd.z * f + right.z * s) * step;
  };
  if (k === 'r') rotate(e.shiftKey ? -1 : 1);
  else if (k === 'f') rotate(-1);
  else if (k === 'z') undo();
  else if (k === 'x') discardTile();
  else if (k === '[') cyclePiece(-1);
  else if (k === ']') cyclePiece(1);
  else if (k === 't') toggleStyle();
  else if (k === 'c') view.frame(state);
  else if (k === 'h' || k === '?') $('help').hidden = false;
  else if (k === 'q') view.cam.yaw += 0.3;
  else if (k === 'e') view.cam.yaw -= 0.3;
  else if (k === 'w' || k === 'arrowup') move(1, 0);
  else if (k === 's' || k === 'arrowdown') move(-1, 0);
  else if (k === 'a' || k === 'arrowleft') move(0, -1);
  else if (k === 'd' || k === 'arrowright') move(0, 1);
  else if (k === '+' || k === '=') view.cam.dist *= 0.85;
  else if (k === '-') view.cam.dist /= 0.85;
  else return;
  e.preventDefault();
});

// ---------- maps: One Page Dungeon and GeoJSON ----------

function download(name, obj, type) {
  const blob = new Blob([JSON.stringify(obj, null, type === 'application/json' ? 0 : undefined)], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const fileName = () => (state.opd ? state.opd.title : `opendelve-${state.seed}`).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function exportMap() {
  download(`${fileName()}.json`, exportOPD(state), 'application/json');
}

// ?origin=lon,lat places the dungeon on the globe (default 0,0).
function exportGeo() {
  const o = (new URLSearchParams(location.search).get('origin') || '').split(',').map(Number);
  const origin = o.length === 2 && o.every(Number.isFinite) ? o : [0, 0];
  download(`${fileName()}.geojson`, toGeoJSON(state, { origin }), 'application/geo+json');
}

async function importFile(file) {
  if (!file) return;
  let json;
  try {
    json = JSON.parse(await file.text());
  } catch {
    toast("That file isn't JSON");
    return;
  }
  if (!isOPD(json)) {
    toast("That isn't a One Page Dungeon map (it has no rects and doors)");
    return;
  }
  const mode = sandbox() ? R.SANDBOX : undefined;
  state = importOPD(json, { mode });
  undoJSON = null;
  selected = null;
  seenCharters = new Set(state.charters.map((c) => c.id));
  $('menu').hidden = true;
  $('over').hidden = true;
  view.clear();
  view.sync(state, { animate: false });
  view.frame(state);
  setURL(state.seed);
  save();
  onTurn();
  toast(state.sealed ? `<b>${state.opd.title}</b> has no way out to dig from: have a look around` : `<b>${state.opd.title}</b> imported${mode ? ' into the sandbox' : ''} · dig on from its entrance`);
  $('lore').querySelector('#loreHead').setAttribute('aria-expanded', 'true');
  $('loreBody').hidden = false;
}

// The imported map's title, story and numbered notes.
let noteEls = [];
function lore() {
  const o = state.opd;
  $('lore').hidden = !o;
  for (const el of noteEls) el.remove();
  noteEls = [];
  if (!o) return;
  $('loreTitle').textContent = o.title;
  $('loreStory').textContent = o.story;
  $('loreNotes').innerHTML = '';
  const notes = [...o.notes].sort((a, b) => (Number(a.ref) || 0) - (Number(b.ref) || 0));
  for (const n of notes) {
    const li = document.createElement('li');
    li.value = Number(n.ref) || undefined;
    li.textContent = n.text;
    $('loreNotes').appendChild(li);
    const el = document.createElement('div');
    el.className = 'note-label';
    el.textContent = n.ref;
    el.dataset.x = n.pos.x;
    el.dataset.y = n.pos.y;
    $('noteLabels').appendChild(el);
    noteEls.push(el);
  }
}

$('loreHead').onclick = () => {
  const open = $('loreBody').hidden;
  $('loreBody').hidden = !open;
  $('loreHead').setAttribute('aria-expanded', String(open));
};
$('bImport').onclick = () => $('fileOPD').click();
$('fileOPD').onchange = (e) => {
  importFile(e.target.files[0]);
  e.target.value = '';
};
$('bExportOPD').onclick = exportMap;
$('bOverOPD').onclick = exportMap;
$('bGeo').onclick = exportGeo;
$('bOverGeo').onclick = exportGeo;
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('dragging');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  importFile(e.dataTransfer.files[0]);
});

// ---------- buttons ----------

$('bRotL').onclick = () => rotate(-1);
$('bRotR').onclick = () => rotate(1);
$('bPlace').onclick = () => placeOption(currentOption());
$('bDiscard').onclick = discardTile;
$('bUndo').onclick = undo;
$('bCenter').onclick = () => view.frame(state);
$('bHelp').onclick = () => { $('help').hidden = false; };
$('bHelpClose').onclick = () => { $('help').hidden = true; store.set(PREFIX + 'seenHelp', '1'); };
$('bMenu').onclick = () => {
  hud();
  const sb = sandbox();
  $('bSandboxContinue').hidden = sb || !loadSaved(R.SANDBOX);
  $('bSandboxLeave').hidden = !sb;
  $('bRestart').hidden = sb;
  $('bShare').hidden = sb;
  $('bSandbox').textContent = sb ? 'New sandbox' : 'Sandbox (choose every piece)';
  $('menuTitle').textContent = sb ? 'Sandbox' : 'Dungeon';
  $('menu').hidden = false;
};
$('bMenuClose').onclick = () => { $('menu').hidden = true; };
$('bNew').onclick = () => { $('menu').hidden = true; startGame(randomSeed()); };
$('bDaily').onclick = () => { $('menu').hidden = true; startGame(todaySeed()); };
$('bRestart').onclick = () => { $('menu').hidden = true; startGame(state.seed, state.mode); };
$('bSandbox').onclick = () => enterSandbox(true);
$('bSandboxContinue').onclick = () => enterSandbox(false);
$('bSandboxLeave').onclick = leaveSandbox;
$('bShare').onclick = async () => {
  const u = new URL(location.href);
  u.search = '?seed=' + encodeURIComponent(state.seed);
  try {
    await navigator.clipboard.writeText(u.href);
    toast('Link copied');
  } catch {
    toast(u.href);
  }
};
$('bOverNew').onclick = () => startGame(randomSeed());
$('bOverRestart').onclick = () => startGame(state.seed);
$('bOverLook').onclick = () => { $('over').hidden = true; view.frame(state); };
for (const id of ['help', 'menu']) {
  $(id).addEventListener('click', (e) => { if (e.target.id === id) $(id).hidden = true; });
}

// ---------- boot ----------

async function boot() {
  await view.load((k) => { $('loadbar').style.width = `${Math.round(k * 100)}%`; });
  const params = new URLSearchParams(location.search);
  const urlSeed = params.get('seed');
  // ?mode=sandbox opens the sandbox; without a seed in the link, carry on in the last mode played.
  const mode = params.get('mode') === R.SANDBOX || (!urlSeed && store.get(PREFIX + 'mode') === R.SANDBOX) ? R.SANDBOX : undefined;
  const saved = loadSaved(mode, urlSeed);
  if (saved) resume(saved, store.get(slot(mode) + 'undo'));
  else startGame(urlSeed || randomSeed(), mode);
  $('loading').hidden = true;
  $('hud').hidden = false;
  insets();
  view.shift = view.shiftGoal;
  view.applyShift();
  if (!store.get(PREFIX + 'seenHelp')) $('help').hidden = false;
  view.start();
  window.__opendelve = { get state() { return state; }, view, R, placeOption, rotate, pickPiece, enterSandbox, leaveSandbox, CELL, PIECES, importOPD, exportOPD, toGeoJSON, importFile };
}

boot().catch((err) => {
  console.error(err);
  $('loading').innerHTML = `<div class="title">OpenDelve</div><p>Could not open the dungeon: ${String(err.message || err)}</p>`;
});
