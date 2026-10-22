import * as THREE from 'three'
import type { Heightfield } from './heightfield'
import { faceColor, hash2, type Palette } from './faceColors'
import { terrainNoise } from './terrainNoise'
import { overrideWeight, type GroundOverride } from '@/dressing/ground'
import { BIOME } from '@/world/biomes'
import { MOODS, MOOD_IDS, type Mood } from '@/vegetation/mood'

export interface TerrainChunk {
  key: string
  geometry: THREE.BufferGeometry
  center: THREE.Vector3
}

export interface BuildOptions {
  spacing: number // metres between vertices (multiple of heightfield cell)
  chunkQuads: number // quads per chunk side
}

/** Quads per chunk side. */
export const CHUNK_QUADS = 32
/** Default metres between terrain vertices; a world or place can override it with meta.terrainSpacing. */
export const TERRAIN_SPACING = 4

/**
 * The mesh options a world is drawn with. The terrain mesh and TerrainSurface both take them from
 * here, so the ground things stand on is always the ground that is drawn.
 */
export function meshOptions(meta: { terrainSpacing?: number }): BuildOptions {
  return { spacing: meta.terrainSpacing ?? TERRAIN_SPACING, chunkQuads: CHUNK_QUADS }
}

const A = new THREE.Vector3()
const B = new THREE.Vector3()
const C = new THREE.Vector3()
const N = new THREE.Vector3()
const col = new THREE.Color()
const tmpCol = new THREE.Color()

/**
 * Build non-indexed, per-face-coloured chunk geometries from the heightfield.
 * Faces get their colour from the biome at their centroid, so the result is flat-shaded low-poly.
 */
export function buildTerrainChunks(hf: Heightfield, pal: Palette, seaLevel: number, opts: BuildOptions, seed = 1, overrides: GroundOverride[] = [], moodMap?: Uint8Array): TerrainChunk[] {
  const { chunkQuads } = opts
  const { step, nx, nz } = chunkGrid(hf, opts)
  const chunks: TerrainChunk[] = []
  for (let cz = 0; cz * chunkQuads < nz; cz++) {
    for (let cx = 0; cx * chunkQuads < nx; cx++) chunks.push(buildChunk(hf, pal, seaLevel, opts, seed, overrides, cx, cz, step, nx, nz, moodMap))
  }
  return chunks
}

/** Mountain chunks get full heightfield resolution so ridges and crags read as rock, not blobs. */
export function isMountainChunk(hf: Heightfield, px0: number, px1: number, pz0: number, pz1: number): boolean {
  for (let z = pz0; z <= pz1; z += 2)
    for (let x = px0; x <= px1; x += 2) {
      const b = hf.biomeAtPx(x, z)
      if ((b === BIOME.rock || b === BIOME.snow) && hf.at(x, z) > 28) return true
    }
  return false
}

export function chunkGrid(hf: Heightfield, opts: BuildOptions) {
  const step = Math.max(1, Math.round(opts.spacing / hf.cell)) // heightfield px per vertex
  const nx = Math.floor((hf.width - 1) / step) // quads along x
  const nz = Math.floor((hf.height - 1) / step)
  return { step, nx, nz }
}

/** Pixel extent of chunk (cx, cz). Neighbouring chunks share their border pixels. */
export function chunkPixels(cx: number, cz: number, chunkQuads: number, step: number, nx: number, nz: number) {
  const q0x = cx * chunkQuads
  const q0z = cz * chunkQuads
  const q1x = Math.min(nx, q0x + chunkQuads)
  const q1z = Math.min(nz, q0z + chunkQuads)
  return { px0: q0x * step, px1: q1x * step, pz0: q0z * step, pz1: q1z * step }
}

/**
 * Which way a quad is split into two triangles. (qx, qz) is the quad's corner in units of the
 * chunk's own vertex spacing, so a fine mountain chunk hashes on pixels and a coarse one on steps.
 * True: the diagonal runs from (x0, z0) to (x1, z1); false: from (x1, z0) to (x0, z1).
 */
export function splitsMainDiagonal(qx: number, qz: number): boolean {
  return hash2(qx, qz) > 0.5
}

/**
 * Vertex heights for one chunk. Mountain chunks are built at full resolution with their border
 * vertices interpolated along the coarse grid, so they meet their coarse neighbours without
 * cracks; every other vertex is the heightfield pixel itself.
 */
export function makeVertexSampler(hf: Heightfield, px0: number, px1: number, pz0: number, pz1: number, step: number, fine: boolean): (ix: number, iz: number) => number {
  if (!fine) return (ix, iz) => hf.at(ix, iz)
  return (ix, iz) => {
    if ((ix === px0 || ix === px1) && iz % step !== 0) {
      const lo = Math.floor(iz / step) * step
      return hf.at(ix, lo) + (hf.at(ix, lo + step) - hf.at(ix, lo)) * ((iz - lo) / step)
    }
    if ((iz === pz0 || iz === pz1) && ix % step !== 0) {
      const lo = Math.floor(ix / step) * step
      return hf.at(lo, iz) + (hf.at(lo + step, iz) - hf.at(lo, iz)) * ((ix - lo) / step)
    }
    return hf.at(ix, iz)
  }
}

/** Chunk keys whose area overlaps a world-space rect (metres), including shared border vertices. */
export function chunksInRect(hf: Heightfield, opts: BuildOptions, minX: number, maxX: number, minZ: number, maxZ: number): [number, number][] {
  const { step, nx, nz } = chunkGrid(hf, opts)
  const m = step * hf.cell * opts.chunkQuads // metres per chunk
  const pad = step * hf.cell
  const c0x = Math.max(0, Math.floor((minX - pad) / m))
  const c1x = Math.min(Math.ceil(nx / opts.chunkQuads) - 1, Math.floor((maxX + pad) / m))
  const c0z = Math.max(0, Math.floor((minZ - pad) / m))
  const c1z = Math.min(Math.ceil(nz / opts.chunkQuads) - 1, Math.floor((maxZ + pad) / m))
  const out: [number, number][] = []
  for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) out.push([cx, cz])
  return out
}

export function buildChunk(hf: Heightfield, pal: Palette, seaLevel: number, opts: BuildOptions, seed: number, overrides: GroundOverride[], cx: number, cz: number, stepIn?: number, nxIn?: number, nzIn?: number, moodMap?: Uint8Array): TerrainChunk {
  const { chunkQuads } = opts
  const noise = terrainNoise(seed)
  const grid = stepIn === undefined || nxIn === undefined || nzIn === undefined ? chunkGrid(hf, opts) : { step: stepIn, nx: nxIn, nz: nzIn }
  const { step, nx, nz } = grid
  const moodOf = (x: number, z: number): Mood | undefined => {
    if (!moodMap) return undefined
    const ix = Math.min(hf.width - 1, Math.max(0, Math.floor(x / hf.cell)))
    const iz = Math.min(hf.height - 1, Math.max(0, Math.floor(z / hf.cell)))
    return MOODS[MOOD_IDS[moodMap[iz * hf.width + ix]]]
  }
  {
    {
      // pixel extent of this chunk; mountain chunks are built at full resolution with borders
      // stitched to the coarse grid so neighbours never crack
      const { px0, px1, pz0, pz1 } = chunkPixels(cx, cz, chunkQuads, step, nx, nz)
      const fine = step > 1 && isMountainChunk(hf, px0, px1, pz0, pz1)
      const s = fine ? 1 : step
      // TerrainSurface reads heights through the same sampler, so keep any change to it here
      const hAt = makeVertexSampler(hf, px0, px1, pz0, pz1, step, fine)
      const quads = ((px1 - px0) / s) * ((pz1 - pz0) / s)
      const pos = new Float32Array(quads * 6 * 3)
      const colors = new Float32Array(quads * 6 * 3)
      let o = 0

      const emitTri = (ax: number, az: number, bx: number, bz: number, cxx: number, czz: number, rnd: number) => {
        A.set(ax * hf.cell, hAt(ax, az), az * hf.cell)
        B.set(bx * hf.cell, hAt(bx, bz), bz * hf.cell)
        C.set(cxx * hf.cell, hAt(cxx, czz), czz * hf.cell)
        N.subVectors(B, A).cross(C.clone().sub(A))
        if (N.y < 0) {
          // flip winding so the face points up
          const t = B.clone()
          B.copy(C)
          C.copy(t)
          N.negate()
        }
        N.normalize()
        const slope = Math.sqrt(Math.max(0, 1 - N.y * N.y)) / Math.max(0.05, N.y)
        const mx = (A.x + B.x + C.x) / 3
        const mz = (A.z + B.z + C.z) / 3
        const mh = (A.y + B.y + C.y) / 3
        const biome = hf.biomeAt(mx, mz)
        const patch = noise.patch(mx, mz)
        const detail = noise.detail(mx, mz)
        faceColor(col, pal, { biome, h: mh, slope, rnd, patch, detail, seaLevel, mood: biome === BIOME.forest ? moodOf(mx, mz) : undefined })
        if (biome !== BIOME.water && biome !== BIOME.riverbed) {
          for (const o of overrides) {
            const w = overrideWeight(o, mx, mz)
            if (w <= 0) continue
            if (o.kind === 'lava') {
              // crust with bright cracks
              tmpCol.copy(o.color)
              if (rnd > 0.72) tmpCol.set(rnd > 0.9 ? '#ffb347' : '#ff6a1a')
              col.lerp(tmpCol, w)
            } else {
              tmpCol.copy(o.color).multiplyScalar(0.92 + rnd * 0.16)
              col.lerp(tmpCol, w)
            }
          }
        }
        for (const v of [A, B, C]) {
          pos[o] = v.x
          pos[o + 1] = v.y
          pos[o + 2] = v.z
          colors[o] = col.r
          colors[o + 1] = col.g
          colors[o + 2] = col.b
          o += 3
        }
      }

      for (let z0 = pz0; z0 < pz1; z0 += s) {
        for (let x0 = px0; x0 < px1; x0 += s) {
          const x1 = x0 + s, z1 = z0 + s
          const qx = x0 / s, qz = z0 / s
          const r1 = hash2(qx, qz)
          const r2 = hash2(qx + 7919, qz + 104729)
          if (splitsMainDiagonal(qx, qz)) {
            emitTri(x0, z0, x1, z0, x1, z1, r1)
            emitTri(x0, z0, x1, z1, x0, z1, r2)
          } else {
            emitTri(x0, z0, x1, z0, x0, z1, r1)
            emitTri(x1, z0, x1, z1, x0, z1, r2)
          }
        }
      }

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      geometry.computeVertexNormals()
      geometry.computeBoundingSphere()
      geometry.computeBoundingBox()
      const center = geometry.boundingSphere!.center.clone()
      return { key: `${cx}_${cz}`, geometry, center }
    }
  }
}
