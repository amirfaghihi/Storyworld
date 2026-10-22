/**
 * A uniform grid of axis-aligned boxes for quick overlap tests: label placement asks "does this
 * box hit anything already placed?" many times per layout, and glyph culling asks "what is near
 * this rectangle?". Boxes are in whatever units the caller uses (CSS pixels for labels, metres
 * for map features); pick a cell a little larger than a typical box.
 */
export interface AABB {
  x0: number
  y0: number
  x1: number
  y1: number
}

export class SpatialHash<T = undefined> {
  private cells = new Map<number, { box: AABB; data: T }[]>()
  private all: { box: AABB; data: T }[] = []

  constructor(readonly cell = 48) {}

  get size(): number {
    return this.all.length
  }

  private key(cx: number, cy: number): number {
    // cells within ±2^15 of the origin pack into one safe integer
    return (cx + 32768) * 65536 + (cy + 32768)
  }

  private range(b: AABB, pad: number) {
    const c = this.cell
    return [Math.floor((b.x0 - pad) / c), Math.floor((b.y0 - pad) / c), Math.floor((b.x1 + pad) / c), Math.floor((b.y1 + pad) / c)]
  }

  insert(box: AABB, data?: T): void {
    const e = { box, data: data as T }
    this.all.push(e)
    const [cx0, cy0, cx1, cy1] = this.range(box, 0)
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const k = this.key(cx, cy)
        const list = this.cells.get(k)
        if (list) list.push(e)
        else this.cells.set(k, [e])
      }
    }
  }

  /** Whether `box`, grown by `pad` on every side, overlaps anything inserted. */
  hits(box: AABB, pad = 0): boolean {
    const [cx0, cy0, cx1, cy1] = this.range(box, pad)
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const list = this.cells.get(this.key(cx, cy))
        if (!list) continue
        for (const e of list) if (overlaps(e.box, box, pad)) return true
      }
    }
    return false
  }

  /** Everything overlapping `box` grown by `pad`, each entry once, in insertion order. */
  query(box: AABB, pad = 0): T[] {
    const [cx0, cy0, cx1, cy1] = this.range(box, pad)
    const found = new Set<{ box: AABB; data: T }>()
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const list = this.cells.get(this.key(cx, cy))
        if (!list) continue
        for (const e of list) if (overlaps(e.box, box, pad)) found.add(e)
      }
    }
    return this.all.filter((e) => found.has(e)).map((e) => e.data)
  }

  /** Entries whose box comes within `r` of the point (x, y). */
  queryPoint(x: number, y: number, r = 0): T[] {
    return this.query({ x0: x, y0: y, x1: x, y1: y }, r)
  }

  clear(): void {
    this.cells.clear()
    this.all.length = 0
  }
}

export function overlaps(a: AABB, b: AABB, pad = 0): boolean {
  return a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad
}
