/**
 * Forest moods: which tree species grow where and in what colours. A region gives every pixel
 * a base mood (the Shire is bright, Forodwaith is pine country); a forest landmark whose
 * dressing names a palette floods its whole connected forest patch with that mood, so
 * Mirkwood is dark from edge to edge and Lórien is golden, not just within a radius.
 */
import type { Heightfield } from '@/terrain/heightfield'
import type { World } from '@/world/schema'
import { BIOME } from '@/world/biomes'

export type TreeType = 'pine' | 'fir' | 'round' | 'oak' | 'birch' | 'mallorn'
export type Family = [string, string]

export interface Mood {
  /** relative weights of species */
  types: Partial<Record<TreeType, number>>
  /** canopy colour families; picked per grove */
  canopy: Family[]
  /** conifer needles stay green even where broadleaves turn; defaults to `canopy` */
  conifer?: Family[]
  trunk: Family[]
  /** forest-floor tint: multiply, then lerp toward a colour */
  floor: { mul: number; tint: string; amount: number }
  flowers: number // multiplier on flower probability
  mushrooms: number
  treeScale: number
  /** multiplier on forest tree density (big old trees stand further apart) */
  density: number
  /** 0..1 share of the mushrooms that glow in the dark */
  glow?: number
}

export const MOODS: Record<string, Mood> = {
  mixed: {
    types: { pine: 0.3, fir: 0.1, round: 0.3, oak: 0.2, birch: 0.1 },
    canopy: [['#5bab4a', '#8fd05a'], ['#3f9a4a', '#6cbf5a'], ['#2f7a45', '#4a9c5c'], ['#6fb85a', '#a8dc6a'], ['#4f9a63', '#7cc27a'], ['#d98f3a', '#f0b04a'], ['#a3c24a', '#d0d85a'], ['#5bab4a', '#8fd05a']],
    conifer: [['#2f7a45', '#4a9c5c'], ['#1f6b4f', '#3a8a63'], ['#3d8c3f', '#6fae4a'], ['#2c6f5a', '#4c9a7a']],
    trunk: [['#6b4a2f', '#8a6240'], ['#5a3d28', '#7a5a3c']],
    floor: { mul: 1, tint: '#4a6a3a', amount: 0 },
    flowers: 1,
    mushrooms: 1,
    treeScale: 1,
    density: 1,
  },
  bright: {
    types: { round: 0.45, oak: 0.3, birch: 0.2, pine: 0.05 },
    canopy: [['#6fb85a', '#a8dc6a'], ['#5bab4a', '#8fd05a'], ['#8fd05a', '#c0e878'], ['#4f9a5c', '#7cc27a'], ['#e0a7c8', '#f3cfe2'], ['#a3c24a', '#d0d85a'], ['#6fb85a', '#a8dc6a']],
    conifer: [['#3d8c3f', '#6fae4a'], ['#2f7a45', '#4a9c5c'], ['#4f8a3a', '#7fb060']],
    trunk: [['#7c5a3a', '#9c7a52'], ['#6b4a2f', '#8a6240']],
    floor: { mul: 1.04, tint: '#7fb85a', amount: 0.15 },
    flowers: 1.6,
    mushrooms: 0.8,
    treeScale: 1,
    density: 0.9,
  },
  dark: {
    types: { fir: 0.45, pine: 0.35, oak: 0.2 },
    canopy: [['#1b3626', '#25482f'], ['#152e26', '#1f4232'], ['#26382a', '#33503a'], ['#1a3a34', '#254a42']],
    trunk: [['#211c19', '#302824'], ['#2a2420', '#3a302a']],
    floor: { mul: 0.72, tint: '#1d2a22', amount: 0.4 },
    flowers: 0,
    mushrooms: 1.2,
    glow: 0.55,
    treeScale: 1.25,
    density: 1.15,
  },
  old: {
    types: { oak: 0.6, round: 0.25, fir: 0.15 },
    canopy: [['#3a6236', '#548446'], ['#4a7438', '#658f48'], ['#2c5236', '#456f46'], ['#586f3a', '#6f8a48']],
    trunk: [['#45443a', '#5e5e50'], ['#3b3a32', '#565548'], ['#4a4a3a', '#6a6a52']],
    floor: { mul: 0.86, tint: '#3a5a3a', amount: 0.45 },
    flowers: 0,
    mushrooms: 1.5,
    glow: 0.4,
    treeScale: 1.35,
    density: 0.55,
  },
  golden: {
    types: { mallorn: 0.82, oak: 0.18 },
    canopy: [['#e0b43a', '#f2d060'], ['#d9a02c', '#f0c850'], ['#e8c04a', '#f8dc74']],
    trunk: [['#b8b8c0', '#dcdce2'], ['#a8a8b4', '#cfcfd8']],
    floor: { mul: 1, tint: '#c9a83c', amount: 0.55 },
    flowers: 1,
    mushrooms: 0.3,
    treeScale: 1.6,
    density: 0.5,
  },
  willow: {
    types: { round: 0.5, oak: 0.3, fir: 0.2 },
    canopy: [['#5a7a3a', '#7a9a4a'], ['#4a6a34', '#6a8a44'], ['#6a8a3a', '#8aa652']],
    trunk: [['#4a3a2a', '#5e4c38'], ['#3f3428', '#544634']],
    floor: { mul: 0.82, tint: '#3a4a2a', amount: 0.35 },
    flowers: 0.1,
    mushrooms: 1,
    glow: 0.25,
    treeScale: 1.2,
    density: 0.9,
  },
  holly: {
    types: { round: 0.5, pine: 0.3, fir: 0.2 },
    canopy: [['#2f6b3a', '#3a7a44'], ['#2a6035', '#3f8a46'], ['#3a7a44', '#4f9a5c']],
    trunk: [['#5a4a3a', '#75624c'], ['#6b4a2f', '#8a6240']],
    floor: { mul: 0.92, tint: '#3f6a3a', amount: 0.2 },
    flowers: 0.5,
    mushrooms: 0.8,
    treeScale: 1,
    density: 1,
  },
  pine: {
    types: { pine: 0.6, fir: 0.4 },
    canopy: [['#2c6f5a', '#4c9a7a'], ['#1f6b4f', '#3a8a63'], ['#2f7a45', '#4a9c5c'], ['#3d6f5a', '#5a8f78']],
    trunk: [['#5a3d28', '#7a5a3c'], ['#4a3a30', '#6a5a4a']],
    floor: { mul: 0.9, tint: '#5a5a3a', amount: 0.25 },
    flowers: 0.3,
    mushrooms: 1,
    treeScale: 1.05,
    density: 1.1,
  },
  lush: {
    types: { round: 0.4, oak: 0.3, birch: 0.2, pine: 0.1 },
    canopy: [['#4f9a63', '#7cc27a'], ['#5bab4a', '#8fd05a'], ['#3f9a4a', '#6cbf5a'], ['#6fb85a', '#a8dc6a'], ['#e0a7c8', '#f3cfe2']],
    conifer: [['#2f7a45', '#4a9c5c'], ['#3d8c3f', '#6fae4a']],
    trunk: [['#6b4a2f', '#8a6240'], ['#7c5a3a', '#9c7a52']],
    floor: { mul: 1.02, tint: '#4f9a5c', amount: 0.2 },
    flowers: 2.2,
    mushrooms: 0.8,
    treeScale: 1.1,
    density: 0.9,
  },
  dry: {
    types: { round: 0.5, oak: 0.3, pine: 0.2 },
    canopy: [['#8a9a4a', '#a8b060'], ['#6f8a3a', '#8fa050'], ['#9aa050', '#b8b868']],
    trunk: [['#7a6a4a', '#9a8a62'], ['#6a5a3a', '#8a7a52']],
    floor: { mul: 1.05, tint: '#b8b95a', amount: 0.3 },
    flowers: 0.3,
    mushrooms: 0.2,
    treeScale: 0.9,
    density: 0.7,
  },
}
export const MOOD_IDS = Object.keys(MOODS)
export const DEFAULT_MOOD = 'mixed'

/** Dressing palettes that flood their forest patch. */
const SEED_PALETTES = new Set(['dark', 'old', 'golden', 'willow', 'holly', 'pine'])

function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const cache = new WeakMap<Heightfield, Uint8Array>()

/** Mood id index per heightfield pixel. Cached per heightfield; call `invalidateMoodMap` after edits. */
export function getMoodMap(meta: World, hf: Heightfield): Uint8Array {
  const hit = cache.get(hf)
  if (hit) return hit
  const { width, height, cell } = hf
  const map = new Uint8Array(width * height).fill(MOOD_IDS.indexOf(DEFAULT_MOOD))
  // regions: smallest polygon wins, so nested forests override their country
  const regions = meta.regions
    .filter((r) => r.mood && MOODS[r.mood])
    .map((r) => {
      let a = 0
      for (let i = 0, j = r.polygon.length - 1; i < r.polygon.length; j = i++) a += r.polygon[j][0] * r.polygon[i][1] - r.polygon[i][0] * r.polygon[j][1]
      const xs = r.polygon.map((p) => p[0]), zs = r.polygon.map((p) => p[1])
      return { poly: r.polygon, mood: MOOD_IDS.indexOf(r.mood!), area: Math.abs(a) / 2, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
    })
    .sort((a, b) => b.area - a.area) // large first, so smaller ones paint over
  for (const r of regions) {
    const x0 = Math.max(0, Math.floor(r.minX / cell)), x1 = Math.min(width - 1, Math.ceil(r.maxX / cell))
    const z0 = Math.max(0, Math.floor(r.minZ / cell)), z1 = Math.min(height - 1, Math.ceil(r.maxZ / cell))
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) if (pointInPolygon(ix * cell, iz * cell, r.poly)) map[iz * width + ix] = r.mood
  }
  // forest landmarks flood their connected forest patch
  const stack: number[] = []
  const seen = new Uint8Array(width * height)
  for (const lm of meta.landmarks) {
    const pal = lm.dressing?.vegetation?.palette
    if (!pal || !SEED_PALETTES.has(pal) || !MOODS[pal]) continue
    const mood = MOOD_IDS.indexOf(pal)
    // nearest forest pixel to the landmark within its radius
    const cx = Math.round(lm.position[0] / cell), cz = Math.round(lm.position[1] / cell)
    const rPx = Math.ceil((lm.dressing?.radius ?? 30) / cell)
    let seed = -1, best = Infinity
    for (let dz = -rPx; dz <= rPx; dz++)
      for (let dx = -rPx; dx <= rPx; dx++) {
        const ix = cx + dx, iz = cz + dz
        if (ix < 0 || iz < 0 || ix >= width || iz >= height) continue
        const i = iz * width + ix
        if (hf.biome[i] !== BIOME.forest) continue
        const d = dx * dx + dz * dz
        if (d < best) {
          best = d
          seed = i
        }
      }
    if (seed < 0) continue
    stack.push(seed)
    seen[seed] = 1
    while (stack.length) {
      const i = stack.pop()!
      map[i] = mood
      const ix = i % width, iz = (i - ix) / width
      for (const [nx, nz] of [[ix - 1, iz], [ix + 1, iz], [ix, iz - 1], [ix, iz + 1]]) {
        if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue
        const n = nz * width + nx
        if (seen[n] || hf.biome[n] !== BIOME.forest) continue
        seen[n] = 1
        stack.push(n)
      }
    }
    // also colour a soft margin of non-forest ground around the patch so the floor tint reaches the edge
  }
  cache.set(hf, map)
  return map
}

export function invalidateMoodMap(hf: Heightfield) {
  cache.delete(hf)
}

export function moodAt(map: Uint8Array, hf: Heightfield, x: number, z: number): Mood {
  const ix = Math.min(hf.width - 1, Math.max(0, Math.floor(x / hf.cell)))
  const iz = Math.min(hf.height - 1, Math.max(0, Math.floor(z / hf.cell)))
  return MOODS[MOOD_IDS[map[iz * hf.width + ix]]] ?? MOODS[DEFAULT_MOOD]
}

/** Pick a species from the mood's weights with a 0..1 roll. */
export function pickType(mood: Mood, roll: number): TreeType {
  let total = 0
  for (const w of Object.values(mood.types)) total += w ?? 0
  let acc = 0
  for (const [t, w] of Object.entries(mood.types) as [TreeType, number][]) {
    acc += w / total
    if (roll <= acc) return t
  }
  return 'round'
}
