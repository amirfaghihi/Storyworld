import * as THREE from 'three'
import { BIOME } from '@/world/biomes'

export interface Palette {
  water: THREE.Color
  waterDeep: THREE.Color
  sand: THREE.Color
  grass: THREE.Color
  grassDry: THREE.Color
  grassLush: THREE.Color
  meadow: THREE.Color
  forest: THREE.Color
  forestDark: THREE.Color
  rock: THREE.Color
  rockWarm: THREE.Color
  snow: THREE.Color
  ash: THREE.Color
  ashPurple: THREE.Color
  marsh: THREE.Color
  road: THREE.Color
}

export function makePalette(p: Record<string, string>): Palette {
  const c = (k: string, fallback: string) => new THREE.Color(p[k] ?? fallback)
  return {
    water: c('water', '#4d8fd6'),
    waterDeep: c('waterDeep', '#2c5fa8'),
    sand: c('sand', '#e6d3a0'),
    grass: c('grass', '#7fb85a'),
    grassDry: c('grassDry', '#b8b95a'),
    grassLush: c('grassLush', '#4f9a5c'),
    meadow: c('meadow', '#9ccd5e'),
    forest: c('forest', '#3f8a46'),
    forestDark: c('forestDark', '#2f6a44'),
    rock: c('rock', '#8d8478'),
    rockWarm: c('rockWarm', '#a68b6a'),
    snow: c('snow', '#f4f4f8'),
    ash: c('ash', '#5b524f'),
    ashPurple: c('ashPurple', '#6a5a6e'),
    marsh: c('marsh', '#6f8f5a'),
    road: c('road', '#c9b48a'),
  }
}

/** Cheap deterministic hash in [0, 1). */
export function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967296
}

const tmp = new THREE.Color()
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

import type { Mood } from '@/vegetation/mood'

export interface FaceInput {
  biome: number
  /** forest mood at this face (tints the forest floor) */
  mood?: Mood
  h: number
  slope: number
  rnd: number // per-face random 0..1
  patch: number // large-scale noise -1..1 (colour regions ~100 m)
  detail: number // mid-scale noise -1..1 (~25 m)
  seaLevel: number
}

/**
 * Colour for one terrain face. Large-scale `patch` noise gives meadows, dry grass and lush
 * valleys their own hue so the landscape is not one flat green.
 */
export function faceColor(out: THREE.Color, pal: Palette, f: FaceInput): THREE.Color {
  const { biome, h, slope, rnd, patch, detail, seaLevel } = f
  const p01 = patch * 0.5 + 0.5
  const d01 = detail * 0.5 + 0.5
  switch (biome) {
    case BIOME.water: {
      out.copy(pal.sand).lerp(tmp.copy(pal.waterDeep).multiplyScalar(0.55), smooth(0, 9, seaLevel - h))
      break
    }
    case BIOME.riverbed:
      out.copy(pal.water).lerp(pal.waterDeep, 0.25 + (rnd - 0.5) * 0.2)
      break
    case BIOME.sand:
      out.copy(pal.sand).lerp(pal.grassDry, d01 * 0.25)
      break
    case BIOME.grass: {
      // three grass hues blended by the patch noise, then height dries it out
      if (patch < 0) out.copy(pal.grass).lerp(pal.grassLush, -patch)
      else out.copy(pal.grass).lerp(pal.meadow, patch)
      out.lerp(pal.grassDry, smooth(16, 48, h) * 0.75 + d01 * 0.22 + (rnd - 0.5) * 0.12)
      if (slope > 0.5) out.lerp(pal.rock, smooth(0.5, 1.1, slope))
      break
    }
    case BIOME.forest: {
      out.copy(pal.forest).lerp(pal.forestDark, p01 * 0.7).lerp(pal.grass, d01 * 0.3 + (rnd - 0.5) * 0.15)
      // leaf litter under the canopy
      out.lerp(tmp.set('#5a4a30'), 0.18 + rnd * 0.12)
      const m = f.mood
      if (m) {
        out.multiplyScalar(m.floor.mul)
        if (m.floor.amount > 0) out.lerp(tmp.set(m.floor.tint), m.floor.amount)
      }
      break
    }
    case BIOME.rock: {
      out.copy(pal.rock).lerp(pal.rockWarm, p01 * 0.8)
      // strata: darker bands every few metres, stronger on steep faces
      const band = 0.5 + 0.5 * Math.sin(h * 0.55 + detail * 2.5)
      out.multiplyScalar(1 - band * 0.16 * smooth(0.3, 1.2, slope))
      // cliffs go cooler and darker
      out.lerp(tmp.set('#5a5c66'), smooth(0.9, 2.0, slope) * 0.55)
      out.lerp(tmp.copy(out).multiplyScalar(0.7), smooth(0.6, 1.6, slope) * 0.6)
      // snow settles on the gentler high faces; steep rock stays bare
      out.lerp(pal.snow, smooth(66, 88, h) * (1 - smooth(1.0, 1.9, slope)) * 0.9)
      if (slope < 0.35 && h < 45) out.lerp(pal.grassDry, 0.35 + d01 * 0.2)
      break
    }
    case BIOME.snow:
      out.copy(pal.snow).lerp(tmp.set('#d8e4f2'), d01 * 0.5).lerp(tmp.set('#5a5c66'), smooth(0.9, 1.8, slope) * 0.75)
      break
    case BIOME.ash:
      out.copy(pal.ash).lerp(pal.ashPurple, p01 * 0.8).lerp(tmp.copy(pal.ash).multiplyScalar(1.4), d01 * 0.3)
      if (slope > 0.6) out.lerp(pal.rock, 0.3)
      break
    case BIOME.marsh:
      out.copy(pal.marsh).lerp(pal.grassLush, d01 * 0.5).lerp(pal.water, rnd * 0.15)
      break
    case BIOME.road:
      out.copy(pal.road).lerp(pal.sand, d01 * 0.3)
      break
    default:
      out.copy(pal.grass)
  }
  // subtle per-face jitter gives the faceted low-poly look
  const j = 1 + (rnd - 0.5) * 0.08
  out.r *= j
  out.g *= j
  out.b *= j
  return out
}
