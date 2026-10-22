// Raster helpers for the world build: polygon/stroke rasterization via node-canvas,
// separable blur, Euclidean distance transform, flood fill, and seeded noise.
import { createCanvas } from 'canvas'
import { createNoise2D } from 'simplex-noise'

export type Poly = [number, number][]

export interface Grid {
  w: number
  h: number
  data: Float32Array
}

export function grid(w: number, h: number, fill = 0): Grid {
  const data = new Float32Array(w * h)
  if (fill) data.fill(fill)
  return { w, h, data }
}

/**
 * Rasterize polylines (already in pixel coordinates) to a 0..1 coverage grid.
 * Renders at 2x and downsamples for anti-aliasing.
 */
export function rasterize(
  w: number,
  h: number,
  items: { polys: Poly[]; mode: 'fill' | 'stroke'; lineWidth?: number }[],
): Grid {
  const SS = 2
  const canvas = createCanvas(w * SS, h * SS)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w * SS, h * SS)
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#fff'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const item of items) {
    ctx.beginPath()
    for (const poly of item.polys) {
      if (poly.length < 2) continue
      ctx.moveTo(poly[0][0] * SS, poly[0][1] * SS)
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0] * SS, poly[i][1] * SS)
      if (item.mode === 'fill') ctx.closePath()
    }
    if (item.mode === 'fill') ctx.fill('nonzero')
    else {
      ctx.lineWidth = (item.lineWidth ?? 1) * SS
      ctx.stroke()
    }
  }
  const img = ctx.getImageData(0, 0, w * SS, h * SS).data
  const out = grid(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
        s += img[(((y * SS + dy) * w * SS) + (x * SS + dx)) * 4]
      }
      out.data[y * w + x] = s / (SS * SS * 255)
    }
  }
  return out
}

/** Separable box blur, repeated `passes` times (approximates a Gaussian). */
export function blur(g: Grid, radius: number, passes = 2): Grid {
  if (radius <= 0) return { w: g.w, h: g.h, data: new Float32Array(g.data) }
  let src = new Float32Array(g.data)
  let dst = new Float32Array(g.data.length)
  const { w, h } = g
  const r = Math.round(radius)
  const norm = 1 / (2 * r + 1)
  for (let p = 0; p < passes; p++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      let acc = 0
      const row = y * w
      for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))]
      for (let x = 0; x < w; x++) {
        dst[row + x] = acc * norm
        acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
      }
    }
    ;[src, dst] = [dst, src]
    // vertical
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let y = -r; y <= r; y++) acc += src[Math.min(h - 1, Math.max(0, y)) * w + x]
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = acc * norm
        acc += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x]
      }
    }
    ;[src, dst] = [dst, src]
  }
  return { w, h, data: src }
}

/** Euclidean distance (in pixels) from every pixel to the nearest pixel where mask > 0.5. */
export function distanceTransform(mask: Grid): Grid {
  const { w, h } = mask
  const INF = 1e12
  const f = new Float32Array(w * h)
  for (let i = 0; i < f.length; i++) f[i] = mask.data[i] > 0.5 ? 0 : INF
  const tmp = new Float32Array(Math.max(w, h))
  const d = new Float32Array(Math.max(w, h))
  const v = new Int32Array(Math.max(w, h))
  const z = new Float32Array(Math.max(w, h) + 1)

  const dt1d = (n: number, stride: number, offset: number) => {
    for (let i = 0; i < n; i++) tmp[i] = f[offset + i * stride]
    let k = 0
    v[0] = 0
    z[0] = -INF
    z[1] = INF
    for (let q = 1; q < n; q++) {
      let s = (tmp[q] + q * q - (tmp[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) {
        k--
        s = (tmp[q] + q * q - (tmp[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      }
      k++
      v[k] = q
      z[k] = s
      z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++
      d[q] = (q - v[k]) * (q - v[k]) + tmp[v[k]]
    }
    for (let i = 0; i < n; i++) f[offset + i * stride] = d[i]
  }
  for (let x = 0; x < w; x++) dt1d(h, w, x)
  for (let y = 0; y < h; y++) dt1d(w, 1, y * w)
  const out = grid(w, h)
  for (let i = 0; i < f.length; i++) out.data[i] = Math.sqrt(f[i])
  return out
}

/** BFS flood fill from seeds over pixels where barrier <= 0.5. Returns 0/1 grid. */
export function floodFill(barrier: Grid, seeds: [number, number][]): Grid {
  const { w, h } = barrier
  const out = grid(w, h)
  const queue = new Int32Array(w * h)
  let head = 0
  let tail = 0
  for (const [sx, sy] of seeds) {
    const x = Math.round(sx), y = Math.round(sy)
    if (x < 0 || y < 0 || x >= w || y >= h) continue
    const i = y * w + x
    if (barrier.data[i] > 0.5) {
      console.warn(`  seed (${sx.toFixed(1)}, ${sy.toFixed(1)}) sits on a barrier pixel, skipped`)
      continue
    }
    if (out.data[i]) continue
    out.data[i] = 1
    queue[tail++] = i
  }
  while (head < tail) {
    const i = queue[head++]
    const x = i % w
    const y = (i - x) / w
    const tryPush = (j: number) => {
      if (out.data[j] === 0 && barrier.data[j] <= 0.5) {
        out.data[j] = 1
        queue[tail++] = j
      }
    }
    if (x > 0) tryPush(i - 1)
    if (x < w - 1) tryPush(i + 1)
    if (y > 0) tryPush(i - w)
    if (y < h - 1) tryPush(i + w)
  }
  return out
}

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeFbm(seed: number) {
  const noise = createNoise2D(mulberry32(seed))
  /** Fractal Brownian motion in roughly [-1, 1]. */
  return (x: number, y: number, octaves = 3, lacunarity = 2, gain = 0.5) => {
    let amp = 1
    let freq = 1
    let sum = 0
    let norm = 0
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq, y * freq)
      norm += amp
      amp *= gain
      freq *= lacunarity
    }
    return sum / norm
  }
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function pointInPolygon(x: number, y: number, poly: Poly): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
