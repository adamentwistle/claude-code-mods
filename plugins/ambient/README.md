# ambient

An animated strip in the band above the prompt that moves with the work, in the spirit of the Ghostty shaders in claude-rig. Eight styles:

- **network** (default): a mesh of diamond nodes joined by thin links, with two layers of smaller nodes drifting behind it for depth (from 4 rows). Requests fly between nodes as comets with gradient tails, light their link for a moment and flash the node they reach. Now and then a consensus pulse runs along the mesh. A tool call fires rings out of a node, and a failure turns them red. Each finished turn locks a block onto the chain at the right with a white flash, a green glow and a shockwave back along the chain. Always in the Nightshade theme's colors.
- **critter**: a small orange creature, the one from the startup logo. It walks and leaves a trail of ink while the answer streams, scratches its head while thinking, hammers while a tool runs, trips with a red spark when one fails, celebrates when the turn ends, then naps. A smaller companion trots along while subagents work.
- **aurora**: soft curtains of light, green at the lower edge and fading upward through cyan to violet, drifting slowly over a sparse twinkling starfield. They brighten and stretch with the stream, and thinking shifts them toward violet. A tool call glides a soft amber pillar of light across, and a failure glides a red one.
- **synthwave**: a neon grid racing toward a striped sun behind a dark ridge. It runs faster as the stream speeds up and turns violet and slower while thinking. The grid is single-pixel lines running back to the sun and crossing lines scrolling toward you. It turns cyan while a tool runs and red on a failure, and a finished turn flares the sun. Uses at least 4 rows.
- **warp**: a hyperspace starfield. The streaks stretch with the stream, turn violet while thinking and amber while a tool runs, and flash red on a failure. A finished turn is a jump: a burst of speed and a white flash.
- **murmuration**: a flock of starlings over a sunset. It wanders and flows with the stream, circles while thinking, scatters from a tool call, and slows to a lazy drift when the turn ends, then holds still. Each bird is one dark speck against the sky.
- **lava**: slow liquid blobs of colour, like a lava lamp on its side. They speed up and merge with the stream, cool to violet and cyan while thinking, and a tool call bubbles a new blob up from below.
- **wave**: a low flowing wave with braille sparks, the quietest.

Every style shows the context fill as a faint line along the bottom. When the turn ends, the strip settles within about two seconds, its timer stops and the last frame stays still. It uses no CPU while idle.

The strip is one `Raster`, repainted with `$.ui.blit` at about 14 fps. It is always the last rows of the band, below whatever other mods draw there, and it draws nothing on the desktop surface.

## Use

```bash
claude --plugin-dir ./mods/ambient
```

| Command | Does |
| --- | --- |
| `/ambient` | Switches to the next style |
| `/ambient <style>` | Picks a style by name |
| `/ambient styles` | Shows the styles, each with a colour swatch and a line about it, the current one marked, these commands and the current settings (`/ambient list` is the same). In the terminal and the desktop app it is drawn as a list; elsewhere, and in a headless run, it is two Markdown tables |
| `/ambient preview` | Shows every style for 4.5 seconds with a short demo turn (think, write, a tool, a failed tool, done), then goes back to yours |
| `/ambient preview <style>` | Plays one style through the same demo turn and lets it settle, then goes back to yours |
| `/ambient off`, `/ambient on` | Hides or shows the strip |

The style and on/off choice are saved in the mod's store and carry over to new sessions.

Options (`/config`, or `pluginConfigs` under `ambient@inline` in settings):

| Option | Values | Default |
| --- | --- | --- |
| `style` | any style above (a style saved with `/ambient` wins) | `network` |
| `rows` | `1` to `6` (critter uses at least 3, synthwave at least 4) | `3` |
| `intensity` | `soft`, `bright`, `vivid` | `bright` |
| `palette` | `auto`, `nightshade`, `rose-pine`, `kanagawa-wave`, `kanagawa-dragon`, `catppuccin-mocha`, `catppuccin-latte`, `dusk` | `auto` |

`auto` reads the theme name `ccs-theme` leaves in `~/.config/ccstatusline/.theme` at session start, and falls back to `dusk`, a dark palette.

## Files

- `hooks/ambient.mjs`: the hooks, the timer and the `/ambient` command
- `hooks/scene.mjs`: the shared simulation (what is running, how fast the stream is, the events), with no engine calls
- `hooks/lib.mjs`: palettes, glyphs, the cell and half-block pixel frame, color math
- `hooks/styles/*.mjs`: one file per style; none of them calls the engine, so frames can be rendered outside a session

## Tests

```bash
claude plugin validate --strict mods/ambient
claude plugin test mods/ambient
```

Tested on Claude Code 2.1.287.

## Limits

- The palette is read once per session start. After a `ccs-theme` switch, run `/reload-plugins` or start a new session.
- Faint shades fade toward the palette's background color, so a terminal background that doesn't match the theme can look slightly off.
- The terminal keeps 1024 color pairs on screen at once. A wide aurora can use more, and the rest are drawn in their nearest pair.
- The chain count, the flock, the stars and the critter's position reset when the mod reloads.
- During `/ambient preview` the demo turn mixes with any real work in progress.
- A survey in the band hides the strip until it is answered.
