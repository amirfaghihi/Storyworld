// Minimal SVG geometry extraction: walks an svgson tree, tracks transforms,
// flattens path data into polylines in viewBox units, and classifies styles.
import { parse, type INode } from 'svgson'
import svgPathParser from 'svg-path-parser'
const { parseSVG, makeAbsolute } = svgPathParser as unknown as { parseSVG: (d: string) => any[]; makeAbsolute: (c: any[]) => any[] }

export type Mat = [number, number, number, number, number, number]
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]

export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

export function parseTransform(s: string | undefined): Mat {
  if (!s) return IDENTITY
  let result: Mat = IDENTITY
  const re = /(\w+)\s*\(([^)]*)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const args = m[2].split(/[\s,]+/).filter(Boolean).map(Number)
    let t: Mat = IDENTITY
    switch (m[1]) {
      case 'translate':
        t = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0]
        break
      case 'scale':
        t = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0]
        break
      case 'matrix':
        t = [args[0], args[1], args[2], args[3], args[4], args[5]]
        break
      case 'rotate': {
        const a = ((args[0] ?? 0) * Math.PI) / 180
        const cx = args[1] ?? 0
        const cy = args[2] ?? 0
        const r: Mat = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]
        t = mul(mul([1, 0, 0, 1, cx, cy], r), [1, 0, 0, 1, -cx, -cy])
        break
      }
      case 'skewX':
        t = [1, 0, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 1, 0, 0]
        break
      case 'skewY':
        t = [1, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]
        break
    }
    result = mul(result, t)
  }
  return result
}

export interface Style {
  fill: string | null // lowercase hex like #rrggbb, or null for none
  stroke: string | null
  strokeWidth: number
  isText: boolean
}

export function parseStyle(attrs: Record<string, string>): Style {
  const map = new Map<string, string>()
  for (const part of (attrs.style ?? '').split(';')) {
    const i = part.indexOf(':')
    if (i > 0) map.set(part.slice(0, i).trim(), part.slice(i + 1).trim())
  }
  const get = (k: string) => map.get(k) ?? attrs[k]
  const norm = (v: string | undefined): string | null => {
    if (!v || v === 'none') return null
    return v.toLowerCase()
  }
  const sw = parseFloat(get('stroke-width') ?? '1')
  return {
    fill: norm(get('fill') ?? '#000000'),
    stroke: norm(get('stroke')),
    strokeWidth: Number.isFinite(sw) ? sw : 1,
    isText: [...map.keys()].some((k) => k.startsWith('font')) || attrs.style?.includes('font-') === true,
  }
}

export interface Shape {
  id: string
  tag: string
  style: Style
  /** subpaths, each a polyline of [x,y] in viewBox units */
  polys: [number, number][][]
  bbox: { minX: number; minY: number; maxX: number; maxY: number }
}

function cubic(p0: number[], p1: number[], p2: number[], p3: number[], out: [number, number][], n = 10) {
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const mt = 1 - t
    const a = mt * mt * mt
    const b = 3 * mt * mt * t
    const c = 3 * mt * t * t
    const d = t * t * t
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]])
  }
}

function quad(p0: number[], p1: number[], p2: number[], out: [number, number][], n = 8) {
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const mt = 1 - t
    out.push([mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0], mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]])
  }
}

/** Flatten SVG path data into polylines (viewBox units, before transforms). */
export function flattenPath(d: string): [number, number][][] {
  const cmds = makeAbsolute(parseSVG(d)) as any[]
  const subs: [number, number][][] = []
  let sub: [number, number][] = []
  let prevC: [number, number] | null = null
  let prevQ: [number, number] | null = null
  for (const c of cmds) {
    const start: [number, number] = [c.x0, c.y0]
    switch (c.code) {
      case 'M':
        if (sub.length > 1) subs.push(sub)
        sub = [[c.x, c.y]]
        break
      case 'L':
      case 'H':
      case 'V':
        sub.push([c.x, c.y])
        break
      case 'C':
        cubic(start, [c.x1, c.y1], [c.x2, c.y2], [c.x, c.y], sub)
        prevC = [c.x2, c.y2]
        break
      case 'S': {
        const c1: [number, number] = prevC ? [2 * c.x0 - prevC[0], 2 * c.y0 - prevC[1]] : start
        cubic(start, c1, [c.x2, c.y2], [c.x, c.y], sub)
        prevC = [c.x2, c.y2]
        break
      }
      case 'Q':
        quad(start, [c.x1, c.y1], [c.x, c.y], sub)
        prevQ = [c.x1, c.y1]
        break
      case 'T': {
        const c1: [number, number] = prevQ ? [2 * c.x0 - prevQ[0], 2 * c.y0 - prevQ[1]] : start
        quad(start, c1, [c.x, c.y], sub)
        prevQ = c1
        break
      }
      case 'A': {
        // Approximate arc by a few points along a circle through start/end (good enough for tiny dots)
        const mx = (c.x0 + c.x) / 2
        const my = (c.y0 + c.y) / 2
        const dx = c.x - c.x0
        const dy = c.y - c.y0
        const len = Math.hypot(dx, dy) || 1
        const s = (c.sweep ? 1 : -1) * (c.largeArc ? -1 : 1) * 0.5
        sub.push([mx - (dy / len) * len * s, my + (dx / len) * len * s])
        sub.push([c.x, c.y])
        break
      }
      case 'Z':
        if (sub.length) sub.push([sub[0][0], sub[0][1]])
        break
    }
    if (c.code !== 'C' && c.code !== 'S') prevC = null
    if (c.code !== 'Q' && c.code !== 'T') prevQ = null
  }
  if (sub.length > 1) subs.push(sub)
  return subs
}

export interface SvgDoc {
  viewBox: { x: number; y: number; w: number; h: number }
  shapes: Shape[]
}

export async function loadSvgShapes(svgText: string): Promise<SvgDoc> {
  const root = await parse(svgText)
  const vb = (root.attributes.viewBox ?? '0 0 100 100').split(/[\s,]+/).map(Number)
  const shapes: Shape[] = []

  const walk = (node: INode, parent: Mat, inText: boolean) => {
    const m = mul(parent, parseTransform(node.attributes.transform))
    const id = node.attributes.id ?? ''
    const text = inText || node.name === 'text' || id.startsWith('text') || id.startsWith('flowRoot')
    if (node.name === 'path' || node.name === 'rect') {
      const style = parseStyle(node.attributes)
      if (text || style.isText) return
      let polys: [number, number][][]
      if (node.name === 'rect') {
        const x = +node.attributes.x, y = +node.attributes.y, w = +node.attributes.width, h = +node.attributes.height
        polys = [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]]
      } else {
        polys = flattenPath(node.attributes.d ?? '')
      }
      polys = polys.map((p) => p.map(([x, y]) => apply(m, x, y)))
      const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
      for (const p of polys) for (const [x, y] of p) {
        if (x < bbox.minX) bbox.minX = x
        if (y < bbox.minY) bbox.minY = y
        if (x > bbox.maxX) bbox.maxX = x
        if (y > bbox.maxY) bbox.maxY = y
      }
      if (polys.length) shapes.push({ id, tag: node.name, style, polys, bbox })
      return
    }
    for (const child of node.children ?? []) walk(child, m, text)
  }
  walk(root, IDENTITY, false)
  return { viewBox: { x: vb[0], y: vb[1], w: vb[2], h: vb[3] }, shapes }
}

export function hexToRgb(hex: string | null): [number, number, number] | null {
  if (!hex || !hex.startsWith('#')) return null
  let h = hex.slice(1)
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length !== 6) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
