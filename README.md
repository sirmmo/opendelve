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
3. **Ancient rooms.** Some rooms are found already in ruins, dressed from the moment they are
   laid: the *lost library* (5×3, open at both ends, shelves along its long walls), the
   *shrine* (a 3×3 corner room with a statue) and the *fallen gallery* (5×3, open on all
   sides, broken columns under a standing arch). Finished, they give up their finds (candles,
   pots, skulls) and, deep enough, treasure like any room. Two combinations found societies of
   scholars, announced like rooms and quests (a step is one door from piece to piece; a room
   joins at most one of each):
   - **Academy:** a finished lost library and a finished shrine at most 3 steps apart.
     +15 glory and +1 piece.
   - **Archaeological Society:** a finished fallen gallery with a finished lost library and a
     finished crypt (the dig) each at most 3 steps from it. +22 glory and +2 pieces, and from
     then on every treasure found is worth 6 more.
4. **Delve deep.** A piece's depth is how many doors you pass from the stairs to reach it.
   Every new depth is worth glory, and doors joining two pieces of the same style (stone or
   cave) are worth more than mixed ones.
5. **Quests** set three goals at a time (reach depth 12, finish a crypt, open a cavern of six
   pieces, found an Academy…).
6. **Pieces run out.** You start with 45; finished rooms and quests bring more. When the last
   piece is laid, the delve is over.

Glory per piece: +2 for each door joined (+3 if both pieces are the same style), +3 for each
new level of depth. Rooms, treasure, Academies, Societies and quests add their own.

**Sandbox.** Menu → *Sandbox (choose every piece)* starts a dungeon with no bag: you pick each
piece from a tray of every kind (corridors, corners, junctions, crossings, dead ends and each
room), in stone or cave, then lay and turn it as usual. Pieces never run out and the delve never
ends; doors, depth, rooms, treasure, glory and quests work as in the normal game, and undo still
works. The sandbox has its own save, so it never overwrites your delve: *Back to the delve* and
*Continue the sandbox* switch between them (`?mode=sandbox` opens it). A One Page Dungeon map
imported while in the sandbox becomes a sandbox too.

**Walk the dungeon.** The walking figure at the top right (or `V`, or *Walk the dungeon* when
the delve is over) puts an adventurer at the foot of the stairs, with a torch and a camera that
follows. Walk anywhere you dug: through joined doors, around the columns, tables and ruins, into
the treasure rooms, whose bars lift as you come up to them. A label names the room you are in
and its depth. Climb back up the stairs (or press `Esc`) to dig again.

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
  for treasure rooms, stairs for the entrance), `notes` for finished rooms (naming the Academy
  or Society a room belongs to), `columns` for halls, crypts and the columns still standing in
  fallen galleries, and the deepest finished room as the `ending`. An imported map exports with
  all its original rects, doors and notes, plus whatever was dug.

The format has no walls of its own: floor is the union of the rects, so pieces that touch
wall-to-wall look joined in tools that read it.

## Map export (GeoJSON)

Menu → *Download map (GeoJSON)* saves the dungeon as a GeoJSON FeatureCollection. Each feature
has a `layer` property: `dungeon` (outline), `area` (merged stone, cave and ruin parts), `piece`
(every piece, with `kind`, `room`, `finished`, `treasure`, `depth`, and the number of the
`academy` and `society` it belongs to), `passage` (lines through
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
| Undo, discard, center | `Z`, `X`, `C` | ↶ and crosshair buttons, *Discard* |
| Sandbox: choose a piece | click it in the tray, `[` / `]` | tap it in the tray (swipe to see more) |
| Sandbox: stone or cave | `T`, *Stone* / *Cave* | *Stone* / *Cave* |
| Walk the dungeon | walking figure, `V` | walking figure |
| Walk, run | `WASD` / arrows, hold `Shift` to run | a thumb anywhere: push further to run |
| Turn the view while walking | drag, `Q` / `E`; wheel to zoom | two fingers: twist and pinch |
| Stop walking | up the stairs, `Esc`, `V`, *Back to digging* | up the stairs, *Back to digging* |

## Development

Plain HTML, CSS and JavaScript modules. No build step and no dependencies at runtime.

```sh
python3 -m http.server 8000      # then open http://localhost:8000
npm test                          # rules, walking, map import/export tests (Node 20+)
OPD_SAMPLE=map.json npm test      # also check a real One Page Dungeon export
node tools/balance.mjs 1 2 3      # greedy games per seed: length, score, rooms
```

| Path | What |
| --- | --- |
| `js/pieces.js` | Pieces (size, doors, model), the bag, room types, rewards, Academies and Societies |
| `js/ruins.js` | How the ancient rooms are dressed with ruins: pure and seeded, so tests check every item stays on the floor and out of the doors |
| `js/rules.js` | The game: pure, seeded and JSON-serialisable (`newGame`, `legalSpots`, `place`, `preview`; `choose` in a sandbox) |
| `js/view.js` | three.js dungeon, gates, room furniture, ghost piece, hand and tray thumbnails |
| `js/opd.js` | One Page Dungeon JSON import and export |
| `js/geojson.js`, `js/geo.js` | GeoJSON export: projection and merging cells into outlines |
| `js/walk.js` | Walking, the pure part: which sides of each cell lead on (joined doors), where a walk starts, the stairs' ramp |
| `js/walker.js` | Walking in 3D: a top-down height map of the laid pieces (drawn once on the GPU) for what is in the way, the animated adventurer, the follow camera, the lifting bars |
| `js/main.js` | Input, HUD, sandbox tray, walking controls, saving, undo, file import and downloads |
| `tools/ports.py` | Measures each Kenney piece's footprint and doors from its mesh (`tools/glb.py` reads GLB) |
| `models/` | The models the game uses: Kenney's `dungeon/`, `cave/` and `props/`, KayKit's `treasure/`, each with its texture, and Quaternius' `ruins/` (GLB, material colours, repainted in the Kenney palette at load) |

The modular kits' wide corridors sit half a cell off the grid that rooms and narrow corridors
share, so they are left out.

## Credits

- 3D models by [Kenney](https://kenney.nl), CC0: Modular Dungeon Kit, Modular Cave Kit, Mini Dungeon.
- Treasure (gold chests, the mimic, coin stacks, gold keys and ore) from the KayKit Dungeon Pack by
  [Kay Lousberg](https://www.kaylousberg.com), CC0.
- Ruins (columns, the arch, statues, bookcases, pots, candles, bricks, the skull) from the
  Ultimate Modular Ruins Pack by [Quaternius](https://quaternius.com), CC0
  (`models/ruins/License.txt`).
- [three.js](https://threejs.org), MIT (`vendor/three-LICENSE.txt`).
- Fonts: Cinzel and Fredoka from Google Fonts (OFL).

## License

Code: GPL-3.0, see `LICENSE`. Models: CC0.

## Publishing on Wavedash

OpenDelve is published on [Wavedash](https://wavedash.com) ([docs](https://docs.wavedash.com)) from
`wavedash.toml`, at the root.

1. **Create the game** in the Wavedash Developer Portal, or with the CLI (`curl -fsSL
   https://wavedash.com/cli/install.sh | sh`, `wavedash auth login`, then `wavedash project create
   --title "OpenDelve" --team-id <TEAM_ID>`).
2. **Set its id**: `game_id` in `wavedash.toml`, or, to keep it out of the repository,
   `WAVEDASH_GAME_ID_OPENDELVE` (or `WAVEDASH_GAME_ID`) in the environment, and the repository
   variable `WAVEDASH_GAME_ID_OPENDELVE` (Settings › Secrets and variables › Actions › Variables).
3. **Upload a build**: `sh tools/wavedash.sh` assembles the site into `_wavedash/` the way the Pages
   workflow does (no tests or tools) and, with the CLI on `PATH` and `WAVEDASH_TOKEN` set, runs
   `wavedash build push`. Without the CLI (or with `WAVEDASH_DRY_RUN=1`) it only says what it would
   push. On GitHub: Actions › Wavedash › Run workflow, with the secret `WAVEDASH_TOKEN`.
4. **Publish it**: `wavedash publish <BUILD_ID>` (the id `build push` printed), or in the Developer
   Portal.

On Wavedash the game stays behind Wavedash's loading screen until it calls `Wavedash.init()`:
`js/main.js` does it through `js/wavedash.js` when the dungeon has loaded (the loading bar also
feeds Wavedash's), or when loading fails, to show the error. Elsewhere (GitHub Pages, a local
server) there is no `Wavedash` object and the calls do nothing.
