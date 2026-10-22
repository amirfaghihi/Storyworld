import type { Heightfield } from '@/terrain/heightfield'
import { GroundSurface } from '@/terrain/surface'
import type { Vector3 } from 'three'
import { BIOME } from '@/world/biomes'
import { hash2 } from '@/terrain/faceColors'
import type { VegOverride } from '@/dressing/ground'
import { getMoodMap, MOODS, MOOD_IDS, pickType, type Mood, type TreeType } from './mood'
import type { World } from '@/world/schema'

export interface Instance {
  x: number
  y: number
  z: number
  scale: number
  rot: number
  tint: number // 0..1 per-instance variation
  grove: number // 0..1 slowly varying over the map (groves share a hue)
  family?: [string, string] // colour override from a landmark dressing
  trunk?: [string, string]
  /** forest-interior tree: tall trunk, canopy well above head height */
  tall?: boolean
  /** orientation of local up: the globe's radial up, or the ground plane under a small plant or a rock on a steep face */
  quat?: [number, number, number, number]
  /** vertical stretch on top of `scale` (crags lengthened to reach down a steep slope) */
  scaleY?: number
}

/**
 * Radius (before instance scale) of what each kind rests on: the trunk with its root flare, the
 * underside of a rock or bush, the leaf rosette of a small plant. Each instance stands at the
 * lowest ground under this disc so no edge of it shows air.
 */
function footRadius(type: VegType, tall: boolean): number {
  switch (type) {
    case 'pine':
    case 'fir':
    case 'round':
    case 'oak':
    case 'mallorn':
      return tall ? 0.9 : 0.32
    case 'birch':
      return tall ? 0.2 : 0.16
    case 'dead':
      return 0.3
    case 'rock':
    case 'bush':
      return 0.85
    case 'crag':
      return 1.6
    case 'flower':
      return 0.4
    case 'fern':
      return 0.05
    case 'mushroom':
      return 0.42
    case 'glowcap':
      return 0.34
    case 'log':
      return 1.66 // half length including the cut end; logs use a rectangle, see below
  }
}

/** small plants lean with the ground rather than sinking their uphill side */
const TILTS = new Set<VegType>(['flower', 'fern', 'mushroom', 'glowcap'])
const MAX_PLANT_TILT = 0.5 // radians: past this a plant would look blown over
const CRAG_HEIGHT = 5.15 // the crag spire's height above its origin, before instance scale

/**
 * The ground with a tilted plane through (cx, cz) taken away. Its footprintMin is the lowest a
 * base lying in that plane can sit at the centre without any part of it showing air, and it is
 * exact for the same reason the surface's own footprints are: the difference is still flat per
 * triangle, on the same triangles. One instance is re-aimed per query.
 */
class TiltedGround extends GroundSurface {
  readonly seaLevel: number
  cx = 0
  cz = 0
  gx = 0
  gz = 0
  constructor(
    private readonly base: GroundSurface,
    private readonly cell: number,
  ) {
    super()
    this.seaLevel = base.seaLevel
  }
  protected get latticeCell() {
    return this.cell
  }
  height(x: number, z: number, outNormal?: Vector3): number {
    const h = this.base.height(x, z, outNormal)
    if (outNormal) {
      // the triangle's slope less the plane's, so the footprint search finds the rim extremes of the difference
      const sx = -outNormal.x / outNormal.y - this.gx
      const sz = -outNormal.z / outNormal.y - this.gz
      outNormal.set(-sx, 1, -sz).normalize()
    }
    return h - this.gx * (x - this.cx) - this.gz * (z - this.cz)
  }
}

/**
 * Lean a small plant toward the ground plane under it (tilt capped at MAX_PLANT_TILT) and set its
 * y so the tilted base nowhere floats over the footprint of radius r.
 */
function tiltToGround(it: Instance, surface: GroundSurface, tilted: TiltedGround, r: number) {
  const fitR = Math.max(r, 0.5) // a fern's stem is tiny; the plane its fronds lie along is not
  const plane = surface.planeFit(it.x, it.z, fitR, fitR, 0)
  let gx = plane.gx
  let gz = plane.gz
  const g = Math.hypot(gx, gz)
  const gMax = Math.tan(MAX_PLANT_TILT)
  if (g > gMax) {
    gx *= gMax / g
    gz *= gMax / g
  }
  tilted.cx = it.x
  tilted.cz = it.z
  tilted.gx = gx
  tilted.gz = gz
  it.y = tilted.footprintMin(it.x, it.z, r)
  const inv = 1 / Math.hypot(gx, 1, gz)
  it.quat = upTo(-gx * inv, inv, -gz * inv)
}

/** The shortest turn taking +y to the unit vector n, as [x, y, z, w]. */
function upTo(nx: number, ny: number, nz: number): [number, number, number, number] {
  const qx = nz, qz = -nx, qw = 1 + ny
  const qn = 1 / Math.hypot(qx, qz, qw)
  return [qx * qn, 0, qz * qn, qw * qn]
}

const PALETTE_FAMILIES: Record<string, { canopy: [string, string]; trunk?: [string, string] }> = {
  golden: { canopy: ['#e0b43a', '#f2d060'], trunk: ['#b8b8c0', '#dcdce2'] },
  dark: { canopy: ['#1f4d33', '#2f6b45'], trunk: ['#3a2a20', '#4a3a2c'] },
  willow: { canopy: ['#5a7a3a', '#7a9a4a'] },
  holly: { canopy: ['#2f6b3a', '#3a7a44'] },
}
const FLOWER_FAMILIES: Record<string, [string, string]> = {
  white: ['#ffffff', '#f4f0ff'],
  elanor: ['#f2d060', '#ffffff'],
  morgul: ['#b8ffb8', '#e0ffe0'],
  reeds: ['#8a8a4a', '#a8a060'],
}

export type VegType = 'pine' | 'fir' | 'round' | 'oak' | 'birch' | 'mallorn' | 'dead' | 'rock' | 'crag' | 'bush' | 'flower' | 'fern' | 'log' | 'mushroom' | 'glowcap'
export type ScatterResult = Record<VegType, Instance[]>

/**
 * A rock on a steep face: upright it would bury its uphill half to rest its downhill edge, so it
 * lies on the face instead. Pushed into the face along the normal, past the worst bump of ground
 * above the fitted plane: a drop straight down would barely move it into a near-vertical face,
 * and whatever stood proud would hang over the slope below.
 */
function bedIntoFace(it: Instance, surface: GroundSurface, r: number) {
  const plane = surface.planeFit(it.x, it.z, r, r, 0)
  const [nx, ny, nz] = plane.normal
  const sink = 0.25 * r + plane.above // the draw adds its usual 0.15 along the same normal
  it.x -= nx * sink
  it.y = plane.y - ny * sink
  it.z -= nz * sink
  it.quat = upTo(nx, ny, nz)
}

/**
 * Deterministic placement of vegetation and rocks from the biome map.
 * `density` scales instance counts (quality tiers). The biome logic reads the heightfield; every
 * instance is stood on `surface`, the ground as drawn.
 */
export function scatter(hf: Heightfield, surface: GroundSurface, seaLevel: number, density = 1, overrides: VegOverride[] = [], meta?: World): ScatterResult {
  const tilted = new TiltedGround(surface, hf.cell)
  const res: ScatterResult = { pine: [], fir: [], round: [], oak: [], birch: [], mallorn: [], dead: [], rock: [], crag: [], bush: [], flower: [], fern: [], log: [], mushroom: [], glowcap: [] }
  const moodMap = meta ? getMoodMap(meta, hf) : null
  const { width, height, cell } = hf
  for (let iz = 1; iz < height - 1; iz++) {
    for (let ix = 1; ix < width - 1; ix++) {
      const b = hf.biome[iz * width + ix]
      const r = hash2(ix, iz)
      const r2 = hash2(ix * 3 + 11, iz * 5 + 17)
      const h = hf.data[iz * width + ix]
      if (h < seaLevel + 0.6) continue
      let type: VegType | null = null
      let p = 0
      let tall = false
      const mood: Mood = moodMap ? MOODS[MOOD_IDS[moodMap[iz * width + ix]]] : MOODS.mixed
      // high ground grows conifers whatever the mood
      // above the tree line only conifers, and nothing but rock higher still
      const species = (): TreeType => (h > 28 ? (r2 > 0.5 ? 'fir' : 'pine') : pickType(mood, hash2(ix * 13 + 1, iz * 17 + 9)))
      switch (b) {
        case BIOME.forest: {
          // canopy trees on one hash, undergrowth on another so both can share a cell
          const r3 = hash2(ix * 7 + 3, iz * 11 + 5)
          if (r3 < 0.3 || r3 >= 0.72) {
            p = 0.26 * mood.density // one tree per ~15-20 m2: a wood you can walk through
            type = species()
            tall = true
          } else if (r3 < 0.55) {
            p = 0.16
            type = 'fern'
          } else if (r3 < 0.62) {
            p = 0.06
            type = 'log'
          } else {
            p = 0.07 * mood.mushrooms
            // in a dark or very old wood some of the mushrooms light the floor
            type = mood.glow && hash2(ix * 19 + 5, iz * 23 + 13) < mood.glow ? 'glowcap' : 'mushroom'
          }
          break
        }
        case BIOME.grass:
          if (r2 < 0.42) {
            p = h > 46 ? 0 : 0.012
            type = species()
          } else if (r2 < 0.72) {
            p = 0.012
            type = 'bush'
          } else {
            p = 0.03 * mood.flowers
            type = 'flower'
          }
          break
        case BIOME.marsh:
          p = 0.05
          type = r2 > 0.5 ? 'bush' : 'flower'
          break
        case BIOME.rock: {
          // Sampled at the pixel's own vertex. This used to read slopeAt((ix + 0.5) * cell, ...) when
          // sampleHeight carried a half-cell offset, which landed on the same vertex; keeping the
          // vertex keeps the crag / rock / pine choice exactly what it was before that fix.
          const slope0 = hf.slopeAt(ix * cell, iz * cell)
          if (slope0 > 0.9 && h > 38) {
            p = 0.11
            type = r2 > 0.55 ? 'crag' : 'rock'
          } else {
            p = 0.05
            // a few pines on the lower, gentler shoulders; bare rock above
            type = r2 > 0.85 && h < 42 && slope0 < 0.55 ? (r2 > 0.93 ? 'fir' : 'pine') : 'rock'
          }
          break
        }
        case BIOME.ash:
          p = 0.014
          type = r2 > 0.4 ? 'dead' : 'rock'
          break
        case BIOME.snow:
          p = 0.02
          type = 'rock'
          break
        case BIOME.sand:
          p = 0.006
          type = 'rock'
          break
      }
      if (!type) continue
      const x = (ix + 0.5 + (r2 - 0.5) * 0.9) * cell
      const z = (iz + 0.5 + (hash2(ix + 99, iz + 7) - 0.5) * 0.9) * cell
      // landmark dressing: density / palette / flower overrides, nearest wins
      let ov: VegOverride | null = null
      let ovD = Infinity
      for (const o of overrides) {
        const d = Math.hypot(x - o.x, z - o.z)
        if (d < o.r && d < ovD) {
          ov = o
          ovD = d
        }
      }
      const isTree = type === 'pine' || type === 'fir' || type === 'round' || type === 'oak' || type === 'birch' || type === 'mallorn'
      const groveIdx = (hash2(Math.floor(ix / 30), Math.floor(iz / 30)) * 0.75 + hash2(ix + 1, iz + 2) * 0.25) % 1
      const fams = (type === 'pine' || type === 'fir') && mood.conifer ? mood.conifer : mood.canopy
      let family: [string, string] | undefined = isTree ? fams[Math.floor(groveIdx * fams.length) % fams.length] : undefined
      let trunk: [string, string] | undefined = isTree ? (type === 'birch' ? ['#e8e4dc', '#f6f3ee'] : mood.trunk[Math.floor(hash2(ix + 3, iz + 4) * mood.trunk.length) % mood.trunk.length]) : undefined
      if (ov) {
        const edge = Math.min(1, (ov.r - ovD) / (ov.r * 0.35)) // soften the boundary
        p *= 1 + (ov.density - 1) * edge
        if (ov.palette === 'dead' && (isTree || type === 'bush') && edge > 0.3) type = 'dead'
        const fam = PALETTE_FAMILIES[ov.palette]
        if (fam && isTree && edge > 0.3) {
          family = fam.canopy
          trunk = fam.trunk ?? trunk
        }
        if (type === 'flower' && ov.flowers) {
          if (ov.flowers === 'reeds') type = 'bush'
          const ff = FLOWER_FAMILIES[ov.flowers]
          if (ff) family = ff
          if (ov.flowers === 'garden') p *= 3
        }
      }
      // forest canopy is thinned by the split above: compensate so woods stay dense
      if (tall) p *= 1.72 // compensates the cell split above
      if (r > p * density) continue
      const slope = hf.slopeAt(x, z)
      if (type !== 'rock' && type !== 'crag' && slope > 0.95) continue
      // a log lying across a steep bank would bridge air at one end; a crag on a near-cliff would
      // need stretching far past the rest (kept crags are still stretched, about 2.2 times at the
      // median, so that most of the spire shows above the uphill ground: see below)
      if (type === 'log' && slope > 0.8) continue
      if (type === 'crag' && slope > 3) continue
      const scale =
        type === 'rock' ? 0.7 + r2 * 1.3 : type === 'crag' ? 0.8 + r2 * 1.6 : type === 'flower' || type === 'mushroom' || type === 'glowcap' ? 0.6 + r2 * 0.6 : type === 'fern' ? 0.7 + r2 * 0.8 : type === 'log' ? 0.8 + r2 * 0.6 : (tall ? 0.8 + hash2(ix + 5, iz + 3) * 0.7 : 0.6 + hash2(ix + 5, iz + 3) * 0.9) * (isTree ? mood.treeScale : 1)
      const grove = groveIdx
      const it: Instance = { x, y: 0, z, scale, rot: r2 * Math.PI * 2, tint: hash2(ix + 1, iz + 2), grove, family, trunk, tall }
      const rr = footRadius(type, tall) * scale
      if (type === 'log') {
        // lie along the contour (local +x is the log's axis), so both ends rest at about the same
        // height; the hash only turns it end for end, which way the cut end faces. It rests on the
        // lowest ground under its whole length so neither end hangs in the air
        const gx = surface.height(x + 1, z) - surface.height(x - 1, z)
        const gz = surface.height(x, z + 1) - surface.height(x, z - 1)
        if (Math.hypot(gx, gz) > 1e-4) it.rot = Math.atan2(gx, gz) + (r2 > 0.5 ? Math.PI : 0)
        it.y = surface.footprintMinRect(x, z, rr, 0.34 * scale, it.rot)
      } else if (TILTS.has(type)) {
        tiltToGround(it, surface, tilted, rr)
      } else if (type === 'rock' && slope > 1.2) {
        bedIntoFace(it, surface, rr)
      } else {
        it.y = surface.footprintMin(x, z, rr)
        if (type === 'crag') {
          // crags stay upright; stretch the spire so most of it still shows above the uphill side
          const spread = surface.footprintMax(x, z, rr) - it.y
          it.scaleY = Math.max(1, (spread + 0.6 * CRAG_HEIGHT * scale) / (CRAG_HEIGHT * scale))
        }
      }
      // A land plant's base reaches the lowest ground under it, which on a bank can be the river
      // bed: one standing in the water is left out rather than drowned. Rocks and crags can stand
      // in the shallows.
      if (it.y < seaLevel && type !== 'rock' && type !== 'crag') continue
      res[type].push(it)
    }
  }
  return res
}
