/**
 * Shared helpers for procedural set pieces (overworld dressings and place-scale buildings).
 */
import * as THREE from 'three'
import type { Collider } from '@/player/colliderTypes'
import { FunctionSurface, type GroundSurface, type TerrainSurface } from '@/terrain/surface'
import { partMatrix, type Part } from '@/render/mergeColoured'
import type { Prop } from '@/world/schema'

export interface PropContext {
  /** world position of the prop origin */
  x: number
  z: number
  rot: number
  scale: number
  color?: string
  params: Record<string, unknown>
  ground: (x: number, z: number) => number
  /** the drawn terrain, when the caller has it; use surf(c) to read it either way */
  surface?: TerrainSurface
  seaLevel: number
  seed: number
  /** when present, solid pieces register colliders here (used inside places) */
  colliders?: Collider[]
}

export const P = (c: PropContext, key: string, fallback: number) => (typeof c.params[key] === 'number' ? (c.params[key] as number) : fallback)
export const S = (c: PropContext, key: string, fallback: string) => (typeof c.params[key] === 'string' ? (c.params[key] as string) : fallback)
export const B = (c: PropContext, key: string, fallback = false) => (typeof c.params[key] === 'boolean' ? (c.params[key] as boolean) : fallback)

/**
 * The context one prop is built with. buildProps and anything that must agree with a builder
 * (chimney smoke, map footprints) make it here, so they see the same position, rotation and
 * ground. `seed` is the prop's own seed: the world seed plus the prop's index in its landmark.
 */
export function makePropContext(
  landmark: { position: [number, number] },
  prop: Pick<Prop, 'offset' | 'rotation' | 'scale' | 'color' | 'params'>,
  surface: TerrainSurface,
  seaLevel: number,
  seed: number,
  colliders?: Collider[],
): PropContext {
  return {
    x: landmark.position[0] + prop.offset[0],
    z: landmark.position[1] + prop.offset[1],
    rot: prop.rotation,
    scale: prop.scale,
    color: prop.color,
    params: prop.params,
    ground: (x, z) => surface.height(x, z),
    surface,
    seaLevel,
    seed,
    colliders,
  }
}

// one adapter per ground function, so every prop built with the same function shares it
const adapters = new WeakMap<(x: number, z: number) => number, GroundSurface>()

/**
 * Footprint queries for a prop: its terrain surface, or the same queries over `c.ground` when
 * the caller only passed a height function.
 */
export function surf(c: PropContext): GroundSurface {
  if (c.surface) return c.surface
  let s = adapters.get(c.ground)
  if (!s) {
    s = new FunctionSurface(c.ground, c.seaLevel)
    adapters.set(c.ground, s)
  }
  return s
}

/** local (lx, lz) -> world, rotated about the prop origin */
export function at(c: PropContext, lx: number, lz: number): [number, number] {
  const cs = Math.cos(c.rot), sn = Math.sin(c.rot)
  return [c.x + cs * lx + sn * lz, c.z - sn * lx + cs * lz]
}

/** Lowest ground under a rect centred at local (lx, lz), half extents hw x hd, turned by `rot`. */
export function footMinRect(c: PropContext, lx: number, lz: number, hw: number, hd: number, rot = c.rot): number {
  const [x, z] = at(c, lx, lz)
  return surf(c).footprintMinRect(x, z, hw, hd, rot)
}
/** Highest ground under a rect centred at local (lx, lz). */
export function footMaxRect(c: PropContext, lx: number, lz: number, hw: number, hd: number, rot = c.rot): number {
  const [x, z] = at(c, lx, lz)
  return surf(c).footprintMaxRect(x, z, hw, hd, rot)
}
/** Lowest ground under a disc of radius r at local (lx, lz). */
export function footMinDisc(c: PropContext, lx: number, lz: number, r: number): number {
  const [x, z] = at(c, lx, lz)
  return surf(c).footprintMin(x, z, r)
}
/** Highest ground under a disc of radius r at local (lx, lz). */
export function footMaxDisc(c: PropContext, lx: number, lz: number, r: number): number {
  const [x, z] = at(c, lx, lz)
  return surf(c).footprintMax(x, z, r)
}

/**
 * Floor and footing for an upright building on a slope. The floor sits on the high side but is
 * never buried by more than `maxBury`; the footing (a stone plinth, a skirt) runs down to `foot`,
 * just below the lowest ground, so nothing shows air underneath.
 */
export function plinth(c: PropContext, hw: number, hd: number, maxBury = 0.45): { floor: number; foot: number } {
  const lo = footMinRect(c, 0, 0, hw, hd)
  const hi = footMaxRect(c, 0, 0, hw, hd)
  return { floor: Math.max(lo, hi - maxBury), foot: lo - 0.1 }
}

/** Lowest ground across a strip `depth` wide at local (lx, lz) (five samples along local z). */
export function minAcross(c: PropContext, lx: number, lz: number, depth: number): number {
  let m = Infinity
  for (const v of [-0.5, -0.25, 0, 0.25, 0.5]) {
    const [x, z] = at(c, lx, lz + v * depth)
    const h = c.ground(x, z)
    if (h < m) m = h
  }
  return m
}

/**
 * A strip from local x = lx0 to lx1 centred on local z = lz, `depth` deep, whose bottom follows
 * foot(lx) and top follows top(lx): hedges, wall runs, rails and quays that follow the ground
 * instead of stepping. Returned in world space, so use it as a Part with no transform.
 */
export function groundStrip(
  c: PropContext,
  lx0: number,
  lx1: number,
  lz: number,
  depth: number,
  foot: (lx: number) => number,
  top: (lx: number) => number,
  seg = 0.5,
): THREE.BufferGeometry {
  // run low to high so the box's faces keep pointing outward
  if (lx1 < lx0) [lx0, lx1] = [lx1, lx0]
  const n = Math.max(1, Math.ceil((lx1 - lx0) / seg))
  const g = new THREE.BoxGeometry(1, 1, depth, n, 1, 1).toNonIndexed()
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const lx = lx0 + (pos.getX(i) + 0.5) * (lx1 - lx0)
    const [x, z] = at(c, lx, lz + pos.getZ(i))
    pos.setXYZ(i, x, pos.getY(i) < 0 ? foot(lx) : top(lx), z)
  }
  g.deleteAttribute('uv')
  g.computeVertexNormals()
  return g
}

const up = new THREE.Vector3(0, 1, 0)
const nrm = new THREE.Vector3()
const quat = new THREE.Quaternion()
const spin = new THREE.Quaternion()

/**
 * Seat a rigid piece built at the origin (carts, fallen stones) on the ground: tilted to the
 * ground's plane (at most `maxTilt` radians from upright), turned by c.rot, and lowered until no
 * corner of the footprint shows air, plus `sink`. Give the result to each Part as `matrix`.
 */
export function onPlane(c: PropContext, hw: number, hd: number, maxTilt = 0.3, sink = 0.03): THREE.Matrix4 {
  const s = surf(c)
  const fit = s.planeFit(c.x, c.z, hw, hd, c.rot)
  let gx = fit.gx, gz = fit.gz
  const g = Math.hypot(gx, gz)
  const maxG = Math.tan(maxTilt)
  if (g > maxG) {
    gx *= maxG / g
    gz *= maxG / g
  }
  // with the tilt clamped the plane no longer fits, so measure the gap under it again
  let gap = 0
  const cs = Math.cos(c.rot), sn = Math.sin(c.rot)
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 5; j++) {
      const lx = (hw * (i - 2)) / 2, lz = (hd * (j - 2)) / 2
      const dx = cs * lx + sn * lz, dz = -sn * lx + cs * lz
      const d = fit.y + gx * dx + gz * dz - s.height(c.x + dx, c.z + dz)
      if (d > gap) gap = d
    }
  nrm.set(-gx, 1, -gz).normalize()
  quat.setFromUnitVectors(up, nrm).multiply(spin.setFromAxisAngle(up, c.rot))
  return new THREE.Matrix4().compose(new THREE.Vector3(c.x, fit.y - sink - gap, c.z), quat, new THREE.Vector3(1, 1, 1))
}

/** Optional explicit height band for a solid (world y), instead of ground + height. */
export interface SolidExtra {
  top?: number
  bottom?: number
}

/** Register a solid box (local centre, half extents) if the context collects colliders. */
export function solidBox(c: PropContext, lx: number, lz: number, hw: number, hd: number, height = 4, rot = c.rot, extra?: SolidExtra) {
  if (!c.colliders) return
  const [x, z] = at(c, lx, lz)
  c.colliders.push({ kind: 'box', x, z, hw, hd, rot, top: extra?.top ?? c.ground(x, z) + height, bottom: extra?.bottom })
}
export function solidCircle(c: PropContext, lx: number, lz: number, r: number, height = 4, extra?: SolidExtra) {
  if (!c.colliders) return
  const [x, z] = at(c, lx, lz)
  c.colliders.push({ kind: 'circle', x, z, r, top: extra?.top ?? c.ground(x, z) + height, bottom: extra?.bottom })
}
/** A solid circle at a world position, for kinds that place their pieces in world coordinates. */
export function solidAtWorld(c: PropContext, x: number, z: number, r: number, height: number) {
  if (!c.colliders) return
  c.colliders.push({ kind: 'circle', x, z, r, top: c.ground(x, z) + height })
}

const pm = new THREE.Matrix4()
const pv = new THREE.Vector3()
/**
 * A solid box over the world-space XZ extent of a part as it will be drawn (after its
 * transform and matrix), axis-aligned: for pieces with no simple local footprint, like a
 * fallen stone.
 */
export function solidFromPart(c: PropContext, part: Part, height: number) {
  if (!c.colliders) return
  partMatrix(part, pm)
  const pos = part.geo.attributes.position
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (let i = 0; i < pos.count; i++) {
    pv.fromBufferAttribute(pos, i).applyMatrix4(pm)
    if (pv.x < x0) x0 = pv.x
    if (pv.x > x1) x1 = pv.x
    if (pv.z < z0) z0 = pv.z
    if (pv.z > z1) z1 = pv.z
  }
  if (x1 < x0) return
  const x = (x0 + x1) / 2, z = (z0 + z1) / 2
  c.colliders.push({ kind: 'box', x, z, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2, rot: 0, top: c.ground(x, z) + height })
}

/**
 * A gable roof with a realistic pitch: `rise` is apex height as a fraction of width (0.45 ≈ 42°).
 * Position it at wallTop + roofBase(geo) so the eaves sit on the walls.
 */
export function gableRoofLow(width: number, length: number, rise = 0.45): THREE.BufferGeometry {
  const r = (width * 1.18) / Math.sqrt(3)
  const g = gableRoof(width, length)
  const k = (rise * width) / (1.5 * r)
  g.scale(1, k, 1)
  g.userData.base = 0.5 * r * k
  return g
}
export const roofBase = (g: THREE.BufferGeometry) => (g.userData.base as number) ?? 0

/** Nearest point within `maxR` metres whose ground is at least `depth` below sea level (spiral search). */
export function findWater(c: PropContext, maxR = 60, depth = 1.2): [number, number] {
  if (c.ground(c.x, c.z) < c.seaLevel - depth) return [c.x, c.z]
  for (let r = 4; r <= maxR; r += 4) {
    const n = Math.ceil((2 * Math.PI * r) / 4)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const x = c.x + Math.cos(a) * r
      const z = c.z + Math.sin(a) * r
      if (c.ground(x, z) < c.seaLevel - depth) return [x + Math.cos(a) * 3, z + Math.sin(a) * 3]
    }
  }
  return [c.x, c.z]
}

/**
 * Nearest spot (spiral search up to `maxR`) where the ground within `footprint` metres is level
 * enough: max height difference under `tolerance`. Pools and big trees use it so they never
 * end up pasted onto a mountainside when a landmark sits at the foot of a cliff.
 */
export function findLevel(c: PropContext, footprint: number, tolerance = 1.5, maxR = 40): [number, number] {
  const spread = (x: number, z: number) => {
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const h = c.ground(x + Math.cos(a) * footprint, z + Math.sin(a) * footprint)
      if (h < lo) lo = h
      if (h > hi) hi = h
    }
    const h0 = c.ground(x, z)
    return Math.max(hi, h0) - Math.min(lo, h0)
  }
  if (spread(c.x, c.z) <= tolerance) return [c.x, c.z]
  let best: [number, number] = [c.x, c.z]
  let bestSpread = Infinity
  for (let r = 4; r <= maxR; r += 4) {
    const n = Math.ceil((2 * Math.PI * r) / 4)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r
      if (c.ground(x, z) < c.seaLevel + 0.5) continue
      const s = spread(x, z)
      if (s <= tolerance) return [x, z]
      if (s < bestSpread) {
        bestSpread = s
        best = [x, z]
      }
    }
  }
  return best
}

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
export const cyl = (rt: number, rb: number, h: number, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg)
export const cone = (r: number, h: number, seg = 8) => new THREE.ConeGeometry(r, h, seg)
export const sphere = (r: number, w = 10, h = 7) => new THREE.SphereGeometry(r, w, h)
export const dome = (r: number) => new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)
export const dodeca = (r: number) => new THREE.DodecahedronGeometry(r, 0)
/** vertical disc facing local +z (doors, wheels seen from the front) */
export const disc = (r: number, th: number, seg = 14) => {
  const g = new THREE.CylinderGeometry(r, r, th, seg)
  g.rotateX(Math.PI / 2)
  return g
}

/** A roof prism whose ridge runs along local Z. */
export function gableRoof(width: number, length: number): THREE.BufferGeometry {
  const r = (width * 1.18) / Math.sqrt(3)
  const g = new THREE.CylinderGeometry(r, r, length * 1.08, 3)
  g.rotateX(Math.PI / 2)
  g.rotateZ(Math.PI / 2)
  return g
}
