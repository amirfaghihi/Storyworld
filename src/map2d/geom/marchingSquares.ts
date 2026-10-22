/**
 * Marching squares: the iso-line of a grid field at one value, as joined polylines.
 *
 * Each crossing point belongs to a grid edge, and two neighbouring cells reach the same crossing
 * through the same edge id (horizontal edge (i, j)→(i+1, j) is 2·(j·w + i), vertical edge
 * (i, j)→(i, j+1) is 2·(j·w + i) + 1). Joining segments through those ids makes the endpoints
 * match exactly, so a coastline comes out as one ring rather than thousands of loose segments.
 */
export interface IsoLine {
  /** x, y pairs in grid units (x = column, y = row) */
  pts: number[]
  /** true when the line is a ring (the first point is not repeated at the end) */
  closed: boolean
}

// edge id -> slot + 1 (0 = none); reused between calls and cleared entry by entry, since a
// field of a few hundred thousand cells has only a few thousand crossings
let slotBuf = new Int32Array(0)

export function isoLines(f: ArrayLike<number>, w: number, h: number, iso: number): IsoLine[] {
  if (slotBuf.length < 2 * w * h) slotBuf = new Int32Array(2 * w * h)
  const slotOf = slotBuf
  const ids: number[] = []
  const px: number[] = []
  const py: number[] = []
  const n0: number[] = []
  const n1: number[] = []

  const slot = (id: number, x: number, y: number): number => {
    const s = slotOf[id]
    if (s) return s - 1
    ids.push(id)
    px.push(x)
    py.push(y)
    n0.push(-1)
    n1.push(-1)
    slotOf[id] = px.length
    return px.length - 1
  }
  const top = (i: number, j: number) => {
    const id = 2 * (j * w + i)
    if (slotOf[id]) return slotOf[id] - 1
    const a = f[j * w + i]
    return slot(id, i + (iso - a) / (f[j * w + i + 1] - a), j)
  }
  const left = (i: number, j: number) => {
    const id = 2 * (j * w + i) + 1
    if (slotOf[id]) return slotOf[id] - 1
    const a = f[j * w + i]
    return slot(id, i, j + (iso - a) / (f[(j + 1) * w + i] - a))
  }
  const link = (a: number, b: number) => {
    if (n0[a] < 0) n0[a] = b
    else n1[a] = b
    if (n0[b] < 0) n0[b] = a
    else n1[b] = a
  }

  for (let j = 0; j < h - 1; j++) {
    const r0 = j * w
    const r1 = r0 + w
    let vb = f[r0]
    let vc = f[r1]
    for (let i = 0; i < w - 1; i++) {
      const va = vb
      const vd = vc
      vb = f[r0 + i + 1]
      vc = f[r1 + i + 1]
      const cs = (va > iso ? 8 : 0) | (vb > iso ? 4 : 0) | (vc > iso ? 2 : 0) | (vd > iso ? 1 : 0)
      if (cs === 0 || cs === 15) continue
      switch (cs) {
        case 1:
        case 14:
          link(left(i, j), top(i, j + 1))
          break
        case 2:
        case 13:
          link(top(i, j + 1), left(i + 1, j))
          break
        case 3:
        case 12:
          link(left(i, j), left(i + 1, j))
          break
        case 4:
        case 11:
          link(top(i, j), left(i + 1, j))
          break
        case 6:
        case 9:
          link(top(i, j), top(i, j + 1))
          break
        case 7:
        case 8:
          link(left(i, j), top(i, j))
          break
        case 5:
        case 10: {
          // saddle: the cell centre decides which diagonal pair stays connected
          const inside = (va + vb + vc + vd) / 4 > iso
          if ((cs === 5) === inside) {
            link(left(i, j), top(i, j))
            link(top(i, j + 1), left(i + 1, j))
          } else {
            link(left(i, j), top(i, j + 1))
            link(top(i, j), left(i + 1, j))
          }
          break
        }
      }
    }
  }
  for (const id of ids) slotOf[id] = 0

  const seen = new Uint8Array(px.length)
  const out: IsoLine[] = []
  const walk = (start: number): IsoLine => {
    const pts: number[] = []
    let prev = -1
    let cur = start
    let closed = false
    for (;;) {
      seen[cur] = 1
      pts.push(px[cur], py[cur])
      const next = n0[cur] !== prev && n0[cur] >= 0 ? n0[cur] : n1[cur] !== prev ? n1[cur] : -1
      if (next < 0) break
      if (next === start) {
        closed = true
        break
      }
      if (seen[next]) break
      prev = cur
      cur = next
    }
    return { pts, closed }
  }
  // open lines first, from their ends, so none is split in the middle
  for (let s = 0; s < px.length; s++) if (!seen[s] && n1[s] < 0) out.push(walk(s))
  for (let s = 0; s < px.length; s++) if (!seen[s]) out.push(walk(s))
  return out.filter((l) => l.pts.length >= 4)
}
