/**
 * Helpers shared by the place-scale kinds (placeKinds.ts and the kinds in ./kinds): pieces placed
 * in a prop's local axes with world-y bottoms and tops, door steps and short stairs that register
 * decks, and seating a thin piece on the ground. Kept apart from placeKinds.ts so kinds in their
 * own files can use them without importing that file (which imports them).
 */
import * as THREE from 'three'
import type { Part } from '@/render/mergeColoured'
import { type PropContext, at, footMinRect, footMaxRect, groundStrip, onPlane, box } from './propUtil'

export const STEP_STONE = '#b8ad98'

/** World (x, z) -> the prop's local coordinates: the inverse of propUtil.at. */
export function toLocal(c: PropContext, x: number, z: number): [number, number] {
  const cs = Math.cos(c.rot), sn = Math.sin(c.rot)
  const dx = x - c.x, dz = z - c.z
  return [cs * dx - sn * dz, sn * dx + cs * dz]
}

/** A box in local axes whose bottom and top are given in world y (posts, skirts, legs). */
export function column(c: PropContext, out: Part[], lx: number, lz: number, w: number, d: number, bottom: number, top: number, color: string) {
  const [x, z] = at(c, lx, lz)
  out.push({ geo: box(w, top - bottom, d), color, position: [x, (top + bottom) / 2, z], rotation: [0, c.rot, 0] })
}

/**
 * A straight rail from (lx0, y0) to (lx1, y1) along local z = lz, `th` tall and `depth` deep:
 * fence rails that slope from post to post instead of stepping.
 */
export function rail(c: PropContext, lx0: number, y0: number, lx1: number, y1: number, lz: number, th: number, depth: number): THREE.BufferGeometry {
  const at01 = (lx: number) => y0 + ((y1 - y0) * (lx - lx0)) / (lx1 - lx0)
  return groundStrip(c, lx0, lx1, lz, depth, at01, (lx) => at01(lx) + th, Math.abs(lx1 - lx0) + 1)
}

/**
 * A walkable surface from local z = z0 to z1 (front to back of the piece) and lx +- hw across,
 * at y0 where it starts and y1 where it ends: door steps and doorsteps, which the traveller
 * climbs like a short bridge deck instead of wading through them.
 */
export function stepDeck(c: PropContext, lx: number, z0: number, z1: number, hw: number, y0: number, y1: number) {
  if (!c.colliders) return
  const [x, z] = at(c, lx, (z0 + z1) / 2)
  // a deck's height runs along its own local x; turned a quarter back, that is this piece's +z
  c.colliders.push({ kind: 'deck', x, z, hw: Math.abs(z1 - z0) / 2, hd: hw, rot: c.rot - Math.PI / 2, yA: y0, yB: y1, arc: 0 })
}

/**
 * Steps from a door sill at `floor` down to the ground in front of a wall face at local z = lz,
 * when the ground there has dropped more than 0.2 m: treads 0.35 m deep, each reaching down to its
 * own ground and each a deck to stand on. They share the drop evenly, 0.3 m a tread or less up to
 * eight treads (a 2.4 m drop, a stair for a mill on a tall river-side base); a taller drop keeps
 * the eight and each rises an eighth of it, which stays an easy step (STEP_UP) up to a 6.8 m drop.
 * Call it last in a builder, so the rest of the part list is the same on any ground.
 */
export function doorSteps(c: PropContext, out: Part[], lx: number, lz: number, hw: number, floor: number) {
  const drop = floor - footMinRect(c, lx, lz + 0.35, hw, 0.35)
  if (drop <= 0.2) return
  const n = Math.min(8, Math.ceil(drop / 0.3))
  for (let k = 0; k < n; k++) {
    const top = floor - (k * drop) / n
    const tz = lz + 0.35 * (k + 0.5)
    // a long stair can meet ground that rises again further out: stop where it has
    if (k > 0 && top < footMaxRect(c, lx, tz, hw, 0.175) + 0.1) break
    const bottom = Math.min(top - 0.1, footMinRect(c, lx, tz, hw, 0.175) - 0.1)
    column(c, out, lx, tz, hw * 2, 0.35, bottom, top, STEP_STONE)
    stepDeck(c, lx, tz - 0.175, tz + 0.175, hw, top, top)
  }
}

/**
 * Tread tops for a stair from a sill at `top` (a deck ending at local z = lz) down a slope in
 * front of it, treads 0.35 m deep and lx +- hw across. Unlike doorSteps, the ground here keeps
 * falling past the first tread (a smial dug into a hillside), so the stair is planned against the
 * ground where it ends: the fewest treads (up to eight) that share the drop from the sill to the
 * ground beyond the last one at 0.3 m a step or less, or eight sharing it evenly when more would
 * be needed. A stair stops early where the ground rises to meet it. Empty when the sill is an easy
 * step above the ground in front.
 */
export function stairPlan(c: PropContext, lx: number, lz: number, hw: number, top: number): number[] {
  const ground = (k: number) => footMaxRect(c, lx, lz + 0.35 * (k + 0.5), hw, 0.175)
  if (top - ground(0) <= 0.3) return []
  let n = 1
  while (n < 8 && (top - ground(n)) / (n + 1) > 0.3) n++
  const rise = (top - ground(n)) / (n + 1)
  const treads: number[] = []
  for (let k = 0; k < n; k++) {
    const y = top - rise * (k + 1)
    if (y < ground(k) + 0.1) break
    treads.push(y)
  }
  return treads
}

/** Build the treads stairPlan laid out (a few steps before a door; the `stair` kind is the long flight): each down to its own ground and a deck to stand on. */
export function stairTreads(c: PropContext, out: Part[], lx: number, lz: number, hw: number, treads: number[]) {
  treads.forEach((top, k) => {
    const tz = lz + 0.35 * (k + 0.5)
    const bottom = Math.min(top - 0.1, footMinRect(c, lx, tz, hw, 0.175) - 0.1)
    column(c, out, lx, tz, hw * 2, 0.35, bottom, top, STEP_STONE)
    stepDeck(c, lx, tz - 0.175, tz + 0.175, hw, top, top)
  })
}

const inv = new THREE.Matrix4()
const probe = new THREE.Vector3()

/**
 * Seat a thin round piece (a stepping stone) on the ground at the context's origin: tilted with
 * the slope like onPlane, and returned with how far the ground rises above that seated plane
 * anywhere under it, so the piece can be made that much thicker instead of vanishing under a
 * crease or bump.
 */
export function laid(c: PropContext, r: number, maxTilt: number): { matrix: THREE.Matrix4; above: number } {
  const matrix = onPlane(c, r, r, maxTilt, 0)
  inv.copy(matrix).invert()
  let above = 0
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 5; j++) {
      const dx = (r * (i - 2)) / 2, dz = (r * (j - 2)) / 2
      if (dx * dx + dz * dz > r * r) continue
      probe.set(c.x + dx, c.ground(c.x + dx, c.z + dz), c.z + dz).applyMatrix4(inv)
      if (probe.y > above) above = probe.y
    }
  return { matrix, above }
}
