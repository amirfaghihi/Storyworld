/**
 * Candidate anchor points for a region's name: interior points of its polygon (minus holes, such
 * as a smaller region nested inside it), clipped to the map bounds, ranked by how far they are
 * from the nearest edge. The label solver tries them in order and keeps the first that fits, so
 * a name sits in the roomiest part of the region rather than at its vertex average, which can
 * fall outside a crescent-shaped region or off the map.
 */
export type Pt = [number, number]

export interface LabelCandidate {
  x: number
  z: number
  /** distance to the nearest edge of the polygon, a hole or the bounds, in the polygon's units */
  clearance: number
}

export function pointInPolygon(x: number, z: number, poly: readonly Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

function edgeDistance(x: number, z: number, poly: readonly Pt[]): number {
  let best = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j]
    const [bx, bz] = poly[i]
    const vx = bx - ax
    const vz = bz - az
    const L2 = vx * vx + vz * vz || 1
    const t = Math.min(1, Math.max(0, ((x - ax) * vx + (z - az) * vz) / L2))
    const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t))
    if (d < best) best = d
  }
  return best
}

/**
 * Samples a grid over the polygon's box (clipped to `bounds` [x0, z0, x1, z1]), keeps interior
 * points outside every hole, and returns up to `n`, best clearance first, spread out so two
 * candidates are never closer than a quarter of the best clearance.
 */
export function regionCandidates(polygon: readonly Pt[], holes: readonly (readonly Pt[])[] = [], bounds?: readonly [number, number, number, number], n = 12): LabelCandidate[] {
  if (polygon.length < 3) return []
  let x0 = Infinity
  let z0 = Infinity
  let x1 = -Infinity
  let z1 = -Infinity
  for (const [x, z] of polygon) {
    x0 = Math.min(x0, x)
    z0 = Math.min(z0, z)
    x1 = Math.max(x1, x)
    z1 = Math.max(z1, z)
  }
  if (bounds) {
    x0 = Math.max(x0, bounds[0])
    z0 = Math.max(z0, bounds[1])
    x1 = Math.min(x1, bounds[2])
    z1 = Math.min(z1, bounds[3])
  }
  if (x1 <= x0 || z1 <= z0) return []
  const steps = 24
  const dx = (x1 - x0) / steps
  const dz = (z1 - z0) / steps
  const pts: LabelCandidate[] = []
  for (let j = 0; j < steps; j++) {
    for (let i = 0; i < steps; i++) {
      const x = x0 + (i + 0.5) * dx
      const z = z0 + (j + 0.5) * dz
      if (!pointInPolygon(x, z, polygon)) continue
      if (holes.some((h) => h.length >= 3 && pointInPolygon(x, z, h))) continue
      let c = edgeDistance(x, z, polygon)
      for (const h of holes) if (h.length >= 3) c = Math.min(c, edgeDistance(x, z, h))
      if (bounds) c = Math.min(c, x - bounds[0], bounds[2] - x, z - bounds[1], bounds[3] - z)
      if (c > 0) pts.push({ x, z, clearance: c })
    }
  }
  pts.sort((a, b) => b.clearance - a.clearance)
  const out: LabelCandidate[] = []
  const minGap = pts.length ? pts[0].clearance * 0.25 : 0
  for (const p of pts) {
    if (out.length >= n) break
    if (out.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < minGap)) continue
    out.push(p)
  }
  return out
}
