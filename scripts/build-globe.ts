// Builds public/worlds/earth: a latitude/longitude height + biome grid for the globe renderer,
// from Natural Earth vectors (public domain). Same encoding as the flat worlds (R,G height, B biome).
//   npx tsx scripts/build-globe.ts
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import { createCanvas } from 'canvas'
import { grid, rasterize, blur, distanceTransform, makeFbm, smoothstep, clamp01, type Poly } from './lib/raster.ts'
const BIOME = { water: 0, sand: 1, grass: 2, forest: 3, rock: 4, snow: 5, ash: 6, marsh: 7, road: 8, riverbed: 9 } as const // mirrors build-world.ts
import { earth } from './worlds/earth.ts'

const HEIGHT_OFFSET = -60
const HEIGHT_SCALE = 220
const W = earth.width
const H = earth.height
const NE = 'assets-src/geodata/natural-earth'

type Feature = { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }
const load = (f: string) => (JSON.parse(fs.readFileSync(path.join(NE, f), 'utf8')) as { features: Feature[] }).features
const prop = (f: Feature, k: string) => (f.properties[k] ?? f.properties[k.toLowerCase()] ?? f.properties[k.toUpperCase()]) as string | undefined

/** lon/lat -> pixel */
const toPx = ([lon, lat]: [number, number]): [number, number] => [((lon + 180) / 360) * W, ((90 - lat) / 180) * H]
/** outer rings of a (Multi)Polygon in pixels */
function rings(f: Feature): Poly[] {
  const g = f.geometry
  const polys = g.type === 'Polygon' ? [g.coordinates as number[][][]] : g.type === 'MultiPolygon' ? (g.coordinates as number[][][][]) : []
  return polys.map((p) => p[0].map(([lon, lat]) => toPx([lon, lat])))
}
function lines(f: Feature): Poly[] {
  const g = f.geometry
  const ls = g.type === 'LineString' ? [g.coordinates as number[][]] : g.type === 'MultiLineString' ? (g.coordinates as number[][][]) : []
  return ls.map((l) => l.map(([lon, lat]) => toPx([lon, lat])))
}
/** Ramer-Douglas-Peucker in pixel space, then a hard cap on point count */
function simplify(poly: Poly, eps: number, maxPts = 90): Poly {
  const dp = (pts: Poly): Poly => {
    if (pts.length < 3) return pts
    const [a, b] = [pts[0], pts[pts.length - 1]]
    let idx = 0, dmax = 0
    for (let i = 1; i < pts.length - 1; i++) {
      const [x, y] = pts[i]
      const dx = b[0] - a[0], dy = b[1] - a[1]
      const L = Math.hypot(dx, dy) || 1e-6
      const d = Math.abs(dy * x - dx * y + b[0] * a[1] - b[1] * a[0]) / L
      if (d > dmax) { dmax = d; idx = i }
    }
    if (dmax > eps) return [...dp(pts.slice(0, idx + 1)).slice(0, -1), ...dp(pts.slice(idx))]
    return [a, b]
  }
  let out = dp(poly)
  while (out.length > maxPts) out = out.filter((_, i) => i % 2 === 0 || i === out.length - 1)
  return out
}

function main() {
  const outDir = path.join('public/worlds', earth.id)
  fs.mkdirSync(outDir, { recursive: true })

  const landF = load('ne_110m_land.geojson')
  const lakesF = load('ne_110m_lakes.geojson')
  const riversF = load('ne_110m_rivers_lake_centerlines.geojson')
  const glacF = load('ne_110m_glaciated_areas.geojson')
  const regF = load('ne_50m_geography_regions_polys.geojson')

  const land = rasterize(W, H, [{ polys: landF.flatMap(rings), mode: 'fill' }])
  // Antarctica reaches the bottom edge: everything below 78 S that the polygons missed is land too
  for (let y = Math.floor(((90 + 84) / 180) * H); y < H; y++) for (let x = 0; x < W; x++) land.data[y * W + x] = 1
  const lakes = rasterize(W, H, [{ polys: lakesF.flatMap(rings), mode: 'fill' }])
  const rivers = rasterize(W, H, [{ polys: riversF.flatMap(lines), mode: 'stroke', lineWidth: 1.6 }])
  const glaciers = rasterize(W, H, [{ polys: glacF.flatMap(rings), mode: 'fill' }])

  const ranges = regF.filter((f) => prop(f, 'FEATURECLA') === 'Range/mtn')
  const deserts = regF.filter((f) => prop(f, 'FEATURECLA') === 'Desert')
  const plateaus = regF.filter((f) => prop(f, 'FEATURECLA') === 'Plateau')
  const continents = regF.filter((f) => prop(f, 'FEATURECLA') === 'Continent')
  // range height field: paint each range with its own height, then the max wins
  const rangeH = grid(W, H)
  const rangeMask = grid(W, H)
  for (const f of ranges) {
    const name = (prop(f, 'NAME') ?? '').toUpperCase()
    const hgt = earth.rangeHeights[name] ?? earth.defaultRangeHeight
    const m = rasterize(W, H, [{ polys: rings(f), mode: 'fill' }])
    for (let i = 0; i < W * H; i++) if (m.data[i] > 0.3) { rangeH.data[i] = Math.max(rangeH.data[i], hgt); rangeMask.data[i] = 1 }
  }
  const desert = rasterize(W, H, [{ polys: deserts.flatMap(rings), mode: 'fill' }])
  const plateau = rasterize(W, H, [{ polys: plateaus.flatMap(rings), mode: 'fill' }])
  const rangeSoft = blur(rangeMask, 4, 3) // wide shoulders so the slopes stay walkable
  const notRange = grid(W, H)
  for (let i = 0; i < W * H; i++) notRange.data[i] = rangeMask.data[i] > 0.5 ? 0 : 1
  const dRangeEdge = distanceTransform(notRange)
  const notLand = grid(W, H), landOnly = grid(W, H)
  for (let i = 0; i < W * H; i++) { notLand.data[i] = land.data[i] > 0.5 ? 0 : 1; landOnly.data[i] = land.data[i] > 0.5 ? 1 : 0 }
  const dSea = distanceTransform(notLand) // on land: distance to the nearest sea pixel (px)
  const dLand = distanceTransform(landOnly) // at sea: distance to the nearest land pixel (px)
  const plateauSoft = blur(plateau, 3, 2)

  const fbm = makeFbm(earth.seed)
  const fbm2 = makeFbm(earth.seed + 1)
  const ridged = makeFbm(earth.seed + 2)
  const h = grid(W, H)
  // metres per pixel at the equator (for noise scale)
  const mpp = (2 * Math.PI * earth.radius) / W
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const mx = x * mpp, my = y * mpp
      let v: number
      // a 200 m planet: relief is scaled down so mountains read as ridges, not spikes
      const K = earth.reliefScale
      if (land.data[i] < 0.5) {
        v = -1.5 - 9 * smoothstep(0, 30, dLand.data[i]) + 0.8 * fbm(mx / 90, my / 90, 2)
      } else {
        const coastT = smoothstep(0, 14, dSea.data[i])
        v = 1.0 + 2.2 * coastT + (1.8 * fbm(mx / 120, my / 120, 3) + 0.5 * fbm2(mx / 30, my / 30, 2)) * smoothstep(0, 6, dSea.data[i])
        v += plateauSoft.data[i] * 18 * K
        const rm = rangeSoft.data[i]
        if (rm > 0.001) {
          const inner = clamp01(dRangeEdge.data[i] / 9)
          const r1 = 1 - Math.abs(ridged(mx / 40, my / 40, 3))
          const r2 = 1 - Math.abs(ridged(mx / 14 + 31, my / 14 - 17, 2))
          const crest = 0.35 + 0.65 * Math.pow(r1, 2.0)
          const hgt = (rangeH.data[i] || earth.defaultRangeHeight) * K
          v += rm * (0.25 * hgt + 0.75 * hgt * inner * crest) + rm * inner * 8 * K * Math.pow(r2, 1.6)
        }
        if (lakes.data[i] > 0.5) v = Math.min(v, -1.2)
        if (rivers.data[i] > 0.4 && lakes.data[i] < 0.5) v = Math.max(v - 1.2, 0.3)
      }
      h.data[i] = v
    }
  }
  // ---- biomes
  const biome = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y / H) * 180
    const alat = Math.abs(lat)
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const v = h.data[i]
      const mx = x * mpp, my = y * mpp
      const n = fbm2(mx / 70 + 5, my / 70, 2)
      let b: number
      if (land.data[i] < 0.5 || v < -0.4) b = BIOME.water
      else if (rivers.data[i] > 0.4) b = BIOME.riverbed
      else if (glaciers.data[i] > 0.4 || alat > 75 || v > (108 - alat * 0.9) * earth.reliefScale) b = BIOME.snow
      else if (rangeSoft.data[i] > 0.45 || v > 62 * earth.reliefScale) b = BIOME.rock
      else if (desert.data[i] > 0.4) b = BIOME.sand
      else if (alat > 66) b = n > 0.1 ? BIOME.rock : BIOME.grass
      else if (alat > 50 && alat <= 66) b = n > -0.25 ? BIOME.forest : BIOME.grass
      else if (alat < 12 && n > -0.45) b = BIOME.forest
      else if (dSea.data[i] < 1.6 && v < 1.8) b = BIOME.sand
      else if (n > 0.42) b = BIOME.forest
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
  const dbg = createCanvas(W, H)
  const ctx = dbg.getContext('2d')
  const img = ctx.createImageData(W, H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    const [r, g, b] = pal[biome[i]]
    const l = h.data[Math.max(0, x - 1) + y * W], rr = h.data[Math.min(W - 1, x + 1) + y * W]
    const u = h.data[x + Math.max(0, y - 1) * W], d = h.data[x + Math.min(H - 1, y + 1) * W]
    const shade = biome[i] === BIOME.water ? 1 - 0.01 * Math.max(0, -h.data[i]) : clamp01(1 + 0.03 * ((l - rr) + (u - d)))
    img.data[i * 4] = r * shade; img.data[i * 4 + 1] = g * shade; img.data[i * 4 + 2] = b * shade; img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  ctx.font = '11px sans-serif'
  for (const lm of earth.landmarks) {
    const [x, y] = toPx([lm.lon, lm.lat])
    ctx.fillStyle = '#ff2d55'; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#111'; ctx.fillText(lm.displayName, x + 5, y + 4)
  }
  fs.writeFileSync(path.join(outDir, 'debug.png'), dbg.toBuffer('image/png'))

  // ---- world.json (positions in map degrees: x = lon + 180, z = 90 - lat)
  const mapPos = (lon: number, lat: number): [number, number] => [+(lon + 180).toFixed(3), +(90 - lat).toFixed(3)]
  const regions = continents.map((f) => {
    const name = (prop(f, 'NAME') ?? 'Continent').toUpperCase()
    const ring = rings(f).sort((a, b) => b.length - a.length)[0]
    const poly = simplify(ring, 1.5).map(([px, py]) => [+((px / W) * 360).toFixed(2), +((py / H) * 180).toFixed(2)] as [number, number])
    return { id: name.toLowerCase().replace(/\s+/g, '-'), displayName: name.charAt(0) + name.slice(1).toLowerCase(), polygon: poly, mood: earth.continentMoods[name] ?? 'mixed' }
  })
  // latitude bands as moods (smaller than the big continents, so they win there)
  regions.push({ id: 'tropics', displayName: 'The Tropics', polygon: [[0, 78], [360, 78], [360, 102], [0, 102]], mood: 'lush' })
  regions.push({ id: 'boreal-north', displayName: 'The Boreal Forest', polygon: [[0, 24], [360, 24], [360, 42], [0, 42]], mood: 'pine' })
  const world = {
    id: earth.id,
    name: earth.name,
    kind: 'globe',
    radius: earth.radius,
    seed: earth.seed,
    attribution: earth.attribution,
    size: [360, 180],
    cell: 360 / W,
    seaLevel: 0,
    terrain: { file: 'terrain.png', heightOffset: HEIGHT_OFFSET, heightScale: HEIGHT_SCALE },
    palette: earth.palette,
    fog: [320, 900],
    cameraDistance: 12,
    spawn: mapPos(-0.128, 51.507),
    landmarks: earth.landmarks.map((l) => ({ id: l.id, displayName: l.displayName, type: l.type, position: mapPos(l.lon, l.lat), discoverRadius: l.discoverRadius ?? 20 })),
    regions,
  }
  fs.writeFileSync(path.join(outDir, 'world.json'), JSON.stringify(world, null, 2))
  const counts = new Map<number, number>()
  for (const b of biome) counts.set(b, (counts.get(b) ?? 0) + 1)
  console.log('biome %:', [...counts.entries()].map(([b, n]) => `${Object.entries(BIOME).find(([, v]) => v === b)?.[0]} ${((n / (W * H)) * 100).toFixed(1)}`).join(', '))
  let mn = Infinity, mx = -Infinity
  for (const v of h.data) { if (v < mn) mn = v; if (v > mx) mx = v }
  console.log(`height range ${mn.toFixed(1)} .. ${mx.toFixed(1)} m; regions ${regions.length}; wrote ${outDir}`)
}
main()
