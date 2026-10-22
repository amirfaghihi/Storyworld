/**
 * Line simplification and smoothing on flat [x0, y0, x1, y1, ...] arrays.
 *
 * Traced outlines follow the grid, so they carry a stair-step at cell scale. Douglas-Peucker with
 * an epsilon near the step size removes the steps (and most of the points); a pass or two of
 * Chaikin corner cutting then rounds what is left into the curves a hand-drawn map would have.
 */

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax
  const vy = by - ay
  const L2 = vx * vx + vy * vy
  if (L2 === 0) return Math.hypot(px - ax, py - ay)
  return Math.abs(vx * (ay - py) - (ax - px) * vy) / Math.sqrt(L2)
}

/** Keeps the points of pts[a..b] (point indices) that DP marks, writing flags into keep. */
function dpRange(pts: ArrayLike<number>, a: number, b: number, eps: number, keep: Uint8Array) {
  const stack = [a, b]
  keep[a] = 1
  keep[b] = 1
  while (stack.length) {
    const hi = stack.pop()!
    const lo = stack.pop()!
    const ax = pts[2 * lo]
    const ay = pts[2 * lo + 1]
    const bx = pts[2 * hi]
    const by = pts[2 * hi + 1]
    let best = 0
    let bi = -1
    for (let q = lo + 1; q < hi; q++) {
      const d = segDist(pts[2 * q], pts[2 * q + 1], ax, ay, bx, by)
      if (d > best) {
        best = d
        bi = q
      }
    }
    if (bi >= 0 && best > eps) {
      keep[bi] = 1
      stack.push(lo, bi, bi, hi)
    }
  }
}

/**
 * Douglas-Peucker (iterative). For a ring (closed = true, first point not repeated) the ring is
 * split at its first point and the point farthest from it, and each half is simplified.
 */
export function douglasPeucker(pts: number[], eps: number, closed = false): number[] {
  const n = pts.length / 2
  if (n < 3) return pts.slice()
  const keep = new Uint8Array(n + (closed ? 1 : 0))
  if (closed) {
    // treat as an open line from point 0 round to point 0 again
    const ext = pts.concat(pts[0], pts[1])
    let far = 1
    let fd = -1
    for (let q = 1; q < n; q++) {
      const d = Math.hypot(pts[2 * q] - pts[0], pts[2 * q + 1] - pts[1])
      if (d > fd) {
        fd = d
        far = q
      }
    }
    dpRange(ext, 0, far, eps, keep)
    dpRange(ext, far, n, eps, keep)
    const out: number[] = []
    for (let q = 0; q < n; q++) if (keep[q]) out.push(pts[2 * q], pts[2 * q + 1])
    return out
  }
  dpRange(pts, 0, n - 1, eps, keep)
  const out: number[] = []
  for (let q = 0; q < n; q++) if (keep[q]) out.push(pts[2 * q], pts[2 * q + 1])
  return out
}

/** Chaikin corner cutting. Open lines keep their end points; rings stay rings. */
export function chaikin(pts: number[], iterations = 1, closed = false): number[] {
  let cur = pts
  for (let it = 0; it < iterations; it++) {
    const n = cur.length / 2
    if (n < 3) return cur
    const out: number[] = []
    if (!closed) out.push(cur[0], cur[1])
    const segs = closed ? n : n - 1
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n
      const ax = cur[2 * i]
      const ay = cur[2 * i + 1]
      const bx = cur[2 * j]
      const by = cur[2 * j + 1]
      out.push(ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25, ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75)
    }
    if (!closed) out.push(cur[2 * n - 2], cur[2 * n - 1])
    cur = out
  }
  return cur
}

/** Total length of a polyline (closing segment included for rings). */
export function polylineLength(pts: ArrayLike<number>, closed = false): number {
  const n = pts.length / 2
  let L = 0
  for (let i = 1; i < n; i++) L += Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1])
  if (closed && n > 2) L += Math.hypot(pts[0] - pts[2 * n - 2], pts[1] - pts[2 * n - 1])
  return L
}
