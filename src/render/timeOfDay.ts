/**
 * Time of day: one clock that every atmospheric system reads.
 *
 * `hour` runs 0..24 and advances in real time (a full day takes `dayMinutes`). Keyframes below
 * describe how the world looks at a few moments; everything between is interpolated. Worlds keep
 * their own identity because the keyframes *tint* the world palette rather than replacing it.
 */
import * as THREE from 'three'

export interface TimeKey {
  h: number
  /** multiplies the world's sky/horizon colours */
  mul: number
  /** colour the sky is pulled toward, and how far */
  tint: string
  tintAmount: number
  /** horizon glow around the sun at dawn and dusk */
  glow: string
  glowAmount: number
  /** directional light (sun by day, moon by night) */
  sun: string
  sunI: number
  /** hemisphere fill */
  ambSky: string
  ambGround: string
  ambI: number
  /** 0..1 star and moon visibility */
  stars: number
  /** 0..1 how strongly lamps, windows and crystals glow */
  lamp: number
}

const KEYS: TimeKey[] = [
  { h: 0.0, mul: 0.16, tint: '#0a1030', tintAmount: 0.86, glow: '#1b2a5c', glowAmount: 0.3, sun: '#8fa6e0', sunI: 0.5, ambSky: '#2a3a6e', ambGround: '#141a2e', ambI: 0.7, stars: 1, lamp: 1 },
  { h: 4.6, mul: 0.18, tint: '#101a40', tintAmount: 0.82, glow: '#33407a', glowAmount: 0.4, sun: '#93a8de', sunI: 0.5, ambSky: '#32406f', ambGround: '#171d33', ambI: 0.72, stars: 0.95, lamp: 1 },
  { h: 5.8, mul: 0.4, tint: '#4a4a86', tintAmount: 0.6, glow: '#c86a5a', glowAmount: 0.8, sun: '#c98a72', sunI: 0.8, ambSky: '#6d6aa0', ambGround: '#3a3448', ambI: 0.85, stars: 0.45, lamp: 0.85 },
  { h: 6.8, mul: 0.78, tint: '#f0a070', tintAmount: 0.4, glow: '#ff9a52', glowAmount: 1.0, sun: '#ffb070', sunI: 1.9, ambSky: '#bcb8d8', ambGround: '#6a5a52', ambI: 0.95, stars: 0, lamp: 0.45 },
  { h: 8.5, mul: 0.97, tint: '#ffe6c8', tintAmount: 0.12, glow: '#ffd2a0', glowAmount: 0.35, sun: '#ffe6bc', sunI: 2.5, ambSky: '#cfe6ff', ambGround: '#8a7a5a', ambI: 1.0, stars: 0, lamp: 0 },
  { h: 12.0, mul: 1.0, tint: '#ffffff', tintAmount: 0.0, glow: '#ffe9c4', glowAmount: 0.15, sun: '#fff4dc', sunI: 2.8, ambSky: '#cfe6ff', ambGround: '#8a7a5a', ambI: 1.0, stars: 0, lamp: 0 },
  { h: 16.0, mul: 0.98, tint: '#ffedd2', tintAmount: 0.1, glow: '#ffd8a8', glowAmount: 0.3, sun: '#ffe9c4', sunI: 2.6, ambSky: '#cfe6ff', ambGround: '#8a7a5a', ambI: 1.0, stars: 0, lamp: 0 },
  { h: 18.6, mul: 0.82, tint: '#ffb682', tintAmount: 0.34, glow: '#ff9a4a', glowAmount: 0.95, sun: '#ffb264', sunI: 2.0, ambSky: '#d8c0c8', ambGround: '#7a5f4a', ambI: 0.95, stars: 0, lamp: 0.3 },
  { h: 19.8, mul: 0.56, tint: '#d9683f', tintAmount: 0.55, glow: '#ff6a32', glowAmount: 1.0, sun: '#ff7a45', sunI: 1.15, ambSky: '#a88098', ambGround: '#5a4450', ambI: 0.9, stars: 0.15, lamp: 0.6 },
  { h: 20.9, mul: 0.3, tint: '#2e2a60', tintAmount: 0.74, glow: '#6a4a90', glowAmount: 0.6, sun: '#8a76c0', sunI: 0.6, ambSky: '#4a4a82', ambGround: '#26253c', ambI: 0.8, stars: 0.6, lamp: 0.95 },
  { h: 22.2, mul: 0.16, tint: '#0a1030', tintAmount: 0.86, glow: '#1b2a5c', glowAmount: 0.3, sun: '#8fa6e0', sunI: 0.5, ambSky: '#2a3a6e', ambGround: '#141a2e', ambI: 0.7, stars: 1, lamp: 1 },
]

/** Live clock. Mutated by the DayNight component; read by everything else. */
/** Fog / background colour for the current hour, written by DayNight and read by the water shaders. */
export const FOG_COLOR = new THREE.Color('#e7f0f6')
/** Fog start/end for the current hour and weather, for shaders that do their own fogging. */
export const fogRange = { near: 160, far: 620 }

export const timeState = {
  hour: 9.5,
  /** real minutes for a full 24 h cycle */
  dayMinutes: 12,
  paused: false,
  /** 1 while the sun is above the horizon, 0 at night (smoothed) */
  day: 1,
  /** 0..1 lamp/emissive strength, from the keyframes */
  lamp: 0,
  /** multiplier applied to unlit "glow" materials */
  emissive: 2.4,
  /** 0..1 overall daylight level, for surfaces that are not lit by the scene lights (water) */
  lightMul: 1,
  /** 0..1 how overcast it is, from the weather; surfaces that are not lit by the scene lights read it */
  gloom: 0,
}
if (import.meta.env.DEV) (window as unknown as { __time: unknown }).__time = timeState

/** Interpolated look at the current hour. Reused object: do not keep references to the colours. */
export interface SkyLook {
  mul: number
  tint: THREE.Color
  tintAmount: number
  glow: THREE.Color
  glowAmount: number
  sun: THREE.Color
  sunI: number
  ambSky: THREE.Color
  ambGround: THREE.Color
  ambI: number
  stars: number
  lamp: number
}

const look: SkyLook = {
  mul: 1,
  tint: new THREE.Color(),
  tintAmount: 0,
  glow: new THREE.Color(),
  glowAmount: 0,
  sun: new THREE.Color(),
  sunI: 1,
  ambSky: new THREE.Color(),
  ambGround: new THREE.Color(),
  ambI: 1,
  stars: 0,
  lamp: 0,
}
const cA = new THREE.Color()
const cB = new THREE.Color()

const wrap24 = (h: number) => ((h % 24) + 24) % 24

export function sampleSky(hour: number): SkyLook {
  const h = wrap24(hour)
  let a = KEYS[KEYS.length - 1]
  let b = KEYS[0]
  for (let i = 0; i < KEYS.length; i++) {
    if (KEYS[i].h <= h && (i === KEYS.length - 1 || KEYS[i + 1].h > h)) {
      a = KEYS[i]
      b = KEYS[(i + 1) % KEYS.length]
      break
    }
  }
  let span = b.h - a.h
  if (span <= 0) span += 24
  let t = (h - a.h) / span
  if (h < a.h) t = (h + 24 - a.h) / span
  t = Math.min(1, Math.max(0, t))
  t = t * t * (3 - 2 * t) // ease so keyframes do not snap
  const mix = (ka: string, kb: string, out: THREE.Color) => out.copy(cA.set(ka)).lerp(cB.set(kb), t)
  const num = (x: number, y: number) => x + (y - x) * t
  look.mul = num(a.mul, b.mul)
  mix(a.tint, b.tint, look.tint)
  look.tintAmount = num(a.tintAmount, b.tintAmount)
  mix(a.glow, b.glow, look.glow)
  look.glowAmount = num(a.glowAmount, b.glowAmount)
  mix(a.sun, b.sun, look.sun)
  look.sunI = num(a.sunI, b.sunI)
  mix(a.ambSky, b.ambSky, look.ambSky)
  mix(a.ambGround, b.ambGround, look.ambGround)
  look.ambI = num(a.ambI, b.ambI)
  look.stars = num(a.stars, b.stars)
  look.lamp = num(a.lamp, b.lamp)
  return look
}

/**
 * Sun direction for an hour: rises in the east, sets in the west, tilted a little south so the
 * light rakes across the land instead of standing straight overhead at noon.
 */
export function sunDirection(hour: number, out: THREE.Vector3): THREE.Vector3 {
  const a = ((wrap24(hour) - 6) / 12) * Math.PI // 0 at sunrise, PI/2 at noon, PI at sunset
  return out.set(Math.cos(a), Math.sin(a), 0.32 * Math.sin(a) + 0.12).normalize()
}

export const PRESETS: [string, number][] = [
  ['Dawn', 6.4],
  ['Noon', 12],
  ['Dusk', 19.6],
  ['Night', 23],
]

export function formatClock(hour: number): string {
  const h = wrap24(hour)
  const hh = Math.floor(h)
  const mm = Math.floor((h - hh) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function setHour(h: number) {
  timeState.hour = wrap24(h)
}
export function advanceHours(d: number) {
  timeState.hour = wrap24(timeState.hour + d)
}
