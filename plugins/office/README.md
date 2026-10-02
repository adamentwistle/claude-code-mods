# office

A pixel-art office of every busy terminal in [herdr](https://herdr.dev). `/office` opens a pane (a sidebar when the terminal is wide enough) with a desk for every agent pane, and for every plain pane running something. Each worker's animation shows what the pane is doing, so you can read the room at a glance.

## Fewer, bigger desks

By default only Claude sessions get a desk (`show`: claude). Other coding agents, terminals running something (as robots) and idle shells are opt-in: `agents`, `busy`, `all`. At most 8 desks show at once (`desks`, key `d`: 4, 6, 8, 12 or all), the most relevant first: needs you, working, done, idle. The header says `+N more`, and `m` pages on.

Fewer desks are drawn bigger. The office and war room use the largest whole-number scale at which every desk fits, so 8 desks in a full-screen pane are twice the size. Name tags widen with them, and the whole workstation is the drag target. The grid uses its large cards wherever they fit, sidebar included.

## Words in the bubbles

Each desk's bubble says what its session is doing:

- **Working:** "Thinking...", "Writing...", "Coding..." (Edit, Write, Bash and the like), "Reading...", "Searching..." (Grep, Glob, web) or "Delegating..." (subagents).
- **Waiting on you:** "Help please".
- **Finished:** "Done", and "Done!" until you look.
- **Idle:** no words, just the coffee.

A session running this mod records its activity in its registry entry, from the model's own stream (thinking or text) and its tool calls. For other sessions it comes from the tail of the transcript: the last assistant block. That is at most one `tail -c 32768` per working session whose transcript changed, and at most 3 a poll. The words are text cells in every view (and the grid tag's second line).

## Hybrid (the default)

`render` (key `g`) is `hybrid` or `cells`. In `hybrid` the cell office or war room stays a Raster, and each person is a small real picture (the detailed Kenney people, or the mod's robots, critters and animals) in its own keyed Image. Its background is cropped from the very cells beneath it, pixel for pixel, so no box shows. `cells` never draws pictures.

- **What it needs.** Inside herdr, launch Claude Code with `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1`. herdr then passes kitty graphics through to Ghostty.
- **Sharp, not blurred.** A mod cannot know how many pixels a cell is, so a picture sent at its own size (one pixel per half cell) is stretched by the terminal with smoothing. Instead each picture is enlarged 16 times, pixel for pixel, and sent as a PNG: the terminal only ever shrinks it, so edges stay hard. Rows are filtered so the enlarged pixels deflate to back-references: 4 to 7 KB of PNG for a character (18 x 20 to 28 x 24 pixels), against 1.4 to 2.7 KB of raw RGBA that drew blurred.
- **When pictures are sent.** Only when a desk changes or moves, at most once a second, never while still.
- **Sidebars too.** A desk too small for a 16-pixel person gets a picture drawn 2 or 3 times finer (2 or 3 pixels per half cell), its background still the room's own pixels, so a docked sidebar shows pictures as well.
- **Fallback.** One probe blit tells whether pictures draw. Where they draw their alt text, everything stays cells with bold characters, and the header says why: `pictures off: this terminal draws no images`, `desks too small here`, `the pane is too small for the room` or `the character art did not load`.

## Bold characters, critters first

Where pictures do not draw (or `render` is `cells`), the office is all block cells. Its people are critters (`characters`), and they are drawn **bold** (`style`, key `b`). Bold characters are chunky blocks with a thick outline, eyes two pixels tall and one feature each: hair for humans, a visor for robots, ears for cats and dogs, tufts for owls. They are made for cell resolution rather than shrunk from detailed art. `detailed` brings back the finer v3 to v6 characters.

## Tiles

The `tiles` layout is the grid's cards, each with a small real picture of its character (16 x 24 pixels, sent as a 4 KB PNG enlarged as in hybrid) in its own keyed `Image` over the card. The rest of the card stays cells.

- **When it is sent.** A tile's picture is sent again only when that tile changes or moves, at most once a second, and never while it is still.
- **Limits.** At most 24 pictures in one drawing; further cards draw their characters in cells.
- **Fallback.** One probe blit tells whether pictures draw. If not, every card gets bold cell characters.

## Outside herdr

When `herdr` is missing or fails, the office still works. herdr is asked again a minute later, and the header says which source is in use.

**Claude Code's own records come first.** These are `<config>/sessions/<pid>.json` under `$CLAUDE_CONFIG_DIR`, `~/.claude-work` and `~/.claude`. Only the `*.json` files are read: the `.key` files beside them are secrets and are never opened.

- **Live.** A session is live when its pid runs (one `ps -o pid= -p a,b,c` per poll) or its record was updated in the last two minutes.
- **State.** `busy` is working, `idle` is idle, and anything waiting on permission or input needs you. A session that also runs this mod adds its richer state and activity from its registry entry.
- **Header.** The source is named "Claude Code sessions".

Only when there are no such records does the office fall back to:

1. **A sessions registry.** Every session running this mod keeps one small file, `<config>/plugins/data/office-registry/<session id>.json`, holding its id, cwd, project, state (working, idle, needs-you or done), subagent count and last heartbeat. It is written on start and on each state change: turn start, turn end, `AskUserQuestion` and permission prompts. A heartbeat rewrites it every 30 s, and it is left at session end. An entry not heard from for 2 minutes has expired. It is a file per session rather than `$.store` because the store is one JSON file per plugin, and sessions writing their own keys into it at once would overwrite each other's copies.
2. **Recent transcripts.** Sessions that do not run the mod come from `<config>/projects/*/*.jsonl` written in the last 30 minutes: idle if written in the last 5, done before that. A few project folders are listed per poll, in turn.

Outside herdr there is no pane to jump to. Clicking a desk, or pressing its key, shows the session's cwd and id and copies `claude --resume <id>`. bin/office-monitor reads the same registry and transcripts straight from disk, and shows the resume command in its footer.

## Layouts

| Layout | What it is |
| --- | --- |
| `grid` (default) | One tile per desk, side view, the v2 look. The tile shrinks so everyone fits. |
| `office` | A room: a back wall with windows whose sky follows the time of day, a bookshelf, a wall clock showing the real time, a server rack with blinking LEDs, a water cooler, plants and a poster. Plank floor in perspective, rugs, light pools from the ceiling lamps. Desks are a long bench for 1 to 6 sessions, then pods of four or rows, in a regular or a small size, so 1 to about 40 sessions fit. |
| `war-room` | Everyone round one big table: the far side faces you, the near side has its back to you with the laptop screen showing. A second table opens when one is full. |
| `strip` | One compact row for a narrow pane. When even that is too wide, each session becomes a head over a coloured state bar. |

`/office full` (or `f`) asks Claude Code for as much of the screen as a pane can have: the terminal width minus 30 columns, and up to 200 rows.

## States

Each state has its own pose and accent colour, and the accent repeats on the desk stripe, the name tag and the header strip.

| State | At the desk | Accent |
| --- | --- | --- |
| needs you | Standing and waving both arms, a red and amber beacon flashing, red light on the room, `!` on the screen | red |
| working | Typing with the hands alternating, code scrolling, key flashes and sparks, the screen glow lighting the face | green |
| running (plain terminal) | A robot at a green terminal, named after the process (`npm run dev`) | orange |
| idle | Feet up on the desk, coffee in hand with steam, a sip now and then, the chair swivelling, a screensaver | blue |
| done | Head down on the desk, monitor off, `zZ` floating up | grey |
| just finished | Cheering with confetti for 4 seconds, then a stretch for 3, round again, until you look at it (its pane is focused in herdr, or it starts working again). Then it sleeps. The "not looked at yet" mark is kept in `$.store`, so a reload goes on celebrating. | |
| helpers | One minion per active subagent around the desk, and `x<count>` | |
| this session | A small gold crown | |

## Settings

Press `s` in the office, or run `/office settings`. Each option has a key that cycles it, and the choice is saved in the mod's `$.store` for every session. The `userConfig` values in `plugin.json` (`/config`, or `/plugin configure`) are the defaults the store overrides.

| Key | Option | Values |
| --- | --- | --- |
| `l` | layout | grid, tiles, office, war-room, strip |
| `c` | characters | critters (the default: small orange blocky mascots), humans (varied skin, hair and clothes, the same per session every time), robots, animals (cats, dogs, owls), mixed by project |
| `b` | style | bold (the default in cells), detailed |
| `t` | lighting | clock, day, night |
| `p` | palette | nightshade (from the Nightshade Ghostty theme), warm, cool, mono |
| `w` | which panes | claude (the default), agents, busy (adds busy terminals), all (adds idle shells as empty desks) |
| `d` | desks at a time | 4, 6, 8 (the default), 12, all; never more than fit the pane |
| `h` | hide done after | 0 (never), 5, 15, 30, 60 minutes |
| `o` | seating | state (the default: needs you, working, done, idle, then busy terminals), stable (a session keeps its place), project, workspace (one rug and label per group) |
| `m` | animation speed | slow, normal, fast |
| `r` | reduced motion | slower frames, no particles, confetti or flashing |
| `n` | toasts | needs-you, changes, off |
| `g` | render | hybrid (the default: people as pictures where they draw), cells |
| `u` | sound | a short chime (`sounds/needs-you.wav`) when a session starts needing you. Off by default |

Under the options you can pick a session and give it a label, a character (human, robot, critter, cat, dog or owl) or a place in the order (1 is the first desk). A pinned desk is put back at that place in every seating mode; with fewer desks than that it goes last. `z` forgets that session's settings. Per-session settings are keyed by the Claude session id, or by the pane for a plain terminal.

**Seats are packed.** Desks fill from the top left in order, one per session, with no gaps and no rows of empty desks. **Stable seating** (an option; state order is the default) keeps each session's place in that order while it runs; when one leaves, the others close up. The order is remembered in `$.store`. Before v10 a drag pinned an absolute seat number (25, 49) and every seat up to it was drawn; those old numbers are dropped once on load, names and characters kept.

## Arrange by dragging

Press a desk with the mouse, drag it onto another desk, and let go: the desk you carried takes that place in the order and the ones between move up one. It is pinned to that place in `$.store`, in every seating mode. While you drag, a ghost with the desk's name follows the pointer, the desk you picked up is outlined in grey and the one under the pointer in yellow. A press and release without moving jumps to that desk's pane. The drag layer is a `Client` laid over the picture (`hooks/office-drag.mjs`). A `Client` holds the pointer from press to release and can't draw a Raster, so the picture stays a Raster underneath it. The layer names the desk under the pointer itself, from the same rectangles it was drawn with, and the floor never scrolls (see Keys), so the outlines land where the pointer is. Pins can also be set by number in the settings.

Busy terminals sort after idle sessions: they are long-running servers and watchers, rarely news.

## Keys

In the office view, letters control the view: `l` layout, `d` desks at a time, `c` characters, `b` style, `t` lighting, `p` palette, `g` pictures or cells (render), `m` next page, `s` settings, `f` full size or sidebar, `x` close. The header strip shows them all; in a sidebar they show their values alone, to keep it short.

**The desks always fit.** `desks` (key `d`, the settings view, or the plugin's config) caps how many are drawn in every layout and render mode, pane or full. On top of that the floor gets only the rows the header leaves, and a page holds no more desks than fit them, so the pane never scrolls: the rest are `+N more`, a page away with `m`. A room too short for even one desk is drawn as the grid. A value changed in the plugin's config wins over an older one saved from the settings view. bin/office-monitor uses the same letters, plus `q` to quit.

## Name tags are the buttons

Each tag reads `<key>: <name>`. Desks take digits only: `1`-`9`, then `0` for the tenth. Any other desk is reached by clicking it or dragging it. Pressing the key, or clicking the tag, jumps to that pane. For an agent pane the jump is `herdr workspace focus`, then `tab focus`, then `agent focus`. `x` closes the office.

## Demo mode

For a screen recording: `OFFICE_DEMO=1` in the environment, or `/office demo` (again to leave), or `bin/office-monitor --demo`. The header says ` demo `. Eight scripted sessions replace herdr and the session records, on a 60-second loop that starts at 0 each time demo mode turns on or the office opens, so takes repeat exactly. Nothing is asked of herdr, and nothing of the demo is saved to the store.

| Second | What happens |
| --- | --- |
| 0 | api-refactor (crowned, this session) coding, docs-site writing, bug-triage searching, release-notes writing, test-suite thinking, security-review delegating to 3 helpers; db-migration and onboarding idle |
| 8 to 14 | api-refactor reading, then thinking; docs-site searching (12) |
| 15 | bug-triage needs you: "Help please", the beacon, a toast |
| 20 | db-migration wakes up and thinks, then codes (28) |
| 27 | bug-triage back to work |
| 30 | release-notes finishes: "Done!" and the celebration loop; security-review down to 2 helpers |
| 40 | release-notes looked at: it settles to "Done" |
| 45 | security-review's helpers finish; it writes |
| 46 | db-migration idle again |
| 60 | the loop starts over |

A desk's key or click toasts `demo: would jump to <name>`. Dragging reorders the demo desks. Layouts, characters (`mixed` gives one of each kind), desks at a time, pictures and settings work as usual.

## A monitor with no Claude session

```bash
mods/office/bin/office-monitor --help                   # the flags and keys
mods/office/bin/office-monitor --layout office          # q quits; m pages; l d c b t p cycle the view
mods/office/bin/office-monitor --pictures               # the people as pictures (kitty graphics), as in hybrid
mods/office/bin/office-monitor --once --size 200x56     # print one frame and exit
mods/office/bin/office-monitor --demo                   # the scripted demo loop, for a recording
```

The monitor draws half blocks by default. With `--pictures` (or `g`) the office and war room put each person in as a sharp PNG over the cells, as the pane's hybrid view does, for terminals that draw kitty graphics (Ghostty, kitty).

It runs on node (or bun) and uses the same painter as the pane: `hooks/office-model.mjs` and `hooks/office-scene.mjs`. Every frame is one synchronized update (`CSI ? 2026`), drawn over the last with no clear. With pictures, each desk has two kitty image ids used in turn: the new picture goes to the spare one, is placed over the box, and only then is the old one freed, so a person is never missing for a frame. A picture that did not change is not sent.

## How it is built

- `hooks/office-pictures.mjs`, `hooks/office-art-hd.mjs`, `assets/`: the character pictures and their PNG encoder, the mod's own characters in the same style, and the atlas cut from Kenney's CC0 packs by `tools/build-atlas.py` (see `assets/CREDITS.txt`). The atlas is one byte per pixel with a palette of 61 colours, 36 KB. Run `python3 tools/build-atlas.py <folder of unzipped packs>` to rebuild it.
- `hooks/office-art.mjs`: every sprite as a palette-indexed pixel map, edited as text. This covers heads and backs of heads per character, hair styles, torsos, plants, the cooler, the mug and minions, plus skin, hair, clothes and fur colours, room palettes and the sky for each hour.
- `hooks/office-scene.mjs`: the room and the layouts. The static background is built once per size, seating, palette and quarter-hour of light. Each frame copies it and paints the sprites, the clock hands, the rack LEDs and the stars on top.
- `hooks/office-model.mjs`: herdr parsing, desks, options, seating, state changes, and the grid painter.
- `hooks/office.mjs`: the hooks. One `Raster` is repainted with `$.ui.blit` at 90-260 ms per frame. The render hook runs again only when a desk, a state, a count or an option changes. Nothing polls or animates while the pane is closed.

Data comes from one `herdr pane list` per poll (every 3 s, every 4 s at full size), and nothing else is spawned. A plain pane counts as busy when its terminal title is a command rather than a prompt (`user@host:path`, a bare path or a shell's name). Idle shells drawn as empty desks with "which panes: all" are counted as idle shells, never as done. Subagent counts come from the transcripts under `<config>/projects/<folder>/<session>/subagents/*.jsonl` written to in the last 60 s. The folder is found with `$.fs` alone: the pane's cwd or a folder above it, checked against one listing of each config folder (every 10 minutes). Both found and missing lookups are cached.

## Tests

```bash
claude plugin validate --strict mods/office
claude plugin test mods/office
```

The tests cover parsing, busy-shell detection and subagent counts. They mount every layout on the terminal and check the tag buttons and the herdr argv a press sends. They also cover:

- every layout painting 40 desks at three sizes inside the Raster limits
- option precedence and cycling
- the settings view keys saving to the store
- per-session rename, character and pin
- seating stability
- state-change tracking, the needs-you toast and chime
- reduced motion and hiding done sessions
- the desktop list
- the herdr failure lines
- timers stopping after close

Tested on Claude Code 2.1.287 with herdr API protocol 22.

## Limits

- There is no isometric layout. A three-quarter front view was the most legible option at terminal resolution.
- herdr does not tell thinking apart from working.
- When the regular desks do not fit (more than 12 sessions in a 200 x 56 terminal, for example), the office uses small sprites, which have far less detail.
- A plain terminal is focused only through its workspace and tab.
- Names keep printable ASCII only.
- The name-tag buttons and the drag layer are laid over the Raster with absolute positioning. Clicks and drags at every tag are checked in the test kit from 40 to 200 columns in every layout, not yet in a live docked pane.
