import type { Quality } from '@/store/stores'
import { parseColor, rgba, type MapTheme, type RGB } from './mapTheme'
import { makeCanvas, type MapCanvas, type MapLayers, type MapPoly, type PreparedMap } from './prepareMap'
import type { FeatureLine, PlaceFeatures } from './placeFeatures'

/**
 * A view onto the map. (cx, cz) is the world point at the centre of the viewport, `s` is CSS
 * pixels per world metre, (vw, vh) the viewport in CSS pixels, `dpr` the device pixel ratio the
 * canvas backing store was sized with (backing = vw·dpr × vh·dpr). `rotation` (radians,
 * clockwise) turns the map about the view centre, for a heading-up minimap.
 */
export interface MapView {
  cx: number
  cz: number
  s: number
  vw: number
  vh: number
  dpr: number
  rotation?: number
}

/** World point → CSS pixel in the view (no rotation), for placing DOM markers over the canvas. */
export function worldToView(view: MapView, x: number, z: number): [number, number] {
  return [view.vw / 2 + (x - view.cx) * view.s, view.vh / 2 + (z - view.cz) * view.s]
}

/** CSS pixel in the view → world point (no rotation). */
export function viewToWorld(view: MapView, px: number, py: number): [number, number] {
  return [view.cx + (px - view.vw / 2) / view.s, view.cz + (py - view.vh / 2) / view.s]
}

/** What the last drawMap call did, for performance checks. */
export const lastDrawStats = { ms: 0, tilesDrawn: 0, tilesRendered: 0, tilesMissing: 0, level: 0 }

/*
 * How a frame is made
 *
 * The base map is drawn in tiles: 512 device-pixel squares of the world at a fixed set of zoom
 * levels (three per doubling), each tile painted once with every layer and then kept. A frame
 * blits the tiles that cover the view from the level just above the view's scale, so it only
 * ever shrinks a tile, by at most a fifth, and line work stays crisp. The overworld's roads are
 * drawn over the tiles each frame as vectors, so their dashes run on unbroken; a place's lanes
 * are solid bands and go into the tiles, under its buildings. Panning reuses tiles; zooming past a level boundary paints new
 * ones. A tile is painted with the vector outlines, contours and shoreline prepared once per
 * world, plus symbols (trees, hachures, stipple) scattered on a grid in the level's own pixels,
 * so their spacing on screen stays the same at every zoom and they line up across tile edges.
 *
 * `detail: 'fast'` (mid-gesture) paints new tiles only for a few milliseconds per frame and
 * fills the rest from tiles of other levels (or a plain relief underlay) until a 'full' frame
 * paints everything. Quality 'low' leaves out the symbols.
 */

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type Box = [number, number, number, number]

const TILE = 512
/** extra device pixels painted around each tile, so neighbours can overlap and never show a seam */
const BLEED = 2
const MAX_TILES = 72
const LEVELS_PER_DOUBLING = 3
const FAST_BUDGET_MS = 6

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// ---------------------------------------------------------------------------------------------
// theme

type Ink = Record<string, RGB>

const parsedThemes = new WeakMap<MapTheme, { key: string; ink: Ink }>()
function parseTheme(theme: MapTheme): { key: string; ink: Ink } {
  let p = parsedThemes.get(theme)
  if (!p) {
    const ink: Ink = {}
    for (const [k, v] of Object.entries(theme)) {
      const c = parseColor(v)
      if (c) ink[k] = c
    }
    const need = (k: string, fb: string) => (ink[k] ??= parseColor(fb)!)
    need('paper', '#f3ead6')
    need('void', '#e2d6bd')
    need('ink', '#2b2620')
    need('hatch', '#a89c86')
    need('low', '#c4d9a6')
    need('high', '#d9d6a6')
    need('sand', '#ece0bc')
    need('forest', '#9cb98a')
    need('forestCrown', '#55935a')
    need('forestInk', '#2d5a3c')
    need('forestDark', '#2a4a35')
    need('rock', '#ccbca3')
    need('snow', '#fbfaf6')
    need('ash', '#a59a94')
    need('marsh', '#b1bd99')
    need('marshInk', '#55634a')
    need('water', '#a7c3df')
    need('waterDeep', '#8fa6c6')
    need('waterLine', '#2e5490')
    need('road', '#8a6f4e')
    need('roadFill', '#ccb88f')
    need('ditch', '#7e7262')
    p = { key: Object.entries(theme).map(([k, v]) => `${k}:${v}`).join(';'), ink }
    parsedThemes.set(theme, p)
  }
  return p
}

// ---------------------------------------------------------------------------------------------
// per-theme painter: coloured relief images and the tile cache

interface Tile {
  img: CanvasImageSource & { close?: () => void }
  level: number
  dpr: number
  tx: number
  ty: number
}

interface Painter {
  ink: Ink
  lite: boolean
  wash: MapCanvas
  waterTint: MapCanvas
  tiles: Map<string, Tile>
  scratch: MapCanvas | null
  patterns: Map<string, MapCanvas>
}

function painterFor(L: MapLayers, theme: MapTheme, lite: boolean): Painter {
  const { key, ink } = parseTheme(theme)
  const k = `${lite ? 'lite' : 'full'}|${key}`
  let p = L.cache.get(k) as Painter | undefined
  if (p) {
    // most recently used last, so the oldest painter is the first key
    L.cache.delete(k)
    L.cache.set(k, p)
    return p
  }
  p = { ink, lite, wash: colourise(L, L.relief.hyps, ink.low, ink.high), waterTint: colourise(L, L.relief.depth, ink.water, ink.waterDeep), tiles: new Map(), scratch: null, patterns: new Map() }
  L.cache.set(k, p)
  // a theme or quality switch leaves the old painter unused; keep two at most
  while (L.cache.size > 2) {
    const first = L.cache.keys().next().value as string
    const old = L.cache.get(first) as Painter
    for (const t of old.tiles.values()) t.img.close?.()
    L.cache.delete(first)
  }
  return p
}

/** A source-grid image coloured from a 0–255 ramp between two colours. */
function colourise(L: MapLayers, ramp: Uint8Array, a: RGB, b: RGB): MapCanvas {
  const c = makeCanvas(L.w, L.h)
  const ctx = c.getContext('2d') as Ctx
  const img = ctx.createImageData(L.w, L.h)
  const d = img.data
  for (let i = 0; i < ramp.length; i++) {
    const t = ramp[i] / 255
    d[i * 4] = a[0] + (b[0] - a[0]) * t
    d[i * 4 + 1] = a[1] + (b[1] - a[1]) * t
    d[i * 4 + 2] = a[2] + (b[2] - a[2]) * t
    d[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c
}

// ---------------------------------------------------------------------------------------------
// sampling the prepared fields

/** Bilinear sample of a padded field at world (x, z); wraps along x on a globe. */
function sample(L: MapLayers, f: Float32Array, x: number, z: number): number {
  if (L.period) x = ((x % L.period) + L.period) % L.period
  const gx = x / L.cell - L.off + L.pad
  const gz = z / L.cell - L.off + L.pad
  let x0 = Math.floor(gx)
  let z0 = Math.floor(gz)
  const tx = gx - x0
  const tz = gz - z0
  const gw = L.gw
  if (x0 < 0) x0 = 0
  else if (x0 > gw - 2) x0 = gw - 2
  if (z0 < 0) z0 = 0
  else if (z0 > L.gh - 2) z0 = L.gh - 2
  const i = z0 * gw + x0
  const a = f[i] + (f[i + 1] - f[i]) * tx
  const b = f[i + gw] + (f[i + gw + 1] - f[i + gw]) * tx
  return a + (b - a) * tz
}

function treeKindAt(L: MapLayers, x: number, z: number): number {
  if (L.period) x = ((x % L.period) + L.period) % L.period
  const tw = Math.ceil(L.w / L.treeStep)
  const th = Math.ceil(L.h / L.treeStep)
  const i = Math.min(tw - 1, Math.max(0, Math.round((x / L.cell - L.off) / L.treeStep)))
  const j = Math.min(th - 1, Math.max(0, Math.round((z / L.cell - L.off) / L.treeStep)))
  return L.treeKind[j * tw + i]
}

/** A stable random number in [0, 1) for a symbol grid cell. */
function hash(a: number, b: number, salt: number): number {
  let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b + 0x3c6ef372, 0x165667b1) ^ Math.imul(salt, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const hit = (b: Box, r: Box) => b[0] <= r[2] && b[2] >= r[0] && b[1] <= r[3] && b[3] >= r[1]

function tracePoly(ctx: Ctx, p: MapPoly) {
  const a = p.pts
  ctx.moveTo(a[0], a[1])
  for (let i = 2; i < a.length; i += 2) ctx.lineTo(a[i], a[i + 1])
  if (p.closed) ctx.closePath()
}

function tracePolys(ctx: Ctx, polys: MapPoly[], r: Box): boolean {
  let any = false
  ctx.beginPath()
  for (const p of polys) {
    if (!hit(p.box, r)) continue
    tracePoly(ctx, p)
    any = true
  }
  return any
}

// ---------------------------------------------------------------------------------------------
// levels and tiles

/** The level whose scale is the smallest at or above `s` (CSS px per metre). */
function levelFor(s: number): number {
  return Math.ceil(LEVELS_PER_DOUBLING * Math.log2(s) - 1e-6)
}
const levelScale = (level: number) => Math.pow(2, level / LEVELS_PER_DOUBLING)

function tileKey(level: number, dpr: number, tx: number, ty: number) {
  return `${level}|${dpr}|${tx}|${ty}`
}

/** Paints one tile: every baked layer for the world square it covers. */
function renderTile(L: MapLayers, P: Painter, level: number, dpr: number, tx: number, ty: number): Tile {
  const size = TILE + 2 * BLEED
  let canvas = P.scratch
  const reuse = !!canvas && 'transferToImageBitmap' in canvas
  if (!canvas || !reuse) canvas = makeCanvas(size, size)
  const ctx = canvas.getContext('2d') as Ctx
  const sL = levelScale(level)
  const q = sL * dpr // device px per metre
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, size, size)
  ctx.setTransform(q, 0, 0, q, BLEED - tx * TILE, BLEED - ty * TILE)
  const tw = TILE / q
  const r: Box = [tx * tw - BLEED / q, ty * tw - BLEED / q, (tx + 1) * tw + BLEED / q, (ty + 1) * tw + BLEED / q]
  paintWorld(ctx, L, P, r, sL)
  let img: Tile['img']
  if ('transferToImageBitmap' in canvas) {
    // an ImageBitmap blits straight from the GPU; the scratch canvas is reused for the next tile
    img = (canvas as OffscreenCanvas).transferToImageBitmap()
    P.scratch = canvas
  } else img = canvas as CanvasImageSource
  return { img, level, dpr, tx, ty }
}

/**
 * Runs `fn` once per copy of the world that overlaps `r`: once on a flat map, and once per 360°
 * copy on a globe, each translated into place and clipped to its own longitude span.
 */
function eachCopy(ctx: Ctx, L: MapLayers, r: Box, fn: (r: Box) => void) {
  if (!L.period) {
    fn(r)
    return
  }
  const P = L.period
  for (let k = Math.floor(r[0] / P); k <= Math.floor(r[2] / P); k++) {
    ctx.save()
    ctx.translate(k * P, 0)
    ctx.beginPath()
    ctx.rect(0, L.content[1], P, L.content[3] - L.content[1])
    ctx.clip()
    fn([r[0] - k * P, r[1], r[2] - k * P, r[3]])
    ctx.restore()
  }
}

/** All baked layers for world rect `r`, in a context already transformed to world metres. */
function paintWorld(ctx: Ctx, L: MapLayers, P: Painter, r: Box, sL: number) {
  const ink = P.ink
  const m = 1 / sL // metres per CSS px at this level
  const c = L.content
  ctx.save()
  // content: the world, or a place's playable area; a globe repeats along x
  ctx.beginPath()
  if (L.period) ctx.rect(r[0] - 1, c[1], r[2] - r[0] + 2, c[3] - c[1])
  else ctx.rect(c[0], c[1], c[2] - c[0], c[3] - c[1])
  ctx.clip()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // 1–4: paper, hypsometric wash, class fills, relief
  ctx.fillStyle = rgba(ink.paper)
  ctx.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1])
  setSmoothing(ctx, 'high')
  eachCopy(ctx, L, r, (rr) => {
    const img = (im: MapCanvas) => drawGridImage(ctx, L, im, rr)
    img(P.wash)
    const fill = (cls: keyof MapLayers['outlines'], colour: RGB, alpha: number) => {
      if (!tracePolys(ctx, L.outlines[cls], rr)) return
      ctx.fillStyle = rgba(colour, alpha)
      ctx.fill('evenodd')
    }
    fill('sand', ink.sand, 0.75)
    fill('marsh', ink.marsh, 0.65)
    fill('ash', ink.ash, 1)
    fill('forest', ink.forest, 0.75)
    fill('rock', ink.rock, 0.85)
    fill('snow', ink.snow, 1)
    ctx.globalCompositeOperation = 'multiply'
    img(L.relief.shade)
    ctx.globalCompositeOperation = 'source-over'
    img(L.relief.light)
  })

  // 5: contours, at an interval that keeps them apart on the steeper slopes
  if (L.contourStep && L.contours.length) {
    const minGapPx = 12
    const need = (minGapPx * Math.max(0.05, L.slope90)) / sL
    let I = L.contourStep
    for (const k of [1, 2, 5, 10, 20, 50]) {
      I = L.contourStep * k
      if (I >= need) break
    }
    const plain: MapPoly[] = []
    const index: MapPoly[] = []
    for (const lv of L.contours) {
      const rel = Math.round(lv.level / L.contourStep)
      const step = Math.round(I / L.contourStep)
      if (rel % step) continue
      ;(Math.round(lv.level / I) % 5 === 0 ? index : plain).push(...lv.lines)
    }
    ctx.lineWidth = 0.8 * m
    if (tracePolys(ctx, plain, r)) {
      ctx.strokeStyle = rgba(ink.ink, 0.11)
      ctx.stroke()
    }
    if (tracePolys(ctx, index, r)) {
      ctx.strokeStyle = rgba(ink.ink, 0.22)
      ctx.stroke()
    }
  }

  // 6: water with a depth tint, ripple lines inside the shore, and the shore line itself
  eachCopy(ctx, L, r, (rr) => {
    if (!tracePolys(ctx, L.outlines.water, rr)) return
    ctx.save()
    ctx.clip('evenodd')
    drawGridImage(ctx, L, P.waterTint, rr)
    const coast = L.coast.filter((p) => hit(p.box, [rr[0] - 12 * m, rr[1] - 12 * m, rr[2] + 12 * m, rr[3] + 12 * m]))
    if (coast.length) {
      ctx.beginPath()
      for (const p of coast) tracePoly(ctx, p)
      // wide strokes along long coasts are the costliest thing a tile draws: bevel joins keep
      // them cheap, and two ripples read as well as three
      ctx.lineJoin = 'bevel'
      for (const [d, a] of [
        [7.5, 0.12],
        [3.5, 0.24],
      ] as const) {
        ctx.strokeStyle = rgba(ink.waterLine, a)
        ctx.lineWidth = (2 * d + 1.2) * m
        ctx.stroke()
        ctx.strokeStyle = rgba(ink.water)
        ctx.lineWidth = (2 * d - 1.2) * m
        ctx.stroke()
      }
    }
    ctx.restore()
    ctx.lineJoin = 'round'
    if (coast.length) {
      ctx.beginPath()
      for (const p of coast) tracePoly(ctx, p)
      ctx.strokeStyle = rgba(ink.waterLine, 0.9)
      ctx.lineWidth = 1.2 * m
      ctx.stroke()
    }
  })

  // 7–8, 10: symbols scattered on the level's pixel grid
  if (!P.lite) {
    ashStipple(ctx, L, ink, r, sL)
    marshTufts(ctx, L, ink, r, sL)
    hachures(ctx, L, ink, r, sL)
  }

  // 9: dry ditches (the Bree dike): a bank line with ticks on the outer side
  if (L.ditches.length) ditches(ctx, L, ink, r, m)

  // 10: a place's hedges, fences and walls, boundaries on the ground under the trees
  if (L.features) placeBounds(ctx, L.features, ink, r, m)

  if (!P.lite) trees(ctx, L, ink, r, sL)

  // 10b: a place's lanes, and over them its buildings, gates and bridges (a lane runs up to a
  // door, a gate stands across one), all above the trees so a garden tree never hides a house
  if (L.lanes) lanes(ctx, L, ink, r, m)
  if (L.features) placeStructures(ctx, L.features, ink, r, m)

  // 11: globe graticule
  if (L.world.isGlobe) graticule(ctx, L, ink, r, sL)

  // 12: places fade into the paper at the edge of the playable area
  if (L.vignette) vignette(ctx, ink, c, m)
  ctx.restore()
}

/**
 * Draws the part of a source-grid image (pixel i on grid index i, i.e. world (i + off)·cell)
 * that covers world rect r, plus a pixel or two for the filter. Drawing only that part keeps the
 * cost proportional to the tile, not to the whole world at the tile's scale.
 */
function drawGridImage(ctx: Ctx, L: MapLayers, im: MapCanvas, r: Box) {
  const toPx = (v: number) => v / L.cell - L.off + 0.5
  const sx0 = Math.max(0, Math.floor(toPx(r[0])) - 2)
  const sz0 = Math.max(0, Math.floor(toPx(r[1])) - 2)
  const sx1 = Math.min(L.w, Math.ceil(toPx(r[2])) + 2)
  const sz1 = Math.min(L.h, Math.ceil(toPx(r[3])) + 2)
  if (sx1 <= sx0 || sz1 <= sz0) return
  const o = (L.off - 0.5) * L.cell
  ctx.drawImage(im as CanvasImageSource, sx0, sz0, sx1 - sx0, sz1 - sz0, o + sx0 * L.cell, o + sz0 * L.cell, (sx1 - sx0) * L.cell, (sz1 - sz0) * L.cell)
}

function setSmoothing(ctx: Ctx, q: ImageSmoothingQuality) {
  ctx.imageSmoothingEnabled = true
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = q
}

/** Grid cells (in the level's CSS pixels) covering world rect r, with a margin in pixels. */
function gridRange(r: Box, sL: number, step: number, margin: number) {
  return {
    a0: Math.floor((r[0] * sL - margin) / step),
    a1: Math.ceil((r[2] * sL + margin) / step),
    b0: Math.floor((r[1] * sL - margin) / step),
    b1: Math.ceil((r[3] * sL + margin) / step),
  }
}

function inContent(L: MapLayers, x: number, z: number) {
  const c = L.content
  return z >= c[1] && z <= c[3] && (L.period > 0 || (x >= c[0] && x <= c[2]))
}

function ashStipple(ctx: Ctx, L: MapLayers, ink: Ink, r: Box, sL: number) {
  const f = L.fields.mask.ash
  if (!L.outlines.ash.length) return
  const step = 5
  const g = gridRange(r, sL, step, 2)
  const d = 1.1 / sL
  ctx.beginPath()
  for (let b = g.b0; b <= g.b1; b++) {
    for (let a = g.a0; a <= g.a1; a++) {
      if (hash(a, b, 11) < 0.55) continue
      const x = (a + hash(a, b, 12)) * step / sL
      const z = (b + hash(a, b, 13)) * step / sL
      if (sample(L, f, x, z) < 0.6) continue
      ctx.rect(x, z, d, d)
    }
  }
  ctx.fillStyle = rgba(ink.ink, 0.24)
  ctx.fill()
}

function marshTufts(ctx: Ctx, L: MapLayers, ink: Ink, r: Box, sL: number) {
  const f = L.fields.mask.marsh
  if (!L.outlines.marsh.length) return
  const step = 11
  const g = gridRange(r, sL, step, 6)
  const m = 1 / sL
  ctx.beginPath()
  for (let b = g.b0; b <= g.b1; b++) {
    for (let a = g.a0; a <= g.a1; a++) {
      const x = (a + 0.2 + 0.6 * hash(a, b, 21)) * step * m
      const z = (b + 0.2 + 0.6 * hash(a, b, 22)) * step * m
      if (sample(L, f, x, z) < 0.45) continue
      // three blades from a short base line
      ctx.moveTo(x - 3 * m, z)
      ctx.lineTo(x + 3 * m, z)
      ctx.moveTo(x, z)
      ctx.lineTo(x, z - 3.2 * m)
      ctx.moveTo(x - 1.6 * m, z)
      ctx.lineTo(x - 2.6 * m, z - 2.2 * m)
      ctx.moveTo(x + 1.6 * m, z)
      ctx.lineTo(x + 2.6 * m, z - 2.2 * m)
    }
  }
  ctx.strokeStyle = rgba(ink.marshInk, 0.6)
  ctx.lineWidth = 0.8 * m
  ctx.stroke()
}

/**
 * Hachures: short strokes down the fall line on steep rock and ash, on a jittered 6 px grid.
 * Slopes facing the north-west light get thin pale strokes, the others heavier dark ones, which
 * with the relief shading gives mountains their form without drawing any one mountain.
 */
function hachures(ctx: Ctx, L: MapLayers, ink: Ink, r: Box, sL: number) {
  if (!L.outlines.rock.length && !L.outlines.ash.length) return
  const { rock, ash, snow } = L.fields.mask
  const h2 = L.fields.h2
  const step = 6
  const m = 1 / sL
  const g = gridRange(r, sL, step, 8)
  const e = L.cell
  ctx.beginPath()
  const dark: number[] = []
  for (let b = g.b0; b <= g.b1; b++) {
    for (let a = g.a0; a <= g.a1; a++) {
      const x = (a + hash(a, b, 31)) * step * m
      const z = (b + hash(a, b, 32)) * step * m
      if ((sample(L, rock, x, z) < 0.5 && sample(L, ash, x, z) < 0.5) || sample(L, snow, x, z) > 0.5) continue
      const dx = (sample(L, h2, x + e, z) - sample(L, h2, x - e, z)) / (2 * e)
      const dz = (sample(L, h2, x, z + e) - sample(L, h2, x, z - e)) / (2 * e)
      const gr = Math.hypot(dx, dz)
      if (gr < L.steep) continue
      const len = Math.min(6, 1.5 + 2.2 * (gr / (4 * L.steep))) * m
      const ux = dx / gr
      const uz = dz / gr
      // a stroke that would run off the rock reads as fur on its edge; leave it out
      const ex2 = x - ux * len
      const ez2 = z - uz * len
      if (sample(L, rock, ex2, ez2) < 0.45 && sample(L, ash, ex2, ez2) < 0.45) continue
      if (ux + uz > 0) {
        // uphill toward the south-east: the slope faces the light
        ctx.moveTo(x, z)
        ctx.lineTo(x - ux * len, z - uz * len)
      } else dark.push(x, z, x - ux * len, z - uz * len)
    }
  }
  ctx.strokeStyle = rgba(ink.ink, 0.16)
  ctx.lineWidth = 0.7 * m
  ctx.stroke()
  ctx.beginPath()
  for (let i = 0; i < dark.length; i += 4) {
    ctx.moveTo(dark[i], dark[i + 1])
    ctx.lineTo(dark[i + 2], dark[i + 3])
  }
  ctx.strokeStyle = rgba(ink.ink, 0.38)
  ctx.lineWidth = 0.95 * m
  ctx.stroke()
}

/**
 * Forest symbols: little round-crowned or conifer trees on a staggered grid, drawn row by row so
 * the lower ones overlap the ones behind. Overworld trees keep one size on screen; in places,
 * where a tree is a few metres across, they grow with the zoom up to a limit.
 */
function trees(ctx: Ctx, L: MapLayers, ink: Ink, r: Box, sL: number) {
  if (!L.outlines.forest.length) return
  const f = L.fields.mask.forest
  const place = L.world.isPlace
  const step = place ? Math.max(7, 3.2 * sL) : 7
  const size = place ? Math.min(5, Math.max(2.4, 1.1 * sL)) : 3
  const m = 1 / sL
  const rowH = step * 0.8
  const g = gridRange(r, sL, step, size * 2.5)
  const b0 = Math.floor((r[1] * sL - size * 2.5) / rowH)
  const b1 = Math.ceil((r[3] * sL + size * 2.5) / rowH)
  const crown = rgba(ink.forestCrown)
  const dark = rgba(ink.forestDark)
  const edge = rgba(ink.forestInk, 0.85)
  const trunk = rgba(ink.forestInk, 0.9)
  const light = rgba(ink.paper, 0.35)
  ctx.lineWidth = 0.8 * m
  ctx.strokeStyle = edge
  for (let b = b0; b <= b1; b++) {
    const shift = (b & 1) * 0.5
    for (let a = g.a0; a <= g.a1; a++) {
      const sx = (a + shift + (hash(a, b, 41) - 0.5) * 0.8) * step
      const sy = (b + (hash(a, b, 42) - 0.5) * 0.75) * rowH
      const x = sx * m
      const z = sy * m
      if (sample(L, f, x, z) < 0.62 || !inContent(L, x, z)) continue
      const s = size * (0.85 + hash(a, b, 43) * 0.3) * m
      const kind = treeKindAt(L, x, z)
      ctx.fillStyle = trunk
      ctx.fillRect(x - 0.45 * m, z, 0.9 * m, s * 0.9)
      ctx.beginPath()
      if (kind === 0) {
        ctx.arc(x, z - s * 0.2, s, 0, Math.PI * 2)
        ctx.fillStyle = crown
        ctx.fill()
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(x - s * 0.35, z - s * 0.55, s * 0.35, 0, Math.PI * 2)
        ctx.fillStyle = light
        ctx.fill()
      } else {
        // a conifer: a narrow spire, darker in the dark woods
        ctx.moveTo(x, z - s * 1.6)
        ctx.lineTo(x + s * 0.8, z + s * 0.5)
        ctx.lineTo(x - s * 0.8, z + s * 0.5)
        ctx.closePath()
        ctx.fillStyle = kind === 2 ? dark : crown
        ctx.fill()
        ctx.stroke()
      }
    }
  }
}

function ditches(ctx: Ctx, L: MapLayers, ink: Ink, r: Box, m: number) {
  ctx.strokeStyle = rgba(ink.ditch, 0.6)
  for (const d of L.ditches) {
    if (!hit(d.box, [r[0] - 8 * m, r[1] - 8 * m, r[2] + 8 * m, r[3] + 8 * m])) continue
    const p = d.pts
    ctx.beginPath()
    tracePoly(ctx, d)
    ctx.lineWidth = 2.2 * m
    ctx.stroke()
    // ticks every 5 px on the side away from the ditch's middle (the outside of the bank)
    let mx = 0
    let mz = 0
    for (let i = 0; i < p.length; i += 2) {
      mx += p[i]
      mz += p[i + 1]
    }
    mx /= p.length / 2
    mz /= p.length / 2
    ctx.beginPath()
    let carry = 0
    const gap = 5 * m
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i]
      const az = p[i + 1]
      const bx = p[i + 2]
      const bz = p[i + 3]
      const len = Math.hypot(bx - ax, bz - az)
      if (!len) continue
      let nx = -(bz - az) / len
      let nz = (bx - ax) / len
      if (nx * (ax - mx) + nz * (az - mz) < 0) {
        nx = -nx
        nz = -nz
      }
      for (let t = carry; t < len; t += gap) {
        const x = ax + ((bx - ax) * t) / len
        const z = az + ((bz - az) * t) / len
        ctx.moveTo(x, z)
        ctx.lineTo(x + nx * 3.5 * m, z + nz * 3.5 * m)
      }
      carry = (((carry - len) % gap) + gap) % gap
    }
    ctx.lineWidth = 1 * m
    ctx.stroke()
  }
}

/** A world box grown by d on every side. */
const grow = (b: Box, d: number): Box => [b[0] - d, b[1] - d, b[2] + d, b[3] + d]

/**
 * A place's lanes: a paper casing and a band of the lane's own width. Every casing goes down
 * before any band, so where lanes meet the bands run into each other with no casing across.
 */
function lanes(ctx: Ctx, L: MapLayers, ink: Ink, r: Box, m: number) {
  for (const pass of [0, 1]) {
    for (const road of L.roads) {
      // the band reaches past the centreline's box: one that only grazes this tile must still be drawn
      if (!hit(road.box, grow(r, road.width + 3 * m))) continue
      ctx.beginPath()
      tracePoly(ctx, road)
      ctx.strokeStyle = pass ? rgba(ink.roadFill, 0.9) : rgba(ink.paper, 0.85)
      ctx.lineWidth = pass ? Math.max(1.5 * m, road.width * 0.55) : Math.max(3 * m, road.width * 0.9)
      ctx.stroke()
    }
  }
}

function traceLines(ctx: Ctx, lines: FeatureLine[], r: Box): boolean {
  let any = false
  ctx.beginPath()
  for (const l of lines) {
    if (!hit(l.box, r)) continue
    const a = l.pts
    ctx.moveTo(a[0], a[1])
    for (let i = 2; i < a.length; i += 2) ctx.lineTo(a[i], a[i + 1])
    any = true
  }
  return any
}

function traceRing(ctx: Ctx, a: Float32Array) {
  ctx.moveTo(a[0], a[1])
  for (let i = 2; i < a.length; i += 2) ctx.lineTo(a[i], a[i + 1])
  ctx.closePath()
}

/**
 * Hedges, walls, fences and pavilion rings: lines on the ground. Widths are the pieces' own in
 * metres, but never under a pixel or two, so a hedge still reads as a hedge at the fit zoom.
 */
function placeBounds(ctx: Ctx, F: PlaceFeatures, ink: Ink, r: Box, m: number) {
  ctx.lineCap = 'butt'
  for (const [lines, colour, alpha, minPx] of [
    [F.hedges, ink.forestInk, 0.8, 1.8],
    [F.walls, ink.ink, 0.7, 1.6],
  ] as const) {
    for (const l of lines) {
      if (!hit(l.box, r)) continue
      ctx.beginPath()
      ctx.moveTo(l.pts[0], l.pts[1])
      for (let i = 2; i < l.pts.length; i += 2) ctx.lineTo(l.pts[i], l.pts[i + 1])
      ctx.strokeStyle = rgba(colour, alpha)
      ctx.lineWidth = Math.max(minPx * m, l.width)
      ctx.stroke()
    }
  }
  if (traceLines(ctx, F.fences, r)) {
    // post-and-rail: a fine dashed line
    ctx.setLineDash([3 * m, 1.6 * m])
    ctx.strokeStyle = rgba(ink.ink, 0.62)
    ctx.lineWidth = Math.max(0.9 * m, 0.16)
    ctx.stroke()
    ctx.setLineDash([])
  }
  for (const p of F.pavilions) {
    if (!hit(p.box, r)) continue
    ctx.beginPath()
    ctx.arc(p.x, p.z, p.r, 0, Math.PI * 2)
    ctx.setLineDash([2 * m, 2 * m])
    ctx.strokeStyle = rgba(ink.ink, 0.45)
    ctx.lineWidth = 0.9 * m
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.lineCap = 'round'
}

/**
 * Buildings and the things built across the ground: quays, bridge decks, footprints in ink with
 * a pale roof ridge, smials (the turf brow, the facade, a dot of the door's own colour), wells,
 * mill wheels and gates. Sizes are real; the smallest marks keep a pixel or two.
 */
function placeStructures(ctx: Ctx, F: PlaceFeatures, ink: Ink, r: Box, m: number) {
  ctx.lineJoin = 'miter'
  for (const q of F.quays) {
    if (!hit(q.box, r)) continue
    ctx.beginPath()
    traceRing(ctx, q.ring)
    ctx.fillStyle = rgba(ink.rock)
    ctx.fill()
    ctx.strokeStyle = rgba(ink.ink, 0.55)
    ctx.lineWidth = 0.8 * m
    ctx.stroke()
  }
  for (const b of F.bridges) {
    if (!hit(b.box, r)) continue
    ctx.beginPath()
    traceRing(ctx, b.ring)
    ctx.fillStyle = rgba(ink.paper)
    ctx.fill()
    ctx.beginPath()
    for (let i = 0; i + 3 < b.sides.length; i += 4) {
      ctx.moveTo(b.sides[i], b.sides[i + 1])
      ctx.lineTo(b.sides[i + 2], b.sides[i + 3])
    }
    ctx.strokeStyle = rgba(ink.ink, 0.85)
    ctx.lineWidth = Math.max(1 * m, 0.3)
    ctx.stroke()
  }
  // smials: the brow first (a faint arc of the hill), then the facade over it
  let any = false
  ctx.beginPath()
  for (const s of F.smials) {
    if (!hit(grow(s.box, 6), r)) continue
    ctx.moveTo(s.brow[0], s.brow[1])
    for (let i = 2; i < s.brow.length; i += 2) ctx.lineTo(s.brow[i], s.brow[i + 1])
    any = true
  }
  if (any) {
    ctx.strokeStyle = rgba(ink.forestInk, 0.5)
    ctx.lineWidth = 0.9 * m
    ctx.stroke()
  }
  ctx.beginPath()
  any = false
  for (const b of F.buildings) {
    if (!hit(b.box, r)) continue
    traceRing(ctx, b.ring)
    any = true
  }
  for (const s of F.smials) {
    if (!hit(s.box, r)) continue
    traceRing(ctx, s.ring)
    any = true
  }
  if (any) {
    ctx.fillStyle = rgba(ink.ink, 0.8)
    ctx.fill()
    ctx.strokeStyle = rgba(ink.ink, 0.9)
    ctx.lineWidth = 0.6 * m
    ctx.stroke()
  }
  ctx.beginPath()
  any = false
  for (const b of F.buildings) {
    // a round tower has no ridge
    if (b.ridge.length < 4 || !hit(b.box, r)) continue
    ctx.moveTo(b.ridge[0], b.ridge[1])
    ctx.lineTo(b.ridge[2], b.ridge[3])
    any = true
  }
  if (any) {
    ctx.strokeStyle = rgba(ink.paper, 0.5)
    ctx.lineWidth = 0.8 * m
    ctx.stroke()
  }
  for (const s of F.smials) {
    if (!hit(s.box, r)) continue
    ctx.beginPath()
    ctx.arc(s.door[0], s.door[1], Math.max(1.8 * m, 0.9), 0, Math.PI * 2)
    ctx.fillStyle = s.doorColor
    ctx.fill()
    ctx.strokeStyle = rgba(ink.paper, 0.9)
    ctx.lineWidth = 0.9 * m
    ctx.stroke()
  }
  for (const w of F.wells) {
    if (!hit(w.box, r)) continue
    ctx.beginPath()
    ctx.arc(w.x, w.z, Math.max(1.6 * m, w.r), 0, Math.PI * 2)
    ctx.fillStyle = rgba(ink.waterDeep)
    ctx.fill()
    ctx.strokeStyle = rgba(ink.ink, 0.75)
    ctx.lineWidth = Math.max(0.8 * m, 0.25)
    ctx.stroke()
  }
  if (traceLines(ctx, F.wheels, r)) {
    ctx.strokeStyle = rgba(ink.ink, 0.8)
    ctx.lineWidth = Math.max(1.4 * m, 0.5)
    ctx.stroke()
  }
  // gates: a bar from post to post, the posts as dots
  ctx.lineCap = 'butt'
  for (const g of F.gates) {
    if (!hit(g.box, r)) continue
    ctx.beginPath()
    ctx.moveTo(g.a[0], g.a[1])
    ctx.lineTo(g.b[0], g.b[1])
    ctx.strokeStyle = rgba(ink.ink, 0.9)
    ctx.lineWidth = Math.max(2 * m, 0.35)
    ctx.stroke()
    ctx.beginPath()
    for (const [x, z] of [g.a, g.b]) {
      ctx.moveTo(x + Math.max(1.5 * m, 0.4), z)
      ctx.arc(x, z, Math.max(1.5 * m, 0.4), 0, Math.PI * 2)
    }
    ctx.fillStyle = rgba(ink.ink)
    ctx.fill()
  }
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
}

function graticule(ctx: Ctx, L: MapLayers, ink: Ink, r: Box, sL: number) {
  const m = 1 / sL
  const step = 10 * sL >= 60 ? 10 : 30
  const c = L.content
  ctx.beginPath()
  for (let x = Math.ceil(r[0] / step) * step; x <= r[2]; x += step) {
    ctx.moveTo(x, Math.max(c[1], r[1]))
    ctx.lineTo(x, Math.min(c[3], r[3]))
  }
  for (let z = Math.ceil(r[1] / step) * step; z <= r[3]; z += step) {
    if (z === 90) continue
    ctx.moveTo(r[0], z)
    ctx.lineTo(r[2], z)
  }
  ctx.strokeStyle = rgba(ink.ink, 0.14)
  ctx.lineWidth = 0.7 * m
  ctx.stroke()
  // the equator and the tropics, dashed
  ctx.beginPath()
  for (const z of [90, 90 - 23.44, 90 + 23.44]) {
    ctx.moveTo(r[0], z)
    ctx.lineTo(r[2], z)
  }
  ctx.setLineDash([4 * m, 3 * m])
  ctx.strokeStyle = rgba(ink.ink, 0.22)
  ctx.stroke()
  ctx.setLineDash([])
}

function vignette(ctx: Ctx, ink: Ink, c: Box, m: number) {
  const w = 24 * m
  const edges: [number, number, number, number][] = [
    [c[0], 0, c[0] + w, 0],
    [c[2], 0, c[2] - w, 0],
    [0, c[1], 0, c[1] + w],
    [0, c[3], 0, c[3] - w],
  ]
  for (const [ax, az, bx, bz] of edges) {
    const g = ctx.createLinearGradient(ax, az, bx, bz)
    g.addColorStop(0, rgba(ink.paper, 0.6))
    g.addColorStop(1, rgba(ink.paper, 0))
    ctx.fillStyle = g
    if (az === 0 && bz === 0) ctx.fillRect(Math.min(ax, bx), c[1], w, c[3] - c[1])
    else ctx.fillRect(c[0], Math.min(az, bz), c[2] - c[0], w)
  }
}

// ---------------------------------------------------------------------------------------------
// per-frame layers

/** An 8 CSS px tile of void colour with one 45° hatch line, seamless when repeated. */
function hatchTile(P: Painter, dpr: number): MapCanvas {
  const key = `hatch|${dpr}`
  let c = P.patterns.get(key)
  if (!c) {
    const n = Math.max(4, Math.round(8 * dpr))
    c = makeCanvas(n, n)
    const g = c.getContext('2d') as Ctx
    g.fillStyle = rgba(P.ink.void)
    g.fillRect(0, 0, n, n)
    g.strokeStyle = rgba(P.ink.hatch, 0.35)
    g.lineWidth = Math.max(1, 0.8 * dpr)
    g.beginPath()
    for (const o of [-n, 0, n]) {
      g.moveTo(o - 1, n + 1)
      g.lineTo(o + n + 1, -1)
    }
    g.stroke()
    P.patterns.set(key, c)
  }
  return c
}

/**
 * The void outside the content (outside the world, or outside a place's playable area): paper
 * a shade darker with a fine hatch, never water. Anchored to the world so it pans with the map,
 * and filled where the content does not cover, plus one device pixel under the content's edge:
 * the tiles' clipped edge is antialiased, and with opaque hatch beneath it no pixel there is left
 * part-transparent (showing whatever the previous frame drew).
 */
function voidHatch(ctx: CanvasRenderingContext2D, P: Painter, view: MapView, content: Box, period: number) {
  const { dpr, vw, vh, s } = view
  const rot = view.rotation ?? 0
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  // world → device: centre, rotate, scale
  const W = vw * dpr
  const H = vh * dpr
  const k = s * dpr
  const toDev = (x: number, z: number): [number, number] => {
    const dx = (x - view.cx) * k
    const dz = (z - view.cz) * k
    return [W / 2 + dx * cos - dz * sin, H / 2 + dx * sin + dz * cos]
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.beginPath()
  ctx.rect(0, 0, W, H)
  // cut the content out (a globe's content runs on along x, so cut a band well past the view)
  const reach = (Math.hypot(vw, vh) / s) * 2
  const e = 1 / k
  const c: Box = period ? [view.cx - reach, content[1] + e, view.cx + reach, content[3] - e] : [content[0] + e, content[1] + e, content[2] - e, content[3] - e]
  const corners = [toDev(c[0], c[1]), toDev(c[2], c[1]), toDev(c[2], c[3]), toDev(c[0], c[3])]
  ctx.moveTo(corners[0][0], corners[0][1])
  for (let i = 1; i < 4; i++) ctx.lineTo(corners[i][0], corners[i][1])
  ctx.closePath()
  const pat = ctx.createPattern(hatchTile(P, dpr) as CanvasImageSource, 'repeat')
  if (!pat) return
  const n = Math.max(4, Math.round(8 * dpr))
  const [ox, oz] = toDev(0, 0)
  ctx.setTransform(cos, sin, -sin, cos, 0, 0)
  // the path was built in device space; express the world-origin anchor in the rotated frame
  const ax = ox * cos + oz * sin
  const az = -ox * sin + oz * cos
  // whole device pixels, so the pattern is copied rather than resampled
  ctx.translate(Math.round(((ax % n) + n) % n), Math.round(((az % n) + n) % n))
  ctx.fillStyle = pat
  ctx.fill('evenodd')
}

/** The overworld's roads, per frame: a paper casing and a dashed line (places: see lanes()). */
function roads(ctx: CanvasRenderingContext2D, L: MapLayers, ink: Ink, r: Box, s: number) {
  const list = L.roads.filter((p) => hit(p.box, r))
  if (!list.length) return
  const m = 1 / s
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const copies = L.period ? [Math.floor(r[0] / L.period), Math.floor(r[2] / L.period)] : [0, 0]
  for (let k = copies[0]; k <= copies[1]; k++) {
    ctx.save()
    if (k) ctx.translate(k * L.period, 0)
    for (const road of list) {
      ctx.beginPath()
      tracePoly(ctx, road)
      ctx.strokeStyle = rgba(ink.paper, 0.85)
      ctx.lineWidth = 3.2 * m
      ctx.stroke()
      ctx.setLineDash([5 * m, 3.5 * m])
      ctx.strokeStyle = rgba(ink.road, 0.95)
      ctx.lineWidth = 1.3 * m
      ctx.stroke()
      ctx.setLineDash([])
    }
    ctx.restore()
  }
}

/** A plain relief underlay for areas whose tiles are not painted yet (mid-gesture only). */
function underlay(ctx: CanvasRenderingContext2D, L: MapLayers, P: Painter, r: Box) {
  setSmoothing(ctx, 'low')
  eachCopy(ctx, L, r, (rr) => {
    const img = (im: MapCanvas) => drawGridImage(ctx, L, im, rr)
    img(P.wash)
    ctx.globalCompositeOperation = 'multiply'
    img(L.relief.shade)
    ctx.globalCompositeOperation = 'source-over'
    if (tracePolys(ctx, L.outlines.water, rr)) {
      ctx.save()
      ctx.clip('evenodd')
      img(P.waterTint)
      ctx.restore()
    }
  })
}

/**
 * Draws the base map (terrain, water, forests, relief, roads, a place's buildings — not markers
 * or labels, which the dialog lays out in the DOM) for `view` into `ctx`. It does not clear the
 * canvas, and needs not: every pixel is painted opaquely, the void hatch outside the content
 * (reaching a pixel under its edge) and inside it the tiles, other levels' tiles or a plain
 * relief underlay. `detail: 'fast'` paints only a few new tiles per call and fills gaps from what
 * is cached; follow a gesture with a 'full' frame.
 */
export function drawMap(ctx: CanvasRenderingContext2D, pm: PreparedMap, view: MapView, theme: MapTheme, opts: { detail: 'full' | 'fast'; quality: Quality }): void {
  const t0 = now()
  const L = pm.layers as MapLayers
  const P = painterFor(L, theme, opts.quality === 'low')
  const { dpr, vw, vh, s } = view
  const rot = view.rotation ?? 0

  ctx.save()
  voidHatch(ctx, P, view, L.content, L.period)

  // the view transform: world metres → device pixels
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.translate(vw / 2, vh / 2)
  if (rot) ctx.rotate(rot)
  ctx.scale(s, s)
  ctx.translate(-view.cx, -view.cz)

  // the world rect in view (a rotated view needs the circle round its corners)
  const hx = rot ? Math.hypot(vw, vh) / 2 / s : vw / 2 / s
  const hz = rot ? Math.hypot(vw, vh) / 2 / s : vh / 2 / s
  const vis: Box = [view.cx - hx, view.cz - hz, view.cx + hx, view.cz + hz]
  const c = L.content
  const area: Box = L.period ? [vis[0], Math.max(vis[1], c[1]), vis[2], Math.min(vis[3], c[3])] : [Math.max(vis[0], c[0]), Math.max(vis[1], c[1]), Math.min(vis[2], c[2]), Math.min(vis[3], c[3])]

  const stats = { tilesDrawn: 0, tilesRendered: 0, tilesMissing: 0 }
  const level = levelFor(s)
  if (area[2] > area[0] && area[3] > area[1]) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(area[0], area[1], area[2] - area[0], area[3] - area[1])
    ctx.clip()

    const q = levelScale(level) * dpr
    const tw = TILE / q
    const want: { tx: number; ty: number; d: number }[] = []
    for (let ty = Math.floor(area[1] / tw); ty <= Math.floor(area[3] / tw); ty++) {
      for (let tx = Math.floor(area[0] / tw); tx <= Math.floor(area[2] / tw); tx++) {
        want.push({ tx, ty, d: Math.hypot((tx + 0.5) * tw - view.cx, (ty + 0.5) * tw - view.cz) })
      }
    }
    want.sort((a, b) => a.d - b.d)

    // paint what is missing (all of it on a full frame; a few ms' worth mid-gesture)
    const fast = opts.detail === 'fast'
    const ready: Tile[] = []
    const gaps: Box[] = []
    const tPaint = now()
    for (const w of want) {
      const key = tileKey(level, dpr, w.tx, w.ty)
      let t = P.tiles.get(key)
      if (t) {
        P.tiles.delete(key)
        P.tiles.set(key, t)
      } else if (!fast || stats.tilesRendered === 0 || now() - tPaint < FAST_BUDGET_MS) {
        // even a fast frame paints one tile (the one nearest the centre), so a long gesture converges
        t = renderTile(L, P, level, dpr, w.tx, w.ty)
        P.tiles.set(key, t)
        stats.tilesRendered++
      }
      if (t) ready.push(t)
      else gaps.push([w.tx * tw, w.ty * tw, (w.tx + 1) * tw, (w.ty + 1) * tw])
    }
    stats.tilesMissing = gaps.length

    if (gaps.length) {
      // fill the gaps from other levels' tiles (coarse first, finer on top); where even those
      // leave holes, a plain relief underlay goes beneath
      const others = [...P.tiles.values()]
        .filter((t) => t.level !== level && t.dpr === dpr)
        .map((t) => {
          const tq = levelScale(t.level) * dpr
          const ttw = TILE / tq
          return { t, tq, box: [t.tx * ttw, t.ty * ttw, (t.tx + 1) * ttw, (t.ty + 1) * ttw] as Box }
        })
        .filter((o) => gaps.some((g) => hit(o.box, g)))
        .sort((a, b) => a.t.level - b.t.level)
      const inside = (x: number, z: number) => others.some((o) => x >= o.box[0] && x <= o.box[2] && z >= o.box[1] && z <= o.box[3])
      const covered = gaps.every((g) => {
        const x0 = Math.max(g[0], area[0])
        const z0 = Math.max(g[1], area[1])
        const x1 = Math.min(g[2], area[2])
        const z1 = Math.min(g[3], area[3])
        return inside(x0, z0) && inside(x1, z0) && inside(x0, z1) && inside(x1, z1) && inside((x0 + x1) / 2, (z0 + z1) / 2)
      })
      if (!covered) underlay(ctx, L, P, area)
      setSmoothing(ctx, 'low')
      for (const o of others) blit(ctx, o.t, o.tq)
    }
    setSmoothing(ctx, 'medium')
    for (const t of ready) blit(ctx, t, q)
    stats.tilesDrawn = ready.length

    // keep the cache bounded: drop the least recently used beyond the cap (never this frame's)
    const cap = Math.max(MAX_TILES, want.length + 8)
    while (P.tiles.size > cap) {
      const k = P.tiles.keys().next().value as string
      P.tiles.get(k)!.img.close?.()
      P.tiles.delete(k)
    }

    // a place's lanes are in the tiles already
    if (!L.lanes) roads(ctx, L, P.ink, vis, s)
    ctx.restore()
  }
  ctx.restore()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  lastDrawStats.ms = now() - t0
  lastDrawStats.level = level
  Object.assign(lastDrawStats, stats)
}

/** Draws a tile at its place in world metres, overlapping its neighbours by a device pixel. */
function blit(ctx: CanvasRenderingContext2D, t: Tile, q: number) {
  const e = 1
  const tw = TILE / q
  ctx.drawImage(t.img, BLEED - e, BLEED - e, TILE + 2 * e, TILE + 2 * e, t.tx * tw - e / q, t.ty * tw - e / q, (TILE + 2 * e) / q, (TILE + 2 * e) / q)
}
