/**
 * `greatHall`: Meduseld, the great timber hall of the kings of the Mark (Edoras spec A.1).
 *
 * Read from the books, in our own design: a long, wide hall of dark timber on a stone footing,
 * framed in heavy posts, under a steep roof whose thatch shines like gold from far off. The great
 * doors are in the +z gable end, shut, on iron strap hinges between gilded posts and lintel; small
 * high windows sit under the deep eaves on one long side only; two louvres on the ridge let out
 * the smoke of the long hearth. Weapons stand racked outside the doors (no one goes armed before
 * the king). No porch and no pillars unless asked for; no finials, carvings, ridge ornaments or flag.
 *
 * Frame: the origin is the hall's centre; local x runs across, local z along the ridge, and the
 * doors face local +z. `c.scale` is ignored: every size is in metres.
 *
 * The roof is built here rather than with gableRoofLow (whose eaves reach 0.59 x its width and
 * whose ends run 4% long): courses of thatch, each standing a little proud of the one below, a
 * darker ridge roll, eaves boards, and plain bargeboards cut square. Its underside sits on the wall
 * plates at the eaves height and runs `eaves` metres past each long wall; the ridge roll's top is
 * at floor + height + pitch * (width + 2 eaves). The gables are half-hipped by default: boarded up
 * to a beam, then the thatch turns down over the top of each gable as a hip of the same pitch, so
 * the roof shows gold from end-on (from the ford, the forecourt and the doors), not only from the
 * side. `hip: 0` gives a plain gable, its bargeboards stopping short of the apex (never crossed).
 *
 * Params (all optional): width 16, length 40, height 6 (eaves above the floor), pitch 0.55 (rise
 * over the roof's span), eaves 1.2, hip 0.6 (the hip's share of the gable's width at its foot),
 * porch 0, pillars 0 (only with a porch), doors 'shut' | 'open', louvres 2, windows 6,
 * windowSide -1 (local x side; 0 = both), weapons false; colours roof, wall, gable, trim,
 * doorPosts, plinthColor, glow (the window light).
 */
import * as THREE from 'three'
import type { Part } from '@/render/mergeColoured'
import { hash2 } from '@/terrain/faceColors'
import { type PropContext, P, S, B, at, plinth, footMinRect, footMaxRect, solidBox, solidCircle, box, cyl, gableRoofLow, roofBase } from '../propUtil'
import { stepDeck, doorSteps } from '../placeUtil'

/** Default size, full extents in metres along local x (width) and local z (length); not scaled. */
export const GREAT_HALL_FOOTPRINT = { width: 16, length: 40 } as const

/** vertical thickness of the thatch at the eaves */
const THATCH = 0.75
/** each course of thatch stands this much proud of the one below it */
const COURSE = 0.12
const COURSES = 3
/** the ridge roll's height above the top courses' apex */
const CAP = 0.28
/** the roof's overhang past each gable wall */
const VERGE = 1.0
/** the stone footing's course above the floor, under the sill beams */
const FOOTING = 0.5
/** the louvres: timber body to this height above the ridge, then a dark vent band, then a small roof */
const LOUVRE_BODY = 0.35
const LOUVRE_VENT = 0.55
const LOUVRE_RISE = 1.0

/**
 * The hall's size, floor and roof line, and where the smoke leaves: shared by the builder,
 * chimneyTop and the town map, so the three cannot drift. Heights are world y.
 */
export function greatHallFrame(c: PropContext) {
  const w = P(c, 'width', GREAT_HALL_FOOTPRINT.width)
  const L = P(c, 'length', GREAT_HALL_FOOTPRINT.length)
  const h = P(c, 'height', 6)
  const pitch = P(c, 'pitch', 0.55)
  const eaves = Math.max(0, P(c, 'eaves', 1.2))
  const porch = Math.max(0, P(c, 'porch', 0))
  /** half-hip: the share of each gable's width the hip takes at its foot (0 = a plain gable) */
  const hip = Math.min(0.9, Math.max(0, P(c, 'hip', 0.6)))
  const { floor, foot } = plinth(c, w / 2 + 0.2, L / 2 + porch + 0.2)
  const span = w + 2 * eaves
  const rise = pitch * span
  const thatch = THATCH + (COURSES - 1) * COURSE
  // slope of the roof's underside, which sits on the wall plates at the eaves height
  const slope = Math.max(0.3, (rise - thatch - CAP) / (w / 2))
  /** top of the thatch at the ridge, and top of the ridge roll (the hall's highest line) */
  const apex = floor + h + (slope * w) / 2 + thatch
  const ridge = apex + CAP
  const nl = Math.max(0, Math.round(P(c, 'louvres', 2)))
  const louvreZ = nl === 1 ? [0] : Array.from({ length: nl }, (_, i) => -L / 4 + (i * L) / 2 / (nl - 1))
  const louvreTop = ridge + LOUVRE_BODY + LOUVRE_VENT + LOUVRE_RISE
  return {
    w,
    L,
    h,
    eaves,
    porch,
    hip,
    floor,
    foot,
    span,
    slope,
    apex,
    ridge,
    louvreZ,
    /** the body collider's half extents (and the map footprint's) */
    hw: w / 2 + 0.2,
    hd: L / 2 + 0.2,
    /** smoke from the first louvre's roof */
    chx: 0,
    chz: louvreZ[0] ?? 0,
    chimneyTop: louvreTop,
  }
}

/** A prism: the polygon `pts` (local x, y) extruded along local z from z0 to z1. */
function prism(pts: [number, number][], z0: number, z1: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
  const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false, steps: 1 })
  g.translate(0, 0, z0)
  return g
}

type V3 = [number, number, number]

/**
 * A closed convex solid from its faces (polygons of [x, y, z] points, in any winding): each face is
 * turned to face away from the solid's centre, so it lights and culls the right way.
 */
function convex(faces: V3[][]): THREE.BufferGeometry {
  const all = faces.flat()
  const cen = [0, 1, 2].map((i) => all.reduce((acc, p) => acc + p[i], 0) / all.length)
  const pos: number[] = []
  for (const f of faces) {
    const [p0, p1, p2] = f
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]]
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const fc = [0, 1, 2].map((i) => f.reduce((acc, p) => acc + p[i], 0) / f.length)
    const out = n[0] * (fc[0] - cen[0]) + n[1] * (fc[1] - cen[1]) + n[2] * (fc[2] - cen[2]) >= 0
    for (let i = 1; i < f.length - 1; i++) {
      const tri = out ? [f[0], f[i], f[i + 1]] : [f[0], f[i + 1], f[i]]
      for (const p of tri) pos.push(p[0], p[1], p[2])
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return g
}

export function greatHall(c: PropContext, out: Part[]): void {
  const f = greatHallFrame(c)
  const { w, L, h, eaves, porch, floor: y, foot, slope, apex, ridge } = f
  const roofC = S(c, 'roof', '#d6a640')
  const wallC = S(c, 'wall', '#6f4e30')
  const trim = S(c, 'trim', '#4a3626')
  const gold = S(c, 'doorPosts', '#d9b24a')
  const stone = S(c, 'plinthColor', '#8f8d86')
  const gableC = S(c, 'gable', '#7a5838')
  const ridgeC = '#b8862e'
  const doorC = '#3a2a1a'
  const iron = '#2a2a2a'
  const hw = w / 2, hl = L / 2

  /** a part in the hall's local frame at world height py */
  const put = (geo: THREE.BufferGeometry, color: string, lx: number, py: number, lz: number, extra: Partial<Part> = {}) => {
    const [x, z] = at(c, lx, lz)
    out.push({ geo, color, position: [x, py, z], rotation: [0, c.rot, 0], ...extra })
  }
  /** an upright box in local axes between world heights */
  const block = (lx: number, lz: number, sx: number, sz: number, bottom: number, top: number, color: string) =>
    put(box(sx, Math.max(0.02, top - bottom), sz), color, lx, (top + bottom) / 2, lz)
  /** a prism built in the hall's frame, heights relative to the floor */
  const frame = (geo: THREE.BufferGeometry, color: string) => put(geo, color, 0, y, 0)

  // ---- stone footing: a course all round under the sill beams, open at the doorway ----
  const sill = y + FOOTING
  const fw = hw + 0.2
  const doorGap = 2.45 // outer faces of the gilded door-posts
  for (const s of [-1, 1]) block(s * (hw + 0.1), 0, 0.2, L + 0.4, foot, sill, stone)
  block(0, -hl - 0.1, w, 0.2, foot, sill, stone)
  for (const s of [-1, 1]) block(s * (doorGap + fw) / 2, hl + 0.1, fw - doorGap, 0.2, foot, sill, stone)
  // the threshold: a stone sill under the doors that also carries the gilded posts' bases
  const sillOut = 0.64
  block(0, hl + sillOut / 2, 2 * 2.54, sillOut, foot, y + 0.03, stone)
  if (porch > 0) block(0, hl + porch / 2 + 0.1, 0.62 * w, porch + 0.2, foot, y + 0.05, stone)

  // ---- the roof's lines, in the hall's frame relative to the floor ----
  const Lr = L + 2 * VERGE
  const xe = hw + eaves
  /** the roof's underside at |local x| = ax: it sits on the wall plates and runs on out to the eaves */
  const under = (ax: number) => h + slope * (hw - ax)
  // The side courses run the whole length to the verges; the top course rises from xc to the ridge
  // and, on a half-hipped roof, turns down at each end as a hip of the same pitch over the top of
  // the gable, so the thatch shows gold from end-on too.
  const hipped = f.hip > 0.05
  const xc = hipped ? hw * f.hip : xe / 3
  const bounds = [xe, (xe + xc) / 2, xc]
  const clipY = under(xc)
  const zr = hipped ? Math.max(0.5, Lr / 2 - xc) : Lr / 2

  // ---- walls: dark planking, a little darker toward the foot ----
  put(box(w, h, L), wallC, 0, y + h / 2, 0, { shade: (_x, py) => (py < y + h / 2 ? 0.84 : 1) })
  // gable boarding under the roof's underside, flush with the end walls: up to the hip on a
  // half-hipped roof, to the apex on a plain one
  const gableTop = h + slope * hw
  for (const s of [-1, 1]) {
    const z0 = s > 0 ? hl - 0.3 : -hl, z1 = s > 0 ? hl : -hl + 0.3
    const pts: [number, number][] = hipped
      ? [[-hw, h - 0.05], [hw, h - 0.05], [xc, clipY], [-xc, clipY]]
      : [[-hw, h - 0.05], [hw, h - 0.05], [0, gableTop]]
    frame(prism(pts, z0, z1), gableC)
  }

  // ---- timber framing ----
  // long walls: sill beam on the footing, posts at a bay rhythm of about 5 m, wall plate
  const bays = Math.max(2, Math.round(L / 5))
  for (const s of [-1, 1]) {
    block(s * (hw + 0.08), 0, 0.3, L + 0.3, sill, sill + 0.3, trim)
    block(s * (hw + 0.08), 0, 0.36, L + 0.4, y + h - 0.36, y + h, trim)
    for (let i = 0; i <= bays; i++) block(s * (hw + 0.06), -hl + (i * L) / bays, 0.4, 0.4, sill + 0.3, y + h - 0.36, trim)
  }
  // gable ends: a tie beam at the eaves; above it the boarding framed by a beam under the hip
  // and three posts (a queen-post truss face on a plain gable); below it a sill beam and two
  // posts each side (the front pair stands behind the weapon racks)
  for (const s of [-1, 1]) {
    const fz = s * (hl + 0.08)
    block(0, s * (hl + 0.1), w + 0.7, 0.42, y + h - 0.45, y + h, trim)
    if (hipped) {
      block(0, fz, 2 * xc + 0.5, 0.22, y + clipY - 0.32, y + clipY, trim)
      for (const q of [-1, 0, 1]) block(q * (xc - 0.15), fz, 0.3, 0.2, y + h, y + clipY - 0.32, trim)
    } else {
      const quarter = hw / 2, collarY = y + under(quarter)
      block(0, fz, w * 0.5 + 0.3, 0.2, collarY - 0.3, collarY, trim)
      block(0, fz, 0.3, 0.2, collarY, y + gableTop - 0.12, trim)
      for (const q of [-1, 1]) block(q * quarter, fz, 0.3, 0.2, y + h, collarY - 0.3, trim)
    }
    for (const q of [-1, 1]) block(q * 5.2 * (w / 16), fz, 0.36, 0.24, sill + 0.3, y + h - 0.45, trim)
    if (s < 0) block(0, -hl - 0.1, w + 0.3, 0.3, sill, sill + 0.3, trim)
    else for (const q of [-1, 1]) block(q * (doorGap + hw + 0.15) / 2, hl + 0.1, hw + 0.15 - doorGap, 0.3, sill, sill + 0.3, trim)
  }

  // ---- the roof: thatch in courses, hips, ridge roll, eaves boards, bargeboards ----
  // the side courses, each standing COURSE proud of the one below; the eaves course a shade deeper
  const tones = ['#cf9f3c', roofC]
  for (const sd of [-1, 1])
    for (let k = 0; k < 2; k++) {
      const xo = bounds[k], xi = bounds[k + 1], t = THATCH + k * COURSE
      const pts: [number, number][] = [
        [sd * xo, under(xo)],
        [sd * xo, under(xo) + t],
        [sd * xi, under(xi) + t],
        [sd * xi, under(xi)],
      ]
      frame(prism(pts, -Lr / 2, Lr / 2), tones[k])
    }
  // the top course over the ridge, and on a half-hipped roof a hip at each end
  const tTop = THATCH + 2 * COURSE
  const a = apex - y
  frame(prism([[-xc, clipY], [xc, clipY], [xc, clipY + tTop], [0, a], [-xc, clipY + tTop]], -zr, zr), roofC)
  if (hipped)
    for (const s of [-1, 1]) {
      const b0: V3 = [-xc, clipY, s * zr], b1: V3 = [xc, clipY, s * zr], b2: V3 = [xc, clipY + tTop, s * zr], b4: V3 = [-xc, clipY + tTop, s * zr]
      const R: V3 = [0, a, s * zr]
      const zf = (s * Lr) / 2
      const f0: V3 = [-xc, clipY, zf], f1: V3 = [xc, clipY, zf], f2: V3 = [xc, clipY + tTop, zf], f3: V3 = [-xc, clipY + tTop, zf]
      frame(convex([[b0, b1, f1, f0], [f0, f1, f2, f3], [f3, f2, R], [b1, b2, f2, f1], [b2, R, f2], [b0, f0, f3, b4], [b4, f3, R]]), roofC)
      // an eaves board under the hip's edge, like the long sides'
      block(0, s * (Lr / 2 + 0.05), 2 * xc + 0.1, 0.1, y + clipY - 0.05, y + clipY + 0.25, trim)
    }
  // the ridge roll: a darker saddle of thatch along the apex, its lower edges a lip proud of the roof
  {
    const cw = 1.05, lo = a - slope * cw, end = zr + (hipped ? 0.25 : 0.15)
    const pts: [number, number][] = [[-cw, lo - 0.05], [0, a - 0.45], [cw, lo - 0.05], [cw, lo + 0.17], [0.35, a + CAP], [-0.35, a + CAP], [-cw, lo + 0.17]]
    frame(prism(pts, -end, end), ridgeC)
  }
  // eaves boards along the foot of each long side's thatch
  for (const sd of [-1, 1]) block(sd * (xe + 0.05), 0, 0.1, Lr + 0.1, y + under(xe) - 0.05, y + under(xe) + 0.25, trim)
  // plain bargeboards under the thatch's edge on the gables, cut square; on a plain gable they
  // stop short of the apex (no crossed ends)
  {
    const x0 = hipped ? xc : 0.3, x1 = xe + 0.05
    const len = (x1 - x0) * Math.sqrt(1 + slope * slope)
    const tilt = Math.atan(slope)
    const xm = (x0 + x1) / 2
    for (const s of [-1, 1])
      for (const sd of [-1, 1]) {
        const [bx, bz] = at(c, sd * xm, s * (Lr / 2 + 0.07))
        out.push({ geo: box(len, 0.34, 0.14), color: trim, position: [bx, y + under(xm) - 0.06, bz], rotation: [0, c.rot, -sd * tilt] })
      }
  }

  // ---- louvres on the ridge: timber body, dark vent band, a small thatched roof ----
  for (const lz of f.louvreZ) {
    const vb = ridge + LOUVRE_BODY
    block(0, lz, 1.5, 2.4, apex - 1.0, vb, trim)
    block(0, lz, 1.3, 2.2, vb, vb + LOUVRE_VENT, '#231a12')
    const b = vb + LOUVRE_VENT - 0.1 - y
    frame(
      prism(
        [
          [-1.25, b],
          [1.25, b],
          [1.25, b + 0.22],
          [0, b + LOUVRE_RISE + 0.1],
          [-1.25, b + 0.22],
        ],
        lz - 1.6,
        lz + 1.6,
      ),
      roofC,
    )
  }

  // ---- small high windows under the eaves, on one long side (both when windowSide is 0) ----
  const nw = Math.max(0, Math.round(P(c, 'windows', 6)))
  const side = P(c, 'windowSide', -1)
  const sides = side === 0 ? [-1, 1] : [side < 0 ? -1 : 1]
  // centred in the bays, leaving the end bays blank when there are bays to spare
  const skip = nw <= bays - 2 ? 1 : 0
  const usable = bays - 2 * skip
  // just under the eaves' edge, so the deep eaves do not hide them from the paving
  const wy = y + under(xe) - 0.4
  for (let i = 0; i < nw; i++) {
    const bay = nw <= usable ? skip + Math.floor(((i + 0.5) * usable) / nw) : -1
    const lz = bay >= 0 ? -hl + ((bay + 0.5) * L) / bays : -hl + ((i + 0.5) * L) / nw
    for (const sd of sides) {
      block(sd * (hw + 0.05), lz, 0.18, 1.75, wy - 0.5, wy + 0.5, trim)
      put(box(0.2, 0.68, 1.36), S(c, 'glow', '#9c7a46'), sd * (hw + 0.07), wy, lz, { unlit: true })
    }
  }

  // ---- the great doors between gilded posts and lintel ----
  const front = hl
  if (S(c, 'doors', 'shut') === 'open') {
    // a pitch-dark doorway (there is no interior)
    put(box(3.6, 4.6, 0.05), '#0b0805', 0, y + 2.3, front + 0.02, { unlit: true })
  } else {
    put(box(3.6, 4.6, 0.25), doorC, 0, y + 2.3, front + 0.1)
    block(0, front + 0.24, 0.07, 0.05, y + 0.05, y + 4.55, '#1c140c')
    // great iron strap hinges, three a leaf, running in from an iron hinge bar on the post side
    for (const s of [-1, 1]) {
      block(s * 1.74, front + 0.26, 0.12, 0.09, y + 0.6, y + 4.0, iron)
      for (const hy of [0.9, 2.3, 3.7]) block(s * 1.1, front + 0.25, 1.36, 0.05, y + hy - 0.07, y + hy + 0.07, iron)
    }
  }
  for (const s of [-1, 1]) {
    block(s * 2.15, front + 0.25, 0.6, 0.6, y, y + 5.2, gold)
    block(s * 2.15, front + 0.25, 0.78, 0.78, y, y + 0.35, gold)
    block(s * 2.15, front + 0.25, 0.76, 0.76, y + 4.82, y + 5.1, gold)
  }
  block(0, front + 0.25, 5.4, 0.6, y + 5.1, y + 5.7, gold)

  // ---- weapons left outside the doors: a rack each side with spears, a sword and a green shield ----
  if (B(c, 'weapons')) {
    // pieces leaning toward the wall are tilted about the hall's own x axis, then turned with it
    const M = new THREE.Matrix4().makeRotationY(c.rot).setPosition(c.x, 0, c.z)
    const tilted = (geo: THREE.BufferGeometry, color: string, lx: number, py: number, lz: number, rx: number, rz: number) =>
      out.push({ geo, color, position: [lx, py, lz], rotation: [rx, 0, rz], matrix: M })
    for (const s of [-1, 1]) {
      const rx = s * 4.6, rz = hl + 0.45
      // each rack stands on its own ground: level with the floor at Edoras; elsewhere on the high
      // side of the ground under it, its posts reaching down to the low side
      const ry = footMaxRect(c, rx, rz + 0.2, 1.3, 0.35), rlo = footMinRect(c, rx, rz + 0.2, 1.3, 0.35)
      block(rx, rz, 2.6, 0.12, ry + 1.54, ry + 1.66, trim)
      for (const px of [-1.2, 1.2]) block(rx + px, rz, 0.12, 0.12, rlo - 0.1, ry + 1.7, trim)
      // four spears leaning on the rail, heads up
      for (let k = 0; k < 4; k++) {
        const lean = 0.11 + 0.04 * hash2(c.seed + k, s)
        const roll = 0.08 * (hash2(k, c.seed + 3 * s) - 0.5)
        const lx = rx - s * 0.95 + s * k * 0.36
        const fz = rz + 0.1 + 1.6 * Math.tan(lean)
        // open-ended: the foot is on the paving and the head covers the top
        tilted(new THREE.CylinderGeometry(0.035, 0.035, 2.5, 3, 1, true), '#6a5238', lx, ry + 1.25 * Math.cos(lean), fz - 1.25 * Math.sin(lean), -lean, roll)
        tilted(new THREE.ConeGeometry(0.06, 0.26, 3, 1, true), '#9a9a9a', lx, ry + 2.63 * Math.cos(lean), fz - 2.63 * Math.sin(lean), -lean, roll)
      }
      // a sword hung on the rail by its cross-guard, blade down
      const sx = rx + s * 0.75
      block(sx, rz + 0.1, 0.07, 0.03, ry + 0.64, ry + 1.66, '#9a9a9a')
      block(sx, rz + 0.1, 0.32, 0.07, ry + 1.66, ry + 1.74, iron)
      // a round green shield leaning against the rack's foot, its rim resting on the paving: the
      // centre stands at the tilted disc's lowest point, less a centimetre
      const shieldLean = 0.22
      tilted(cyl(0.42, 0.42, 0.08, 8), '#2f6b3a', rx + s * 0.25, ry + 0.42 * Math.cos(shieldLean) + 0.04 * Math.sin(shieldLean) - 0.01, rz + 0.32, Math.PI / 2 - shieldLean, 0)
      solidBox(c, rx, rz + 0.1, 1.35, 0.25, 0, c.rot, { top: ry + 2 })
    }
  }

  // ---- porch (only if asked for; Meduseld has none) ----
  if (porch > 0) {
    const pr = gableRoofLow(w * 0.62, porch + 0.6, 0.5)
    put(pr, roofC, 0, y + h * 0.82 + roofBase(pr), hl + porch / 2)
    stepDeck(c, 0, hl, hl + porch, w * 0.3, y, y)
  }
  const npl = porch > 0 ? Math.max(0, Math.round(P(c, 'pillars', 0))) : 0
  for (let i = 0; i < npl; i++) {
    const lx = -w * 0.28 + (i * w * 0.56) / Math.max(1, npl - 1)
    put(cyl(0.32, 0.38, h * 0.82, 8), gold, lx, y + (h * 0.82) / 2, hl + porch - 0.4)
    solidCircle(c, lx, hl + porch - 0.4, 0.38, 0, { top: y + h * 0.82 })
  }

  // ---- colliders: one body box over the walls and roof (she cannot go in), the door-posts ----
  solidBox(c, 0, 0, f.hw, f.hd, 0, c.rot, { top: ridge })
  for (const s of [-1, 1]) solidBox(c, s * 2.15, front + 0.25, 0.39, 0.39, 0, c.rot, { top: y + 5.7 })
  // steps down to falling ground (none on the Edoras platform), in front of the posts and sill
  doorSteps(c, out, 0, hl + Math.max(porch, sillOut), doorGap, y)
}
