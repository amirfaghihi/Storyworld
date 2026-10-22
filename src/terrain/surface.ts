/**
 * TerrainSurface: the height of the terrain exactly as it is drawn.
 *
 * The mesh is not the heightfield. It is built every `spacing` metres (4 m on the overworld,
 * so 2x2 pixels per quad), each quad is split along a hashed diagonal, and mountain chunks are
 * built at full resolution with their borders stitched to the coarse grid. A bilinear sample of
 * the heightfield can sit metres off those triangles on the overworld, which is enough to float
 * a marker or bury a boot. This class walks the same grid with the same vertex sampler and
 * diagonal rule as buildChunks, so anything placed with it touches the visible ground.
 *
 * Heights are read live from the heightfield, so editor brushes need nothing more than
 * refresh() on the chunks they rebuilt (only the mountain flag per chunk is cached).
 */
import { Vector3 } from 'three'
import type { Heightfield } from './heightfield'
import { chunkGrid, chunkPixels, isMountainChunk, makeVertexSampler, splitsMainDiagonal, CHUNK_QUADS } from './buildChunks'
import { useWorld } from '@/world/WorldContext'

export interface SurfaceOpts {
  spacing: number
  chunkQuads: number
  seaLevel: number
}

/** Least-squares plane through the ground under a footprint. */
export interface PlaneFit {
  /** plane height at the footprint centre */
  y: number
  /** world-axis gradient: y = y + gx * (X - cx) + gz * (Z - cz) */
  gx: number
  gz: number
  /** unit normal (-gx, 1, -gz) normalised */
  normal: [number, number, number]
  /** how far the ground rises above the plane at worst (so a flat base on it buries nothing) */
  above: number
  /** how far the ground drops below the plane at worst (so a base on it shows no air) */
  below: number
}

interface ChunkInfo {
  fine: boolean
  px0: number
  px1: number
  pz0: number
  pz1: number
  at: (ix: number, iz: number) => number
}

// Every triangle edge buildChunks draws lies on a lattice line x = i c or z = j c, or on a
// lattice diagonal x - z = k c or x + z = k c (c = latticeCell; a coarse quad's diagonal runs
// through pixel corners too). Each family as [ux, uz, spacing / c] for the lines u . p = k * spacing.
const EDGE_LINES: [number, number, number][] = [
  [1, 0, 1],
  [0, 1, 1],
  [Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2],
]
const TAU = Math.PI * 2
/** cap on interior lattice points a footprint tests; huge footprints thin the lattice instead */
const MAX_LATTICE = 1024
const rimNormal = new Vector3()

/**
 * Footprint queries over a ground height function. TerrainSurface is the real one; FunctionSurface
 * wraps any (x, z) => height so prop builders can use the same helpers before they are handed it.
 */
export abstract class GroundSurface {
  abstract readonly seaLevel: number
  /** spacing of the candidate-vertex lattice the footprints test (the mesh's finest spacing) */
  protected abstract get latticeCell(): number
  /** height of the ground under (x, z); writes the unit ground normal into `outNormal` when given */
  abstract height(x: number, z: number, outNormal?: Vector3): number

  /** Unit ground normal under (x, z). */
  normal(x: number, z: number, out: Vector3): Vector3 {
    this.height(x, z, out)
    return out
  }

  /** The ground or the water surface, whichever is higher: for shallows, quays and boats. */
  visible(x: number, z: number): number {
    const h = this.height(x, z)
    return h > this.seaLevel ? h : this.seaLevel
  }

  /**
   * Lowest ground under a disc of radius r: a base here never shows air. The terrain is flat per
   * triangle, so the extreme lies at a mesh vertex inside, where the rim crosses a triangle edge,
   * or where the rim runs square to one triangle's slope; all three are tested, which makes it
   * exact (up to MAX_LATTICE vertices inside).
   */
  footprintMin(x: number, z: number, r: number): number {
    return -this.discExtreme(x, z, r, -1)
  }
  /** Highest ground under a disc of radius r. */
  footprintMax(x: number, z: number, r: number): number {
    return this.discExtreme(x, z, r, 1)
  }

  /**
   * Lowest ground under a rotated rectangle: centre (cx, cz), half extents hw (local x) and hd
   * (local z), `rot` as in propUtil.at (+rot turns local +x toward -z). The terrain is flat
   * per triangle, so the extreme lies at a corner, where the outline crosses a triangle edge, or
   * at a mesh vertex inside; all are tested, which makes it exact (up to MAX_LATTICE vertices).
   */
  footprintMinRect(cx: number, cz: number, hw: number, hd: number, rot: number): number {
    return -this.rectExtreme(cx, cz, hw, hd, rot, -1)
  }
  /** Highest ground under a rotated rectangle (see footprintMinRect). */
  footprintMaxRect(cx: number, cz: number, hw: number, hd: number, rot: number): number {
    return this.rectExtreme(cx, cz, hw, hd, rot, 1)
  }

  /** Least-squares plane through a 5x5 grid of ground samples over a rotated rectangle. */
  planeFit(cx: number, cz: number, hw: number, hd: number, rot: number): PlaneFit {
    const cs = Math.cos(rot), sn = Math.sin(rot)
    const hs: number[] = []
    let sum = 0, slx = 0, slz = 0
    // fit in the rect's own axes, where the grid is symmetric and the three sums decouple
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++) {
        const lx = (hw * (i - 2)) / 2
        const lz = (hd * (j - 2)) / 2
        const h = this.height(cx + cs * lx + sn * lz, cz - sn * lx + cs * lz)
        hs.push(h)
        sum += h
        slx += h * lx
        slz += h * lz
      }
    const y = sum / 25
    const p = hw > 0 ? slx / (12.5 * hw * hw) : 0 // 12.5 = sum over the grid of ((i-2)/2)^2
    const q = hd > 0 ? slz / (12.5 * hd * hd) : 0
    // local rise rates back to world axes (inverse of propUtil.at)
    const gx = p * cs + q * sn
    const gz = -p * sn + q * cs
    let above = 0, below = 0
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++) {
        const d = hs[i * 5 + j] - (y + (p * (hw * (i - 2))) / 2 + (q * (hd * (j - 2))) / 2)
        if (d > above) above = d
        if (-d > below) below = -d
      }
    const inv = 1 / Math.hypot(gx, 1, gz)
    return { y, gx, gz, normal: [-gx * inv, inv, -gz * inv], above, below }
  }

  /** max over the disc of sign * height (see footprintMin) */
  private discExtreme(x: number, z: number, r: number, sign: number): number {
    let best = sign * this.height(x, z)
    if (!(r > 0)) return best
    // the angles at which the rim crosses a line a triangle edge could lie on
    const c = this.latticeCell
    const angles: number[] = []
    for (const [ux, uz, k] of EDGE_LINES) {
      const spacing = k * c
      const along = ux * x + uz * z
      const dir = Math.atan2(uz, ux)
      for (let i = Math.ceil((along - r) / spacing); i <= Math.floor((along + r) / spacing); i++) {
        const t = Math.acos(Math.min(1, Math.max(-1, (i * spacing - along) / r)))
        angles.push((((dir + t) % TAU) + TAU) % TAU, (((dir - t) % TAU) + TAU) % TAU)
      }
    }
    if (!angles.length) angles.push(0)
    angles.sort((p, q) => p - q)
    for (let i = 0; i < angles.length; i++) {
      const a0 = angles[i]
      const a1 = i + 1 < angles.length ? angles[i + 1] : angles[0] + TAU
      let v = sign * this.height(x + r * Math.cos(a0), z + r * Math.sin(a0))
      if (v > best) best = v
      // Between two crossings the rim stays on one triangle, a plane, so the ground along it
      // peaks where the rim points straight up (or down) that plane's slope.
      const am = (a0 + a1) / 2
      this.height(x + r * Math.cos(am), z + r * Math.sin(am), rimNormal)
      if (rimNormal.x === 0 && rimNormal.z === 0) continue
      let at = Math.atan2(-sign * rimNormal.z, -sign * rimNormal.x)
      while (at < a0) at += TAU
      if (at >= a1) continue
      v = sign * this.height(x + r * Math.cos(at), z + r * Math.sin(at))
      if (v > best) best = v
    }
    return Math.max(best, this.latticeExtreme(x, z, r, r, sign, (dx, dz) => dx * dx + dz * dz <= r * r))
  }

  /** max over the rotated rect of sign * height (see footprintMinRect) */
  private rectExtreme(cx: number, cz: number, hw: number, hd: number, rot: number, sign: number): number {
    const cs = Math.cos(rot), sn = Math.sin(rot)
    let best = -Infinity
    // corners in world space, in order round the outline
    const corners = [-hw, -hd, hw, -hd, hw, hd, -hw, hd]
    for (let i = 0; i < 4; i++) {
      const lx = corners[i * 2], lz = corners[i * 2 + 1]
      corners[i * 2] = cx + cs * lx + sn * lz
      corners[i * 2 + 1] = cz - sn * lx + cs * lz
    }
    // Each side is tested at its start corner and wherever it crosses a line a triangle edge
    // could lie on; the ground is straight between those points.
    const c = this.latticeCell
    for (let e = 0; e < 4; e++) {
      const ax = corners[e * 2], az = corners[e * 2 + 1]
      const dx = corners[((e + 1) % 4) * 2] - ax, dz = corners[((e + 1) % 4) * 2 + 1] - az
      const v = sign * this.height(ax, az)
      if (v > best) best = v
      for (const [ux, uz, k] of EDGE_LINES) {
        const spacing = k * c
        const a = ux * ax + uz * az
        const b = a + ux * dx + uz * dz
        if (Math.abs(b - a) < 1e-12) continue
        for (let i = Math.ceil(Math.min(a, b) / spacing); i <= Math.floor(Math.max(a, b) / spacing); i++) {
          const t = (i * spacing - a) / (b - a)
          const v = sign * this.height(ax + dx * t, az + dz * t)
          if (v > best) best = v
        }
      }
    }
    const ex = Math.abs(cs) * hw + Math.abs(sn) * hd
    const ez = Math.abs(sn) * hw + Math.abs(cs) * hd
    return Math.max(
      best,
      this.latticeExtreme(cx, cz, ex, ez, sign, (dx, dz) => Math.abs(cs * dx - sn * dz) <= hw && Math.abs(sn * dx + cs * dz) <= hd),
    )
  }

  /**
   * max of sign * height over the lattice points (every heightfield pixel, so every mesh vertex)
   * within (ex, ez) of the centre that `inside` accepts; -Infinity if there are none
   */
  private latticeExtreme(cx: number, cz: number, ex: number, ez: number, sign: number, inside: (dx: number, dz: number) => boolean): number {
    const cell = this.latticeCell
    const ix0 = Math.ceil((cx - ex) / cell), ix1 = Math.floor((cx + ex) / cell)
    const iz0 = Math.ceil((cz - ez) / cell), iz1 = Math.floor((cz + ez) / cell)
    let best = -Infinity
    if (ix1 < ix0 || iz1 < iz0) return best
    let stride = 1
    while (((ix1 - ix0) / stride + 1) * ((iz1 - iz0) / stride + 1) > MAX_LATTICE) stride *= 2
    for (let iz = iz0; iz <= iz1; iz += stride)
      for (let ix = ix0; ix <= ix1; ix += stride) {
        if (!inside(ix * cell - cx, iz * cell - cz)) continue
        const v = sign * this.height(ix * cell, iz * cell)
        if (v > best) best = v
      }
    return best
  }
}

/** The drawn terrain: buildChunks' own triangles, read straight from the live heightfield. */
export class TerrainSurface extends GroundSurface {
  readonly seaLevel: number
  private readonly step: number
  private readonly nx: number
  private readonly nz: number
  private readonly cq: number
  private readonly ncx: number
  private readonly ncz: number
  /** per chunk, filled the first time something stands on it; refresh() clears entries */
  private readonly chunks: (ChunkInfo | undefined)[]

  constructor(
    readonly hf: Heightfield,
    opts: SurfaceOpts,
  ) {
    super()
    const { step, nx, nz } = chunkGrid(hf, opts)
    this.step = step
    this.nx = Math.max(1, nx)
    this.nz = Math.max(1, nz)
    this.cq = opts.chunkQuads
    this.ncx = Math.ceil(this.nx / this.cq)
    this.ncz = Math.ceil(this.nz / this.cq)
    this.chunks = new Array(this.ncx * this.ncz)
    this.seaLevel = opts.seaLevel
  }

  protected get latticeCell() {
    return this.hf.cell
  }

  private chunk(cx: number, cz: number): ChunkInfo {
    const i = cz * this.ncx + cx
    let c = this.chunks[i]
    if (!c) {
      const step = this.step
      const { px0, px1, pz0, pz1 } = chunkPixels(cx, cz, this.cq, step, this.nx, this.nz)
      const fine = step > 1 && isMountainChunk(this.hf, px0, px1, pz0, pz1)
      c = { fine, px0, px1, pz0, pz1, at: makeVertexSampler(this.hf, px0, px1, pz0, pz1, step, fine) }
      this.chunks[i] = c
    }
    return c
  }

  /**
   * Height of the drawn triangle under (x, z); writes that triangle's unit normal into
   * `outNormal` when given. Outside the meshed area the edge height carries on flat.
   */
  height(x: number, z: number, outNormal?: Vector3): number {
    const cell = this.hf.cell
    const step = this.step
    let gx = x / cell
    let gz = z / cell
    const gMaxX = this.nx * step
    const gMaxZ = this.nz * step
    gx = gx < 0 ? 0 : gx > gMaxX ? gMaxX : gx
    gz = gz < 0 ? 0 : gz > gMaxZ ? gMaxZ : gz
    let qx = Math.floor(gx / step)
    let qz = Math.floor(gz / step)
    if (qx >= this.nx) qx = this.nx - 1
    if (qz >= this.nz) qz = this.nz - 1
    const c = this.chunk(Math.floor(qx / this.cq), Math.floor(qz / this.cq))
    let s: number, x0: number, z0: number
    if (c.fine) {
      s = 1
      x0 = Math.min(c.px1 - 1, Math.max(c.px0, Math.floor(gx)))
      z0 = Math.min(c.pz1 - 1, Math.max(c.pz0, Math.floor(gz)))
    } else {
      s = step
      x0 = qx * step
      z0 = qz * step
    }
    const u = (gx - x0) / s
    const w = (gz - z0) / s
    const h00 = c.at(x0, z0)
    const h10 = c.at(x0 + s, z0)
    const h01 = c.at(x0, z0 + s)
    const h11 = c.at(x0 + s, z0 + s)
    // dhdu, dhdw: the triangle's rise per quad side along x and z
    let h: number, dhdu: number, dhdw: number
    if (splitsMainDiagonal(x0 / s, z0 / s)) {
      if (u >= w) {
        dhdu = h10 - h00
        dhdw = h11 - h10
      } else {
        dhdu = h11 - h01
        dhdw = h01 - h00
      }
      h = h00 + dhdu * u + dhdw * w
    } else if (u + w <= 1) {
      dhdu = h10 - h00
      dhdw = h01 - h00
      h = h00 + dhdu * u + dhdw * w
    } else {
      dhdu = h11 - h01
      dhdw = h11 - h10
      h = h11 - dhdu * (1 - u) - dhdw * (1 - w)
    }
    if (outNormal) {
      const L = s * cell
      outNormal.set(-dhdu / L, 1, -dhdw / L).normalize()
    }
    return h
  }

  /** Re-read the mountain flag of chunks the editor rebuilt (heights are always read live). */
  refresh(chunkKeys: Array<[number, number]>): void {
    for (const [cx, cz] of chunkKeys) if (cx >= 0 && cz >= 0 && cx < this.ncx && cz < this.ncz) this.chunks[cz * this.ncx + cx] = undefined
  }
}

/**
 * A GroundSurface over a plain height function. Normals come from central differences, and the
 * rect lattice samples every `latticeCell` metres since the mesh behind the function is unknown.
 */
export class FunctionSurface extends GroundSurface {
  constructor(
    readonly fn: (x: number, z: number) => number,
    readonly seaLevel: number,
    private readonly lattice = 1,
  ) {
    super()
  }

  protected get latticeCell() {
    return this.lattice
  }

  height(x: number, z: number, outNormal?: Vector3): number {
    const h = this.fn(x, z)
    if (outNormal) {
      const e = 0.25
      const sx = (this.fn(x + e, z) - this.fn(x - e, z)) / (2 * e)
      const sz = (this.fn(x, z + e) - this.fn(x, z - e)) / (2 * e)
      outNormal.set(-sx, 1, -sz).normalize()
    }
    return h
  }
}

const registry = new WeakMap<Heightfield, TerrainSurface>()

/** Build the surface for a world's heightfield and make it the one surfaceOf() returns. */
export function registerSurface(hf: Heightfield, opts: SurfaceOpts): TerrainSurface {
  const s = new TerrainSurface(hf, opts)
  registry.set(hf, s)
  return s
}

/**
 * The registered surface for a heightfield. Code that only has a heightfield (teleport, the
 * editor) reaches the drawn ground through this. Without a registration it falls back to a
 * surface meshed at the pixel grid, which is only exact for worlds drawn at that spacing.
 */
export function surfaceOf(hf: Heightfield): TerrainSurface {
  let s = registry.get(hf)
  if (!s) {
    if (import.meta.env?.DEV) console.warn('surfaceOf: no surface registered for this heightfield; using one meshed at the pixel grid')
    s = registerSurface(hf, { spacing: hf.cell, chunkQuads: CHUNK_QUADS, seaLevel: -Infinity })
  }
  return s
}

/** The current world's surface. */
export function useSurface(): TerrainSurface {
  return useWorld().surface
}
