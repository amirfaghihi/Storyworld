// Checks that TerrainSurface (src/terrain/surface.ts) matches the terrain as drawn.
// Builds the real chunk geometry for Bree, Hobbiton and the Middle-earth overworld, samples six
// points inside every triangle and compares the triangle's own height and normal with the
// surface's. Fails (exit code 1) if any height is off by 1e-4 m or more: the surface and
// buildChunks must share one triangulation, or props, trees and the hero float or sink again.
// Also prints how far the smooth sampler (Heightfield.sampleHeight) strays from the mesh on
// walkable land, for reference.
// Usage: npx tsx scripts/check-surface.ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { Vector3 } from 'three'
import { Heightfield } from '../src/terrain/heightfield.ts'
import { buildTerrainChunks, meshOptions } from '../src/terrain/buildChunks.ts'
import { makePalette } from '../src/terrain/faceColors.ts'
import { registerSurface, type TerrainSurface } from '../src/terrain/surface.ts'
import { WorldSchema, type World } from '../src/world/schema.ts'
import { buildPlace } from '../src/places/buildPlace.ts'
import { def as bree } from '../src/places/defs/bree.ts'
import { def as hobbiton } from '../src/places/defs/hobbiton.ts'

const TOLERANCE = 1e-4
const MAX_CLIMB = 1.9 // the controller's steepest walkable slope
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Same decoding as loadWorld.ts, with pngjs instead of a canvas. */
function loadOverworld(id: string): { meta: World; heightfield: Heightfield; surface: TerrainSurface } {
  const dir = path.join(root, 'public/worlds', id)
  const meta = WorldSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, 'world.json'), 'utf8')))
  if (!meta.terrain) throw new Error(`${id} has no terrain file`)
  const png = PNG.sync.read(fs.readFileSync(path.join(dir, meta.terrain.file)))
  const n = png.width * png.height
  const heights = new Float32Array(n)
  const biome = new Uint8Array(n)
  const { heightOffset, heightScale } = meta.terrain
  for (let i = 0; i < n; i++) {
    heights[i] = ((png.data[i * 4] * 256 + png.data[i * 4 + 1]) / 65535) * heightScale + heightOffset
    biome[i] = png.data[i * 4 + 2]
  }
  const heightfield = new Heightfield(png.width, png.height, meta.cell, heights, biome)
  return { meta, heightfield, surface: registerSurface(heightfield, { ...meshOptions(meta), seaLevel: meta.seaLevel }) }
}

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]

// barycentric weights of the interior points sampled in each triangle
const SAMPLES: [number, number][] = [
  [1 / 3, 1 / 3],
  [0.6, 0.2],
  [0.2, 0.6],
  [0.2, 0.2],
  [0.45, 0.45],
  [0.05, 0.9],
]

function check(label: string, meta: World, hf: Heightfield, surface: TerrainSurface): boolean {
  const t0 = performance.now()
  const opts = meshOptions(meta)
  const chunks = buildTerrainChunks(hf, makePalette(meta.palette), meta.seaLevel, opts, meta.seed)
  const normal = new Vector3()
  let tris = 0, points = 0, maxErr = 0, maxNormalErr = 0
  let worst = ''
  const smooth: number[] = []
  for (const c of chunks) {
    const p = c.geometry.attributes.position.array as Float32Array
    for (let i = 0; i < p.length; i += 9) {
      tris++
      const ax = p[i], ay = p[i + 1], az = p[i + 2]
      const bx = p[i + 3], by = p[i + 4], bz = p[i + 5]
      const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8]
      // face normal, pointing up
      const ux = bx - ax, uy = by - ay, uz = bz - az
      const vx = cx - ax, vy = cy - ay, vz = cz - az
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
      if (ny < 0) (nx = -nx), (ny = -ny), (nz = -nz)
      const nl = Math.hypot(nx, ny, nz)
      const slope = Math.hypot(nx, nz) / ny
      for (const [s, t] of SAMPLES) {
        const r = 1 - s - t
        const x = ax * r + bx * s + cx * t
        const z = az * r + bz * s + cz * t
        const mesh = ay * r + by * s + cy * t
        const h = surface.height(x, z, normal)
        points++
        const err = Math.abs(h - mesh)
        if (err > maxErr) {
          maxErr = err
          worst = `(${x.toFixed(2)}, ${z.toFixed(2)})`
        }
        maxNormalErr = Math.max(maxNormalErr, Math.hypot(normal.x - nx / nl, normal.y - ny / nl, normal.z - nz / nl))
        if (mesh > meta.seaLevel + 0.2 && slope < MAX_CLIMB) smooth.push(Math.abs(hf.sampleHeight(x, z) - mesh))
      }
    }
  }
  smooth.sort((a, b) => a - b)
  const ok = maxErr < TOLERANCE
  console.log(`${label}: ${chunks.length} chunks, ${tris} triangles, ${points} points in ${(performance.now() - t0).toFixed(0)} ms`)
  console.log(`  max |surface - triangle| = ${maxErr.toExponential(2)} m at ${worst}; max normal error ${maxNormalErr.toExponential(2)}  ${ok ? 'ok' : 'FAIL'}`)
  console.log(`  |sampleHeight - triangle| on walkable land: p50 ${quantile(smooth, 0.5).toFixed(3)}  p95 ${quantile(smooth, 0.95).toFixed(3)}  p99 ${quantile(smooth, 0.99).toFixed(3)}  max ${smooth[smooth.length - 1].toFixed(3)} m`)
  return ok
}

let ok = true
for (const def of [bree, hobbiton]) {
  const w = buildPlace(def, [0, 0])
  ok = check(def.name, w.meta, w.heightfield, w.surface) && ok
}
const me = loadOverworld('middle-earth')
ok = check('Middle-earth', me.meta, me.heightfield, me.surface) && ok
if (!ok) {
  console.error(`\nFAIL: TerrainSurface differs from the drawn terrain by ${TOLERANCE} m or more`)
  process.exit(1)
}
console.log('\nok: TerrainSurface matches the drawn terrain')
