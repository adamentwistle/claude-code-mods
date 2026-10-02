// Types for office-sessions.mjs, so the tests type-check against it.
export type RegistryEntry = { id: string; cwd: string; project: string; state: string; helpers: number; activity?: string | null; lastSeen: number }
export type Recent = { id: string; dir: string; mtimeMs: number }
export type SessionPane = {
  paneId: string
  tabId: string
  workspaceId: string
  agent: string
  status: string
  name: string
  cwd: string
  sessionId: string
  isSelf: boolean
  isFocused: boolean
  order: number
  source: 'registry' | 'transcript'
  projectDir?: string
  terminalTitle: string
}

export const REGISTRY_TTL_MS: number
export const HEARTBEAT_MS: number
export const RECENT_MS: number
export function registryDir(root: string): string
export function projectFromDir(dir: string): string
export function registryEntry(args: { id: string; cwd: string; state: string; helpers?: number; activity?: string | null; now: number }): RegistryEntry
export function liveEntries(texts: readonly string[], now: number): RegistryEntry[]
export function sessionPanes(entries: readonly RegistryEntry[], recent: Iterable<Recent>, now: number, selfId: string | null): { panes: SessionPane[]; helpers: Record<string, number> }
export function recentTranscripts(dir: string, entries: readonly { name: string; kind: string; mtimeMs: number }[], now: number): Recent[]
export function resumeHint(desk: { sessionId: string; cwd?: string; projectDir?: string }): { text: string; where: string }
export function isSessionRecord(name: string): boolean
export function recordPids(records: readonly { pid?: unknown }[]): number[]
export function alivePids(stdout: string | undefined): Set<number>
export function statusOfRecord(status: string): string
export function claudeSessionPanes(records: readonly Record<string, unknown>[], alive: Set<number>, now: number, selfId: string | null, entries?: readonly RegistryEntry[]): { panes: (SessionPane & { activity: string | null })[]; helpers: Record<string, number> }
