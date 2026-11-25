// Plays greedy games and prints how long they last and what gets finished.
import { newGame, place, discard, preview, legalSpots } from '../js/rules.js';
import { PIECES } from '../js/pieces.js';
const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['1', '2', '3', '4', '5', '6'];
const sum = { turns: 0, score: 0, academies: 0, societies: 0 };
for (const seed of seeds) {
  const s = newGame(seed);
  const rooms = {};
  while (!s.over) {
    const spots = legalSpots(s, s.queue[0]);
    if (!spots.length) { discard(s); continue; }
    let best = null;
    for (const c of spots.slice(0, 8)) for (const o of c.options) {
      const p = preview(s, o.rot, o.x, o.y);
      if (!best || p.pts > best.pts) best = { ...o, pts: p.pts };
    }
    for (const e of place(s, best.rot, best.x, best.y)) if (e.type === 'room') rooms[e.room] = (rooms[e.room] || 0) + 1;
  }
  const { academies = 0, societies = 0 } = s.stats;
  for (const [k, v] of Object.entries({ turns: s.turn, score: s.score, academies, societies })) sum[k] += v;
  console.log(`seed ${seed}: turns ${s.turn} score ${s.score} discards ${s.stats.discarded} depth ${s.maxDepth} treasure ${s.stats.treasure} charters ${s.stats.charters} academies ${academies} societies ${societies}`, JSON.stringify(rooms));
}
console.log('mean', Object.entries(sum).map(([k, v]) => `${k} ${(v / seeds.length).toFixed(1)}`).join(' '));
