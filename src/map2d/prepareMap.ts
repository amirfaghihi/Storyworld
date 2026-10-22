import type { LoadedWorld } from '@/world/loadWorld'
import type { World } from '@/world/schema'
import { BIOME } from '@/world/biomes'
import { boxBlur } from './geom/blur'
import { isoLines } from './geom/marchingSquares'
import { chaikin, douglasPeucker } from './geom/simplify'
import { traceSkeleton, zhangSuen } from './geom/thin'
import { pointInPolygon } from './geom/polylabel'
import { invalidateOverview, onOverviewInvalidated } from './renderOverview'
import { extractPlaceFeatures, hasPlaceFeatures, type PlaceFeatures } from './placeFeatures'

/**
 * Everything the map renderer works out once per world (outlines, contours, roads, relief), so
 * drawing a frame is cheap. This file and drawMap.ts are the seam between the map dialog and the
 * map renderer.
 *
 * Bounds are world metres [x0, z0, x1, z1]. `bounds` is the whole heightfield; `fitBounds` is what
 * "fit to view" frames — a place's playable area inside its rim, or the whole world.
 *
 * Preparation starts the first time a world's map is asked for and runs in idle slices, so it
 * never lands on the 3D frame as one long task; getPreparedMap returns null until it is done and
 * onPrepared says when. After a terrain edit the old map stays on screen while the new one is
 * prepared.
 *
 * What gets prepared (all in world metres, from the same heightfield and biome grid the 3D world
 * uses):
 * - blurred fields: heights at three smoothings and one soft mask per land class. The 2 m grid
 *   has hard steps; the blur turns them into slopes that trace and shade as curves.
 * - class outlines: the 0.5 iso-line of each mask, simplified past the stair-step and corner-cut,
 *   so coasts and forest edges are smooth rings (Middle-earth: a few thousand points in all).
 * - contours at the finest interval the world needs, coarser intervals being subsets of it.
 * - roads: a place's lanes as authored; the overworld's road cells thinned to a centreline.
 * - a place's town plan: building footprints, smials, hedges, fences, gates and bridges, from
 *   its set pieces (placeFeatures.ts).
 * - relief: per-cell hillshade, hypsometric tint and water depth as small images or bytes; the
 *   drawing side colours them with the theme.
 */
export interface PreparedMap {
  /** bumps whenever the prepared data changes (terrain edit), so views know to redraw */
  version: number
  bounds: [number, number, number, number]
  fitBounds: [number, number, number, number]
  layers: unknown
}

type Box = [number, number, number, number]

/** A polyline or ring in world metres, with its bounding box for culling. */
export interface MapPoly {
  pts: Float32Array
  closed: boolean
  box: Box
}

export type MapClass = 'water' | 'forest' | 'rock' | 'snow' | 'ash' | 'marsh' | 'sand'

/** Tree glyph style per area: 0 broadleaf, 1 conifer, 2 dark conifer (dark woods). */
export type TreeKind = 0 | 1 | 2

/** A canvas the renderer can draw into and blit from, in the browser or under node-canvas. */
export type MapCanvas = HTMLCanvasElement | OffscreenCanvas

/** The prepared layers (PreparedMap.layers); only drawMap.ts reads these. */
export interface MapLayers {
  world: { isPlace: boolean; isGlobe: boolean; seed: number }
  /** wrap period in metres along x (360 on a globe), 0 when the map does not wrap */
  period: number
  cell: number
  /** world metres of grid index 0 (0, or half a cell on a globe, whose pixels are cell centres) */
  off: number
  /** padding cells around the source grid in every field */
  pad: number
  /** padded field size */
  gw: number
  gh: number
  /** source grid size */
  w: number
  h: number
  sea: number
  /** where the map has content: mapBounds ∩ bounds */
  content: Box
  /** places: the drawn area ends at mapBounds and fades out toward it */
  vignette: boolean
  fields: {
    h1: Float32Array
    h2: Float32Array
    mask: Record<MapClass, Float32Array>
  }
  /** tree kinds sampled every `treeStep` cells of the source grid */
  treeKind: Uint8Array
  treeStep: number
  outlines: Record<MapClass, MapPoly[]>
  /** the water edge only where it is a real shore (not where a ring closes beyond the grid) */
  coast: MapPoly[]
  /** contour lines by level; `contourStep` is the finest interval prepared (0: none) */
  contours: { level: number; lines: MapPoly[] }[]
  contourStep: number
  /** the 90th-percentile land slope (rise/run), to choose a contour interval per zoom */
  slope90: number
  /** a slope (rise/run) that counts as steep for hachures on this world */
  steep: number
  roads: (MapPoly & { width: number })[]
  /** true when roads are a place's authored lanes (drawn as a band of their width) */
  lanes: boolean
  ditches: MapPoly[]
  /** a place's buildings and boundaries; null on worlds that are not places, or have none */
  features: PlaceFeatures | null
  /** relief in source-grid pixels: shade (multiply) and light (lift) images, hypsometric and depth bytes */
  relief: { shade: MapCanvas; light: MapCanvas; hyps: Uint8Array; depth: Uint8Array }
  /** prepare timings in ms, for the record */
  timings: Record<string, number>
  /** per-theme images and tiles, owned by drawMap.ts */
  cache: Map<string, unknown>
}

/** A canvas outside the DOM: OffscreenCanvas where there is one, else a detached <canvas>. */
export function makeCanvas(w: number, h: number): MapCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

// ---------------------------------------------------------------------------------------------
// preparation

const PAD = 3
const CLASSES: MapClass[] = ['water', 'sand', 'marsh', 'ash', 'forest', 'rock', 'snow']
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Copies a w×h grid into one padded by `pad` cells: edges repeated, or wrapped along x on a globe. */
function padGrid(src: ArrayLike<number>, w: number, h: number, pad: number, wrapX: boolean): Float32Array {
  const gw = w + 2 * pad
  const gh = h + 2 * pad
  const out = new Float32Array(gw * gh)
  const col = new Int32Array(gw)
  for (let i = 0; i < gw; i++) {
    const si = i - pad
    col[i] = wrapX ? ((si % w) + w) % w : Math.min(w - 1, Math.max(0, si))
  }
  for (let j = 0; j < gh; j++) {
    const row = Math.min(h - 1, Math.max(0, j - pad)) * w
    const o = j * gw
    for (let i = 0; i < gw; i++) out[o + i] = src[row + col[i]]
  }
  return out
}

function polyBox(pts: ArrayLike<number>): Box {
  let x0 = Infinity
  let z0 = Infinity
  let x1 = -Infinity
  let z1 = -Infinity
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i]
    const z = pts[i + 1]
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (z < z0) z0 = z
    if (z > z1) z1 = z
  }
  return [x0, z0, x1, z1]
}

function toPoly(pts: number[], closed: boolean): MapPoly {
  const f = Float32Array.from(pts)
  return { pts: f, closed, box: polyBox(f) }
}

/** The polygon's area (shoelace), for picking the innermost of nested regions. */
function polygonArea(poly: [number, number][]): number {
  let a = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1])
  return Math.abs(a / 2)
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function worldBounds(world: LoadedWorld): Box {
  const hf = world.heightfield
  // a globe's pixels are cell centres spanning the full 360 × 180; flat grids are vertices
  return world.meta.kind === 'globe' ? [0, 0, hf.width * hf.cell, hf.height * hf.cell] : [0, 0, (hf.width - 1) * hf.cell, (hf.height - 1) * hf.cell]
}

function fitBoundsOf(meta: World, bounds: Box): Box {
  const mb = meta.mapBounds
  if (!mb) return bounds
  return [Math.max(bounds[0], mb[0]), Math.max(bounds[1], mb[1]), Math.min(bounds[2], mb[2]), Math.min(bounds[3], mb[3])]
}

/**
 * The preparation as a sequence of slices (each a few to a few tens of ms), so an idle scheduler
 * can spread it over several idle periods. Returns the layers when done.
 */
function* prepareSteps(world: LoadedWorld): Generator<string, MapLayers, void> {
  const { meta, heightfield: hf } = world
  const timings: Record<string, number> = {}
  let t0 = now()
  const lap = (k: string) => {
    const t = now()
    timings[k] = (timings[k] ?? 0) + (t - t0)
    t0 = t
  }
  const isGlobe = meta.kind === 'globe'
  const isPlace = !!meta.place
  const w = hf.width
  const h = hf.height
  const cell = hf.cell
  const off = isGlobe ? 0.5 : 0
  const pad = PAD
  const gw = w + 2 * pad
  const gh = h + 2 * pad
  const sea = meta.seaLevel
  const bounds = worldBounds(world)
  const content = fitBoundsOf(meta, bounds)
  const period = isGlobe ? w * cell : 0
  const toWorld = (g: number) => (g - pad + off) * cell

  // ---- fields
  const H = padGrid(hf.data, w, h, pad, isGlobe)
  const h1 = boxBlur(H, gw, gh, 1, 2)
  const h2 = boxBlur(H, gw, gh, 2, 3)
  const h5 = boxBlur(H, gw, gh, 5, 3)
  lap('heights')
  yield 'heights'

  const B = hf.biome
  const indicator: Record<MapClass, (i: number) => boolean> = {
    water: (i) => hf.data[i] < sea - 0.15 || B[i] === BIOME.water || B[i] === BIOME.riverbed,
    sand: (i) => B[i] === BIOME.sand && hf.data[i] >= sea - 0.15,
    marsh: (i) => B[i] === BIOME.marsh,
    ash: (i) => B[i] === BIOME.ash,
    forest: (i) => B[i] === BIOME.forest,
    rock: (i) => B[i] === BIOME.rock || B[i] === BIOME.snow,
    snow: (i) => B[i] === BIOME.snow,
  }
  const mask = {} as Record<MapClass, Float32Array>
  const ind = new Uint8Array(w * h)
  for (const c of CLASSES) {
    const test = indicator[c]
    let count = 0
    for (let i = 0; i < ind.length; i++) count += ind[i] = test(i) ? 1 : 0
    if (!count) {
      mask[c] = new Float32Array(gw * gh)
      continue
    }
    const m = boxBlur(padGrid(ind, w, h, pad, isGlobe), gw, gh, 1, 2)
    // a zero border closes every ring outside the drawn area (on a globe, beyond the seam, where
    // each wrapped copy is clipped off)
    for (let i = 0; i < gw; i++) m[i] = m[(gh - 1) * gw + i] = 0
    for (let j = 0; j < gh; j++) m[j * gw] = m[j * gw + gw - 1] = 0
    mask[c] = m
  }
  lap('masks')
  yield 'masks'

  // ---- class outlines: iso 0.5 → past the stair-step → one round of corner cutting
  const outlines = {} as Record<MapClass, MapPoly[]>
  let coast: MapPoly[] = []
  for (const c of CLASSES) {
    const rings = isoLines(mask[c], gw, gh, 0.5)
    outlines[c] = []
    for (const r of rings) {
      // water edges follow noisy shore cells, so they get a little more smoothing
      let p = douglasPeucker(r.pts, c === 'water' ? 0.45 : 0.25, r.closed)
      if (p.length < 6) continue
      p = chaikin(p, 2, r.closed)
      for (let k = 0; k < p.length; k++) p[k] = toWorld(p[k])
      outlines[c].push(toPoly(p, r.closed))
    }
    if (c === 'water') coast = chunk(realShore(outlines.water, bounds, isGlobe, cell), 48)
    lap('outlines')
    yield `outline ${c}`
  }

  // ---- slope statistics (source grid, smoothed heights)
  const slopes: number[] = []
  const rockSlopes: number[] = []
  for (let j = pad + 1; j < pad + h - 1; j += 2) {
    for (let i = pad + 1; i < pad + w - 1; i += 2) {
      const k = j * gw + i
      if (h2[k] <= sea) continue
      const g = Math.hypot(h2[k + 1] - h2[k - 1], h2[k + gw] - h2[k - gw]) / (2 * cell)
      slopes.push(g)
      if (mask.rock[k] > 0.5 || mask.ash[k] > 0.5) rockSlopes.push(g)
    }
  }
  const pct = (a: number[], q: number) => {
    if (!a.length) return 0
    a.sort((x, y) => x - y)
    return a[Math.min(a.length - 1, Math.floor(a.length * q))]
  }
  const slope90 = pct(slopes, 0.9)
  const rockSlope50 = pct(rockSlopes, 0.5)
  // hachures mark ground steeper than this; on the overworld and in places that is a fixed grade,
  // on the globe (degrees across, scaled heights) it is relative to its own mountains
  const steep = isGlobe ? Math.max(0.05, rockSlope50 * 0.6) : 0.25

  // ---- contours at the finest interval; coarser intervals are every k-th level
  let hmin = Infinity
  let hmax = -Infinity
  for (let i = 0; i < hf.data.length; i++) {
    const v = hf.data[i]
    if (v < hmin) hmin = v
    if (v > hmax) hmax = v
  }
  const contourStep = isGlobe ? 0 : isPlace ? 2 : 10
  const contours: { level: number; lines: MapPoly[] }[] = []
  if (contourStep) {
    for (let level = Math.ceil((sea + 0.5) / contourStep) * contourStep; level < hmax; level += contourStep) {
      const lines: MapPoly[] = []
      for (const l of isoLines(h2, gw, gh, level)) {
        let p = douglasPeucker(l.pts, 0.25, l.closed)
        if (p.length < 6) continue
        p = chaikin(p, 1, l.closed)
        for (let k = 0; k < p.length; k++) p[k] = toWorld(p[k])
        lines.push(toPoly(p, l.closed))
      }
      if (lines.length) contours.push({ level, lines })
      if (contours.length % 4 === 0) {
        lap('contours')
        yield 'contours'
      }
    }
  }
  lap('contours')
  yield 'contours'

  // ---- roads and ditches
  let roads: (MapPoly & { width: number })[] = []
  const lanes = !!world.features?.roads
  if (world.features?.roads) {
    roads = world.features.roads.filter((r) => r.points.length >= 2).map((r) => ({ ...toPoly(chaikin(r.points.flat(), 2, false), false), width: r.width }))
  } else {
    const road = new Uint8Array(w * h)
    let any = 0
    for (let i = 0; i < road.length; i++) any += road[i] = B[i] === BIOME.road ? 1 : 0
    if (any) {
      const skel = zhangSuen(road, w, h)
      // Douglas-Peucker at about a cell removes the staircase; corner cutting rounds the rest
      const lines = bridgeGaps(traceSkeleton(skel, w, h, 4).map((l) => douglasPeucker(l, 1.1, false)), 12)
      for (const line of lines) {
        let p = line
        p = chaikin(p, 3, false)
        for (let k = 0; k < p.length; k++) p[k] = (p[k] + off) * cell
        roads.push({ ...toPoly(p, false), width: 2 * cell })
      }
    }
  }
  const ditches = (world.features?.ditches ?? []).filter((d) => d.points.length >= 2).map((d) => toPoly(chaikin(d.points.flat(), 2, false), false))
  const plan = isPlace ? extractPlaceFeatures(world) : null
  const features = hasPlaceFeatures(plan) ? plan : null
  lap('roads')
  yield 'roads'

  // ---- relief: hillshade, hypsometric tint and water depth on the source grid
  const VE = isPlace ? 1.1 : isGlobe ? Math.min(1, 0.6 / Math.max(1e-3, rockSlope50)) : 1
  const Lnw = norm3(-0.5, 0.70710678, -0.5)
  const Ln = norm3(0, 0.70710678, -0.70710678)
  const range = Math.max(1, hmax - sea)
  const hypLo = sea + 0.06 * range
  const hypHi = sea + Math.min(64, 0.55 * range)
  const depthScale = Math.max(2, 0.4 * (sea - hmin))
  const wetWide = boxBlur(mask.water, gw, gh, 2, 2)
  const shadeImg = new Uint8ClampedArray(w * h * 4)
  const lightImg = new Uint8ClampedArray(w * h * 4)
  const hyps = new Uint8Array(w * h)
  const depth = new Uint8Array(w * h)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = (j + pad) * gw + (i + pad)
      // relief weight: rock keeps its detail, lowland keeps only broad landforms
      // (places sit between: their ground noise is a few metres across, the hills tens)
      const rk = isPlace ? 1 : Math.max(mask.rock[k], 0.6 * mask.ash[k])
      const t = isPlace ? 0.45 : smoothstep(0.3, 0.7, rk)
      const dx = (((h5[k + 1] - h5[k - 1]) * (1 - t) + (h2[k + 1] - h2[k - 1]) * t) / (2 * cell)) * VE
      const dz = (((h5[k + gw] - h5[k - gw]) * (1 - t) + (h2[k + gw] - h2[k - gw]) * t) / (2 * cell)) * VE
      const nl = Math.hypot(dx, 1, dz)
      // n = (−dx, 1, −dz)/|n|; each light normalised so flat ground is exactly 1
      const lam = (0.7 * (-dx * Lnw[0] + Lnw[1] - dz * Lnw[2])) / (nl * Lnw[1]) + (0.3 * (-dx * Ln[0] + Ln[1] - dz * Ln[2])) / (nl * Ln[1])
      // banks under water are drawn as water: no shading there, or a lake casts a smudge
      const dry = 1 - smoothstep(0.02, 0.4, wetWide[k])
      const sh = Math.min(1.12, Math.max(0.66, 1 + (lam - 1) * (isPlace ? 0.6 : 0.35 + 0.45 * rk) * dry))
      const o = (j * w + i) * 4
      const g = Math.min(1, sh) * 255
      shadeImg[o] = shadeImg[o + 1] = shadeImg[o + 2] = g
      shadeImg[o + 3] = 255
      lightImg[o] = lightImg[o + 1] = lightImg[o + 2] = 255
      lightImg[o + 3] = (Math.max(0, sh - 1) / 0.12) * 0.5 * 255
      hyps[j * w + i] = smoothstep(hypLo, hypHi, h1[k]) * 255
      depth[j * w + i] = Math.min(1, Math.max(0, (sea - h1[k] - 0.1 * depthScale) / depthScale)) * 255
    }
  }
  const shade = imageCanvas(shadeImg, w, h)
  const light = imageCanvas(lightImg, w, h)
  lap('relief')
  yield 'relief'

  // ---- tree kinds from region moods (innermost region wins)
  const treeStep = 4
  const tw = Math.ceil(w / treeStep)
  const th = Math.ceil(h / treeStep)
  const treeKind = new Uint8Array(tw * th)
  // the innermost region containing a point decides (Mirkwood inside Rhovanion)
  const regions = meta.regions
    .filter((r) => r.polygon.length >= 3)
    .map((r) => ({ poly: r.polygon, area: polygonArea(r.polygon), box: polyBox(r.polygon.flat()), kind: (r.mood === 'dark' ? 2 : r.mood === 'pine' ? 1 : 0) as TreeKind }))
    .sort((a, b) => a.area - b.area)
  if (regions.some((r) => r.kind)) {
    for (let j = 0; j < th; j++) {
      for (let i = 0; i < tw; i++) {
        const x = (i * treeStep + off) * cell
        const z = (j * treeStep + off) * cell
        const r = regions.find((r) => x >= r.box[0] && x <= r.box[2] && z >= r.box[1] && z <= r.box[3] && pointInPolygon(x, z, r.poly))
        if (r) treeKind[j * tw + i] = r.kind
      }
    }
  }
  lap('trees')

  return {
    world: { isPlace, isGlobe, seed: meta.seed },
    period,
    cell,
    off,
    pad,
    gw,
    gh,
    w,
    h,
    sea,
    content,
    vignette: !!meta.mapBounds,
    fields: { h1, h2, mask },
    treeKind,
    treeStep,
    outlines,
    coast,
    contours,
    contourStep,
    slope90,
    steep,
    roads,
    lanes,
    ditches,
    features,
    relief: { shade, light, hyps, depth },
    timings,
    cache: new Map(),
  }
}

function norm3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z)
  return [x / l, y / l, z / l]
}

function imageCanvas(data: Uint8ClampedArray, w: number, h: number): MapCanvas {
  const c = makeCanvas(w, h)
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  const img = ctx.createImageData(w, h)
  img.data.set(data)
  ctx.putImageData(img, 0, 0)
  return c
}

/**
 * The parts of the water rings that are real shoreline. Rings are closed off beyond the grid
 * (so they can be filled), and those closing runs must not get a shore line or ripples, or the
 * sea would show lines parallel to the edge of the world.
 */
function realShore(rings: MapPoly[], b: Box, isGlobe: boolean, cell: number): MapPoly[] {
  const eps = cell * 0.25
  // a globe's rings run on past the seam with real (wrapped) shore before they close
  const ex = isGlobe ? cell * (PAD - 1.5) : eps
  const inside = (x: number, z: number) => z >= b[1] - eps && z <= b[3] + eps && x >= b[0] - ex && x <= b[2] + ex
  const out: MapPoly[] = []
  for (const r of rings) {
    const p = r.pts
    const n = p.length / 2
    let start = -1
    // begin the scan at a point outside, so a run that wraps past index 0 stays whole
    for (let q = 0; q < n; q++) if (!inside(p[2 * q], p[2 * q + 1])) start = q
    if (start < 0) {
      out.push(r)
      continue
    }
    let run: number[] = []
    for (let s = 1; s <= n; s++) {
      const q = (start + s) % n
      const x = p[2 * q]
      const z = p[2 * q + 1]
      if (inside(x, z)) run.push(x, z)
      else {
        if (run.length >= 4) out.push(toPoly(run, false))
        run = []
      }
    }
    if (run.length >= 4) out.push(toPoly(run, false))
  }
  return out
}

/**
 * Joins road pieces whose ends face each other across a short gap. The road biome stops where a
 * river or ford crosses it, which would otherwise leave the road broken at every crossing.
 */
function bridgeGaps(lines: number[][], maxGap: number): number[][] {
  const out = lines.map((l) => l.slice())
  // the unit direction a line leaves through its start (end = false) or its end (end = true)
  const exit = (l: number[], end: boolean): [number, number] => {
    const n = l.length
    const [ax, ay, bx, by] = end ? [l[n - 4], l[n - 3], l[n - 2], l[n - 1]] : [l[2], l[3], l[0], l[1]]
    const L = Math.hypot(bx - ax, by - ay) || 1
    return [(bx - ax) / L, (by - ay) / L]
  }
  for (;;) {
    let best: { i: number; j: number; ei: boolean; ej: boolean; d: number } | null = null
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        for (const ei of [false, true]) {
          for (const ej of [false, true]) {
            const a = out[i]
            const b = out[j]
            const ax = ei ? a[a.length - 2] : a[0]
            const ay = ei ? a[a.length - 1] : a[1]
            const bx = ej ? b[b.length - 2] : b[0]
            const by = ej ? b[b.length - 1] : b[1]
            const d = Math.hypot(bx - ax, by - ay)
            if (d > maxGap || (best && d >= best.d)) continue
            // both ends must point across the gap, so a road is not joined to one running beside it
            const [ux, uy] = exit(a, ei)
            const [vx, vy] = exit(b, ej)
            if (d > 1.5 && ((bx - ax) * ux + (by - ay) * uy < 0.5 * d || (ax - bx) * vx + (ay - by) * vy < 0.5 * d)) continue
            best = { i, j, ei, ej, d }
          }
        }
      }
    }
    if (!best) return out
    const reversed = (l: number[]) => {
      const r: number[] = []
      for (let k = l.length - 2; k >= 0; k -= 2) r.push(l[k], l[k + 1])
      return r
    }
    const a = best.ei ? out[best.i] : reversed(out[best.i])
    const b = best.ej ? reversed(out[best.j]) : out[best.j]
    out[best.i] = a.concat(b)
    out.splice(best.j, 1)
  }
}

/**
 * Cuts long open lines into pieces of about `n` points (sharing their end points), so a tile
 * can skip the parts of a long coast nowhere near it.
 */
function chunk(lines: MapPoly[], n: number): MapPoly[] {
  const out: MapPoly[] = []
  for (const l of lines) {
    const pts = l.closed ? [...l.pts, l.pts[0], l.pts[1]] : [...l.pts]
    const count = pts.length / 2
    if (count <= n * 1.5) {
      out.push(l.closed ? toPoly(pts, false) : l)
      continue
    }
    for (let a = 0; a < count - 1; a += n) {
      const b = Math.min(count, a + n + 1)
      out.push(toPoly(pts.slice(2 * a, 2 * b), false))
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// cache and idle scheduling

interface PrepState {
  pm: PreparedMap | null
  job: Generator<string, MapLayers, void> | null
  /** the epoch the current pm (or job) was prepared for */
  epoch: number
  listeners: Set<() => void>
}

const states = new WeakMap<LoadedWorld, PrepState>()
let version = 0
/** bumped by invalidateMap() with no world: every world re-prepares on its next request */
let epoch = 0

function stateOf(world: LoadedWorld): PrepState {
  let st = states.get(world)
  if (!st) {
    st = { pm: null, job: null, epoch, listeners: new Set() }
    states.set(world, st)
  }
  return st
}

function finish(world: LoadedWorld, st: PrepState, layers: MapLayers) {
  const bounds = worldBounds(world)
  st.pm = { version: ++version, bounds, fitBounds: fitBoundsOf(world.meta, bounds), layers }
  st.job = null
  for (const cb of [...st.listeners]) cb()
}

type IdleDeadline = { timeRemaining(): number; didTimeout: boolean }
/** How long a slice may run where the browser cannot say how idle it is (Safari). */
const FALLBACK_BUDGET_MS = 10
const requestIdle: (cb: (d: IdleDeadline) => void) => void =
  typeof requestIdleCallback === 'function'
    ? (cb) => requestIdleCallback(cb, { timeout: 400 })
    : // Without requestIdleCallback, a timer stands in for the idle period. Its deadline has to
      // run out like a real one does, counted from when the callback starts, or the pump would
      // see time left forever and prepare the whole map in one long task.
      (cb) =>
        setTimeout(() => {
          const t0 = now()
          cb({ timeRemaining: () => Math.max(0, FALLBACK_BUDGET_MS - (now() - t0)), didTimeout: false })
        }, 16)

function start(world: LoadedWorld, st: PrepState) {
  st.epoch = epoch
  const job = prepareSteps(world)
  st.job = job
  const pump = (d: IdleDeadline) => {
    if (st.job !== job) return // superseded by a newer invalidation
    // always run one slice, then more while the idle period lasts
    do {
      const r = job.next()
      if (r.done) {
        finish(world, st, r.value)
        return
      }
    } while (d.timeRemaining() > 4)
    requestIdle(pump)
  }
  requestIdle(pump)
}

/** The prepared map, or null while it is still being prepared (call onPrepared to hear when). */
export function getPreparedMap(world: LoadedWorld): PreparedMap | null {
  const st = stateOf(world)
  if (!st.job && (!st.pm || st.epoch !== epoch)) start(world, st)
  return st.pm
}

/**
 * Prepares the world's map now, on this thread, and returns it (for scripts and tests; the app
 * uses getPreparedMap). Listeners still hear about it.
 */
export function prepareMapNow(world: LoadedWorld): PreparedMap {
  const st = stateOf(world)
  st.epoch = epoch
  const job = prepareSteps(world)
  st.job = job
  let r = job.next()
  while (!r.done) r = job.next()
  finish(world, st, r.value)
  return st.pm!
}

/**
 * Calls `cb` every time the world's map becomes ready: after the first preparation and after each
 * re-preparation that follows a terrain edit. Returns an unsubscribe.
 */
export function onPrepared(world: LoadedWorld, cb: () => void): () => void {
  const st = stateOf(world)
  st.listeners.add(cb)
  return () => {
    st.listeners.delete(cb)
  }
}

/**
 * Re-prepares after a terrain edit; with no world, every world re-prepares on its next request.
 * The previous map stays available until the new one is ready. Also drops the legacy overview
 * raster, which renderOverview.ts reports back through its invalidation listener.
 */
export function invalidateMap(world?: LoadedWorld): void {
  invalidateOverview(world)
}

export { invalidateMap as invalidateOverview }

// Terrain edits arrive through renderOverview.invalidateOverview (the editor imports it from
// there); it tells us through a listener, so neither module imports the other in a cycle.
const offInvalidated = onOverviewInvalidated((world) => {
  if (!world) {
    epoch++
    return
  }
  const st = states.get(world)
  if (!st) return
  // only re-prepare a world someone has asked for (prepared, or still preparing from the old
  // terrain); others re-prepare on their next request
  const active = !!st.pm || !!st.job
  st.job = null
  if (active) start(world, st)
})
// A hot reload of this module runs it again and subscribes a fresh listener; the old one would
// keep re-preparing worlds into the old module's dead cache, so it goes with the old module.
if (import.meta.hot) import.meta.hot.dispose(offInvalidated)
