/**
 * Set pieces at 1:1 scale for enterable places (Hobbiton first). Same data format as the
 * overworld dressings; these register colliders so the traveller walks around them.
 * Convention: a piece "faces" local +z (its door is on the +z side).
 *
 * Everything stands on the drawn ground, which is rarely level under a whole piece. Buildings stay
 * upright on a floor that is never buried by more than a few tens of centimetres and show a stone
 * footing or skirt down to the lowest ground under them; long things (rails, benches, tables)
 * reach their own ground at every post or leg; small rigid things (carts, stepping stones) tilt to
 * the ground's plane. Colliders take their heights from the same floor the parts use.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Part } from '@/render/mergeColoured'
import { hash2 } from '@/terrain/faceColors'
import {
  type PropContext,
  P,
  S,
  B,
  at,
  surf,
  findWater,
  footMinRect,
  footMaxRect,
  footMinDisc,
  footMaxDisc,
  plinth,
  minAcross,
  groundStrip,
  onPlane,
  solidBox,
  solidCircle,
  box,
  cyl,
  cone,
  sphere,
  dome,
  dodeca,
  disc,
  gableRoof,
  gableRoofLow,
  roofBase,
} from './propUtil'

type Builder = (c: PropContext, out: Part[]) => void

const FLOWER_COLOURS = ['#e84a5f', '#f2c14e', '#ffffff', '#8e5aa8', '#ff7f3f', '#f3a0c0']
const GLASS = '#f7e7a8'
const BRASS = '#f2c14e'
const STEP_STONE = '#b8ad98'

/**
 * Default footprint of each building kind, full extents in metres along local x (width) and
 * local z (length), before params and scale: the map draws plans from these without building
 * the pieces, and the builders read their defaults from here so the two cannot drift.
 * `params.width` / `params.length` override them; cottage and townGate sizes are also
 * multiplied by the prop's scale. A smial's length is its facade; its turf brow behind spans
 * about 1.36 w across and 1.24 w deep, centred 1.1 m behind the door.
 */
export const PLACE_FOOTPRINT = {
  cottage: { width: 6, length: 8 },
  smial: { width: 5.6, length: 0.8 },
  waterMill: { width: 7, length: 8 },
  townGate: { width: 4.6 },
  well: { width: 2.2, length: 2.2 },
} as const

/** World (x, z) -> the prop's local coordinates: the inverse of propUtil.at. */
function toLocal(c: PropContext, x: number, z: number): [number, number] {
  const cs = Math.cos(c.rot), sn = Math.sin(c.rot)
  const dx = x - c.x, dz = z - c.z
  return [cs * dx - sn * dz, sn * dx + cs * dz]
}

/** A box in local axes whose bottom and top are given in world y (posts, skirts, legs). */
function column(c: PropContext, out: Part[], lx: number, lz: number, w: number, d: number, bottom: number, top: number, color: string) {
  const [x, z] = at(c, lx, lz)
  out.push({ geo: box(w, top - bottom, d), color, position: [x, (top + bottom) / 2, z], rotation: [0, c.rot, 0] })
}

/**
 * A straight rail from (lx0, y0) to (lx1, y1) along local z = lz, `th` tall and `depth` deep:
 * fence rails that slope from post to post instead of stepping.
 */
function rail(c: PropContext, lx0: number, y0: number, lx1: number, y1: number, lz: number, th: number, depth: number): THREE.BufferGeometry {
  const at01 = (lx: number) => y0 + ((y1 - y0) * (lx - lx0)) / (lx1 - lx0)
  return groundStrip(c, lx0, lx1, lz, depth, at01, (lx) => at01(lx) + th, Math.abs(lx1 - lx0) + 1)
}

/**
 * A walkable surface from local z = z0 to z1 (front to back of the piece) and lx +- hw across,
 * at y0 where it starts and y1 where it ends: door steps and doorsteps, which the traveller
 * climbs like a short bridge deck instead of wading through them.
 */
function stepDeck(c: PropContext, lx: number, z0: number, z1: number, hw: number, y0: number, y1: number) {
  if (!c.colliders) return
  const [x, z] = at(c, lx, (z0 + z1) / 2)
  // a deck's height runs along its own local x; turned a quarter back, that is this piece's +z
  c.colliders.push({ kind: 'deck', x, z, hw: Math.abs(z1 - z0) / 2, hd: hw, rot: c.rot - Math.PI / 2, yA: y0, yB: y1, arc: 0 })
}

/**
 * Steps from a door sill at `floor` down to the ground in front of a wall face at local z = lz,
 * when the ground there has dropped more than 0.2 m: treads 0.35 m deep, each reaching down to its
 * own ground and each a deck to stand on. They share the drop evenly, 0.3 m a tread or less up to
 * eight treads (a 2.4 m drop, a stair for a mill on a tall river-side base); a taller drop keeps
 * the eight and each rises an eighth of it, which stays an easy step (STEP_UP) up to a 6.8 m drop.
 * Call it last in a builder, so the rest of the part list is the same on any ground.
 */
function doorSteps(c: PropContext, out: Part[], lx: number, lz: number, hw: number, floor: number) {
  const drop = floor - footMinRect(c, lx, lz + 0.35, hw, 0.35)
  if (drop <= 0.2) return
  const n = Math.min(8, Math.ceil(drop / 0.3))
  for (let k = 0; k < n; k++) {
    const top = floor - (k * drop) / n
    const tz = lz + 0.35 * (k + 0.5)
    // a long stair can meet ground that rises again further out: stop where it has
    if (k > 0 && top < footMaxRect(c, lx, tz, hw, 0.175) + 0.1) break
    const bottom = Math.min(top - 0.1, footMinRect(c, lx, tz, hw, 0.175) - 0.1)
    column(c, out, lx, tz, hw * 2, 0.35, bottom, top, STEP_STONE)
    stepDeck(c, lx, tz - 0.175, tz + 0.175, hw, top, top)
  }
}

/**
 * Tread tops for a stair from a sill at `top` (a deck ending at local z = lz) down a slope in
 * front of it, treads 0.35 m deep and lx +- hw across. Unlike doorSteps, the ground here keeps
 * falling past the first tread (a smial dug into a hillside), so the stair is planned against the
 * ground where it ends: the fewest treads (up to eight) that share the drop from the sill to the
 * ground beyond the last one at 0.3 m a step or less, or eight sharing it evenly when more would
 * be needed. A stair stops early where the ground rises to meet it. Empty when the sill is an easy
 * step above the ground in front.
 */
function stairPlan(c: PropContext, lx: number, lz: number, hw: number, top: number): number[] {
  const ground = (k: number) => footMaxRect(c, lx, lz + 0.35 * (k + 0.5), hw, 0.175)
  if (top - ground(0) <= 0.3) return []
  let n = 1
  while (n < 8 && (top - ground(n)) / (n + 1) > 0.3) n++
  const rise = (top - ground(n)) / (n + 1)
  const treads: number[] = []
  for (let k = 0; k < n; k++) {
    const y = top - rise * (k + 1)
    if (y < ground(k) + 0.1) break
    treads.push(y)
  }
  return treads
}

/** Build the treads stairPlan laid out: each down to its own ground and a deck to stand on. */
function stair(c: PropContext, out: Part[], lx: number, lz: number, hw: number, treads: number[]) {
  treads.forEach((top, k) => {
    const tz = lz + 0.35 * (k + 0.5)
    const bottom = Math.min(top - 0.1, footMinRect(c, lx, tz, hw, 0.175) - 0.1)
    column(c, out, lx, tz, hw * 2, 0.35, bottom, top, STEP_STONE)
    stepDeck(c, lx, tz - 0.175, tz + 0.175, hw, top, top)
  })
}

const inv = new THREE.Matrix4()
const probe = new THREE.Vector3()

/**
 * Seat a thin round piece (a stepping stone) on the ground at the context's origin: tilted with
 * the slope like onPlane, and returned with how far the ground rises above that seated plane
 * anywhere under it, so the piece can be made that much thicker instead of vanishing under a
 * crease or bump.
 */
function laid(c: PropContext, r: number, maxTilt: number): { matrix: THREE.Matrix4; above: number } {
  const matrix = onPlane(c, r, r, maxTilt, 0)
  inv.copy(matrix).invert()
  let above = 0
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 5; j++) {
      const dx = (r * (i - 2)) / 2, dz = (r * (j - 2)) / 2
      if (dx * dx + dz * dz > r * r) continue
      probe.set(c.x + dx, c.ground(c.x + dx, c.z + dz), c.z + dz).applyMatrix4(inv)
      if (probe.y > above) above = probe.y
    }
  return { matrix, above }
}

/**
 * The earth under a smial's turf brow, behind the facade: the brow is an open half-ellipsoid
 * (radii rx across, rz deep, centred at local z = cz) whose rim sits at `top`, which hangs in the
 * air wherever the hill behind is lower than that. This fills the brow's back part (local z up to
 * zCut) with a solid bank: walls straight down from the rim to below the ground, closed by a face
 * at zCut, a floor underground and a lid under the brow, so the knoll reads as earth and its
 * solids have something to stand for.
 */
function turfBank(c: PropContext, rx: number, rz: number, cz: number, top: number, zCut: number): THREE.BufferGeometry {
  // the outline, in local coordinates: round the back of the rim from one side of the cut to the
  // other, then back along the cut; travelling this way round, walls built below face outward
  const ring: [number, number][] = []
  const s0 = Math.asin(Math.min(1, (zCut - cz) / rz))
  const arc = 20
  for (let i = 0; i <= arc; i++) {
    const t = Math.PI - s0 + ((Math.PI + 2 * s0) * i) / arc
    ring.push([rx * Math.cos(t), cz + rz * Math.sin(t)])
  }
  const xc = ring[arc][0]
  const front = Math.max(1, Math.ceil((2 * xc) / 0.5))
  for (let i = 1; i < front; i++) ring.push([xc - (2 * xc * i) / front, zCut])
  const pts = ring.map(([lx, lz]) => {
    const [x, z] = at(c, lx, lz)
    return { x, z, y: Math.min(c.ground(x, z) - 0.15, top - 0.01) }
  })
  const pos: number[] = []
  const tri = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz2: number) => pos.push(ax, ay, az, bx, by, bz, cx, cy, cz2)
  let low = Infinity
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    tri(a.x, a.y, a.z, b.x, top, b.z, b.x, b.y, b.z)
    tri(a.x, a.y, a.z, a.x, top, a.z, b.x, top, b.z)
    if (a.y < low) low = a.y
  }
  // floor and lid, fans from a point inside (the outline is convex): the lid is hidden under the
  // brow, but closes the bank so it is a solid of its own
  const [ox, oz] = at(c, 0, (zCut + cz - rz) / 2)
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    tri(ox, low, oz, a.x, a.y, a.z, b.x, b.y, b.z)
    tri(ox, top, oz, b.x, top, b.z, a.x, top, a.z)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return g
}

function roundWindow(c: PropContext, out: Part[], lx: number, lz: number, y: number, r = 0.42) {
  const [x, z] = at(c, lx, lz)
  out.push({ geo: disc(r, 0.32, 12), color: '#5a4030', position: [x, y, z], rotation: [0, c.rot, 0] })
  out.push({ geo: disc(r * 0.78, 0.36, 12), color: GLASS, position: [x, y, z], rotation: [0, c.rot, 0], unlit: true })
}

function flowerBox(c: PropContext, out: Part[], lx: number, lz: number, y: number, seed: number) {
  const [x, z] = at(c, lx, lz)
  out.push({ geo: box(1.0, 0.26, 0.32), color: '#6a4a30', position: [x, y, z], rotation: [0, c.rot, 0] })
  for (let i = 0; i < 4; i++) {
    const [fx, fz] = at(c, lx - 0.36 + i * 0.24, lz)
    out.push({ geo: sphere(0.11, 5, 4), color: FLOWER_COLOURS[Math.floor(hash2(seed, i) * FLOWER_COLOURS.length)], position: [fx, y + 0.22, fz] })
  }
}

// ---- the numbers a builder and its chimney smoke (Particles) must agree on ----

/**
 * A smial's floor: level with the ground under the facade and doorstep, raised to keep the high
 * side buried by at most 0.35 m and the doorstep clear of the ground in front. The facade skirts
 * down to `lo` - 0.15 so the low side shows no gap. The chimney pokes out of the hill behind on
 * its own ground, and at least 0.45 m out of the turf brow, so smoke never starts inside the
 * turf where the hill behind is low.
 */
function smialFrame(c: PropContext) {
  const w = P(c, 'width', PLACE_FOOTPRINT.smial.width)
  const lo = footMinRect(c, 0, 0.45, w / 2, 0.85)
  // where the door faces up a slope, the floor also rises until the doorstep clears its ground
  const floor = Math.max(lo, footMaxRect(c, 0, 0.45, w / 2, 0.85) - 0.35, footMaxRect(c, 0, 0.8, 1.1, 0.45) - 0.12)
  // the brow is a half-ellipsoid over (0, -1.1): radii 0.682 w across, 0.62 w deep, 0.341 w tall
  const browR = w * 0.62
  const browY = floor + 2.3
  const browAt = (lx: number, lz: number) => {
    const q = 1 - (lx / (browR * 1.1)) ** 2 - ((lz + 1.1) / browR) ** 2
    return q > 0 ? browY + browR * 0.55 * Math.sqrt(q) : -Infinity
  }
  const chx = 0.9, chz = -2.6
  const [cx, cz] = at(c, chx, chz)
  const chimneyTop = Math.max(c.ground(cx, cz) + 1.55, browAt(chx, chz) + 0.45)
  return { w, lo, floor, browR, browY, chx, chz, chimneyTop }
}

/** A cottage's size, plinth floor and chimney: shared by the builder and chimneyTop. */
function cottageFrame(c: PropContext) {
  const w = P(c, 'width', PLACE_FOOTPRINT.cottage.width) * c.scale
  const L = P(c, 'length', PLACE_FOOTPRINT.cottage.length) * c.scale
  const h = P(c, 'height', 3.2) * c.scale
  const roofH = 0.5 * (w + 0.8)
  const { floor, foot } = plinth(c, w / 2 + 0.15, L / 2 + 0.15)
  // the chimney stack rises from the footing through the back slope of the roof
  const chimneyH = h + roofH * 0.8
  return { w, L, h, roofH, floor, foot, chx: 1.6 * (w / 6), chz: -1.2 * (L / 8), chimneyH, chimneyTop: floor + 0.6 + chimneyH }
}

/** The water mill's fixed size, plinth floor and chimney. */
function millFrame(c: PropContext) {
  const w = PLACE_FOOTPRINT.waterMill.width, L = PLACE_FOOTPRINT.waterMill.length, h = 5
  const { floor, foot } = plinth(c, w / 2 + 0.2, L / 2 + 0.2)
  return { w, L, h, floor, foot, chx: -2.2, chz: -2.4, chimneyTop: floor + h + 3.2 }
}

/**
 * World position of the top of a piece's chimney, from the same floor and footprint the builder
 * uses, so chimney smoke starts where the chimney is drawn. Null for kinds without one (and for
 * cottages built with `chimney: false`).
 */
export function chimneyTop(kind: string, c: PropContext): [number, number, number] | null {
  let f: { chx: number; chz: number; chimneyTop: number }
  if (kind === 'smial') f = smialFrame(c)
  else if (kind === 'cottage') {
    if (!B(c, 'chimney', true)) return null
    f = cottageFrame(c)
  } else if (kind === 'waterMill') f = millFrame(c)
  else return null
  const [x, z] = at(c, f.chx, f.chz)
  return [x, f.chimneyTop, z]
}

/** How far the turf must stand above the ground to be a wall: a knee, the most one wades through. */
const BROW_KNEE = 0.3

/**
 * Solids for the earth and turf behind a smial's facade (turfBank and the brow dome): where the
 * hill has buried them, or they stand less than BROW_KNEE proud of it, the knoll is ground to walk
 * on; elsewhere they are a wall. Rows run across the knoll, each solid along the stretches where
 * the drawn turf (the dome, or the bank's top at its rim) stands more than BROW_KNEE above the
 * drawn ground at the row's middle, ends found where the height crosses it. Rows are 0.2 m deep,
 * halved (down to 5 cm) where the stretch at one edge of a row ends more than 0.2 m from where it
 * ends at the other, as it does where the knee line runs nearly across the rows. So the solid's
 * outline follows the line where turf meets ground to within a few centimetres, wherever the
 * hill happens to lie.
 */
function browSolids(c: PropContext, browR: number, browY: number) {
  if (!c.colliders) return
  const rx = browR * 1.1, cz = -1.1, zBack = cz - browR
  // the drawn turf: the bank's top out to the ellipse, and over it the dome, whose ten-sided rim
  // cuts in from the ellipse by up to 5% between its corners (taken all round, to err low)
  const turf = (lx: number, lz: number) => {
    const q = 1 - (lx / (rx * 0.95)) ** 2 - ((lz - cz) / (browR * 0.95)) ** 2
    return browY + browR * 0.55 * Math.sqrt(Math.max(0, q))
  }
  const proud = (lx: number, lz: number) => turf(lx, lz) - c.ground(...at(c, lx, lz))
  // the stretches of local z = lz where the turf stands above the knee: [start, end, top] each
  const runsAt = (lz: number): [number, number, number][] => {
    const runs: [number, number, number][] = []
    const half = rx * Math.sqrt(Math.max(0, 1 - ((lz - cz) / browR) ** 2))
    if (half < 0.05) return runs
    const n = Math.max(2, Math.ceil((2 * half) / 0.1))
    let start = NaN, top = -Infinity
    let px = -half, pp = proud(px, lz)
    if (pp > BROW_KNEE) start = px
    for (let i = 1; i <= n; i++) {
      const x = -half + (2 * half * i) / n, p = proud(x, lz)
      // where the row crosses the knee line between two samples (the ground is straight there to
      // well under the sample spacing)
      const cross = px + ((BROW_KNEE - pp) / (p - pp)) * (x - px)
      if (pp <= BROW_KNEE && p > BROW_KNEE) start = cross
      if (p > BROW_KNEE) top = Math.max(top, turf(x, lz))
      const end = pp > BROW_KNEE && p <= BROW_KNEE ? cross : p > BROW_KNEE && i === n ? x : NaN
      if (!Number.isNaN(end) && !Number.isNaN(start)) {
        if (end - start > 0.05) runs.push([start, end, Math.max(top, turf(start, lz))])
        start = NaN
        top = -Infinity
      }
      px = x
      pp = p
    }
    return runs
  }
  const extent = (runs: [number, number, number][]) => (runs.length ? [runs[0][0], runs[runs.length - 1][1]] : [0, 0])
  const row = (za: number, zb: number) => {
    const [sa, ea] = extent(runsAt(za)), [sb, eb] = extent(runsAt(zb))
    if (zb - za > 0.06 && (Math.abs(sa - sb) > 0.2 || Math.abs(ea - eb) > 0.2)) {
      row(za, (za + zb) / 2)
      row((za + zb) / 2, zb)
      return
    }
    for (const [start, end, top] of runsAt((za + zb) / 2)) solidBox(c, (start + end) / 2, (za + zb) / 2, (end - start) / 2, (zb - za) / 2, 0, c.rot, { top })
  }
  const rows = Math.ceil(-zBack / 0.2)
  for (let r = 0; r < rows; r++) row(zBack + (-zBack * r) / rows, zBack + (-zBack * (r + 1)) / rows)
}

export const PLACE_KINDS: Record<string, Builder> = {
  /** A hobbit-hole dug into a hillside: round door, round windows, turf brow, chimney, path, fence. */
  smial(c, out) {
    const { w, lo, floor, browR, browY, chx, chz, chimneyTop: chTop } = smialFrame(c)
    const wall = S(c, 'wall', '#c9a978')
    const doorColor = S(c, 'doorColor', '#2f7a45')
    // facade sunk into the slope, its skirt reaching below the lowest ground in front
    column(c, out, 0, 0, w, 0.8, lo - 0.15, floor + 3.0, wall)
    const [fx, fz] = at(c, 0, 0)
    out.push({ geo: box(w + 0.6, 0.35, 1.0), color: '#8a6a4a', position: [fx, floor + 3.05, fz], rotation: [0, c.rot, 0] })
    // turf brow blending into the hill: a half-ellipsoid closed underneath at its rim, so the part
    // over the door is a solid eave from below, not an open shell to see into, and the brow is one
    // solid with the bank under it (the cap's ten corners are the dome rim's)
    const [bx, bz] = at(c, 0, -1.1)
    const turf = S(c, 'turf', '#7fb85a')
    const cap = new THREE.CircleGeometry(browR, 10)
    cap.rotateX(Math.PI / 2)
    const brow = mergeGeometries([dome(browR), cap]) ?? dome(browR)
    out.push({ geo: brow, color: turf, position: [bx, browY, bz], rotation: [0, c.rot, 0], scale: [1.1, 0.55, 1.0] })
    // and the earth under it down to the ground, behind the facade's middle
    out.push({ geo: turfBank(c, browR * 1.1, browR, -1.1, browY, 0), color: turf })
    // round door in the middle, brass knob in the exact centre (as a hobbit door should have)
    const [dx, dz] = at(c, 0, 0.42)
    out.push({ geo: disc(1.08, 0.3, 16), color: '#5a4030', position: [dx, floor + 1.25, dz], rotation: [0, c.rot, 0] })
    out.push({ geo: disc(0.92, 0.36, 16), color: doorColor, position: [dx, floor + 1.25, dz], rotation: [0, c.rot, 0] })
    const [kx, kz] = at(c, 0, 0.62)
    out.push({ geo: sphere(0.08, 6, 4), color: BRASS, position: [kx, floor + 1.25, kz], unlit: true })
    // doorstep at the sill, deep enough to meet the ground in front; where the hillside falls
    // away in front of it, a stair runs on down (built last, below)
    column(c, out, 0, 0.8, 2.2, 0.9, Math.min(footMinRect(c, 0, 0.8, 1.1, 0.45) - 0.05, floor - 0.01), floor + 0.17, STEP_STONE)
    const treads = stairPlan(c, 0, 1.25, 1.1, floor + 0.17)
    // windows and flower boxes
    for (const s of [-1, 1]) {
      const wx = s * (w * 0.34)
      roundWindow(c, out, wx, 0.4, floor + 1.85)
      flowerBox(c, out, wx, 0.6, floor + 1.28, c.seed + s)
    }
    // chimney poking out of the hill behind, from below its own ground up to the shared top
    const [cx, cz] = at(c, chx, chz)
    const chBase = footMinDisc(c, chx, chz, 0.34) - 0.05
    out.push({ geo: cyl(0.3, 0.34, chTop - 0.1 - chBase, 6), color: '#8a5a3a', position: [cx, (chTop - 0.1 + chBase) / 2, cz] })
    out.push({ geo: cyl(0.4, 0.4, 0.2, 6), color: '#6a4a30', position: [cx, chTop - 0.1, cz] })
    // stepping-stone path down from the door, each stone laid on the slope it sits on
    const pathLen = P(c, 'path', 6)
    // (a stair covers the first stones; they stay, so the part list is the same on any ground)
    for (let i = 0; i < Math.ceil(pathLen / 1.1); i++) {
      const [px, pz] = at(c, (hash2(c.seed, i) - 0.5) * 0.4, 1.6 + i * 1.1)
      // 3 cm into the ground, 8 cm proud of it
      const { matrix, above } = laid({ ...c, x: px, z: pz, rot: hash2(i, c.seed) * 3 }, 0.46, 0.9)
      out.push({ geo: cyl(0.42, 0.46, above + 0.11, 7), color: i % 2 ? STEP_STONE : '#a89d88', position: [0, (above + 0.05) / 2, 0], matrix })
    }
    // bench beside the door: a level seat on a board that runs down to the ground along its length
    const benchX = -w * 0.5 + 0.2
    const seatY = footMaxRect(c, benchX, 1.3, 0.65, 0.2) + 0.48
    const [sx, sz] = at(c, benchX, 1.3)
    out.push({ geo: box(1.3, 0.1, 0.4), color: '#a07a52', position: [sx, seatY, sz], rotation: [0, c.rot, 0] })
    out.push({ geo: groundStrip(c, benchX - 0.55, benchX + 0.55, 1.3, 0.1, (lx) => minAcross(c, lx, 1.3, 0.1) - 0.05, () => seatY - 0.03), color: '#8a6a4a' })
    // low fence with a gate gap along the front of the garden: posts sunk into their own ground,
    // rails sloping from post to post, as deep as the fence's solid so it stands where they are
    if (B(c, 'fence', true)) {
      const fenceZ = pathLen + 1.8
      const half = w * 0.5 + 2.4
      for (const side of [-1, 1]) {
        const segStart = side * 1.1
        const segEnd = side * half
        const n = Math.ceil(Math.abs(segEnd - segStart) / 1.6)
        let prevX = 0, prevG = 0
        for (let i = 0; i <= n; i++) {
          const lx = segStart + ((segEnd - segStart) * i) / n
          const [px, pz] = at(c, lx, fenceZ)
          const g = c.ground(px, pz)
          const bottom = footMinDisc(c, lx, fenceZ, 0.09) - 0.15
          out.push({ geo: cyl(0.07, 0.09, g + 1.0 - bottom, 5), color: '#8a6a4a', position: [px, (g + 1.0 + bottom) / 2, pz] })
          if (i > 0) {
            out.push({ geo: rail(c, prevX, prevG + 0.76, lx, g + 0.76, fenceZ, 0.08, 0.12), color: '#a07a52' })
            out.push({ geo: rail(c, prevX, prevG + 0.41, lx, g + 0.41, fenceZ, 0.08, 0.12), color: '#a07a52' })
          }
          prevX = lx
          prevG = g
        }
        const mid = (segStart + segEnd) / 2
        solidBox(c, mid, fenceZ, Math.abs(segEnd - segStart) / 2, 0.12)
      }
    }
    // facade (up to the door's face) and its window boxes, which hang at head height and so are
    // open underneath for anyone on lower ground; the doorstep to stand on (a wall where it is too
    // tall to climb) and the stair down from it; the bench; the chimney where it leaves the hill
    solidBox(c, 0, 0.075, w / 2, 0.425, 3.2, c.rot, { top: floor + 3.2 })
    for (const s of [-1, 1]) solidBox(c, s * (w * 0.34), 0.6, 0.5, 0.16, 0, c.rot, { top: floor + 1.41, bottom: floor + 1.15 })
    stepDeck(c, 0, 0.35, 1.25, 1.1, floor + 0.17, floor + 0.17)
    solidBox(c, benchX, 1.3, 0.65, 0.2, 0, c.rot, { top: seatY + 0.05 })
    solidCircle(c, chx, chz, 0.32, 0, { top: chTop })
    browSolids(c, browR, browY)
    stair(c, out, 0, 1.25, 1.1, treads)
  },

  /** Timber-and-plaster cottage with a gable roof; `inn: true` adds a sign board and lanterns. */
  cottage(c, out) {
    const { w, L, h, roofH, floor: y, foot, chx, chz, chimneyH } = cottageFrame(c)
    const wall = S(c, 'wall', '#e6dcc4')
    const roofColor = S(c, 'roof', '#a3703e')
    out.push({ geo: box(w, h, L), color: wall, position: [c.x, y + h / 2, c.z], rotation: [0, c.rot, 0] })
    // stone footing, down to below the lowest ground under the walls
    out.push({ geo: box(w + 0.3, y + 0.6 - foot, L + 0.3), color: '#8f8d86', position: [c.x, (y + 0.6 + foot) / 2, c.z], rotation: [0, c.rot, 0] })
    // timber beams on the front and sides
    for (const lx of [-w / 2 + 0.3, 0, w / 2 - 0.3]) {
      const [bx, bz] = at(c, lx, L / 2 + 0.05)
      out.push({ geo: box(0.16, h, 0.16), color: '#5a4030', position: [bx, y + h / 2, bz], rotation: [0, c.rot, 0] })
    }
    for (const s of [-1, 1]) {
      const [bx, bz] = at(c, (s * w) / 2 + 0.02, 0)
      out.push({ geo: box(0.14, 0.16, L), color: '#5a4030', position: [bx, y + h * 0.55, bz], rotation: [0, c.rot, 0] })
    }
    const roof = gableRoofLow(w + 0.8, L + 0.6, 0.5)
    out.push({ geo: roof, color: roofColor, position: [c.x, y + h + roofBase(roof) - 0.2, c.z], rotation: [0, c.rot, 0] })
    // ridge beam and eaves boards break up the roof slab
    out.push({ geo: box(0.36, 0.3, L + 0.9), color: '#5a4030', position: [c.x, y + h + roofH - 0.15, c.z], rotation: [0, c.rot, 0] })
    for (const sd of [-1, 1]) {
      const [ex, ez] = at(c, (sd * (w + 0.8)) / 2, 0)
      out.push({ geo: box(0.18, 0.34, L + 0.7), color: '#5a4030', position: [ex, y + h - 0.05, ez], rotation: [0, c.rot, 0] })
    }
    // door + windows on the front (+z). `storeys` repeats the window rows up the wall, which is
    // what makes a three-storey inn read as three storeys rather than one very tall cottage.
    const [dx, dz] = at(c, -w * 0.2, L / 2 + 0.12)
    out.push({ geo: box(1.1, 2.1, 0.2), color: S(c, 'doorColor', '#4a3626'), position: [dx, y + 1.05, dz], rotation: [0, c.rot, 0] })
    const storeys = Math.max(1, Math.round(P(c, 'storeys', 1)))
    const floorH = h / storeys
    for (let k = 0; k < storeys; k++) {
      // no window where there is no wall left; measured from the floor, so the outcome does not
      // hang on rounding at whatever height the floor happens to be (a 4.6 m two-storey wall
      // ends exactly at its top window)
      if (1.7 + k * floorH + 0.6 > h + 1e-6) break
      const fy = y + 1.7 + k * floorH
      // upper storeys get a second front window where the door is below
      const front = k === 0 ? [w * 0.25] : [w * 0.25, -w * 0.2]
      for (const lx of front) {
        const [wx, wz] = at(c, lx, L / 2 + 0.1)
        out.push({ geo: box(1.0, 1.0, 0.2), color: '#5a4030', position: [wx, fy, wz], rotation: [0, c.rot, 0] })
        out.push({ geo: box(0.8, 0.8, 0.26), color: GLASS, position: [wx, fy, wz], rotation: [0, c.rot, 0], unlit: true })
      }
      for (const s of [-1, 1]) {
        for (const lz of [-L * 0.25, L * 0.25]) {
          const [wx, wz] = at(c, (s * w) / 2 + 0.05, lz)
          out.push({ geo: box(0.2, 0.9, 0.9), color: '#5a4030', position: [wx, fy + 0.1, wz], rotation: [0, c.rot, 0] })
          out.push({ geo: box(0.26, 0.7, 0.7), color: GLASS, position: [wx, fy + 0.1, wz], rotation: [0, c.rot, 0], unlit: true })
        }
      }
    }
    if (B(c, 'chimney', true)) {
      const [cx, cz] = at(c, chx, chz)
      out.push({ geo: box(0.7, chimneyH, 0.7), color: '#8a5a3a', position: [cx, y + chimneyH / 2 + 0.6, cz], rotation: [0, c.rot, 0] })
    }
    if (B(c, 'inn')) {
      // hanging sign on a bracket, lanterns either side of the door
      const [sx, sz] = at(c, w / 2 + 0.6, L / 2 - 0.4)
      out.push({ geo: box(1.3, 0.1, 0.1), color: '#4a3626', position: [sx, y + 2.9, sz], rotation: [0, c.rot + Math.PI / 2, 0] })
      out.push({ geo: box(1.1, 0.8, 0.08), color: S(c, 'sign', '#3f8a46'), position: [sx, y + 2.35, sz], rotation: [0, c.rot + Math.PI / 2, 0] })
      for (const lx of [-w * 0.2 - 1.0, -w * 0.2 + 1.0]) {
        const [lxw, lzw] = at(c, lx, L / 2 + 0.3)
        out.push({ geo: sphere(0.2, 6, 5), color: '#ffd27a', position: [lxw, y + 2.4, lzw], unlit: true })
      }
    }
    solidBox(c, 0, 0, w / 2 + 0.15, L / 2 + 0.15, h + roofH, c.rot, { top: y + h + roofH })
    doorSteps(c, out, -w * 0.2, L / 2 + 0.15, 0.7, y)
  },

  /**
   * A gate barring a road where it pierces a hedge: two posts, a head beam, a name board and
   * two leaves. `open` runs 0 (shut across the road) to 1 (swung back flat against the posts);
   * the leaves are solid wherever they hang, so an open gate leaves the road clear between them.
   */
  townGate(c, out) {
    const w = P(c, 'width', PLACE_FOOTPRINT.townGate.width) * c.scale
    const h = P(c, 'height', 2.6) * c.scale
    const wood = S(c, 'wood', '#5f462e')
    const open = Math.max(0, Math.min(1, P(c, 'open', 0.85)))
    const y = c.ground(c.x, c.z)
    const half = w / 2 + 0.3
    const ph = h + 0.9
    // both posts rise to the same top above the higher one's ground, so the beam rests on both
    const gTop = Math.max(...[-1, 1].map((s) => {
      const [px, pz] = at(c, s * half, 0)
      return c.ground(px, pz)
    }))
    const postTop = gTop + ph

    for (const s of [-1, 1]) {
      const [px, pz] = at(c, s * half, 0)
      column(c, out, s * half, 0, 0.46, 0.46, footMinRect(c, s * half, 0, 0.23, 0.23) - 0.1, postTop, wood)
      out.push({ geo: cone(0.38, 0.42, 4), color: '#43301f', position: [px, postTop + 0.2, pz], rotation: [0, c.rot + Math.PI / 4, 0] })
      solidCircle(c, s * half, 0, 0.4, ph, { top: postTop })
    }
    // head beam across the posts, with a board hung under it
    out.push({ geo: box(w + 1.5, 0.3, 0.38), color: wood, position: [c.x, gTop + h + 0.78, c.z], rotation: [0, c.rot, 0] })
    if (B(c, 'board', true)) {
      out.push({ geo: box(1.9, 0.46, 0.1), color: S(c, 'boardColor', '#cbb98e'), position: [c.x, gTop + h + 0.34, c.z], rotation: [0, c.rot, 0] })
    }

    // each leaf hinges on its own post and swings outward (toward local -z) as `open` rises
    const phi = open * (Math.PI / 2) * 0.95
    const leaf = w / 2 - 0.1
    for (const s of [-1, 1]) {
      const dirX = -s * Math.cos(phi)
      const dirZ = -Math.sin(phi)
      // the leaf's local direction is angle psi from local +x; at() turns local angles the other
      // way from three.js yaw, so the leaf's own boxes take yaw c.rot - psi
      const psi = Math.atan2(dirZ, dirX)
      const bars = Math.max(3, Math.round(leaf / 0.42))
      for (let i = 0; i <= bars; i++) {
        const d = (leaf * i) / bars
        const lx = s * half + dirX * d, lz = dirZ * d
        // the leaf's top stays level; each bar reaches down to its own ground
        const bottom = Math.min(footMinRect(c, lx, lz, 0.055, 0.055) - 0.05, y + h - 0.2)
        const [bx, bz] = at(c, lx, lz)
        out.push({ geo: box(0.11, y + h - bottom, 0.11), color: wood, position: [bx, (y + h + bottom) / 2, bz], rotation: [0, c.rot, 0] })
      }
      for (const ry of [h * 0.26, h * 0.76]) {
        const [rx, rz] = at(c, s * half + (dirX * leaf) / 2, (dirZ * leaf) / 2)
        out.push({ geo: box(leaf, 0.14, 0.12), color: wood, position: [rx, y + ry, rz], rotation: [0, c.rot - psi, 0] })
      }
      solidBox(c, s * half + (dirX * leaf) / 2, (dirZ * leaf) / 2, leaf / 2, 0.12, h, c.rot - psi, { top: y + h })
    }
  },

  /** A pony standing where it was left: the inn is named for one, and the yard should have one. */
  pony(c, out) {
    const s = c.scale
    const coat = S(c, 'coat', '#9b7246')
    const mane = S(c, 'mane', '#4a3524')
    const leg = 0.62 * s
    const body = 1.5 * s
    // the body is level at the legs' mean ground, each leg reaching its own ground; on a slope
    // steep enough to bury the uphill legs at that height the body rises until every leg shows
    // at least half its length, so no leg is built with a negative height
    const legs: [number, number][] = []
    for (const fx of [body * 0.3, -body * 0.3]) for (const fz of [-0.22 * s, 0.22 * s]) legs.push([fx, fz])
    let y = 0, legHi = -Infinity
    for (const [fx, fz] of legs) {
      const [lx, lz] = at(c, fx, fz)
      const g = c.ground(lx, lz)
      y += g / legs.length
      legHi = Math.max(legHi, footMaxDisc(c, fx, fz, 0.075 * s))
    }
    y = Math.max(y, legHi - leg * 0.5)
    out.push({ geo: box(body, 0.66 * s, 0.62 * s), color: coat, position: [c.x, y + leg + 0.33 * s, c.z], rotation: [0, c.rot, 0] })
    // neck and head, reaching down toward the grass
    const [nx, nz] = at(c, body * 0.42, 0)
    out.push({ geo: box(0.34 * s, 0.6 * s, 0.4 * s), color: coat, position: [nx, y + leg + 0.68 * s, nz], rotation: [0, c.rot, -0.5] })
    const [hx, hz] = at(c, body * 0.66, 0)
    out.push({ geo: box(0.46 * s, 0.3 * s, 0.3 * s), color: coat, position: [hx, y + leg + 0.86 * s, hz], rotation: [0, c.rot, -0.2] })
    const [mx, mz] = at(c, body * 0.84, 0)
    out.push({ geo: box(0.2 * s, 0.22 * s, 0.26 * s), color: mane, position: [mx, y + leg + 0.78 * s, mz], rotation: [0, c.rot, -0.2] })
    for (const e of [-1, 1]) {
      const [ex, ez] = at(c, body * 0.52, e * 0.12 * s)
      out.push({ geo: cone(0.07 * s, 0.17 * s, 5), color: coat, position: [ex, y + leg + 1.06 * s, ez] })
    }
    // mane and tail
    const [max, maz] = at(c, body * 0.3, 0)
    out.push({ geo: box(0.1 * s, 0.5 * s, 0.3 * s), color: mane, position: [max, y + leg + 0.78 * s, maz], rotation: [0, c.rot, -0.5] })
    const [tx, tz] = at(c, -body * 0.52, 0)
    out.push({ geo: box(0.12 * s, 0.56 * s, 0.2 * s), color: mane, position: [tx, y + leg + 0.3 * s, tz], rotation: [0, c.rot, 0.25] })
    for (const [fx, fz] of legs) {
      const [lx, lz] = at(c, fx, fz)
      const bottom = footMinDisc(c, fx, fz, 0.075 * s) - 0.05
      out.push({ geo: cyl(0.075 * s, 0.065 * s, y + leg - bottom, 5), color: coat, position: [lx, (y + leg + bottom) / 2, lz] })
    }
    // tail to nose along local x, as wide as the body
    solidBox(c, 0.19 * s, 0, 1.03 * s, 0.33 * s, 1.6 * s, c.rot, { top: y + 1.6 * s })
  },

  /** Stone mill with a water wheel on its local +x side (place that side toward the river). */
  waterMill(c, out) {
    const { w, L, h, floor: y, foot, chx, chz, chimneyTop: chTop } = millFrame(c)
    out.push({ geo: box(w, h, L), color: S(c, 'wall', '#a8a094'), position: [c.x, y + h / 2, c.z], rotation: [0, c.rot, 0] })
    // stone base: down to the lowest ground under the mill, into the river on the wheel side
    out.push({ geo: box(w + 0.4, y + 0.8 - foot, L + 0.4), color: '#7d7a72', position: [c.x, (y + 0.8 + foot) / 2, c.z], rotation: [0, c.rot, 0] })
    const roof = gableRoofLow(w + 0.8, L + 0.6, 0.55)
    out.push({ geo: roof, color: S(c, 'roof', '#6a4a30'), position: [c.x, y + h + roofBase(roof) - 0.25, c.z], rotation: [0, c.rot, 0] })
    out.push({ geo: box(0.4, 0.3, L + 1.0), color: '#4a3626', position: [c.x, y + h + 0.55 * (w + 0.8) - 0.2, c.z], rotation: [0, c.rot, 0] })
    // door and windows
    const [dx, dz] = at(c, 0, L / 2 + 0.12)
    out.push({ geo: box(1.6, 2.4, 0.2), color: '#4a3626', position: [dx, y + 1.2, dz], rotation: [0, c.rot, 0] })
    for (const lz of [-2, 2]) {
      const [wx, wz] = at(c, -w / 2 - 0.05, lz)
      out.push({ geo: box(0.2, 1.0, 1.0), color: '#5a4030', position: [wx, y + 2.6, wz], rotation: [0, c.rot, 0] })
      out.push({ geo: box(0.26, 0.8, 0.8), color: GLASS, position: [wx, y + 2.6, wz], rotation: [0, c.rot, 0], unlit: true })
    }
    // chimney
    const [cx, cz] = at(c, chx, chz)
    out.push({ geo: box(0.9, chTop - y, 0.9), color: '#8a5a3a', position: [cx, (chTop + y) / 2, cz], rotation: [0, c.rot, 0] })
    // wheel: axle through the wall, rim, spokes, paddles; dips into the water
    const R = P(c, 'wheel', 3.4)
    const [wx, wz] = at(c, w / 2 + 1.1, 0)
    // axle just above the mill floor; the rim dips into the water below the bank, so where a
    // tall base has lifted the floor, the wheel hangs lower against the wall to keep it wet
    const wy = c.ground(wx, wz) < c.seaLevel ? Math.min(y + 1.1, c.seaLevel + R - 0.35) : y + 1.1
    const wheelRot: [number, number, number] = [0, c.rot + Math.PI / 2, 0]
    out.push({ geo: cyl(0.16, 0.16, 2.6, 6), color: '#4a3626', position: [wx - Math.cos(c.rot) * 0.6, wy, wz + Math.sin(c.rot) * 0.6], rotation: [0, c.rot, Math.PI / 2] })
    out.push({ geo: disc(R, 0.25, 14), color: '#7a5230', position: [wx, wy, wz], rotation: wheelRot })
    out.push({ geo: disc(R - 0.5, 0.35, 14), color: '#a07a52', position: [wx, wy, wz], rotation: wheelRot })
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const px = Math.cos(a) * R, py = Math.sin(a) * R
      // paddle offsets lie in the wheel plane (local z/y), so rotate the offset with the prop
      const ox = -Math.sin(c.rot) * px
      const oz = -Math.cos(c.rot) * px
      out.push({ geo: box(0.5, 0.18, 0.7), color: '#5a4030', position: [wx + ox, wy + py, wz + oz], rotation: [0, c.rot + Math.PI / 2, a] })
    }
    // mill race: a wooden channel feeding the wheel
    const [rx, rz] = at(c, w / 2 + 1.1, -4)
    out.push({ geo: box(1.2, 0.5, 6), color: '#6a4a30', position: [rx, wy + R * 0.6, rz], rotation: [0, c.rot, 0] })
    for (const lz of [-6.5, -2.5]) {
      const [px, pz] = at(c, w / 2 + 1.1, lz)
      // into the bank, or just under the water where the bank is under water; where the bank
      // rises above the race (a mill on a steep slope) the post is a stub under it, never inverted
      const gy = Math.min(Math.max(footMinDisc(c, w / 2 + 1.1, lz, 0.16) - 0.1, c.seaLevel - 0.3), wy + R * 0.6 - 0.1)
      out.push({ geo: cyl(0.14, 0.16, wy + R * 0.6 - gy, 5), color: '#4a3626', position: [px, (wy + R * 0.6 + gy) / 2, pz] })
    }
    solidBox(c, 0, 0, w / 2 + 0.2, L / 2 + 0.2, h + 4, c.rot, { top: y + h + 4 })
    // the wheel stands in the plane of local z, so its solid is thin in x and as long as it is round
    solidBox(c, w / 2 + 1.1, 0, 0.25, R, 2, c.rot, { top: wy + R })
    doorSteps(c, out, 0, L / 2 + 0.2, 0.9, y)
  },

  /** The Party Tree: one enormous oak with paper lanterns hung in the lower boughs. */
  partyTree(c, out) {
    const s = P(c, 'scale', 1) * c.scale
    const y = c.ground(c.x, c.z)
    const trunkH = 9 * s
    // the trunk keeps its top and flares down to below the lowest ground under its foot
    const base = footMinDisc(c, 0, 0, 1.7 * s) - 0.1
    out.push({ geo: cyl(1.0 * s, 1.7 * s, y + trunkH - base, 9), color: '#6b4a2f', position: [c.x, (y + trunkH + base) / 2, c.z] })
    // roots, each sunk into its own ground
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4
      const rx = c.x + Math.cos(a) * 1.7 * s, rz = c.z + Math.sin(a) * 1.7 * s
      out.push({ geo: cyl(0.25 * s, 0.6 * s, 2.6 * s, 5), color: '#5a3d28', position: [rx, c.ground(rx, rz) + 0.25 * s, rz], rotation: [Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1] })
    }
    // boughs
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.9
      out.push({ geo: cyl(0.3 * s, 0.6 * s, 5 * s, 6), color: '#6b4a2f', position: [c.x + Math.cos(a) * 2.6 * s, y + trunkH - 1.2 * s, c.z + Math.sin(a) * 2.6 * s], rotation: [Math.sin(a) * 1.0, 0, -Math.cos(a) * 1.0] })
    }
    const canopy = ['#5bab4a', '#6fbd58', '#4f9a63', '#8fd05a', '#5bab4a', '#6cbf5a']
    const blobs: [number, number, number, number][] = [
      [0, trunkH + 4.5 * s, 0, 6.2 * s],
      [4.6 * s, trunkH + 2.6 * s, 1.5 * s, 4.2 * s],
      [-4.2 * s, trunkH + 3.0 * s, -2.0 * s, 4.4 * s],
      [1.0 * s, trunkH + 2.4 * s, -4.6 * s, 4.0 * s],
      [-1.6 * s, trunkH + 2.8 * s, 4.4 * s, 4.1 * s],
      [0.6 * s, trunkH + 8.4 * s, 0.4 * s, 3.8 * s],
    ]
    blobs.forEach(([dx, dy, dz, r], i) => {
      out.push({ geo: dodeca(r), color: canopy[i], position: [c.x + dx, y + dy, c.z + dz], rotation: [hash2(i, 1) * 2, hash2(i, 2) * 2, 0] })
    })
    // lanterns
    const n = P(c, 'lanterns', 14)
    const lanternColours = ['#ffd27a', '#ff9a6a', '#ffe6a8', '#c8ff9a']
    for (let i = 0; i < n; i++) {
      const a = hash2(i, 7) * Math.PI * 2
      const d = (3 + hash2(i, 8) * 4.5) * s
      const ly = y + trunkH - (1.5 + hash2(i, 9) * 3.5) * s
      const lx = c.x + Math.cos(a) * d, lz = c.z + Math.sin(a) * d
      out.push({ geo: cyl(0.01, 0.01, 1.2, 3), color: '#3a2a20', position: [lx, ly + 0.8, lz] })
      out.push({ geo: sphere(0.28, 7, 5), color: lanternColours[i % lanternColours.length], position: [lx, ly, lz], unlit: true })
    }
    solidCircle(c, 0, 0, 1.7 * s, 9 * s, { top: y + trunkH })
  },

  /** Open-sided party pavilion: poles, a canvas roof and bunting. */
  pavilion(c, out) {
    const R = P(c, 'radius', 9)
    const y = c.ground(c.x, c.z)
    const canvas = S(c, 'canvas', '#f0e2c0')
    const ground = surf(c)
    const poleBase = footMinDisc(c, 0, 0, 0.2) - 0.1
    out.push({ geo: cyl(0.16, 0.2, y + 8.5 - poleBase, 6), color: '#8a6a4a', position: [c.x, (y + 8.5 + poleBase) / 2, c.z] })
    solidCircle(c, 0, 0, 0.22, 8.5, { top: y + 8.5 })
    out.push({ geo: cone(R + 0.8, 4.2, 10), color: canvas, position: [c.x, y + 6.6, c.z] })
    out.push({ geo: cyl(R + 0.9, R + 0.9, 0.6, 10), color: '#c9542f', position: [c.x, y + 4.4, c.z] })
    for (let i = 0; i < 10; i++) {
      // the ring is laid out in world axes, unturned by the prop's rotation
      const a = (i / 10) * Math.PI * 2
      const px = c.x + Math.cos(a) * R, pz = c.z + Math.sin(a) * R
      // down into its own ground; on ground that climbs past the canvas (9 m out on a steep
      // slope) the pole is a stub under the rim rather than a pole of negative height
      const bottom = Math.min(ground.footprintMin(px, pz, 0.12) - 0.1, y + 4.5)
      out.push({ geo: cyl(0.1, 0.12, y + 4.6 - bottom, 5), color: '#8a6a4a', position: [px, (y + 4.6 + bottom) / 2, pz] })
      const [plx, plz] = toLocal(c, px, pz)
      solidCircle(c, plx, plz, 0.18, 4.6, { top: y + 4.6 })
      // bunting between poles
      const a2 = ((i + 0.5) / 10) * Math.PI * 2
      for (let k = 0; k < 3; k++) {
        const t = (k + 0.5) / 3
        const ang = a + (a2 - a) * 2 * t
        const bx = c.x + Math.cos(ang) * R, bz = c.z + Math.sin(ang) * R
        out.push({ geo: box(0.32, 0.4, 0.03), color: FLOWER_COLOURS[(i + k) % FLOWER_COLOURS.length], position: [bx, y + 4.0 - Math.sin(t * Math.PI) * 0.4, bz], rotation: [0, -ang + Math.PI / 2, 0] })
      }
    }
    out.push({ geo: box(0.08, 1.6, 1.4), color: '#e84a5f', position: [c.x, y + 9.2, c.z + 0.7], rotation: [0, c.rot, 0] })
  },

  /** Rows of long trestle tables with benches, laid for a birthday party. */
  tables(c, out) {
    const rows = P(c, 'rows', 3)
    const len = P(c, 'length', 7)
    const gap = P(c, 'gap', 3.2)
    for (let i = 0; i < rows; i++) {
      const lz = (i - (rows - 1) / 2) * gap
      const [tx, tz] = at(c, 0, lz)
      // a level top over the higher trestle's ground; each trestle reaches down to its own
      const legX = [-len / 2 + 0.6, len / 2 - 0.6]
      const ty = Math.max(...legX.map((lx) => footMaxRect(c, lx, lz, 0.06, 0.5))) + 0.82
      out.push({ geo: box(len, 0.1, 1.2), color: '#e8dcc0', position: [tx, ty, tz], rotation: [0, c.rot, 0] })
      for (const lx of legX) column(c, out, lx, lz, 0.12, 1.0, footMinRect(c, lx, lz, 0.06, 0.5) - 0.05, ty - 0.02, '#8a6a4a')
      // benches either side, the same way on two legs each
      const benchX = [-len / 2 + 0.5, len / 2 - 0.5]
      for (const s of [-1, 1]) {
        const blz = lz + s * 1.0
        const by = Math.max(...benchX.map((lx) => footMaxRect(c, lx, blz, 0.04, 0.15))) + 0.46
        const [bx, bz] = at(c, 0, blz)
        out.push({ geo: box(len - 0.4, 0.08, 0.36), color: '#a07a52', position: [bx, by, bz], rotation: [0, c.rot, 0] })
        for (const lx of benchX) column(c, out, lx, blz, 0.08, 0.3, footMinRect(c, lx, blz, 0.04, 0.15) - 0.05, by - 0.03, '#8a6a4a')
      }
      // tableware: plates, tankards, cakes
      for (let k = 0; k < 6; k++) {
        const [px, pz] = at(c, -len / 2 + 0.8 + k * ((len - 1.6) / 5), lz + (hash2(i, k) - 0.5) * 0.5)
        const r = hash2(k, i)
        if (r < 0.4) out.push({ geo: cyl(0.22, 0.22, 0.04, 8), color: '#f8f4ea', position: [px, ty + 0.08, pz] })
        else if (r < 0.75) out.push({ geo: cyl(0.1, 0.12, 0.26, 6), color: '#b8894a', position: [px, ty + 0.18, pz] })
        else out.push({ geo: cyl(0.3, 0.32, 0.3, 8), color: FLOWER_COLOURS[k % FLOWER_COLOURS.length], position: [px, ty + 0.2, pz] })
      }
      solidBox(c, 0, lz, len / 2, 1.3, 1.0, c.rot, { top: ty + 0.18 })
    }
  },

  /** Vegetable garden: dark soil with rows of greens and a scarecrow. */
  gardenPlot(c, out) {
    const w = P(c, 'width', 6), d = P(c, 'depth', 4)
    const soil = '#4e3a2a'
    // the soil is draped over the ground (a 0.5 m grid 6 cm above it), with a shallow skirt
    // round the edge so its rim never shows a gap where the drape and the ground part
    const patch = new THREE.PlaneGeometry(w, d, Math.ceil(w / 0.5), Math.ceil(d / 0.5))
    patch.rotateX(-Math.PI / 2)
    const pos = patch.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const [x, z] = at(c, pos.getX(i), pos.getZ(i))
      pos.setXYZ(i, x, c.ground(x, z) + 0.06, z)
    }
    patch.deleteAttribute('uv')
    out.push({ geo: patch, color: soil })
    // the long edges run along local x; the short ones along local z, built in a frame turned a
    // quarter so groundStrip can run along them (local x there is -z here, local z is +x)
    const quarter: PropContext = { ...c, rot: c.rot + Math.PI / 2 }
    for (const [ctx, len, edge] of [[c, w, d / 2], [c, w, -d / 2], [quarter, d, w / 2], [quarter, d, -w / 2]] as const) {
      const g = (lx: number) => {
        const [x, z] = at(ctx, lx, edge)
        return c.ground(x, z)
      }
      out.push({ geo: groundStrip(ctx, -len / 2, len / 2, edge, 0.06, (lx) => g(lx) - 0.14, (lx) => g(lx) + 0.06), color: soil })
    }
    const rows = Math.floor(d / 0.9)
    const per = Math.floor(w / 0.7)
    const greens = ['#5da54c', '#3f8a46', '#8cc86a', '#a3c24a']
    for (let r = 0; r < rows; r++) {
      const lz = -d / 2 + 0.6 + r * 0.9
      for (let k = 0; k < per; k++) {
        const [px, pz] = at(c, -w / 2 + 0.5 + k * 0.7, lz)
        const gy = c.ground(px, pz)
        const kind = (r + c.seed) % 3
        if (kind === 0) out.push({ geo: sphere(0.24, 6, 4), color: greens[(r + k) % 4], position: [px, gy + 0.24, pz], scale: [1, 0.7, 1] })
        else if (kind === 1) out.push({ geo: cone(0.16, 0.6, 5), color: greens[(r + 1) % 4], position: [px, gy + 0.34, pz] })
        else out.push({ geo: dodeca(0.2), color: r % 2 ? '#e0a458' : greens[k % 4], position: [px, gy + 0.22, pz] })
      }
    }
    if (B(c, 'scarecrow')) {
      const [sx, sz] = at(c, w / 2 - 0.5, -d / 2 + 0.4)
      const gy = c.ground(sx, sz)
      out.push({ geo: cyl(0.05, 0.05, 2.3, 4), color: '#8a6a4a', position: [sx, gy + 0.95, sz] })
      out.push({ geo: box(1.2, 0.08, 0.08), color: '#8a6a4a', position: [sx, gy + 1.6, sz], rotation: [0, c.rot, 0] })
      out.push({ geo: box(0.5, 0.7, 0.3), color: '#7a5a8a', position: [sx, gy + 1.45, sz], rotation: [0, c.rot, 0] })
      out.push({ geo: sphere(0.2, 6, 5), color: '#d9b96a', position: [sx, gy + 2.05, sz] })
      out.push({ geo: cone(0.35, 0.3, 6), color: '#c9a86a', position: [sx, gy + 2.3, sz] })
      solidCircle(c, w / 2 - 0.5, -d / 2 + 0.4, 0.3, 2.1, { top: gy + 2.1 })
    }
  },

  well(c, out) {
    // level on the high side but never buried more than 0.3 m; the stone ring runs down below
    // the lowest ground round it
    const lo = footMinDisc(c, 0, 0, 1.1)
    const y = Math.max(lo, footMaxDisc(c, 0, 0, 1.1) - 0.3)
    out.push({ geo: cyl(1.0, 1.1, y + 1.0 - (lo - 0.1), 10), color: '#8f8d86', position: [c.x, (y + 1.0 + lo - 0.1) / 2, c.z] })
    out.push({ geo: cyl(0.75, 0.75, 1.0, 10), color: '#1d2a30', position: [c.x, y + 0.55, c.z] })
    for (const s of [-1, 1]) {
      const [px, pz] = at(c, s * 0.9, 0)
      out.push({ geo: cyl(0.08, 0.08, 2.2, 5), color: '#6a4a30', position: [px, y + 1.6, pz] })
    }
    out.push({ geo: cyl(0.06, 0.06, 1.9, 5), color: '#4a3626', position: [c.x, y + 2.2, c.z], rotation: [0, c.rot, Math.PI / 2] })
    out.push({ geo: gableRoof(2.4, 1.6), color: '#6a4a30', position: [c.x, y + 3.0, c.z], rotation: [0, c.rot + Math.PI / 2, 0] })
    out.push({ geo: cyl(0.18, 0.15, 0.3, 6), color: '#7a5230', position: [c.x, y + 1.3, c.z] })
    solidCircle(c, 0, 0, 1.15, 3, { top: y + 3 })
  },

  /** Hand cart, optionally loaded with hay or pumpkins. Built at the origin, then tilted onto the ground. */
  cart(c, out) {
    // wheels sink 6 cm, so a hollow between the plane's sample points leaves no daylight under them
    const m = onPlane(c, 1.3, 0.95, 0.3, 0.06)
    const parts: Part[] = []
    parts.push({ geo: box(2.4, 0.5, 1.4), color: '#8a6a4a', position: [0, 0.95, 0] })
    parts.push({ geo: box(2.6, 0.08, 1.6), color: '#a07a52', position: [0, 0.72, 0] })
    for (const s of [-1, 1]) parts.push({ geo: disc(0.62, 0.16, 10), color: '#5a4030', position: [s * 0.85, 0.62, 0], rotation: [0, Math.PI / 2, 0] })
    for (const s of [-1, 1]) parts.push({ geo: box(0.1, 0.1, 1.6), color: '#6a4a30', position: [s * 0.5, 0.8, 1.9] })
    const load = S(c, 'load', 'hay')
    if (load === 'hay') parts.push({ geo: dodeca(0.95), color: '#d9b96a', position: [0, 1.6, 0], scale: [1.2, 0.7, 0.8] })
    else if (load === 'pumpkins') for (let i = 0; i < 5; i++) parts.push({ geo: sphere(0.3, 7, 5), color: i % 2 ? '#e8772a' : '#f29a3a', position: [(hash2(i, 1) - 0.5) * 1.6, 1.45, (hash2(i, 2) - 0.5) * 0.9], scale: [1, 0.8, 1] })
    else for (let i = 0; i < 4; i++) parts.push({ geo: cyl(0.3, 0.3, 0.6, 8), color: '#b8894a', position: [(i - 1.5) * 0.5, 1.5, 0], rotation: [Math.PI / 2, 0, 0] })
    for (const p of parts) out.push({ ...p, matrix: m })
    // the bed, and each shaft on its own: the gap between the shafts is narrower than the
    // traveller, so it needs no solid of its own
    const y = m.elements[13]
    solidBox(c, 0, 0, 1.3, 0.85, 1.6, c.rot, { top: y + 1.6 })
    for (const s of [-1, 1]) solidBox(c, s * 0.5, 1.85, 0.06, 0.85, 1, c.rot, { top: y + 1.0 })
  },

  haystack(c, out) {
    const r = P(c, 'radius', 1.6)
    const y = c.ground(c.x, c.z)
    // the cone keeps its place; the drum under it reaches the lowest ground round the stack
    const base = footMinDisc(c, 0, 0, r * 1.05) - 0.1
    out.push({ geo: cone(r, r * 1.7, 9), color: '#d9b96a', position: [c.x, y + r * 0.85, c.z], rotation: [0, c.rot, 0] })
    out.push({ geo: cyl(r * 0.95, r * 1.05, y + r * 0.7 - base, 9), color: '#c9a95a', position: [c.x, (y + r * 0.7 + base) / 2, c.z] })
    out.push({ geo: cyl(0.04, 0.04, 0.8, 4), color: '#8a6a4a', position: [c.x, y + r * 1.9, c.z] })
    solidCircle(c, 0, 0, r * 0.9, r * 1.7, { top: y + r * 1.7 })
  },

  /** Small rowing boat, placed on the nearest water. */
  boat(c0, out) {
    const [wx, wz] = findWater(c0, 40, 0.6)
    const c: PropContext = { ...c0, x: wx, z: wz }
    const y = c.seaLevel + 0.25
    const hull = c.color ?? '#7a5230'
    out.push({ geo: box(3.0, 0.6, 1.2), color: hull, position: [c.x, y, c.z], rotation: [0, c.rot, 0] })
    out.push({ geo: box(2.6, 0.2, 0.8), color: '#4a3626', position: [c.x, y + 0.2, c.z], rotation: [0, c.rot, 0] })
    const bow = cone(0.6, 0.9, 4)
    bow.rotateZ(-Math.PI / 2)
    bow.rotateY(Math.PI / 4)
    const [bx, bz] = at(c, 1.9, 0)
    out.push({ geo: bow, color: hull, position: [bx, y + 0.05, bz], rotation: [0, c.rot, 0] })
    out.push({ geo: box(0.5, 0.08, 1.1), color: '#a07a52', position: [c.x, y + 0.32, c.z], rotation: [0, c.rot, 0] })
    for (const s of [-1, 1]) {
      const [ox, oz] = at(c, 0.2, s * 0.9)
      out.push({ geo: box(2.2, 0.06, 0.06), color: '#a07a52', position: [ox, y + 0.5, oz], rotation: [0, c.rot + s * 0.5, 0] })
    }
  },

  /** Wooden signpost with one or two boards pointing along local +x / -x. */
  signpost(c, out) {
    const y = c.ground(c.x, c.z)
    const base = footMinDisc(c, 0, 0, 0.11) - 0.1
    out.push({ geo: cyl(0.09, 0.11, y + 2.6 - base, 6), color: '#6a4a30', position: [c.x, (y + 2.6 + base) / 2, c.z] })
    const boards = P(c, 'boards', 1)
    for (let i = 0; i < boards; i++) {
      const [bx, bz] = at(c, (i % 2 ? -1 : 1) * 0.5, 0)
      out.push({ geo: box(1.5, 0.34, 0.08), color: '#c9a86a', position: [bx, y + 2.3 - i * 0.5, bz], rotation: [0, c.rot + (i % 2 ? 0.25 : -0.15), 0] })
    }
    solidCircle(c, 0, 0, 0.13, 2.6, { top: y + 2.6 })
  },

  /** Gate arch with lanterns and a ring of glowing stones: marks a doorway between worlds. */
  gateArch(c, out) {
    const w = P(c, 'width', 3.2)
    const h = P(c, 'height', 3.4)
    const wood = S(c, 'wood', '#6a4a30')
    const postG = [-1, 1].map((s) => {
      const [px, pz] = at(c, (s * w) / 2, 0)
      return c.ground(px, pz)
    })
    // both posts reach the height of the higher one, so the head beam rests on both
    const gTop = Math.max(...postG)
    for (const s of [-1, 1]) {
      const [px, pz] = at(c, (s * w) / 2, 0)
      const gy = postG[(s + 1) / 2]
      const bottom = footMinDisc(c, (s * w) / 2, 0, 0.2) - 0.1
      out.push({ geo: cyl(0.16, 0.2, gTop + h - bottom, 7), color: wood, position: [px, (gTop + h + bottom) / 2, pz] })
      out.push({ geo: sphere(0.2, 7, 5), color: '#ffd27a', position: [px, gy + h * 0.72, pz], unlit: true })
      out.push({ geo: box(0.3, 0.3, 0.3), color: '#3a2a20', position: [px, gy + h * 0.72 + 0.28, pz] })
      solidCircle(c, (s * w) / 2, 0, 0.3, h, { top: gTop + h })
    }
    out.push({ geo: box(w + 0.8, 0.28, 0.3), color: wood, position: [c.x, gTop + h + 0.05, c.z], rotation: [0, c.rot, 0] })
    out.push({ geo: box(w * 0.5, 0.5, 0.1), color: '#c9a86a', position: [c.x, gTop + h - 0.35, c.z], rotation: [0, c.rot, 0] })
    // climbing flowers on the posts, from each post's own ground
    for (const s of [-1, 1]) {
      const gy = postG[(s + 1) / 2]
      for (let i = 0; i < 4; i++) {
        const [px, pz] = at(c, (s * w) / 2 + (hash2(i, s) - 0.5) * 0.5, (hash2(i, 3) - 0.5) * 0.5)
        out.push({ geo: sphere(0.13, 5, 4), color: FLOWER_COLOURS[(i + s + 2) % FLOWER_COLOURS.length], position: [px, gy + 0.6 + i * 0.7, pz] })
      }
    }
    // glowing stones marking the threshold, each sunk a little below the lowest ground under it
    // so a slope never shows air under its downhill side
    const R = P(c, 'ring', 2.4)
    const ground = surf(c)
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2
      const px = c.x + Math.cos(a) * R, pz = c.z + Math.sin(a) * R
      out.push({ geo: dodeca(0.16), color: '#bfe8ff', position: [px, ground.footprintMin(px, pz, 0.16) + 0.06, pz], unlit: true })
    }
  },
}
