import type { LoadedWorld } from '@/world/loadWorld'
import { PLACE_FOOTPRINT } from '@/dressing/placeKinds'
import { greatHallFrame } from '@/dressing/kinds/greatHall'
import { longhouseFrame } from '@/dressing/kinds/longhouse'
import { stairFrame } from '@/dressing/kinds/stair'
import { wingFrame } from '@/dressing/kinds/wing'
import { colonnadeFrame } from '@/dressing/kinds/colonnade'
import { PROP_FOOTPRINT } from '@/dressing/propKinds'
import { B, P, S, at, makePropContext, type PropContext } from '@/dressing/propUtil'
import { hash2 } from '@/terrain/faceColors'

/**
 * The town plan of a place: the buildings, smials, hedges, fences, gates and bridges its set
 * pieces build, as the map draws them (small dark footprints and lines in the map's ink), in
 * world metres at their real positions and turns.
 *
 * Nothing here is built: each piece's outline comes from the builders' own size tables
 * (PLACE_FOOTPRINT, PROP_FOOTPRINT) and params, or from the frame functions the kinds in their
 * own files share with their builders (greatHallFrame, longhouseFrame, stairFrame, wingFrame,
 * colonnadeFrame), placed with the
 * context and transform the builders use (propUtil.makePropContext and at), so the plan cannot
 * drift from the 3D pieces.
 * A building's footprint is its footing, the same rect its collider uses (the walls plus the
 * 0.15 m plinth all round; a mill's base 0.2 m), which scripts/check-map-labels.ts checks
 * against the colliders LandmarkProps registers, as it checks gate posts and mill wheels.
 * Every mark carries `of`, the landmark and prop it came from, for that check.
 */

type Box = [number, number, number, number]

/** A run of hedge, fence or wall: a polyline, drawn `width` metres wide. */
export interface FeatureLine {
  pts: Float32Array
  width: number
  box: Box
  /** '<landmark id>/<prop index>': the prop this was drawn from */
  of?: string
}

/** A closed outline (four corners for a rect), x, z pairs. */
export interface FeatureRing {
  ring: Float32Array
  box: Box
  /** '<landmark id>/<prop index>': the prop this was drawn from */
  of?: string
}

export interface PlaceFeatures {
  /** cottages, the inn, mills, halls, longhouses, wings, porches, towers: footing outline and the roof ridge along it (none for a round tower, a porch or an enterable hall) */
  buildings: (FeatureRing & { ridge: Float32Array; inn: boolean })[]
  /** hobbit-holes: the facade dug into the hill, the round door, and the turf brow behind */
  smials: (FeatureRing & { door: [number, number]; doorColor: string; brow: Float32Array })[]
  hedges: FeatureLine[]
  fences: FeatureLine[]
  walls: FeatureLine[]
  /** mill wheels, edge on: a short thick bar */
  wheels: FeatureLine[]
  /** gates across a way: post to post */
  gates: { a: [number, number]; b: [number, number]; box: Box; of?: string }[]
  /** bridge decks (a ruined one in two halves), with their parapets (empty for a flat plank bridge) */
  bridges: (FeatureRing & { sides: Float32Array })[]
  /** stone built across the ground: quays, and stairs (the treads and their cheeks, foot to head) */
  quays: FeatureRing[]
  wells: { x: number; z: number; r: number; box: Box }[]
  /** open pavilions: the ring of poles */
  pavilions: { x: number; z: number; r: number; box: Box }[]
  /** outlines the place names keep off (x, z corner pairs): every building and smial */
  reserved: Float32Array[]
}

/**
 * The gate arch's default width (placeKinds.ts gateArch; not in PLACE_FOOTPRINT). A copy, so
 * scripts/check-map-labels.ts holds the drawn posts to the arch's post colliders.
 */
const GATE_ARCH_WIDTH = 3.2
/** The water mill's default wheel radius (placeKinds.ts waterMill); checked against the wheel's collider likewise. */
const MILL_WHEEL_RADIUS = 3.4

/**
 * The prop kinds the plan draws. Everything else a place may hold (carts, lamps, tables, trees,
 * stones) is furniture the map leaves to the trees and markers; scripts/check-map-labels.ts
 * fails on a place prop of a kind it has not been told is one or the other.
 */
export const PLAN_KINDS: ReadonlySet<string> = new Set([
  'cottage',
  'waterMill',
  'smial',
  'townGate',
  'gateArch',
  'hedge',
  'fence',
  'wall',
  'bridge',
  'quay',
  'well',
  'pavilion',
  'hall',
  'mill',
  'tower',
  'gate',
  'wallRing',
  'palisade',
  'hobbitHole',
  'greatHall',
  'longhouse',
  'stair',
  'wing',
  'colonnade',
])

function boxOf(pts: ArrayLike<number>, pad = 0): Box {
  let x0 = Infinity
  let z0 = Infinity
  let x1 = -Infinity
  let z1 = -Infinity
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i])
    x1 = Math.max(x1, pts[i])
    z0 = Math.min(z0, pts[i + 1])
    z1 = Math.max(z1, pts[i + 1])
  }
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad]
}

/** A rect of half extents hw (local x) by hd (local z) centred at local (lx, lz), as four world corners. */
function rect(c: PropContext, hw: number, hd: number, lx = 0, lz = 0): Float32Array {
  const out = new Float32Array(8)
  const corners = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ]
  corners.forEach(([u, v], i) => {
    const [x, z] = at(c, lx + u, lz + v)
    out[2 * i] = x
    out[2 * i + 1] = z
  })
  return out
}

/** A straight local-x run from lx0 to lx1 at local z = lz, in world points. */
function run(c: PropContext, lx0: number, lx1: number, lz: number): Float32Array {
  const [ax, az] = at(c, lx0, lz)
  const [bx, bz] = at(c, lx1, lz)
  return Float32Array.of(ax, az, bx, bz)
}

const line = (pts: Float32Array, width: number, of?: string): FeatureLine => ({ pts, width, box: boxOf(pts, width / 2), of })

/** A circle of radius R round world (x, z) as a closed ring of n corners. */
function circle(x: number, z: number, R: number, n = 16): Float32Array {
  const out = new Float32Array(2 * n)
  for (let k = 0; k < n; k++) {
    out[2 * k] = x + Math.cos((k / n) * Math.PI * 2) * R
    out[2 * k + 1] = z + Math.sin((k / n) * Math.PI * 2) * R
  }
  return out
}

/** An arc of radius R round world (x, z) from angle a0 to a1, as a polyline. */
function arc(x: number, z: number, R: number, a0: number, a1: number): Float32Array {
  const k = Math.max(2, Math.ceil((a1 - a0) / 0.15))
  const pts = new Float32Array(2 * (k + 1))
  for (let j = 0; j <= k; j++) {
    const a = a0 + ((a1 - a0) * j) / k
    pts[2 * j] = x + Math.cos(a) * R
    pts[2 * j + 1] = z + Math.sin(a) * R
  }
  return pts
}

const NO_RIDGE = new Float32Array(0)

/**
 * Pieces i = 0..n-1 laid along a run, some left out: the maximal stretches of consecutive
 * pieces that are there, as [first, last] index pairs.
 */
function stretches(n: number, present: (i: number) => boolean): [number, number][] {
  const out: [number, number][] = []
  let start = -1
  for (let i = 0; i <= n; i++) {
    const on = i < n && present(i)
    if (on && start < 0) start = i
    else if (!on && start >= 0) {
      out.push([start, i - 1])
      start = -1
    }
  }
  return out
}

/**
 * Extracts the town plan of a place from its landmarks' dressing props. Worlds that are not
 * places get an empty plan: overworld dressings are miniatures, and the overworld map marks
 * landmarks with pins.
 */
export function extractPlaceFeatures(world: LoadedWorld): PlaceFeatures {
  const f: PlaceFeatures = { buildings: [], smials: [], hedges: [], fences: [], walls: [], wheels: [], gates: [], bridges: [], quays: [], wells: [], pavilions: [], reserved: [] }
  const { meta, surface } = world
  if (!meta.place || !surface) return f
  for (const lm of meta.landmarks) {
    const props = lm.dressing?.props ?? []
    props.forEach((p, i) => {
      // the very context buildProps gives this prop (seed included, though no outline uses it)
      const c = makePropContext(lm, p, surface, meta.seaLevel, meta.seed + i)
      addProp(f, p.kind, c, `${lm.id}/${i}`)
    })
  }
  for (const b of f.buildings) f.reserved.push(b.ring)
  for (const s of f.smials) f.reserved.push(s.ring)
  return f
}

function addProp(f: PlaceFeatures, kind: string, c: PropContext, of: string) {
  /** a building footing of half extents hw by hd (local x, z) at local (lx, lz), its ridge along local z */
  const building = (hw: number, hd: number, ridge: number | null, inn = false, lx = 0, lz = 0) => {
    const ring = rect(c, hw, hd, lx, lz)
    const r = ridge === null ? NO_RIDGE : Float32Array.from([...at(c, lx, lz - ridge), ...at(c, lx, lz + ridge)])
    f.buildings.push({ ring, box: boxOf(ring), ridge: r, inn, of })
  }
  /** a round tower's footing at world (x, z) */
  const roundTower = (x: number, z: number, R: number) => {
    const ring = circle(x, z, R)
    f.buildings.push({ ring, box: boxOf(ring), ridge: NO_RIDGE, inn: false, of })
  }
  const gate = (a: [number, number], b: [number, number]) => f.gates.push({ a, b, box: boxOf([...a, ...b], 0.5), of })

  switch (kind) {
    case 'cottage': {
      const w = P(c, 'width', PLACE_FOOTPRINT.cottage.width) * c.scale
      const L = P(c, 'length', PLACE_FOOTPRINT.cottage.length) * c.scale
      // the footing: walls plus the 0.15 m plinth all round (cottageFrame, and the collider); the
      // gable roof's ridge runs along local z
      building(w / 2 + 0.15, L / 2 + 0.15, L / 2, B(c, 'inn'))
      return
    }
    case 'waterMill': {
      const { width: w, length: L } = PLACE_FOOTPRINT.waterMill
      building(w / 2 + 0.2, L / 2 + 0.2, L / 2)
      // the wheel stands on the +x side in the plane of local z, so from above it is a bar
      const R = P(c, 'wheel', MILL_WHEEL_RADIUS)
      f.wheels.push(line(Float32Array.from([...at(c, w / 2 + 1.1, -R), ...at(c, w / 2 + 1.1, R)]), 0.5, of))
      return
    }
    case 'mill': {
      // the small stone mill of the overworld kinds: a 5 x 6 house on a 5.3 x 6.3 footing, its
      // 2.4 m wheel on the +x side
      building(2.65, 3.15, 3)
      f.wheels.push(line(Float32Array.from([...at(c, 3.2, -2.4), ...at(c, 3.2, 2.4)]), 0.4, of))
      return
    }
    case 'hall': {
      const w = P(c, 'width', 8) * c.scale
      const L = P(c, 'length', 12) * c.scale
      building(w / 2 + 0.15, L / 2 + 0.15, L / 2)
      return
    }
    case 'greatHall': {
      // the body collider's half extents (walls plus the 0.2 m footing all round), ridge along local z
      const g = greatHallFrame(c)
      building(g.hw, g.hd, g.L / 2)
      return
    }
    case 'longhouse': {
      // the footing: walls plus 0.15 m all round, as the body collider; ridge along local z
      const h = longhouseFrame(c)
      building(h.w / 2 + 0.15, h.L / 2 + 0.15, h.L / 2)
      return
    }
    case 'wing': {
      // the body box (closed) or the roof box (enterable, whose thin walls are under the map's
      // 1.2 m rule), with the hip's real ridge; none drawn for an enterable wing (wingFrame.map)
      const g = wingFrame(c).map
      building(g.hw, g.hd, g.ridge > 0 ? g.ridge : null)
      return
    }
    case 'colonnade': {
      // the lean-to roof box over the porch (the roof collider's half extents), no ridge
      const g = colonnadeFrame(c)
      building(g.hw, g.hd, null)
      return
    }
    case 'stair': {
      // the treads and the cheeks either side, from the foot (local z 0) up to the head (-run),
      // drawn as stone like a quay
      const { width, run } = stairFrame(c)
      const ring = rect(c, width / 2, run / 2, 0, -run / 2)
      f.quays.push({ ring, box: boxOf(ring), of })
      return
    }
    case 'tower': {
      roundTower(c.x, c.z, P(c, 'radius', 2.5) * c.scale * 1.06)
      return
    }
    case 'gate': {
      // two square towers either side of the doors
      const w = P(c, 'width', 24)
      for (const s of [-1, 1]) building(3, 3, null, false, (s * w) / 2, 0)
      gate(at(c, -(w / 2 - 3), 0), at(c, w / 2 - 3, 0))
      return
    }
    case 'smial': {
      const w = P(c, 'width', PLACE_FOOTPRINT.smial.width)
      const ring = rect(c, w / 2, PLACE_FOOTPRINT.smial.length / 2)
      // the turf brow: a half-ellipse round (0, -1.1), 0.682 w across and 0.62 w deep
      const rx = w * 0.682
      const rz = w * 0.62
      const n = 14
      const brow = new Float32Array(2 * (n + 1))
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * Math.PI
        const [x, z] = at(c, rx * Math.cos(a), -1.1 - rz * Math.sin(a))
        brow[2 * k] = x
        brow[2 * k + 1] = z
      }
      f.smials.push({ ring, box: boxOf(ring), door: at(c, 0, 0.42), doorColor: S(c, 'doorColor', '#2f7a45'), brow, of })
      // the garden fence, a gate gap on the path (placeKinds smial)
      if (B(c, 'fence', true)) {
        const fenceZ = P(c, 'path', 6) + 1.8
        const half = w * 0.5 + 2.4
        for (const s of [-1, 1]) f.fences.push(line(run(c, s * 1.1, s * half, fenceZ), 0.16, of))
      }
      return
    }
    case 'hobbitHole': {
      // the overworld's turf dome: its round door in the front of the dome, the dome's rim as the brow
      const r = 3.4 * c.scale
      const ring = rect(c, 1.3, 0.25, 0, r * 0.82)
      f.smials.push({ ring, box: boxOf(ring), door: at(c, 0, r * 0.82 + 0.1), doorColor: S(c, 'doorColor', '#2f7a45'), brow: arc(c.x, c.z, r, 0, Math.PI * 2), of })
      return
    }
    case 'townGate': {
      const half = (P(c, 'width', PLACE_FOOTPRINT.townGate.width) * c.scale) / 2 + 0.3
      gate(at(c, -half, 0), at(c, half, 0))
      return
    }
    case 'gateArch': {
      const half = P(c, 'width', GATE_ARCH_WIDTH) / 2
      gate(at(c, -half, 0), at(c, half, 0))
      return
    }
    case 'hedge': {
      const gap = P(c, 'gap', 0)
      if (B(c, 'ring')) {
        // pieces round a circle in world axes (the builder ignores the prop's turn here)
        const R = P(c, 'radius', PROP_FOOTPRINT.hedge.ringRadius)
        const n = Math.ceil((2 * Math.PI * R) / 2)
        const angle = (i: number) => (i / n) * Math.PI * 2
        const wrapped = (a: number) => Math.abs(((a + Math.PI) % (Math.PI * 2)) - Math.PI)
        // the builder's two gaps, facing local +x and -x
        const present = (i: number) => !(wrapped(angle(i)) < gap / 2 || wrapped(angle(i) - Math.PI) < gap / 2)
        for (const [i0, i1] of stretches(n, present)) f.hedges.push(line(arc(c.x, c.z, R, angle(i0) - Math.PI / n, angle(i1) + Math.PI / n), 1.4, of))
        return
      }
      const L = P(c, 'length', PROP_FOOTPRINT.hedge.length)
      const n = Math.ceil(L / 2)
      const mid = (i: number) => -L / 2 + (i + 0.5) * (L / n)
      for (const [i0, i1] of stretches(n, (i) => !(gap > 0 && Math.abs(mid(i)) < gap / 2))) {
        f.hedges.push(line(run(c, mid(i0) - L / n / 2 - 0.1, mid(i1) + L / n / 2 + 0.1, 0), PROP_FOOTPRINT.hedge.depth, of))
      }
      return
    }
    case 'fence': {
      const L = P(c, 'length', PROP_FOOTPRINT.fence.length)
      const gap = P(c, 'gap', 0)
      const n = Math.ceil(L / 2)
      const span = L / n
      const shown = (i: number) => !(gap > 0 && Math.abs(-L / 2 + (i + 0.5) * span) < gap / 2)
      for (const [i0, i1] of stretches(n, shown)) f.fences.push(line(run(c, -L / 2 + i0 * span, -L / 2 + (i1 + 1) * span, 0), 0.16, of))
      return
    }
    case 'wall': {
      const L = P(c, 'length', PROP_FOOTPRINT.wall.length) * c.scale
      f.walls.push(line(run(c, -L / 2 - 0.15, L / 2 + 0.15, 0), P(c, 'thickness', PROP_FOOTPRINT.wall.thickness), of))
      return
    }
    case 'wallRing': {
      // segments round a circle in world axes, a gap (with a tower either side) where asked
      const R = P(c, 'radius', 20) * c.scale
      const th = P(c, 'thickness', 3)
      const gapAngle = P(c, 'gapAngle', NaN)
      const gapWidth = P(c, 'gapWidth', 0)
      const n = Math.max(8, Math.ceil((2 * Math.PI * R) / 5))
      const angle = (i: number) => (i / n) * Math.PI * 2
      const present = (i: number) => Number.isNaN(gapAngle) || Math.abs(((angle(i) - gapAngle + Math.PI) % (Math.PI * 2)) - Math.PI) >= gapWidth / 2
      // each segment reaches 0.2 m past its share of the ring either way
      const ext = 0.2 / R
      const runs = stretches(n, present)
      if (runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1][1] === n - 1) {
        // the stretch through angle 0 is one run, not two
        const last = runs.pop()!
        runs[0] = [last[0] - n, runs[0][1]]
      }
      for (const [i0, i1] of runs) f.walls.push(line(arc(c.x, c.z, R, angle(i0) - Math.PI / n - ext, angle(i1) + Math.PI / n + ext), th, of))
      if (!Number.isNaN(gapAngle) && gapWidth > 0) {
        for (const s of [-1, 1]) {
          const a = gapAngle + (s * gapWidth) / 2
          roundTower(c.x + Math.cos(a) * R, c.z + Math.sin(a) * R, th)
        }
      }
      return
    }
    case 'palisade': {
      // stakes 1.1 m apart round a circle, a gate gap to the south (+z)
      const R = P(c, 'radius', 25)
      const n = Math.ceil((2 * Math.PI * R) / 1.1)
      const angle = (i: number) => (i / n) * Math.PI * 2
      // the last stretch runs on to the first stake, at angle 0
      for (const [i0, i1] of stretches(n, (i) => Math.abs(angle(i) - Math.PI / 2) >= 0.12)) f.walls.push(line(arc(c.x, c.z, R, angle(i0), i1 === n - 1 ? Math.PI * 2 : angle(i1)), 0.7, of))
      return
    }
    case 'bridge': {
      const L = P(c, 'length', PROP_FOOTPRINT.bridge.length)
      const W = P(c, 'width', PROP_FOOTPRINT.bridge.width)
      const arcK = P(c, 'arc', 0.18)
      const ruined = B(c, 'ruined')
      const parapets = B(c, 'parapets', !B(c, 'flat'))
      const kerb = parapets ? 0 : Math.max(0, P(c, 'kerb', 0))
      // parapets stand at the deck's edge (W/2; their colliders 0.15 m further out); a kerb's
      // centre line is 0.1 m in; a flat plank bridge, or one with neither, has no sides
      const sideZ = parapets ? W / 2 : kerb > 0 ? W / 2 - 0.1 : 0
      // the deck in the builder's pieces; a ruined bridge has lost the middle 40% of them
      const n = Math.max(4, Math.ceil(L / (arcK < 0.12 ? 1.2 : 2.5)))
      for (const [i0, i1] of stretches(n, (i) => !(ruined && Math.abs((i + 0.5) / n - 0.5) < 0.2))) {
        const x0 = -L / 2 + (i0 / n) * L
        const x1 = -L / 2 + ((i1 + 1) / n) * L
        const ring = rect(c, (x1 - x0) / 2, W / 2, (x0 + x1) / 2, 0)
        const sides = sideZ ? Float32Array.from([...run(c, x0, x1, -sideZ), ...run(c, x0, x1, sideZ)]) : new Float32Array(0)
        f.bridges.push({ ring, box: boxOf(ring, 0.5), sides, of })
      }
      return
    }
    case 'quay': {
      const L = P(c, 'length', PROP_FOOTPRINT.quay.length)
      const w = P(c, 'width', PROP_FOOTPRINT.quay.width)
      // slabs of about 4 m; a ruined quay has lost some (the builder's own hash)
      const n = Math.ceil(L / 4)
      const ruined = B(c, 'ruined')
      for (const [i0, i1] of stretches(n, (i) => !(ruined && hash2(i, 31) > 0.6))) {
        const x0 = -L / 2 + (i0 * L) / n - 0.05
        const x1 = -L / 2 + ((i1 + 1) * L) / n + 0.05
        const ring = rect(c, (x1 - x0) / 2, w / 2, (x0 + x1) / 2, 0)
        f.quays.push({ ring, box: boxOf(ring), of })
      }
      return
    }
    case 'well': {
      const r = PLACE_FOOTPRINT.well.width / 2
      f.wells.push({ x: c.x, z: c.z, r, box: [c.x - r, c.z - r, c.x + r, c.z + r] })
      return
    }
    case 'pavilion': {
      const r = P(c, 'radius', 9)
      f.pavilions.push({ x: c.x, z: c.z, r, box: [c.x - r, c.z - r, c.x + r, c.z + r] })
      return
    }
  }
}

/** Whether a plan has anything to draw. */
export function hasPlaceFeatures(f: PlaceFeatures | null): f is PlaceFeatures {
  return !!f && f.buildings.length + f.smials.length + f.hedges.length + f.fences.length + f.walls.length + f.gates.length + f.bridges.length + f.quays.length + f.wells.length + f.pavilions.length > 0
}
