/**
 * Skeletons of thin raster features. The overworld's roads exist only as a 1–2 cell wide `road`
 * biome; thinning that to a one-cell centreline and tracing it gives polylines the map can smooth
 * and draw as dashed roads instead of painting stair-stepped cells.
 */

/** Zhang-Suen thinning: a copy of `mask` (non-zero = set) reduced to a 1-cell wide skeleton. */
export function zhangSuen(mask: ArrayLike<number>, w: number, h: number, maxIterations = 40): Uint8Array {
  const M = new Uint8Array(w * h)
  for (let i = 0; i < M.length; i++) M[i] = mask[i] ? 1 : 0
  const g = (i: number, j: number) => (i >= 0 && j >= 0 && i < w && j < h ? M[j * w + i] : 0)
  const n = new Array<number>(8)
  const del: number[] = []
  for (let it = 0; it < maxIterations; it++) {
    let changed = false
    for (let step = 0; step < 2; step++) {
      del.length = 0
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          if (!M[j * w + i]) continue
          // P2..P9 clockwise from north
          n[0] = g(i, j - 1)
          n[1] = g(i + 1, j - 1)
          n[2] = g(i + 1, j)
          n[3] = g(i + 1, j + 1)
          n[4] = g(i, j + 1)
          n[5] = g(i - 1, j + 1)
          n[6] = g(i - 1, j)
          n[7] = g(i - 1, j - 1)
          const B = n[0] + n[1] + n[2] + n[3] + n[4] + n[5] + n[6] + n[7]
          if (B < 2 || B > 6) continue
          let A = 0
          for (let q = 0; q < 8; q++) if (!n[q] && n[(q + 1) % 8]) A++
          if (A !== 1) continue
          if (step === 0 ? n[0] * n[2] * n[4] || n[2] * n[4] * n[6] : n[0] * n[2] * n[6] || n[0] * n[4] * n[6]) continue
          del.push(j * w + i)
        }
      }
      for (const d of del) M[d] = 0
      if (del.length) changed = true
    }
    if (!changed) break
  }
  return M
}

/**
 * Traces a 1-cell skeleton into polylines (flat [x0, y0, ...] arrays in grid units). Walks start
 * at end points and junctions (8-neighbour degree ≠ 2) and mark each step's edge as used, so a
 * junction gets one line per branch; what is left afterwards are loops. Lines shorter than
 * `minPoints` are dropped as specks.
 */
export function traceSkeleton(skel: ArrayLike<number>, w: number, h: number, minPoints = 3): number[][] {
  const on = (i: number, j: number) => i >= 0 && j >= 0 && i < w && j < h && !!skel[j * w + i]
  const nbrs = (i: number, j: number): number[] => {
    const o: number[] = []
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && on(i + di, j + dj)) o.push(i + di, j + dj)
    return o
  }
  const used = new Set<number>()
  // an undirected edge between two cells; neighbouring cells differ by at most w + 1 in index
  const ek = (a: number, b: number) => (a < b ? a * 8 + edgeDir(a, b, w) : b * 8 + edgeDir(b, a, w))
  const lines: number[][] = []
  const walk = (i: number, j: number, ni: number, nj: number) => {
    const pts = [i, j]
    let pi = i
    let pj = j
    let ci = ni
    let cj = nj
    for (;;) {
      used.add(ek(pj * w + pi, cj * w + ci))
      pts.push(ci, cj)
      const nb = nbrs(ci, cj)
      if (nb.length !== 4) break // end point or junction
      let nx = -1
      let ny = -1
      for (let q = 0; q < nb.length; q += 2) {
        if (!used.has(ek(cj * w + ci, nb[q + 1] * w + nb[q]))) {
          nx = nb[q]
          ny = nb[q + 1]
        }
      }
      if (nx < 0) break
      pi = ci
      pj = cj
      ci = nx
      cj = ny
    }
    if (pts.length / 2 >= minPoints) lines.push(pts)
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (!skel[j * w + i]) continue
        const nb = nbrs(i, j)
        // first pass: start only at ends and junctions; second pass picks up loops
        if (pass === 0 && nb.length === 4) continue
        for (let q = 0; q < nb.length; q += 2) {
          if (!used.has(ek(j * w + i, nb[q + 1] * w + nb[q]))) walk(i, j, nb[q], nb[q + 1])
        }
      }
    }
  }
  return lines
}

/** Direction code 0..3 from cell a to a later cell b (E, SW, S, SE): unique per neighbour pair. */
function edgeDir(a: number, b: number, w: number): number {
  const d = b - a
  return d === 1 ? 0 : d === w - 1 ? 1 : d === w ? 2 : 3
}
