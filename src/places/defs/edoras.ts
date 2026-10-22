/**
 * Edoras at walking scale: one green hill at the mouth of Harrowdale, cut into terraces that
 * follow its contours. The paved way climbs the north face from the only gate in two hairpins,
 * along one terrace and then the next, to a forecourt where a spring rises at the foot of a green
 * bank; a high, broad stair climbs the bank to the paved platform at the crown, where the golden
 * hall stands with its doors to the north, 12.5 m back from the stair head. A wall rides the lip
 * of the lowest terrace all the way round, a dry ditch follows the same contour below it and a
 * thorn hedge stands on the ditch's outer lip. North of the gate the road
 * runs down between the two rows of royal mounds to the one ford of the Snowbourn, which comes
 * out of Harrowdale in the south-west, runs down the hill's west foot and bends east across the
 * north. The road from the west meets it just above the ford; the Starkhorn stands at the head of
 * the dale. The plain is open grass: willows only by the ford, pines only on the mountain feet.
 *
 * What stands on it: Meduseld (`greatHall`, 16 x 40 m, no porch and no pillars, weapons racked
 * by the doors); 38 long timber houses (`longhouse`, the stable among them) in rows along the
 * terraces, ridges with the contour and doors on the long side; the high stair to the platform
 * and the two short flights of the way (`stair`); the stream in its stone channel from the
 * horse-head spring to the ditch (`channel`, `springBasin`); green standards with the white horse
 * (`banner`); simbelmynë on the mounds' west flanks (`flowerPatch`); and the wall, the hedge, the
 * parapet and the lip walls as `wall` and `hedge` line pieces.
 *
 * Coordinates in metres, +x east, +z south. Written from the descriptions in The Lord of the
 * Rings in our own words; nothing here is taken from a film set, a drawn map or an illustration.
 *
 * Everything round the hill is laid out from one centre C with `polar(R, deg)` (deg as in `arc`:
 * 0 east, 90 south, -90 north), so terraces, houses, way, stream, wall, ditch and hedge cannot
 * drift apart.
 *
 * Landform rules this layout keeps (measured with tools/section.mts):
 *  - each terrace is cut at about the hill's own height at the middle of its band, so cut and fill
 *    balance; only the lowest is built up toward the wall, which makes the rampart;
 *  - banks between terraces are 9-12 m wide for 5-5.5 m steps, with the terrace flats' rims at
 *    strength 0.3 (two full-strength rims hand over in a step mid-bank);
 *  - every building stands wholly inside a terrace core, so nothing is buried.
 *
 * Every hill, flat and river is written out in one object shape (see `def` at the bottom), which
 * keeps buildPlace's loops over them monomorphic.
 */
import type { PlaceDef, Flat, Hill, Lane, River, Spot } from '../types'
import type { Prop } from '@/world/schema'

const W = 470
const H = 540
const BASE = 5

type P = Partial<Prop>
type At = P & { at: [number, number] }

const r1 = (v: number) => Math.round(v * 10) / 10
const r3 = (v: number) => Math.round(v * 1000) / 1000
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI
/** A small deterministic hash in [0, 1) for the house rows (never Math.random). */
const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}

// ---------------------------------------------------------------------------------------------
// The hill and its rings
// ---------------------------------------------------------------------------------------------

/** Hill centre: the crown and the centre of every ring. */
const C = { x: 270, z: 340 }
/** One broad dome; the crown stands 24 m above the meadow. */
const HILL = { r: 140, h: 24 }
/** A point at radius R from the crown, at `deg` (0 east, 90 south, -90 north). */
function polar(R: number, d: number): [number, number] {
  return [r1(C.x + Math.cos(rad(d)) * R), r1(C.z + Math.sin(rad(d)) * R)]
}
/** Points along a circle round any centre, angles in degrees with 0 = east and 90 = south (+z). */
function arc(cx: number, cz: number, r: number, from: number, to: number, n: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const a = rad(from + ((to - from) * i) / n)
    out.push([r1(cx + Math.cos(a) * r), r1(cz + Math.sin(a) * r)])
  }
  return out
}
/** Yaw that lays a line piece (hedge, wall, fence, channel) along the ring's tangent at `d`. */
const tangent = (d: number) => Math.atan2(-Math.cos(rad(d)), -Math.sin(rad(d)))
/** Yaw that turns a piece's front (local +z) away from the crown. */
const facingOut = (d: number) => Math.atan2(Math.cos(rad(d)), Math.sin(rad(d)))
/**
 * Yaw for a longhouse on a ring with its door in the middle of its +x long side: local +x points
 * away from the crown ('out') or toward it ('in'), and the ridge (local z) runs along the terrace.
 */
const sideDoor = (d: number, facing: 'out' | 'in') => -rad(d) + (facing === 'in' ? Math.PI : 0)

/**
 * Rim strength of every terrace flat. At 1 the two rims across a bank hand over in a sharp step
 * mid-bank (peak grade ~1.25 for a 5.5 m step over a 14 m gap); at 0.3 the hill's own slope keeps a
 * share of the gap and the same bank peaks at ~0.9. Cores stay level whatever the strength.
 */
const TERRACE_STRENGTH = 0.3

interface Terrace {
  /** radius of the band's middle, and its depth */
  rho: number
  band: number
  /** arc it runs along (degrees); a full circle when to - from = 360 */
  from: number
  to: number
  /** level, and distance between the flats of its chain along the arc */
  h: number
  spacing: number
}
/**
 * A level terrace following a contour: a chain of equal-height flats along an arc of radius
 * `rho`, close enough that their cores (0.55 r + half a metre) overlap into one band `band`
 * metres deep (exactly `band` midway between two centres, deeper at the centres). Cores of the
 * same height merge without a seam; the bank to the next terrace is their rims.
 */
function ring(t: Terrace): Flat[] {
  const core = Math.hypot(t.band / 2, t.spacing / 2)
  const r = r1((core - 0.5) / 0.55)
  const full = Math.abs(t.to - t.from) >= 360
  const n = Math.max(1, Math.round((rad(Math.abs(t.to - t.from)) * t.rho) / t.spacing))
  const out: Flat[] = []
  for (let i = 0; i < (full ? n : n + 1); i++) {
    const [x, z] = polar(t.rho, t.from + ((t.to - t.from) * i) / n)
    out.push({ x, z, r, h: t.h, strength: TERRACE_STRENGTH })
  }
  return out
}

/**
 * Line pieces (hedge, wall) laid along a ring between two angles, each turned to its own tangent
 * and 1.2 m longer than its share of the arc so neighbours overlap 0.6 m at each end. The line
 * forms register colliders, which is what makes the gate the only way in.
 */
function lineRing(kind: string, R: number, from: number, to: number, n: number, params: Record<string, unknown>, extra: P = {}): At[] {
  const out: At[] = []
  const step = (to - from) / n
  const seg = rad(Math.abs(step)) * R
  for (let i = 0; i < n; i++) {
    const mid = from + step * (i + 0.5)
    out.push({ kind, at: polar(R, mid), rotation: r3(tangent(mid)), params: { length: r1(seg + 1.2), ...params }, ...extra })
  }
  return out
}

// Radii from C and levels. A longhouse row is 6.8 m deep with its footing (6.5 m wide, ridge along
// the terrace), the way 5.4 m, the stream's channel 1.6 m with its kerbs.
//
// The crown: a paved platform 6.5 m above the forecourt, made of five flats at full strength. Three
// small ones in a row across the north end (r 14: short rims, so the green bank under the stair stays
// BELOW a straight stair line instead of bulging over it, which one big flat's long rim does), the
// middle one's pole being the stair head; and two for the hall behind them. Their cores' union holds
// the 16 x 40 m hall with 12.5 m of open platform between the stair head and the doors and 4-7 m
// strips down both sides and behind. Measured with tools/crown.mts.
const PLATFORM_H = 32
const HEAD = 323.35 // the stair head: the middle north flat's core edge on the axis
const coreOf = (r: number) => 0.55 * r + 0.5
const CROWN: Flat[] = [
  { x: C.x, z: 367, r: 28, h: PLATFORM_H, strength: 1 }, // the hall's south half
  { x: C.x, z: 349, r: 28, h: PLATFORM_H, strength: 1 }, // the hall's north half
  ...[-8, 0, 8].map((dx): Flat => ({ x: C.x + dx, z: r3(HEAD + coreOf(14)), r: 14, h: PLATFORM_H, strength: 1 })), // before the doors
]
/** The platform's level ground: inside the union of the crown flats' cores, less `inset`. */
const onPlatform = (x: number, z: number, inset = 0) => CROWN.some((f) => Math.hypot(x - f.x, z - f.z) <= coreOf(f.r) - inset)
/**
 * The platform's outline at `inset` inside its level edge, traced from a point on the axis by
 * bisection along `n` rays (the union is star-shaped from there), as a closed ring of points in
 * order of angle round that point (east, south, west, north).
 */
function platformOutline(inset: number, n = 72): [number, number][] {
  const O = { x: C.x, z: 352 }
  return Array.from({ length: n }, (_, i): [number, number] => {
    const a = (i / n) * Math.PI * 2
    let lo = 0, hi = 45
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2
      if (onPlatform(O.x + Math.cos(a) * mid, O.z + Math.sin(a) * mid, inset)) lo = mid
      else hi = mid
    }
    return [r3(O.x + Math.cos(a) * lo), r3(O.z + Math.sin(a) * lo)]
  })
}
/**
 * The convex hull of that outline, resampled every `step` metres and ordered the same way: the
 * parapet's line. It bridges the shallow notches where the flats' cores meet (0.3 m below the
 * platform at most), so the wall runs straight along the north edge and the long sides.
 */
function platformHull(inset: number, step = 4.5): [number, number][] {
  const pts = platformOutline(inset, 144).slice().sort((p, q) => p[0] - q[0] || p[1] - q[1])
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (list: [number, number][]) => {
    const h: [number, number][] = []
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop()
      h.push(p)
    }
    return h.slice(0, -1)
  }
  const hull = [...half(pts), ...half(pts.slice().reverse())]
  // points every `step` metres along the hull's perimeter
  const out: [number, number][] = []
  let carry = 0
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    let t = carry
    for (; t < len; t += step) out.push([r3(a[0] + ((b[0] - a[0]) * t) / len), r3(a[1] + ((b[1] - a[1]) * t) / len)])
    carry = t - len
  }
  const ang = ([x, z]: [number, number]) => (Math.atan2(z - 352, x - C.x) + Math.PI * 2) % (Math.PI * 2)
  return out.sort((p, q) => ang(p) - ang(q))
}
const RING1: Terrace = { rho: 34.5, band: 8, from: -125, to: -55, h: 25.5, spacing: 7 } //    forecourt R 30.5-38.5
const RINGA: Terrace = { rho: 55.5, band: 15.2, from: -150, to: -30, h: 20.5, spacing: 9 } // R 47.9-63.1 (hill 20.7)
const RINGB: Terrace = { rho: 87, band: 23, from: -270, to: 90, h: 15, spacing: 10 } //       R 75.5-98.5, all round
const WALL_R = 99.5 //  on the outer lip of ring B
const DITCH_R = 108 //  dry ditch at the foot of the rampart
const HEDGE_R = 116 //  thorn hedge on the ditch's outer lip

/** House rows (centre radius of the 6.8 m deep footing). */
const ROW = { A: 51.4, Bin: 79.0, Bout: 94.5 }
/** The way's centre line on each level, and its width (book: a wide road of cut stone). */
const WAY = { one: 33.6, A: 58.0, B: 88.1 }
const WAY_W = 5.4
/**
 * The stream's channel (1.6 m wide with kerbs) beside the way: on the forecourt's lip, on ring A's
 * lip, and on ring B's inner (uphill) side between the foot of the first flight and the gate. It
 * runs only where the way runs, so it is beside the road the whole climb and in front of only one
 * row of doors (ring B inner, -106..-94 deg), where slabs cross it at each door.
 */
const STREAM = { one: 37.3, A: 61.7, B: 84.2 }
// the hairpins: the way climbs from ring B to ring A west of the axis, from A to the forecourt east
const H_WEST = -110
const H_EAST = -70
/** where the stream comes down each bank, beside (not under) the flights */
const S_EAST = -64
const S_WEST = -106
/** where the stream leaves ring B and passes under the wall, west of the gate */
const S_OUT = -94

// The gate: on the wall line due north, its front (+z) to the town so the leaves open outward.
const GATE = polar(WALL_R, -90)
const GATE_W = 6.4
const GATE_POST = GATE_W / 2 + 0.3
// a line piece reaches 0.6 m past the end of its arc: stop each arc so the wall meets the posts
const WALL_GAP = deg((GATE_POST + 0.6) / WALL_R)
// the hedge stands back 6.5 m either side of the road's middle
const HEDGE_GAP = deg((6.5 + 0.6) / HEDGE_R)
// the ditch stops well short of the road: its valley digs a rounded cap 8 m past each end
const DITCH_GAP = 11

// The stair: from the forecourt up the green bank to the platform, due north of C: 8 m between its
// cheeks, 13.75 m run with a 2 m landing halfway, 6.5 m rise. The bank under it is everywhere at or
// below the stair line (within 0.3 m near the head), so the `stair` kind builds it as masonry on the
// bank and carries the traveller on its decks. Its cheeks run on 0.6 m past the head to the two
// stone seats, which close the gap to the parapet ends, so the stair is the only way up.
const STAIR = { x: C.x, foot: 309.6, head: HEAD, half: 4, landing: 2 }
const PARAPET_OPEN = 6.5 // the parapet stops this far either side of the axis
const SEAT = { off: 5.5, z: r1(HEAD + 0.55), w: 1.8, d: 0.7 }
/**
 * The low wall round the platform on its traced outline (0.5 m inside the level edge), open only
 * between x = 270 +- 6.5 at the north end, where the stair and the seats stand. Pieces join every
 * second outline point and overlap 0.3 m at each end; the two by the gap end exactly on its edge.
 */
function parapet(): At[] {
  const ring = platformHull(0.5)
  // walk the ring from the gap's east edge round the south to its west edge
  const inGap = ([x, z]: [number, number]) => Math.abs(x - C.x) < PARAPET_OPEN && z < HEAD + 6
  const start = ring.findIndex((p, i) => inGap(ring[(i + ring.length - 1) % ring.length]) && !inGap(p))
  const pts: [number, number][] = []
  for (let k = 0; k < ring.length; k++) {
    const p = ring[(start + k) % ring.length]
    if (inGap(p)) break
    pts.push(p)
  }
  // pin both ends onto the gap's edges (x = 270 +- 6.5) along the outline
  const edge = (a: [number, number], b: [number, number], x: number): [number, number] => {
    const t = (x - a[0]) / (b[0] - a[0])
    return [r3(x), r3(a[1] + (b[1] - a[1]) * t)]
  }
  const before = ring[(start + ring.length - 1) % ring.length]
  const after = ring[(start + pts.length) % ring.length]
  pts.unshift(edge(before, pts[0], C.x + PARAPET_OPEN))
  pts.push(edge(pts[pts.length - 1], after, C.x - PARAPET_OPEN))
  const keep = pts
  const out: At[] = []
  for (let i = 0; i < keep.length - 1; i++) {
    const [ax, az] = keep[i], [bx, bz] = keep[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 0.2) continue
    const ux = (bx - ax) / len, uz = (bz - az) / len
    // overlap 0.3 m past each joint, but not past the gap's edges
    const e0 = i === 0 ? 0 : 0.3, e1 = i === keep.length - 2 ? 0 : 0.3
    const cx = (ax + bx) / 2 + (ux * (e1 - e0)) / 2, cz = (az + bz) / 2 + (uz * (e1 - e0)) / 2
    out.push({
      kind: 'wall',
      at: [r3(cx), r3(cz)],
      rotation: r3(Math.atan2(-uz, ux)),
      // one level top along each piece (wherever the hull runs over the rim), a pale coping, and
      // 1 m strip segments
      params: { length: r1(len + e0 + e1), height: 1.1, thickness: 0.8, level: true, cap: '#c4bdae', seg: 1 },
      color: '#a8a294',
    })
  }
  return out
}

// The hall: 16 x 40 m, doors in the north gable 12.5 m back from the stair head, on the platform.
const HALL = { x: C.x, width: 16, length: 40, doors: r1(HEAD + 12.5) }
const HALL_Z = r1(HALL.doors + HALL.length / 2)

// ---------------------------------------------------------------------------------------------
// The Barrowfield: nine mounds west of the road (the first line, Eorl to Helm) and eight east of
// it (the second line, Fréaláf to Théoden), oldest nearest the gate, so Helm's and Théoden's
// face each other across the road at the outer end. Mounds are terrain, so they can be climbed.
// ---------------------------------------------------------------------------------------------
const ROAD_X = C.x
const MOUND_ROW = 17 // row centre off the road's centre line
const MOUND_FIRST = 212 // z of the mound nearest the gate, its foot 4 m short of the hedge
const MOUND_STEP = 12
const WEST_MOUNDS: Hill[] = Array.from({ length: 9 }, (_, k) => ({
  x: ROAD_X - MOUND_ROW,
  z: MOUND_FIRST - MOUND_STEP * k,
  // Eorl's, the first, and Helm's, the last of the line, a little greater than the rest
  r: k === 0 ? 9 : k === 8 ? 8.5 : 7.5,
  h: k === 0 ? 5.2 : k === 8 ? 5 : 4.4,
}))
const EAST_MOUNDS: Hill[] = Array.from({ length: 8 }, (_, k) => ({
  x: ROAD_X + MOUND_ROW,
  z: MOUND_FIRST - MOUND_STEP * k,
  r: k === 7 ? 8 : 7.5,
  h: k === 7 ? 4.6 : 4.4,
}))
const EORL = WEST_MOUNDS[0]
const HELM = WEST_MOUNDS[8]
const THEODEN = EAST_MOUNDS[7]

// ---------------------------------------------------------------------------------------------
// The way, the flights and the stream
// ---------------------------------------------------------------------------------------------

/**
 * The paved way: in at the gate, west along the lowest terrace, up the first hairpin, east along
 * the middle terrace, up the second hairpin and west along the forecourt to the stair foot. Each
 * hairpin climbs straight up the bank between two terraces: the short flights of steps. Chord
 * vertices sit half a sagitta out so the chords average the design radius.
 */
const WAY_LINE: [number, number][] = [
  GATE,
  polar(WAY.B, -90),
  polar(WAY.B + 0.3, -100),
  polar(WAY.B, H_WEST),
  polar(WAY.A, H_WEST),
  polar(WAY.A + 0.45, -90),
  polar(WAY.A, H_EAST),
  polar(WAY.one, H_EAST),
  polar(WAY.one, -90),
  [STAIR.x, STAIR.foot],
]
/** The flights of steps where the way climbs a bank (`stair` kind, draped; foot and head). */
const FLIGHTS: { foot: [number, number]; head: [number, number] }[] = [
  { foot: polar(75.3, H_WEST), head: polar(63.0, H_WEST) },
  { foot: polar(47.8, H_EAST), head: polar(38.4, H_EAST) },
]

/** A run of channel: straight from a to b, or along a ring; `covered` = culvert or door slab, `kerb: 0` = brook. */
interface Run {
  pts: [number, number][]
  covered?: boolean
  /** a culvert under the way: its slab lies flush with the paving instead of on raised kerbs */
  flush?: boolean
  brook?: boolean
}
/** A ring run as chords of at most `max` metres. */
function arcRun(R: number, a0: number, a1: number, covered = false, max = 6): Run {
  const n = Math.max(1, Math.ceil((rad(Math.abs(a1 - a0)) * R) / max))
  return { pts: Array.from({ length: n + 1 }, (_, i) => polar(R, a0 + ((a1 - a0) * i) / n)), covered }
}
const lineRun = (a: [number, number], b: [number, number], covered = false, brook = false): Run => ({ pts: [a, b], covered, brook })

// The spring basin stands against the foot of the bank west of the stair; the stream starts at its lip.
const SPRING_DEG = -106
const BASIN = polar(32, SPRING_DEG)
const BASIN_LIP = polar(33.4, SPRING_DEG)
// the culvert where the way comes up the second flight onto the forecourt (way +-2.7 m, +0.5 margin)
const C1 = deg(3.2 / STREAM.one)
// the inner-row houses on ring B between the first flight and the gate face the stream: a slab at
// each door (filled in once the rows are laid out, below)
const STREAM_RUNS = (doorSlabs: number[]): Run[] => {
  const runs: Run[] = [
    lineRun(BASIN_LIP, polar(STREAM.one, SPRING_DEG)),
    arcRun(STREAM.one, SPRING_DEG, H_EAST - C1),
    { ...arcRun(STREAM.one, H_EAST - C1, H_EAST + C1, true), flush: true },
    arcRun(STREAM.one, H_EAST + C1, S_EAST),
    // down the bank beside the second flight, then west along ring A's lip
    lineRun(polar(STREAM.one, S_EAST), polar(STREAM.A, S_EAST)),
    arcRun(STREAM.A, S_EAST, S_WEST),
    // down the bank beside the first flight, then east along ring B's inner side
    lineRun(polar(STREAM.A, S_WEST), polar(STREAM.B, S_WEST)),
  ]
  // ring B from S_WEST to S_OUT, broken by a 2.4 m slab at each door
  const half = deg(1.2 / STREAM.B)
  let a = S_WEST
  for (const d of doorSlabs.filter((x) => x > S_WEST && x < S_OUT).sort((p, q) => p - q)) {
    runs.push(arcRun(STREAM.B, a, d - half), arcRun(STREAM.B, d - half, d + half, true))
    a = d + half
  }
  runs.push(
    arcRun(STREAM.B, a, S_OUT),
    // out to the wall: under the way (culvert), open across the strip by the lodge, under the wall
    lineRun(polar(STREAM.B, S_OUT), polar(WAY.B - WAY_W / 2 - 0.4, S_OUT)),
    { ...lineRun(polar(WAY.B - WAY_W / 2 - 0.4, S_OUT), polar(WAY.B + WAY_W / 2 + 0.4, S_OUT), true), flush: true },
    lineRun(polar(WAY.B + WAY_W / 2 + 0.4, S_OUT), polar(WALL_R - 1.4, S_OUT)),
    lineRun(polar(WALL_R - 1.4, S_OUT), polar(WALL_R + 1.4, S_OUT), true),
    // outside the wall it is no longer stonework: a brook spills down the rampart into the ditch's
    // west end (the book is silent; the Barrowfield stays a plain green field)
    lineRun(polar(WALL_R + 1.4, S_OUT), polar(DITCH_R - 1, -90 - DITCH_GAP + 1), false, true),
  )
  return runs
}

// ---------------------------------------------------------------------------------------------
// The houses: long timber houses with the door in the middle of the long side, ridge along the
// terrace (book: timber houses with dark doors on both sides of the way)
// ---------------------------------------------------------------------------------------------
interface Slot {
  R: number
  d: number
  L: number
  facing: 'out' | 'in'
  jitter: number
  k: number
}
/**
 * Lay a row of houses along a ring from `from` to `to` degrees: lengths 9-12 m (plus a 0.3 m
 * footing) and gaps of 2.5-4 m drawn from a seeded hash, each turned up to 1.5 deg off the true
 * tangent so the rows do not read as a ruled line. A house never overlaps a `skip` range.
 */
function row(R: number, from: number, to: number, facing: 'out' | 'in', seed: number, skip: [number, number][] = []): Slot[] {
  const out: Slot[] = []
  const lens = [9, 10, 11, 12]
  let s = 1.5
  const span = rad(to - from) * R
  for (let i = 0; i < 40; i++) {
    const L = lens[Math.floor(hash(seed, i) * 4)]
    const gap = 2.5 + hash(i + 7, seed) * 1.5
    const foot = L + 0.3
    if (s + foot > span) break
    const lo = from + deg(s / R), hi = from + deg((s + foot) / R)
    const block = skip.find(([a, b]) => hi > a && lo < b)
    if (block) {
      s = Math.max(s, rad(block[1] - from) * R + 0.5)
      continue
    }
    out.push({ R, d: r3(from + deg((s + foot / 2) / R)), L, facing, jitter: r3((hash(seed + 3, i) - 0.5) * 3), k: out.length + seed })
    s += foot + gap
  }
  return out
}
// Ring B inner row: a gap where the first flight and the stream come down (-114..-104.5) and one on
// the axis (-94.5..-85.5), so from the gate you look straight up the hill to the stair and the hall.
const ROW_B_IN = row(ROW.Bin, -158, -22, 'out', 11, [[-114, -104.5], [-94.5, -85.5]])
// Ring B outer row, backs to the wall: the gate square (lodge, horse-lines, stable) breaks it.
const ROW_B_OUT = [...row(ROW.Bout, -160, -104, 'in', 23), ...row(ROW.Bout, -67, -20, 'in', 37)]
// Ring A: a small square on the axis below the forecourt, and a gap at the second flight and the stream.
const ROW_A = row(ROW.A, -150, -30, 'out', 51, [[-96, -84], [-75, -62]])
// The flanks and the back of the hill, on ring B's south half: a few houses facing the mountains.
const ROW_SOUTH: Slot[] = [-8, 13, 52, 74, 106, 128, 170, 192].map((d, i) => ({ R: ROW.Bin, d, L: [10, 11, 9, 12][i % 4], facing: 'out' as const, jitter: r3((hash(71, i) - 0.5) * 3), k: 90 + i }))

const WALLS = ['#6f5236', '#7a5a3a', '#5f4630', '#6a4e34']
const ROOFS = ['#b39556', '#a88a4e', '#9a8a52', '#b8a060', '#7a8a4a'] // the last is turf
/** A longhouse in a slot: timber walls and a thatch (or turf) roof picked from the tones above. */
function house(s: Slot, extra: Record<string, unknown> = {}): At {
  const wall = WALLS[Math.floor(hash(s.k, 5) * 4)]
  const roof = ROOFS[Math.floor(hash(s.k, 9) * 5)]
  const params = { width: 6.5, length: s.L, wallHeight: 2.4, door: 'side', roof, wall, ...extra }
  return { kind: 'longhouse', at: polar(s.R, s.d), rotation: r3(sideDoor(s.d, s.facing) + rad(s.jitter)), params }
}
// The gate-wardens' lodge west of the gate, and the stable east of it (a longhouse with a wide
// door), with the horse-lines between it and the gate where riders leave their horses.
const LODGE: Slot = { R: ROW.Bout, d: -100, L: 9, facing: 'in', jitter: 0, k: 200 }
const STABLE: Slot = { R: 94.3, d: -72.5, L: 13, facing: 'in', jitter: 0, k: 201 }
const HOUSES: At[] = [
  ...ROW_B_IN.map((s) => house(s)),
  ...ROW_B_OUT.map((s) => house(s)),
  ...ROW_A.map((s) => house(s)),
  ...ROW_SOUTH.map((s) => house(s)),
  house(LODGE),
  house(STABLE, { width: 7, doorWidth: 2.6, shutters: 0, louvre: false }),
]
const HORSE_LINES: At[] = [
  { kind: 'fence', at: polar(97, -83), rotation: r3(tangent(-83)), params: { length: 8 } },
  ...[-85, -83, -81].map((d, i): At => ({ kind: 'pony', at: polar(94.8, d), rotation: r3(-rad(d)), scale: 1.3, params: [{ coat: '#7a4a2a', mane: '#2e241c' }, { coat: '#c9c4bc', mane: '#8a857e' }, { coat: '#9b5a2e', mane: '#6a3a1e' }][i] })),
  { kind: 'haystack', at: polar(93.6, -78.4), params: { radius: 1.1 } },
]
/** Doors of the inner-row houses on ring B that face the stream (a slab crosses it at each). */
const DOOR_SLABS = ROW_B_IN.filter((s) => s.d > S_WEST && s.d < S_OUT).map((s) => s.d)

/** Absolute props re-anchored on a spot, so they cull with it instead of with the whole map. */
const near = (spot: [number, number], list: At[]): P[] => list.map(({ at, ...p }) => ({ ...p, offset: [r1(at[0] - spot[0]), r1(at[1] - spot[1])] as [number, number] }))

// ---------------------------------------------------------------------------------------------
// Spots
// ---------------------------------------------------------------------------------------------
const SPAWN: [number, number] = [ROAD_X, 62]
const JUNCTION: [number, number] = [268, 72]
const WEST_ROAD: [number, number] = [258, 66]
const FORD: [number, number] = [ROAD_X, 90]
const MEADOWS: [number, number] = [198, 190]
const MUSTER: [number, number] = [356, 178]
const HARROWDALE: [number, number] = [143, 405]
const PAVED_WAY: [number, number] = polar(WAY.A, -90)
// the spot stands beside the basin, 2.5 m east of the channel's first run, not in its water
const SPRING: [number, number] = polar(35.5, SPRING_DEG + 4)
// the four spots on the platform stand 12-20 m apart, and each discovers only from inside the parapet
const STAIR_HEAD: [number, number] = [STAIR.x, r1(HEAD + 1.5)]
const DOORS: [number, number] = [262, 333.5]
const TERRACE: [number, number] = [280.5, 328.5]
const MEDUSELD: [number, number] = [283, 351]
const EXIT: [number, number] = [206, 64.6]

// horses outside: tethered beside the causeway, and a loose grey by the ford
/** A standard; its cloth faces local +z, so the default turns it to face north, down the hill. */
const banner = (x: number, z: number, h = 6, rot = Math.PI): At => ({ kind: 'banner', at: [x, z], rotation: rot, params: { height: h, deviceShape: 'horse' } })
const pony = (x: number, z: number, rot: number, coat: [string, string]): At => ({ kind: 'pony', at: [x, z], rotation: rot, scale: 1.3, params: { coat: coat[0], mane: coat[1] } })
const GREY: [string, string] = ['#c9c4bc', '#8a857e']
const BAY: [string, string] = ['#7a4a2a', '#2e241c']
const CHESTNUT: [string, string] = ['#9b5a2e', '#6a3a1e']
const BLACK: [string, string] = ['#2e2a28', '#1a1816']
const DUN: [string, string] = ['#b89a6a', '#4a3a2a']
/** A railed paddock of four fences round (x, z), `w` east-west by `d` north-south, gate gap on one side. */
function paddock(x: number, z: number, w: number, d: number, gapSide: 'n' | 's'): At[] {
  return [
    { kind: 'fence', at: [x, z - d / 2], rotation: 0, params: { length: w, ...(gapSide === 'n' ? { gap: 3.5 } : {}) } },
    { kind: 'fence', at: [x, z + d / 2], rotation: 0, params: { length: w, ...(gapSide === 's' ? { gap: 3.5 } : {}) } },
    { kind: 'fence', at: [x - w / 2, z], rotation: Math.PI / 2, params: { length: d } },
    { kind: 'fence', at: [x + w / 2, z], rotation: Math.PI / 2, params: { length: d } },
  ]
}

const spots: Spot[] = [
  {
    id: 'west-road',
    displayName: 'The Road from the West',
    type: 'other',
    mapIcon: 'waymark',
    position: WEST_ROAD,
    discoverRadius: 16,
    // the whole north-west plain: open grass, hardly a tree
    radius: 200,
    setting:
      'Here the road from the west comes down to the river over open grass that the wind never lets lie still. South across the water a green hill stands out from the feet of the mountains, walled about its shoulders, and on its crown a long roof catches the light like a fire of gold.',
    vegetation: { density: 0.08 },
    props: near(WEST_ROAD, [{ kind: 'signpost', at: [JUNCTION[0] - 5, JUNCTION[1] - 3], rotation: 0.4, params: { boards: 2 } }]),
    lore: {
      region: 'snowbourn-meads',
      summary:
        'This is the road the Riders take west, under the mountains toward the Westfold and the Fords of Isen. From out here the king’s hall is already in sight: its roof gleams across the plain for miles, and that gleam is how every traveller first knows Edoras.',
      storyEvents: [
        {
          book: 'The Two Towers',
          chapter: 'The King of the Golden Hall',
          text: 'Riding over the grass toward the hill, the others could make out only green slopes and a far-off glint. Legolas, whose eyes outran them all, told them what lay there: a hill ringed about with its defences, the roofs of houses crowded inside them, and on the height a great hall whose roof shone like gold.',
        },
      ],
      characters: ['Legolas', 'Gandalf', 'Aragorn', 'Gimli'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Edoras',
    },
  },
  {
    id: 'snowbourn-ford',
    displayName: 'The Ford of the Snowbourn',
    type: 'water',
    mapIcon: 'water',
    position: FORD,
    discoverRadius: 16,
    radius: 30,
    setting:
      'The road runs down into a wide, shallow ford. Cold clear water out of the snows hurries over the stones, the low banks on both sides are churned to mud by hooves, and willows lean over the deep reaches up and down stream.',
    ground: { kind: 'marsh', blend: 0.45, inner: 0.35 },
    vegetation: { density: 0.4, flowers: 'reeds' },
    props: near(FORD, [
      { kind: 'stones', at: [FORD[0] - 12, FORD[1] - 14], params: { count: 5, size: 0.7 } },
      { kind: 'stones', at: [FORD[0] + 11, FORD[1] + 15], params: { count: 4, size: 0.6 } },
      // a loose grey grazing on the south bank, as if one of the great horses ran free here
      pony(FORD[0] - 16, FORD[1] + 17, 0.9, GREY),
    ]),
    lore: {
      region: 'snowbourn-meads',
      summary:
        'The Snowbourn rises under the Starkhorn and runs the whole length of Harrowdale. At Edoras it comes out of the mountains, runs past the foot of the hill and turns east for the Entwash. Anyone riding to the king from the west or the north splashes across it here.',
      storyEvents: [
        {
          book: 'The Two Towers',
          chapter: 'The King of the Golden Hall',
          text: 'Gandalf on Shadowfax led his companions over this ford on the morning they came to Edoras. Aragorn rode Hasufel, and Legolas carried Gimli behind him on Arod: the two horses Éomer had lent the three of them out on the plain.',
        },
      ],
      characters: ['Gandalf', 'Aragorn', 'Legolas', 'Gimli'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Snowbourn',
    },
  },
  {
    id: 'horse-meadows',
    displayName: 'The Horse-meadows',
    type: 'other',
    mapIcon: 'waymark',
    position: MEADOWS,
    discoverRadius: 18,
    // the meadows inside the river's bend: open pasture
    radius: 110,
    setting:
      'Wet green pasture inside the bend of the river, with a railed paddock and horses grazing in and out of it. From here the hill and its shining roof fill the southern sky.',
    vegetation: { density: 0.1 },
    props: near(MEADOWS, [
      ...paddock(MEADOWS[0] + 4, MEADOWS[1] - 2, 36, 26, 's'),
      pony(MEADOWS[0] - 6, MEADOWS[1] + 2, 0.5, GREY),
      pony(MEADOWS[0] + 5, MEADOWS[1] - 6, 2.4, BAY),
      pony(MEADOWS[0] + 12, MEADOWS[1] + 5, -1.2, CHESTNUT),
      pony(MEADOWS[0] - 20, MEADOWS[1] + 22, 1.6, BLACK),
      { kind: 'haystack', at: [MEADOWS[0] + 16, MEADOWS[1] - 8], params: { radius: 1.6 } },
    ]),
    lore: {
      region: 'snowbourn-meads',
      summary:
        'Rohan is the horse-country, and the fields round the king’s courts are its best grazing. The Riders count their wealth in horses and treat the finest of them almost as kin.',
      storyEvents: [
        {
          book: 'The Two Towers',
          chapter: 'The King of the Golden Hall',
          text: 'Hasufel and Arod came home to Edoras as Éomer had asked, so a promise made out on the plain was kept.',
        },
        {
          book: 'The Two Towers',
          chapter: 'The King of the Golden Hall',
          text: 'Shadowfax had been running free in the fields below the town. Théoden gave him to Gandalf outright, no longer a loan, and the great grey horse came at the wizard’s whistle.',
        },
      ],
      characters: ['Gandalf', 'Théoden', 'Shadowfax'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Shadowfax',
    },
  },
  {
    id: 'muster-field',
    displayName: 'The Muster-field',
    type: 'other',
    mapIcon: 'other',
    position: MUSTER,
    discoverRadius: 18,
    // the whole east plain: open grass
    radius: 140,
    setting:
      'East of the mounds the grass runs flat and open under the hill, wide enough for a host to draw up in its companies. Green standards stand in the turf, the ground is cut everywhere by hooves, and horses graze in a paddock at the far side.',
    vegetation: { density: 0.06 },
    props: near(MUSTER, [
      // facing west, toward the road and the mounds
      banner(MUSTER[0] - 8, MUSTER[1] - 4, 6, -Math.PI / 2),
      banner(MUSTER[0] + 6, MUSTER[1] - 9, 6, -Math.PI / 2),
      banner(MUSTER[0] + 2, MUSTER[1] + 8, 6, -Math.PI / 2),
      { kind: 'cart', at: [MUSTER[0] - 14, MUSTER[1] + 10], rotation: 2.2, params: { load: 'barrels' } },
      // the second paddock, east of the field
      ...paddock(MUSTER[0] + 40, MUSTER[1] + 26, 28, 20, 'n'),
      pony(MUSTER[0] + 34, MUSTER[1] + 24, 0.3, DUN),
      pony(MUSTER[0] + 45, MUSTER[1] + 29, 2.8, BAY),
    ]),
    lore: {
      region: 'snowbourn-meads',
      summary: 'When the king calls, the Riders of the Mark gather on the open fields below his town, where the whole host can see the hall and the hall can see the whole host.',
      storyEvents: [
        {
          book: 'The Two Towers',
          chapter: 'The King of the Golden Hall',
          text: 'Once the summons had gone out, the king’s household and every Rider who could be found in time gathered below the town. Théoden came down to them, and the host rode away west with trumpets sounding, horses neighing and spears ringing on shields.',
        },
        {
          book: 'The Return of the King',
          chapter: 'The Muster of Rohan',
          text: 'When the call came again, for the ride to Gondor, the host was gathered up in Harrowdale under the mountains, as Gandalf had advised, and not out here on the open fields round Edoras.',
        },
      ],
      characters: ['Théoden', 'Éomer', 'Gandalf'],
      sourceUrl: 'https://tolkiengateway.net/wiki/The_King_of_the_Golden_Hall',
    },
  },
  {
    id: 'barrowfield',
    displayName: 'The Barrowfield',
    type: 'other',
    mapIcon: 'hill',
    position: [ROAD_X, 166],
    discoverRadius: 16,
    radius: 56,
    setting:
      'The road runs between two rows of tall green mounds, nine on the west hand and eight on the east. The west-facing slope of every mound is white with tiny star-like flowers, as if late snow had lingered only there.',
    // few trees between the mounds; the white comes from `flowerPatch` on their west flanks
    vegetation: { density: 0.3, flowers: 'white' },
    props: [],
    lore: {
      region: 'barrowfield',
      summary:
        'The kings of the Mark lie here. The first line, from Eorl to Helm, is on the west of the road and the second, from Fréaláf on, on the east. The white flower is simbelmynë, Evermind, which blooms in every season wherever the dead are remembered.',
      storyEvents: [
        {
          book: 'The Two Towers',
          chapter: 'The King of the Golden Hall',
          text: 'Riding between the mounds, Gandalf named the white flower for his friends: Evermind, a flower never out of bloom whatever the season, that grows wherever the dead lie.',
        },
        {
          book: 'The Two Towers',
          chapter: 'The King of the Golden Hall',
          text: 'Aragorn chanted an old lament of the Riders for Eorl the Young in their own tongue. Legolas, who knew none of the words, said the song was like the country it came from; then Aragorn put it into the Common Speech.',
        },
      ],
      characters: ['Gandalf', 'Aragorn', 'Legolas'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Barrowfield',
    },
  },
  {
    id: 'eorls-mound',
    displayName: 'Eorl’s Mound',
    type: 'other',
    mapIcon: 'hill',
    position: [EORL.x, EORL.z],
    discoverRadius: 10,
    radius: 14,
    setting:
      'Close under the walls the two lines end, and the first mound of the western row, broader than the rest, stands nearest the gate. Its western slope is pale with the little white flowers; behind you the line runs on, king after king, out to Helm’s.',
    vegetation: { density: 0.4, flowers: 'white' },
    lore: {
      region: 'barrowfield',
      summary:
        'Eorl the Young was the first king of the Mark. He tamed the white horse Felaróf, sire of the mearas, the horses of kings, and on Felaróf he rode out of the North to Gondor’s aid.',
      storyEvents: [
        {
          book: 'The Return of the King',
          chapter: 'Appendix A',
          text: 'For that ride Eorl was given this land. Many years later he fell in battle in the Wold, and he and Felaróf were laid together here, in the first of the mounds outside the gate.',
        },
      ],
      characters: ['Eorl the Young', 'Felaróf'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Felaróf',
    },
  },
  {
    id: 'helms-mound',
    displayName: 'Helm’s Mound',
    type: 'other',
    mapIcon: 'hill',
    position: [HELM.x, HELM.z],
    discoverRadius: 10,
    radius: 13,
    setting:
      'The last mound of the western row, whiter than all the rest. The flowers grow so thick on it that it looks snow-covered in every season.',
    vegetation: { density: 0.6, flowers: 'white' },
    lore: {
      region: 'barrowfield',
      summary:
        'Helm Hammerhand, the ninth king, held the Hornburg through the Long Winter and was found dead in the snow, still on his feet, after one of his night forays. The first line of kings ended with him, and the Evermind has always grown thickest here.',
      storyEvents: [
        {
          book: 'The Return of the King',
          chapter: 'Appendix A',
          text: 'While Helm was shut up in the west, the Dunlending Wulf took Edoras and sat in the golden hall as king. Helm’s son Haleth had died defending its doors.',
        },
        {
          book: 'The Return of the King',
          chapter: 'Appendix A',
          text: 'When the snow broke, Helm’s sister-son Fréaláf came down out of Dunharrow with a handful of men, took the town by surprise and killed Wulf. He was the first king of the second line.',
        },
      ],
      characters: ['Helm Hammerhand', 'Haleth', 'Wulf', 'Fréaláf'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Helm',
    },
  },
  {
    id: 'theodens-mound',
    displayName: 'Théoden’s Mound',
    type: 'other',
    mapIcon: 'hill',
    position: [THEODEN.x, THEODEN.z],
    discoverRadius: 10,
    radius: 13,
    setting:
      'The newest mound of the eastern row. Its turf is still raw at the edges but already starred with white, and it faces Helm’s across the road.',
    vegetation: { density: 0.5, flowers: 'white' },
    lore: {
      region: 'barrowfield',
      summary:
        'Théoden, seventeenth king of the Mark, fell on the Pelennor Fields far away in Gondor. In high summer Éomer brought him home and laid him here in a chamber of stone with his arms and treasures, the eighth mound of the second line.',
      storyEvents: [
        {
          book: 'The Return of the King',
          chapter: 'Many Partings',
          text: 'When the mound was raised, the Riders of the king’s household rode round it on white horses singing the song his minstrel Gléowine had made for him. It was the last song Gléowine ever made.',
        },
        {
          book: 'The Return of the King',
          chapter: 'Many Partings',
          text: 'Then everyone went up to the golden hall for the funeral feast, and Éomer sat in his uncle’s seat.',
        },
      ],
      characters: ['Théoden', 'Éomer', 'Gléowine'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Théoden',
    },
  },
  {
    id: 'gate-of-edoras',
    displayName: 'The Gate of Edoras',
    type: 'fortress',
    mapIcon: 'gate',
    position: [GATE[0], GATE[1] - 3],
    discoverRadius: 14,
    radius: 30,
    setting:
      'The road climbs out of the barrows through a gap in the thorn hedge, over the ditch on a causeway of ground that was never dug, to the only gate in the wall. Inside, riders leave their horses at the rails by the stable and go up on foot; guards in bright mail stand at the opening.',
    ground: { kind: 'village', blend: 0.5, inner: 0.3 },
    vegetation: { density: 0.1 },
    props: near([GATE[0], GATE[1] - 3], [
      { kind: 'townGate', at: GATE, rotation: 0, params: { width: GATE_W, height: 3.4, open: 0.9, board: false, wood: '#5a4030' } },
      // standards either side of the gate, outside the wall
      banner(GATE[0] - 5.2, GATE[1] - 4),
      banner(GATE[0] + 5.2, GATE[1] - 4),
      // horses waiting at a rail beside the causeway
      { kind: 'fence', at: [GATE[0] + 10, GATE[1] - 11], rotation: Math.PI / 2, params: { length: 6 } },
      pony(GATE[0] + 8.4, GATE[1] - 12.5, Math.PI, CHESTNUT),
      pony(GATE[0] + 8.4, GATE[1] - 9.4, Math.PI, GREY),
      ...HORSE_LINES,
    ]),
    lore: {
      region: 'the-walls',
      summary:
        'In the dark years before the war the king’s word was that no stranger should pass unless he spoke the tongue of the Mark and came as a friend. The guards still challenge every comer in their own language before any other.',
      storyEvents: [
        {
          book: 'The Two Towers',
          chapter: 'The King of the Golden Hall',
          text: 'The gate-guards barred the way to Gandalf and his companions, wary of strangers on horses of the Mark, and one of them went up to the hall to ask whether they might come in.',
        },
        {
          book: 'The Return of the King',
          chapter: 'Appendix A',
          text: 'Once, in Helm’s day, the Dunlendings under Wulf broke in and held Edoras through a winter, until Fréaláf took it back the next spring.',
        },
      ],
      characters: ['Gandalf', 'Aragorn', 'Legolas', 'Gimli', 'Wulf'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Edoras',
    },
  },
  {
    id: 'harrowdale-road',
    displayName: 'The Harrowdale Road',
    type: 'other',
    mapIcon: 'waymark',
    position: HARROWDALE,
    discoverRadius: 16,
    radius: 60,
    setting:
      'South of the hill the track follows the Snowbourn up into the jaws of the valley. Straight up the dale the mountains close in, grey and white, and one peak stands alone above all the rest.',
    vegetation: { density: 0.6 },
    props: near(HARROWDALE, [
      { kind: 'standingStone', at: [HARROWDALE[0] + 5, HARROWDALE[1] - 4], params: { height: 2.2 } },
      { kind: 'cart', at: [HARROWDALE[0] + 6, HARROWDALE[1] + 8], rotation: 2.9, params: { load: 'barrels' } },
    ]),
    lore: {
      region: 'harrowdale',
      summary:
        'Harrowdale cuts deep into the White Mountains, with the Starkhorn at its head and the old hold of Dunharrow high on its eastern side. When war comes the people of Edoras take this road to safety.',
      storyEvents: [
        {
          book: 'The Two Towers',
          chapter: 'The King of the Golden Hall',
          text: 'When the king rode west to war he sent his people up this road to Dunharrow, with Éowyn to rule them until he came back.',
        },
        {
          book: 'The Return of the King',
          chapter: 'The Muster of Rohan',
          text: 'Days later the gathered host came back down the dale under a darkness that hid the sun and turned east for Gondor. Among them a slight young rider called Dernhelm carried Merry hidden in front of him.',
        },
      ],
      characters: ['Éowyn', 'Théoden', 'Merry', 'Dernhelm'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Harrowdale',
    },
  },
  {
    id: 'paved-way',
    displayName: 'The Paved Way',
    type: 'village',
    mapIcon: 'village',
    position: PAVED_WAY,
    discoverRadius: 14,
    // the whole walled hill: keeps trees off the terraces and banks (the scatter ignores roofs)
    radius: 160,
    setting:
      'Inside the gate a broad road of fitted stone climbs the hill along its terraces, bending back on itself and taking the steep banks in short flights of steps, between long timber houses with dark doorways on both hands. A little stream chatters beside it in a channel cut in stone.',
    vegetation: { density: 0.04 },
    props: near(PAVED_WAY, HOUSES),
    lore: {
      region: 'edoras-town',
      summary:
        'Edoras simply means “the courts”. It is a town of wooden houses gathered on one green hill, with the king’s hall at the top and all its comings and goings on this one stone road.',
      storyEvents: [
        {
          book: 'The Two Towers',
          chapter: 'The King of the Golden Hall',
          text: 'The four companions walked up this way on foot behind a guide from the gate, past one dark doorway after another, with the clear stream running beside them all the way.',
        },
        {
          book: 'The Two Towers',
          chapter: 'The King of the Golden Hall',
          text: 'Once the king was himself again, his summons went out from the hall and the whole town made ready: the Riders to go west, everyone else to go up into the hills.',
        },
      ],
      characters: ['Gandalf', 'Aragorn', 'Legolas', 'Gimli'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Edoras',
    },
  },
  {
    id: 'horse-head-spring',
    displayName: 'The Horse-head Spring',
    type: 'water',
    mapIcon: 'water',
    position: SPRING,
    discoverRadius: 8,
    radius: 14,
    setting:
      'At the foot of the green bank below the hall, clear water pours from a stone carved as a horse’s head into a broad basin. The basin’s overflow becomes the stream that runs down through the town, and above it the great stair climbs the bank between two green standards.',
    ground: { kind: 'stone', blend: 0.6, inner: 0.35 },
    vegetation: { density: 0.05 },
    props: near(SPRING, [
      // the carved spring and its basin, its front (and spill) to the stream's start
      { kind: 'springBasin', at: BASIN, rotation: r3(facingOut(SPRING_DEG)), params: { width: 4.2, depth: 2.4, carving: 'horse' } },
      // standards either side of the stair foot
      banner(STAIR.x - 5.2, STAIR.foot - 1.2),
      banner(STAIR.x + 5.2, STAIR.foot - 1.2),
    ]),
    lore: {
      region: 'edoras-town',
      summary:
        'The spring is the town’s own water, rising at the crown of the hill right under the king’s house. In Edoras everything comes back to the horse in the end, even the fountain.',
      storyEvents: [
        {
          book: 'The Two Towers',
          chapter: 'The King of the Golden Hall',
          text: 'Here the travellers came to the top of the climb and saw the great stair in front of them, with the king’s guards seated at its head.',
        },
      ],
      characters: ['Gandalf', 'Aragorn', 'Legolas', 'Gimli'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Edoras',
    },
  },
  {
    id: 'stair-head',
    displayName: 'The Stair of the Hall',
    type: 'other',
    mapIcon: 'other',
    position: STAIR_HEAD,
    // discovered at the top of the stair, not from the bank outside the cheeks
    discoverRadius: 4,
    radius: 12,
    setting:
      'A high, broad stone stair climbs the green bank, with a level landing halfway. On either side of the topmost step is a seat cut from stone, where a guard sits with a drawn sword across his knees. Turn round at the top and the whole climb lies below you: the roofs and the stone way, the wall and the dike, both white-flecked lines of mounds, the glint of the river, and the green plain running north until it goes grey with distance.',
    ground: { kind: 'stone', blend: 0.5, inner: 0.4 },
    vegetation: { density: 0.0 },
    props: near(STAIR_HEAD, [-1, 1].map((s): At =>
      // the stone seats either side of the head, facing north over the town: they close the gaps
      // between the stair's cheeks and the parapet's ends
      ({ kind: 'seat', at: [STAIR.x + s * SEAT.off, SEAT.z], rotation: Math.PI, params: { width: SEAT.w, depth: SEAT.d, seatHeight: 0.45, back: 1.2, arms: true, armHeight: 0.3, stone: '#b8ad98' } }),
    )),
    lore: {
      region: 'meduseld',
      summary:
        'The stair is the last threshold before the king. Its guards wear long burnished mail and carry green shields painted with the sun, and their fair hair falls in braids over their shoulders.',
      storyEvents: [
        {
          book: 'The Two Towers',
          chapter: 'The King of the Golden Hall',
          text: 'The guards rose from the seats at the stair-head and greeted Gandalf’s company in the Common Speech. One of them was Háma, the king’s doorward.',
        },
        {
          book: 'The Two Towers',
          chapter: 'The King of the Golden Hall',
          text: 'When the host rode out, Éowyn stood alone at the head of this stair before the doors, clad in mail, both hands resting on the hilt of a sword planted in front of her, and watched the spears of the host shining far out on the plain.',
        },
      ],
      characters: ['Háma', 'Éowyn', 'Gandalf'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Éowyn',
    },
  },
  {
    id: 'meduseld-doors',
    displayName: 'The Doors of Meduseld',
    type: 'other',
    mapIcon: 'other',
    position: DOORS,
    // inside the parapet only: its outer face is 7.9 m off
    discoverRadius: 4,
    setting:
      'Golden door-posts frame the great doors at the north end of the hall. Spears, shields and swords lean against the wall beside them, left by guests who may not go in armed.',
    // paves the forecourt's west half and the strip west of the hall
    radius: 16,
    ground: { kind: 'stone', blend: 0.6, inner: 0.5 },
    vegetation: { density: 0.0 },
    // 2.3 m out from the doors: 1.4 m clear of the weapon racks, so nobody wedges between pole and rack
    props: near(DOORS, [banner(HALL.x - 6, HALL.doors - 2.3, 7), banner(HALL.x + 6, HALL.doors - 2.3, 7)]),
    lore: {
      region: 'meduseld',
      summary:
        'No one comes armed before the king. Háma the doorward kept this threshold for Théoden, and every guest gave up blade and bow here before the doors were opened.',
      storyEvents: [
        {
          book: 'The Two Towers',
          chapter: 'The King of the Golden Hall',
          text: 'Háma asked the travellers for their weapons. Legolas and Gimli gave theirs readily and Aragorn only after a long argument; Gandalf kept his staff by pleading an old man’s need of it.',
        },
        {
          book: 'The Return of the King',
          chapter: 'Appendix A',
          text: 'Long before, when Wulf’s men took the town, Helm’s son Haleth fell fighting at these doors.',
        },
      ],
      characters: ['Háma', 'Aragorn', 'Legolas', 'Gimli', 'Gandalf', 'Haleth'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Háma',
    },
  },
  {
    id: 'hall-terrace',
    displayName: 'The Terrace before the Doors',
    type: 'hill',
    mapIcon: 'hill',
    position: TERRACE,
    // inside the parapet only: its outer face is 4.7 m off
    discoverRadius: 4,
    radius: 10,
    setting:
      'Between the stair-head and the doors the paved platform lies open to the north. From its edge you look out over the town and the walls, the barrows and the river, to the plain dwindling into grey distance, with the mountains crowding close behind the hall.',
    ground: { kind: 'stone', blend: 0.55, inner: 0.45 },
    vegetation: { density: 0.0 },
    lore: {
      region: 'meduseld',
      summary:
        'A king of the Mark comes out here to look over his land and breathe the clean air off the snows. On a clear day the gleam of the roof behind you can be seen for leagues across the plain.',
      storyEvents: [
        {
          book: 'The Two Towers',
          chapter: 'The King of the Golden Hall',
          text: 'Gandalf led Théoden out of the dim hall onto this terrace. The staff dropped from the old king’s hand and he stood up straight, while a storm out of the east rolled away south and the sun broke through behind them.',
        },
        {
          book: 'The Two Towers',
          chapter: 'The King of the Golden Hall',
          text: 'Given the choice of riding to war at the king’s side or leaving, Wormtongue spat before the king and fled, to Isengard and the master he had served all along.',
        },
      ],
      characters: ['Théoden', 'Gandalf', 'Gríma Wormtongue'],
      sourceUrl: 'https://tolkiengateway.net/wiki/The_King_of_the_Golden_Hall',
    },
  },
  {
    id: 'meduseld',
    displayName: 'Meduseld, the Golden Hall',
    type: 'home',
    mapIcon: 'home',
    position: MEDUSELD,
    // inside the parapet only: its outer face is 2.8 m off (the strip beside the hall is 6.8 m wide)
    discoverRadius: 2.5,
    // paves the strip east of the hall and the back of the platform, and keeps every tree off it
    radius: 22,
    setting:
      'The great hall of the kings stands on its paved platform at the top of the hill: long and wide, with deep eaves over small high windows on its eastern side, smoke threading from the louvres on the ridge, and a roof that shines like thatch of gold.',
    ground: { kind: 'stone', blend: 0.75, inner: 0.7 },
    vegetation: { density: 0.0 },
    props: near(MEDUSELD, [
      // Meduseld, its doors turned north: no porch and no pillars, weapons racked by the doors
      { kind: 'greatHall', at: [HALL.x, HALL_Z], rotation: Math.PI, params: { width: HALL.width, length: HALL.length, height: 6, pitch: 0.55, eaves: 1.2, porch: 0, pillars: 0, doors: 'shut', louvres: 2, windows: 6, windowSide: -1, weapons: true } },
    ]),
    lore: {
      region: 'meduseld',
      summary:
        'Brego son of Eorl built Meduseld, the mead-hall, and the kings of the Mark have ruled from it ever since. Inside, carved and painted pillars hold up the roof, the floor is a pavement of many-coloured stones worked with runes, old tales hang woven on the walls, and a long fire burns down the middle toward the king’s chair on its dais.',
      storyEvents: [
        {
          book: 'The Return of the King',
          chapter: 'Appendix A',
          text: 'At the feast that hallowed the new hall, Brego’s son Baldor rashly swore to walk the Paths of the Dead. He went the next year and never came back.',
        },
        {
          book: 'The Two Towers',
          chapter: 'The King of the Golden Hall',
          text: 'Gandalf found Théoden grey and bent in his chair with Gríma whispering at his feet. The wizard broke the counsellor’s hold with thunder and light, and the old king rose and took up his sword again.',
        },
        {
          book: 'The Return of the King',
          chapter: 'Many Partings',
          text: 'At the funeral feast Éowyn bore the cup to her brother as the new king, Éomer announced her betrothal to Faramir, and Merry was given an ancient silver horn.',
        },
      ],
      characters: ['Brego', 'Baldor', 'Théoden', 'Gríma Wormtongue', 'Éowyn', 'Éomer', 'Merry'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Meduseld',
    },
  },
]

// ---------------------------------------------------------------------------------------------
// The stream, the flights and the flowers: the stream's stone channel in pieces along its runs,
// the flights of steps on the banks the way climbs, and the white flowers on the mounds' west
// flanks.
// ---------------------------------------------------------------------------------------------
/**
 * Channel pieces along the runs, each straight, at most 10 m, overlapping 0.2 m. The runs join
 * end to end into one line; where it turns, the pieces either side of the joint are told the turn
 * (`joinOut` on the one before, `joinIn` on the one after; radians, + toward the piece's local +z)
 * so the channel mitres its corners instead of one kerb running across the other's water.
 */
function channelPieces(runs: Run[]): At[] {
  const segs = runs.flatMap((run) => run.pts.slice(0, -1).map((a, i) => ({ a, b: run.pts[i + 1], run })))
  const heading = (s: { a: [number, number]; b: [number, number] }) => Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0])
  const turn = (h0: number, h1: number) => r3(Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)))
  const out: At[] = []
  segs.forEach((s, si) => {
    const [ax, az] = s.a, [bx, bz] = s.b
    const len = Math.hypot(bx - ax, bz - az)
    const n = Math.max(1, Math.ceil(len / 10))
    const prev = segs[si - 1], next = segs[si + 1]
    const joinIn = prev && Math.hypot(prev.b[0] - ax, prev.b[1] - az) < 0.05 ? turn(heading(prev), heading(s)) : undefined
    const joinOut = next && Math.hypot(next.a[0] - bx, next.a[1] - bz) < 0.05 ? turn(heading(s), heading(next)) : undefined
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n
      const mx = ax + (bx - ax) * ((t0 + t1) / 2), mz = az + (bz - az) * ((t0 + t1) / 2)
      const jIn = k > 0 ? 0 : joinIn, jOut = k < n - 1 ? 0 : joinOut
      // a piece runs along its local x; this yaw points local +x from a to b (downstream)
      out.push({
        kind: 'channel',
        at: [r1(mx), r1(mz)],
        rotation: r3(Math.atan2(-(bz - az), bx - ax)),
        params: {
          length: r1(len / n + 0.2),
          width: 0.9,
          ...(s.run.covered ? { covered: true } : {}),
          ...(s.run.flush ? { kerbHeight: 0.02 } : {}),
          ...(s.run.brook ? { kerb: 0, width: 0.8, kerbHeight: 0.06, drop: 0.03 } : {}),
          ...(jIn !== undefined ? { joinIn: jIn } : {}),
          ...(jOut !== undefined ? { joinOut: jOut } : {}),
        },
      })
    }
  })
  return out
}
/** A stair's origin is its foot and it climbs toward local -z, so its front (+z) faces downhill. */
const stairAt = (foot: [number, number], head: [number, number], params: Record<string, unknown>): At => ({
  kind: 'stair',
  at: foot,
  rotation: r3(Math.atan2(foot[0] - head[0], foot[1] - head[1])),
  params: { run: r1(Math.hypot(head[0] - foot[0], head[1] - foot[1])), ...params },
})
const STREAM_AND_FLOWERS: At[] = [
  ...channelPieces(STREAM_RUNS(DOOR_SLABS)),
  // the way's two flights: treads draped on the bank, no cheeks (the bank either side is walkable)
  ...FLIGHTS.map((f) => stairAt(f.foot, f.head, { width: WAY_W, draped: true, cheeks: 0 })),
  // simbelmynë: the west flank of every mound white, Helm's white all over
  { kind: 'flowerPatch', at: [HELM.x, HELM.z], params: { radius: 7.5, count: 160, side: 'all' } },
  ...[...WEST_MOUNDS.slice(0, 8), ...EAST_MOUNDS].map((m): At => ({ kind: 'flowerPatch', at: [r1(m.x - 0.3 * m.r), m.z], params: { radius: r1(0.65 * m.r), count: 90, side: 'west' } })),
]

// ---------------------------------------------------------------------------------------------
// Free props: rings and the main stair. `distribute` hands each to the nearest spot within 140 m
// (re-anchored as an offset), so the long wall and hedge rings cull in pieces with the spots
// instead of riding in one map-wide scenery group that is never culled.
// ---------------------------------------------------------------------------------------------
const FREE: At[] = [
  // the wall on the lip of the lowest terrace, all round, closing on the gate posts
  // (`seg: 1`: 1 m strip segments on the long rings halve their triangles)
  ...lineRing('wall', WALL_R, -90 + WALL_GAP, 270 - WALL_GAP, 60, { height: 4, thickness: 2, seg: 1 }, { color: '#8a8273' }),
  // the thorn hedge on the ditch's outer lip, open where the causeway crosses
  ...lineRing('hedge', HEDGE_R, -90 + HEDGE_GAP, 270 - HEDGE_GAP, 60, { height: 1.8, seg: 1 }, { color: '#3e5a34' }),
  // the low wall round the hall's platform, open only at the head of the stair
  ...parapet(),
  // low stone walls on the lips of the little square on ring A and of the forecourt, on the axis:
  // from the gate the eye runs straight up the hill to the stair and the hall, but the feet are
  // turned aside onto the way and its flights (the banks between the houses can still be climbed)
  ...lineRing('wall', 63.5, -97, -83, 3, { height: 0.9, thickness: 0.6 }, { color: '#a8a294' }),
  ...lineRing('wall', 38.8, -99, -81, 2, { height: 0.9, thickness: 0.6 }, { color: '#a8a294' }),
  // the high stair up the green bank: masonry treads with a landing halfway, carried on its own
  // decks, its cheeks running on past the head to the seats so it is the only way up
  stairAt([STAIR.x, STAIR.foot], [STAIR.x, STAIR.head], { width: 2 * STAIR.half, landing: STAIR.landing, cheeks: 0.9, cheekReach: 0.6 }),
  ...STREAM_AND_FLOWERS,
]
function distribute(all: At[]): At[] {
  const rest: At[] = []
  for (const p of all) {
    let best: Spot | null = null
    let bd = Infinity
    for (const s of spots) {
      const d = Math.hypot(p.at[0] - s.position[0], p.at[1] - s.position[1])
      if (d < bd) {
        bd = d
        best = s
      }
    }
    if (!best || bd > 140) {
      rest.push(p)
      continue
    }
    const { at, ...q } = p
    ;(best.props ??= []).push({ ...q, offset: [r1(at[0] - best.position[0]), r1(at[1] - best.position[1])] })
  }
  return rest
}
const SCENERY = distribute(FREE)

// ---------------------------------------------------------------------------------------------
// Lanes: road ground (no grass tufts) and the map's roads; they change no heights
// ---------------------------------------------------------------------------------------------
const lanes: Lane[] = [
  // the road from the plain through the ford and up between the mounds to the gate, from 4 m
  // inside the north edge (the nearest she may go); it does not paint over the water
  { points: [[ROAD_X, 4], GATE], width: 6 },
  // the road from the west (toward the Isen), meeting it just above the ford
  { points: [[4, 68], [150, 58], JUNCTION], width: 5 },
  // the paved way inside the walls
  { points: WAY_LINE, width: WAY_W },
  // the paved platform before the doors, from the stair head to the doors (road ground grows no
  // grass tufts; the stone tint comes from the platform spots' `ground`)
  { points: [[C.x - 9, HEAD + 7], [C.x + 9, HEAD + 7]], width: 14 },
  // under the stair's head step, which overhangs the platform's grassy rim: no tufts through it
  { points: [[STAIR.x, HEAD - 1.6], [STAIR.x, HEAD - 0.2]], width: 8.6 },
  // the Harrowdale road: off the gate road below the ford, west through the horse meadows inside
  // the river's bend, then south along the hill's west foot into the mouth of the dale
  { points: [[ROAD_X, 104], [214, 128], [164, 205], [142, 300], [139, 445]], width: 4 },
]

// ---------------------------------------------------------------------------------------------
// Terrain shapes, each written out in full (one object shape per list: see the header)
// ---------------------------------------------------------------------------------------------
const hill = (h: Hill): Required<Hill> => ({ x: h.x, z: h.z, r: h.r, h: h.h, rx: h.rx ?? 1, rot: h.rot ?? 0 })
const flat = (f: Flat): Required<Flat> => ({ x: f.x, z: f.z, r: f.r, h: f.h ?? BASE, strength: f.strength ?? 1 })
const river = (r: River): Required<River> => ({ points: r.points, width: r.width, depth: r.depth, bank: r.bank ?? 7, valley: r.valley ?? { width: 1, depth: 0 } })

const HILLS: Hill[] = [
  // the hill of Edoras
  { x: C.x, z: C.z, r: HILL.r, h: HILL.h },
  // a low swell under the causeway, so the road climbs to the gate at about 1:2 instead of up the
  // face of the rampart (ring B's rim blends toward it rather than toward the meadow)
  { x: GATE[0], z: r1(GATE[1] - 7), r: 10, h: 4, rx: 1.6, rot: Math.PI / 2 },
  // the White Mountains: a wall along the south edge, broken where Harrowdale opens in the
  // south-west, and the mountains west of the dale
  { x: 340, z: 640, r: 190, h: 150, rx: 1.4, rot: 0 },
  { x: 0, z: 580, r: 160, h: 110 },
  { x: -60, z: 330, r: 170, h: 85 },
  // the Starkhorn at the head of the dale, alone and highest: a steep spire on a broad shoulder,
  // SSW of the crown, seen straight up the dale from the Harrowdale road
  { x: 182, z: 545, r: 62, h: 60 },
  { x: 176, z: 528, r: 45, h: 85 },
  // long low downs closing the open plain to the north, north-west and east (grass, no wood)
  { x: 235, z: -45, r: 95, h: 24, rx: 3.2, rot: 0 },
  { x: -30, z: 40, r: 70, h: 16 },
  { x: 530, z: 300, r: 90, h: 30, rx: 3, rot: Math.PI / 2 },
  ...WEST_MOUNDS,
  ...EAST_MOUNDS,
]
const FLATS: Flat[] = [
  // the crown: the paved platform the hall stands on
  ...CROWN,
  // the terraces, each a chain of flats along its contour (ring B all the way round)
  ...ring(RING1),
  ...ring(RINGA),
  ...ring(RINGB),
  // the ford's approaches, trodden low: land within 17 m of the crossing is levelled at 1 m, so
  // the shallow channel carved after it has banks of under 2 m, and they come out as mud (sand)
  { x: FORD[0], z: FORD[1], r: 30, h: 1, strength: 0.4 },
]
const RIVERS: River[] = [
  // The Snowbourn. Deep reaches (2.2 m, too deep to wade) out of Harrowdale and away east, broken
  // for a wide shallow ford where the road crosses; the ford is its own shallow channel. The deep
  // reaches stop 18 m either side of the road, so their rounded ends leave a 22 m wide wadeable
  // crossing, and their valleys thin out over the ford like a natural sill.
  { points: [[125, 580], [116, 400], [126, 240], [166, 140], [226, 96], [252, 90]], width: 14, depth: 2.2, bank: 6, valley: { width: 30, depth: 2 } },
  { points: [[242, 90], [298, 91]], width: 16, depth: 0.8, bank: 6 },
  { points: [[288, 91], [380, 104], [520, 120]], width: 14, depth: 2.2, bank: 6, valley: { width: 30, depth: 2 } },
  // The dike: a dry ditch on the contour below the wall, broken where the road comes in. The
  // valley does the digging; the channel is disabled (negative depth), as at Bree. Vertices sit a
  // metre out so the chords average DITCH_R.
  { points: arc(C.x, C.z, DITCH_R + 1, -90 + DITCH_GAP, 270 - DITCH_GAP, 16), width: 0.4, depth: -6, bank: 0, valley: { width: 8, depth: 2.6 } },
]

// ---------------------------------------------------------------------------------------------
// The place
// ---------------------------------------------------------------------------------------------
export const def: PlaceDef = {
  id: 'edoras',
  name: 'Edoras',
  parentWorldId: 'middle-earth',
  size: [W, H],
  cell: 2,
  seed: 3019,
  seaLevel: 0,
  palette: {
    sky: '#9cc8ec',
    horizon: '#e6edf2',
    water: '#5a9ccf',
    waterDeep: '#3a74a8',
    sand: '#a89a78',
    grass: '#8fb85a',
    grassDry: '#b4b464',
    grassLush: '#6aa255',
    meadow: '#a6c860',
    forest: '#3f7a45',
    forestDark: '#2c5a3e',
    // steep grass is tinted toward `rock`: a grey-green keeps the terrace banks turf-coloured
    // and still reads as stone on the mountains' steep faces
    rock: '#7f8668',
    rockWarm: '#a08a6c',
    snow: '#f4f4f8',
    ash: '#5b524f',
    marsh: '#6f8f5a',
    road: '#c8b48c',
  },
  base: { height: BASE, roll: 1.2, wavelength: 90 },
  // no wooded rim: the plain is open grass to the horizon, closed by low downs and the mountains
  hills: HILLS.map(hill),
  flats: FLATS.map(flat),
  rivers: RIVERS.map(river),
  ponds: [],
  lanes,
  woods: [
    // willow clumps by the ford, on the damp banks either side
    { x: 236, z: 110, r: 9 },
    { x: 300, z: 76, r: 8 },
    // pines on the mountain feet: the dale's east side under the Starkhorn, and the south wall
    { x: 204, z: 500, r: 30 },
    { x: 335, z: 515, r: 34 },
  ],
  spawn: SPAWN,
  spawnYaw: Math.PI, // looking south over the ford to the hill, the roof and the mountains
  spawnPitch: 0.12, // the default 0.38 puts the hall above the frame from here
  snowline: 115, // only the Starkhorn's top lies under snow
  cameraDistance: 11,
  speedScale: 0.75,
  fog: [200, 760],
  exit: { x: EXIT[0], z: EXIT[1], radius: 7, label: 'The road west' },
  // the exit is on the road west: come back out west of the overworld pin, on open grass (8 m)
  returnOffset: [-26, -22],
  regions: [
    // no mood on the whole map: a region's mood paints over everything inside it
    { id: 'snowbourn-meads', displayName: 'The Fields of the Snowbourn', polygon: [[0, 0], [W, 0], [W, H], [0, H]], label: [390, 50] },
    // willows by the ford only
    { id: 'the-snowbourn', displayName: 'The Snowbourn', polygon: [[222, 60], [320, 60], [320, 122], [222, 122]], label: [246, 82], mood: 'willow' },
    { id: 'barrowfield', displayName: 'The Barrowfield', polygon: [[232, 106], [308, 106], [308, 222], [232, 222]], label: [ROAD_X, 150] },
    { id: 'the-walls', displayName: 'The Walls of Edoras', polygon: [[250, 220], [290, 220], [290, 244], [250, 244]] },
    { id: 'edoras-town', displayName: 'Edoras', polygon: arc(C.x, C.z, WALL_R + 1, -180, 180, 20).slice(0, 20), label: polar(68, -40) },
    { id: 'meduseld', displayName: 'Meduseld', polygon: platformOutline(-1.4, 24).map(([x, z]): [number, number] => [r1(x), r1(z)]), label: [C.x - 20, 360] },
    { id: 'harrowdale', displayName: 'The Mouth of Harrowdale', polygon: [[40, 390], [200, 390], [200, H], [40, H]], label: [100, 470], mood: 'pine' },
    { id: 'white-mountains', displayName: 'The Feet of the White Mountains', polygon: [[200, 470], [W, 470], [W, H], [200, H]], label: [380, 505], mood: 'pine' },
  ],
  spots,
  props: [
    ...SCENERY,
    // the way out, on the road west
    { kind: 'gateArch', at: EXIT, rotation: 1.45, params: { width: 3.8, ring: 3 } },
  ],
}
