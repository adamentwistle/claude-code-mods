export const DEMO_LOOP_MS: number
export const DEMO_NAMES: string[]
export type DemoPane = {
  paneId: string
  tabId: string
  workspaceId: string
  agent: string
  status: 'working' | 'blocked' | 'done' | 'idle'
  name: string
  cwd: string
  sessionId: string
  isSelf: boolean
  isFocused: boolean
  order: number
  activity: string | null
  character?: string
}
export function demoPanes(elapsedMs: number, characters?: string): { panes: DemoPane[]; helpers: Record<string, number>; second: number }
