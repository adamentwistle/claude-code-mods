import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  HOTKEYS,
  OPTIONS,
  VIEW_KEYS,
  applyOverrides,
  buildDesks,
  busyFromTitle,
  tally,
  cycleOption,
  resolveOptions,
  seatDesks,
  trackChanges,
  countActiveSubagents,
  layoutFor,
  paintFrame,
  parsePaneList,
  parseProcessInfo,
  projectDirName,
  tagLines,
} from '../hooks/office-model.mjs'
import { hitRects, paintPlan, planScene, poseFor } from '../hooks/office-scene.mjs'
import { characterBox, loadAtlas, sharpFactor, sharpPng } from '../hooks/office-pictures.mjs'
import { ATLAS_BIN, ATLAS_JSON } from './atlas-fixture'
import { DEMO_LOOP_MS, DEMO_NAMES, demoPanes } from '../hooks/office-demo.mjs'
// The hooks environment has the base64 methods of newer engines.
declare global {
  interface Uint8ArrayConstructor {
    fromBase64(text: string): Uint8Array
  }
  interface Uint8Array {
    toBase64(): string
  }
}

import { BUSY_SHELL, IDLE_SHELL, PANE_LIST, SELF_PANE } from './fixture'

const PANE = {
  plugin: 'office',
  component: 'Pane',
  requestId: 'office',
  viewport: { columns: 160, rows: 50, isFullscreen: true },
  props: {
    title: 'Office',
    isFocused: true,
    bodyColumns: 64,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 46 },
    view: {},
  },
} as const

const RUN = {
  command: 'office',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const

type Run = { exitCode: number; stdout: string; stderr: string }
const ok = (stdout: string): Run => ({ exitCode: 0, stdout, stderr: '' })
const NOW = 1_000_000_000

// Stubs herdr and the shell: `pane list` answers with `list`, process-info
// says w4:p2 runs a dev server, every focus succeeds; every argv is recorded.
function herdr(on: On, list: () => Run | 'missing', glob: Record<string, string> = {}) {
  const calls: string[][] = []
  on('process.run', ($, e) => {
    calls.push([...e.argv])
    const reply = (r: Run) => ({ value: { ...r, isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[1] === 'pane' && e.argv[2] === 'list') {
      const answer = list()
      return answer === 'missing' ? { deny: 'spawn herdr ENOENT' } : reply(answer)
    }
    if (e.argv[2] === 'process-info') return reply(ok(e.argv[4] === 'w4:p2' ? BUSY_SHELL : IDLE_SHELL))
    if (e.argv[0] === '/bin/sh') return reply(ok(glob[`${e.argv[4]}|${e.argv[5]}`] ?? ''))
    if (e.argv[0] === 'tail') return reply(ok(['{"cut', JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit' }] } })].join('\n')))
    return reply(ok('{}'))
  })
  return calls
}

// The session folders: this session's under its cwd's project folder, with
// four subagents written to in the last minute and one stale.
function sessions(on: On, lists: Record<string, { name: string; kind: 'file' | 'dir'; mtimeMs: number }[]> = {}) {
  const dirs = ['/h/.claude-work/projects/-Users-me-Projects/self-session', '/h/.claude/projects/-Users-me/3f0c2a77-aaaa-4bbb-8ccc-000000000003', '/h/.claude-work/projects/-Users-me-Projects/3f0c2a77-aaaa-4bbb-8ccc-000000000003.jsonl']
  on('fs.exists', ($, e) => ({ value: dirs.includes(e.path) }))
  const projects: Record<string, string[]> = { '/h/.claude-work/projects': ['-Users-me-Projects', '-Users-me-other'], '/h/.claude/projects': ['-Users-me'] }
  on('fs.list', ($, e) => {
    if (projects[e.path] && !lists[e.path]) return { value: projects[e.path]!.map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) }
    const entries = lists[e.path]
    return entries ? { value: entries.map(x => ({ ...x, size: 1, isLink: false })) } : { deny: 'ENOENT' }
  })
}

const flight = { now: 0, max: 0 }

function quiet(on: On, blitDeny?: string, slow?: { ms: number; clock: { sleep: (ms: number) => Promise<void> } }, denyKey = /^portrait-/) {
  const blits: unknown[] = []
  const toasts: string[] = []
  on('ui.blit', async ($, e) => {
    blits.push(e)
    flight.now++
    flight.max = Math.max(flight.max, flight.now)
    if (slow) await slow.clock.sleep(slow.ms)
    flight.now--
    return blitDeny && denyKey.test((e as { key: string }).key) ? { value: { deny: blitDeny } } : { value: {} }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  return { blits, toasts }
}

type Extra = { lists?: Record<string, { name: string; kind: 'file' | 'dir'; mtimeMs: number }[]>; reads?: Record<string, string>; env?: Record<string, string> }

function setup(on: On, list: () => Run | 'missing' = () => ok(PANE_LIST), saved?: Map<string, unknown>, pics?: { blitDeny?: string; slowBlitMs?: number; denyKey?: RegExp }, extra: Extra = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HERDR_PANE_ID: SELF_PANE, HOME: '/h', CLAUDE_CONFIG_DIR: '/h/.claude-work', ...extra.env })
  if (saved) {
    on('store.set', ($, e) => {
      saved.set(e.key, e.value)
      return { value: undefined }
    })
    on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  } else {
    mock.store(on, {})
  }
  const { blits, toasts } = quiet(on, pics?.blitDeny, pics?.slowBlitMs ? { ms: pics.slowBlitMs, clock } : undefined, pics?.denyKey)
  on('fs.read', ($, e) => {
    if (extra.reads?.[e.path] !== undefined) return { value: extra.reads[e.path]! }
    if (!pics) return { deny: 'ENOENT' }
    return e.path.endsWith('office-atlas.json') ? { value: ATLAS_JSON } : { value: { base64: ATLAS_BIN } }
  })
  sessions(on, {
    ...extra.lists,
    '/h/.claude-work/projects/-Users-me-Projects/self-session/subagents': [
      ...['a', 'b', 'c', 'd'].map(n => ({ name: `agent-${n}.jsonl`, kind: 'file' as const, mtimeMs: NOW - 5000 })),
      { name: 'agent-old.jsonl', kind: 'file', mtimeMs: NOW - 600000 },
      { name: 'agent-a.meta.json', kind: 'file', mtimeMs: NOW },
    ],
    '/h/.claude/projects/-Users-me/3f0c2a77-aaaa-4bbb-8ccc-000000000003/subagents': [
      { name: 'agent-x.jsonl', kind: 'file', mtimeMs: NOW - 1000 },
      { name: 'agent-y.jsonl', kind: 'file', mtimeMs: NOW - 2000 },
    ],
  })
  const calls = herdr(on, list)
  return { clock, blits, calls, toasts }
}

test('herdr JSON becomes desks: agents and busy shells, most interesting first', async () => {
  const { panes, error } = parsePaneList(PANE_LIST, SELF_PANE)
  expect(error).toBeUndefined()
  const procs = { 'w4:p1': parseProcessInfo(IDLE_SHELL), 'w4:p2': parseProcessInfo(BUSY_SHELL) }
  expect(procs['w4:p1']).toEqual({ isRunning: false, name: '' })
  expect(procs['w4:p2']).toEqual({ isRunning: true, name: 'npm run dev' })
  const { desks, idleShells } = buildDesks(panes!, procs, { 'self-session': 3 }, 'busy')
  // Needs you, working, done, idle, then busy terminals.
  expect(desks.map(d => `${d.status} ${d.kind} ${d.name}`)).toEqual([
    'blocked agent orch-benchy',
    'working agent orch-qube',
    'working agent codex review',
    'working agent Mods for Quicknode',
    'done agent Brief execution',
    'idle agent orch-q',
    'idle agent benchmark',
    'running process npm run dev',
  ])
  expect(idleShells).toBe(1)
  expect(desks.find(d => d.isSelf)).toMatchObject({ paneId: SELF_PANE, helpers: 3 })
  expect(parsePaneList('not json', SELF_PANE).error).toMatch(/not JSON/)
})

test('subagent counting and project folder names', async () => {
  expect(projectDirName('/Users/me/Projects')).toBe('-Users-me-Projects')
  expect(projectDirName('/Users/me/my.app')).toBe('-Users-me-my-app')
  const entries = [
    { name: 'agent-1.jsonl', kind: 'file', mtimeMs: 100_000 },
    { name: 'agent-2.jsonl', kind: 'file', mtimeMs: 30_000 },
    { name: 'agent-1.meta.json', kind: 'file', mtimeMs: 100_000 },
  ]
  expect(countActiveSubagents(entries, 100_000)).toBe(1)
  expect(countActiveSubagents(entries, 100_000, 80_000)).toBe(2)
})

test('the desk size shrinks until everything fits, and nothing is capped', async () => {
  expect(layoutFor(3, 64, 40).scale.name).toBe('normal')
  expect(layoutFor(8, 64, 24)).toMatchObject({ scale: { name: 'compact' }, perRow: 5, deskRows: 2, shown: 8 })
  expect(layoutFor(4, 170, 60, { isFull: true })).toMatchObject({ scale: { name: 'large' }, perRow: 4, tileW: 40 })
  expect(layoutFor(200, 64, 30).shown).toBe(200)
  const { panes } = parsePaneList(PANE_LIST, SELF_PANE)
  const { desks } = buildDesks(panes!)
  const layout = layoutFor(desks.length, 64, 46)
  const cells = paintFrame(layout, desks, 0)
  expect(Math.ceil((layout.columns * layout.rows * 12) / 3) * 4).toBe(cells.length)
  expect(paintFrame(layout, desks, 1)).not.toBe(cells)
  // Long names run on to the tag's second line instead of being cut.
  const long = { ...desks[0]!, name: 'Brief execution from the legwork tracker' }
  expect(tagLines(long, 0, 20)).toMatchObject({ first: '1: Brief execution f', second: 'rom the legwork tra~' })
  expect(tagLines(desks[0]!, 0, 20)).toMatchObject({ first: '1: orch-benchy', second: 'Help please' })
})

test('the pane draws the office with a name-tag button per desk that jumps to its pane', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed' } }, async ($, on) => {
  const { calls } = setup(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  const raster = await ui.find({ type: 'Raster' })
  expect(raster?.props).toMatchObject({ key: 'office-floor', columns: 62, rows: 33 })
  expect(await ui.find({ type: 'Text', text: '■ 1 needs you' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '■ 3 working' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '■ 1 running' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1 idle shell' })).toBeDefined()

  // The tag sits over the desk's name row, the button inside it.
  expect((await ui.find({ key: 'tag-1' }))?.props).toMatchObject({ position: 'absolute', top: 9, left: 0, width: 20 })
  expect((await ui.find({ key: 'tag-8' }))?.props).toMatchObject({ top: 31, left: 21 })
  expect((await ui.find({ key: 'desk-1' }))?.props).toMatchObject({ label: 'orch-benchy', hotkey: '1', plain: true })
  expect((await ui.find({ key: 'desk-8' }))?.props).toMatchObject({ label: 'npm run dev', hotkey: '8' })
  expect(await ui.find({ key: 'desk-9' })).toBeUndefined()

  calls.length = 0
  await ui.press({ key: 'desk-2' })
  expect(calls).toEqual([
    ['herdr', 'workspace', 'focus', 'w7W'],
    ['herdr', 'tab', 'focus', 'w7W:t1'],
    ['herdr', 'agent', 'focus', 'w7W:p1'],
  ])
  // A plain terminal has no agent to focus: its workspace and tab.
  calls.length = 0
  await ui.press({ key: 'desk-8' })
  expect(calls).toEqual([
    ['herdr', 'workspace', 'focus', 'w4'],
    ['herdr', 'tab', 'focus', 'w4:t2'],
  ])
  await ui.unmount()
})

test('every desk gets a tag, past the hotkeys too', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed' } }, async ($, on) => {
  const doc = JSON.parse(PANE_LIST)
  const one = doc.result.panes[3]
  doc.result.panes = Array.from({ length: 40 }, (_, i) => ({ ...one, pane_id: `w${i}:p1`, title: `agent-${i}` }))
  setup(on, () => ok(JSON.stringify(doc)))
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 200, scroll: { offset: 0, bodyRows: 60 } }, surface: 'terminal' })
  // Digits only: letters belong to the view.
  expect((await ui.find({ key: 'desk-9' }))?.props).toMatchObject({ hotkey: '9' })
  expect((await ui.find({ key: 'desk-10' }))?.props).toMatchObject({ hotkey: '0' })
  expect((await ui.find({ key: 'desk-11' }))?.props?.hotkey).toBeUndefined()
  expect((await ui.find({ key: 'desk-40' }))?.props).toMatchObject({ label: 'agent-39' })
  expect((await ui.find({ key: 'desk-32' }))?.props?.hotkey).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /more desks/ })).toBeUndefined()
})

test('helpers are counted from subagent transcripts written in the last minute', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed' } }, async ($, on) => {
  const { clock } = setup(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Counted from the second poll on, so the first draw does not wait for it.
  await clock.advance(3100)
  await ui.redraw()
  // Found under the cwd's project folder: four fresh, one stale, one not a transcript.
  expect(await ui.find({ type: 'Button', text: 'Mods for Quicknode  Working...  4 helpers  (this session)' })).toBeDefined()
  // Started one folder up, in the other config folder: found by walking up the cwd.
  expect(await ui.find({ type: 'Button', text: /^orch-qube  (Working|Coding)\.\.\.  2 helpers$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: 'orch-benchy  Help please' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: 'orch-benchy  3 helpers' })).toBeUndefined()
})

test('the desktop gets one button row per desk instead of a raster', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed' } }, async ($, on) => {
  setup(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect((await ui.find({ key: 'desk-8' }))?.props).toMatchObject({ label: 'npm run dev  running  web', hotkey: '8' })
})

test('herdr failing: the office falls back to the sessions registry and says so', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed' } }, async ($, on) => {
  setup(on, () => ({ exitCode: 1, stdout: '', stderr: '{"error":"server not running"}\nmore' }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'no herdr: 0 live sessions running this mod, 0 recent transcripts' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^No sessions found/ })).toBeDefined()
  expect(await ui.find({ key: 'close' })).toBeDefined()
})

test('herdr missing: same, and herdr is not asked again for a minute', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed' } }, async ($, on) => {
  const { clock, calls } = setup(on, () => 'missing')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^no herdr:/ })).toBeDefined()
  await clock.advance(30_000)
  expect(calls.filter(a => a[2] === 'list').length).toBe(1)
  await clock.advance(40_000)
  expect(calls.filter(a => a[2] === 'list').length).toBe(2)
})

test('polling and animation run while open and stop after close', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed' } }, async ($, on) => {
  const { clock, blits, calls } = setup(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const lists = () => calls.filter(a => a[2] === 'list').length
  expect(lists()).toBe(1)

  await clock.advance(6000)
  expect(lists()).toBe(3)
  expect(blits.length > 20).toBe(true)
  expect(blits[0]).toMatchObject({ requestId: 'office', key: 'office-floor', columns: 62 })

  await ui.press({ key: 'close' })
  const listsAtClose = lists()
  const blitsAtClose = blits.length
  await clock.advance(10000)
  expect(lists()).toBe(listsAtClose)
  expect(blits.length).toBe(blitsAtClose)
})

test('/office opens, /office full asks for most of the screen, /office close closes', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed' } }, async ($, on) => {
  mock.clock(on)
  const registered: string[] = []
  const opened: unknown[] = []
  const closed: string[] = []
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', ($, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    closed.push(e.id)
    return { value: undefined }
  })

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(registered).toEqual(['office'])
  expect((await $.command.run({ ...RUN, args: '' })).text).toMatch(/^Office opened/)
  expect(opened[0]).toMatchObject({ id: 'office', focus: true, columns: 66, rows: 28 })
  expect((await $.command.run({ ...RUN, args: 'full' })).text).toMatch(/full size/)
  expect(opened[1]).toMatchObject({ id: 'office', columns: 130, rows: 200 })
  expect((await $.command.run({ ...RUN, args: 'close' })).text).toBe('Office closed.')
  expect(closed).toEqual(['office'])
})

// ---- v3: layouts, options, seating, settings ----------------------------------

const BIG = { ...PANE, props: { ...PANE.props, bodyColumns: 200, scroll: { offset: 0, bodyRows: 60 } } } as const

for (const layout of ['office', 'war-room', 'strip'] as const) {
  test(`the ${layout} layout draws one picture with a tag button per desk`, { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed', layout } }, async ($, on) => {
    setup(on)
    const ui = await $.ui.mount({ ...BIG, surface: 'terminal' })
    const raster = await ui.find({ type: 'Raster' })
    expect(raster).toBeDefined()
    if (layout !== 'strip') expect(raster?.props).toMatchObject({ columns: 200 })
    expect((await ui.find({ key: 'tag-1' }))?.props).toMatchObject({ position: 'absolute' })
    // A strip desk is 10 columns: its tag holds `1: ` and the first 7 letters.
    expect((await ui.find({ key: 'desk-1' }))?.props).toMatchObject({ label: layout === 'strip' ? 'orch-be' : 'orch-benchy', hotkey: '1' })
    expect((await ui.find({ key: 'desk-8' }))?.props).toMatchObject({ hotkey: '8' })
  })
}

test('every layout paints every desk inside the Raster limits', async () => {
  const { panes } = parsePaneList(PANE_LIST, SELF_PANE)
  const { desks } = buildDesks(panes!)
  const many = Array.from({ length: 40 }, (_, i) => ({ ...desks[i % desks.length]!, paneId: `w${i}:p1`, sessionId: `s-${i}-aaaaaaaa` }))
  for (const layout of ['grid', 'office', 'war-room', 'strip']) {
    for (const [cols, rows] of [[60, 30], [200, 60], [512, 256]] as const) {
      const plan = planScene(layout, many, cols, rows, { lighting: 'night', palette: 'warm', characters: 'mixed' })
      expect(plan.columns <= 512 && plan.rows <= 256).toBe(true)
      expect(plan.tags.length).toBe(layout === "grid" ? plan.grid!.shown : 40)
      const words = paintPlan(plan, 3, 0)
      expect(words.length).toBe(plan.columns * plan.rows * 3)
    }
  }
})

test('options: the settings view wins over userConfig, which wins over the default', async () => {
  expect(resolveOptions({}, {})).toMatchObject({ layout: 'grid', characters: 'critters', style: 'bold', render: 'hybrid', show: 'claude', desks: 8, sound: false })
  expect(resolveOptions({ layout: 'office', characters: 'robots' }, { characters: 'animals' })).toMatchObject({ layout: 'office', characters: 'animals' })
  expect(resolveOptions({ layout: 'nonsense' }, {}).layout).toBe('grid')
  expect(resolveOptions({ hide_done_minutes: 15, reduced_motion: true }, {})).toMatchObject({ hideDoneMinutes: 15, reducedMotion: true })
  expect(cycleOption(resolveOptions(), 'layout').layout).toBe('tiles')
  expect(cycleOption({ ...resolveOptions(), layout: 'strip' }, 'layout').layout).toBe('grid')
  expect(new Set(OPTIONS.map(o => o.hotkey)).size).toBe(OPTIONS.length)
})

test('seating packs from the first desk with no gaps; a pin is a place in that order', async () => {
  const d = (id: string, status = 'working') => ({ paneId: id, sessionId: `sess-${id}`, status, order: 0, project: 'p', workspaceId: 'w' }) as any
  // By state: needs you, working, done, idle; one seat per desk.
  const byState = seatDesks([d('a', 'idle'), d('b', 'blocked'), d('c'), d('e', 'done')], 'state', {}, 0)
  expect(byState.seats.map(x => x.paneId)).toEqual(['b', 'c', 'e', 'a'])
  // Stable: each keeps its place; one leaving closes the gap, a newcomer goes last.
  const first = seatDesks([d('a'), d('b'), d('c')], 'stable', {}, 0)
  const second = seatDesks([d('a'), d('c'), d('d', 'blocked')], 'stable', first.memory, 60_000)
  expect(second.seats.map(x => x.paneId)).toEqual(['a', 'c', 'd'])
  // A pin is a place in the packed order...
  const pinned = seatDesks(applyOverrides([d('a'), d('b'), d('c')], { 's:sess-c': { seat: 1 } }) as any, 'state', {}, 0)
  expect(pinned.seats.map(x => x.paneId)).toEqual(['c', 'a', 'b'])
  // ...and an old absolute seat (25, 49) past the end goes last: no empty desks before it.
  const far = seatDesks(applyOverrides([d('a'), d('b'), d('c')], { 's:sess-a': { seat: 25 }, 's:sess-b': { seat: 49 } }) as any, 'state', {}, 0)
  expect(far.seats.map(x => x.paneId)).toEqual(['c', 'a', 'b'])
  expect(far.seats.length).toBe(3)
  // Other modes group, then sort by state.
  const byWs = seatDesks([{ ...d('a'), workspaceId: 'w2' }, { ...d('b', 'blocked'), workspaceId: 'w1' }, { ...d('c'), workspaceId: 'w1' }], 'workspace', {}, 0)
  expect(byWs.seats.map(x => x.paneId)).toEqual(['b', 'c', 'a'])
})

test('state changes are tracked; the first sight is not a change', async () => {
  const d = (status: string) => ({ paneId: 'a', sessionId: 'sess-a', status }) as any
  const one = trackChanges([d('working')], {}, 1000)
  expect(one.changes).toEqual([])
  const two = trackChanges([d('done')], one.memory, 5000)
  expect(two.changes.map(c => `${c.from}>${c.to}`)).toEqual(['working>done'])
  expect(two.desks[0]).toMatchObject({ changedAt: 5000, prevStatus: 'working' })
})

test('the settings view cycles an option with its key and saves it', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed' } }, async ($, on) => {
  const saved = new Map<string, unknown>()
  setup(on, undefined, saved)
  const ui = await $.ui.mount({ ...BIG, surface: 'terminal' })
  expect((await ui.find({ type: 'Raster' }))?.props).toMatchObject({ columns: 163 })
  await ui.press({ key: 'settings' })
  await ui.redraw()
  expect((await ui.find({ key: 'set-layout' }))?.props).toMatchObject({ hotkey: 'l' })
  expect(await ui.find({ type: 'Text', text: 'grid' })).toBeDefined()
  await ui.press({ key: 'set-layout' })
  expect(saved.get('options')).toEqual({ layout: 'tiles' })
  await ui.press({ key: 'set-layout' })
  expect(saved.get('options')).toEqual({ layout: 'office' })
  await ui.press({ key: 'set-characters' })
  await ui.press({ key: 'set-characters' })
  expect(saved.get('options')).toEqual({ layout: 'office', characters: 'robots' })
  await ui.press({ key: 'back' })
  await ui.redraw()
  // The office now fills the body.
  expect((await ui.find({ type: 'Raster' }))?.props).toMatchObject({ columns: 200 })
  // Seats are remembered too.
  expect(Object.keys(saved.get('seats') as object).length).toBe(8)
})

test('a session can be renamed, given a character and pinned from the settings view', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed' } }, async ($, on) => {
  const saved = new Map<string, unknown>()
  setup(on, undefined, saved)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'settings' })
  await ui.redraw()
  await ui.select({ key: 'session', value: 's:3f0c2a77-aaaa-4bbb-8ccc-000000000003' })
  await ui.input({ key: 'label', text: 'Qube lead' })
  await ui.select({ key: 'character', value: 'owl' })
  await ui.input({ key: 'seat', text: '1' })
  expect(saved.get('sessions')).toEqual({ 's:3f0c2a77-aaaa-4bbb-8ccc-000000000003': { label: 'Qube lead', character: 'owl', seat: 1 } })
  await ui.press({ key: 'back' })
  await ui.redraw()
  expect((await ui.find({ key: 'desk-1' }))?.props).toMatchObject({ label: 'Qube lead', hotkey: '1' })
})

test('a session that starts needing you raises a toast, and the chime when asked', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed', sound: true } }, async ($, on) => {
  let calls = 0
  const blocked = JSON.parse(PANE_LIST)
  blocked.result.panes[4].agent_status = 'blocked'
  const { clock, toasts } = setup(on, () => ok(calls++ === 0 ? PANE_LIST : JSON.stringify(blocked)))
  const sounds: unknown[] = []
  on('audio.play', ($, e) => {
    sounds.push(e)
    return { value: undefined }
  })
  await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(toasts).toEqual([])
  await clock.advance(3000)
  expect(toasts).toEqual(['orch-qube needs you'])
  // The chime follows the toast in the same poll: let that poll finish.
  for (let i = 0; i < 5 && !sounds.length; i++) await clock.advance(1)
  expect(JSON.stringify(sounds)).toMatch(/needs-you\.wav/)
})

test('reduced motion and hidden done sessions', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed', reduced_motion: true, hide_done_minutes: 5 }, timeoutMs: 60000 }, async ($, on) => {
  const { clock } = setup(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const labels = async () => Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(async i => (await ui.find({ key: `desk-${i}` }))?.props?.label))
  expect(await labels()).toContain('Brief execution')
  await clock.advance(6 * 60_000)
  await ui.redraw()
  const after = await labels()
  expect(after).not.toContain('Brief execution')
  expect(after[7]).toBeUndefined()
})

// ---- v4: the done loop, the sort order, drag to arrange --------------------------

test('a finished session celebrates in a loop until its pane is looked at', async () => {
  const d = (status: string, isFocused = false) => ({ paneId: 'a', sessionId: 'sess-a', status, isFocused }) as any
  const one = trackChanges([d('working')], {}, 1000)
  const two = trackChanges([d('done')], one.memory, 10_000)
  expect(two.desks[0]).toMatchObject({ unseenDone: true, changedAt: 10_000 })
  expect(two.unseen).toEqual({ 's:sess-a': 10_000 })
  const done = two.desks[0]!
  // 4 s cheering, 3 s stretching, and round again.
  expect([1000, 5000, 8000, 12_500, 15_000].map(t => poseFor(done, 10_000 + t, false))).toEqual(['celebrate', 'stretch', 'celebrate', 'stretch', 'celebrate'])
  expect(poseFor(done, 30_000, true)).toBe('stretch')
  // Still unseen on the next poll; seen once the pane is focused.
  const three = trackChanges([d('done')], two.memory, 20_000)
  expect(three.desks[0]?.unseenDone).toBe(true)
  const four = trackChanges([d('done', true)], three.memory, 22_000)
  expect(four.desks[0]?.unseenDone).toBe(false)
  expect(four.unseen).toEqual({})
  expect(poseFor(four.desks[0]!, 40_000, false)).toBe('sleep')
  // After a reload the stored mark carries on; a session first met done is not replayed.
  expect(trackChanges([d('done')], {}, 50_000, { 's:sess-a': 10_000 }).desks[0]).toMatchObject({ unseenDone: true, changedAt: 10_000 })
  expect(trackChanges([d('done')], {}, 50_000, {}).desks[0]?.unseenDone).toBe(false)
  // Moving on from done also counts as seen.
  expect(trackChanges([d('working')], three.memory, 23_000).desks[0]?.unseenDone).toBe(false)
})

test('the pane keeps an unseen finish in the store and clears it once focused', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed' } }, async ($, on) => {
  let call = 0
  const finished = JSON.parse(PANE_LIST)
  finished.result.panes[4].agent_status = 'done'
  const looked = JSON.parse(JSON.stringify(finished))
  looked.result.panes[4].focused = true
  const saved = new Map<string, unknown>()
  const { clock } = setup(on, () => ok(JSON.stringify([JSON.parse(PANE_LIST), finished, finished, looked][Math.min(call++, 3)])), saved)
  await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(3000)
  expect(Object.keys(saved.get('unseen') as object)).toEqual(['s:3f0c2a77-aaaa-4bbb-8ccc-000000000003'])
  await clock.advance(3000)
  expect(Object.keys(saved.get('unseen') as object)).toEqual(['s:3f0c2a77-aaaa-4bbb-8ccc-000000000003'])
  await clock.advance(3000)
  expect(saved.get('unseen')).toEqual({})
})

test('the default order: needs you, working, done, idle, busy terminals', async () => {
  expect(resolveOptions().seating).toBe('state')
  const d = (id: string, status: string) => ({ paneId: id, sessionId: `s-${id}`, status, order: 0, project: 'p', workspaceId: 'w' }) as any
  const { seats } = seatDesks([d('i', 'idle'), d('r', 'running'), d('d', 'done'), d('w', 'working'), d('b', 'blocked')], 'state', {}, 0)
  expect(seats.map(x => x?.status)).toEqual(['blocked', 'working', 'done', 'idle', 'running'])
})

test('dragging a desk onto another moves it to that place; a click jumps', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed' } }, async ($, on) => {
  const saved = new Map<string, unknown>()
  const { calls } = setup(on, undefined, saved)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const layer = await ui.find({ key: 'drag' })
  expect(layer?.props).toMatchObject({ module: 'hooks/office-drag.mjs', width: 62, height: 33 })
  const hits = (layer?.props as { props: { hits: number[][] } }).props.hits
  const centre = (i: number) => ({ x: hits[i]![0]! + 3, y: hits[i]![1]! + 3 })
  expect((await ui.find({ key: 'desk-1' }))?.props).toMatchObject({ label: 'orch-benchy' })
  expect((await ui.find({ key: 'desk-2' }))?.props).toMatchObject({ label: 'orch-qube' })

  // Press desk 2, drag it over desk 1: a ghost follows the pointer.
  await ui.pointer({ type: 'down', ...centre(1), button: 'left', in: 'drag' })
  await ui.pointer({ type: 'move', ...centre(0), button: 'left', in: 'drag' })
  expect(await ui.find({ type: 'Text', text: ' orch-qube ', in: 'drag' })).toBeDefined()
  await ui.pointer({ type: 'up', ...centre(0), button: 'left', in: 'drag' })
  expect(saved.get('sessions')).toEqual({ 's:3f0c2a77-aaaa-4bbb-8ccc-000000000003': { seat: 1 } })
  await ui.redraw()
  expect((await ui.find({ key: 'desk-1' }))?.props).toMatchObject({ label: 'orch-qube' })
  expect((await ui.find({ key: 'desk-2' }))?.props).toMatchObject({ label: 'orch-benchy' })

  // A press and release in place jumps to that desk's pane.
  calls.length = 0
  await ui.pointer({ type: 'down', ...centre(1), button: 'left', in: 'drag' })
  await ui.pointer({ type: 'up', ...centre(1), button: 'left', in: 'drag' })
  expect(calls.at(-1)).toEqual(['herdr', 'agent', 'focus', 'w7W:p5'])
})

test('while dragging, the target desk is outlined in the frame', async () => {
  const { panes } = parsePaneList(PANE_LIST, SELF_PANE)
  const { desks } = buildDesks(panes!)
  for (const layout of ['grid', 'office', 'war-room', 'strip']) {
    const plan = planScene(layout, desks, 200, 60, {}) as any
    const plain = paintPlan(plan, 0, 0)
    plan.drag = { from: 0, over: 1 }
    const lit = paintPlan(plan, 0, 0)
    expect(Array.from(lit).includes(0xffd23f)).toBe(true)
    expect(Array.from(plain).includes(0xffd23f)).toBe(false)
    expect(hitRects(plan).length).toBe(desks.length)
  }
})

// ---- v5: the atlas -----------------------------------------------------------------

const atlasBytes = () => Uint8Array.fromBase64(ATLAS_BIN)

test('the atlas loads from its JSON and bytes, and refuses a mismatch', async () => {
  const atlas = loadAtlas(ATLAS_JSON, atlasBytes())
  expect(Object.keys(atlas.sprites).length).toBe(133)
  expect(atlas.sprites['chr:0,0']).toBeDefined()
  expect(atlas.sprites['ind:0,8']).toBeDefined()
  expect(() => loadAtlas(ATLAS_JSON, atlasBytes().slice(1))).toThrow()
  expect(() => loadAtlas('{}', atlasBytes())).toThrow()
})

test('render cells never draws a picture', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed', layout: 'office' } }, async ($, on) => {
  setup(on, undefined, undefined, {})
  const ui = await $.ui.mount({ ...BIG, surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
})

// ---- v6: crash, flicker, polling, keys, counts ---------------------------------

function manyAgents(n: number, status = (i: number) => ['working', 'blocked', 'idle', 'done'][i % 4]!) {
  const doc = JSON.parse(PANE_LIST)
  const one = doc.result.panes[4]
  doc.result.panes = Array.from({ length: n }, (_, i) => ({ ...one, pane_id: `w${i}:p1`, tab_id: `w${i}:t1`, title: `agent-${i}`, agent_status: status(i), agent_session: { ...one.agent_session, value: `sess-${i}-aaaaaaaa` } }))
  return JSON.stringify(doc)
}

for (const render of ['hybrid', 'cells'] as const) {
  test(`switching layouts while frames run never breaks the pane (${render})`, { options: { show: 'busy', desks: 'all', render, style: 'detailed', layout: 'office' }, timeoutMs: 60000 }, async ($, on) => {
    let n = 1
    const { clock } = setup(on, () => ok(manyAgents(n)), undefined, { slowBlitMs: 450 })
    flight.max = 0
    flight.now = 0
    for (const [cols, rows, count] of [[60, 28, 1], [200, 54, 12], [250, 80, 60], [120, 40, 30]] as const) {
      n = count
      const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: cols, scroll: { offset: 0, bodyRows: rows } }, surface: 'terminal' })
      for (let k = 0; k < 6; k++) {
        await ui.press({ key: 'view-layout' })
        await clock.advance(700)
        await ui.redraw()
        expect(await ui.find({ type: 'Text', text: /could not draw/ })).toBeUndefined()
        const image = await ui.find({ type: 'Image' })
        const raster = await ui.find({ type: 'Raster' })
        expect(Boolean(image || raster)).toBe(true)
        if (image) {
          // A character picture: a box within 255 cells, a PNG within 2048 pixels.
          const p = image.props as { columns: number; rows: number; source: { png: string } }
          expect(p.columns <= 255 && p.rows <= 255).toBe(true)
          const dv = new DataView(Uint8Array.fromBase64(p.source.png).buffer)
          expect(dv.getUint32(16) <= 2048 && dv.getUint32(20) <= 2048).toBe(true)
        }
        if (raster) {
          const p = raster.props as { columns: number; rows: number }
          expect(p.columns <= 512 && p.rows <= 256).toBe(true)
        }
      }
      await ui.unmount()
    }
    // Never two frames in flight at once, however slow the terminal.
    expect(flight.max).toBe(1)
  })
}

test('a poll spawns one process: herdr pane list, and nothing per pane', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed' } }, async ($, on) => {
  const { clock, calls } = setup(on)
  await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(9000)
  expect(calls.length > 2).toBe(true)
  // Besides herdr: only a transcript tail now and then, for a working session's words.
  expect(calls.every(a => a.join(' ') === 'herdr pane list' || a[0] === 'tail')).toBe(true)
  expect(calls.filter(a => a[0] === 'tail').length <= 1).toBe(true)
})

test('busy terminals come from pane titles', async () => {
  const { panes } = parsePaneList(PANE_LIST, SELF_PANE)
  const plain = panes!.filter(p => !p.agent)
  const procs = Object.fromEntries(plain.map(p => [p.paneId, busyFromTitle((p as any).terminalTitle)]))
  expect(procs).toEqual({ 'w4:p2': { isRunning: true, name: 'npm run dev' }, 'w4:p1': { isRunning: false, name: '' } })
  expect(busyFromTitle('aae@Mac:~/Projects/qn/qube').isRunning).toBe(false)
  expect(busyFromTitle('vim notes.md').isRunning).toBe(true)
  expect(busyFromTitle('-zsh').isRunning).toBe(false)
})

test('idle shells drawn as empty desks are not counted as done', { options: { show: 'all', desks: 'all', render: 'cells', style: 'detailed' } }, async ($, on) => {
  setup(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '■ 1 done' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1 idle shell' })).toBeDefined()
  const { panes } = parsePaneList(PANE_LIST, SELF_PANE)
  const { desks } = buildDesks(panes!, {}, {}, 'all')
  expect(tally(desks).done).toBe(1)
  expect(desks.at(-1)?.kind).toBe('shell')
})

test('letters are the view keys in the office; desks take digits', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed', layout: 'office' } }, async ($, on) => {
  const saved = new Map<string, unknown>()
  setup(on, undefined, saved)
  const ui = await $.ui.mount({ ...BIG, surface: 'terminal' })
  for (const [key, option] of Object.entries(VIEW_KEYS)) expect((await ui.find({ key: `view-${option}` }))?.props).toMatchObject({ hotkey: key })
  expect((await ui.find({ key: 'settings' }))?.props).toMatchObject({ hotkey: 's' })
  expect((await ui.find({ key: 'full' }))?.props).toMatchObject({ hotkey: 'f' })
  expect((await ui.find({ key: 'close' }))?.props).toMatchObject({ hotkey: 'x' })
  await ui.press({ key: 'view-characters' })
  expect(saved.get('options')).toEqual({ characters: 'humans' })
  expect(HOTKEYS.join('')).toBe('1234567890')
})

// ---- v7: bold characters, tiles, outside herdr ---------------------------------------

import { liveEntries, projectFromDir, recentTranscripts, registryEntry, sessionPanes } from '../hooks/office-sessions.mjs'

const REG = '/h/.claude-work/plugins/data/office-registry'
const entry = (id: string, state: string, cwd: string, lastSeen: number, helpers = 0) => JSON.stringify(registryEntry({ id, cwd, state, helpers, now: lastSeen }))

test('outside herdr: live registry sessions and recent transcripts become desks; a click copies the resume command', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed' } }, async ($, on) => {
  const copies: string[] = []
  on('ui.copy', ($, e) => {
    copies.push(e.text)
    return { value: { isCopied: true } }
  })
  const { toasts } = setup(on, () => 'missing', undefined, undefined, {
    lists: {
      [REG]: [
        { name: 'aaaaaaaa-1111-4111-8111-111111111111.json', kind: 'file', mtimeMs: NOW - 10_000 },
        { name: 'bbbbbbbb-2222-4222-8222-222222222222.json', kind: 'file', mtimeMs: NOW - 20_000 },
        { name: 'cccccccc-3333-4333-8333-333333333333.json', kind: 'file', mtimeMs: NOW - 600_000 },
      ],
      '/h/.claude-work/projects/-Users-me-other': [
        { name: 'dddddddd-4444-4444-8444-444444444444.jsonl', kind: 'file', mtimeMs: NOW - 60_000 },
        { name: 'eeeeeeee-5555-4555-8555-555555555555.jsonl', kind: 'file', mtimeMs: NOW - 3 * 3600_000 },
      ],
    },
    reads: {
      [`${REG}/aaaaaaaa-1111-4111-8111-111111111111.json`]: entry('aaaaaaaa-1111-4111-8111-111111111111', 'needs-you', '/Users/me/Projects/qube', NOW - 10_000, 2),
      [`${REG}/bbbbbbbb-2222-4222-8222-222222222222.json`]: entry('bbbbbbbb-2222-4222-8222-222222222222', 'working', '/Users/me/Projects/web', NOW - 20_000),
    },
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'no herdr: 2 live sessions running this mod, 1 recent transcript' })).toBeDefined()
  expect((await ui.find({ key: 'desk-1' }))?.props).toMatchObject({ label: 'qube' })
  expect((await ui.find({ key: 'desk-2' }))?.props).toMatchObject({ label: 'web' })
  expect((await ui.find({ key: 'desk-3' }))?.props).toMatchObject({ label: 'other' })
  expect(await ui.find({ key: 'desk-4' })).toBeUndefined()
  await ui.press({ key: 'desk-1' })
  expect(copies).toEqual(['claude --resume aaaaaaaa-1111-4111-8111-111111111111'])
  expect(toasts.at(-1)).toMatch(/qube \(aaaaaaaa-1111-4111-8111-111111111111\) in \/Users\/me\/Projects\/qube: copied/)
})

test('each session writes its own registry entry and keeps it up to date', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/h', CLAUDE_CONFIG_DIR: '/h/.claude-work' })
  const writes: { path: string; state: string; lastSeen: number }[] = []
  on('fs.write', ($, e) => {
    const v = JSON.parse(e.text)
    writes.push({ path: e.path, state: v.state, lastSeen: v.lastSeen })
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'ffffffff-6666-4666-8666-666666666666' }))
  on('session.cwd', () => ({ value: '/Users/me/Projects/qube' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', () => ({ cwd: '/work' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: 'ok' }))
  on('session.end', () => ({ sessionId: 'ffffffff-6666-4666-8666-666666666666' }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.start({ turnId: 't1' } as any)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as any)
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, usage: null } as any)
  await $.session.end({ reason: 'other' } as any)
  // Writes go out in order, after the hooks have passed their events on.
  for (let i = 0; i < 10 && writes.length < 6; i++) await clock.advance(1)
  expect(writes[0]!.path).toBe(`${REG}/ffffffff-6666-4666-8666-666666666666.json`)
  expect(writes.map(w => w.state)).toEqual(['idle', 'working', 'needs-you', 'working', 'done', 'done'])
  expect(writes.at(-1)!.lastSeen).toBe(0)
})

test('registry entries expire without a heartbeat; transcripts are idle, then done', async () => {
  const now = 10_000_000
  const live = liveEntries([entry('a-1', 'working', '/x/qube', now - 30_000), entry('b-2', 'idle', '/x/web', now - 200_000), 'not json', entry('c-3', 'done', '/x/old', 0)], now)
  expect(live.map(e => e.id)).toEqual(['a-1'])
  const recent = recentTranscripts('-Users-me-Projects-qube', [
    { name: 'dddddddd-4444-4444-8444-444444444444.jsonl', kind: 'file', mtimeMs: now - 60_000 },
    { name: 'eeeeeeee-5555-4555-8555-555555555555.jsonl', kind: 'file', mtimeMs: now - 20 * 60_000 },
    { name: 'notes.md', kind: 'file', mtimeMs: now },
  ], now)
  const { panes } = sessionPanes(live, recent, now, 'a-1')
  expect(panes.map(p => `${p.name}:${p.status}:${p.source}:${p.isSelf}`)).toEqual(['qube:working:registry:true', 'qube:idle:transcript:false', 'qube:done:transcript:false'])
  expect(projectFromDir('-Users-me-Projects-qube')).toBe('qube')
})

test('bold is the default style and draws every character set in cells', async () => {
  const { panes } = parsePaneList(PANE_LIST, SELF_PANE)
  const { desks } = buildDesks(panes!)
  for (const characters of ['critters', 'humans', 'robots', 'animals', 'mixed']) {
    const bold = paintPlan(planScene('office', desks, 200, 40, { characters, style: 'bold' }) as any, 1, 0)
    const detailed = paintPlan(planScene('office', desks, 200, 40, { characters, style: 'detailed' }) as any, 1, 0)
    expect(bold.length).toBe(detailed.length)
    if (characters !== 'critters') expect(Array.from(bold).join(',') === Array.from(detailed).join(',')).toBe(false)
  }
})

test('tiles: a small picture of each character over its card, sent again only when it changes', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed', layout: 'tiles' } }, async ($, on) => {
  const { clock, blits } = setup(on, undefined, undefined, {})
  const ui = await $.ui.mount({ ...BIG, surface: 'terminal' })
  expect((await ui.find({ type: 'Raster' }))?.props).toMatchObject({ columns: 163 })
  const portrait = await ui.find({ key: 'portrait-1' })
  expect(portrait?.props).toMatchObject({ columns: 16, rows: 12 })
  const src = (portrait?.props as { source: { png: string } }).source
  const png = Uint8Array.fromBase64(src.png)
  expect(Array.from(png.slice(1, 4))).toEqual([80, 78, 71])
  expect(png.length < 20_000).toBe(true)
  const portraitBlits = () => blits.filter(b => String((b as { key: string }).key).startsWith('portrait-'))
  await clock.advance(5000)
  // Only the moving tiles (needs you, working, the busy terminal) are sent, about once a second.
  const keys = new Set(portraitBlits().map(b => (b as { key: string }).key))
  expect(keys.has('portrait-1')).toBe(true)
  expect(keys.has('portrait-6')).toBe(false)
  expect(portraitBlits().length <= 5 * 6).toBe(true)
})

test('tiles: where pictures draw their alt text, the cards get bold cell characters', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed', layout: 'tiles' } }, async ($, on) => {
  const { clock } = setup(on, undefined, undefined, { blitDeny: 'the Image draws its alt here', denyKey: /^portrait-/ })
  const ui = await $.ui.mount({ ...BIG, surface: 'terminal' })
  await clock.advance(600)
  await ui.redraw()
  expect(await ui.find({ key: 'portrait-1' })).toBeUndefined()
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
})

test('outside herdr, the newest project folders are scanned first, so recent sessions show at once', { options: { show: 'busy', desks: 'all', render: 'cells', style: 'detailed' } }, async ($, on) => {
  const old = Array.from({ length: 120 }, (_, i) => `-Users-me-old${i}`)
  const lists: Extra['lists'] = { '/h/.claude/projects': [...old, '-Users-me-fresh'].map(name => ({ name, kind: 'dir' as const, mtimeMs: 0 })) }
  lists['/h/.claude/projects/-Users-me-fresh'] = [{ name: 'abababab-7777-4777-8777-777777777777.jsonl', kind: 'file', mtimeMs: NOW - 30_000 }]
  on('fs.stat', ($, e) => ({ value: { kind: 'dir', size: 0, mtimeMs: e.path.endsWith('-fresh') ? NOW - 30_000 : NOW - 86_400_000, isLink: false } }))
  setup(on, () => 'missing', undefined, undefined, { lists })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'no herdr: 0 live sessions running this mod, 1 recent transcript' })).toBeDefined()
  expect((await ui.find({ key: 'desk-1' }))?.props).toMatchObject({ label: 'fresh' })
})

// ---- v8: fewer bigger desks, Claude Code's sessions, hybrid, words ------------------

import { activityFromTail, activityOfTool, bubbleFor, pageOf } from '../hooks/office-model.mjs'
import { claudeSessionPanes, isSessionRecord, statusOfRecord } from '../hooks/office-sessions.mjs'
import { paintRoomCanvas } from '../hooks/office-scene.mjs'

test('by default only Claude sessions get desks, at most 8, a page at a time', async ($, on) => {
  const { clock } = setup(on, () => ok(manyAgents(12, i => ['blocked', 'working', 'done', 'idle'][i % 4]!)))
  const ui = await $.ui.mount({ ...BIG, surface: 'terminal' })
  expect(await ui.find({ key: 'desk-8' })).toBeDefined()
  expect(await ui.find({ key: 'desk-9' })).toBeUndefined()
  // Needs you first: the three blocked desks lead.
  expect((await ui.find({ key: 'desk-1' }))?.props).toMatchObject({ label: 'agent-0' })
  expect((await ui.find({ key: 'page' }))?.props).toMatchObject({ hotkey: 'm', label: '+4 more (page 1/2)' })
  await ui.press({ key: 'page' })
  await ui.redraw()
  expect((await ui.find({ key: 'page' }))?.props).toMatchObject({ label: '+8 more (page 2/2)' })
  expect(await ui.find({ key: 'desk-5' })).toBeUndefined()
  void clock
})

test('show claude leaves out other agents and busy terminals; the order is needs you, working, done, idle', async () => {
  const { panes } = parsePaneList(PANE_LIST, SELF_PANE)
  const procs = { 'w4:p2': { isRunning: true, name: 'npm run dev' } }
  expect(buildDesks(panes!, procs).desks.map(d => d.name)).toEqual(['orch-benchy', 'orch-qube', 'Mods for Quicknode', 'Brief execution', 'orch-q', 'benchmark'])
  expect(buildDesks(panes!, procs, {}, 'busy').desks.some(d => d.kind === 'process')).toBe(true)
  const page = pageOf(buildDesks(panes!, procs).desks, 4, 1)
  expect([page.page, page.pages, page.desks.map(d => d.name)]).toEqual([1, 2, ['orch-q', 'benchmark']])
})

test('few desks in a big pane are drawn bigger, with big drag targets', async () => {
  const { panes } = parsePaneList(PANE_LIST, SELF_PANE)
  const { desks } = buildDesks(panes!)
  const big = planScene('office', desks, 187, 75, {}) as any
  expect(big.k >= 2).toBe(true)
  const hit = hitRects(big)[0]!
  expect(hit.width >= 30 && hit.height >= 14).toBe(true)
  const words = paintPlan(big, 1, 0)
  expect(words.length).toBe(big.columns * big.rows * 3)
})

test('bubbles say what each session is doing', async () => {
  expect(bubbleFor({ status: 'working', activity: 'thinking' } as any)?.text).toBe('Thinking...')
  expect(bubbleFor({ status: 'working', activity: 'coding' } as any)?.text).toBe('Coding...')
  expect(bubbleFor({ status: 'working' } as any)?.text).toBe('Working...')
  expect(bubbleFor({ status: 'blocked' } as any)?.text).toBe('Help please')
  expect(bubbleFor({ status: 'done' } as any)?.text).toBe('Done')
  expect(bubbleFor({ status: 'idle' } as any)).toBeNull()
  expect([activityOfTool('Edit'), activityOfTool('Bash'), activityOfTool('Read'), activityOfTool('Grep'), activityOfTool('Agent')]).toEqual(['coding', 'coding', 'reading', 'searching', 'delegating'])
  const tail = ['{"cut mid', JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '...' }] } }), JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', name: 'Edit' }] } })].join('\n')
  expect(activityFromTail(tail)).toBe('coding')
  expect(activityFromTail(tail.split('\n').slice(0, 2).join('\n'))).toBe('thinking')
})

test('a session running the mod records what it is doing', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/h', CLAUDE_CONFIG_DIR: '/h/.claude-work' })
  const writes: { state: string; activity: string | null }[] = []
  on('fs.write', ($, e) => {
    const v = JSON.parse(e.text)
    writes.push({ state: v.state, activity: v.activity })
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'ffffffff-6666-4666-8666-666666666666' }))
  on('session.cwd', () => ({ value: '/Users/me/Projects/qube' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', () => ({ cwd: '/work' }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.step', async function* ($, e) {
    yield { kind: 'thinking', index: 0, text: 'hmm' } as any
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null } as any
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-test', messageCount: 1 } as any)
  let step = await stream.next()
  while (step.done !== true) step = await stream.next()
  await $.tool.call({ tool: 'Edit', file_path: '/x', old_string: 'a', new_string: 'b' } as any)
  for (let i = 0; i < 10 && writes.length < 3; i++) await clock.advance(1)
  expect(writes.map(w => `${w.state}:${w.activity}`)).toEqual(['idle:null', 'working:thinking', 'working:coding'])
})

test('a working session in herdr without the mod: its activity comes from its transcript tail', async ($, on) => {
  const { calls } = setup(on)
  on('fs.stat', () => ({ value: { kind: 'file', size: 100, mtimeMs: NOW, isLink: false } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // One tail, for the one working session whose transcript was found.
  expect(calls.filter(a => a[0] === 'tail')).toEqual([['tail', '-c', '32768', '/h/.claude-work/projects/-Users-me-Projects/3f0c2a77-aaaa-4bbb-8ccc-000000000003.jsonl']])
  expect((await ui.find({ key: 'desk-2' }))?.props).toMatchObject({ label: 'orch-qube  Coding...' })
})

const RECORD = (pid: number, id: string, status: string, cwd: string) => JSON.stringify({ pid, sessionId: id, cwd, name: 'projects-16', nameSource: 'derived', status, updatedAt: NOW - 600_000, kind: 'interactive', entrypoint: 'cli' })

test('outside herdr, Claude Code session records are the source; the .key files are never read', async ($, on) => {
  const reads: string[] = []
  const ps: string[][] = []
  on('fs.read', ($, e) => {
    reads.push(e.path)
    const records: Record<string, string> = {
      '/h/.claude-work/sessions/111.json': RECORD(111, 'aaaaaaaa-1111-4111-8111-111111111111', 'busy', '/Users/me/Projects/qube'),
      '/h/.claude-work/sessions/222.json': RECORD(222, 'bbbbbbbb-2222-4222-8222-222222222222', 'idle', '/Users/me/Projects/web'),
      '/h/.claude-work/sessions/333.json': RECORD(333, 'cccccccc-3333-4333-8333-333333333333', 'waiting_for_permission', '/Users/me/Projects/api'),
      '/h/.claude-work/sessions/444.json': RECORD(444, 'dddddddd-4444-4444-8444-444444444444', 'busy', '/Users/me/Projects/gone'),
    }
    return records[e.path] !== undefined ? { value: records[e.path]! } : { deny: 'ENOENT' }
  })
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HERDR_PANE_ID: SELF_PANE, HOME: '/h', CLAUDE_CONFIG_DIR: '/h/.claude-work' })
  mock.store(on, {})
  quiet(on)
  const files = ['111.json', '111.key', '222.json', '222.key', '333.json', '444.json', 'notes.txt']
  on('fs.list', ($, e) => (e.path === '/h/.claude-work/sessions' ? { value: files.map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false })) } : { value: [] }))
  on('fs.exists', () => ({ value: false }))
  on('process.run', ($, e) => {
    if (e.argv[0] === 'herdr') return { deny: 'spawn herdr ENOENT' }
    if (e.argv[0] === 'ps') {
      ps.push([...e.argv])
      return { value: { exitCode: 0, stdout: '  111\n  222\n  333\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'no herdr: Claude Code sessions (3 running)' })).toBeDefined()
  expect((await ui.find({ key: 'desk-1' }))?.props).toMatchObject({ label: 'api' })
  expect((await ui.find({ key: 'desk-2' }))?.props).toMatchObject({ label: 'qube' })
  expect((await ui.find({ key: 'desk-3' }))?.props).toMatchObject({ label: 'web' })
  expect(await ui.find({ key: 'desk-4' })).toBeUndefined()
  expect(ps[0]).toEqual(['ps', '-o', 'pid=', '-p', '111,222,333,444'])
  expect(reads.some(r => r.endsWith('.key'))).toBe(false)
  expect(reads.every(r => r.endsWith('.json') || r.includes('office-atlas'))).toBe(true)
  expect([isSessionRecord('60659.json'), isSessionRecord('60659.key'), isSessionRecord('x.json')]).toEqual([true, false, false])
  expect([statusOfRecord('busy'), statusOfRecord('idle'), statusOfRecord('waiting_for_input')]).toEqual(['working', 'idle', 'blocked'])
  void clock
})

test('a record of a session that also runs the mod takes its richer state', async () => {
  const { panes } = claudeSessionPanes(
    [JSON.parse(RECORD(9, 'eeeeeeee-5555-4555-8555-555555555555', 'busy', '/x/qube'))],
    new Set([9]),
    NOW,
    null,
    [{ id: 'eeeeeeee-5555-4555-8555-555555555555', cwd: '/x/qube', project: 'qube', state: 'needs-you', helpers: 2, activity: null, lastSeen: NOW }],
  )
  expect(panes[0]).toMatchObject({ status: 'blocked', source: 'claude' })
})

test('hybrid: the cell room with each person a small picture, its background the room\'s own pixels', { options: { show: 'busy', desks: 'all', layout: 'office', render: 'hybrid' } }, async ($, on) => {
  setup(on, undefined, undefined, {})
  const ui = await $.ui.mount({ ...BIG, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  const portrait = await ui.find({ key: 'portrait-1' })
  expect(portrait).toBeDefined()
  const p = portrait!.props as { columns: number; rows: number; source: { png: string } }
  // A PNG, enlarged pixel for pixel: the box's half-cell size times a whole number.
  const bytes = Uint8Array.fromBase64(p.source.png)
  const width = new DataView(bytes.buffer).getUint32(16)
  const height = new DataView(bytes.buffer).getUint32(20)
  expect(width % p.columns === 0 && height % (p.rows * 2) === 0 && width / p.columns === height / (p.rows * 2)).toBe(true)
  expect(width / p.columns >= 4).toBe(true)
  // Unit: the picture's corner is the room's pixel under it.
  const { panes } = parsePaneList(PANE_LIST, SELF_PANE)
  const { desks } = buildDesks(panes!)
  const plan = planScene('office', desks, 200, 56, { hybrid: true }) as any
  const room = paintRoomCanvas(plan, 0, 0) as any
  const box = plan.portraits[0]
  const pic = characterBox(loadAtlas(ATLAS_JSON, atlasBytes()), plan.desks[box.index].seat, 'humans', 0, 0, false, box, room)
  // One pixel per half cell, the box's own size, and every corner the room's pixel beneath.
  expect([pic.w, pic.h]).toEqual([box.columns, box.rows * 2])
  for (const [x, y] of [[0, 0], [pic.w - 1, 0]] as const) expect(pic.px[y * pic.w + x]).toBe(room.px[(box.top * 2 + y) * room.w + box.left + x] & 0xffffff)
})

// ---- v9: sharp pictures ------------------------------------------------------------

test('a character picture is enlarged pixel for pixel into a small PNG', async () => {
  const atlas = loadAtlas(ATLAS_JSON, atlasBytes())
  const desk = { paneId: 'w1', sessionId: 's1-aaaaaaaa', status: 'working', name: 'x', kind: 'agent', look: 1 } as any
  for (const box of [{ left: 0, top: 0, columns: 24, rows: 12 }, { left: 0, top: 0, columns: 4, rows: 3 }, { left: 0, top: 0, columns: 36, rows: 18 }]) {
    const pic = characterBox(atlas, desk, 'humans', 1, 0, false, box, null)
    const f = sharpFactor(pic)
    const png = sharpPng(pic)
    const dv = new DataView(png.buffer)
    expect([dv.getUint32(16), dv.getUint32(20)]).toEqual([pic.w * f, pic.h * f])
    expect(f >= 4 && pic.w * f <= 2048).toBe(true)
    expect(png.length < 16_000).toBe(true)
  }
})

test('hybrid: where pictures draw their alt text, the office stays cells', { options: { show: 'busy', desks: 'all', layout: 'office', render: 'hybrid' } }, async ($, on) => {
  const { clock } = setup(on, undefined, undefined, { blitDeny: 'the Image draws its alt here', denyKey: /^portrait-/ })
  const ui = await $.ui.mount({ ...BIG, surface: 'terminal' })
  expect(await ui.find({ key: 'portrait-1' })).toBeDefined()
  await clock.advance(600)
  await ui.redraw()
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
})

test('render is cells or hybrid only', async () => {
  expect(OPTIONS.find(o => o.key === 'render')!.values).toEqual(['hybrid', 'cells'])
  expect(resolveOptions({ render: 'hd' }, {}).render).toBe('hybrid')
})

// ---- v10: the sidebar pane: drag mapping, packed seats, desk count, pictures ----------

const sized = (columns: number, rows: number) => ({ ...PANE, props: { ...PANE.props, bodyColumns: columns, scroll: { offset: 0, bodyRows: rows } } }) as const
const SIZES: [number, number][] = [[40, 40], [50, 40], [60, 44], [70, 44], [80, 46], [200, 60]]
const LAYOUTS = ['grid', 'tiles', 'office', 'war-room', 'strip'] as const
const tagBoxes = async (ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) => (await ui.findAll({ type: 'Box' })).filter(b => /^tag-\d+$/.test(String(b.props.key)))

for (const layout of LAYOUTS) {
  test(`drag and click hit the desk under the pointer, sidebar to full (${layout})`, { options: { show: 'busy', desks: 'all', render: 'cells', layout }, timeoutMs: 60000 }, async ($, on) => {
    const saved = new Map<string, unknown>()
    const { calls } = setup(on, () => ok(manyAgents(6, () => 'working')), saved)
    for (const [columns, rows] of SIZES) {
      saved.delete('sessions')
      const ui = await $.ui.mount({ ...sized(columns, rows), surface: 'terminal' })
      const raster = (await ui.find({ type: 'Raster' }))!
      const layer = (await ui.find({ key: 'drag' }))!
      // The drag layer lies exactly over the floor, and the floor fits the pane: nothing scrolls.
      expect(layer.props).toMatchObject({ width: raster.props.columns, height: raster.props.rows })
      expect([columns, raster.props.rows, raster.props.rows as number <= rows - 1]).toEqual([columns, raster.props.rows, true])
      const tags = await tagBoxes(ui)
      expect([columns, "tags", tags.length >= 1]).toEqual([columns, "tags", true])
      const hits = (layer.props as { props: { hits: [number, number, number, number, string, number][] } }).props.hits
      // A click at the middle of each name tag jumps to that very desk.
      for (const tag of tags) {
        const n = Number(String(tag.props.key).slice(4))
        const name = hits.find(h => h[5] === n - 1)![4]
        const k = Number(name.match(/agent-(\d)/)![1])
        const at = { x: (tag.props.left as number) + Math.floor((tag.props.width as number) / 2), y: tag.props.top as number }
        calls.length = 0
        await ui.pointer({ type: 'down', ...at, button: 'left', in: 'drag' })
        await ui.pointer({ type: 'up', ...at, button: 'left', in: 'drag' })
        expect([columns, n, calls.at(-1)]).toEqual([columns, n, ['herdr', 'agent', 'focus', `w${k}:p1`]])
      }
      // Dragging the last desk's tag onto the first's moves it to the first place.
      if (tags.length >= 2) {
        const last = tags.at(-1)!
        const first = tags[0]!
        const lastLabel = String((await ui.find({ key: `desk-${String(last.props.key).slice(4)}` }))!.props.label)
        expect(lastLabel.length > 0).toBe(true)
        const from = { x: (last.props.left as number) + 1, y: last.props.top as number }
        const to = { x: (first.props.left as number) + 1, y: first.props.top as number }
        await ui.pointer({ type: 'down', ...from, button: 'left', in: 'drag' })
        await ui.pointer({ type: 'move', ...to, button: 'left', in: 'drag' })
        await ui.pointer({ type: 'up', ...to, button: 'left', in: 'drag' })
        await ui.redraw()
        expect([columns, (await ui.find({ key: 'desk-1' }))?.props.label]).toEqual([columns, lastLabel])
        expect(Object.values(saved.get('sessions') as object)).toEqual([{ seat: 1 }])
      }
      await ui.unmount()
    }
  })
}

test('old absolute seats are dropped once; names stay; nobody sits in a far row', { options: { show: 'busy', desks: 'all', render: 'cells', layout: 'office' } }, async ($, on) => {
  const saved = new Map<string, unknown>([['sessions', { 's:sess-1-aaaaaaaa': { seat: 25, label: 'Bob' }, 's:sess-2-aaaaaaaa': { seat: 49 } }]])
  setup(on, () => ok(manyAgents(5, () => 'working')), saved)
  const ui = await $.ui.mount({ ...sized(60, 44), surface: 'terminal' })
  expect(saved.get('sessions')).toEqual({ 's:sess-1-aaaaaaaa': { label: 'Bob' } })
  expect(saved.get('seatingVersion')).toBe(2)
  // Five desks, five drag targets: no empty desk anywhere.
  const hits = ((await ui.find({ key: 'drag' }))!.props as { props: { hits: unknown[][] } }).props.hits
  expect(hits.length).toBe(5)
  expect(hits.some(h => h[4] === 'empty desk')).toBe(false)
  expect(await ui.find({ key: 'tag-6' })).toBeUndefined()
})

for (const render of ['hybrid', 'cells'] as const) {
  for (const layout of LAYOUTS) {
    for (const size of [sized(64, 46), BIG]) {
      test(`the desk count caps the drawn desks: ${layout}, ${render}, ${size.props.bodyColumns} columns`, { options: { show: 'busy', desks: '4', render, layout } }, async ($, on) => {
        setup(on, () => ok(manyAgents(12, () => 'working')), undefined, {})
        const ui = await $.ui.mount({ ...size, surface: 'terminal' })
        expect((await tagBoxes(ui)).length).toBe(4)
        expect((await ui.find({ key: 'page' }))?.props).toMatchObject({ hotkey: 'm', label: '+8 more (page 1/3)' })
        // d: 4 becomes 6, in the header and in what is drawn.
        await ui.press({ key: 'view-desks' })
        await ui.redraw()
        expect((await tagBoxes(ui)).length).toBe(6)
        await ui.press({ key: 'page' })
        await ui.redraw()
        expect((await ui.find({ key: 'page' }))?.props).toMatchObject({ label: '+6 more (page 2/2)' })
      })
    }
  }
}

test('a changed userConfig desk count is not hidden by an old stored one', { options: { show: 'busy', desks: '4', render: 'cells', layout: 'office' } }, async ($, on) => {
  // Stored 'all' while the config said 'all'; the config now says 4.
  const saved = new Map<string, unknown>([['options', { desks: 'all' }], ['optionsConfig', { show: 'busy', desks: 'all', render: 'cells', layout: 'office' }]])
  setup(on, () => ok(manyAgents(12, () => 'working')), saved)
  const ui = await $.ui.mount({ ...BIG, surface: 'terminal' })
  expect((await tagBoxes(ui)).length).toBe(4)
})

test('hybrid pictures show in a sidebar pane too, and the header says why when they cannot', { options: { show: 'busy', desks: 'all', render: 'hybrid', layout: 'office', characters: 'mixed', style: 'detailed' } }, async ($, on) => {
  setup(on, () => ok(manyAgents(6, () => 'working')), undefined, {})
  for (const [columns, rows] of [[60, 44], [64, 46], [80, 46]] as const) {
    const ui = await $.ui.mount({ ...sized(columns, rows), surface: 'terminal' })
    expect([columns, Boolean(await ui.find({ key: 'portrait-1' }))]).toEqual([columns, true])
    expect(await ui.find({ type: 'Text', text: /pictures off/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('pictures off: the header gives the reason', { options: { show: 'busy', desks: 'all', render: 'hybrid', layout: 'office' } }, async ($, on) => {
  const { clock } = setup(on, () => ok(manyAgents(6, () => 'working')), undefined, { blitDeny: 'the Image draws its alt here', denyKey: /^portrait-/ })
  const ui = await $.ui.mount({ ...sized(64, 46), surface: 'terminal' })
  await clock.advance(600)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /pictures off: this terminal draws no images/ })).toBeDefined()
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
})


// ---- demo mode ---------------------------------------------------------------------------

test('the demo timeline: who does what at which second, on a 60-second loop', async () => {
  const at = (sec: number, name: string) => demoPanes(sec * 1000).panes.find(p => p.name === name)!
  expect(DEMO_NAMES).toEqual(['api-refactor', 'docs-site', 'bug-triage', 'release-notes', 'test-suite', 'db-migration', 'security-review', 'onboarding'])
  expect(DEMO_LOOP_MS).toBe(60_000)
  // Working, with changing bubbles.
  expect([0, 9, 15, 21, 31].map(t => at(t, 'api-refactor').activity)).toEqual(['coding', 'reading', 'thinking', 'coding', 'writing'])
  expect(at(13, 'docs-site').activity).toBe('searching')
  // Needs you from 15 s to 27 s, then back to work.
  expect([14, 15, 26, 27].map(t => at(t, 'bug-triage').status)).toEqual(['working', 'blocked', 'blocked', 'working'])
  // Finishes at 30 s, looked at 40 s.
  expect([29, 30, 39, 40].map(t => [at(t, 'release-notes').status, at(t, 'release-notes').isFocused])).toEqual([['working', false], ['done', false], ['done', false], ['done', true]])
  // Helpers: 3, then 2, then none.
  expect([5, 35, 50].map(t => demoPanes(t * 1000).helpers['demo-7-security-review'] ?? 0)).toEqual([3, 2, 0])
  expect(at(5, 'security-review').activity).toBe('delegating')
  // Idle ones, and db-migration waking up from 20 s to 46 s.
  expect([0, 30, 59].map(t => at(t, 'onboarding').status)).toEqual(['idle', 'idle', 'idle'])
  expect([10, 25, 50].map(t => at(t, 'db-migration').status)).toEqual(['idle', 'working', 'idle'])
  // The crown on one, and the loop repeats exactly.
  expect(demoPanes(0).panes.filter(p => p.isSelf).map(p => p.name)).toEqual(['api-refactor'])
  expect(demoPanes(75_000)).toEqual(demoPanes(15_000))
})

test('demo mode (OFFICE_DEMO=1) never calls herdr, says demo, celebrates and settles, and a jump only toasts', { options: { desks: 'all', render: 'cells', layout: 'grid' }, timeoutMs: 60000 }, async ($, on) => {
  const { calls, clock, toasts } = setup(on, undefined, undefined, undefined, { env: { OFFICE_DEMO: '1' } })
  const ui = await $.ui.mount({ ...BIG, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: ' demo ' })).toBeDefined()
  expect((await ui.find({ key: 'desk-1' }))?.props.label).toBeDefined()
  const labels = async () => (await tagBoxes(ui)).length
  expect(await labels()).toBe(8)
  // 16 s in: bug-triage needs you, first in the order, with a toast.
  await clock.advance(16_000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /1 needs you/ })).toBeDefined()
  expect(toasts).toContain('bug-triage needs you')
  // 31 s: release-notes done and celebrating; 41 s: looked at, settled.
  await clock.advance(15_000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /1 done/ })).toBeDefined()
  // A desk's key toasts instead of jumping.
  await ui.press({ key: 'desk-1' })
  expect(toasts.at(-1)).toMatch(/^demo: would jump to /)
  await clock.advance(30_000)
  await ui.redraw()
  expect(calls.filter(c => c[0] === 'herdr')).toEqual([])
  expect(calls.filter(c => c[0] === 'tail' || c[0] === 'ps')).toEqual([])
})

test('demo mode: drag reorders the demo desks, kept out of the store', { options: { desks: 'all', render: 'cells', layout: 'office' } }, async ($, on) => {
  const saved = new Map<string, unknown>()
  setup(on, undefined, saved, undefined, { env: { OFFICE_DEMO: '1' } })
  const ui = await $.ui.mount({ ...BIG, surface: 'terminal' })
  const tags = await tagBoxes(ui)
  const last = tags.at(-1)!
  const first = tags[0]!
  const lastLabel = (await ui.find({ key: `desk-${String(last.props.key).slice(4)}` }))!.props.label
  await ui.pointer({ type: 'down', x: (last.props.left as number) + 1, y: last.props.top as number, button: 'left', in: 'drag' })
  await ui.pointer({ type: 'move', x: (first.props.left as number) + 1, y: first.props.top as number, button: 'left', in: 'drag' })
  await ui.pointer({ type: 'up', x: (first.props.left as number) + 1, y: first.props.top as number, button: 'left', in: 'drag' })
  await ui.redraw()
  expect((await ui.find({ key: 'desk-1' }))?.props.label).toBe(lastLabel)
  // Nothing of the demo's reaches the store: no pins, no seats.
  expect(Object.keys((saved.get('sessions') ?? {}) as object)).toEqual([])
  expect(saved.has('seats')).toBe(false)
})

test('/office demo toggles demo mode, the loop starting at 0 each time', { options: { desks: 'all', render: 'cells', layout: 'grid' } }, async ($, on) => {
  const { calls } = setup(on)
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect((await $.command.run({ ...RUN, args: 'demo' })).text).toMatch(/demo mode on/)
  calls.length = 0
  const ui = await $.ui.mount({ ...BIG, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: ' demo ' })).toBeDefined()
  expect(calls.filter(c => c[0] === 'herdr')).toEqual([])
  expect((await $.command.run({ ...RUN, args: 'demo' })).text).toBe('Office demo mode off.')
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: ' demo ' })).toBeUndefined()
  expect(calls.some(c => c[0] === 'herdr')).toBe(true)
})
