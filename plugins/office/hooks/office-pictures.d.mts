// Types for office-pictures.mjs, so the tests type-check against it.
import type { Desk } from './office-model.mjs'

export type Atlas = { width: number; height: number; idx: Uint8Array; rgb: number[]; sprites: Record<string, [number, number, number, number]> }
export type SmallPicture = { w: number; h: number; px: Int32Array }
export type Box = { left: number; top: number; columns: number; rows: number }

export function loadAtlas(json: string | object, bytes: Uint8Array): Atlas
export function pictureLook(desk: Partial<Desk>, characters?: string): { kind: string; layers: string[] }
export function characterBox(atlas: Atlas, desk: Desk, characters: string, tick: number, nowMs: number, reducedMotion: boolean, box: Box, bg: { w: number; h: number; px: Uint32Array } | null, fill?: number): SmallPicture
export function portraitMoves(desk: Desk | null, reducedMotion?: boolean): boolean
export function sharpFactor(pic: SmallPicture): number
export function sharpPng(pic: SmallPicture, factor?: number): Uint8Array
