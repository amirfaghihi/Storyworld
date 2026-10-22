/**
 * `flowerPatch`: a drift of small white flowers in the grass, simbelmynë on the mounds of the kings
 * (TT and App. A: white on their western sides, Helm's white all over). The scatter's `white` family
 * only recolours its few default flowers, so a mound that must read white from the road needs its
 * own blossoms.
 *
 * Each blossom is an open three-sided cup pointing down (three triangles) whose faces look inward
 * and up, so it reads as a small white star from above and from the side alike. Blossoms sit on
 * the drawn ground where each one stands, so a patch rides the mound under it. Positions are
 * uniform in a disc of `radius`, thinning toward its rim, limited by `side` to the half-disc facing
 * that WORLD direction (rotation is ignored), with a soft edge across the middle. No colliders.
 * One geometry per colour, in world space.
 */
import * as THREE from 'three'
import type { Part } from '@/render/mergeColoured'
import { hash2 } from '@/terrain/faceColors'
import { type PropContext, P, S, B } from '../propUtil'

/** World direction each `side` faces (+x east, +z south). */
const SIDES: Record<string, [number, number]> = { west: [-1, 0], east: [1, 0], north: [0, -1], south: [0, 1] }

export function flowerPatch(c: PropContext, out: Part[]): void {
  const R = P(c, 'radius', 6)
  const count = Math.max(0, Math.round(P(c, 'count', 80)))
  const size = P(c, 'size', 0.09)
  const colors = S(c, 'colors', '#ffffff,#f4f0ff')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const dir = SIDES[S(c, 'side', 'all')]
  const glow = B(c, 'glow')
  if (!colors.length || count === 0 || R <= 0) return

  // two patches given the same seed (index 0 of two spots) must not share a pattern: salt the
  // seed with where the patch stands
  const seed = (c.seed * 7919 + Math.round(c.x * 10) * 31 + Math.round(c.z * 10) * 17) | 0
  const rnd = (i: number, k: number) => hash2(seed + k * 1013, i)
  // the soft edge across a half-disc, and the thinning toward the rim, in metres
  const edge = 0.15 * R
  const rim = 0.3 * R
  // cup: rim `size` round, `depth` deep, its point `lift` above the ground under it
  const depth = size * 1.2
  const lift = 0.05
  const verts: number[][] = colors.map(() => [])

  let placed = 0
  for (let i = 0; placed < count && i < count * 4; i++) {
    // uniform in the disc, then thinned: toward the rim, and across the half-disc's edge
    const a = rnd(i, 1) * Math.PI * 2
    const d = Math.sqrt(rnd(i, 2)) * R
    const ox = Math.cos(a) * d, oz = Math.sin(a) * d
    let keep = Math.min(1, (R - d) / rim)
    if (dir) keep *= Math.min(1, Math.max(0, (ox * dir[0] + oz * dir[1] + edge) / (2 * edge)))
    if (rnd(i, 3) >= keep) continue
    const x = c.x + ox, z = c.z + oz
    const g = c.ground(x, z)
    if (g < c.seaLevel + 0.05) continue // not in water
    placed++
    const y = g + lift
    const turn = rnd(i, 4) * Math.PI * 2
    const s = size * (0.8 + 0.4 * rnd(i, 5))
    const ring = [0, 1, 2].map((k): [number, number] => [x + Math.cos(turn + (k * 2 * Math.PI) / 3) * s, z + Math.sin(turn + (k * 2 * Math.PI) / 3) * s])
    const v = verts[Math.floor(rnd(i, 6) * colors.length) % colors.length]
    for (let k = 0; k < 3; k++) {
      const [px, pz] = ring[k], [qx, qz] = ring[(k + 1) % 3]
      // wound (point, next, this) so the face looks up and into the cup
      v.push(x, y, z, qx, y + depth, qz, px, y + depth, pz)
    }
  }
  verts.forEach((v, k) => {
    if (!v.length) return
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
    out.push({ geo, color: colors[k], unlit: glow || undefined })
  })
}
