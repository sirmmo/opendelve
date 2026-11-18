// Plays greedy games and prints how long they last and what gets finished.
import { newGame, place, discard, preview, legalSpots } from '../js/rules.js';
import { PIECES } from '../js/pieces.js';
const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['1', '2', '3', '4', '5', '6'];
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
  console.log(`seed ${seed}: turns ${s.turn} score ${s.score} discards ${s.stats.discarded} depth ${s.maxDepth} treasure ${s.stats.treasure} charters ${s.stats.charters}`, JSON.stringify(rooms));
}
