import { Heightfield } from '@/terrain/heightfield'
import { WorldSchema, LoreSchema, type World, type Lore } from './schema'
import type { Route } from '@/router'
import { loadPlace } from '@/places/loadPlace'
import { GlobeField } from '@/globe/globeField'
import { registerSurface, type TerrainSurface } from '@/terrain/surface'
import { meshOptions } from '@/terrain/buildChunks'

/** A line feature the map draws on top of the terrain: x, z points in world metres. */
export interface MapLine {
  points: [number, number][]
}

export interface LoadedWorld {
  meta: World
  heightfield: Heightfield
  /** the drawn terrain: use it for anything that stands or sits on the visible ground */
  surface: TerrainSurface
  lore: Lore
  /** present for spherical worlds */
  globe?: GlobeField
  /** places only: lanes and dry ditches the map draws from their own polylines */
  features?: { roads?: (MapLine & { width: number })[]; ditches?: MapLine[] }
}

const cache = new Map<string, Promise<LoadedWorld>>()

export function loadWorld(id: string): Promise<LoadedWorld> {
  let p = cache.get(id)
  if (!p) {
    p = doLoad(id)
    cache.set(id, p)
  }
  return p
}

/** World or place for a route. Places are generated at runtime from the parent world's definitions. */
export function loadRoute(route: Route): Promise<LoadedWorld> {
  if (!route.placeId) return loadWorld(route.worldId)
  let p = cache.get(route.id)
  if (!p) {
    p = loadPlace(route.worldId, route.placeId)
    cache.set(route.id, p)
  }
  return p
}

async function doLoad(id: string): Promise<LoadedWorld> {
  const base = `${import.meta.env.BASE_URL}worlds/${id}/`
  const [metaRes, loreRes] = await Promise.all([fetch(`${base}world.json`), fetch(`${base}lore.json`)])
  if (!metaRes.ok) throw new Error(`world.json for "${id}" not found`)
  const meta = WorldSchema.parse(await metaRes.json())
  const lore: Lore = loreRes.ok ? LoreSchema.parse(await loreRes.json()) : { landmarks: {}, regions: {} }

  if (!meta.terrain) throw new Error(`world.json for "${id}" has no terrain file`)
  const blob = await (await fetch(base + meta.terrain.file)).blob()
  // Decode without colour management so the byte values survive intact.
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0)
  const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
  const bw = bitmap.width
  const bh = bitmap.height
  const n = bw * bh
  const heights = new Float32Array(n)
  const biome = new Uint8Array(n)
  const { heightOffset, heightScale } = meta.terrain
  for (let i = 0; i < n; i++) {
    const enc = img[i * 4] * 256 + img[i * 4 + 1]
    heights[i] = (enc / 65535) * heightScale + heightOffset
    biome[i] = img[i * 4 + 2]
  }
  bitmap.close()
  const heightfield = new Heightfield(bw, bh, meta.cell, heights, biome)
  const surface = registerSurface(heightfield, { ...meshOptions(meta), seaLevel: meta.seaLevel })
  const globe = meta.kind === 'globe' ? new GlobeField(heightfield, meta.radius ?? 200) : undefined
  return { meta, heightfield, surface, lore, globe }
}
