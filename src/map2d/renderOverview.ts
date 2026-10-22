import type { LoadedWorld } from '@/world/loadWorld'
import { BIOME } from '@/world/biomes'

let cache = new WeakMap<LoadedWorld, HTMLCanvasElement>()

/** Supersampling factor over the heightmap resolution. 4x of 624x496 = 2496x1984 px. */
const SCALE = 4
const CONTOUR_STEP = 10 // metres

const PAL: Record<number, [number, number, number]> = {
  [BIOME.water]: [104, 160, 214],
  [BIOME.sand]: [226, 210, 168],
  [BIOME.grass]: [150, 186, 110],
  [BIOME.forest]: [80, 138, 82],
  [BIOME.rock]: [156, 146, 132],
  [BIOME.snow]: [242, 242, 244],
  [BIOME.ash]: [104, 94, 90],
  [BIOME.marsh]: [124, 152, 104],
  [BIOME.road]: [214, 190, 150],
  [BIOME.riverbed]: [118, 170, 220],
}

type InvalidationListener = (world: LoadedWorld | undefined) => void
const listeners = new Set<InvalidationListener>()

/**
 * Hears every invalidateOverview call (a terrain edit; undefined means every world). The map
 * renderer (prepareMap.ts) subscribes here: the editor only knows this module, and a listener
 * lets the renderer import this file without this file importing it back.
 */
export function onOverviewInvalidated(cb: InvalidationListener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Drops the world's cached overview (and, through the listeners, its prepared map) after a terrain edit. */
export function invalidateOverview(world?: LoadedWorld) {
  if (world) cache.delete(world)
  else cache = new WeakMap()
  for (const cb of [...listeners]) cb(world)
}

/**
 * Draws the 2D overview map from the same heightfield + biome data the 3D world uses.
 * Heights are sampled bilinearly so coastlines, rivers and hillshade are smooth at 4x; biomes are
 * nearest-sampled but water is decided by height, which gives sub-pixel shorelines.
 *
 * The legacy raster the minimap still draws from; the big map uses prepareMap/drawMap.
 */
export function renderOverview(world: LoadedWorld): HTMLCanvasElement {
  const hit = cache.get(world)
  if (hit) return hit
  const hf = world.heightfield
  const sea = world.meta.seaLevel
  const W = hf.width * SCALE
  const H = hf.height * SCALE
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(W, H)
  const data = img.data
  const cell = hf.cell
  const step = cell / SCALE // metres per output pixel

  // pass 1: heights (bilinear) so hillshade and contours can use neighbours
  const heights = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    const wz = (y + 0.5) * step
    for (let x = 0; x < W; x++) heights[y * W + x] = hf.sampleHeight((x + 0.5) * step, wz)
  }

  const at = (x: number, y: number) => heights[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))]

  for (let y = 0; y < H; y++) {
    const wz = (y + 0.5) * step
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const wx = (x + 0.5) * step
      const h = heights[i]
      let b = hf.biomeAt(wx, wz)
      // decide water by height for smooth shorelines; painted highland water keeps its biome
      const wet = h < sea - 0.15 || b === BIOME.water
      if (wet) b = BIOME.water
      let [r, g, bl] = PAL[b] ?? PAL[BIOME.grass]
      if (b === BIOME.water) {
        const d = sea - h
        const t = d < 2 ? 0 : d < 8 ? 0.35 : 0.7
        r = 104 - 40 * t
        g = 160 - 50 * t
        bl = 214 - 40 * t
        // shoreline rim: darker where a neighbour is dry
        const dry = at(x - 1, y) >= sea - 0.15 || at(x + 1, y) >= sea - 0.15 || at(x, y - 1) >= sea - 0.15 || at(x, y + 1) >= sea - 0.15
        if (dry) {
          r *= 0.7
          g *= 0.75
          bl *= 0.82
        }
      } else if (b === BIOME.riverbed) {
        // painted river: give it a thin darker edge too
        r = 118
        g = 170
        bl = 220
      } else {
        // hillshade from the north-west, scaled to the finer step
        const dx = (at(x - 1, y) - at(x + 1, y)) / (2 * step)
        const dz = (at(x, y - 1) - at(x, y + 1)) / (2 * step)
        const shade = Math.max(0.55, Math.min(1.3, 1 + 0.55 * (dx + dz)))
        r *= shade
        g *= shade
        bl *= shade
        // light contour lines every CONTOUR_STEP metres
        const c0 = Math.floor(h / CONTOUR_STEP)
        const c1 = Math.floor(at(x + 1, y) / CONTOUR_STEP)
        const c2 = Math.floor(at(x, y + 1) / CONTOUR_STEP)
        if ((c0 !== c1 || c0 !== c2) && h > sea + 1) {
          const strong = c0 % 5 === 0 ? 0.72 : 0.86
          r *= strong
          g *= strong
          bl *= strong
        }
        // parchment tint
        r = r * 0.92 + 20
        g = g * 0.92 + 14
        bl = bl * 0.9 + 6
      }
      data[i * 4] = r
      data[i * 4 + 1] = g
      data[i * 4 + 2] = bl
      data[i * 4 + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  cache.set(world, canvas)
  return canvas
}
