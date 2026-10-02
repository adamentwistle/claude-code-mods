import { expect, mock, test } from 'claude-code/testing'
import { INTENSITY, PALETTES, STYLES as REGISTRY } from '../hooks/scene.mjs'

// What Claude Code passes a ui.render hook for the band, apart from the surface
const BAND = {
  plugin: 'ambient',
  component: 'AbovePrompt',
  requestId: 'band',
  viewport: { columns: 40, rows: 30 },
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 10,
    bodyColumns: 40,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const CHUNKS = [
  { kind: 'thinking', index: 0, text: 'Let me look at the file first.' },
  { kind: 'text', index: 1, text: 'Here is what I found in the module, ' },
  { kind: 'text', index: 1, text: 'and here is the rest of the answer.' },
  { kind: 'tool', index: 2, id: 'toolu_1', name: 'Read' },
  { kind: 'input', index: 2, json: '{"file_path":"a.md"}' },
  { kind: 'stop', stopReason: 'tool_use', usage: null },
] as const

const RESULT = {
  turnId: 't1',
  index: 0,
  answer: 'Here is what I found in the module, and here is the rest of the answer.',
  toolUses: [{ name: 'Read', input: { file_path: 'a.md' } }],
  stopReason: 'tool_use',
  usage: null,
} as const

// Reads a stream to its end: every chunk and the result
async function drain(stream: AsyncGenerator<unknown, unknown>) {
  const seen: unknown[] = []
  let step = await stream.next()
  while (step.done !== true) {
    seen.push(step.value)
    step = await stream.next()
  }
  return { seen, result: step.value }
}

// Decodes Raster cells into rows of [codePoint, fg, bg]
function decode(cells: string) {
  const bin = atob(cells)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  const words = new Uint32Array(bytes.buffer)
  const out: number[][] = []
  for (let i = 0; i < words.length; i += 3) out.push([words[i], words[i + 1], words[i + 2]])
  return out
}

function stubBand(on: any) {
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
}

function stubSteps(on: any) {
  on('turn.step', async function* ($: any, e: any) {
    for (const c of CHUNKS) yield c
    return { ...RESULT, turnId: e.turnId, index: e.index }
  })
}

test('turn.step passes every piece and the result through unchanged', async ($, on) => {
  mock.clock(on)
  stubSteps(on)
  const { seen, result } = await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-test', messageCount: 1 }) as any)
  expect(seen).toEqual(CHUNKS)
  expect(result).toEqual(RESULT)
})

test('a subagent step passes through unchanged too', async ($, on) => {
  mock.clock(on)
  stubSteps(on)
  const { seen, result } = await drain(
    $.turn.step({ turnId: 't1', index: 0, model: 'claude-test', effort: 'high', messageCount: 3, agentId: 'agent-7' }) as any,
  )
  expect(seen).toEqual(CHUNKS)
  expect(result).toEqual(RESULT)
})

test('turn.step stays transparent when the strip itself fails', async ($, on) => {
  // No clock at all: starting the animation fails, the stream must not notice
  on('clock.every', () => ({ deny: 'no timers in this test' }))
  stubSteps(on)
  const { seen, result } = await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-test', messageCount: 1 }) as any)
  expect(seen).toEqual(CHUNKS)
  expect(result).toEqual(RESULT)
})

test('tool.call returns exactly what the tool returned, success or failure', async ($, on) => {
  mock.clock(on)
  let n = 0
  on('tool.call', () => {
    n += 1
    return n === 1 ? { result: 'file text' } : { deny: 'not allowed here' }
  })
  expect(await $.tool.call({ tool: 'Read', file_path: 'a.md' })).toEqual({ result: 'file text' })
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toEqual({ deny: 'not allowed here' })
})

const STYLES = ['network', 'critter', 'aurora', 'synthwave', 'warp', 'murmuration', 'lava', 'wave'] as const

function captureBlits(on: any) {
  const blits: string[] = []
  on('ui.blit', ($: any, e: any) => {
    blits.push(e.cells)
    return { value: {} }
  })
  return blits
}

function stubStore(on: any, start: Record<string, unknown> = {}) {
  const saved = new Map<string, unknown>(Object.entries(start))
  on('store.get', ($: any, e: any) => ({ value: saved.get(e.key) }))
  on('store.set', ($: any, e: any) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  return saved
}

async function startSession($: any, on: any) {
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  mock.env(on, { HOME: '/home/test' })
  on('fs.read', () => ({ value: 'catppuccin-mocha\n' }))
}

test('the strip is the last rows of the band, below a sibling mod', {
  plugins: [{
    name: 'sibling',
    register(on) {
      on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
        const { Box, Text } = $.ui.resolve(e)
        return Box({ flexDirection: 'column', children: [Text({ children: ['sibling says hi'] }), await next(e)] })
      })
    },
  }],
}, async ($, on) => {
  stubBand(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'sibling says hi' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  // Three rows by default
  expect((await ui.find({ type: 'Raster', key: 'ambient' }))?.props).toMatchObject({ columns: 40, rows: 3 })
  // The strip's Box holds what came from beneath first and the Raster last
  const boxes = (await ui.findAll({ type: 'Box' })).filter((b) => b.children.some((c: any) => c?.type === 'Raster'))
  expect(boxes).toHaveLength(1)
  const kids = boxes[0].children as any[]
  expect(kids[kids.length - 1].type).toBe('Raster')
})

for (const [rows, style, want] of [['1', 'wave', 1], ['6', 'aurora', 6], ['1', 'critter', 3], ['4', 'critter', 4], ['3', 'synthwave', 4], ['6', 'warp', 6]] as const) {
  test(`rows ${rows} with ${style} draws ${want} rows`, { options: { rows, style } }, async ($, on) => {
    stubBand(on)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect((await ui.find({ type: 'Raster', key: 'ambient' }))?.props).toMatchObject({ columns: 40, rows: want })
  })
}

test('the desktop gets the band untouched', async ($, on) => {
  stubBand(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
})

for (const style of STYLES) {
  test(`${style}: animates during a turn, settles after it, then the timer stops`, { options: { style } }, async ($, on) => {
    const clock = mock.clock(on)
    stubBand(on)
    stubSteps(on)
    on('turn.complete', () => ({ text: '' }))
    const blits = captureBlits(on)

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const idle = (await ui.find({ type: 'Raster', key: 'ambient' }))?.props.cells
    await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-test', messageCount: 1 }) as any)
    await clock.advance(280)
    expect(blits.length).toBeGreaterThan(2)
    // Frames change while it works
    expect(new Set(blits).size).toBeGreaterThan(1)
    await $.turn.complete({ turnId: 't1', answer: RESULT.answer, durationMs: 1000, isAborted: false, usage: null } as any)

    await clock.advance(4000)
    const settledAt = blits.length
    await clock.advance(5000)
    expect(blits.length).toBe(settledAt)
    const last = blits[blits.length - 1]
    if (style === 'network') {
      // A block confirmed: the still frame now has one more block than before
      expect(last).not.toBe(idle)
    } else if (style === 'critter') {
      // Asleep again: a z beside it
      expect(decode(last).some(([g]) => g === 0x7a)).toBe(true)
    } else if (style === 'wave') {
      // Settled back to the same still picture it started from
      expect(last).toBe(idle)
    }
  })
}

test('it keeps moving while a slow stream is still arriving', async ($, on) => {
  const clock = mock.clock(on)
  stubBand(on)
  on('turn.step', async function* ($: any, e: any) {
    yield { kind: 'text', index: 0, text: 'first piece of a slow answer' }
    await clock.sleep(2000)
    yield { kind: 'text', index: 0, text: ' and the rest' }
    return { ...RESULT, answer: 'first piece of a slow answer and the rest', toolUses: [], stopReason: 'end_turn', turnId: e.turnId, index: e.index }
  })
  const blits = captureBlits(on)
  await $.ui.mount({ ...BAND, surface: 'terminal' })
  const pending = drain($.turn.step({ turnId: 't2', index: 0, model: 'claude-test', messageCount: 1 }) as any)
  await clock.advance(1500)
  const before = blits.length
  await clock.advance(300)
  // Past the linger, still streaming: still repainting
  expect(blits.length).toBeGreaterThan(before)
  await clock.advance(400)
  const { seen } = await pending
  expect(seen).toHaveLength(2)
})

for (const style of ['wave', 'critter'] as const) {
  test(`${style}: a failed tool sends a red flare`, { options: { style } }, async ($, on) => {
    const clock = mock.clock(on)
    stubBand(on)
    on('tool.call', () => ({ result: 'boom', isError: true }))
    const blits = captureBlits(on)
    await $.ui.mount({ ...BAND, surface: 'terminal' })
    const out = await $.tool.call({ tool: 'Bash', command: 'false' })
    expect(out).toEqual({ result: 'boom', isError: true })
    await clock.advance(140)
    const reddish = decode(blits[blits.length - 1]).some(([, , bg]) => bg !== 0x01000000 && ((bg >> 16) & 255) > ((bg >> 8) & 255) + 8)
    expect(reddish).toBe(true)
  })
}

test('the context fill draws a still horizon', { options: { style: 'wave' } }, async ($, on) => {
  stubBand(on)
  on('session.measure', ($: any, e: any) => ({ changed: e.changed }))
  const blits = captureBlits(on)
  await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.session.measure({ context: { tokens: 50000, window: 200000, percent: 25 }, rateLimits: [], changed: ['context'] } as any)
  const cells = decode(blits[blits.length - 1])
  expect(cells.filter(([g]) => g === 0x2581)).toHaveLength(10)
})

test('/ambient off and on hide and show the strip, and the choice is saved', async ($, on) => {
  const saved = stubStore(on)
  await startSession($, on)
  stubBand(on)

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster' })).toBeDefined()

  const off = await $.command.run({ command: 'ambient', args: 'off' } as any)
  expect(off.text).toBe('Ambient strip off')
  expect(saved.get('enabled')).toBe(false)
  await ui.redraw()
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()

  const back = await $.command.run({ command: 'ambient', args: 'on' } as any)
  expect(back.text).toContain('Ambient strip: network')
  expect(saved.get('enabled')).toBe(true)
  await ui.redraw()
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
})

test('/ambient <style> switches style and saves it; /ambient alone cycles', { options: { rows: '1' } }, async ($, on) => {
  const saved = stubStore(on)
  await startSession($, on)
  stubBand(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Raster' }))?.props).toMatchObject({ rows: 1 })

  const picked = await $.command.run({ command: 'ambient', args: 'critter' } as any)
  expect(picked.text).toContain('Ambient strip: critter')
  expect(saved.get('style')).toBe('critter')
  await ui.redraw()
  // The critter needs three rows even when one is asked for
  expect((await ui.find({ type: 'Raster' }))?.props).toMatchObject({ rows: 3 })

  const order: string[] = []
  for (let i = 0; i < 4; i += 1) {
    await $.command.run({ command: 'ambient', args: '' } as any)
    order.push(String(saved.get('style')))
  }
  expect(order).toEqual(['aurora', 'synthwave', 'warp', 'murmuration'])

  const styles = await $.command.run({ command: 'ambient', args: 'styles' } as any)
  expect(styles.text).toContain('**murmuration** (current)')
  for (const s of STYLES) expect(styles.text).toMatch(new RegExp(`^\\| (\\*\\*)?${s}(\\*\\* \\(current\\))? \\|`, 'm'))
  expect(styles.text).toContain('lava lamp')
  expect(styles.text).toContain('/ambient preview <style>')
  // list is the same output, not a second one
  const list = await $.command.run({ command: 'ambient', args: 'list' } as any)
  expect(list.text).toBe(styles.text)
  expect(saved.get('style')).toBe('murmuration')

  const bad = await $.command.run({ command: 'ambient', args: 'sparkles' } as any)
  expect(bad.text).toContain('Unknown style')
  expect(saved.get('style')).toBe('murmuration')
})

test('a saved style is honoured at the next session start', async ($, on) => {
  stubStore(on, { style: 'aurora' })
  await startSession($, on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
  const list = await $.command.run({ command: 'ambient', args: 'styles' } as any)
  expect(list.text).toContain('**aurora** (current)')
})

test('a saved off hides the strip at the next session start', async ($, on) => {
  mock.store(on, { enabled: false, style: 'critter' })
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  mock.env(on, {})
  stubBand(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
})

test('/ambient preview walks through every style, then goes back and goes still', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on)
  const saved = stubStore(on, { style: 'lava' })
  await startSession($, on)
  stubBand(on)
  const statuses: (string | undefined)[] = []
  on('ui.status', ($: any, e: any) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  const blits = captureBlits(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  const started = await $.command.run({ command: 'ambient', args: 'preview' } as any)
  expect(started.text).toContain('Previewing all 8 styles')
  for (let i = 0; i < 8; i += 1) {
    await ui.redraw()
    await clock.advance(4500)
  }
  // Frames are 70 ms, so each style runs a frame or so past its 4.5 seconds
  await clock.advance(1000)
  const shown = statuses.filter((t) => t).map((t) => String(t).split(' ')[2])
  expect(shown).toEqual([...STYLES])
  // The status line is cleared and the saved style is back, unchanged in the store
  expect(statuses[statuses.length - 1]).toBeUndefined()
  expect(saved.get('style')).toBe('lava')
  const list = await $.command.run({ command: 'ambient', args: 'styles' } as any)
  expect(list.text).toContain('**lava** (current)')

  await clock.advance(4000)
  const settledAt = blits.length
  await clock.advance(3000)
  expect(blits.length).toBe(settledAt)
})

test('/ambient preview <style> plays one style through a demo turn, then restores', async ($, on) => {
  const clock = mock.clock(on)
  const saved = stubStore(on, { style: 'wave' })
  await startSession($, on)
  stubBand(on)
  const statuses: (string | undefined)[] = []
  on('ui.status', ($: any, e: any) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  const blits = captureBlits(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  const bad = await $.command.run({ command: 'ambient', args: 'preview sparkles' } as any)
  expect(bad.text).toContain('Unknown style "sparkles"')

  const started = await $.command.run({ command: 'ambient', args: 'preview warp' } as any)
  expect(started.text).toContain('Previewing warp')
  await ui.redraw()
  expect((await ui.find({ type: 'Raster' }))?.props).toMatchObject({ rows: 3 })
  await clock.advance(3000)
  const during = blits.length
  expect(during).toBeGreaterThan(20)
  await clock.advance(5000)
  expect(statuses).toEqual(['ambient preview: warp', undefined])
  expect(saved.get('style')).toBe('wave')
  const styles = await $.command.run({ command: 'ambient', args: 'styles' } as any)
  expect(styles.text).toContain('**wave** (current)')
  await clock.advance(4000)
  const settledAt = blits.length
  await clock.advance(3000)
  expect(blits.length).toBe(settledAt)
})

// The /config choices must cover everything the mod knows, or a choice is silently dropped:
// a value outside a field's options reaches the mod as unset, and its default stands.
for (const name of REGISTRY) {
  test(`config offers the ${name} style`, { options: { style: name } }, async ($) => {
    const out = await $.command.run({ command: 'ambient', args: 'styles' } as any)
    expect(out.text).toContain(`**${name}** (current)`)
  })
}
for (const name of ['auto', ...Object.keys(PALETTES)]) {
  test(`config offers the ${name} palette`, { options: { palette: name } }, async ($) => {
    const out = await $.command.run({ command: 'ambient', args: 'styles' } as any)
    expect(out.text).toContain(name === 'auto' ? 'palette auto (' : `palette ${name}`)
  })
}
for (const name of Object.keys(INTENSITY)) {
  test(`config offers the ${name} intensity`, { options: { intensity: name } }, async ($) => {
    const out = await $.command.run({ command: 'ambient', args: 'styles' } as any)
    expect(out.text).toContain(`intensity ${name}`)
  })
}
for (const rows of ['1', '2', '3', '4', '5', '6']) {
  test(`config offers ${rows} rows`, { options: { rows } }, async ($) => {
    const out = await $.command.run({ command: 'ambient', args: 'styles' } as any)
    expect(out.text).toContain(`Height ${rows} row`)
  })
}

test('/ambient styles is clean Markdown: two tables and the current style in bold', async ($) => {
  const out = await $.command.run({ command: 'ambient', args: 'styles' } as any)
  const text = String(out.text)
  expect(text).toContain('| Style | What it shows |')
  expect(text).toContain('| `/ambient preview <style>` | play one style through a demo turn |')
  // Nothing that Markdown would turn into a quote or a code block
  for (const line of text.split('\n')) {
    expect(line.startsWith('>')).toBe(false)
    expect(line.startsWith('    ')).toBe(false)
  }
})

test('the styles row is drawn as a list in the transcript, the same on terminal and desktop', async ($, on) => {
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  const out = await $.command.run({ command: 'ambient', args: 'warp' } as any)
  expect(out.text).toContain('warp')
  const styles = await $.command.run({ command: 'ambient', args: 'styles' } as any)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ambient', surface, component: 'CommandOutput', props: { command: 'ambient', args: 'styles', text: String(styles.text), isErrored: false } } as any)
    expect(await ui.find({ type: 'Text', text: 'Ambient styles' })).toBeDefined()
    for (const s of REGISTRY) expect((await ui.find({ type: 'Text', text: new RegExp(`^${s}$`) }))?.props).toMatchObject({ bold: true })
    expect(await ui.find({ type: 'Text', text: '● ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /hyperspace streaks.*\(current\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\/ambient preview <style>/ })).toBeDefined()
    await ui.unmount()
  }
  // Any other /ambient row is left as Claude Code draws it
  const plain = await $.ui.mount({ plugin: 'ambient', surface: 'terminal', component: 'CommandOutput', props: { command: 'ambient', args: 'off', text: 'Ambient strip off', isErrored: false } } as any)
  expect(await plain.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
})
