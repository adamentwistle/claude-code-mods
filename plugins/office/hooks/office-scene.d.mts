// Types for office-scene.mjs, so the tests type-check against it.
import type { Desk, Layout } from './office-model.mjs'

export type SceneTag = { index: number; left: number; top: number; width: number; hotkey?: string; label: string; first: string; second?: string }
export type ScenePlan = { layout: string; columns: number; rows: number; tags: SceneTag[]; seats: readonly (Desk | null)[]; grid?: Layout; size?: string; [more: string]: unknown }
export type SceneOptions = { isFull?: boolean; lighting?: string; palette?: string; characters?: string; style?: string; portraits?: boolean; reducedMotion?: boolean; zoneBy?: string; hybrid?: boolean }

export const CHARACTER_KINDS: string[]
export function kindFor(desk: Partial<Desk>, characters?: string): string
export function lookFor(desk: Partial<Desk>, characters?: string): { kind: string }
export function lightingHour(lighting: string, nowMs: number): number
export function poseFor(desk: Desk, nowMs: number, reducedMotion?: boolean): string
export function planScene(layout: string, seats: readonly (Desk | null)[], cols: number, rows: number, opts?: SceneOptions): ScenePlan
export type HitRect = { index: number; left: number; top: number; width: number; height: number }
export function hitRects(plan: ScenePlan): HitRect[]
export function seatAt(plan: ScenePlan, x: number, y: number): number
export function paintPlan(plan: ScenePlan, tick: number, nowMs?: number): Uint32Array
export class Canvas {
  constructor(w: number, h: number, fill?: number)
  w: number
  h: number
  pack(): Uint32Array
}
export function screenPixels(...args: unknown[]): void
export function paintRoomCanvas(plan: ScenePlan, tick: number, nowMs: number): Canvas & { px: Uint32Array }
export function bubbleSpots(plan: ScenePlan): { index: number; col: number; row: number; text: string; tone: string }[]
