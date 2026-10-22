import { createNoise2D } from 'simplex-noise'
import { mulberry32 } from '@/world/random'

export interface TerrainNoise {
  /** large colour regions, -1..1 */
  patch: (x: number, z: number) => number
  /** mid-scale variation, -1..1 */
  detail: (x: number, z: number) => number
}

const cache = new Map<number, TerrainNoise>()

/** Seeded noise shared by the terrain colouring and the grass so they agree. */
export function terrainNoise(seed: number): TerrainNoise {
  let n = cache.get(seed)
  if (!n) {
    const p = createNoise2D(mulberry32(seed))
    const d = createNoise2D(mulberry32(seed + 7))
    n = {
      patch: (x, z) => p(x / 110, z / 110) * 0.7 + p(x / 260, z / 260) * 0.3,
      detail: (x, z) => d(x / 26, z / 26),
    }
    cache.set(seed, n)
  }
  return n
}
