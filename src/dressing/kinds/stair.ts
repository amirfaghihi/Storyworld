/**
 * `stair`: a long flight of stone steps up a bank (Edoras spec A.3). Book: a high, broad stair of
 * stone climbing the green bank to the hall, with stone seats either side of the topmost step; and
 * short flights where the paved way doubles back up the terraces. Our own design: pale dressed
 * stone treads with square nosings, a level landing halfway on the long stair, plain stepped cheek
 * walls, green turf either side. Not a single long stair cut up a rock to a porch.
 *
 * Two modes:
 *  - masonry (default): the treads are planned on a straight line from the ground in front of the
 *    foot to the head (constant risers, an optional level landing halfway) and built up from the
 *    bank as solid stone, with cheek walls either side. Where the bank steepens toward a terrace
 *    rim and would bury the top treads, both flights take a shorter tread (which lifts the whole
 *    line) and the top tread runs on as a deeper step at the head, so the risers stay even;
 *  - `draped: true`: the treads are laid on the bank as it comes (the street flights), each one
 *    closed where the ground has risen a riser above it, so the risers stay even and the treads
 *    are deep where the bank eases out at its ends and short in its steep middle.
 *
 * Frame: the origin is the foot on the centre line; the stair climbs toward local -z, so its front
 * (+z) faces downhill (rot = atan2(foot.x - head.x, foot.z - head.z)). Sizes are metres; `c.scale`
 * is ignored.
 *
 * Walking: the traveller is carried by decks laid on the stair's nosing line, the upper envelope
 * of the treads (through the front edge of every tread top, level across the landing and the head
 * tread, and one tread deep down to the ground in front of the foot). Her feet are never below the
 * stone they stand over and never more than about a riser above it, and since the surface is
 * continuous she neither bumps up each riser nor leaves the ground going down (flat per-tread
 * decks drop a riser at every nosing, which the controller treats as a fall at 60 fps and up).
 * Runs of the nosing line that stay straight within those bounds share one deck, so a regular
 * flight is a single sloping deck. Every deck is thick down to the footing under it, so no one
 * walks under the stair, and the cheeks (solid at any height from the ground beside, and above
 * the feet on the stair) keep her on it and off the bank beside it.
 */
import * as THREE from 'three'
import type { Part } from '@/render/mergeColoured'
import { hash2 } from '@/terrain/faceColors'
import { type PropContext, P, S, B, at, footMinRect, footMaxRect, solidBox } from '../propUtil'
import { column, STEP_STONE } from '../placeUtil'

export const STAIR_DEFAULTS = {
  /** metres between the cheeks (the treads' width) */
  width: 5,
  /** horizontal length from the foot (local z = 0) to the head (local z = -run) */
  run: 12,
  /** target rise per step; kept at or under 0.3 */
  riser: 0.25,
  /** depth of one level landing halfway (masonry only) */
  landing: 0,
  /** cheek-wall height above the tread line; 0 = none */
  cheeks: 0.9,
  /** how far the cheeks run on past the head (to meet seats or a parapet) */
  cheekReach: 0,
  draped: false,
  stone: STEP_STONE,
  cheekStone: '#a8a294',
  /** the cheeks' coping, the same as the parapet and terrace-lip walls' */
  cap: '#c4bdae',
} as const

/** cheek wall thickness; it stands just outside the treads, its centre CHEEK_T / 2 beyond them */
const CHEEK_T = 0.6
/** the coping on each cheek piece: this deep, overhanging the wall this much each side */
const CAP_H = 0.12
const CAP_OVER = 0.05
/** cheeks start this far in front of the foot */
const CHEEK_LEAD = 0.3
/** cheek pieces break at tread edges once they are at least this long */
const CHEEK_PIECE = 0.7
/** shallowest tread a draped flight lays (except at the head) */
const MIN_TREAD = 0.28
/** a tread's top stands this far above the highest ground under it, so no turf shows through */
const LIFT = 0.03
/** footings run this far below the lowest ground */
const SINK = 0.1
/** draped flights read the bank every SAMPLE metres up the centre line */
const SAMPLE = 0.02
/** the approach ramp before a nosing that follows a deep tread (or the ground in front) */
const MAX_LEAD = 0.6
/** a deep tread is walked level before the ramp to the next nosing only if that stretch is this long */
const MIN_FLAT = 0.3
/** how far a merged deck may run above the nosing line between its ends */
const SLACK = 0.06
/** the controller's default deck thickness; stair decks are never thinner */
const DECK_THICK = 0.6

/** One tread: from s0 to s1 metres up the stair from the foot (local z = -s), its top and footing. */
export interface StairTread {
  s0: number
  s1: number
  top: number
  foot: number
}

/** The stair's footprint for the map and anything else that must agree with the builder. */
export interface StairFrame {
  /** world (x, z) of the foot on the centre line (the prop's origin) */
  foot: [number, number]
  /** world (x, z) of the head on the centre line */
  head: [number, number]
  /** full width over the cheeks (the treads' width when there are none) */
  width: number
  /** horizontal length from the foot to the head */
  run: number
  /** half the treads' width, and half the full width over the cheeks, in local x */
  hw: number
  outer: number
}

function params(c: PropContext) {
  const width = Math.max(0.6, P(c, 'width', STAIR_DEFAULTS.width))
  const run = Math.max(0.6, P(c, 'run', STAIR_DEFAULTS.run))
  const riser = Math.min(0.3, Math.max(0.1, P(c, 'riser', STAIR_DEFAULTS.riser)))
  const draped = B(c, 'draped', STAIR_DEFAULTS.draped)
  const landing = draped ? 0 : Math.max(0, P(c, 'landing', STAIR_DEFAULTS.landing))
  const cheeks = Math.max(0, P(c, 'cheeks', STAIR_DEFAULTS.cheeks))
  const reach = Math.max(0, P(c, 'cheekReach', STAIR_DEFAULTS.cheekReach))
  return { width, hw: width / 2, run, riser, draped, landing, cheeks, reach }
}

/** Foot, head, full width over the cheeks and run, from the same params the builder reads. */
export function stairFrame(c: PropContext): StairFrame {
  const { hw, run, cheeks } = params(c)
  const outer = hw + (cheeks > 0 ? CHEEK_T : 0)
  return { foot: at(c, 0, 0), head: at(c, 0, -run), width: 2 * outer, run, hw, outer }
}

/** A tread's footprint in local axes: centre lz and half depth. */
const treadRect = (t: { s0: number; s1: number }) => ({ lz: -(t.s0 + t.s1) / 2, hd: (t.s1 - t.s0) / 2 })

/**
 * The treads, the ground in front of the foot, and the walking surface over them (vertices
 * [s, y] from one approach run in front of the foot to the head), as the builder lays them.
 */
export function stairSteps(c: PropContext): { treads: StairTread[]; bottom: number; surface: [number, number][] } {
  const { hw, run, riser, draped, landing } = params(c)
  // the ground just in front of the foot, which the first riser climbs from
  const bottom = footMaxRect(c, 0, 0.4, hw, 0.4)
  const spans: [number, number][] = []
  // masonry: the planned top of each tread (draped treads have none)
  const lines: number[] = []
  if (draped) {
    // up the centre line: close a tread where the ground across the stair has risen a riser above
    // the one before (never shallower than MIN_TREAD), or at the head; a sliver short of the head
    // joins the last tread
    let s0 = 0, base = bottom
    for (let i = 1; ; i++) {
      const s = Math.min(run, i * SAMPLE)
      if (s >= run - 1e-6) {
        spans.push([s0, run])
        break
      }
      const gs = footMaxRect(c, 0, -s, hw, SAMPLE / 2)
      if (gs - base >= riser && s - s0 >= MIN_TREAD - 1e-6 && run - s >= MIN_TREAD - 1e-6) {
        spans.push([s0, s])
        base = gs
        s0 = s
      }
    }
  } else {
    // n even risers from the ground in front to the head. Both flights share one tread depth; the
    // last tread of the first flight runs on as the landing and the last of the second runs on to
    // the head. The depth is the even share of the run, or less where the bank would bury a tread
    // on that line (it steepens toward a terrace rim): shorter treads raise the whole line, and
    // the top tread grows into a deeper step at the head.
    const top = typeof c.params.top === 'number' ? (c.params.top as number) : footMaxRect(c, 0, -run - 0.75, hw, 0.75)
    const n = Math.max(1, Math.ceil(Math.max(0, top - bottom) / riser - 1e-9))
    const r = (top - bottom) / n
    const lands = landing > 0 && n >= 2 && landing < run - 0.6
    const land = lands ? landing : 0
    const n1 = lands ? Math.floor(n / 2) : n
    const layout = (d: number): [number, number][] =>
      Array.from({ length: n }, (_, k): [number, number] => {
        const s0 = k < n1 ? k * d : n1 * d + land + (k - n1) * d
        if (k === n - 1) return [s0, run]
        return [s0, s0 + d + (k === n1 - 1 ? land : 0)]
      })
    const buried = (sp: [number, number][]) =>
      sp.some(([s0, s1], k) => {
        const { lz, hd } = treadRect({ s0, s1 })
        return bottom + r * (k + 1) < footMaxRect(c, 0, lz, hw, hd) + LIFT - 1e-6
      })
    const even = (run - land) / n
    let d = even
    for (let cm = Math.floor(even * 100); buried(layout(d)) && cm >= MIN_TREAD * 100; cm--) d = Math.min(even, cm / 100)
    spans.push(...layout(d))
    for (let k = 0; k < n; k++) lines.push(bottom + r * (k + 1))
  }
  // tops: on the plan (masonry) but never buried where the bank still bulges over it; draped, just
  // over the highest ground under the tread. Never lower than the tread below.
  const treads: StairTread[] = []
  let prev = -Infinity
  spans.forEach(([s0, s1], k) => {
    const { lz, hd } = treadRect({ s0, s1 })
    const top = Math.max(lines[k] ?? -Infinity, footMaxRect(c, 0, lz, hw, hd) + LIFT, prev)
    treads.push({ s0, s1, top, foot: Math.min(top - SINK, footMinRect(c, 0, lz, hw, hd) - SINK) })
    prev = top
  })
  // a draped flight's last tread barely above the one below (the terrace it climbs to has levelled
  // out) is one deep top step instead
  const last = treads[treads.length - 1], below = treads[treads.length - 2]
  if (draped && below && last.top - below.top < riser / 3) {
    below.s1 = last.s1
    below.top = last.top
    below.foot = Math.min(below.foot, last.foot)
    treads.pop()
  }
  // the nosing line: up to each tread's front edge, level across a deep one (a landing) until one
  // approach run short of the next nosing, and level over the head tread; an approach run down to
  // the ground in front
  const lead = (t: StairTread) => Math.min(MAX_LEAD, t.s1 - t.s0)
  const surface: [number, number][] = [[-lead(treads[0]), bottom]]
  treads.forEach((t, k) => {
    surface.push([t.s0, t.top])
    const next = treads[k + 1]
    const flatTo = next ? next.s0 - lead(next) : t.s1
    if (flatTo > t.s0 + (next ? MIN_FLAT : 1e-6)) surface.push([flatTo, t.top])
  })
  return { treads, bottom, surface }
}

/** Height of a polyline of [s, y] vertices at s, held level beyond its ends. */
function lineAt(v: [number, number][], s: number): number {
  if (s <= v[0][0]) return v[0][1]
  for (let i = 1; i < v.length; i++) {
    const [s1, y1] = v[i]
    if (s <= s1) {
      const [s0, y0] = v[i - 1]
      return s1 - s0 < 1e-9 ? Math.max(y0, y1) : y0 + ((y1 - y0) * (s - s0)) / (s1 - s0)
    }
  }
  return v[v.length - 1][1]
}

/**
 * The walking surface as few straight pieces as it allows: a piece from vertex i to vertex j
 * stands on every vertex between them or at most `slack` above it, so it is never below a tread
 * and floats no more than the nosing line itself does (a riser) plus the slack. A level landing
 * stays level: the ramp up from it does not lean back over it.
 */
function mergeSurface(v: [number, number][], slack: number): [number, number, number, number][] {
  const fits = (i: number, j: number) => {
    const [sa, ya] = v[i], [sb, yb] = v[j]
    for (let k = i + 1; k < j; k++) {
      const d = ya + ((yb - ya) * (v[k][0] - sa)) / (sb - sa) - v[k][1]
      if (d < -1e-4 || d > slack) return false
    }
    return true
  }
  const out: [number, number, number, number][] = []
  let i = 0
  while (i < v.length - 1) {
    let j = i + 1
    // skip zero-length pieces (a tread exactly one approach run deep)
    while (j < v.length - 1 && v[j][0] - v[i][0] < 1e-6) j++
    while (j + 1 < v.length && fits(i, j + 1)) j++
    if (v[j][0] - v[i][0] > 1e-6) out.push([v[i][0], v[i][1], v[j][0], v[j][1]])
    i = j
  }
  return out
}

/** A colour a few percent lighter or darker (dressed stone, course by course). */
const tone = (hex: string, f: number) => '#' + new THREE.Color(hex).multiplyScalar(f).getHexString()

export function stair(c: PropContext, out: Part[]): void {
  const { hw, run, cheeks, reach } = params(c)
  const stone = S(c, 'stone', STAIR_DEFAULTS.stone)
  const cheekStone = S(c, 'cheekStone', STAIR_DEFAULTS.cheekStone)
  const cap = S(c, 'cap', STAIR_DEFAULTS.cap)
  const { treads, surface } = stairSteps(c)

  // the treads: solid stone from the footing to the top, each a shade apart
  treads.forEach((t, k) => {
    const { lz, hd } = treadRect(t)
    column(c, out, 0, lz, 2 * hw, 2 * hd, t.foot, t.top, tone(stone, 0.95 + 0.1 * hash2(c.seed, k)))
  })

  // decks on the nosing line, each thick down to the lowest footing under it
  if (c.colliders) {
    for (const [sa, ya, sb, yb] of mergeSurface(surface, SLACK)) {
      let lowest = Infinity
      for (const t of treads) if (t.s1 > sa && t.s0 < sb) lowest = Math.min(lowest, t.foot)
      if (lowest === Infinity) lowest = Math.min(ya, yb) - DECK_THICK
      const [x, z] = at(c, 0, -(sa + sb) / 2)
      // a deck's height runs along its own local x: turned a quarter back, that is the stair's +z,
      // so yA is at the head end (local z = -sb) and yB at the foot end (-sa)
      c.colliders.push({ kind: 'deck', x, z, hw: (sb - sa) / 2, hd: hw, rot: c.rot - Math.PI / 2, yA: yb, yB: ya, arc: 0, thick: Math.max(DECK_THICK, Math.max(ya, yb) - (lowest - SINK)) })
    }
  }

  if (cheeks <= 0) return
  // cheek walls: level-topped pieces breaking at tread edges, from CHEEK_LEAD in front of the foot
  // to `reach` past the head, each `cheeks` above the tread line or the bank beside it, whichever
  // is higher, and never less than half a metre above the walking surface along it
  const cuts = [-CHEEK_LEAD]
  for (const t of treads) if (t.s1 - cuts[cuts.length - 1] >= CHEEK_PIECE && t.s1 < run - 1e-6) cuts.push(t.s1)
  if (run + reach - cuts[cuts.length - 1] < CHEEK_PIECE / 2 && cuts.length > 1) cuts.pop()
  cuts.push(run + reach)
  const walk = (s: number) => lineAt(surface, Math.min(s, run))
  for (let i = 0; i < cuts.length - 1; i++) {
    const sa = cuts[i], sb = cuts[i + 1], lz = -(sa + sb) / 2, hd = (sb - sa) / 2
    let surfMax = -Infinity
    for (let q = 0; q <= 4; q++) surfMax = Math.max(surfMax, walk(sa + ((sb - sa) * q) / 4))
    for (const s of [-1, 1]) {
      const lx = s * (hw + CHEEK_T / 2)
      const bank = footMaxRect(c, lx, lz, CHEEK_T / 2, hd)
      const top = Math.max(walk(-lz), bank) + cheeks
      const safe = Math.max(top, surfMax + Math.min(0.5, cheeks))
      const foot = Math.min(safe - SINK, footMinRect(c, lx, lz, CHEEK_T / 2, hd) - SINK)
      column(c, out, lx, lz, CHEEK_T, 2 * hd + 0.02, foot, safe - CAP_H, cheekStone)
      column(c, out, lx, lz, CHEEK_T + 2 * CAP_OVER, 2 * hd + 0.02, safe - CAP_H, safe, cap)
      solidBox(c, lx, lz, CHEEK_T / 2, hd + 0.01, 0, c.rot, { top: safe })
    }
  }
}
