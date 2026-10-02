# Viewfinder

See what Claude sees. When Claude looks at an image, the picture shows up in a pane beside the transcript, so you watch the screenshot instead of reading a description of it. That covers:

- browser screenshots from the Playwright and Chrome DevTools MCP tools (any tool with "screenshot" in its name), whether the tool returns the image or saves it to a file
- a Read of a `.png`, `.jpg`, `.jpeg`, `.gif` or `.webp` file
- any other tool result that carries an image block

Subagent calls count too.

The pane shows the latest image as large as it fits with its aspect kept, a caption (tool, file or page, time), `3 of 7`, and plain buttons:

- `p` previous, `n` next, `c` close
- `f` full: the pane as wide and tall as Claude Code allows, picture redrawn to fit (`f` again restores)
- `o` opens the image in Preview, for real full screen outside the terminal
- `y` copies the image itself to the clipboard, `w` copies its path

It keeps the last 20 images. Each one is copied (or converted with `sips`) to a PNG in a temp folder for the session, so the pane shows what Claude saw even if the file changes later. The folder is removed when the session ends.

Where the terminal draws real pixels (kitty graphics: Ghostty, kitty) the pane uses them. Where it cannot (inside herdr or tmux, say) the picture is drawn as truecolor half-block cells instead: `sips` scales it to the pane and writes a BMP, which the mod parses. Pictures with more colours than the cell grid paints at once are reduced to a 31 colour palette. The `render` option picks: `auto` (the default: pixels, falling back to blocks when the terminal says it drew the alt text), `image` or `blocks`.

On the desktop surface there is no picture element, so the pane shows the file path instead.

## Load it

```bash
claude --plugin-dir ./mods/viewfinder
```

Then ask Claude to take a browser screenshot, or to read an image such as `mods/viewfinder/tests/fixtures/tiny.png`. Run `/viewfinder` at any time to open the pane, or `/viewfinder full` to open it as large as it goes; both work mid-turn.

Every new image is shown by itself. Claude Code only places a pane nobody asked for on a terminal at least 144 columns wide (110 once you have opened it yourself), so on a narrower terminal the image shows compactly in the band above the prompt instead, with keys `v` open the viewer, `p` / `n` step, `x` dismiss. The band picture goes when you send your next prompt. Closing the pane only closes it until the next image.

To stop it opening by itself, set the `autoOpen` option to false in `/config`. To force a drawing mode, set `render`. In settings:

```json
{ "pluginConfigs": { "viewfinder@inline": { "options": { "autoOpen": false, "render": "blocks" } } } }
```

## Check it

```bash
claude plugin validate --strict mods/viewfinder
claude plugin test mods/viewfinder
```

Tested on Claude Code 2.1.287, macOS, Ghostty.

## Limits

- Half-block pictures have two pixels per cell, so detail is coarse; `o` opens the real thing in Preview.
- In `auto` the first picture shows as alt text for a moment until the terminal answers whether it drew pixels.
- Converting JPEG, GIF and WebP, drawing half-blocks, opening Preview and copying the image all use macOS tools (`sips`, `open`, `osascript`). Without them, PNG image blocks are held in memory and drawn only where the terminal shows pixels.
- The aspect ratio assumes terminal cells about twice as tall as they are wide.
- Full size is a request: a pane width you dragged yourself wins.
- A screenshot tool that saves to a relative path and returns no image block is missed: only absolute paths are followed.
- History lives in memory and starts over when the mod reloads.
