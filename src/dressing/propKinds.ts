/**
 * Procedural set pieces for landmark dressings. Each kind turns a Prop description into a list of
 * coloured primitives in world coordinates. Deliberately chunky and low-poly; kit models can
 * replace them later without touching the data files.
 *
 * Everything stands on the drawn terrain (c.ground is the surface the mesh shows). Pieces never
 * take one ground sample and hope: upright ones reach down to the lowest ground under their
 * footprint with their tops left where they were, long runs (hedges, walls, rails, quays) follow
 * the ground with groundStrip, and loose rigid pieces are laid on the ground's plane. Colliders
 * are registered next to the piece they stand for, from the same numbers.
 */
import * as THREE from 'three'
import type { Prop } from '@/world/schema'
import { partMatrix, type Part } from '@/render/mergeColoured'
import type { Collider } from '@/player/colliderTypes'
import type { TerrainSurface } from '@/terrain/surface'
import { hash2 } from '@/terrain/faceColors'
import {
  type PropContext,
  P,
  S,
  B,
  at,
  surf,
  makePropContext,
  findWater,
  findLevel,
  footMinRect,
  footMinDisc,
  plinth,
  minAcross,
  groundStrip,
  onPlane,
  solidBox,
  solidCircle,
  solidAtWorld,
  solidFromPart,
  box,
  cyl,
  cone,
  sphere,
  dome,
  dodeca,
  gableRoof,
  gableRoofLow,
  roofBase,
} from './propUtil'
import { PLACE_KINDS } from './placeKinds'

export type { PropContext } from './propUtil'

type Builder = (c: PropContext, out: Part[]) => void

/**
 * Default sizes of the line pieces, shared with the 2-D map so its hedges, fences, walls, quays
 * and bridges are drawn at the size the builders give them.
 */
export const PROP_FOOTPRINT = {
  hedge: { length: 20, depth: 1.2, ringRadius: 20 },
  fence: { length: 16 },
  wall: { length: 30, thickness: 3 },
  quay: { length: 24, width: 4 },
  bridge: { length: 14, width: 3.2 },
} as const

const TREE_PALETTES: Record<string, { canopy: string[]; trunk: string }> = {
  default: { canopy: ['#5bab4a', '#6fbd58', '#4f9a63'], trunk: '#6b4a2f' },
  golden: { canopy: ['#e0b43a', '#f2d060', '#d9a02c'], trunk: '#b8b8c0' },
  dark: { canopy: ['#1f4d33', '#2f6b45', '#2a5a3c'], trunk: '#3a2a20' },
  willow: { canopy: ['#5a7a3a', '#7a9a4a', '#6a8a44'], trunk: '#4a3a2a' },
  holly: { canopy: ['#2f6b3a', '#3a7a44'], trunk: '#5a4a3a' },
  dead: { canopy: [], trunk: '#3a312e' },
  old: { canopy: ['#3a6236', '#548446', '#4a7438'], trunk: '#4a4a3a' },
  pine: { canopy: ['#2c6f5a', '#4c9a7a', '#2f7a45'], trunk: '#5a3d28' },
}

/** The same prop seen from another origin and heading: for kinds that lay pieces round a ring or a scatter. */
const moved = (c: PropContext, x: number, z: number, rot: number): PropContext => ({ ...c, x, z, rot })

/** An upright cylinder from `bottom` to `top` at (x, z). */
const post = (rt: number, rb: number, bottom: number, top: number, seg: number, color: string, x: number, z: number): Part => ({
  geo: cyl(rt, rb, top - bottom, seg),
  color,
  position: [x, (top + bottom) / 2, z],
})

/** An upright box from `bottom` to `top` at (x, z), turned by `rot`. */
const block = (w: number, d: number, bottom: number, top: number, color: string, x: number, z: number, rot: number): Part => ({
  geo: box(w, top - bottom, d),
  color,
  position: [x, (top + bottom) / 2, z],
  rotation: [0, rot, 0],
})

const lm = new THREE.Matrix4()
const lv = new THREE.Vector3()
const lb = new THREE.Box3()
/**
 * Lay a rigid piece on the ground at (x, z): a fallen stone, a paved disc. `part` is built round
 * the origin with only its own rotation; this lifts its bottom to y = 0, tilts it to the ground's
 * plane with onPlane, then lowers it until none of its bottom corners shows air (onPlane only
 * checks a 5x5 grid, which the piece's corners need not lie on).
 */
function laid(c: PropContext, x: number, z: number, part: Part, maxTilt = 0.3, sink = 0.05): Part {
  const pos = part.geo.attributes.position
  part.position = [0, 0, 0]
  partMatrix(part, lm)
  lb.makeEmpty()
  for (let i = 0; i < pos.count; i++) lb.expandByPoint(lv.fromBufferAttribute(pos, i).applyMatrix4(lm))
  part.position = [0, -lb.min.y, 0]
  partMatrix(part, lm)
  const m = onPlane(moved(c, x, z, 0), Math.max(-lb.min.x, lb.max.x), Math.max(-lb.min.z, lb.max.z), maxTilt, sink)
  let gap = -Infinity
  for (let i = 0; i < pos.count; i++) {
    lv.fromBufferAttribute(pos, i).applyMatrix4(lm)
    if (lv.y > 0.05) continue // only the corners it rests on
    lv.applyMatrix4(m)
    gap = Math.max(gap, lv.y - c.ground(lv.x, lv.z))
  }
  if (gap > -sink) m.premultiply(new THREE.Matrix4().makeTranslation(0, -(gap + sink), 0))
  part.matrix = m
  return part
}

export const KINDS: Record<string, Builder> = {
  ...PLACE_KINDS,
  tower(c, out) {
    const h = P(c, 'height', 20) * c.scale
    const r = P(c, 'radius', 2.5) * c.scale
    const sides = P(c, 'sides', 8)
    const lift = P(c, 'lift', 0)
    const tiers = P(c, 'tiers', 1)
    const color = c.color ?? '#8f8d86'
    const g = c.ground(c.x, c.z) + lift
    // the first tier reaches down to the lowest ground under it; everything above stays put
    const base = Math.min(g, footMinDisc(c, 0, 0, r * 1.06) - 0.1)
    let y = base
    for (let t = 0; t < tiers; t++) {
      const th = h / tiers + (t === 0 ? g - base : 0)
      const tr = r * (1 - t * 0.22)
      out.push({ geo: cyl(tr, tr * 1.06, th, sides), color, position: [c.x, y + th / 2, c.z], rotation: [0, c.rot, 0] })
      y += th
    }
    const topR = r * (1 - (tiers - 1) * 0.22)
    const roof = S(c, 'roof', 'cone')
    const roofColor = S(c, 'roofColor', '#6a6a70')
    if (roof === 'cone') out.push({ geo: cone(topR * 1.35, topR * 1.9, sides), color: roofColor, position: [c.x, y + topR * 0.95, c.z], rotation: [0, c.rot, 0] })
    else if (roof === 'spikes') {
      out.push({ geo: cone(topR * 0.55, topR * 2.6, 4), color, position: [c.x, y + topR * 1.3, c.z] })
      for (let i = 0; i < 4; i++) {
        const a = c.rot + (i * Math.PI) / 2
        out.push({ geo: cone(topR * 0.3, topR * 1.6, 4), color, position: [c.x + Math.cos(a) * topR * 0.75, y + topR * 0.8, c.z + Math.sin(a) * topR * 0.75] })
      }
    } else if (roof === 'flat') out.push({ geo: cyl(topR * 1.18, topR * 1.18, 0.8, sides), color, position: [c.x, y + 0.4, c.z], rotation: [0, c.rot, 0] })
    else if (roof === 'broken') {
      for (let i = 0; i < 5; i++) {
        const a = c.rot + (i / 5) * Math.PI * 2
        const bh = 1 + hash2(i, 3) * 3
        out.push({ geo: box(topR * 0.6, bh, 0.8), color, position: [c.x + Math.cos(a) * topR * 0.85, y + bh / 2, c.z + Math.sin(a) * topR * 0.85], rotation: [0, -a, 0] })
      }
    }
    const glow = c.params.glow
    if (typeof glow === 'string') out.push({ geo: sphere(topR * 0.5), color: glow, position: [c.x, y + topR * 0.6, c.z], unlit: true })
    const banner = c.params.banner
    if (typeof banner === 'string') {
      out.push({ geo: cyl(0.08, 0.08, 4, 4), color: '#5a4a3a', position: [c.x, y + topR * 1.9 + 2, c.z] })
      out.push({ geo: box(0.1, 1.2, 2.2), color: banner, position: [c.x, y + topR * 1.9 + 3.2, c.z + 1.1], rotation: [0, c.rot, 0] })
    }
    solidCircle(c, 0, 0, r * 1.06, h, { top: g + h })
  },

  wallRing(c, out) {
    const R = P(c, 'radius', 20) * c.scale
    const h = P(c, 'height', 8) * c.scale
    const th = P(c, 'thickness', 3)
    const lift = P(c, 'lift', 0)
    const gapAngle = P(c, 'gapAngle', NaN)
    const gapWidth = P(c, 'gapWidth', 0)
    const color = c.color ?? '#8f8d86'
    const n = Math.max(8, Math.ceil((2 * Math.PI * R) / 5))
    const segLen = (2 * Math.PI * R) / n
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      if (!Number.isNaN(gapAngle)) {
        const d = Math.abs(((a - gapAngle + Math.PI) % (Math.PI * 2)) - Math.PI)
        if (d < gapWidth / 2) continue
      }
      // each segment runs along the ring's tangent, its foot below the lowest ground across it
      const seg = moved(c, c.x + Math.cos(a) * R, c.z + Math.sin(a) * R, -a + Math.PI / 2)
      const top = (lx: number) => seg.ground(...at(seg, lx, 0)) + lift + h
      out.push({ geo: groundStrip(seg, -(segLen + 0.4) / 2, (segLen + 0.4) / 2, 0, th, (lx) => minAcross(seg, lx, 0, th) - 0.2, top), color })
      if (i % 2 === 0) out.push({ geo: groundStrip(seg, -segLen * 0.25, segLen * 0.25, 0, th * 1.1, (lx) => top(lx) - 0.05, (lx) => top(lx) + 1), color })
      solidBox(seg, 0, 0, (segLen + 0.4) / 2, th / 2, lift + h)
    }
    // gate towers either side of the gap
    if (!Number.isNaN(gapAngle) && gapWidth > 0) {
      for (const s of [-1, 1]) {
        const a = gapAngle + (s * gapWidth) / 2
        const x = c.x + Math.cos(a) * R
        const z = c.z + Math.sin(a) * R
        const y = c.ground(x, z) + lift
        out.push(post(th * 0.9, th, Math.min(y, surf(c).footprintMin(x, z, th) - 0.1), y + h * 1.445, 8, color, x, z))
        solidAtWorld(c, x, z, th, lift + h * 1.445)
      }
    }
  },

  wall(c, out) {
    const L = P(c, 'length', PROP_FOOTPRINT.wall.length) * c.scale
    const h = P(c, 'height', 8) * c.scale
    const th = P(c, 'thickness', PROP_FOOTPRINT.wall.thickness)
    const color = c.color ?? '#8f8d86'
    const n = Math.max(1, Math.ceil(L / 6))
    // segment length of the strips: 0.5 m follows any ground; long rings on gentle ground pass 1
    const seg = P(c, 'seg', 0.5)
    // `level`: one top for the whole run, the highest centre-line ground along it + h (a parapet
    // whose coping stays level where the ground under it dips); otherwise the top follows the
    // centre line. The foot follows the lowest ground across it either way.
    const level = B(c, 'level')
    let lv = -Infinity
    if (level) for (let k = 0; k <= 12; k++) lv = Math.max(lv, c.ground(...at(c, -L / 2 + (k * L) / 12, 0)) + h)
    const top: (lx: number) => number = level ? () => lv : (lx) => c.ground(...at(c, lx, 0)) + h
    out.push({ geo: groundStrip(c, -L / 2 - 0.15, L / 2 + 0.15, 0, th, (lx) => minAcross(c, lx, 0, th) - 0.2, top, seg), color })
    // `cap`: a coping strip 6 cm proud of each face, in its own colour (one segment when level)
    const cap = c.params.cap
    if (typeof cap === 'string')
      out.push({ geo: groundStrip(c, -L / 2 - 0.15, L / 2 + 0.15, 0, th + 0.12, (lx) => top(lx) - 0.02, (lx) => top(lx) + 0.12, level ? L + 0.3 : seg), color: cap })
    for (let i = 0; i < n; i++) {
      const lx = -L / 2 + (i + 0.5) * (L / n)
      if (B(c, 'crenellated') && i % 2 === 0) out.push({ geo: groundStrip(c, lx - L / n / 4, lx + L / n / 4, 0, th, (u) => top(u) - 0.05, (u) => top(u) + 1.2), color })
      if (level) solidBox(c, lx, 0, L / n / 2 + 0.15, th / 2, 0, c.rot, { top: lv })
      else solidBox(c, lx, 0, L / n / 2 + 0.15, th / 2, h)
    }
  },

  hall(c, out) {
    const w = P(c, 'width', 8) * c.scale
    const L = P(c, 'length', 12) * c.scale
    const h = P(c, 'height', 5) * c.scale
    const lift = P(c, 'lift', 0)
    const color = c.color ?? '#c8b28a'
    const roofColor = S(c, 'roofColor', '#5a4030')
    // the footing runs 0.5 m past the facade so the door and arches stand on it
    const { floor, foot } = plinth(c, w / 2 + 0.15, L / 2 + 0.5)
    const y = floor + lift
    // stone footing from below the lowest ground to just above the floor
    out.push(block(w + 0.3, L + 1.0, foot, y + 0.4, '#9a958a', c.x, c.z, c.rot))
    out.push({ geo: box(w, h, L), color, position: [c.x, y + h / 2, c.z], rotation: [0, c.rot, 0] })
    // a hall's pitch, the ridge `pitch` x the width above the eaves (the bare equilateral gableRoof
    // rises a whole width); its eaves sit 0.2 m down on the wall tops, so no gap shows under them
    const roof = gableRoofLow(w, L, P(c, 'pitch', 0.5))
    out.push({ geo: roof, color: roofColor, position: [c.x, y + h + roofBase(roof) - 0.2, c.z], rotation: [0, c.rot, 0] })
    if (B(c, 'pillars')) {
      // the porch pillars stand in front of the footing, so each reaches its own ground
      for (let i = -2; i <= 2; i++) {
        const [x, z] = at(c, i * (w / 5), L / 2 + 1.2)
        out.push(post(0.35, 0.35, Math.min(y, footMinDisc(c, i * (w / 5), L / 2 + 1.2, 0.35) - 0.1), y + h, 6, '#d9c58a', x, z))
      }
    }
    if (B(c, 'arches')) {
      for (let i = -1; i <= 1; i++) {
        const [x, z] = at(c, i * (w / 3), L / 2 + 0.3)
        out.push({ geo: box(w / 3 - 0.8, h * 0.7, 0.4), color: '#6d8aa8', position: [x, y + h * 0.4, z], rotation: [0, c.rot, 0] })
      }
    }
    // door
    const [dx, dz] = at(c, 0, L / 2 + 0.05)
    out.push({ geo: box(1.6, 2.6, 0.3), color: '#3a2a1a', position: [dx, y + 1.3, dz], rotation: [0, c.rot, 0] })
    solidBox(c, 0, 0, w / 2 + 0.15, L / 2 + 0.15, 0, c.rot, { top: y + h })
  },

  hobbitHole(c, out) {
    const r = 3.4 * c.scale
    const y = c.ground(c.x, c.z) - 0.3
    // the dome's rim goes down to the lowest ground under it, stretched so its crown stays put
    const base = Math.min(y, footMinDisc(c, 0, 0, r) - 0.3)
    out.push({ geo: dome(r), color: '#7fb85a', position: [c.x, base, c.z], scale: [1, (y + r - base) / r, 1] })
    const [dx, dz] = at(c, 0, r * 0.82)
    // the door comes down with the ground in front of it rather than hang its frame in the air;
    // the frame's foot stays 0.2 m in the ground as on level ground
    const dy = Math.min(y + 1.4, footMinRect(c, 0, r * 0.82, 1.3, 0.2) + 1.1)
    const doorColor = S(c, 'doorColor', '#2f7a45')
    const disc = cyl(1.05, 1.05, 0.35, 14)
    disc.rotateX(Math.PI / 2)
    const frame = cyl(1.3, 1.3, 0.25, 14)
    frame.rotateX(Math.PI / 2)
    out.push({ geo: frame, color: '#5a4030', position: [dx, dy, dz], rotation: [0, c.rot, 0] })
    out.push({ geo: disc, color: doorColor, position: [dx, dy, dz], rotation: [0, c.rot, 0] })
    out.push({ geo: sphere(0.12, 6, 4), color: '#f2c14e', position: [dx, dy, dz], unlit: true })
    const [wx, wz] = at(c, 2.0, r * 0.7)
    out.push({ geo: box(0.9, 0.9, 0.3), color: '#f5e6a0', position: [wx, dy + 0.1, wz], rotation: [0, c.rot, 0], unlit: true })
    const [cx, cz] = at(c, -1.2, -0.5)
    out.push({ geo: cyl(0.3, 0.35, 1.2, 6), color: '#8a5a3a', position: [cx, y + r * 0.85, cz] })
  },

  bigTree(c0, out) {
    const [tx, tz] = findLevel(c0, 3, 2.5, 24)
    const c: PropContext = { ...c0, x: tx, z: tz }
    const s = P(c, 'scale', 2) * c.scale
    const pal = TREE_PALETTES[S(c, 'palette', 'default')] ?? TREE_PALETTES.default
    const y = c.ground(c.x, c.z)
    const trunkH = 4.5 * s
    // the trunk's foot reaches the lowest ground under its flare; the crown stays on the centre ground
    out.push(post(0.45 * s, 0.7 * s, footMinDisc(c, 0, 0, 0.7 * s) - 0.1, y + trunkH, 7, pal.trunk, c.x, c.z))
    solidCircle(c, 0, 0, 0.65 * s, trunkH)
    const canopies = [
      [0, trunkH + 1.6 * s, 0, 2.0 * s],
      [1.4 * s, trunkH + 1.0 * s, 0.6 * s, 1.3 * s],
      [-1.2 * s, trunkH + 1.3 * s, -0.8 * s, 1.4 * s],
      [0.3 * s, trunkH + 3.0 * s, -0.4 * s, 1.2 * s],
    ]
    canopies.forEach(([dx, dy, dz, r], i) => {
      const col = pal.canopy[i % Math.max(1, pal.canopy.length)] ?? '#5bab4a'
      out.push({ geo: dodeca(r), color: col, position: [c.x + dx, y + dy, c.z + dz], rotation: [hash2(i, 1) * 2, hash2(i, 2) * 2, 0] })
    })
    if (B(c, 'platform')) {
      out.push({ geo: cyl(2.6 * s * 0.8, 2.6 * s * 0.8, 0.3, 10), color: '#c9b48a', position: [c.x, y + trunkH * 0.72, c.z] })
      out.push({ geo: cyl(0.06, 0.06, 1.2, 4), color: '#d9c58a', position: [c.x + 2.0 * s * 0.8, y + trunkH * 0.72 + 0.6, c.z] })
      out.push({ geo: sphere(0.28, 6, 4), color: '#dfe8ff', position: [c.x + 2.0 * s * 0.8, y + trunkH * 0.72 + 1.3, c.z], unlit: true })
    }
  },

  hedge(c, out) {
    const h = P(c, 'height', 1.2)
    const color = c.color ?? '#4c8a3f'
    // A rigid box on a slope floats at one end and buries the other, so every piece is a strip
    // whose foot follows the lowest ground across the hedge and whose top follows its centre line.
    // Pieces are about 2 m long and overlap by 0.2 m; each has its own collider. `seg` is the
    // strips' segment length (0.5 m; long rings on gentle ground pass 1).
    const seg = P(c, 'seg', 0.5)
    const piece = (pc: PropContext, half: number, depth: number) => {
      out.push({ geo: groundStrip(pc, -half, half, 0, depth, (lx) => minAcross(pc, lx, 0, depth) - 0.1, (lx) => pc.ground(...at(pc, lx, 0)) + h, seg), color })
      solidBox(pc, 0, 0, half, depth / 2, h + 0.2)
    }
    if (B(c, 'ring')) {
      const R = P(c, 'radius', PROP_FOOTPRINT.hedge.ringRadius)
      const gap = P(c, 'gap', 0)
      const n = Math.ceil((2 * Math.PI * R) / 2)
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        if (Math.abs(((a + Math.PI) % (Math.PI * 2)) - Math.PI) < gap / 2 || Math.abs(((a - Math.PI + Math.PI) % (Math.PI * 2)) - Math.PI) < gap / 2) continue
        piece(moved(c, c.x + Math.cos(a) * R, c.z + Math.sin(a) * R, -a + Math.PI / 2), (Math.PI * R) / n + 0.15, 1.4)
      }
      return
    }
    const L = P(c, 'length', PROP_FOOTPRINT.hedge.length)
    const gap = P(c, 'gap', 0)
    const n = Math.ceil(L / 2)
    for (let i = 0; i < n; i++) {
      const lx = -L / 2 + (i + 0.5) * (L / n)
      if (gap > 0 && Math.abs(lx) < gap / 2) continue
      piece(moved(c, ...at(c, lx, 0), c.rot), L / n / 2 + 0.1, PROP_FOOTPRINT.hedge.depth)
    }
  },

  fence(c, out) {
    const L = P(c, 'length', PROP_FOOTPRINT.fence.length)
    const gap = P(c, 'gap', 0)
    const n = Math.ceil(L / 2)
    const span = L / n
    // ground at every post: each rail runs from one post to the next, sloped with the ground,
    // so the rails never step and never end beside a post
    const gp: number[] = []
    for (let i = 0; i <= n; i++) gp.push(c.ground(...at(c, -L / 2 + i * span, 0)))
    const railShown = (i: number) => i >= 0 && i < n && !(gap > 0 && Math.abs(-L / 2 + (i + 0.5) * span) < gap / 2)
    for (let i = 0; i <= n; i++) {
      const lx = -L / 2 + i * span
      const [x, z] = at(c, lx, 0)
      // a post wherever a rail ends (even inside the gap) so no rail hangs off its end, sunk 0.15
      // below the lowest ground under it so its downhill side never shows air on a slope
      if (gap === 0 || Math.abs(lx) >= gap / 2 - 0.1 || railShown(i - 1) || railShown(i)) out.push(post(0.1, 0.12, footMinDisc(c, lx, 0, 0.12) - 0.15, gp[i] + 1.3, 5, '#8a6a4a', x, z))
      if (!railShown(i)) continue
      const g0 = gp[i], g1 = gp[i + 1]
      const along = (u: number) => g0 + ((g1 - g0) * (u - lx)) / span
      out.push({ geo: groundStrip(c, lx, lx + span, 0, 0.12, (u) => along(u) + 0.94, (u) => along(u) + 1.06, span), color: '#a07a52' })
      out.push({ geo: groundStrip(c, lx, lx + span, 0, 0.1, (u) => along(u) + 0.5, (u) => along(u) + 0.6, span), color: '#a07a52' })
      solidBox(c, lx + span / 2, 0, span / 2, 0.12, 1.3)
    }
  },

  mill(c, out) {
    const { floor: y, foot } = plinth(c, 2.65, 3.15)
    out.push(block(5.3, 6.3, foot, y + 0.4, '#8f8d86', c.x, c.z, c.rot))
    out.push({ geo: box(5, 5, 6), color: '#b8a080', position: [c.x, y + 2.5, c.z], rotation: [0, c.rot, 0] })
    out.push({ geo: gableRoof(5, 6), color: '#6a4a30', position: [c.x, y + 5 + 1.5, c.z], rotation: [0, c.rot, 0] })
    const [wx, wz] = at(c, 3.2, 0)
    const wheel = cyl(2.4, 2.4, 0.4, 10)
    wheel.rotateZ(Math.PI / 2)
    // the wheel dips into the ground (or stream) beside the mill instead of hanging above a drop
    const wy = Math.min(y + 2.0, footMinRect(c, 3.2, 0, 0.2, 0.8) + 2.3)
    out.push({ geo: wheel, color: '#7a5230', position: [wx, wy, wz], rotation: [0, c.rot, 0] })
    solidBox(c, 0, 0, 2.65, 3.15, 0, c.rot, { top: y + 5 })
  },

  lamp(c, out) {
    const y = c.ground(c.x, c.z)
    out.push(post(0.08, 0.1, footMinDisc(c, 0, 0, 0.1) - 0.1, y + 3.6, 5, '#4a4a50', c.x, c.z))
    out.push({ geo: sphere(0.32, 8, 6), color: c.color ?? '#ffe0a0', position: [c.x, y + 3.8, c.z], unlit: true })
    solidCircle(c, 0, 0, 0.12, 3.6)
  },

  stoneRing(c, out) {
    const R = P(c, 'radius', 8) * c.scale
    const n = P(c, 'count', 8)
    const h = P(c, 'height', 3)
    const color = c.color ?? '#8f8d86'
    if (B(c, 'paved')) out.push(laid(c, c.x, c.z, { geo: cyl(R + 1, R + 1, 0.3, 16), color: '#a8a49a' }))
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + c.rot
      const x = c.x + Math.cos(a) * R
      const z = c.z + Math.sin(a) * R
      const fallen = hash2(i, 9) > 0.75
      const sh = h * (0.7 + hash2(i, 4) * 0.5)
      if (fallen) {
        // lying flat along the ground's plane, the long axis turned to a + 0.3
        const stone = laid(c, x, z, { geo: box(0.9, sh, 0.6), color, rotation: [Math.PI / 2, 0, a + 0.3] })
        out.push(stone)
        solidFromPart(c, stone, 0.6)
      } else {
        // upright: sunk 0.15 below the lowest ground under it, top where it always was
        const sc = moved(c, x, z, -a)
        const bottom = footMinRect(sc, 0, 0, 0.45, 0.3) - 0.15
        out.push(block(0.9, 0.6, bottom, c.ground(x, z) + sh, color, x, z, -a))
        solidBox(sc, 0, 0, 0.45, 0.3, sh)
      }
    }
  },

  standingStone(c, out) {
    const h = P(c, 'height', 4)
    const color = c.color ?? '#8f8d86'
    if (B(c, 'fallen')) {
      // lying flat along the ground's plane ([pi/2, 0, heading] lays the long axis level)
      const stone = laid(c, c.x, c.z, { geo: box(1.1, h, 0.7), color, rotation: [Math.PI / 2, 0, c.rot + 0.2] })
      out.push(stone)
      solidFromPart(c, stone, 0.8)
      return
    }
    // upright: sunk 0.15 below the lowest ground under it, top where it always was
    const bottom = footMinRect(c, 0, 0, 0.55, 0.35) - 0.15
    out.push(block(1.1, 0.7, bottom, c.ground(c.x, c.z) + h, color, c.x, c.z, c.rot))
    solidBox(c, 0, 0, 0.55, 0.35, h)
  },

  barrow(c, out) {
    const r = P(c, 'radius', 5)
    const y = c.ground(c.x, c.z) - 0.4
    // rim at the lowest ground under the mound, stretched so the crown and its stone stay put
    const base = Math.min(y, footMinDisc(c, 0, 0, r) - 0.4)
    const sy = (y + r * 0.6 - base) / r
    out.push({ geo: dome(r), color: '#86b85a', position: [c.x, base, c.z], scale: [1, sy, 1] })
    // a standing stone on the crown (the Barrow-downs); the kings' mounds at Edoras are plain green
    if (B(c, 'stone', true)) out.push({ geo: box(0.8, 2.2, 0.4), color: '#8f8d86', position: [c.x, y + r * 0.6 + 0.6, c.z] })
    if (B(c, 'flowers')) {
      // simbelmynë: small white blossoms on the west flank, lit like everything else (unlit, the
      // bloom turned them into glowing balls by day)
      const n = Math.round(6 * r)
      for (let i = 0; i < n; i++) {
        const a = Math.PI / 2 + hash2(i, 11 + c.seed) * Math.PI
        const d = Math.sqrt(hash2(i, 12 + c.seed)) * r * 0.92
        const px = c.x + Math.cos(a) * d
        const pz = c.z + Math.sin(a) * d
        const py = base + Math.sqrt(Math.max(0, r * r - d * d)) * sy
        out.push({ geo: sphere(0.12, 5, 3), color: '#f3f1e8', position: [px, py + 0.04, pz] })
      }
    }
  },

  ruins(c, out) {
    const R = P(c, 'radius', 8)
    const n = P(c, 'count', 8)
    const h = P(c, 'height', 4)
    const color = c.color ?? '#a39d90'
    for (let i = 0; i < n; i++) {
      const a = B(c, 'ring') ? (i / n) * Math.PI * 2 : hash2(i, 21) * Math.PI * 2
      const d = B(c, 'ring') ? R : Math.sqrt(hash2(i, 22)) * R
      const x = c.x + Math.cos(a) * d
      const z = c.z + Math.sin(a) * d
      const y = c.ground(x, z)
      const ch = h * (0.3 + hash2(i, 23) * 0.9)
      if (hash2(i, 24) > 0.45) {
        out.push(post(0.55, 0.65, surf(c).footprintMin(x, z, 0.65) - 0.1, y + ch, 7, color, x, z))
        solidAtWorld(c, x, z, 0.6, ch)
      } else {
        // a broken wall stub following the ground along its length
        const len = 2.5 + hash2(i, 25) * 3
        const pc = moved(c, x, z, a)
        out.push({ geo: groundStrip(pc, -len / 2, len / 2, 0, 0.9, (lx) => minAcross(pc, lx, 0, 0.9) - 0.1, (lx) => pc.ground(...at(pc, lx, 0)) + ch * 0.7), color })
        solidBox(pc, 0, 0, len / 2, 0.45, ch * 0.7)
      }
    }
  },

  troll(c, out) {
    const y = c.ground(c.x, c.z)
    const color = '#7d7a72'
    const bent = B(c, 'bent')
    // the body reaches the lowest ground under it (further when it leans, as its base tilts up
    // on one side) with its shoulders where they were
    const foot = Math.min(y, footMinDisc(c, 0, 0, 1.5) - 0.1) - (bent ? 0.8 : 0)
    out.push({ geo: cyl(1.1, 1.5, y + 3.4 - foot, 7), color, position: [c.x, (y + 3.4 + foot) / 2, c.z], rotation: [bent ? 0.5 : 0, c.rot, 0] })
    const [hx, hz] = at(c, 0, bent ? 1.4 : 0)
    out.push({ geo: sphere(0.9, 8, 6), color, position: [hx, y + (bent ? 3.1 : 3.9), hz] })
    for (const s of [-1, 1]) {
      const [ax, az] = at(c, s * 1.5, 0.3)
      out.push({ geo: cyl(0.35, 0.4, 2.6, 6), color, position: [ax, y + 2.0, az], rotation: [0.3, c.rot, s * 0.5] })
    }
    solidCircle(c, 0, 0, 1.4, 3.4)
  },

  quay(c, out) {
    const L = P(c, 'length', PROP_FOOTPRINT.quay.length)
    const w = P(c, 'width', PROP_FOOTPRINT.quay.width)
    const ruined = B(c, 'ruined')
    const color = c.color ?? '#8f8d86'
    const n = Math.ceil(L / 4)
    for (let i = 0; i < n; i++) {
      if (ruined && hash2(i, 31) > 0.6) continue
      const lx = -L / 2 + (i + 0.5) * (L / n)
      const half = L / n / 2 + 0.05
      const [x, z] = at(c, lx, 0)
      const top = Math.max(c.ground(x, z), c.seaLevel) + 1.0
      // a level slab at its top whose stone runs down below the lowest ground across it, or under the water
      const foot = (u: number) => Math.min(minAcross(c, u, 0, w) - 0.1, c.seaLevel - 0.3)
      out.push({ geo: groundStrip(c, lx - half, lx + half, 0, w, foot, () => top), color })
      const [px, pz] = at(c, lx, w / 2 + 0.2)
      // a mooring post standing 1.1 m above the deck, from below its own ground or the water
      out.push(post(0.15, 0.15, Math.min(top - 0.5, Math.max(surf(c).footprintMin(px, pz, 0.15), c.seaLevel) - 0.15), top + 1.1, 5, '#5a4a3a', px, pz))
      // The deck walked on is the top drawn. It is solid down to its foot, so where it stands
      // higher than a step its side is a wall (nobody walks in under a stone quay).
      const bottom = Math.min(footMinRect(c, lx, 0, half, w / 2) - 0.1, c.seaLevel - 0.3)
      c.colliders?.push({ kind: 'deck', x, z, hw: half, hd: w / 2, rot: c.rot, yA: top, yB: top, arc: 0, thick: top - bottom })
    }
  },

  ship(c0, out) {
    const [wx, wz] = findWater(c0)
    const c: PropContext = { ...c0, x: wx, z: wz }
    const L = P(c, 'length', 12)
    const hull = c.color ?? '#efe9dc'
    const sailColor = S(c, 'sailColor', '#f7f3ea')
    const y = c.seaLevel + 0.5
    out.push({ geo: box(L * 0.7, 1.4, L * 0.26), color: hull, position: [c.x, y, c.z], rotation: [0, c.rot, 0] })
    const bow = cone(L * 0.13, L * 0.3, 4)
    bow.rotateZ(-Math.PI / 2)
    bow.rotateY(Math.PI / 4)
    const [bx, bz] = at(c, L * 0.5, 0)
    out.push({ geo: bow, color: hull, position: [bx, y + 0.2, bz], rotation: [0, c.rot, 0] })
    const [sx, sz] = at(c, -L * 0.42, 0)
    out.push({ geo: box(L * 0.12, 1.8, L * 0.24), color: hull, position: [sx, y + 1.2, sz], rotation: [0, c.rot, 0] })
    if (B(c, 'mast', true)) {
      out.push({ geo: cyl(0.12, 0.16, L * 0.9, 5), color: '#6a4a30', position: [c.x, y + L * 0.45, c.z] })
      out.push({ geo: box(0.12, L * 0.55, L * 0.5), color: sailColor, position: [c.x, y + L * 0.5, c.z], rotation: [0, c.rot + Math.PI / 2, 0] })
    }
  },

  cliffGate(c, out) {
    const w = P(c, 'width', 24)
    const h = P(c, 'height', 18)
    const color = c.color ?? '#4a4a50'
    const doorColor = S(c, 'doorColor', '#1e1c22')
    const y = c.ground(c.x, c.z)
    // each block reaches below the lowest ground under it; the tops stay where they were
    out.push(block(w, 6, Math.min(y - 1, footMinRect(c, 0, 0, w / 2, 3) - 0.1), y + h - 1, color, c.x, c.z, c.rot))
    out.push(block(w * 1.3, 9, Math.min(y - 1, footMinRect(c, 0, 0, w * 0.65, 4.5) - 0.1), y + h * 0.5 - 1, color, c.x, c.z, c.rot))
    const [dx, dz] = at(c, 0, 3.1)
    out.push(block(w * 0.28, 0.4, Math.min(y, footMinRect(c, 0, 3.1, w * 0.14, 0.2) - 0.05), y + h * 0.5, doorColor, dx, dz, c.rot))
    for (const s of [-1, 1]) {
      const [px, pz] = at(c, s * w * 0.18, 3.3)
      out.push(post(0.6, 0.7, Math.min(y, footMinDisc(c, s * w * 0.18, 3.3, 0.7) - 0.1), y + h * 0.545, 6, '#6a665e', px, pz))
    }
    solidBox(c, 0, 0, w * 0.65, 4.5, h * 0.5 - 1)
  },

  cave(c, out) {
    const color = c.color ?? '#6a665e'
    const y = c.ground(c.x, c.z) - 0.5
    const s = surf(c)
    // the mound (an unturned 5.4 x 4.5 m ellipse) goes down to the lowest ground under it,
    // stretched so its crown stays put: under its middle, and all round its drawn rim, the ten
    // straight edges between the dome's rim corners (on the ellipse at angles 36 i degrees)
    let lowest = s.footprintMin(c.x, c.z, 4.5)
    for (let i = 0; i < 10; i++) {
      const a0 = (i / 10) * Math.PI * 2, a1 = ((i + 1) / 10) * Math.PI * 2
      const x0 = -5.4 * Math.cos(a0), z0 = 4.5 * Math.sin(a0), x1 = -5.4 * Math.cos(a1), z1 = 4.5 * Math.sin(a1)
      // an edge is a rectangle with no depth, turned so its local x runs along it
      lowest = Math.min(lowest, s.footprintMinRect(c.x + (x0 + x1) / 2, c.z + (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) / 2, 0, Math.atan2(-(z1 - z0), x1 - x0)))
    }
    const base = Math.min(y, lowest - 0.5)
    out.push({ geo: dome(4.5), color, position: [c.x, base, c.z], scale: [1.2, (y + 3.6 - base) / 4.5, 1] })
    // the mouth comes down to the ground in front of it
    const [dx, dz] = at(c, 0, 3.6)
    out.push({ ...block(3, 1.2, Math.min(y + 0.2, footMinRect(c, 0, 3.6, 1.5, 0.6) - 0.1), y + 2.8, '#101012', dx, dz, c.rot), unlit: true })
  },

  stones(c, out) {
    const n = P(c, 'count', 6)
    const size = P(c, 'size', 1.5)
    const color = S(c, 'color', c.color ?? '#8d8478')
    const s = surf(c)
    for (let i = 0; i < n; i++) {
      const a = hash2(i, 41) * Math.PI * 2
      const d = Math.sqrt(hash2(i, 42)) * size * 3
      const x = c.x + Math.cos(a) * d
      const z = c.z + Math.sin(a) * d
      const r = size * (0.5 + hash2(i, 43))
      // seated a quarter of its size above the lowest ground under it: its underside is in the ground all round
      out.push({ geo: dodeca(r), color, position: [x, s.footprintMin(x, z, 0.8 * r) + 0.25 * r, z], rotation: [hash2(i, 44) * 3, hash2(i, 45) * 3, 0], scale: [1, 0.7, 1] })
      // pebbles stay walkable; anything knee-high blocks
      if (r >= 0.45) solidAtWorld(c, x, z, 0.85 * r, 1.1 * r)
    }
  },

  pool(c0, out) {
    const r = P(c0, 'radius', 6)
    const [px, pz] = findLevel(c0, r * 0.8, 1.2, 40)
    const c: PropContext = { ...c0, x: px, z: pz }
    // sink the water into the lowest point of its footprint and rim it with stones so it reads as a basin
    const s = surf(c)
    const lo = s.footprintMin(c.x, c.z, r)
    out.push({ geo: cyl(r, r, 0.25, 18), color: c.color ?? '#1d2a30', position: [c.x, lo + 0.15, c.z] })
    const n = Math.ceil((2 * Math.PI * r) / 2.2)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const sx = c.x + Math.cos(a) * (r + 0.6), sz = c.z + Math.sin(a) * (r + 0.6)
      const sr = 0.5 + hash2(i, 77) * 0.6
      out.push({ geo: dodeca(sr), color: '#8d8478', position: [sx, s.footprintMin(sx, sz, 0.8 * sr) + 0.25 * sr, sz], rotation: [hash2(i, 78) * 3, hash2(i, 79) * 3, 0], scale: [1, 0.7, 1] })
    }
  },

  crag(c, out) {
    const h = P(c, 'height', 10)
    const r = P(c, 'radius', 5)
    const y = c.ground(c.x, c.z)
    out.push({ geo: cyl(r * 0.75, r, y + h - (footMinDisc(c, 0, 0, r) - 0.1), 7), color: '#7d7a72', position: [c.x, (y + h + footMinDisc(c, 0, 0, r) - 0.1) / 2, c.z], rotation: [0, c.rot, 0] })
    out.push({ geo: cyl(r * 0.8, r * 0.75, 0.6, 7), color: '#8f8d86', position: [c.x, y + h + 0.3, c.z], rotation: [0, c.rot, 0] })
    for (let i = 0; i < 6; i++) {
      const [sx, sz] = at(c, r * 0.9, -r * 0.5 + i * 0.35)
      out.push({ geo: box(1.2, 0.4, 0.6), color: '#9a978f', position: [sx, y + 1 + i * (h / 7), sz], rotation: [0, c.rot, 0] })
    }
    solidCircle(c, 0, 0, r * 0.9, h)
  },

  bridge(c, out) {
    const L = P(c, 'length', PROP_FOOTPRINT.bridge.length)
    const W = PROP_FOOTPRINT.bridge.width
    const ruined = B(c, 'ruined')
    const flat = B(c, 'flat')
    const arcK = P(c, 'arc', 0.18) // hump height as a fraction of length
    const arcH = flat ? 0 : L * arcK
    const color = S(c, 'color', c.color ?? '#8f8d86')
    const n = Math.max(4, Math.ceil(L / (arcK < 0.12 ? 1.2 : 2.5)))
    // The walking surface meets the bank flush at each end (0.15 m up, an easy step) and the deck
    // boxes hang from it, so what is drawn and what is walked on are the same line.
    const [ax, az] = at(c, -L / 2, 0)
    const [bx, bz] = at(c, L / 2, 0)
    const topA = Math.max(c.ground(ax, az), c.seaLevel) + 0.15
    const topB = Math.max(c.ground(bx, bz), c.seaLevel) + 0.15
    if (c.colliders && !ruined) {
      c.colliders.push({ kind: 'deck', x: c.x, z: c.z, hw: L / 2, hd: 1.5, rot: c.rot, yA: topA, yB: topB, arc: arcH })
      // parapets block from below the lower end to above the hump, so they hold on the deck as
      // well as from the banks
      if (!flat) {
        const band = { top: Math.max(topA, topB) + arcH + 1.2, bottom: Math.min(topA, topB) - 0.6 }
        solidBox(c, 0, 1.75, L / 2, 0.15, 0, c.rot, band)
        solidBox(c, 0, -1.75, L / 2, 0.15, 0, c.rot, band)
      }
    }
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n
      if (ruined && Math.abs(t - 0.5) < 0.2) continue
      const [x, z] = at(c, -L / 2 + t * L, 0)
      const line = topA + (topB - topA) * t + Math.sin(t * Math.PI) * arcH
      // each box lies along the deck line there: the rise from end to end plus the hump's slope,
      // and its centre far enough below the line that its tilted top face is the line (0.3 m
      // square to the face is more than 0.3 m straight down). It is long enough along that slope
      // to reach its neighbours, and longer by what the tilt takes off the top face's ends.
      const grade = (topB - topA) / L + (flat ? 0 : Math.cos(t * Math.PI) * Math.PI * arcK)
      const tilt = Math.atan(grade)
      const seg = (L / n) * Math.hypot(1, grade) + 0.3 + 0.6 * Math.abs(Math.sin(tilt))
      const y = line - 0.3 * Math.hypot(1, grade)
      out.push({ geo: box(seg, 0.6, W), color, position: [x, y, z], rotation: [0, c.rot, tilt] })
      if (!flat && arcK < 0.12 && i % 3 === 1 && Math.abs(t - 0.5) > 0.15) {
        // piers down to the water
        const gy = Math.max(c.ground(x, z), c.seaLevel - 0.6)
        out.push({ geo: box(1.6, Math.max(0.5, y - gy), 3.4), color, position: [x, (y + gy) / 2, z], rotation: [0, c.rot, 0] })
      }
      if (flat && i % 2 === 0) out.push({ geo: cyl(0.2, 0.2, Math.max(1, y - c.seaLevel + 1), 5), color: '#5a4a3a', position: [x, y - Math.max(1, y - c.seaLevel + 1) / 2, z] })
      if (!flat) {
        for (const side of [-1, 1]) {
          const [px, pz] = at(c, -L / 2 + t * L, side * 1.6)
          out.push({ geo: box(seg, 0.5, 0.3), color, position: [px, line + 0.2, pz], rotation: [0, c.rot, tilt] })
        }
      }
    }
  },

  stiltTown(c, out) {
    const n = P(c, 'count', 8)
    const spread = P(c, 'spread', 20)
    for (let i = 0; i < n; i++) {
      const x = c.x + (hash2(i, 51) - 0.5) * spread * 2
      const z = c.z + (hash2(i, 52) - 0.5) * spread * 2
      const w = 4 + hash2(i, 53) * 3
      const L = 5 + hash2(i, 54) * 3
      const rot = hash2(i, 55) * 0.6
      // stilts under the platform's corners, turned with the house
      const hc = moved(c, x, z, rot)
      const stilts = [[-w / 2 + 0.4, -L / 2 + 0.4], [w / 2 - 0.4, -L / 2 + 0.4], [-w / 2 + 0.4, L / 2 - 0.4], [w / 2 - 0.4, L / 2 - 0.4]].map(([lx, lz]) => {
        const [sx, sz] = at(hc, lx, lz)
        return [sx, sz, c.ground(sx, sz), surf(c).footprintMin(sx, sz, 0.2)]
      })
      // the platform clears the water and every stilt's own ground; each stilt reaches below the
      // lowest ground under it, so its downhill side never shows air
      const base = Math.max(Math.max(c.ground(x, z), c.seaLevel) + 2.2, ...stilts.map((s) => s[2] + 0.6))
      for (const [sx, sz, , lo] of stilts) out.push(post(0.18, 0.2, lo - 0.2, base + 0.25, 5, '#4a3a2a', sx, sz))
      out.push({ geo: box(w + 1, 0.3, L + 1), color: '#7a5a3a', position: [x, base, z], rotation: [0, rot, 0] })
      out.push({ geo: box(w, 3.2, L), color: ['#b89a6a', '#a88a5a', '#c4a878'][i % 3], position: [x, base + 1.75, z], rotation: [0, rot, 0] })
      out.push({ geo: gableRoof(w, L), color: ['#6a4a30', '#5a4a3a', '#7a5a3a'][i % 3], position: [x, base + 3.35 + ((w * 1.18) / Math.sqrt(3)) * 0.5 - 0.2, z], rotation: [0, rot, 0] })
    }
  },

  palisade(c, out) {
    const R = P(c, 'radius', 25)
    const h = P(c, 'height', 4)
    const n = Math.ceil((2 * Math.PI * R) / 1.1)
    const s = surf(c)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      if (Math.abs(a - Math.PI / 2) < 0.12) continue // gate to the south
      const x = c.x + Math.cos(a) * R
      const z = c.z + Math.sin(a) * R
      const ph = h * (0.9 + hash2(i, 61) * 0.2)
      // each stake from below the lowest ground under it to its own height above the ground
      out.push(post(0.3, 0.35, s.footprintMin(x, z, 0.35) - 0.2, c.ground(x, z) + ph, 5, ['#7a5a3a', '#6a4a30'][i % 2], x, z))
      solidAtWorld(c, x, z, 0.35, ph)
    }
  },

  pits(c, out) {
    const R = P(c, 'radius', 20)
    const n = P(c, 'count', 10)
    for (let i = 0; i < n; i++) {
      const a = hash2(i, 71) * Math.PI * 2
      const d = R * (0.3 + hash2(i, 72) * 0.7)
      const x = c.x + Math.cos(a) * d
      const z = c.z + Math.sin(a) * d
      // the pit mouth lies on the slope rather than cut through it
      out.push(laid(c, x, z, { geo: cyl(2.2, 2.2, 0.3, 8), color: '#0e0c0f', unlit: true }))
      if (hash2(i, 73) > 0.4) {
        // the brazier post beside the pit stands on its own ground (on a slope the pit's can be
        // metres away from it, either way)
        const py = c.ground(x + 2.6, z)
        out.push(post(0.5, 0.6, surf(c).footprintMin(x + 2.6, z, 0.6) - 0.1, py + 3.5, 6, '#2e2a30', x + 2.6, z))
        out.push({ geo: cyl(0.4, 0.4, 0.3, 6), color: '#ff5a1a', position: [x + 2.6, py + 3.6, z], unlit: true })
      }
    }
  },

  gate(c, out) {
    const w = P(c, 'width', 24)
    const h = P(c, 'height', 14)
    const th = P(c, 'towerHeight', 24)
    const color = c.color ?? '#2a2a2e'
    const y = c.ground(c.x, c.z)
    for (const s of [-1, 1]) {
      const [tx, tz] = at(c, (s * w) / 2, 0)
      const tg = c.ground(tx, tz)
      out.push(block(6, 6, Math.min(tg, footMinRect(c, (s * w) / 2, 0, 3, 3) - 0.1), tg + th, color, tx, tz, c.rot))
      out.push({ geo: cone(3.2, 5, 4), color, position: [tx, tg + th + 2.5, tz], rotation: [0, c.rot + Math.PI / 4, 0] })
      solidBox(c, (s * w) / 2, 0, 3, 3, th)
    }
    out.push({ geo: box(w, h * 0.35, 4), color, position: [c.x, y + h * 0.83, c.z], rotation: [0, c.rot, 0] })
    // the doors and their bars reach the ground under them; their tops stay put
    out.push(block(w - 6, 1.2, Math.min(y, footMinRect(c, 0, 0, (w - 6) / 2, 0.6) - 0.1), y + h * 0.7, '#17161a', c.x, c.z, c.rot))
    solidBox(c, 0, 0, (w - 6) / 2, 0.6, h * 0.7)
    for (let i = -2; i <= 2; i++) {
      const [bx, bz] = at(c, i * (w / 6), 0.8)
      out.push(block(0.4, 0.4, Math.min(y, footMinRect(c, i * (w / 6), 0.8, 0.2, 0.2) - 0.05), y + h * 0.7, '#5a5a62', bx, bz, c.rot))
    }
  },

  eye(c, out) {
    const h = P(c, 'height', 60)
    const y = c.ground(c.x, c.z) + h
    out.push({ geo: sphere(3.2, 12, 8), color: '#ff5a1a', position: [c.x, y, c.z], unlit: true })
    out.push({ geo: sphere(1.3, 8, 6), color: '#1a0a08', position: [c.x, y, c.z + 2.4], unlit: true, scale: [0.5, 1.3, 0.6] })
  },

  lavaGlow(c, out) {
    const R = P(c, 'radius', 20)
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + hash2(i, 81) * 0.4
      const len = R * (0.5 + hash2(i, 82) * 0.5)
      const n = Math.ceil(len / 3)
      for (let k = 0; k < n; k++) {
        const d = 4 + (k / n) * len
        // each glowing stretch follows the ground along the flow instead of bridging the dips
        const pc = moved(c, c.x + Math.cos(a) * d, c.z + Math.sin(a) * d, -a)
        const depth = 1.4 - k * 0.08
        out.push({
          geo: groundStrip(pc, -1.6, 1.6, 0, depth, (lx) => minAcross(pc, lx, 0, depth) - 0.1, (lx) => pc.ground(...at(pc, lx, 0)) + 0.5),
          color: k % 3 === 0 ? '#ffb347' : '#ff6a1a',
          unlit: true,
        })
      }
    }
  },

  smoke(c, out) {
    const y = c.ground(c.x, c.z)
    for (let i = 0; i < 6; i++) {
      const r = 3 + i * 1.6
      out.push({ geo: sphere(r, 8, 6), color: ['#3a3236', '#48404a', '#5a5058'][i % 3], position: [c.x + (hash2(i, 91) - 0.5) * 6, y + 6 + i * 5.5, c.z + (hash2(i, 92) - 0.5) * 6] })
    }
  },

  seat(c, out) {
    // A stone seat on a footing: level seat on the high side, every block down to the lowest
    // ground. The defaults are the Amon Hen throne; Edoras sets a pair of benches with low arms at
    // its stair head. It faces local +z, the back on its -z edge, the arms on its x ends.
    const w = P(c, 'width', 2.4)
    const d = P(c, 'depth', 2.0)
    const sh = P(c, 'seatHeight', 1.2)
    const back = P(c, 'back', 3.2) // top of the back above the floor; at or below the seat, none (a bench)
    const arms = B(c, 'arms', true)
    const armH = P(c, 'armHeight', 0.7) // arm blocks' top above the seat
    const stone = S(c, 'stone', '#a8a49a')
    // the throne's 0.4 m arms and 0.5 m back, thinner on a smaller seat so a bench keeps room to sit
    const aw = Math.min(0.4, w / 6)
    const bt = Math.min(0.5, d * 0.35)
    // footprint: the seat and the arms that stand half outside its ends (the back reaches 5 cm past
    // the -z edge, but it too runs down to `foot`)
    const hw = w / 2 + (arms ? aw / 2 : 0)
    const { floor: y, foot } = plinth(c, hw, d / 2)
    out.push(block(w, d, foot, y + sh, stone, c.x, c.z, c.rot))
    if (back > sh) {
      const [bx, bz] = at(c, 0, -d / 2 - 0.05 + bt / 2)
      out.push(block(w, bt, foot, y + back, stone, bx, bz, c.rot))
    }
    if (arms)
      for (const s of [-1, 1]) {
        const [ax, az] = at(c, (s * w) / 2, 0)
        out.push(block(aw, d, foot, y + sh + armH, stone, ax, az, c.rot))
      }
    // it blocks (she cannot sit): one box over the footprint at the seat's height
    solidBox(c, 0, 0, hw, d / 2, 0, c.rot, { top: y + sh })
  },

  candles(c, out) {
    const R = P(c, 'radius', 25)
    const n = P(c, 'count', 12)
    for (let i = 0; i < n; i++) {
      const a = hash2(i, 101) * Math.PI * 2
      const d = Math.sqrt(hash2(i, 102)) * R
      const x = c.x + Math.cos(a) * d
      const z = c.z + Math.sin(a) * d
      out.push({ geo: sphere(0.22, 6, 4), color: '#bfe8ff', position: [x, Math.max(c.ground(x, z), c.seaLevel) + 0.9 + hash2(i, 103) * 0.6, z], unlit: true })
    }
  },

  webs(c, out) {
    const n = P(c, 'count', 5)
    for (let i = 0; i < n; i++) {
      const x = c.x + (hash2(i, 111) - 0.5) * 12
      const z = c.z + (hash2(i, 112) - 0.5) * 12
      const y = c.ground(x, z)
      out.push({ geo: box(3 + hash2(i, 113) * 3, 0.08, 2 + hash2(i, 114) * 2), color: '#d8d8dc', position: [x, y + 1.5 + hash2(i, 115) * 2, z], rotation: [hash2(i, 116) * 1.2, hash2(i, 117) * 3, hash2(i, 118) * 0.8], unlit: true })
    }
  },

  ent(c, out) {
    const y = c.ground(c.x, c.z)
    const bark = '#4a3a2a'
    for (const s of [-1, 1]) {
      // each leg stands on its own ground; the body above stays put
      const [lx, lz] = at(c, s * 0.9, 0)
      out.push(post(0.45, 0.6, Math.min(y, footMinDisc(c, s * 0.9, 0, 0.6) - 0.1), y + 4, 6, bark, lx, lz))
    }
    out.push({ geo: cyl(1.4, 1.6, 6, 7), color: bark, position: [c.x, y + 7, c.z] })
    for (const s of [-1, 1]) {
      const [ax, az] = at(c, s * 2.2, 0.4)
      out.push({ geo: cyl(0.3, 0.4, 5, 5), color: bark, position: [ax, y + 7.5, az], rotation: [0.2, 0, s * 0.35] })
    }
    out.push({ geo: sphere(1.2, 8, 6), color: '#5a4a38', position: [c.x, y + 10.8, c.z] })
    out.push({ geo: dodeca(2.2), color: '#3f8a46', position: [c.x, y + 13, c.z] })
    out.push({ geo: dodeca(1.2), color: '#5bab4a', position: [c.x + 1.6, y + 12, c.z - 0.6] })
    solidCircle(c, 0, 0, 1.6, 4)
  },
}

/**
 * Build all parts for one landmark's props on the drawn ground. Each prop gets its context from
 * makePropContext, the same one chimney smoke and the map use, so they agree on where it stands.
 */
export function buildProps(
  landmark: { position: [number, number]; dressing?: { props: Prop[] } },
  surface: TerrainSurface,
  seaLevel: number,
  seed: number,
  colliders?: Collider[],
): Part[] {
  const out: Part[] = []
  const props = landmark.dressing?.props ?? []
  props.forEach((p, i) => {
    const builder = KINDS[p.kind]
    if (!builder) {
      if (import.meta.env?.DEV) console.warn(`unknown prop kind "${p.kind}"`)
      return
    }
    builder(makePropContext(landmark, p, surface, seaLevel, seed + i, colliders), out)
  })
  return out
}
