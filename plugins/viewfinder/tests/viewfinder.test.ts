import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cellsOf, fromBase64, parseBmp } from '../hooks/raster.mjs'
import { TINY_BMP_BASE64, TINY_PNG_BASE64, TINY_PNG_HEIGHT, TINY_PNG_WIDTH } from './fixtures/tiny-png'

const FIXTURE = '/work/mods/viewfinder/tests/fixtures/tiny.png'
const TMP = '/tmp/vf-test'
const SHOT_TOOL = 'mcp__plugin_playwright_playwright__browser_take_screenshot'

const PANE = {
  plugin: 'viewfinder',
  component: 'Pane',
  requestId: 'viewfinder',
  viewport: { columns: 160, rows: 40 },
  props: {
    title: 'Viewfinder',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// The person typing /viewfinder at the prompt of a fullscreen terminal.
const VIEWFINDER_CMD = {
  command: 'viewfinder',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const

type World = {
  clock: ReturnType<typeof mock.clock>
  runs: string[][]
  toasts: string[]
  opens: number
  openArgs: Record<string, unknown>[]
  copies: string[]
  blits: number
}

// The world beneath the mod: a clock, a temp folder, files that exist, the
// host commands it runs, and the pane answers.
function world(
  on: On,
  opts: { isPlaced?: boolean; existing?: string[]; runFails?: boolean; blitDeny?: string } = {},
): World {
  const w: World = {
    clock: mock.clock(on, { now: Date.UTC(2026, 9, 2, 12, 0, 0) }),
    runs: [], toasts: [], opens: 0, openArgs: [], copies: [], blits: 0,
  }
  on('fs.read', ($, e) => (e.path.endsWith('.bmp') ? { value: { base64: TINY_BMP_BASE64 } } : { deny: 'not stubbed' }))
  on('ui.blit', () => {
    w.blits++
    return { value: opts.blitDeny ? { deny: opts.blitDeny } : {} }
  })
  on('ui.copy', ($, e) => {
    w.copies.push(e.text)
    return { value: { isCopied: true } }
  })
  mock.env(on, { TMPDIR: TMP })
  on('session.id', () => ({ value: 'sess1' }))
  on('fs.exists', ($, e) => ({ value: (opts.existing ?? []).includes(e.path) }))
  on('process.run', ($, e) => {
    w.runs.push([...e.argv])
    if (opts.runFails) return { deny: 'no host commands here' }
    const stdout = e.argv[0] === 'sips' && e.argv[1] === '-g' ? '  pixelWidth: 1280\n  pixelHeight: 720\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', ($, e) => {
    w.opens++
    w.openArgs.push({ ...e })
    return { value: opts.isPlaced === false ? { isPlaced: false, reason: 'unasked under 144 columns' } : { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  // What the band holds without this mod: a sibling's or the engine's row.
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine band'] }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  return w
}

function readResult() {
  return {
    result: {
      type: 'image',
      file: {
        base64: TINY_PNG_BASE64,
        type: 'image/png',
        originalSize: 2445,
        dimensions: { originalWidth: TINY_PNG_WIDTH, originalHeight: TINY_PNG_HEIGHT },
      },
    },
  }
}

function textReadResult() {
  return { result: { type: 'text', file: { filePath: '/work/README.md', content: '# Hi', numLines: 1, startLine: 1, totalLines: 1 } } }
}

function shotResult() {
  return {
    result: {
      content: [
        { type: 'text', text: '### Page\n- Page URL: https://example.com/\n' },
        { type: 'image', data: TINY_PNG_BASE64, mimeType: 'image/png' },
      ],
      isError: false,
    },
  }
}

function stubTools(on: On) {
  on('tool.call', ($, e) => {
    if (e.tool === 'Read') return e.file_path.endsWith('.png') ? readResult() : textReadResult()
    if (String(e.tool) === SHOT_TOOL) return shotResult()
    return { result: { stdout: 'hello', stderr: '', interrupted: false } }
  })
}

test('a Read of a png becomes an entry, copied to the temp folder', async ($, on) => {
  const w = world(on, { existing: [FIXTURE] })
  stubTools(on)
  const r = await $.tool.call({ tool: 'Read', file_path: FIXTURE })
  expect(r).toEqual(readResult())
  await w.clock.settle()

  expect(w.runs).toContainEqual(['cp', FIXTURE, `${TMP}/viewfinder-sess1/1.png`])
  expect(w.opens).toBe(1)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const img = await ui.find({ type: 'Image' })
  expect(img).toBeDefined()
  expect(img?.props.source).toEqual({ file: `${TMP}/viewfinder-sess1/1.png`, format: 'png' })
  // 48 x 24 pixels on cells twice as tall as wide: 4 columns per row, so
  // the 60 columns cap it at 15 rows.
  expect(img?.props.columns).toBe(60)
  expect(img?.props.rows).toBe(15)
  expect(await ui.find({ type: 'Text', text: /^Read · tiny\.png · \d\d:\d\d:\d\d$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1 of 1' })).toBeDefined()
})

test('a screenshot with an image block becomes an entry', async ($, on) => {
  const w = world(on)
  stubTools(on)
  const r = await $.tool.call({ tool: SHOT_TOOL } as never)
  expect(r).toEqual(shotResult())
  await w.clock.settle()

  const decode = w.runs.find(a => a[0] === 'base64')
  expect(decode).toEqual(['base64', '-D', '-o', `${TMP}/viewfinder-sess1/1.png`])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const img = await ui.find({ type: 'Image' })
  expect(img?.props.source).toEqual({ file: `${TMP}/viewfinder-sess1/1.png`, format: 'png' })
  expect(await ui.find({ type: 'Text', text: /browser_take_screenshot · https:\/\/example\.com\// })).toBeDefined()
})

test('without host commands an image block is held as png bytes', async ($, on) => {
  const w = world(on, { runFails: true })
  stubTools(on)
  await $.tool.call({ tool: SHOT_TOOL } as never)
  await w.clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const img = await ui.find({ type: 'Image' })
  expect(img?.props.source).toEqual({ png: TINY_PNG_BASE64 })
})

test('other tools are ignored and their results pass through unchanged', async ($, on) => {
  const w = world(on)
  stubTools(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(r).toEqual({ result: { stdout: 'hello', stderr: '', interrupted: false } })
  const t = await $.tool.call({ tool: 'Read', file_path: '/work/README.md' })
  expect(t).toEqual(textReadResult())
  await w.clock.settle()

  expect(w.runs).toEqual([])
  expect(w.opens).toBe(0)
  const answer = await $.command.run(VIEWFINDER_CMD)
  expect(answer.text).toBe('Viewfinder: no images yet.')
})

test('prev and next step through the history', async ($, on) => {
  const w = world(on, { existing: [FIXTURE] })
  stubTools(on)
  await $.tool.call({ tool: 'Read', file_path: FIXTURE })
  await $.tool.call({ tool: SHOT_TOOL } as never)
  await w.clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '2 of 2' })).toBeDefined()
  await ui.press({ key: 'prev' })
  expect(await ui.find({ type: 'Text', text: '1 of 2' })).toBeDefined()
  expect((await ui.find({ type: 'Image' }))?.props.source).toEqual({ file: `${TMP}/viewfinder-sess1/1.png`, format: 'png' })
  await ui.press({ key: 'prev' })
  expect(await ui.find({ type: 'Text', text: '1 of 2' })).toBeDefined()
  await ui.press({ key: 'next' })
  expect(await ui.find({ type: 'Text', text: '2 of 2' })).toBeDefined()
  expect((await ui.find({ type: 'Image' }))?.props.source).toEqual({ file: `${TMP}/viewfinder-sess1/2.png`, format: 'png' })
})

const BAND = {
  plugin: 'viewfinder',
  component: 'AbovePrompt',
  viewport: { columns: 100, rows: 40 },
  props: { hasSurvey: false, isWorking: true, maxRows: 14, bodyColumns: 100, scroll: { offset: 0, bodyRows: 14 }, view: {} },
} as const

test('a placed pane leaves the band to the others', async ($, on) => {
  const w = world(on, { existing: [FIXTURE] })
  stubTools(on)
  await $.tool.call({ tool: 'Read', file_path: FIXTURE })
  await w.clock.settle()

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  expect(await band.find({ type: 'Image' })).toBeUndefined()
})

test('a pane with no room shows the image in the band instead', async ($, on) => {
  const w = world(on, { isPlaced: false, existing: [FIXTURE] })
  stubTools(on)
  await $.tool.call({ tool: 'Read', file_path: FIXTURE })
  await w.clock.settle()
  expect(w.opens).toBe(1)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  // Composed under what the band already held.
  expect(await band.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  const img = await band.find({ type: 'Image' })
  expect(img?.props.source).toEqual({ file: `${TMP}/viewfinder-sess1/1.png`, format: 'png' })
  // 14 rows less caption, keys and the row above: 8 at most, 4 columns a row.
  expect(img?.props.rows).toBe(8)
  expect(img?.props.columns).toBe(32)
  expect(await band.find({ type: 'Text', text: /^Read · tiny\.png/ })).toBeDefined()
  expect(await band.find({ key: 'band-prev' })).toBeUndefined()

  // The next prompt clears it.
  await $.prompt.submit({ text: 'thanks', wait: false, origin: { kind: 'composer' } })
  await band.redraw()
  expect(await band.find({ type: 'Image' })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: 'engine band' })).toBeDefined()
})

test('the band keys view, step and dismiss', async ($, on) => {
  const w = world(on, { isPlaced: false, existing: [FIXTURE] })
  stubTools(on)
  await $.tool.call({ tool: 'Read', file_path: FIXTURE })
  await $.tool.call({ tool: SHOT_TOOL } as never)
  await w.clock.settle()

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /2 of 2$/ })).toBeDefined()
  await band.press({ key: 'band-prev' })
  expect(await band.find({ type: 'Text', text: /1 of 2$/ })).toBeDefined()
  await band.press({ key: 'band-dismiss' })
  expect(await band.find({ type: 'Image' })).toBeUndefined()

  // A new image brings it back; View asks for the pane with the keyboard.
  await $.tool.call({ tool: 'Read', file_path: FIXTURE })
  await w.clock.settle()
  await band.redraw()
  expect(await band.find({ type: 'Image' })).toBeDefined()
  await band.press({ key: 'band-view' })
  expect(w.openArgs.at(-1)).toMatchObject({ id: 'viewfinder', focus: true })
  expect(await band.find({ type: 'Image' })).toBeUndefined()
})

test('auto-open off leaves the pane closed until /viewfinder', { options: { autoOpen: false } }, async ($, on) => {
  const w = world(on, { existing: [FIXTURE] })
  stubTools(on)
  await $.tool.call({ tool: 'Read', file_path: FIXTURE })
  await w.clock.settle()
  expect(w.opens).toBe(0)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Image' })).toBeUndefined()
  await band.unmount()

  const answer = await $.command.run(VIEWFINDER_CMD)
  expect(w.opens).toBe(1)
  expect(answer.text).toBe('Viewfinder: 1 image.')
})

test('the desktop shows the path in text', async ($, on) => {
  const w = world(on, { existing: [FIXTURE] })
  stubTools(on)
  await $.tool.call({ tool: 'Read', file_path: FIXTURE })
  await w.clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: FIXTURE })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1 of 1' })).toBeDefined()
})

test('a closed pane opens again for the next image', async ($, on) => {
  const w = world(on, { existing: [FIXTURE] })
  stubTools(on)
  await $.tool.call({ tool: 'Read', file_path: FIXTURE })
  await w.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'close' })
  await ui.unmount()

  await $.tool.call({ tool: 'Read', file_path: FIXTURE })
  await w.clock.settle()
  expect(w.opens).toBe(2)
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await again.find({ type: 'Text', text: '2 of 2' })).toBeDefined()
})

test('a screenshot saved to a jpeg file is converted with sips', async ($, on) => {
  const SAVED = '/work/shots/page.jpg'
  const DEVTOOLS = 'mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_screenshot'
  const w = world(on, { existing: [SAVED] })
  on('tool.call', () => ({ result: [{ type: 'text', text: `Saved screenshot to ${SAVED}.` }] }))
  const r = await $.tool.call({ tool: DEVTOOLS, filePath: SAVED } as never)
  expect(r).toEqual({ result: [{ type: 'text', text: `Saved screenshot to ${SAVED}.` }] })
  await w.clock.settle()

  const out = `${TMP}/viewfinder-sess1/1.png`
  expect(w.runs).toContainEqual(['sips', '-s', 'format', 'png', SAVED, '--out', out])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const img = await ui.find({ type: 'Image' })
  expect(img?.props.source).toEqual({ file: out, format: 'png' })
  // 1280 x 720 from sips: 60 columns wide caps it at 17 rows.
  expect(img?.props.columns).toBe(60)
  expect(img?.props.rows).toBe(17)
  expect(await ui.find({ type: 'Text', text: /^take_screenshot · page\.jpg/ })).toBeDefined()
})

test('a sips BMP parses to the fixture pixels', () => {
  const img = parseBmp(fromBase64(TINY_BMP_BASE64))
  expect(img.width).toBe(48)
  expect(img.height).toBe(24)
  const px = (x: number, y: number) => Array.from(img.rgba.slice((y * 48 + x) * 4, (y * 48 + x) * 4 + 4))
  // The fixture: red across, green down, blue in an 8-pixel checker.
  expect(px(0, 0)).toEqual([0, 0, 60, 255])
  expect(px(47, 23)).toEqual([255, 255, 160, 255])
  expect(px(8, 0)).toEqual([43, 0, 160, 255])
})

test('half-block cells carry the top pixel as foreground, the bottom as background', () => {
  const img = parseBmp(fromBase64(TINY_BMP_BASE64))
  const words = new Uint32Array(fromBase64(cellsOf(img, 48, 12)).buffer)
  expect(words.length).toBe(48 * 12 * 3)
  expect(Array.from(words.slice(0, 3))).toEqual([0x2580, 0x00003c, 0x000b3c])

  // Transparent pixels show the terminal's background.
  const clear = { width: 1, height: 2, rgba: Uint8Array.of(0, 0, 0, 0, 255, 0, 0, 255) }
  expect(Array.from(new Uint32Array(fromBase64(cellsOf(clear, 1, 1)).buffer))).toEqual([0x2584, 0xff0000, 0x01000000])
})

const BLOCK_PANE = { ...PANE, props: { ...PANE.props, bodyColumns: 48, scroll: { offset: 0, bodyRows: 15 } } }

test('render blocks draws the picture as a half-block Raster', { options: { render: 'blocks' } }, async ($, on) => {
  const w = world(on, { existing: [FIXTURE] })
  stubTools(on)
  await $.tool.call({ tool: 'Read', file_path: FIXTURE })
  await w.clock.settle()

  const ui = await $.ui.mount({ ...BLOCK_PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await w.clock.settle()
  await ui.redraw()
  const dir = `${TMP}/viewfinder-sess1`
  expect(w.runs).toContainEqual(['sips', '-s', 'format', 'bmp', '-z', '24', '48', `${dir}/1.png`, '--out', `${dir}/frame-1.bmp`])
  const raster = await ui.find({ type: 'Raster' })
  expect(raster?.props.columns).toBe(48)
  expect(raster?.props.rows).toBe(12)
  expect(raster?.props.cells).toBe(cellsOf(parseBmp(fromBase64(TINY_BMP_BASE64)), 48, 12))
})

test('auto falls back to blocks when the Image draws its alt', async ($, on) => {
  const w = world(on, {
    existing: [FIXTURE],
    blitDeny: 'the Image draws its alt here: the terminal draws no placeholder images (TERM_PROGRAM=herdr)',
  })
  stubTools(on)
  await $.tool.call({ tool: 'Read', file_path: FIXTURE })
  await w.clock.settle()

  const ui = await $.ui.mount({ ...BLOCK_PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  await w.clock.advance(200)
  expect(w.blits).toBe(1)
  await ui.redraw()
  await w.clock.settle()
  await ui.redraw()
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect((await ui.find({ type: 'Raster' }))?.props.columns).toBe(48)
})

test('auto keeps the Image when the terminal draws it', async ($, on) => {
  const w = world(on, { existing: [FIXTURE] })
  stubTools(on)
  await $.tool.call({ tool: 'Read', file_path: FIXTURE })
  await w.clock.settle()

  const ui = await $.ui.mount({ ...BLOCK_PANE, surface: 'terminal' })
  await w.clock.advance(200)
  await ui.redraw()
  expect(w.blits).toBe(1)
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
})

test('the action buttons run the right commands', async ($, on) => {
  const w = world(on, { existing: [FIXTURE] })
  stubTools(on)
  await $.tool.call({ tool: 'Read', file_path: FIXTURE })
  await w.clock.settle()
  const file = `${TMP}/viewfinder-sess1/1.png`

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'copy' })
  expect(w.runs).toContainEqual([
    'osascript',
    '-e', 'on run argv',
    '-e', 'set the clipboard to (read (POSIX file (item 1 of argv)) as «class PNGf»)',
    '-e', 'end run',
    file,
  ])
  await ui.press({ key: 'open' })
  expect(w.runs).toContainEqual(['open', '-a', 'Preview', file])
  await ui.press({ key: 'copy-path' })
  expect(w.copies).toEqual([FIXTURE])
  expect(w.toasts).toEqual(['Viewfinder: image copied', 'Viewfinder: path copied'])

  await ui.press({ key: 'full' })
  expect(w.openArgs.at(-1)).toMatchObject({ id: 'viewfinder', focus: true, columns: 159, rows: 40 })
  expect(await ui.find({ key: 'full', text: 'Restore' })).toBeDefined()
  await ui.press({ key: 'full' })
  expect(w.openArgs.at(-1)?.columns).toBeUndefined()
})

test('/viewfinder full opens the pane as wide as the terminal', async ($, on) => {
  const w = world(on)
  const answer = await $.command.run({ ...VIEWFINDER_CMD, args: 'full' })
  expect(answer.text).toBe('Viewfinder: no images yet.')
  expect(w.openArgs.at(-1)).toMatchObject({ columns: 159 })
})
