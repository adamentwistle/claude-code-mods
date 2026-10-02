// Types for office-model.mjs, so the tests type-check against it.
export type DeskStatus = 'blocked' | 'working' | 'running' | 'idle' | 'unknown' | 'done'

export type Pane = {
  paneId: string
  tabId: string
  workspaceId: string
  agent: string | null
  status: DeskStatus
  name: string
  cwd: string
  sessionId: string | null
  isSelf: boolean
  order: number
}

export type Desk = Pane & {
  kind: 'agent' | 'process' | 'shell'
  project?: string
  character?: string
  pin?: number
  changedAt?: number
  prevStatus?: DeskStatus | null
  unseenDone?: boolean
  isFocused?: boolean
  detail: string
  helpers: number
  look: number
}

export type ProcessInfo = { isRunning: boolean; name: string }

export type Scale = { name: 'large' | 'normal' | 'compact'; pw: number; ph: number; k: number; tagRows: number }

export type Layout = {
  scale: Scale
  tileW: number
  tileH: number
  artRows: number
  shown: number
  perRow: number
  deskRows: number
  columns: number
  rows: number
}

export const GAP: number
export const MAX_PER_ROW: number
export const SCALES: Record<Scale['name'], Scale>
export const STATUSES: DeskStatus[]
export const STATUS_WORD: Record<DeskStatus, string>
export const ACCENT: Record<DeskStatus, number>
export const TAG_BG: Record<DeskStatus, number>
export const HOTKEYS: string[]

export function statusOf(raw: unknown): DeskStatus
export function shortName(pane: { name?: unknown; title?: unknown; cwd?: unknown; pane_id?: unknown }): string
export function hash(text: string): number
export function parsePaneList(stdout: string, selfPaneId: string | null | undefined): { panes?: Pane[]; error?: string }
export function parseProcessInfo(stdout: string): ProcessInfo
export function projectDirName(cwd: string): string
export function countActiveSubagents(entries: readonly { name: string; kind: string; mtimeMs: number }[], now: number, windowMs?: number): number
export function buildDesks(panes: readonly Pane[], procs?: Record<string, ProcessInfo>, helpers?: Record<string, number>, show?: string): { desks: Desk[]; idleShells: number }
export function tally(desks: readonly Desk[]): Record<DeskStatus, number>
export function layoutFor(count: number, bodyColumns: number, bodyRows: number, options?: { isFull?: boolean }): Layout
export function tagPlace(layout: Layout, i: number): { left: number; top: number }
export function tagLines(desk: Desk, i: number, width: number): { hotkey: string | undefined; label: string; first: string; second: string }
export function paintWords(layout: Layout, desks: readonly (Desk | null)[], tick: number, opts?: object): Uint32Array
export function paintFrame(layout: Layout, desks: readonly (Desk | null)[], tick: number, opts?: object): string
export function toBase64(bytes: Uint8Array): string

export type Options = {
  layout: 'grid' | 'tiles' | 'office' | 'war-room' | 'strip'
  characters: 'humans' | 'robots' | 'critters' | 'animals' | 'mixed'
  style: 'bold' | 'detailed'
  lighting: 'clock' | 'day' | 'night'
  palette: 'nightshade' | 'warm' | 'cool' | 'mono'
  show: 'claude' | 'agents' | 'busy' | 'all'
  desks: 4 | 6 | 8 | 12 | 'all'
  render: 'hybrid' | 'cells'
  hideDoneMinutes: number
  seating: 'stable' | 'state' | 'project' | 'workspace'
  speed: 'slow' | 'normal' | 'fast'
  reducedMotion: boolean
  notify: 'needs-you' | 'changes' | 'off'
  sound: boolean
}
export type OptionSpec = { key: keyof Options; field: string; title: string; values: readonly (string | number | boolean)[]; fallback: string | number | boolean; hotkey: string }
export const OPTIONS: OptionSpec[]
export const FRAME_MS: Record<string, number>
export const CHARACTER_KINDS: string[]
export function resolveOptions(userConfig?: Record<string, unknown>, stored?: Record<string, unknown>): Options
export function cycleOption(options: Options, key: keyof Options): Options
export function deskKey(desk: { sessionId?: string | null; paneId: string }): string
export function applyOverrides<T extends Desk>(desks: readonly T[], overrides?: Record<string, { label?: string; character?: string; seat?: number }>): T[]
export function trackChanges<T extends Desk>(desks: readonly T[], memory?: Record<string, unknown>, now?: number, unseen?: Record<string, number>): { desks: (T & { unseenDone: boolean })[]; memory: Record<string, { status: string; at: number; prev: string | null; unseen: boolean }>; changes: { desk: T; from: string; to: string }[]; unseen: Record<string, number> }
export function hideStaleDone<T extends Desk>(desks: readonly T[], minutes: number, now: number): T[]
export function seatDesks<T extends Desk>(desks: readonly T[], mode?: string, seats?: Record<string, { seat: number; seen: number }>, now?: number): { seats: T[]; memory: Record<string, { seat: number; seen: number }> }
export function kindFor(desk: Partial<Desk>, characters?: string): string
export const VIEW_KEYS: Record<string, keyof Options>
export function busyFromTitle(title: string): ProcessInfo
export function rankOf(desk: Partial<Desk>): number
export const ACTIVITY_WORDS: Record<string, string>
export function bubbleFor(desk: Partial<Desk> & { activity?: string | null }): { text: string; tone: 'alert' | 'work' | 'party' | 'quiet' } | null
export function activityOfTool(tool: string): string | null
export function activityFromTail(text: string): string | null
export function pageOf<T extends Desk>(desks: readonly T[], size: number | string, page?: number, isOrdered?: boolean): { desks: T[]; page: number; pages: number; total: number }
