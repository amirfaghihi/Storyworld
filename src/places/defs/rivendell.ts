/**
 * Rivendell (Imladris) at walking scale: the hidden valley and the Last Homely House, the fourth
 * place you can enter. Written from The Hobbit and The Lord of the Rings in our own words and our
 * own shapes; nothing is taken from Tolkien's maps or paintings, a film's sets or any published
 * illustration.
 *
 * The thresholds, south to north (+z is south, so the walk runs toward smaller z):
 *  1. THE MOOR. She arrives on open heather at 76 m, 75 m back from the lip. The far side of the
 *     cleft is moor at the same height, so the land reads as one upland. Small low clusters of white
 *     stones lead north; a sudden dry gully crosses the way.
 *  2. THE BRINK. The stones end at a weathered standing stone and a notch cut into a sudden lip: a
 *     ledge on a sheer rock band 60 m tall, with the roofs of the house far below across the water.
 *  3. THE ZIGZAG. A bench path cut into that band, FOUR legs of 55 m and THREE hairpins, is the only
 *     way down or up (the band is too steep to climb or cross anywhere else: grade 2.4-2.5).
 *  4. THE SINGING WOODS. Below the band a gentle apron of beech and oak (mood `beech`) falls to the
 *     river, with lanterns along the path. Upstream the apron widens into the birch glade.
 *  5. THE NARROW BRIDGE. One slim stone span, 19 m, 2 m wide, no parapet (a low kerb only), over
 *     the deep, loud Bruinen (2.2 m: too deep to wade, so the bridge is the only crossing).
 *  6. THE HOUSE. From the landing, flight A climbs to the long terrace walk and flight B to the
 *     house shelf: the long front range with its door to the river; Bilbo's own low room at the
 *     south-west corner; Elrond's hall and the Hall of Fire facing each other across a wide paved
 *     passage, the fire burning between carved pillars inside; the east wing ending in the open east
 *     porch with its benches; the guest rooms a storey up the slope beside a small fall; the high
 *     garden, from which the brook falls again over the shelf's lip.
 *  7. THE SEAT IN THE ROCK. A garden path climbs to a seat hewn into a rock niche at a turn of the
 *     path, under the pinewoods, looking back over the whole descent.
 *
 * TERRAIN (a smoothstep "node" profile across the valley). The moor is the base height. Every
 * valley line is a dry River valley (negative depth) offset from the river's line by a multiple of
 * NODE = 36 m, each with valley width NODE, so neighbouring lines form an exact partition: across
 * the valley the ground runs from one node height to the next as a smoothstep, level at each node.
 *   south: river 1.5 m (v 0) -> apron 16 (v +36) -> moor 76 (v +72): the apron slope is gentle
 *          (walkable, wooded); the second interval is the cliff (formula grade 2.5, measured 2.4-2.5).
 *   north: river -> 16 (v -36: the house shelf) -> 20 -> 28 -> 44 -> 62 -> moor 76 (v -216): a long
 *          walkable slope (grades 0.2-0.75) that trees can grow on, pines above 28 m.
 * Outer lines end sooner than inner ones, so up- and down-stream the valley narrows to a gorge.
 *
 * THE HOUSE is built from Rivendell's own kinds (src/dressing/kinds/): every range is a `wing`
 * (pale dressed stone, round-headed windows lit at night, low hipped slate roofs; Elrond's hall
 * carries a small bell-cote, the Hall of Fire is enterable and dim, lit by a `hearth` between two
 * pillars and smoking through a louvre), the east porch is a `colonnade` of plain square piers under
 * a lean-to roof, and the house brook drops twice as a short `waterfall`. The bridge is a slim
 * `bridge {width, parapets: false, kerb}`, the lamps are pale `lamp {height, post, style}` posts and
 * hung lanterns, and the woods take the moods `beech`, `birch` and `autumn`. The whole place breathes
 * the silver air and fair weather of the house (`air`), and on the zigzag the camera rises over the
 * bench rather than closing in on her (`cameraCrane`).
 */
import type { PlaceDef, Flat, Hill, Lane, River, Spot } from '../types'
import type { Prop } from '@/world/schema'

const W = 480
const H = 520
/** the moor, both sides of the cleft */
const MOOR = 76

type P = Partial<Prop>
type At = P & { at: [number, number] }

const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100
const r3 = (v: number) => Math.round(v * 1000) / 1000
const HALF_PI = Math.PI / 2
/** A small deterministic hash in [0, 1) (never Math.random). */
const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}
const sm = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
function lineDist(pts: [number, number][], x: number, z: number): number {
  let best = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1]
    const vx = bx - ax, vz = bz - az
    const L2 = vx * vx + vz * vz || 1
    const t = Math.min(1, Math.max(0, ((x - ax) * vx + (z - az) * vz) / L2))
    best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t)))
  }
  return best
}

// ---------------------------------------------------------------------------------------------
// The valley: the river's line and the node lines offset from it
// ---------------------------------------------------------------------------------------------

/** The Bruinen's line, west to east (it flows west), 40 m past both edges. Straight at z 236 under the house. */
const RL: [number, number][] = [[-40, 262], [40, 250], [120, 239], [180, 236], [300, 236], [360, 233], [420, 226], [520, 212]]
const RIVER_Z = 236
/** node spacing across the valley, and every valley line's width */
const NODE = 36
/** the river line's own height (the wet channel is carved below it) */
const FLOOR = 1.5

/** The line `v` metres to the south (+) or north (-) of a polyline, mitred at its vertices. */
function offset(line: [number, number][], v: number): [number, number][] {
  return line.map((p, i) => {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)]
    let tx = b[0] - a[0], tz = b[1] - a[1]
    const l = Math.hypot(tx, tz)
    tx /= l
    tz /= l
    let k = 1
    if (i > 0 && i < line.length - 1) {
      const ux = p[0] - a[0], uz = p[1] - a[1], wx = b[0] - p[0], wz = b[1] - p[1]
      const c = (ux * wx + uz * wz) / (Math.hypot(ux, uz) * Math.hypot(wx, wz))
      k = 1 / Math.cos(Math.acos(Math.max(-1, Math.min(1, c))) / 2)
    }
    return [r1(p[0] - tz * v * k), r1(p[1] + tx * v * k)]
  })
}
/** The part of a west-to-east line between x0 and x1. */
function clip(line: [number, number][], x0: number, x1: number): [number, number][] {
  const out: [number, number][] = []
  const cut = (a: [number, number], b: [number, number], x: number): [number, number] => [r1(x), r1(a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]))]
  for (let i = 0; i < line.length; i++) {
    const p = line[i]
    const prev = line[i - 1]
    if (prev && prev[0] < x0 && p[0] > x0) out.push(cut(prev, p, x0))
    if (p[0] >= x0 && p[0] <= x1) out.push(p)
    if (prev && prev[0] < x1 && p[0] > x1) out.push(cut(prev, p, x1))
  }
  return out
}
/** Node heights across the valley (v: metres south of the river line) and how far each line runs. */
const NODES: { v: number; h: number; x0: number; x1: number }[] = [
  // the apron and the shelf run off both edges (like the river line), so a fall off either moor's
  // lip anywhere lands on ground that walks back to the house or the zigzag: no pockets in the gorges
  { v: NODE, h: 16, x0: -40, x1: 520 }, //      the apron under the south cliff
  { v: -NODE, h: 16, x0: -40, x1: 520 }, //     the house shelf
  { v: -2 * NODE, h: 20, x0: 80, x1: 405 },
  { v: -3 * NODE, h: 28, x0: 95, x1: 390 },
  { v: -4 * NODE, h: 44, x0: 110, x1: 375 },
  { v: -5 * NODE, h: 62, x0: 125, x1: 360 },
]
const VALLEYS: River[] = [
  // the river's line carries the deepest valley; its wet channel is a separate River below
  { points: RL, width: 0.4, depth: -6, bank: 0, valley: { width: NODE, depth: MOOR - FLOOR } },
  ...NODES.map((n): River => ({ points: clip(offset(RL, n.v), n.x0, n.x1), width: 0.4, depth: -6, bank: 0, valley: { width: NODE, depth: MOOR - n.h } })),
]
/**
 * A sudden dry gully across the moor, which the white stones cross (the book's moor of sudden
 * gullies and boggy hollows): 7 m wide, 2.4 m deep, gentle enough to walk through (grade ~0.5).
 */
const GULLY: [number, number][] = [[150, 368], [205, 362], [252, 356], [300, 361], [352, 356]]
const GULLY_RIVER: River = { points: GULLY, width: 0.4, depth: -6, bank: 0, valley: { width: 7, depth: 2.4 } }

/** The ground before flats, without the base roll (+-1 m): what the switchbacks and flats are cut against. */
function natural(x: number, z: number): number {
  let h = MOOR
  for (const r of [...VALLEYS, GULLY_RIVER]) h -= r.valley!.depth * (1 - sm(lineDist(r.points, x, z) / r.valley!.width))
  for (const hl of MOUNTAINS) {
    const d = Math.hypot(x - hl.x, z - hl.z) / hl.r
    if (d < 1) h += hl.h * sm(1 - d)
  }
  return h
}

/** The peaks at the valley head, east: they carry snow (snowline 95) and frame the porch's view. */
const MOUNTAINS: Hill[] = [
  { x: 452, z: 70, r: 120, h: 85 },
  { x: 458, z: 402, r: 125, h: 92 },
  // a lower shoulder north of the gorge mouth and one on the far north rim (the pine heights)
  { x: 330, z: -20, r: 90, h: 14 },
  { x: 120, z: -10, r: 80, h: 10 },
]

// ---------------------------------------------------------------------------------------------
// The zigzag: switchbacks cut into the south cliff as a bench of flats (a separated-hairpin
// recipe: legs on the contour of their own height, pushed apart near each hairpin
// by RT, joined by a level crossing). Four legs of 55 m: the centre lines of two stacked legs stand
// 2 D / G - 2 RT apart (D = drop per leg 13.7 m, G = 2.5), so RT = 2.5 leaves 6 m for two r 4
// benches (2.7 m half-cores each).
// ---------------------------------------------------------------------------------------------
const ZIG = {
  /** the legs run between these x (the hairpins), starting at the east end */
  xa: 211,
  xb: 266,
  top: 72,
  foot: 17.25,
  legs: 4,
  /** hairpin half-separation */
  rt: 2.5,
  /** the cliff's grade (formula) */
  g: (1.5 * (MOOR - 16)) / NODE,
}
/** path grade: four legs of (xb - xa) between top and foot */
const ZIG_PG = (ZIG.top - ZIG.foot) / (ZIG.legs * (ZIG.xb - ZIG.xa))
/** z on the south cliff where the natural ground at x stands at h (bisection; the cliff rises southward). */
function cliffZ(x: number, h: number): number {
  let lo = 262, hi = 318
  for (let k = 0; k < 40; k++) {
    const m = (lo + hi) / 2
    if (natural(x, m) < h) lo = m
    else hi = m
  }
  return (lo + hi) / 2
}
const ZIG_PTS: [number, number, number][] = (() => {
  const legLen = ZIG.xb - ZIG.xa
  const LS = (ZIG.rt * ZIG.g) / ZIG_PG
  const legs: { h0: number; h1: number; x0: number; dir: number }[] = []
  let h = ZIG.top, x = ZIG.xb, dir = -1
  for (let k = 0; k < ZIG.legs; k++) {
    const h1 = k === ZIG.legs - 1 ? ZIG.foot : h - ZIG_PG * legLen
    legs.push({ h0: h, h1, x0: x, dir })
    x += dir * legLen
    h = h1
    dir = -dir
  }
  const pts: [number, number, number][] = []
  legs.forEach((g, k) => {
    const L = legLen
    const n = Math.max(1, Math.round(L / 2))
    for (let i = 0; i <= n; i++) {
      if (i === 0 && k > 0) continue // the crossing already ends here
      const s = (L * i) / n
      const hh = g.h0 - ((g.h0 - g.h1) * s) / L
      const px = g.x0 + g.dir * s
      let off = 0
      if (k > 0) off -= ZIG.rt * Math.max(0, 1 - s / LS) // leaving the turn above: downhill (north)
      if (k < legs.length - 1) off += ZIG.rt * Math.max(0, 1 - (L - s) / LS) // arriving at the turn below: uphill (south)
      pts.push([r1(px), r1(cliffZ(px, hh) + off), r2(hh)])
    }
    if (k < legs.length - 1) {
      const last = pts[pts.length - 1]
      pts.push([last[0], r1(cliffZ(last[0], g.h1) - ZIG.rt), last[2]])
    }
  })
  return pts
})()
/** A polyline of [x, z, h] resampled every `step` metres of its length (both ends kept). */
function densify(pts: [number, number, number][], step: number): [number, number, number][] {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const total = cum[cum.length - 1]
  const n = Math.max(1, Math.round(total / step))
  const out: [number, number, number][] = []
  let j = 1
  for (let k = 0; k <= n; k++) {
    const d = (total * k) / n
    while (j < pts.length - 1 && cum[j] < d) j++
    const t = (d - cum[j - 1]) / (cum[j] - cum[j - 1] || 1)
    const [ax, az, ah] = pts[j - 1], [bx, bz, bh] = pts[j]
    out.push([r1(ax + (bx - ax) * t), r1(az + (bz - az) * t), r2(ah + (bh - ah) * t)])
  }
  return out
}
const ZIG_HEAD = ZIG_PTS[0]
const ZIG_FOOT = ZIG_PTS[ZIG_PTS.length - 1]
/** the hairpin crossings (for the zigzag spot and the walk test) */
const HAIRPINS: [number, number][] = ZIG_PTS.filter((p, i) => i > 0 && i < ZIG_PTS.length - 1 && p[0] === ZIG_PTS[i - 1][0] && p[2] === ZIG_PTS[i - 1][2]).map((p) => [p[0], p[1]])

// ---------------------------------------------------------------------------------------------
// The crossing and the house: levels and outlines (world coordinates; the river runs along
// z = 236 here, so v = z - 236)
// ---------------------------------------------------------------------------------------------
/** the narrow bridge: 19 m, so its ends sit just outside the wet channel (width/2 + bank = 9 m) */
const BRIDGE = { x: 232, z: RIVER_Z, length: 19, width: 2.0, arc: 0.065, kerb: 0.2 }
const BRIDGE_S = r1(BRIDGE.z + BRIDGE.length / 2)
const BRIDGE_N = r1(BRIDGE.z - BRIDGE.length / 2)
const HEADS = { south: 249.5, north: 221 }
const LEVEL = { heads: 5, t1: 11, shelf: 17.5, upper: 21 }
/** the terrace walk's band (z), the shelf's front lip (z) and the landing's band */
const T1 = { z0: 202, z1: 215, x0: 198, x1: 338 }
const LIP = 201.2
/** the lip walls stand on the level cores, half a metre back from where the drawn ground breaks */
const LIP_WALL = 199.5
const T1_WALL = 213.5
const LANDING_WALL = 226.35
const LANDING = { z0: 217, z1: 226.6, x0: 214, x1: 250 }
/** the two flights: bridge landing -> terrace walk, terrace walk -> front court */
const FLIGHT_A = { x: BRIDGE.x, foot: 224.4, head: 212.6, width: 3 }
const FLIGHT_B = { x: 245, foot: 210.3, head: 199.8, width: 3.4 }

/** The buildings: centres and full extents (w across local x, L along the ridge). */
const RANGE = { x: 245, z: 186, w: 12, L: 46 } //              the long front range, ridge E-W, door south
const WEST = { x: 213, z: 177, w: 10, L: 14 } //                the west wing, ridge N-S, door east
const BILBO = { x: 212, z: 191.5, w: 6, L: 8 } //               Bilbo's own low room, ridge E-W, door + low window south
const HALL = { x: 228, z: 162, w: 15, L: 24 } //                Elrond's hall, ridge N-S, doors EAST onto the passage
const FIRE = { x: 256, z: 164, w: 14, L: 20 } //                the Hall of Fire, ridge N-S, doors WEST onto the passage
const EASTW = { x: 282, z: 182, w: 12, L: 18 } //               the east wing, ridge E-W, doors east onto the porch
const PORCH = { x: 294.7, z: 182, length: 12, depth: 7 } //     the open east porch (colonnade), front to the east
const UPPER = { x: 306, z: 145, w: 10, L: 22 } //             the guest rooms a storey up the slope, ridge E-W
/** the hearth in the Hall of Fire, against its east wall, between two carved pillars */
// its back slab (1.2 m deep) meets the inner face of the 0.6 m east wall, so nobody walks behind the fire
const HEARTH = { x: FIRE.x + FIRE.w / 2 - 0.6 - 0.6 - 0.4, z: 164 }
/** the passage ("wide passage") between the two halls' doors */
const PASSAGE_X = r1((HALL.x + HALL.w / 2 + FIRE.x - FIRE.w / 2) / 2)
/** the seat hewn in a rock niche at the turn of the garden path */
const SEAT = { x: 340, z: 136.2, h: 22.8 }
/** the two falls of the house brook: beside the guest rooms, and over the shelf's front lip */
const FALL_UPPER = { x: 322.5, lipZ: 156.4, footZ: 159.0 }
const FALL_LIP = { x: 338, lipZ: 200.4, footZ: 203.0 }
const SPAWN: [number, number] = [240, 385]
const EXIT: [number, number] = [40, 474]
const BRINK: [number, number] = [r1(ZIG_HEAD[0] + 0.5), r1(ZIG_HEAD[1] + 1.5)]
/** the path from the zigzag's foot through the woods to the bridge, and its branch upstream to the glade */
const WOODS_PATH: [number, number][] = [[260, 270], [250, 264], [240, 257], [234, 252.5]]
const GLADE_PATH: [number, number][] = [[272, 270], [306, 267], [340, 262], [366, 256]]
/** the white stones: the faint way from the spawn to the notch, crossing the gully */
const STONE_LINE: [number, number][] = [SPAWN, [248, 368], [253, 356], [258, 344], [265, 326]]
/** the notch: the path leaves the moor straight north, cut down into the brow, onto the face */
const NOTCH: [number, number, number][] = [[ZIG.xb, 317, MOOR], [ZIG.xb, r1(ZIG_PTS[0][1] + 0.5), ZIG.top]]

/**
 * A level band along x: a chain of equal flats whose cores (0.55 r + 0.5) overlap into a band
 * `band` deep about z = zc (exactly `band` midway between centres), as Edoras's ring() does along
 * an arc.
 */
function strip(x0: number, x1: number, zc: number, band: number, h: number, spacing: number, strength = 1): Flat[] {
  const n = Math.max(1, Math.round((x1 - x0) / spacing))
  const core = Math.hypot(band / 2, (x1 - x0) / n / 2)
  const r = r1((core - 0.5) / 0.55)
  return Array.from({ length: n + 1 }, (_, i): Flat => ({ x: r1(x0 + ((x1 - x0) * i) / n), z: zc, r, h, strength }))
}
/** A grid of equal flats whose cores overlap everywhere inside the rectangle. */
function block(x0: number, x1: number, z0: number, z1: number, h: number, spacing: number, strength = 1): Flat[] {
  const nx = Math.max(1, Math.round((x1 - x0) / spacing)), nz = Math.max(1, Math.round((z1 - z0) / spacing))
  const sx = (x1 - x0) / nx, sz = (z1 - z0) / nz
  const r = r1((Math.hypot(sx / 2, sz / 2) + 0.6 - 0.5) / 0.55)
  const out: Flat[] = []
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) out.push({ x: r1(x0 + sx * i), z: r1(z0 + sz * j), r, h, strength })
  return out
}

const HOUSE_FLATS: Flat[] = [
  // the house shelf: the buildings, the courts and the high garden east of the porch
  ...block(206, 300, 150, 186, LEVEL.shelf, 19),
  ...block(300, 334, 166, 186, LEVEL.shelf, 14, 0.6),
  // its straight front lip (z = 201), from Bilbo's garden to the high garden's end
  ...strip(200, 336, LIP - 4.6, 8, LEVEL.shelf, 8.5),
  // the terrace walk below it, and the bridge landing below that
  ...strip(T1.x0, T1.x1, (T1.z0 + T1.z1) / 2, T1.z1 - T1.z0, LEVEL.t1, 10, 0.6),
  ...strip(LANDING.x0, LANDING.x1, (LANDING.z0 + LANDING.z1) / 2, LANDING.z1 - LANDING.z0, LEVEL.heads, 6, 0.6),
  // the south bridge head
  { x: BRIDGE.x, z: HEADS.south, r: 6, h: LEVEL.heads, strength: 0.6 },
  // the guest rooms' terrace, a storey above the shelf (later than the shelf, so its core wins);
  // it meets the shelf in a sheer 3.5 m step on the south, where the brook falls
  ...block(294, 320, 138, 150, LEVEL.upper, 9),
  // the seat's niche: cut 3 m into the north slope, so its back face is steep enough to be painted
  // as rock (snowline pass) and the seat stands hewn into it
  { x: SEAT.x, z: SEAT.z + 1.6, r: 5, h: SEAT.h, strength: 1 },
]
/** The bench: flats every ZIG_STEP m of path, each at the path's height there. */
const ZIG_STEP = 2.5
const ZIG_R = 4
const ZIG_FLATS: Flat[] = [...densify(NOTCH, 3), ...densify(ZIG_PTS, ZIG_STEP)].map(([x, z, h]) => ({ x, z, r: ZIG_R, h, strength: 1 }))

// ---------------------------------------------------------------------------------------------
// Line pieces
// ---------------------------------------------------------------------------------------------
/** Wall pieces along a straight run from a to b, each overlapping the next by 0.3 m. */
function wallRun(a: [number, number], b: [number, number], params: Record<string, unknown>, color = '#b5ad9e', piece = 10): At[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const n = Math.max(1, Math.ceil(len / piece))
  const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len
  return Array.from({ length: n }, (_, i): At => {
    const e0 = i === 0 ? 0 : 0.3, e1 = i === n - 1 ? 0 : 0.3
    const s0 = (len * i) / n - e0, s1 = (len * (i + 1)) / n + e1
    const m = (s0 + s1) / 2
    return { kind: 'wall', at: [r2(a[0] + ux * m), r2(a[1] + uz * m)], rotation: r3(Math.atan2(-uz, ux)), color, params: { length: r2(s1 - s0), seg: 1, ...params } }
  })
}
/** A stair's origin is its foot and it climbs toward local -z. */
const stairAt = (foot: [number, number], head: [number, number], params: Record<string, unknown>): At => ({
  kind: 'stair',
  at: foot,
  rotation: r3(Math.atan2(foot[0] - head[0], foot[1] - head[1])),
  params: { run: r1(Math.hypot(head[0] - foot[0], head[1] - foot[1])), ...params },
})
/** Brook pieces (`channel {kerb: 0}`) along a polyline, at most `piece` metres, mitred at the turns. */
function brook(pts: [number, number][], width = 1.0, piece = 6): At[] {
  const out: At[] = []
  const head = (a: [number, number], b: [number, number]) => Math.atan2(b[1] - a[1], b[0] - a[0])
  const turn = (h0: number, h1: number) => r3(Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)))
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    const n = Math.max(1, Math.ceil(len / piece))
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n
      const jIn = k === 0 && i > 0 ? turn(head(pts[i - 1], pts[i]), head(pts[i], pts[i + 1])) : undefined
      const jOut = k === n - 1 && i < pts.length - 2 ? turn(head(pts[i], pts[i + 1]), head(pts[i + 1], pts[i + 2])) : undefined
      out.push({
        kind: 'channel',
        at: [r1(ax + (bx - ax) * t), r1(az + (bz - az) * t)],
        rotation: r3(Math.atan2(-(bz - az), bx - ax)),
        params: { length: r1(len / n + 0.2), width, kerb: 0, kerbHeight: 0.06, drop: 0.03, water: '#86b4cc', ...(jIn !== undefined ? { joinIn: jIn } : {}), ...(jOut !== undefined ? { joinOut: jOut } : {}) },
      })
    }
  }
  return out
}
/** The Elves' lamps: pale stone posts with a warm light, or a lantern hung from an arm (style 'hang'). */
const lamp = (x: number, z: number, extra: Record<string, unknown> = {}): At => ({ kind: 'lamp', at: [r2(x), r2(z)], color: '#ffe6b0', params: { height: 3.2, post: '#c9c6bd', ...extra } })
/** A plain stone bench (existing `seat` with params). */
const bench = (x: number, z: number, rot: number, width: number, stone = '#b5ad9e', back = 1.0): At => ({ kind: 'seat', at: [r2(x), r2(z)], rotation: r3(rot), params: { width, depth: 0.6, seatHeight: 0.45, back, arms: false, stone } })

// ---------------------------------------------------------------------------------------------
// What stands where
// ---------------------------------------------------------------------------------------------
const PALE = '#e6e0d0'
const PALE2 = '#ddd6c4'
const SLATE = '#6d8aa8'
const TRIM = '#b9b2a2'
const STONE = '#bdb6a6'
const CAP = '#d2ccbe'
const WALL_PARAMS = { level: true, height: 1.0, thickness: 0.5, cap: CAP }

/**
 * A range of the house: a `wing` of `storeys` x `storeyHeight` under a low hipped slate roof, its
 * door (and Bilbo's low window) on the face `door` of the wing's own frame.
 */
function wing(c: { x: number; z: number; w: number; L: number }, rot: number, o: { storeys?: number; storeyHeight?: number; door: '+x' | '+z'; doorWidth?: number; lowWindow?: boolean; bellcote?: boolean; windows?: number; wall?: string; pitch?: number }): At {
  return {
    kind: 'wing',
    at: [c.x, c.z],
    rotation: r3(rot),
    params: {
      width: c.w, length: c.L, storeys: o.storeys ?? 2, storeyHeight: o.storeyHeight ?? 3.4, roof: 'hip', pitch: o.pitch ?? 0.3, eaves: 1.0,
      doors: o.door, doorWidth: o.doorWidth ?? 2.4, doorsOpen: true, windows: o.windows ?? 4, lowWindow: o.lowWindow ? o.door : '', bellcote: !!o.bellcote,
      wall: o.wall ?? PALE, roofColor: SLATE, trim: TRIM, plinthColor: STONE, glow: '#ffd890',
    },
  }
}

/** The Hall of Fire: an enterable `wing` (walls, a doorway on the passage, a roof box; dim inside) and its hearth. */
const FIRE_DOOR = { z: FIRE.z, width: 2.8 }
const HALL_OF_FIRE: At[] = [
  {
    kind: 'wing',
    at: [FIRE.x, FIRE.z],
    rotation: 0,
    params: { width: FIRE.w, length: FIRE.L, storeys: 1, storeyHeight: 6.4, roof: 'hip', pitch: 0.3, eaves: 1.0, enter: '-x', doors: '-x', doorWidth: FIRE_DOOR.width, doorsOpen: true, windows: 0, louvres: 1, wall: PALE2, roofColor: SLATE, trim: TRIM, plinthColor: STONE, glow: '#ffb860' },
  },
  // the fire on its raised bed against the east wall, between two banded pillars
  { kind: 'hearth', at: [HEARTH.x, HEARTH.z], rotation: -HALF_PI, params: { length: 2.4, depth: 1.2, kerb: 0.35, pillars: 2, pillarHeight: 3.2 } },
]

/**
 * The east porch: a `colonnade` of plain square piers under a lean-to slate roof, open to the east,
 * its closed north end making the darker back corner.
 */
const PORCH_X0 = PORCH.x - PORCH.depth / 2, PORCH_X1 = PORCH.x + PORCH.depth / 2
const PORCH_Z0 = PORCH.z - PORCH.length / 2, PORCH_Z1 = PORCH.z + PORCH.length / 2
const EAST_PORCH: At[] = [
  { kind: 'colonnade', at: [PORCH.x, PORCH.z], rotation: HALF_PI, params: { length: PORCH.length, depth: PORCH.depth, height: 3.6, spacing: 2.85, roof: 'lean', endWall: '+x', steps: true, stone: '#d8d2c2', roofColor: SLATE } },
  // plain stone benches set round where the Council sat, backs to the wing; no ring of carved
  // chairs. The back two stand either side of the east wing's door, leaving it clear.
  bench(PORCH_X0 + 0.7, PORCH.z - 2.6, HALF_PI, 1.6, '#cfc8b8', 1.0),
  bench(PORCH_X0 + 0.7, PORCH.z + 2.6, HALF_PI, 1.6, '#cfc8b8', 1.0),
  bench(PORCH.x + 0.5, PORCH_Z0 + 1.1, 0, 3, '#cfc8b8', 1.0),
  bench(PORCH.x + 0.5, PORCH_Z1 - 1.0, Math.PI, 3, '#cfc8b8', 1.0),
]

/** A short sheer fall of the house brook: two strands over a cut lip stone into a small ringed pool. */
const fall = (f: { x: number; lipZ: number; footZ: number }, width: number): At[] => [{ kind: 'waterfall', at: [f.x, f.lipZ], rotation: 0, params: { width, lean: 0.6, strands: 2, pool: 1.4 } }]

/** The white stones: small low clusters beside the faint track, and one weathered stone at the notch. */
const WHITE_STONES: At[] = (() => {
  const out: At[] = []
  let k = 0
  for (let i = 0; i < STONE_LINE.length - 1; i++) {
    const [ax, az] = STONE_LINE[i], [bx, bz] = STONE_LINE[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    const n = Math.max(1, Math.round(len / 10))
    for (let j = 0; j < n; j++) {
      const t = (j + 0.4 + 0.3 * hash(k, 3)) / n
      // each cluster sits a little off the line, alternately left and right, so the line reads as found
      const side = (k % 2 ? 1 : -1) * (2.0 + 1.0 * hash(k, 7))
      const nx = -(bz - az) / len, nz = (bx - ax) / len
      out.push({ kind: 'stones', at: [r1(ax + (bx - ax) * t + nx * side), r1(az + (bz - az) * t + nz * side)], color: '#ebe8de', params: { count: 2 + Math.floor(hash(k, 11) * 3), size: 0.35 } })
      k++
    }
  }
  // the last mark before the brink: one weathered standing stone at the head of the notch
  out.push({ kind: 'standingStone', at: [ZIG.xb + 2.6, 319], rotation: 0.4, color: '#dcd8cc', params: { height: 1.5 } })
  return out
})()

const FREE: At[] = [
  ...WHITE_STONES,

  // ---- the bridge: one slim span, no parapet, a low stone kerb, its ends flush with the banks ----
  { kind: 'bridge', at: [BRIDGE.x, BRIDGE.z], rotation: r3(HALF_PI), color: '#c9c2b2', params: { length: BRIDGE.length, arc: BRIDGE.arc, width: BRIDGE.width, parapets: false, kerb: BRIDGE.kerb } },
  // lanterns at both heads (the Elves bring lanterns down to the bank)
  lamp(BRIDGE.x - 3.2, BRIDGE_S + 2.2), lamp(BRIDGE.x + 3.2, BRIDGE_S + 2.2),
  lamp(BRIDGE.x - 4.2, FLIGHT_A.foot - 1.2), lamp(BRIDGE.x + 4.2, FLIGHT_A.foot - 1.2),

  // ---- the flights and the lips ----
  stairAt([FLIGHT_A.x, FLIGHT_A.foot], [FLIGHT_A.x, FLIGHT_A.head], { width: FLIGHT_A.width, cheeks: 0.7, riser: 0.24, stone: STONE, cheekStone: '#aaa496' }),
  stairAt([FLIGHT_B.x, FLIGHT_B.foot], [FLIGHT_B.x, FLIGHT_B.head], { width: FLIGHT_B.width, cheeks: 0.7, riser: 0.24, stone: STONE, cheekStone: '#aaa496' }),
  // the shelf's lip, open only at the head of flight B (the wall ends against its cheeks)
  ...wallRun([200, LIP_WALL], [FLIGHT_B.x - FLIGHT_B.width / 2 - 0.6, LIP_WALL], WALL_PARAMS),
  ...wallRun([FLIGHT_B.x + FLIGHT_B.width / 2 + 0.6, LIP_WALL], [336, LIP_WALL], WALL_PARAMS),
  // the terrace walk's river lip, open only at the head of flight A
  ...wallRun([T1.x0 + 2, T1_WALL], [FLIGHT_A.x - FLIGHT_A.width / 2 - 0.6, T1_WALL], WALL_PARAMS),
  ...wallRun([FLIGHT_A.x + FLIGHT_A.width / 2 + 0.6, T1_WALL], [T1.x1 - 2, T1_WALL], WALL_PARAMS),
  // the landing's river lip either side of the bridge's mouth, so nobody steps off the landing's
  // edge beside the abutment (the bank below it is too steep to climb back)
  ...wallRun([LANDING.x0 + 1, LANDING_WALL], [BRIDGE.x - BRIDGE.width / 2 - 0.3, LANDING_WALL], { ...WALL_PARAMS, height: 0.8 }),
  ...wallRun([BRIDGE.x + BRIDGE.width / 2 + 0.3, LANDING_WALL], [LANDING.x1 - 1, LANDING_WALL], { ...WALL_PARAMS, height: 0.8 }),

  // ---- the terrace walk: lamps and plantings ----
  lamp(212, 205), lamp(262, 205), lamp(292, 205), lamp(322, 205),
  bench(284, 211.9, 0, 1.8), bench(316, 211.9, 0, 1.8),
  // specimen trees on the terrace walk: yellow leaves in the autumn of the Council
  { kind: 'bigTree', at: [272, 205.5], scale: 0.75, params: { palette: 'golden' } },
  { kind: 'bigTree', at: [206, 205.5], scale: 0.7, params: { palette: 'golden' } },
  { kind: 'flowerPatch', at: [208, 210], params: { radius: 3.5, count: 50, colors: '#f2efe6,#e8d8f0,#f6e7a8', side: 'south' } },
  { kind: 'flowerPatch', at: [278, 210], params: { radius: 3.5, count: 50, colors: '#f2efe6,#f3c9c0,#f6e7a8', side: 'south' } },
  { kind: 'flowerPatch', at: [312, 210], params: { radius: 3.5, count: 50, colors: '#f2efe6,#e8d8f0,#cfe0f4', side: 'south' } },

  // ---- the high garden east of the porch, above the steep bank ----
  { kind: 'flowerPatch', at: [312, 190], params: { radius: 5, count: 90, colors: '#f2efe6,#e8d8f0,#f6e7a8,#f3c9c0' } },
  { kind: 'flowerPatch', at: [316, 176], params: { radius: 4, count: 60, colors: '#f2efe6,#cfe0f4,#f6e7a8' } },
  { kind: 'bigTree', at: [328, 192], scale: 0.8, params: { palette: 'golden' } },
  lamp(300, 196), lamp(332, 196),

  // ---- the Elves' lanterns along the woods path and the glade path (posts and hung lanterns; no tree platforms) ----
  lamp(263.5, 272.5, { style: 'hang' }), lamp(252.5, 267.5), lamp(242.5, 260.5, { style: 'hang' }),
  lamp(GLADE_PATH[1][0], GLADE_PATH[1][1] + 2.6), lamp(GLADE_PATH[3][0] + 2, GLADE_PATH[3][1] + 4, { style: 'hang' }),
  { kind: 'bigTree', at: [392, 250], scale: 0.7, params: { palette: 'golden' } },
  // the birch glade's white sward
  { kind: 'flowerPatch', at: [374, 252], params: { radius: 12, count: 200, colors: '#f6f4ec,#efe8d2,#ffffff' } },
  // the signpost where the track leaves for the Road
  { kind: 'signpost', at: [EXIT[0] + 6, EXIT[1] - 4], rotation: 1.2, params: { boards: 2 } },

  // ---- the house brook: down the north slope past the guest rooms, a small fall onto the shelf
  // beside them (Frodo's waterfall), across the high garden, a second fall over the shelf's lip to
  // the terrace walk, and on to the river ----
  ...brook([[331, 100], [329, 118], [327, 134], [325, 148], [FALL_UPPER.x, FALL_UPPER.lipZ - 0.6]]),
  ...fall(FALL_UPPER, 1.2),
  ...brook([[FALL_UPPER.x, FALL_UPPER.footZ + 0.6], [327, 172], [332, 184], [336, 193], [FALL_LIP.x, FALL_LIP.lipZ - 0.6]]),
  ...fall(FALL_LIP, 1.4),
  ...brook([[FALL_LIP.x, FALL_LIP.footZ + 0.6], [337.5, 214], [336.5, 226]]),
]

// ---------------------------------------------------------------------------------------------
// The house, handed to the spots by distribute()
// ---------------------------------------------------------------------------------------------
const HOUSE: At[] = [
  // the long front range: two storeys, ridge east-west, its two-leaf door in the middle of the south
  // side looking down to the river (rot -pi/2: local +x points south)
  wing(RANGE, -HALF_PI, { door: '+x', doorWidth: 2.4, windows: 8 }),
  // the west wing, door east into the gap toward the range
  wing(WEST, 0, { door: '+x', doorWidth: 1.6, windows: 3, wall: PALE2 }),
  // Bilbo's own room: one low storey at the south-west corner, door and low window to its garden
  wing(BILBO, -HALF_PI, { storeys: 1, storeyHeight: 3.0, door: '+x', doorWidth: 1.2, windows: 1, lowWindow: true, wall: PALE2, pitch: 0.38 }),
  // Elrond's hall: the tallest roof, doors on its east side facing the Hall of Fire across the
  // passage, a small bell-cote on its ridge (the feast bells)
  wing(HALL, 0, { storeys: 1, storeyHeight: 7.5, door: '+x', doorWidth: 3.0, windows: 6, bellcote: true, pitch: 0.34 }),
  ...HALL_OF_FIRE,
  // the bench facing the fire
  bench(HEARTH.x - 4.4, HEARTH.z, HALF_PI, 2.6, '#8a7a62', 1.0),
  // the east wing, its doors in the east gable onto the porch
  wing(EASTW, HALF_PI, { door: '+z', doorWidth: 2.4, windows: 4 }),
  ...EAST_PORCH,
  // the guest rooms, a storey up the slope beside the small fall
  wing(UPPER, -HALF_PI, { door: '+x', doorWidth: 1.6, windows: 6, wall: PALE2 }),
  // the short stair from the high garden up to the guest rooms' terrace
  stairAt([312, 165.6], [312, 156.0], { width: 2.6, cheeks: 0.6, riser: 0.22, stone: STONE, cheekStone: '#aaa496' }),
  // lamps at the front door, the court, the passage and the porch
  lamp(FLIGHT_B.x - 4.2, 197.5), lamp(FLIGHT_B.x + 8.5, 197.5), lamp(219.8, 196.5), lamp(256, 174.9), lamp(PASSAGE_X - 4.5, 174.9), lamp(PORCH_X1 + 0.8, PORCH_Z1 + 0.8),
  // Bilbo's little garden before his low window
  { kind: 'flowerPatch', at: [212, 197], params: { radius: 2.6, count: 36, colors: '#f2efe6,#f6e7a8,#e8d8f0', side: 'south' } },
  // the seat hewn in the rock at the turn of the garden path, its back to the niche's rock face,
  // looking south-west over the roofs, with the pinewoods just above
  { kind: 'seat', at: [SEAT.x, SEAT.z], rotation: r3(Math.atan2(-0.45, 1)), params: { width: 2.4, depth: 0.8, seatHeight: 0.45, back: 1.3, arms: true, armHeight: 0.3, stone: '#9a958a' } },
]

// ---------------------------------------------------------------------------------------------
// The spots (16). Lore in our own words; links to Tolkien Gateway.
// ---------------------------------------------------------------------------------------------

const spots: Spot[] = [
  {
    id: 'white-stones',
    displayName: 'The White Stones',
    type: 'other',
    mapIcon: 'waymark',
    position: [251, 360],
    discoverRadius: 16,
    radius: 60,
    setting:
      'Open heather runs away on every side toward the mountains, with nothing to show that the land is about to break. The only marks are small low clusters of white stones, some furred with moss or half sunk in the heather, picking a way north across a sudden gully and between soft green hollows.',
    ground: { kind: 'rust', blend: 0.35, inner: 0.2 },
    vegetation: { density: 0.15 },
    lore: {
      region: 'high-moor',
      summary:
        'Elrond’s valley cannot be seen from the moor, and it cannot be found by anyone who does not know the marks. These pale stones are the marks. A stranger sees heather and bog; a friend of the house sees a road.',
      storyEvents: [
        {
          book: 'The Hobbit',
          chapter: 'A Short Rest',
          text: 'Gandalf led Thorin’s company slowly from one white stone to the next as the light failed, searching to left and right, while the dwarves grumbled about bogs and gullies and began to wonder whether the wizard had lost his way.',
        },
      ],
      characters: ['Gandalf', 'Bilbo Baggins', 'Thorin'],
      sourceUrl: 'https://tolkiengateway.net/wiki/A_Short_Rest',
    },
  },
  {
    id: 'valley-brink',
    displayName: 'The Brink of the Valley',
    type: 'hill',
    mapIcon: 'hill',
    position: BRINK,
    // discovered at the lip itself, not from the moor behind it
    discoverRadius: 7,
    radius: 16,
    setting:
      'The heather simply stops. A few steps on, the ground drops away into a deep green cleft full of the noise of rushing water and the smell of trees, and far below, across the river, the roofs of a house stand among lamps already lit.',
    ground: { kind: 'rust', blend: 0.3, inner: 0.3 },
    vegetation: { density: 0.3 },
    lore: {
      region: 'high-moor',
      summary:
        'Every traveller sees Rivendell first from here, and nobody sees it coming. Arrivals stop on this edge and stare; those leaving stop here too and look back once at the lit windows below before the moor takes them.',
      storyEvents: [
        {
          book: 'The Hobbit',
          chapter: 'A Short Rest',
          text: 'The edge came so suddenly that Gandalf’s horse nearly slid over it. Below lay the hidden valley they had been looking for, with a light on the far side of the water.',
        },
        {
          book: 'The Hobbit',
          chapter: 'The Last Stage',
          text: 'On the first of May, Bilbo and Gandalf came back to this edge on their way home and heard the Elves still singing in the trees below.',
        },
        {
          book: 'The Fellowship of the Ring',
          chapter: 'The Ring Goes South',
          text: 'Having climbed out in the dark, the Company stood on the windy moor, looked back once at the Last Homely House twinkling far below, and walked away into the night.',
        },
      ],
      characters: ['Gandalf', 'Bilbo Baggins', 'Frodo Baggins'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Rivendell',
    },
  },
  {
    id: 'zigzag-path',
    displayName: 'The Zigzag Path',
    type: 'other',
    mapIcon: 'waymark',
    position: HAIRPINS[1] ?? [ZIG.xb, 288],
    discoverRadius: 7,
    radius: 14,
    setting:
      'A narrow path is cut back and forth into the face of the valley wall, turning on itself three times on the way down. Rock rises sheer on one side and falls sheer on the other, and the air grows warmer and smells more of pine at every turn.',
    ground: { kind: 'stone', blend: 0.3, inner: 0.3 },
    vegetation: { density: 0.0 },
    lore: {
      region: 'imladris',
      summary:
        'This is the only way down the south wall, and the only way back up. It is too steep to ride, so riders get down and lead their ponies, and nobody hurries.',
      storyEvents: [
        {
          book: 'The Hobbit',
          chapter: 'A Short Rest',
          text: 'The company slithered and slid down the zigzag in the dusk, leading their ponies, and the warm smell of the pines made Bilbo drowsy enough to nod.',
        },
        {
          book: 'The Fellowship of the Ring',
          chapter: 'The Ring Goes South',
          text: 'On a cold night near the end of December, the Nine wound slowly up these long steep paths out of the valley, with Sam leading the pony.',
        },
      ],
      characters: ['Bilbo Baggins', 'Gandalf', 'Frodo Baggins', 'Samwise Gamgee'],
      sourceUrl: 'https://tolkiengateway.net/wiki/A_Short_Rest',
    },
  },
  {
    id: 'singing-woods',
    displayName: 'The Singing Woods',
    type: 'forest',
    mapIcon: 'forest',
    position: [252, 265],
    discoverRadius: 14,
    radius: 34,
    setting:
      'At the foot of the cliff the pines give way to beech and oak on a gentle slope running down to the river. The light turns soft and green, lanterns hang along the path, the water is loud below, and somewhere in the branches there is laughter.',
    vegetation: { density: 1.0, flowers: 'white' },
    lore: {
      region: 'singing-woods',
      summary:
        'The Elves of the valley like to meet travellers in the trees before they reach the house, singing, teasing and welcoming them. Their nonsense and laughter are the first thing that tells a newcomer this is a safe place.',
      storyEvents: [
        {
          book: 'The Hobbit',
          chapter: 'A Short Rest',
          text: 'Hidden Elves sang a mocking song from the trees as the company came down, joking about the dwarves’ beards and Bilbo’s pony, then came out and welcomed them warmly.',
        },
        {
          book: 'The Hobbit',
          chapter: 'The Last Stage',
          text: 'When Bilbo came back the next spring the Elves were singing in the trees again, this time about the death of the dragon.',
        },
      ],
      characters: ['Bilbo Baggins', 'Thorin', 'Gandalf', 'Balin'],
      sourceUrl: 'https://tolkiengateway.net/wiki/A_Short_Rest',
    },
  },
  {
    id: 'narrow-bridge',
    displayName: 'The Narrow Bridge',
    type: 'water',
    mapIcon: 'water',
    position: [BRIDGE.x, r1(BRIDGE_S + 2.5)],
    discoverRadius: 10,
    radius: 12,
    setting:
      'A single slim span of stone, with no parapet at all, leaps the loud white-flecked river. It is barely wide enough for a pony, and lanterns glow at both ends.',
    ground: { kind: 'stone', blend: 0.4, inner: 0.3 },
    vegetation: { density: 0.2 },
    lore: {
      region: 'bruinen',
      summary:
        'This is the one crossing between the moor path and the house, and everyone who comes or goes crosses here. A company crosses it slowly, in single file.',
      storyEvents: [
        {
          book: 'The Hobbit',
          chapter: 'A Short Rest',
          text: 'The Elves led the company down to the bridge. Each traveller led a pony across by the bridle, one at a time, while Elves held bright lanterns on the bank.',
        },
        {
          book: 'The Fellowship of the Ring',
          chapter: 'The Ring Goes South',
          text: 'At dusk on the day they set out, the Nine crossed here in silence, with Sam leading Bill the pony, before climbing the paths to the moor.',
        },
      ],
      characters: ['Bilbo Baggins', 'Thorin', 'Samwise Gamgee', 'Bill the Pony', 'Gandalf', 'Aragorn'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Bruinen',
    },
  },
  {
    id: 'loudwater',
    displayName: 'The Loudwater',
    type: 'water',
    mapIcon: 'water',
    position: [244, 222],
    discoverRadius: 8,
    radius: 12,
    setting:
      'Below the house the river runs fast over stones in a narrow bed, foaming and talking to itself day and night, so loud beside the water that you have to raise your voice.',
    ground: { kind: 'stone', blend: 0.4, inner: 0.4 },
    vegetation: { density: 0.1 },
    lore: {
      region: 'bruinen',
      summary:
        'Its Elvish name, Bruinen, means roughly loud water, and it earns it. The river runs through Elrond’s valley and answers to him: when the Nine tried to cross at the Ford downstream, it rose in flood at his command.',
      storyEvents: [
        {
          book: 'The Fellowship of the Ring',
          chapter: 'Many Meetings',
          text: 'Gandalf told Frodo that the river of this valley is under Elrond’s power and rose to bar the Ford, and that the white horses and riders in the waves were his own small addition.',
        },
        {
          book: 'The Hobbit',
          chapter: 'The Last Stage',
          text: 'Waking in the night, Bilbo heard many Elves singing beside the water below his window and called down a cheerful word to them.',
        },
      ],
      characters: ['Elrond', 'Gandalf', 'Frodo Baggins', 'Bilbo Baggins'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Bruinen',
    },
  },
  {
    id: 'terraces',
    displayName: 'The Terraces above the Bruinen',
    type: 'other',
    mapIcon: 'waymark',
    position: [300, 208],
    discoverRadius: 8,
    radius: 16,
    setting:
      'A long level walk runs along the slope between the house and the river, facing east up the valley, where the morning sun comes up over snowy peaks through thin silver mist.',
    ground: { kind: 'meadow', blend: 0.4, inner: 0.4 },
    vegetation: { density: 0.15, flowers: 'garden' },
    lore: {
      region: 'house-grounds',
      summary:
        'Guests of the house take the early air here. In late autumn the leaves are yellow, every bush is hung with dew-wet gossamer, and the snow on the eastern heights catches the first light.',
      storyEvents: [
        {
          book: 'The Fellowship of the Ring',
          chapter: 'The Council of Elrond',
          text: 'On the morning of the Council, Frodo woke early and well and walked here, watching the pale sun rise over the far mountains. Sam walked beside him without a word, sniffing the air and staring at the snow on the peaks.',
        },
      ],
      characters: ['Frodo Baggins', 'Samwise Gamgee'],
      sourceUrl: 'https://tolkiengateway.net/wiki/The_Council_of_Elrond',
    },
  },
  {
    id: 'homely-house',
    displayName: 'The Last Homely House',
    type: 'home',
    mapIcon: 'home',
    position: [FLIGHT_B.x + 4.5, 196.6],
    discoverRadius: 6,
    radius: 22,
    setting:
      'A long, many-windowed house stands on its shelf above the north bank, its doors open and firelight spilling down the steps toward the river.',
    ground: { kind: 'stone', blend: 0.5, inner: 0.35 },
    vegetation: { density: 0.05, flowers: 'garden' },
    lore: {
      region: 'house-grounds',
      summary:
        'Elrond founded the house in the Second Age as a refuge after Eregion fell. It became the last friendly house before the Wild, or the first after it, a treasury of lore and counsel where the heirs of Isildur were fostered. Bilbo said it suited every taste: food, sleep, stories, song, or just sitting and thinking.',
      storyEvents: [
        {
          book: 'The Hobbit',
          chapter: 'A Short Rest',
          text: 'Thorin’s company rested here for a fortnight and more, and on Midsummer’s Eve Elrond read the hidden moon-letters on Thrór’s map before they rode on.',
        },
        {
          book: 'The Fellowship of the Ring',
          chapter: 'The Ring Goes South',
          text: 'On a cold grey evening the Nine waited before these open doors. Bilbo stood shivering on the doorstep, Boromir’s horn echoed from rock to rock, and Elrond gave the Company his last words.',
        },
      ],
      characters: ['Elrond', 'Thorin', 'Bilbo Baggins', 'Gandalf', 'Boromir', 'Frodo Baggins'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Last_Homely_House',
    },
  },
  {
    id: 'bilbos-room',
    displayName: 'Bilbo’s Room',
    type: 'home',
    mapIcon: 'home',
    position: [BILBO.x, 197.2],
    discoverRadius: 5,
    radius: 10,
    setting:
      'At the house’s south-west corner a small room of one low storey opens onto its own scrap of garden. Its window is close to the ground and looks south across the ravine to steep woods under the stars.',
    vegetation: { density: 0.1, flowers: 'garden' },
    lore: {
      region: 'house-grounds',
      summary:
        'Bilbo lived in this room from his retirement until he sailed. He wrote most of his book here and made his verses, and the hobbits gathered here whenever they wanted to talk among themselves.',
      storyEvents: [
        {
          book: 'The Fellowship of the Ring',
          chapter: 'The Ring Goes South',
          text: 'On the last morning, Bilbo took a small sword and a bundle from a box under his bed. He gave Frodo Sting, driving it easily into a wooden beam to show its edge, and the mithril shirt that Thorin had once given him.',
        },
        {
          book: 'The Fellowship of the Ring',
          chapter: 'The Ring Goes South',
          text: 'While the hobbits held a little council of their own in here, Gandalf leaned in at the low window and made himself comfortable on the sill.',
        },
        {
          book: 'The Return of the King',
          chapter: 'Many Partings',
          text: 'A year later the travellers found Bilbo here, sleepy among his papers. After his birthday he gave Frodo his three books of lore translated from the Elvish.',
        },
      ],
      characters: ['Bilbo Baggins', 'Frodo Baggins', 'Samwise Gamgee', 'Gandalf', 'Merry Brandybuck', 'Pippin Took'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Bilbo_Baggins',
    },
  },
  {
    id: 'elronds-hall',
    displayName: 'Elrond’s Hall',
    type: 'other',
    mapIcon: 'home',
    position: [r1(HALL.x + HALL.w / 2 + 3), HALL.z],
    discoverRadius: 5,
    radius: 12,
    setting:
      'A tall hall with woven hangings on its walls, where a long table stands on a dais and side tables fill the floor below it. Its doors open east onto a wide paved passage, and a small bell-cote stands on its roof.',
    ground: { kind: 'stone', blend: 0.6, inner: 0.5 },
    vegetation: { density: 0.0 },
    lore: {
      region: 'house-grounds',
      summary:
        'The household and its guests eat here. When a peal of bells calls them in, Elrond takes his great chair at the end of the high table. On the night of Frodo’s recovery, Frodo first saw Arwen here, seated under a canopy, and could not stop looking.',
      storyEvents: [
        {
          book: 'The Fellowship of the Ring',
          chapter: 'Many Meetings',
          text: 'At the feast, Frodo sat at Elrond’s own table, raised on cushions. Glorfindel and Gandalf sat on either side of Elrond, Arwen sat beneath the canopy, and Sam, Merry and Pippin sat at the top of a side table near the dais.',
        },
        {
          book: 'The Fellowship of the Ring',
          chapter: 'Many Meetings',
          text: 'The white-bearded dwarf next to Frodo was Glóin, one of Thorin’s old companions, and he spent the meal telling Frodo the news of Erebor, Dale and the Beornings.',
        },
      ],
      characters: ['Elrond', 'Arwen', 'Glorfindel', 'Gandalf', 'Glóin', 'Frodo Baggins', 'Samwise Gamgee'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Many_Meetings',
    },
  },
  {
    id: 'hall-of-fire',
    displayName: 'The Hall of Fire',
    type: 'other',
    mapIcon: 'other',
    position: [r1(HEARTH.x - 2.6), r1(HEARTH.z + 3.6)],
    discoverRadius: 4,
    radius: 10,
    setting:
      'Out through the feasting hall’s doors, across the wide passage and through a second pair of doors, is a hall with no tables and little light. A fire burns there all year in a great hearth between carved pillars, and faces glow gold around it.',
    ground: { kind: 'stone', blend: 0.7, inner: 0.6 },
    vegetation: { density: 0.0 },
    lore: {
      region: 'house-grounds',
      summary:
        'By day it stands quiet for anyone who wants to think; on feast nights it fills with minstrels, tales and songs. Bilbo did much of his sitting and thinking here, and it was here, by the fire, that Frodo found him again.',
      storyEvents: [
        {
          book: 'The Fellowship of the Ring',
          chapter: 'Many Meetings',
          text: 'Frodo found Bilbo sitting alone by the fire. Later Bilbo sang his long song of Eärendil to a ring of Elves, and Lindir teased him that Elves cannot tell one mortal’s verses from another’s.',
        },
        {
          book: 'The Fellowship of the Ring',
          chapter: 'Many Meetings',
          text: 'As Frodo and Bilbo slipped out, an Elf began the hymn to Elbereth. Looking back, Frodo saw Aragorn standing beside Arwen, with a star shining on his breast.',
        },
        {
          book: 'The Fellowship of the Ring',
          chapter: 'The Ring Goes South',
          text: 'In their last evenings in the valley, the hobbits sat here and heard the whole lay of Beren and Lúthien.',
        },
      ],
      characters: ['Bilbo Baggins', 'Frodo Baggins', 'Lindir', 'Aragorn', 'Arwen', 'Elrond'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Hall_of_Fire',
    },
  },
  {
    id: 'east-porch',
    displayName: 'The East Porch',
    type: 'other',
    mapIcon: 'other',
    position: [r1(PORCH.x + 0.3), r1(PORCH.z - 0.8)],
    discoverRadius: 5,
    radius: 14,
    setting:
      'An open porch at the east end of the house looks up the valley to the far mountains. Plain stone benches stand round three sides, one back corner lies in shadow, a high garden lies around it, and the noise of foaming water rises from the river below.',
    ground: { kind: 'stone', blend: 0.5, inner: 0.4 },
    vegetation: { density: 0.05, flowers: 'garden' },
    lore: {
      region: 'house-grounds',
      summary:
        'The gravest debate of the age happened here, on an open porch in the autumn sun rather than in a throne room. Elves, Dwarves, Men, a wizard and hobbits sat together round Elrond to decide what to do with the Ring.',
      storyEvents: [
        {
          book: 'The Fellowship of the Ring',
          chapter: 'Many Meetings',
          text: 'At evening Sam brought Frodo here, where Merry and Pippin were waiting. Pippin greeted him with a grand mock title, and Gandalf, from the shadows at the back, told him that was no joke.',
        },
        {
          book: 'The Fellowship of the Ring',
          chapter: 'The Council of Elrond',
          text: 'On 25 October Elrond held his council here, with Strider sitting apart in a corner. Glóin, Legolas, Boromir, Gandalf and Aragorn told their tales, and at last Frodo said quietly that he would take the Ring, though he did not know the way.',
        },
      ],
      characters: ['Elrond', 'Gandalf', 'Frodo Baggins', 'Aragorn', 'Boromir', 'Legolas', 'Gimli', 'Glóin', 'Glorfindel', 'Erestor', 'Galdor', 'Bilbo Baggins', 'Samwise Gamgee'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Council_of_Elrond',
    },
  },
  {
    id: 'guest-rooms',
    displayName: 'The Guest Rooms',
    type: 'home',
    mapIcon: 'home',
    position: [UPPER.x - 2, r1(UPPER.z + UPPER.w / 2 + 3.2)],
    discoverRadius: 6,
    radius: 12,
    setting:
      'A storey up the slope behind the porch, a quieter range of rooms looks south over the high garden. Beside it the house brook drops over a short rock step, and its falling water can be heard in every room.',
    ground: { kind: 'stone', blend: 0.4, inner: 0.4 },
    vegetation: { density: 0.05, flowers: 'garden' },
    lore: {
      region: 'house-grounds',
      summary:
        'Guests of the house sleep here, under flat ceilings with carved dark beams. Nobody is quite sure which window was Frodo’s, only that he woke to the sound of falling water.',
      storyEvents: [
        {
          book: 'The Fellowship of the Ring',
          chapter: 'Many Meetings',
          text: 'On the morning of 24 October, Frodo woke in a bed here with sunlight on the wall and the sound of a waterfall outside, and found Gandalf sitting by the open window.',
        },
      ],
      characters: ['Frodo Baggins', 'Gandalf', 'Samwise Gamgee'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Many_Meetings',
    },
  },
  {
    id: 'stone-seat',
    displayName: 'The Seat in the Rock',
    type: 'other',
    mapIcon: 'other',
    position: [SEAT.x, r1(SEAT.z + 3.2)],
    discoverRadius: 5,
    radius: 10,
    setting:
      'High on the garden path above the house, a seat is hewn into a niche in the living rock where the path turns. It looks out over the roofs and up the valley to the snow, and the dark pinewoods begin just above it.',
    ground: { kind: 'stone', blend: 0.3, inner: 0.4 },
    vegetation: { density: 0.2 },
    lore: {
      region: 'house-grounds',
      summary:
        'It is a quiet place to talk out of the wind, and a favourite of two old friends, Bilbo and Gandalf. From here the whole valley lies open, and the pinewoods of the northern heights stand just above.',
      storyEvents: [
        {
          book: 'The Fellowship of the Ring',
          chapter: 'The Council of Elrond',
          text: 'Frodo and Sam found Gandalf and Bilbo deep in talk on this seat. Frodo pointed up to the pinewoods on the north side of the valley and said he longed to explore them. Then a single clear bell rang to call them to the Council.',
        },
      ],
      characters: ['Gandalf', 'Bilbo Baggins', 'Frodo Baggins', 'Samwise Gamgee'],
      sourceUrl: 'https://tolkiengateway.net/wiki/The_Council_of_Elrond',
    },
  },
  {
    id: 'birch-glade',
    displayName: 'The Birch Glade',
    type: 'tree',
    mapIcon: 'tree',
    position: [372, 253],
    discoverRadius: 12,
    radius: 26,
    setting:
      'Upstream, where the floor of the valley widens, a green sward white with small flowers runs down to the water among slender white-stemmed birches. It is very quiet here at evening.',
    ground: { kind: 'meadow', blend: 0.5, inner: 0.4 },
    vegetation: { density: 0.8, flowers: 'white' },
    lore: {
      region: 'birch-glade',
      summary:
        'Aragorn grew up in this house under the name Estel. When he was about twenty, Elrond told him who he truly was and gave him the ring of Barahir and the shards of Narsil. The next evening, walking alone and singing of Beren and Lúthien, he met Arwen here for the first time.',
      storyEvents: [
        {
          book: 'The Return of the King',
          chapter: 'Appendix A',
          text: 'Walking alone in the woods and singing part of the lay of Lúthien, young Aragorn saw a maiden among the birches and called her Tinúviel, thinking for a moment that the old song had come alive. She was Arwen, Elrond’s daughter, newly home from Lórien.',
        },
        {
          book: 'The Return of the King',
          chapter: 'Appendix A',
          text: 'Elrond later told Aragorn that Arwen would marry no lesser man than the king of both Gondor and Arnor.',
        },
      ],
      characters: ['Aragorn', 'Arwen', 'Elrond'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Arwen',
    },
  },
  {
    id: 'ford-road',
    displayName: 'The Road to the Ford',
    type: 'water',
    mapIcon: 'waymark',
    position: [EXIT[0] + 16, EXIT[1] - 12],
    discoverRadius: 12,
    radius: 20,
    setting:
      'At the south-west corner of the moor a trodden track leaves the heather and runs down toward the Great Road and the Ford of Bruinen, miles away.',
    ground: { kind: 'rust', blend: 0.3, inner: 0.3 },
    vegetation: { density: 0.2 },
    lore: {
      region: 'high-moor',
      summary:
        'The Ford is the one crossing of the Loudwater on the Road, and Elrond guards it with the river itself. Every traveller to Rivendell comes this way, from Thorin’s company to the hunted Ring-bearer.',
      storyEvents: [
        {
          book: 'The Fellowship of the Ring',
          chapter: 'Flight to the Ford',
          text: 'Riding Glorfindel’s white horse alone, Frodo outran the Nine to the Ford. On the far bank he turned and defied them, and as they rode into the water the river came down in a roaring flood and swept them away.',
        },
        {
          book: 'The Fellowship of the Ring',
          chapter: 'The Ring Goes South',
          text: 'After walking far into the night, the Company reached the Ford, left the Road, and turned south along narrow paths, keeping west of the mountains.',
        },
        {
          book: 'The Return of the King',
          chapter: 'Homeward Bound',
          text: 'On 6 October, a year after his wounding, Frodo crossed the Ford again on his way home and felt the old pain return.',
        },
      ],
      characters: ['Frodo Baggins', 'Glorfindel', 'Aragorn', 'Gandalf'],
      sourceUrl: 'https://tolkiengateway.net/wiki/Ford_of_Bruinen',
    },
  },
]

/** Hand every free prop to the nearest spot within 140 m, so it culls with that spot (Edoras). */
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
const SCENERY = distribute([...HOUSE, ...FREE])

// ---------------------------------------------------------------------------------------------
// Lanes (paint only)
// ---------------------------------------------------------------------------------------------
const lanes: Lane[] = [
  // the trodden track from the road-end to where the white stones begin (faint)
  { points: [[EXIT[0] + 4, EXIT[1] - 2], [90, 466], [150, 450], [200, 418], SPAWN], width: 2.2 },
  // the faint way along the stones, through the gully, to the notch and down it to the brink
  { points: [...STONE_LINE, [ZIG.xb, 318], [ZIG_HEAD[0], ZIG_HEAD[1]]], width: 2.0 },
  // the zigzag itself
  { points: ZIG_PTS.map(([x, z]): [number, number] => [x, z]), width: 3 },
  // down through the woods to the bridge's south head
  { points: [[ZIG_FOOT[0], ZIG_FOOT[1]], ...WOODS_PATH, [BRIDGE.x, BRIDGE_S + 0.5]], width: 2.4 },
  // along the apron east to the birch glade
  { points: [WOODS_PATH[0], ...GLADE_PATH], width: 1.8 },
  // the bridge landing up flight A, along the terrace walk, up flight B to the door
  { points: [[BRIDGE.x, BRIDGE_N - 0.5], [BRIDGE.x, FLIGHT_A.head]], width: FLIGHT_A.width },
  { points: [[T1.x0 + 4, 209], [T1.x1 - 4, 209]], width: 2.6 },
  { points: [[FLIGHT_B.x, FLIGHT_B.foot], [FLIGHT_B.x, FLIGHT_B.head], [FLIGHT_B.x, 193]], width: FLIGHT_B.width },
  // the front court west to Bilbo's garden and north past the west wing to the back court
  { points: [[FLIGHT_B.x, 196.5], [219.8, 196.5], [219.8, 177], [PASSAGE_X, 177]], width: 2.6 },
  // the wide passage between the halls, and the back court east round the east wing to the high garden
  { points: [[PASSAGE_X, 150], [PASSAGE_X, 177], [270.5, 177], [270.5, 193], [298, 194], [318, 194]], width: 3.6 },
  // the high garden to the guest rooms' stair, and the garden path up to the seat, turning at the seat
  { points: [[318, 194], [314, 176], [312, 165.6], [312, 156], [306, 153]], width: 1.8 },
  { points: [[318, 186], [330, 172], [338, 160], [342, 150], [SEAT.x + 0.5, SEAT.z + 3.4], [334.5, 141], [331.5, 130], [326, 116]], width: 1.8 },
]

// ---------------------------------------------------------------------------------------------
// Terrain lists, each written out in full (one object shape per list, as Edoras does)
// ---------------------------------------------------------------------------------------------
const hill = (h: Hill): Required<Hill> => ({ x: h.x, z: h.z, r: h.r, h: h.h, rx: h.rx ?? 1, rot: h.rot ?? 0 })
const flat = (f: Flat): Required<Flat> => ({ x: f.x, z: f.z, r: f.r, h: f.h ?? MOOR, strength: f.strength ?? 1 })
const river = (r: River): Required<River> => ({ points: r.points, width: r.width, depth: r.depth, bank: r.bank ?? 7, valley: r.valley ?? { width: 1, depth: 0 } })

const RIVERS: River[] = [
  // the Bruinen: fast, loud and 2.2 m deep, too deep to wade, so the bridge is the only crossing
  { points: RL, width: 10, depth: 2.2, bank: 4 },
  ...VALLEYS,
  GULLY_RIVER,
]

export const def: PlaceDef = {
  id: 'rivendell',
  name: 'Rivendell',
  parentWorldId: 'middle-earth',
  size: [W, H],
  cell: 2,
  seed: 3018,
  seaLevel: 0,
  palette: {
    sky: '#a9c8e6',
    horizon: '#e8eaee',
    water: '#6aa6c8',
    waterDeep: '#3d7598',
    sand: '#a29a86',
    // the moor is heather-brown green; the valley floor's lusher greens come from the spots
    grass: '#8aa45a',
    grassDry: '#a8a062',
    grassLush: '#5f9a52',
    meadow: '#9cbf62',
    forest: '#3c6e44',
    forestDark: '#2a5238',
    rock: '#8a8a84',
    rockWarm: '#a0927c',
    snow: '#f4f5f8',
    ash: '#5b524f',
    marsh: '#6f8a5c',
    road: '#bfb49a',
  },
  base: { height: MOOR, roll: 1.0, wavelength: 90 },
  // snow on the peaks at the valley head; bare rock on every steep face from ~20 m up
  snowline: 95,
  hills: MOUNTAINS.map(hill),
  flats: [...ZIG_FLATS, ...HOUSE_FLATS].map(flat),
  rivers: RIVERS.map(river),
  ponds: [],
  lanes,
  woods: [
    // pines on the lip either side of the zigzag's head (conifers above 28 m)
    { x: 172, z: 322, r: 30 },
    { x: 318, z: 318, r: 32 },
    // and close in round the notch, so the path leaves the moor between pines
    { x: 291, z: 323, r: 17 },
    { x: 241, z: 323, r: 15 },
    // the singing woods on the apron: beech and oak (region mood `beech`)
    { x: 178, z: 262, r: 32 },
    { x: 250, z: 268, r: 20 },
    { x: 290, z: 268, r: 24 },
    // the birch glade
    { x: 382, z: 258, r: 22 },
    // the pinewoods of the northern heights
    { x: 150, z: 112, r: 46 },
    { x: 236, z: 96, r: 52 },
    { x: 330, z: 92, r: 40 },
    // west of the house, down toward the gorge
    { x: 150, z: 200, r: 30 },
  ],
  spawn: SPAWN,
  // looking north-north-east along the white stones; the default pitch keeps the cleft hidden
  spawnYaw: r3(-Math.atan2(STONE_LINE[2][0] - SPAWN[0], -(STONE_LINE[2][1] - SPAWN[1]))),
  cameraDistance: 10,
  // on the zigzag's bench the arm rises over her instead of closing in against the rock face
  cameraCrane: true,
  speedScale: 0.75,
  fog: [160, 560],
  // the silver air and fair weather of the house, everywhere in the valley
  air: { aura: 'silver', weather: 'fair' },
  exit: { x: EXIT[0], z: EXIT[1], radius: 7, label: 'Out to the Road' },
  // she reappears west of the overworld pin, on the road (overworld ground 6-8 m there)
  returnOffset: [-30, 4],
  regions: [
    { id: 'imladris', displayName: 'Imladris', polygon: [[60, 130], [420, 130], [420, 300], [60, 300]], label: [140, 236] },
    { id: 'high-moor', displayName: 'The High Moor', polygon: [[0, 304], [W, 304], [W, H], [0, H]], label: [120, 400] },
    { id: 'north-heights', displayName: 'The Pinewoods of the North Side', polygon: [[60, 0], [420, 0], [420, 128], [60, 128]], label: [236, 70], mood: 'pine' },
    // beech and oak, no glowing mushrooms
    { id: 'singing-woods', displayName: 'The Lower Woods', polygon: [[120, 248], [310, 248], [310, 282], [120, 282]], label: [150, 270], mood: 'beech' },
    // birches, no pink blossom
    { id: 'birch-glade', displayName: 'The Birch Glade', polygon: [[344, 240], [410, 240], [410, 278], [344, 278]], mood: 'birch' },
    { id: 'bruinen', displayName: 'The Bruinen', polygon: [[60, 226], [420, 220], [420, 246], [60, 252]], label: [120, 244] },
    // yellow autumn leaves of the Council's October, no pink blossom
    { id: 'house-grounds', displayName: 'The House of Elrond', polygon: [[196, 128], [356, 128], [356, 226], [196, 226]], label: [270, 140], mood: 'autumn' },
  ],
  spots,
  props: [
    ...SCENERY,
    // the way out, on the track at the moor's south-west corner
    { kind: 'gateArch', at: EXIT, rotation: 1.35, params: { width: 3.6, ring: 3, wood: '#8a8478' } },
  ],
}

/** Named positions for the headless walk and camera tests; not used by the app. */
export const LAYOUT = {
  ZIG_FLAT_COUNT: ZIG_FLATS.length, NOTCH, WOODS_PATH, GLADE_PATH, ZIG_PTS, ZIG_PG, HAIRPINS, ZIG_HEAD, ZIG_FOOT, BRIDGE, BRIDGE_S, BRIDGE_N, HEADS, FLIGHT_A, FLIGHT_B, T1, LIP, LANDING,
  RANGE, WEST, BILBO, HALL, FIRE, FIRE_DOOR, HEARTH, PASSAGE_X, EASTW, PORCH, UPPER, SEAT, FALL_UPPER, FALL_LIP, SPAWN, EXIT, BRINK, STONE_LINE, GULLY, LEVEL,
}
