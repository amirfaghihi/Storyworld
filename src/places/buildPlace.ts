/**
 * Turns a PlaceDef into a LoadedWorld: a runtime heightfield + biome map and a World-shaped
 * meta so every overworld component (terrain, water, grass, props, lore, maps) works unchanged.
 */
import { createNoise2D } from 'simplex-noise'
import { Heightfield } from '@/terrain/heightfield'
import { mulberry32 } from '@/world/random'
import { BIOME } from '@/world/biomes'
import { WorldSchema, type Lore, type World, type LandmarkSchema } from '@/world/schema'
import type { z } from 'zod'
import type { LoadedWorld } from '@/world/loadWorld'
import { registerSurface } from '@/terrain/surface'
import { meshOptions } from '@/terrain/buildChunks'
import type { PlaceDef } from './types'

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** distance from (x, z) to a polyline */
function polylineDist(pts: [number, number][], x: number, z: number): number {
  let best = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[i + 1]
    const vx = bx - ax, vz = bz - az
    const L2 = vx * vx + vz * vz || 1
    const t = Math.min(1, Math.max(0, ((x - ax) * vx + (z - az) * vz) / L2))
    const ex = x - (ax + vx * t), ez = z - (az + vz * t)
    const d = Math.sqrt(ex * ex + ez * ez)
    if (d < best) best = d
  }
  return best
}

/**
 * A polyline's bounding box grown by `reach`: beyond it the line is further than `reach` from any
 * pixel, so a pass that only acts within `reach` can skip the per-segment distance there. Places
 * are mostly far from any given river or lane, and those distances were most of the build time.
 */
function lineBox(pts: [number, number][], reach: number) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (const [x, z] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x)
    z0 = Math.min(z0, z); z1 = Math.max(z1, z)
  }
  return { x0: x0 - reach, z0: z0 - reach, x1: x1 + reach, z1: z1 + reach }
}
const outside = (b: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number) => x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1

/** The steepest ground (rise over run) snow lies on above a place's snowline; steeper is bare rock. */
const SNOW_HOLDS = 3.2
/** ...and the steepest grass holds on within ROCK_BAND metres below the snowline */
const GRASS_HOLDS = 1.0
const ROCK_BAND = 75

/** How far past 0.55 r (in cells) a flat stays fully level; see the flats pass for why a quarter. */
const CORE_MARGIN = 0.25
/** side of the squares the flats are bucketed into (metres) */
const FLAT_TILE = 32

export function buildPlace(def: PlaceDef, returnTo: [number, number]): LoadedWorld {
  const [W, H] = def.size
  const cell = def.cell
  const width = Math.round(W / cell) + 1
  const height = Math.round(H / cell) + 1
  const n = width * height
  const heights = new Float32Array(n)
  const biome = new Uint8Array(n)
  const rnd = mulberry32(def.seed)
  const n1 = createNoise2D(rnd)
  const n2 = createNoise2D(rnd)
  const fbm = (x: number, z: number, wl: number) => n1(x / wl, z / wl) * 0.65 + n1(x / (wl * 0.45) + 7, z / (wl * 0.45)) * 0.25 + n2(x / (wl * 0.2), z / (wl * 0.2)) * 0.1
  const sea = def.seaLevel

  // Per pixel, in this order:
  //   1. base roll, hills and the wooded rim
  //   2. river valleys: broad lowering, before the flats so a valley never re-cuts a platform
  //      and a causeway flat really does bridge the ditch
  //   3. flats: level inside 0.55 r, fading out to r (both pushed out by a cell, see below);
  //      a core is never bent by a neighbour's rim
  //   4. ponds (dug as if before the valley, as they always were)
  //   5. river channels: only where the bed is below sea level. A dry ditch (Bree's dike) is a
  //      valley with a negative depth; carving its "bed" would clamp every pixel on the
  //      polyline to sea + 6 m and leave single-pixel pits wherever the hill is higher.
  //   6. biome
  const riverDist = new Float64Array(def.rivers.length)
  // Past these boxes a river's distance cannot reach its valley, channel, bank or sand (the
  // wobble shifts it by at most 0.18 of the width), so it reads as Infinity there with the same
  // result; past a lane's box the lane cannot paint road.
  const riverBox = def.rivers.map((r) => lineBox(r.points, Math.max(r.valley?.width ?? 0, r.width / 2 + Math.max(r.bank ?? 7, 2.6)) + r.width * 0.18 + 1))
  const laneBox = def.lanes.map((l) => lineBox(l.points, l.width / 2 + 1))
  // Flats per FLAT_TILE square: each tile lists, in the def's order, the flats whose outer circle
  // (r + CORE_MARGIN cells) touches it, so the flats pass below visits only those. The order is
  // kept, so "the later core wins" and the rim blend come out exactly as from the full list.
  const tilesX = Math.floor(W / FLAT_TILE) + 1
  const tilesZ = Math.floor(H / FLAT_TILE) + 1
  const flatTiles: number[][] = Array.from({ length: tilesX * tilesZ }, () => [])
  def.flats.forEach((f, i) => {
    const o = f.r + cell * CORE_MARGIN
    const tx0 = Math.max(0, Math.floor((f.x - o) / FLAT_TILE)), tx1 = Math.min(tilesX - 1, Math.floor((f.x + o) / FLAT_TILE))
    const tz0 = Math.max(0, Math.floor((f.z - o) / FLAT_TILE)), tz1 = Math.min(tilesZ - 1, Math.floor((f.z + o) / FLAT_TILE))
    for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) flatTiles[tz * tilesX + tx].push(i)
  })
  for (let iz = 0; iz < height; iz++) {
    for (let ix = 0; ix < width; ix++) {
      const x = ix * cell
      const z = iz * cell
      let h = def.base.height + fbm(x, z, def.base.wavelength) * def.base.roll

      for (const hill of def.hills) {
        let dx = x - hill.x, dz = z - hill.z
        if (hill.rx && hill.rx !== 1) {
          const rot = hill.rot ?? 0
          const cs = Math.cos(rot), sn = Math.sin(rot)
          const lx = cs * dx - sn * dz, lz = sn * dx + cs * dz
          dx = lx / hill.rx
          dz = lz
        }
        const d = Math.hypot(dx, dz) / hill.r
        if (d < 1) {
          const t = 1 - d
          h += hill.h * t * t * (3 - 2 * t)
        }
      }
      if (def.rim) {
        const edge = Math.min(x, z, W - x, H - z)
        const t = 1 - smooth(0, def.rim.width, edge)
        if (t > 0) h += def.rim.height * t * t * (0.75 + 0.5 * (fbm(x + 500, z - 300, 45) * 0.5 + 0.5))
      }

      let valley = 0
      for (let i = 0; i < def.rivers.length; i++) {
        const r = def.rivers[i]
        if (outside(riverBox[i], x, z)) {
          riverDist[i] = Infinity
          continue
        }
        const wobble = fbm(x, z, 22) * r.width * 0.18
        const d = polylineDist(r.points, x, z) + wobble
        riverDist[i] = d
        if (r.valley) valley += r.valley.depth * (1 - smooth(0, r.valley.width, d))
      }
      h -= valley

      // Each flat is level out to its core and fades back to the land across its rim. The core
      // is always fully level, whatever the strength: buildings stand there. Strength only thins
      // the rim, so a soft flat keeps more of the land's roll around its edge; the weight still
      // runs continuously from 1 to 0, so the core has no ledge round it.
      // The whole profile sits a quarter cell further out than 0.55 r .. r: the mesh joins each
      // vertex to its neighbours, so a core that stops exactly at 0.55 r is still drawn tilting
      // toward the first rim vertex beyond it. A wider margin levels the cores better but squeezes
      // the ramps between neighbouring flats. Measured on Bree: a full cell blocks the East Road
      // to the controller (grade 2.97 against a 1.9 limit) and a half cell still blocks it at
      // (225,284); a quarter cell keeps every lane walkable and every cottage footprint level to
      // within 2 cm.
      // Flats sit close together on Bree's hillside, so two rules keep one from spoiling another.
      // A core is never bent by someone else's rim; where two cores overlap the later flat wins,
      // as it always did, and the two meet in a step. Where only rims overlap, the land keeps the
      // share every rim leaves it (as when they were applied one after another), and the rest
      // goes to a blend of the targets in which each flat's pull climbs steeply toward its core.
      // The blend therefore runs smoothly into whichever core is nearer: a ramp, not a seam.
      let core = -1
      let keep = 1
      let pull = 0
      let pulled = 0
      const tileFlats = flatTiles[Math.min(tilesZ - 1, Math.floor(z / FLAT_TILE)) * tilesX + Math.min(tilesX - 1, Math.floor(x / FLAT_TILE))]
      for (let j = 0; j < tileFlats.length; j++) {
        const i = tileFlats[j]
        const f = def.flats[i]
        const d = Math.hypot(x - f.x, z - f.z)
        const outer = f.r + cell * CORE_MARGIN
        if (d >= outer) continue
        const inner = f.r * 0.55 + cell * CORE_MARGIN
        if (d <= inner) {
          core = i
          continue
        }
        const s = smooth(inner, outer, d)
        const k = (1 - s) * (1 - (1 - (f.strength ?? 1)) * s)
        const w = k / (1 - k + 1e-3)
        keep *= 1 - k
        pull += w
        pulled += w * (f.h ?? def.base.height)
      }
      if (core >= 0) h = def.flats[core].h ?? def.base.height
      else if (pull > 0) h = lerp(h, pulled / pull, 1 - keep)

      let b: number = BIOME.grass
      let sandy = false
      // A pond is dug into the land as it was before the valley, which then lowers both, so a
      // pond the river runs past is as deep as it always was.
      h += valley
      for (const p of def.ponds) {
        const d = Math.hypot(x - p.x, z - p.z) + fbm(x, z, 30) * p.r * 0.12
        const bed = sea - p.depth
        const t = smooth(p.r * 0.75, p.r + 8, d)
        if (t < 1) h = Math.min(h, lerp(bed, h, t))
        if (d < p.r + 3.5) sandy = true
      }
      h -= valley
      for (let i = 0; i < def.rivers.length; i++) {
        const r = def.rivers[i]
        if (r.depth <= 0) continue
        const d = riverDist[i]
        const bed = sea - r.depth
        const half = r.width / 2
        const t = smooth(half * 0.6, half + (r.bank ?? 7), d)
        if (t < 1) h = Math.min(h, lerp(bed, h, t))
        if (d < half + 2.6) sandy = true
      }

      if (h < sea - 0.15) b = BIOME.water
      else if (sandy && h < sea + 1.6) b = BIOME.sand
      else {
        for (const w of def.woods) {
          const d = Math.hypot(x - w.x, z - w.z)
          if (d < w.r * (0.72 + 0.28 * (fbm(x - 900, z + 400, 40) * 0.5 + 0.5))) b = BIOME.forest
        }
        if (def.rim) {
          const edge = Math.min(x, z, W - x, H - z)
          if (edge < def.rim.width * 0.7 && fbm(x + 300, z + 300, 35) > -0.35) b = BIOME.forest
        }
        // a ragged snowline, so a peak's white cap does not end on a contour
        if (def.snowline !== undefined && h > def.snowline + fbm(x + 77, z - 41, 30) * 8) b = BIOME.snow
        for (let i = 0; i < def.lanes.length; i++) {
          const l = def.lanes[i]
          if (!outside(laneBox[i], x, z) && polylineDist(l.points, x, z) < l.width / 2) b = BIOME.road
        }
      }
      heights[iz * width + ix] = h
      biome[iz * width + ix] = b
    }
  }
  // A mountain's upper slopes: snow does not lie on a sheer face, so only the near-vertical crags of
  // the cap are bare rock (a peak at walking scale is steep almost everywhere, and a lower cutoff
  // left the Starkhorn's cap three parts rock and no longer white); below the snow, steep grass
  // gives way to rock for ROCK_BAND metres, so the peak does not rise out of the meadow as one
  // smooth green cone.
  if (def.snowline !== undefined) {
    const rockFrom = def.snowline - ROCK_BAND
    const at = (ix: number, iz: number) => heights[Math.min(height - 1, Math.max(0, iz)) * width + Math.min(width - 1, Math.max(0, ix))]
    for (let iz = 0; iz < height; iz++)
      for (let ix = 0; ix < width; ix++) {
        const i = iz * width + ix
        const snow = biome[i] === BIOME.snow
        if (!snow && !(biome[i] === BIOME.grass && heights[i] > rockFrom + fbm(ix * cell - 210, iz * cell + 95, 26) * 12)) continue
        const gx = (at(ix + 1, iz) - at(ix - 1, iz)) / ((Math.min(width - 1, ix + 1) - Math.max(0, ix - 1)) * cell)
        const gz = (at(ix, iz + 1) - at(ix, iz - 1)) / ((Math.min(height - 1, iz + 1) - Math.max(0, iz - 1)) * cell)
        const limit = snow ? SNOW_HOLDS : GRASS_HOLDS
        if (gx * gx + gz * gz > limit * limit) biome[i] = BIOME.rock
      }
  }
  const heightfield = new Heightfield(width, height, cell, heights, biome)

  const metaInput = {
    id: `${def.parentWorldId}/${def.id}`,
    name: def.name,
    seed: def.seed,
    size: def.size,
    cell,
    seaLevel: sea,
    palette: def.palette,
    spawn: def.spawn,
    terrainSpacing: 2,
    fog: def.fog ?? [120, 420],
    cameraDistance: def.cameraDistance ?? 10,
    speedScale: def.speedScale ?? 0.8,
    spawnYaw: def.spawnYaw,
    spawnPitch: def.spawnPitch,
    cameraCrane: def.cameraCrane,
    // the map frames the village, not the wooded rim that closes the horizon
    mapBounds: def.rim ? ([def.rim.width * 0.55, def.rim.width * 0.55, W - def.rim.width * 0.55, H - def.rim.width * 0.55] as [number, number, number, number]) : undefined,
    place: {
      parentWorldId: def.parentWorldId,
      exit: { x: def.exit.x, z: def.exit.z, radius: def.exit.radius ?? 6, label: def.exit.label },
      returnTo,
    },
    landmarks: def.spots.map((s): z.input<typeof LandmarkSchema> => ({
      id: s.id,
      displayName: s.displayName,
      type: s.type,
      position: s.position,
      discoverRadius: s.discoverRadius ?? 14,
      mapIcon: s.mapIcon,
      dressing: {
        radius: s.radius ?? 18,
        setting: s.setting,
        ground: s.ground,
        vegetation: s.vegetation,
        props: (s.props ?? []).map((p) => ({ kind: p.kind ?? 'stones', ...p })),
      },
    })),
    regions: def.regions,
  }
  // free-standing props become one extra landmark-less "dressing" anchored at the origin
  if (def.props?.length) {
    metaInput.landmarks.push({
      id: `${def.id}-scenery`,
      displayName: def.name,
      type: 'other',
      position: [0, 0],
      discoverRadius: 0,
      hidden: true,
      dressing: {
        radius: 0,
        setting: '',
        ground: undefined,
        vegetation: undefined,
        props: def.props.map(({ at, ...p }) => ({ kind: p.kind ?? 'stones', ...p, offset: at })),
      },
    })
  }
  // the air of the whole place: a hidden landmark at the centre whose dressing reaches every corner
  // (aura is full within 0.35 x 1.25 of the radius, weather within 1.8 of it; see auras.ts, weather.ts)
  if (def.air) {
    metaInput.landmarks.push({
      id: `${def.id}-air`,
      displayName: def.name,
      type: 'other',
      position: [W / 2, H / 2],
      discoverRadius: 0,
      hidden: true,
      dressing: {
        radius: Math.ceil(Math.hypot(W, H) / 2 / 0.4375),
        setting: '',
        ground: undefined,
        vegetation: undefined,
        props: [],
        aura: def.air.aura,
        weather: def.air.weather,
      },
    })
  }
  const meta: World = WorldSchema.parse(metaInput)
  const lore: Lore = { landmarks: Object.fromEntries(def.spots.map((s) => [s.id, s.lore])), regions: {} }
  const surface = registerSurface(heightfield, { ...meshOptions(meta), seaLevel: meta.seaLevel })
  const features = {
    roads: def.lanes.map((l) => ({ points: l.points, width: l.width })),
    // dry ditches only: a river with water in it already shows as water
    ditches: def.rivers.filter((r) => r.depth < 0).map((r) => ({ points: r.points })),
  }
  return { meta, heightfield, surface, lore, features }
}
