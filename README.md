# OpenDelve

A calm dungeon-digging game for the browser. Starting from the stairs down, you lay corridors
and rooms one piece at a time, door against door, and dig as deep as your pieces allow.

**Play:** https://sirmmo.github.io/opendelve/

A sibling of [OpenDorf](https://github.com/sirmmo/opendorf): the same seeded, pure rules
engine and three.js view, on a square grid with pieces that cover several cells.

## How it plays

1. **Dig from the stairs.** Lay each piece against an open doorway (the glowing squares).
   Doors must meet doors and walls must meet walls. Rooms are bigger than corridors
   (3×3, 5×3 and 5×5 cells), so the same spot can often take a piece in several ways: turning
   cycles through every way the piece fits there. You can't seal the last open doorway while
   pieces remain.
2. **Finish rooms.** When every door of a room leads somewhere, it gets furnished:
   storeroom, guardroom, armoury, crypt or great hall. Rooms finished at depth 9 or deeper
   also hold treasure, behind barred gates.
3. **Delve deep.** A piece's depth is how many doors you pass from the stairs to reach it.
   Every new depth is worth glory, and doors joining two pieces of the same style (stone or
   cave) are worth more than mixed ones.
4. **Quests** set three goals at a time (reach depth 12, finish a crypt, open a cavern of six
   pieces…).
5. **Pieces run out.** You start with 45; finished rooms and quests bring more. When the last
   piece is laid, the delve is over.

Glory per piece: +2 for each door joined (+3 if both pieces are the same style), +3 for each
new level of depth. Rooms, treasure and quests add their own.

Every dungeon has a seed; the same seed always deals the same pieces. Share one from the menu,
or play *Today's dungeon*. The game saves after every move, and the last move can be undone.

## One Page Dungeon maps

OpenDelve reads and writes the JSON of watabou's
[One Page Dungeon](https://watabou.github.io/one-page-dungeon/) generator.

- **Import:** make a map there, press `J` to save its JSON, then use menu → *Import a One Page
  Dungeon map…* (or drop the file on the page). The map becomes the start of a new delve: its
  rooms, corridors, doors (by type: arch, portcullis, stairs, secret…), columns, title, story and
  numbered notes are all shown. You dig on from its entrance, and any piece with a door laid
  against one of its old walls breaks through. Doors leading from the ruins count for depth like
  any other.
- **Export:** menu → *Export as One Page Dungeon JSON* (also on the end screen) writes the delve
  in the same format: `rects` for every piece, `doors` into rooms (arches for caves, a portcullis
  for treasure rooms, stairs for the entrance), `notes` for finished rooms, `columns` for halls
  and crypts, and the deepest finished room as the `ending`. An imported map exports with all its
  original rects, doors and notes, plus whatever was dug.

The format has no walls of its own: floor is the union of the rects, so pieces that touch
wall-to-wall look joined in tools that read it.

## Map export (GeoJSON)

Menu → *Download map (GeoJSON)* saves the dungeon as a GeoJSON FeatureCollection. Each feature
has a `layer` property: `dungeon` (outline), `area` (merged stone, cave and ruin parts), `piece`
(every piece, with `kind`, `room`, `finished`, `treasure`, `depth`), `passage` (lines through
every doorway), `door`, `entrance`, `note` and `column` (points). The grid's (0, 0) sits at
longitude/latitude 0, 0 with 1.5 m (5 ft) cells; open the game with `?origin=lon,lat` to place it
elsewhere.

## Controls

| | Mouse and keyboard | Touch |
| --- | --- | --- |
| Lay a piece | click a glowing square | tap a square, then tap it again (or *Place*) |
| Next way it fits | `R` / right click (`Shift+R` back) | ⟲ ⟳ |
| Move the view | drag, or `WASD` / arrows | drag |
| Rotate the view | right drag, `Q` / `E` | twist with two fingers |
| Zoom | wheel, `+` / `-` | pinch |
| Undo, discard, center | `Z`, `X`, `C` | ↶ and ⌖ buttons, *Discard* |

## Development

Plain HTML, CSS and JavaScript modules. No build step and no dependencies at runtime.

```sh
python3 -m http.server 8000      # then open http://localhost:8000
npm test                          # rules, map import/export tests (Node 20+)
OPD_SAMPLE=map.json npm test      # also check a real One Page Dungeon export
node tools/balance.mjs 1 2 3      # greedy games per seed: length, score, rooms
```

| Path | What |
| --- | --- |
| `js/pieces.js` | Pieces (size, doors, model), the bag, room types and rewards |
| `js/rules.js` | The game: pure, seeded and JSON-serialisable (`newGame`, `legalSpots`, `place`, `preview`) |
| `js/view.js` | three.js dungeon, gates, room furniture, ghost piece, hand thumbnails |
| `js/opd.js` | One Page Dungeon JSON import and export |
| `js/geojson.js`, `js/geo.js` | GeoJSON export: projection and merging cells into outlines |
| `js/main.js` | Input, HUD, saving, undo, file import and downloads |
| `tools/ports.py` | Measures each Kenney piece's footprint and doors from its mesh (`tools/glb.py` reads GLB) |
| `models/` | The Kenney models the game uses: `dungeon/`, `cave/` and `props/`, each with its texture |

The modular kits' wide corridors sit half a cell off the grid that rooms and narrow corridors
share, so they are left out.

## Credits

- 3D models by [Kenney](https://kenney.nl), CC0: Modular Dungeon Kit, Modular Cave Kit, Mini Dungeon.
- [three.js](https://threejs.org), MIT (`vendor/three-LICENSE.txt`).
- Fonts: Cinzel and Fredoka from Google Fonts (OFL).

## License

Code: GPL-3.0, see `LICENSE`. Models: CC0.
