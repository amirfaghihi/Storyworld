// Builds a Storyworld world from an SVG sketch map:
//   public/worlds/<id>/terrain.png  RGBA: R,G = 16-bit height (offset/scale in world.json), B = biome index
//   public/worlds/<id>/world.json   metadata, palette, landmarks, regions
//   public/worlds/<id>/debug.png    colourised preview for eyeballing the result
// Usage: npm run build:world [-- --world middle-earth]
import fs from 'node:fs'
import path from 'node:path'
import { createCanvas } from 'canvas'
import { PNG } from 'pngjs'
import { loadSvgShapes, hexToRgb, type Shape } from './lib/svg.ts'
import {
  rasterize, blur, distanceTransform, floodFill, makeFbm, smoothstep, clamp01, lerp, pointInPolygon,
  grid, type Poly,
} from './lib/raster.ts'

export type LandmarkType = 'city' | 'village' | 'fortress' | 'ruin' | 'forest' | 'mountain' | 'other'

export type GroundKind =
  | 'stone' | 'sand' | 'ash' | 'marsh' | 'snowyRock' | 'darkForest' | 'golden' | 'lava' | 'rubble' | 'blight'
  | 'meadow' | 'lush' | 'downs' | 'village' | 'scorched' | 'rust'
export type VegPalette = 'default' | 'golden' | 'dark' | 'dead' | 'willow' | 'holly' | 'old' | 'pine'
export interface Prop {
  kind: string
  offset?: [number, number]
  rotation?: number
  scale?: number
  color?: string
  params?: Record<string, unknown>
}
/** Weather this place keeps to itself, whatever the region does. See LOCAL_WEATHER in src/render/weather.ts. */
export type WeatherBias = 'misty' | 'foul' | 'ashen' | 'fair' | 'snowy'
/** Local light and air. See AURAS in src/render/auras.ts. */
export type Aura = 'golden' | 'silver' | 'morgul' | 'sorcery' | 'ember' | 'deepwood' | 'marshlight' | 'barrow' | 'seasilver' | 'deep'
export interface Dressing {
  radius: number
  setting: string
  ground?: { kind: GroundKind; blend?: number; inner?: number }
  vegetation?: { density?: number; palette?: VegPalette; flowers?: string }
  weather?: WeatherBias
  aura?: Aura
  props?: Prop[]
}

export interface WorldBuildConfig {
  id: string
  name: string
  seed: number
  svg: string
  attribution: string
  size: [number, number]
  cell: number
  seaLevel: number
  seaSeeds: [number, number][]
  palette: Record<string, string>
  landmarks: { id: string; displayName: string; type: LandmarkType; svg: [number, number]; placeId?: string; discoverRadius?: number }[]
  regions: { id: string; displayName: string; svg: [number, number][]; biome?: 'ash'; mood?: string }[]
  volcanoes: { svg: [number, number]; radius: number; height: number }[]
}

// Biome indices stored in the blue channel. Keep in sync with src/world/biomes.ts
export const BIOME = { water: 0, sand: 1, grass: 2, forest: 3, rock: 4, snow: 5, ash: 6, marsh: 7, road: 8, riverbed: 9 } as const

const HEIGHT_OFFSET = -60
const HEIGHT_SCALE = 220 // metres spanned by the 16-bit range

type Cls = 'coast' | 'river' | 'lake' | 'forest' | 'relief' | 'reliefLine' | 'city' | 'road' | 'skip' | 'unknown'

function classify(s: Shape): Cls {
  const fill = hexToRgb(s.style.fill)
  const stroke = hexToRgb(s.style.stroke)
  const area = (s.bbox.maxX - s.bbox.minX) * (s.bbox.maxY - s.bbox.minY)
  if (s.style.fill === '#efcdba') return 'relief'
  if (s.style.fill === '#eeebd5') return 'skip' // compass rose decoration
  if (fill && fill[1] > fill[0] + 30 && fill[1] > fill[2] + 30) return 'forest'
  if (fill && fill[2] > 190 && fill[0] > 90) return 'lake'
  if (fill && fill[0] < 20 && fill[1] < 20 && fill[2] < 20 && area < 4) return 'city'
  if (!fill && stroke) {
    if (stroke[2] > stroke[0] + 40 && stroke[2] > stroke[1] + 40) return s.style.strokeWidth >= 1 ? 'coast' : 'river'
    if (Math.abs(stroke[0] - stroke[1]) < 12 && Math.abs(stroke[1] - stroke[2]) < 12) return 'road'
    if (stroke[0] > stroke[1] + 60) return 'reliefLine'
  }
  return 'unknown'
}

async function main() {
  const worldArg = process.argv.includes('--world') ? process.argv[process.argv.indexOf('--world') + 1] : 'middle-earth'
  const mod = await import(`./worlds/${worldArg}.ts`)
  const cfg: WorldBuildConfig = Object.values(mod)[0] as WorldBuildConfig
  let dressings: Record<string, Dressing> = {}
  try {
    const dm = await import(`./worlds/${worldArg}.dressings.ts`)
    dressings = dm.dressings as Record<string, Dressing>
  } catch {
    console.log('  (no dressings file)')
  }
  const outDir = path.join('public', 'worlds', cfg.id)
  fs.mkdirSync(outDir, { recursive: true })

  const svgText = fs.readFileSync(cfg.svg, 'utf8')
  const doc = await loadSvgShapes(svgText)
  const W = Math.round(cfg.size[0] / cfg.cell)
  const H = Math.round(cfg.size[1] / cfg.cell)
  const sx = W / doc.viewBox.w // px per svg unit
  const sy = H / doc.viewBox.h
  const toPx = ([u, v]: [number, number]): [number, number] => [(u - doc.viewBox.x) * sx, (v - doc.viewBox.y) * sy]
  const toWorld = ([u, v]: [number, number]): [number, number] => [
    +((u - doc.viewBox.x) * (cfg.size[0] / doc.viewBox.w)).toFixed(1),
    +((v - doc.viewBox.y) * (cfg.size[1] / doc.viewBox.h)).toFixed(1),
  ]
  console.log(`viewBox ${doc.viewBox.w.toFixed(2)} x ${doc.viewBox.h.toFixed(2)} -> ${W} x ${H} px (${cfg.cell} m/px), ${doc.shapes.length} shapes`)

  // ---- classify shapes
  const buckets: Record<Cls, Shape[]> = { coast: [], river: [], lake: [], forest: [], relief: [], reliefLine: [], city: [], road: [], skip: [], unknown: [] }
  for (const s of doc.shapes) buckets[classify(s)].push(s)
  for (const [k, v] of Object.entries(buckets)) if (v.length) console.log(`  ${k.padEnd(11)} ${v.length}`)
  for (const s of buckets.unknown) console.log('  unknown:', s.id, s.style, `bbox ${s.bbox.minX.toFixed(1)},${s.bbox.minY.toFixed(1)}-${s.bbox.maxX.toFixed(1)},${s.bbox.maxY.toFixed(1)}`)
  for (const s of buckets.reliefLine) console.log('  reliefLine:', s.id, `bbox ${s.bbox.minX.toFixed(1)},${s.bbox.minY.toFixed(1)}-${s.bbox.maxX.toFixed(1)},${s.bbox.maxY.toFixed(1)}`)
  const cities = buckets.city.map((s) => {
    const cx = (s.bbox.minX + s.bbox.maxX) / 2, cy = (s.bbox.minY + s.bbox.maxY) / 2
    return [cx, cy] as [number, number]
  })
  console.log('  city dots (svg units):', cities.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('  '))

  const px = (polys: Poly[]) => polys.map((p) => p.map(toPx))

  // ---- coast + sea via flood fill. Close open coast ends to the nearest map edge.
  const coastPolys: Poly[] = []
  for (const s of buckets.coast) for (const p of s.polys) coastPolys.push(p.map(toPx))
  const closures: Poly[] = []
  for (const p of coastPolys) {
    console.log(`  coast subpath: ${p.length} pts, from (${p[0][0].toFixed(0)}, ${p[0][1].toFixed(0)}) to (${p[p.length - 1][0].toFixed(0)}, ${p[p.length - 1][1].toFixed(0)})`)
    for (const end of [p[0], p[p.length - 1]]) {
      const [x, y] = end
      const dEdge = Math.min(x, y, W - 1 - x, H - 1 - y)
      if (dEdge > 0.5) {
        // drop a barrier straight to the nearest edge (prefer bottom edge for southern ends)
        const target: [number, number] = H - 1 - y <= Math.min(x, W - 1 - x, y) ? [x, H - 1] : y <= Math.min(x, W - 1 - x) ? [x, 0] : x <= W - 1 - x ? [0, y] : [W - 1, y]
        closures.push([end, target])
        console.log(`  coast end at px (${x.toFixed(0)}, ${y.toFixed(0)}) closed to (${target[0].toFixed(0)}, ${target[1].toFixed(0)})`)
      }
    }
  }
  const barrier = rasterize(W, H, [{ polys: [...coastPolys, ...closures], mode: 'stroke', lineWidth: 2.5 }])
  const seaRaw = floodFill(barrier, cfg.seaSeeds.map(toPx))
  // absorb barrier pixels adjacent to sea so the coast has no ridge
  const sea = grid(W, H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    if (seaRaw.data[i]) { sea.data[i] = 1; continue }
    if (barrier.data[i] > 0.3) {
      const n = [i - 1, i + 1, i - W, i + W].some((j) => j >= 0 && j < W * H && seaRaw.data[j] === 1)
      if (n) sea.data[i] = 1
    }
  }
  let seaCount = 0
  for (let i = 0; i < sea.data.length; i++) seaCount += sea.data[i]
  console.log(`  sea covers ${((100 * seaCount) / (W * H)).toFixed(1)}% of the map`)

  // ---- feature masks
  const lakes = rasterize(W, H, [{ polys: px(buckets.lake.flatMap((s) => s.polys)), mode: 'fill' }])
  const forest = rasterize(W, H, [{ polys: px(buckets.forest.flatMap((s) => s.polys)), mode: 'fill' }])
  const reliefAreas = buckets.relief.map((s) => (s.bbox.maxX - s.bbox.minX) * (s.bbox.maxY - s.bbox.minY))
  const HILL_AREA = 120 // svg units^2: smaller relief blobs are hills, larger are mountain ranges
  const mountains = rasterize(W, H, [{ polys: px(buckets.relief.filter((_, i) => reliefAreas[i] >= HILL_AREA).flatMap((s) => s.polys)), mode: 'fill' }])
  const hills = rasterize(W, H, [{ polys: px(buckets.relief.filter((_, i) => reliefAreas[i] < HILL_AREA).flatMap((s) => s.polys)), mode: 'fill' }])
  const riversMajor = buckets.river.filter((s) => s.style.strokeWidth >= 0.4)
  const riversMinor = buckets.river.filter((s) => s.style.strokeWidth < 0.4)
  const rivers = rasterize(W, H, [
    { polys: px(riversMajor.flatMap((s) => s.polys)), mode: 'stroke', lineWidth: 4.2 },
    { polys: px(riversMinor.flatMap((s) => s.polys)), mode: 'stroke', lineWidth: 3.0 },
  ])
  const roads = rasterize(W, H, [{ polys: px(buckets.road.flatMap((s) => s.polys)), mode: 'stroke', lineWidth: 1.6 }])

  // ---- distances
  const dSea = distanceTransform(sea) // for land pixels: distance to sea (px)
  const landMask = grid(W, H)
  for (let i = 0; i < W * H; i++) landMask.data[i] = sea.data[i] ? 0 : 1
  const dLand = distanceTransform(landMask) // for sea pixels: distance to land
  const notMountain = grid(W, H)
  for (let i = 0; i < W * H; i++) notMountain.data[i] = mountains.data[i] > 0.5 ? 0 : 1
  const dMountainEdge = distanceTransform(notMountain) // inside mountains: distance to edge

  const mountainsSoft = blur(mountains, 2, 2)
  const hillsSoft = blur(hills, 5, 3)
  const lakesSoft = blur(lakes, 2, 2)
  const riversSoft = blur(rivers, 3, 2)

  // ---- height synthesis (metres)
  const fbm = makeFbm(cfg.seed)
  const fbm2 = makeFbm(cfg.seed + 1)
  const ridged = makeFbm(cfg.seed + 2)
  const cell = cfg.cell
  const h = grid(W, H)
  const ashRegions = cfg.regions.filter((r) => r.biome === 'ash').map((r) => r.svg.map(toPx))
  const isAsh = (x: number, y: number) => ashRegions.some((poly) => pointInPolygon(x, y, poly))

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const mx = x * cell, my = y * cell // metres
      let v: number
      if (sea.data[i]) {
        v = -1.5 - 22 * smoothstep(0, 60, dLand.data[i] * cell) + 1.5 * fbm(mx / 90, my / 90, 2)
      } else {
        const coastT = smoothstep(0, 36, dSea.data[i] * cell)
        const rolling = 5.5 * fbm(mx / 140, my / 140, 3) + 1.2 * fbm2(mx / 28, my / 28, 2)
        v = 1.5 + 6.5 * coastT + rolling * smoothstep(0, 16, dSea.data[i] * cell)
      }
      // hills
      const hm = hillsSoft.data[i]
      if (hm > 0.001) v += hm * 26 * (0.6 + 0.4 * (0.5 + 0.5 * fbm2(mx / 55, my / 55, 3)))
      // mountains
      const mm = mountainsSoft.data[i]
      if (mm > 0.001) {
        const inner = clamp01((dMountainEdge.data[i] * cell) / 22)
        // two ridged octaves: long crests plus sharp secondary spurs; peaks reach ~140 m
        const r1 = 1 - Math.abs(ridged(mx / 52, my / 52, 3))
        const r2 = 1 - Math.abs(ridged(mx / 17 + 31, my / 17 - 17, 2))
        const crest = 0.35 + 0.65 * Math.pow(r1, 2.1)
        v += mm * (30 + 92 * inner * crest) + mm * inner * 11 * Math.pow(r2, 1.6) + mm * 5 * fbm(mx / 12, my / 12, 2)
      }
      // ash plains are flatter and darker; keep a little roughness
      if (isAsh(x, y) && mm < 0.2 && hm < 0.2) v = lerp(v, 10 + 2.5 * fbm2(mx / 40, my / 40, 2), 0.6)
      h.data[i] = v
    }
  }
  // volcanoes
  for (const vol of cfg.volcanoes) {
    const [cx, cy] = toPx(vol.svg)
    const rPx = vol.radius / cell
    for (let y = Math.max(0, Math.floor(cy - rPx)); y <= Math.min(H - 1, Math.ceil(cy + rPx)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rPx)); x <= Math.min(W - 1, Math.ceil(cx + rPx)); x++) {
        const d = Math.hypot(x - cx, y - cy) / rPx
        if (d > 1) continue
        const cone = vol.height * (1 - Math.pow(d, 0.85))
        const crater = d < 0.18 ? -vol.height * 0.15 * (1 - d / 0.18) : 0
        const i = y * W + x
        h.data[i] = Math.max(h.data[i], h.data[i] * 0.3 + 8 + cone + crater)
      }
    }
  }
  // light smoothing, then carve water
  const hs = blur(h, 1, 1)
  const slopeArr = new Float32Array(W * H)
  const paintedWater = new Uint8Array(W * H) // water above sea level (highland lakes, river beds)

  // Lakes: each connected lake sits in a flat basin a few metres below the lowest point of its shore.
  const lakeLabel = new Int32Array(W * H).fill(-1)
  const lakeLevel: number[] = []
  {
    const stack: number[] = []
    for (let i0 = 0; i0 < W * H; i0++) {
      if (lakes.data[i0] <= 0.5 || lakeLabel[i0] >= 0) continue
      const id = lakeLevel.length
      let shoreMin = Infinity
      stack.push(i0)
      lakeLabel[i0] = id
      while (stack.length) {
        const i = stack.pop()!
        const x = i % W, y = (i - x) / W
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const j = ny * W + nx
          if (lakes.data[j] > 0.5) {
            if (lakeLabel[j] < 0) { lakeLabel[j] = id; stack.push(j) }
          } else if (hs.data[j] < shoreMin) shoreMin = hs.data[j]
        }
      }
      lakeLevel.push(Math.min(shoreMin, 40) - 3.5)
    }
    console.log(`  lakes: ${lakeLevel.length} basins, levels ${lakeLevel.map((v) => v.toFixed(1)).join(', ')}`)
  }
  // spread each lake's level to the blurred rim using nearest labelled pixel
  const rimLevel = new Float32Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    if (lakesSoft.data[i] <= 0.01) continue
    if (lakeLabel[i] >= 0) { rimLevel[i] = lakeLevel[lakeLabel[i]]; continue }
    let best = Infinity, lvl = 0
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const j = ny * W + nx
      if (lakeLabel[j] >= 0 && dx * dx + dy * dy < best) { best = dx * dx + dy * dy; lvl = lakeLevel[lakeLabel[j]] }
    }
    rimLevel[i] = best === Infinity ? hs.data[i] : lvl
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      let v = hs.data[i]
      const lm = lakesSoft.data[i]
      if (lm > 0.01) {
        v = lerp(v, rimLevel[i] - 1.5 * lakes.data[i], clamp01(lm * 1.3))
        if (lakes.data[i] > 0.5 && v > cfg.seaLevel - 0.4) paintedWater[i] = 1
      }
      // rivers: shallow channels relative to the local surface, never far below sea level so they can be waded
      const rm = clamp01(rivers.data[i] * 1.4)
      if (rm > 0.01 || riversSoft.data[i] > 0.01) {
        const bed = Math.max(v - 3.5, cfg.seaLevel - 1.0)
        v = lerp(v, bed, rm)
        v -= 1.5 * riversSoft.data[i] * (1 - rm)
        if (rm > 0.5 && v > cfg.seaLevel - 0.4) paintedWater[i] = 1
      }
      h.data[i] = v
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const l = h.data[Math.max(0, x - 1) + y * W], r = h.data[Math.min(W - 1, x + 1) + y * W]
      const u = h.data[x + Math.max(0, y - 1) * W], d = h.data[x + Math.min(H - 1, y + 1) * W]
      slopeArr[i] = Math.hypot((r - l) / (2 * cell), (d - u) / (2 * cell))
    }
  }

  // ---- biomes
  const biome = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const v = h.data[i]
      const slope = slopeArr[i]
      let b: number
      if (sea.data[i] || v < cfg.seaLevel - 0.4) b = BIOME.water
      else if (paintedWater[i]) b = BIOME.riverbed
      else if (v > 86) b = BIOME.snow
      else if (mountainsSoft.data[i] > 0.45 || v > 62 || slope > 0.95) b = BIOME.rock
      else if (isAsh(x, y)) b = BIOME.ash
      else if (roads.data[i] > 0.4) b = BIOME.road
      else if (forest.data[i] > 0.5) b = BIOME.forest
      else if (dSea.data[i] * cell < 10 && v < 6) b = BIOME.sand
      else if (lakesSoft.data[i] > 0.15) b = BIOME.marsh
      else b = BIOME.grass
      biome[i] = b
    }
  }

  // ---- write terrain.png
  const png = new PNG({ width: W, height: H, colorType: 6 })
  for (let i = 0; i < W * H; i++) {
    const enc = Math.max(0, Math.min(65535, Math.round(((h.data[i] - HEIGHT_OFFSET) / HEIGHT_SCALE) * 65535)))
    png.data[i * 4] = enc >> 8
    png.data[i * 4 + 1] = enc & 255
    png.data[i * 4 + 2] = biome[i]
    png.data[i * 4 + 3] = 255
  }
  fs.writeFileSync(path.join(outDir, 'terrain.png'), PNG.sync.write(png))

  // ---- debug preview
  const pal: Record<number, [number, number, number]> = {
    [BIOME.water]: [77, 143, 214], [BIOME.sand]: [230, 211, 160], [BIOME.grass]: [127, 184, 90], [BIOME.forest]: [63, 138, 70],
    [BIOME.rock]: [141, 132, 120], [BIOME.snow]: [244, 244, 248], [BIOME.ash]: [91, 82, 79], [BIOME.marsh]: [111, 143, 90],
    [BIOME.road]: [201, 180, 138], [BIOME.riverbed]: [90, 160, 220],
  }
  const dbg = createCanvas(W * 2, H * 2)
  const ctx = dbg.getContext('2d')
  const img = ctx.createImageData(W, H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    const [r, g, b] = pal[biome[i]]
    // hillshade from north-west
    const l = h.data[Math.max(0, x - 1) + y * W], rr = h.data[Math.min(W - 1, x + 1) + y * W]
    const u = h.data[x + Math.max(0, y - 1) * W], d = h.data[x + Math.min(H - 1, y + 1) * W]
    const shade = biome[i] === BIOME.water ? 1 - 0.01 * Math.max(0, -h.data[i]) : clamp01(1 + 0.025 * ((l - rr) + (u - d)))
    img.data[i * 4] = r * shade; img.data[i * 4 + 1] = g * shade; img.data[i * 4 + 2] = b * shade; img.data[i * 4 + 3] = 255
  }
  const small = createCanvas(W, H)
  small.getContext('2d').putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(small, 0, 0, W * 2, H * 2)
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 1
  for (const r of cfg.regions) {
    ctx.beginPath()
    r.svg.map(toPx).forEach(([x, y], k) => (k ? ctx.lineTo(x * 2, y * 2) : ctx.moveTo(x * 2, y * 2)))
    ctx.closePath(); ctx.stroke()
  }
  ctx.font = '11px sans-serif'
  for (const lm of cfg.landmarks) {
    const [x, y] = toPx(lm.svg)
    ctx.fillStyle = '#ff2d55'
    ctx.beginPath(); ctx.arc(x * 2, y * 2, 3, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#111'
    ctx.fillText(lm.displayName, x * 2 + 5, y * 2 + 4)
  }
  ctx.fillStyle = '#ffd60a'
  for (const s of cfg.seaSeeds) { const [x, y] = toPx(s); ctx.fillRect(x * 2 - 3, y * 2 - 3, 6, 6) }
  fs.writeFileSync(path.join(outDir, 'debug.png'), dbg.toBuffer('image/png'))

  // ---- world.json
  const world = {
    id: cfg.id,
    name: cfg.name,
    seed: cfg.seed,
    attribution: cfg.attribution,
    size: cfg.size,
    cell: cfg.cell,
    seaLevel: cfg.seaLevel,
    terrain: { file: 'terrain.png', heightOffset: HEIGHT_OFFSET, heightScale: HEIGHT_SCALE },
    palette: cfg.palette,
    spawn: toWorld(cfg.landmarks.find((l) => l.id === 'hobbiton')?.svg ?? cfg.landmarks[0].svg),
    landmarks: cfg.landmarks.map((l) => ({
      id: l.id, displayName: l.displayName, type: l.type, position: toWorld(l.svg),
      discoverRadius: l.discoverRadius ?? 28, ...(l.placeId ? { placeId: l.placeId } : {}),
      ...(dressings[l.id] ? { dressing: dressings[l.id] } : {}),
    })),
    regions: cfg.regions.map((r) => ({ id: r.id, displayName: r.displayName, polygon: r.svg.map(toWorld), ...(r.biome ? { biome: r.biome } : {}), ...(r.mood ? { mood: r.mood } : {}) })),
  }
  fs.writeFileSync(path.join(outDir, 'world.json'), JSON.stringify(world, null, 2))

  // ---- docs/landmarks.md: per-landmark checklist of setting + implemented dressing
  fs.mkdirSync('docs', { recursive: true })
  const rows = cfg.landmarks.map((l) => {
    const d = dressings[l.id]
    const props = d?.props?.map((p) => p.kind) ?? []
    const counts = new Map<string, number>()
    for (const k of props) counts.set(k, (counts.get(k) ?? 0) + 1)
    const propStr = [...counts.entries()].map(([k, n]) => (n > 1 ? `${k} x${n}` : k)).join(', ') || '—'
    const veg = d?.vegetation ? `density ${d.vegetation.density ?? 1}${d.vegetation.palette && d.vegetation.palette !== 'default' ? `, ${d.vegetation.palette}` : ''}${d.vegetation.flowers ? `, flowers: ${d.vegetation.flowers}` : ''}` : 'default'
    return `### ${l.displayName} (\`${l.id}\`, ${l.type})\n\n${d ? d.setting : '_No setting written yet._'}\n\n- Ground: ${d?.ground ? `${d.ground.kind} (blend ${d.ground.blend ?? 1}, radius ${d.radius} m)` : 'biome default'}\n- Vegetation: ${veg}\n- Set pieces: ${propStr}\n- Still to do: ${d ? 'replace procedural set pieces with kit models; tune placement in the editor; add ambient sound/fog.' : 'write setting from the books, choose ground + vegetation, add set pieces.'}\n`
  })
  fs.writeFileSync(
    path.join('docs', 'landmarks.md'),
    `# Landmark dressing checklist — ${cfg.name}\n\nGenerated by \`npm run build:world\` from \`scripts/worlds/${cfg.id}.dressings.ts\`. Edit that file, not this one.\n\nEach landmark has a **setting** (written from the books), a **ground** override that recolours the terrain within its radius, a **vegetation** override (density, palette, flowers) and a list of procedural **set pieces** placed relative to the landmark. See \`src/dressing/\` for how they render.\n\n${rows.join('\n')}`,
  )

  let min = Infinity, max = -Infinity
  for (const v of h.data) { if (v < min) min = v; if (v > max) max = v }
  const counts = new Map<number, number>()
  for (const b of biome) counts.set(b, (counts.get(b) ?? 0) + 1)
  console.log(`  height range ${min.toFixed(1)} .. ${max.toFixed(1)} m`)
  console.log('  biome %:', [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${Object.keys(BIOME)[k]} ${((100 * n) / (W * H)).toFixed(1)}`).join(', '))
  console.log(`wrote ${outDir}/terrain.png, world.json, debug.png`)
}

main().catch((e) => { console.error(e); process.exit(1) })
