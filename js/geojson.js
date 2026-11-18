// The dungeon as GeoJSON: its outline, one polygon per piece, merged stone, cave and ruin
// areas, the passages as lines, doors, the entrance, notes and columns as points.
//
// Grid (0, 0) is placed at `origin` ([lon, lat], default 0, 0) and one cell is
// `metersPerCell` metres (default 1.5, the usual 5-foot square).

import { PIECES, ROOMS } from './pieces.js';
import { shapeOf, pieceDoors, pieceAt, depths, styleGroups, DX, DY } from './rules.js';
import { exportOPD } from './opd.js';
import { projector, dissolve, polygonGeometry, feature } from './geo.js';

const square = (x, y) => [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]];
const cellsOf = (p) => shapeOf(p).cells.map(([x, y]) => [p.x + x, p.y + y]);
const mid = (x, y) => [x + 0.5, y + 0.5];

export function toGeoJSON(state, { origin = [0, 0], metersPerCell = 1.5 } = {}) {
  const project = projector(origin, metersPerCell);
  const poly = (cells) => polygonGeometry(dissolve(cells.map(([x, y]) => square(x, y))), project);
  const pieces = Object.values(state.pieces).sort((a, b) => a.id - b.id);
  const depth = depths(state);
  const features = [];

  features.push(feature(poly(pieces.flatMap(cellsOf)), {
    layer: 'dungeon', title: state.opd?.title || null, seed: state.seed, pieces: pieces.length, depth: state.maxDepth, score: state.score,
  }));

  for (const style of ['dungeon', 'cave']) {
    for (const g of styleGroups(state, style)) {
      features.push(feature(poly(g.flatMap((id) => cellsOf(state.pieces[id]))), { layer: 'area', kind: style === 'dungeon' ? 'stone' : 'cave', pieces: g.length }));
    }
  }
  const ruins = pieces.filter((p) => p.kind === 'ruin');
  if (ruins.length) features.push(feature(poly(ruins.flatMap(cellsOf)), { layer: 'area', kind: 'ruin', pieces: ruins.length }));

  // Passages: from each piece's middle to its doorways, and across each joined door.
  const lines = [];
  for (const p of pieces) {
    const L = shapeOf(p);
    const c = [p.x + L.w / 2, p.y + L.h / 2];
    for (const [x, y, d] of pieceDoors(p)) {
      lines.push([c, mid(x, y)]);
      const o = pieceAt(state, x + DX[d], y + DY[d]);
      if (o && o.id > p.id) lines.push([mid(x, y), mid(x + DX[d], y + DY[d])]);
    }
  }
  features.push(feature({ type: 'MultiLineString', coordinates: lines.map((l) => l.map(project)) }, { layer: 'passage' }));

  for (const p of pieces) {
    for (const [x, y, d] of pieceDoors(p)) {
      const o = pieceAt(state, x + DX[d], y + DY[d]);
      if (o && o.id < p.id) continue; // one point per joined door
      const at = [x + 0.5 + DX[d] * 0.5, y + 0.5 + DY[d] * 0.5];
      features.push(feature({ type: 'Point', coordinates: project(at) }, { layer: 'door', joined: !!o }));
    }
  }

  const entrance = state.pieces[state.entrance];
  if (entrance) {
    const L = shapeOf(entrance);
    features.push(feature({ type: 'Point', coordinates: project([entrance.x + L.w / 2, entrance.y + L.h / 2]) }, { layer: 'entrance' }));
  }

  const opd = exportOPD(state);
  for (const n of opd.notes) features.push(feature({ type: 'Point', coordinates: project([n.pos.x, n.pos.y]) }, { layer: 'note', ref: n.ref, text: n.text }));
  for (const c of opd.columns) features.push(feature({ type: 'Point', coordinates: project([c.x, c.y]) }, { layer: 'column' }));

  for (const p of pieces) {
    const room = PIECES[p.kind].room;
    features.push(feature(poly(cellsOf(p)), {
      layer: 'piece', id: p.id, kind: p.kind, style: p.style, rotation: (p.rot || 0) * 90,
      room: room ? ROOMS[room].name : null, finished: !!p.done, treasure: !!p.treasure,
      depth: depth[p.id] ?? null, door: p.door ? p.door.type : null, ending: !!p.rect?.ending,
    }));
  }

  return {
    type: 'FeatureCollection',
    name: state.opd?.title || `OpenDelve dungeon ${state.seed}`,
    opendelve: { seed: state.seed, turn: state.turn, score: state.score, depth: state.maxDepth, origin, metersPerCell, version: state.version },
    features,
  };
}
