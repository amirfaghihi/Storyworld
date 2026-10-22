/**
 * `longhouse`: the long timber houses of a town of the Riders (Edoras). Low plank walls on a stone
 * footing under a steep thatch or turf roof, a dark door in the middle of the long side facing the
 * street (or in the gable end), a few small shuttered windows whose slits glow warm at night, and a
 * smoke vent on the ridge. Our own plain design from the books' "timber houses" with "dark doors":
 * no carving, no horse-head finials, no crossed bargeboards.
 *
 * Frame: the origin is the house's centre; local x runs across (the gable span), local z along the
 * ridge. `door: 'side'` (default) puts the door on the +x long side, `'end'` in the +z gable end.
 * Sizes are real metres (`c.scale` is ignored).
 *
 * The roof keeps the envelope of `gableRoofLow(span, L + 0.8, pitch)` set on the walls 0.15 m low
 * (span = width + 2 eaves): the eaves edge at +-0.59 span on the line y + wallHeight - 0.15, the
 * ridge `rise = pitch * span` above that, the ends 1.08 (L + 0.8) apart. It is built as two thick
 * slabs instead of a solid prism, so the roof shows its thatch (or turf) edge and the gable under
 * it is planked wall, not a thatch-coloured triangle.
 *
 * Params (all optional): width 6.5 (local x), length 11 (local z), wallHeight 2.4, pitch 0.65
 * (rise / span), eaves 0.7, door 'side' | 'end', doorWidth 1.2 (2 or more: a two-leaf door),
 * doorColor '#2a1f17', roof (a thatch tone, or a green that reads as turf; seeded pick when absent),
 * turf (boolean; overrides reading it from the roof colour), wall (plank tone; seeded when absent),
 * posts '#4a3626', shutters 2 (per long side), louvre true (the ridge smoke vent), bands (a plain
 * painted colour for the tie beams across the gables). Each house nudges its roof and wall tones
 * a little by seed. One body collider; door steps (decks) only where the ground falls away.
 */
import * as THREE from 'three'
import type { Part } from '@/render/mergeColoured'
import { hash2 } from '@/terrain/faceColors'
import { type PropContext, P, S, B, at, plinth, footMinRect, footMaxRect, solidBox, box } from '../propUtil'
import { STEP_STONE, column, doorSteps } from '../placeUtil'

/**
 * Default footprint (full extents along local x and z, metres; scale is ignored). The map draws
 * `building(w/2 + 0.15, L/2 + 0.15, L/2)` from these, matching the body collider.
 */
export const LONGHOUSE_FOOTPRINT = { width: 6.5, length: 11 } as const

/** Thatch tones and the turf green, picked by seed when a house is given no `roof`. */
const ROOF_TONES = ['#b39556', '#a88a4e', '#9a8a52', '#b8a060', '#7a8a4a']
const WALL_TONES = ['#6f5236', '#7a5a3a', '#5f4630', '#6a4e34']
const FOOTING = '#8a857a'
const SLIT = '#a87a48'

/** A roof colour reads as turf when green leads it (the thatch tones are all red-led). */
function greenLed(hex: string): boolean {
  const k = new THREE.Color(hex)
  return k.g > k.r && k.g > k.b
}

/**
 * The numbers the builder, the map and the chimney smoke must agree on: size, floor and footing,
 * door side, the roof's envelope and the smoke vent on the ridge (`chimneyTop` null without one).
 */
export function longhouseFrame(c: PropContext) {
  const w = P(c, 'width', LONGHOUSE_FOOTPRINT.width)
  const L = P(c, 'length', LONGHOUSE_FOOTPRINT.length)
  const h = P(c, 'wallHeight', 2.4)
  const pitch = P(c, 'pitch', 0.65)
  const eaves = P(c, 'eaves', 0.7)
  const door: 'side' | 'end' = S(c, 'door', 'side') === 'end' ? 'end' : 'side'
  const doorWidth = P(c, 'doorWidth', 1.2)
  const span = w + 2 * eaves
  const rise = pitch * span
  const { floor, foot } = plinth(c, w / 2 + 0.15, L / 2 + 0.15)
  // the roof's outer surface: eaves edge (xe, ye) up to the ridge at ya; the length of the slabs
  const xe = 0.59 * span
  const ye = floor + h - 0.15
  const ya = ye + rise
  const roofLength = 1.08 * (L + 0.8)
  const louvre = B(c, 'louvre', true)
  return {
    w, L, h, pitch, eaves, span, rise, floor, foot, door, doorWidth, xe, ye, ya, roofLength,
    /** top of the body collider: wall top + rise, above the ridge */
    top: floor + h + rise,
    /** the smoke vent on the ridge (local x, z) and the height smoke starts at */
    chx: 0,
    chz: -0.2 * L,
    chimneyTop: louvre ? floor + h + rise + 0.5 : null,
  }
}

/**
 * A triangular prism along z: base half-width `b` on y = 0, apex `hgt` above it, `len` long, centred
 * on the origin; wound to face outward. Without `bottom` the underside is left open (it sits on
 * something).
 */
function prism(b: number, hgt: number, len: number, bottom = false): THREE.BufferGeometry {
  const z = len / 2
  const p: number[] = []
  const tri = (a: number[], q: number[], r: number[]) => p.push(...a, ...q, ...r)
  tri([-b, 0, z], [b, 0, z], [0, hgt, z])
  tri([b, 0, -z], [-b, 0, -z], [0, hgt, -z])
  tri([b, 0, z], [b, 0, -z], [0, hgt, -z])
  tri([b, 0, z], [0, hgt, -z], [0, hgt, z])
  tri([-b, 0, -z], [-b, 0, z], [0, hgt, z])
  tri([-b, 0, -z], [0, hgt, z], [0, hgt, -z])
  if (bottom) {
    tri([-b, 0, z], [-b, 0, -z], [b, 0, -z])
    tri([-b, 0, z], [b, 0, -z], [b, 0, z])
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  return g
}

export function longhouse(c: PropContext, out: Part[]): void {
  const f = longhouseFrame(c)
  const { w, L, rise, floor: y, foot, door, doorWidth: dw, xe, ye, ya, roofLength: Lr } = f

  // colours: the given tones (or a seeded pick), each nudged a little lighter or darker by seed so
  // a row of the same tone does not repeat exactly
  const roofHex = S(c, 'roof', ROOF_TONES[Math.floor(hash2(c.seed, 3) * ROOF_TONES.length)])
  const wallHex = S(c, 'wall', WALL_TONES[Math.floor(hash2(c.seed, 5) * WALL_TONES.length)])
  const turf = typeof c.params.turf === 'boolean' ? (c.params.turf as boolean) : greenLed(roofHex)
  const roofC = new THREE.Color(roofHex).multiplyScalar(0.94 + 0.1 * hash2(c.seed, 7))
  const wallC = new THREE.Color(wallHex).multiplyScalar(0.94 + 0.1 * hash2(c.seed, 11))
  const posts = S(c, 'posts', '#4a3626')
  const doorC = S(c, 'doorColor', '#2a1f17')
  const put = (geo: THREE.BufferGeometry, color: string | THREE.Color, lx: number, py: number, lz: number, extra: Partial<Part> = {}) => {
    const [x, z] = at(c, lx, lz)
    out.push({ geo, color, position: [x, py, z], rotation: [0, c.rot, 0], ...extra })
  }

  // the roof slabs: their outer faces are the envelope, `t` thick (thatch is thicker than turf)
  const t = turf ? 0.3 : 0.4
  const ridgeC: string | THREE.Color = turf ? posts : roofC.clone().multiplyScalar(0.8)
  const theta = Math.atan2(rise, xe)
  const slope = Math.hypot(xe, rise)
  const sn = Math.sin(theta), cs = Math.cos(theta)
  /** height of the slabs' underside at local |x| */
  const under = (ax: number) => ya - t / cs - ax * Math.tan(theta)
  const wallTop = under(w / 2) + 0.02
  const weather = (_x: number, vy: number) => 0.86 + 0.18 * Math.min(1, Math.max(0, (vy - ye) / rise))

  // stone footing from below the lowest ground to a course above the floor
  put(box(w + 0.3, y + 0.3 - foot, L + 0.3), FOOTING, 0, (y + 0.3 + foot) / 2, 0)
  // plank walls up to the roof's underside, and the gables above them (closed under the slabs)
  // (the planks darken toward the ground, the thatch from the ridge down to the weathered eaves)
  const grime = (_x: number, vy: number) => 0.8 + 0.2 * Math.min(1, Math.max(0, (vy - y) / 2.4))
  put(box(w, wallTop - y, L), wallC, 0, (wallTop + y) / 2, 0, { shade: grime })
  // the gables' planks above the tie beams weather a shade lighter than the walls below
  put(prism(w / 2, under(0) - 0.02 - wallTop, L), wallC.clone().multiplyScalar(1.12), 0, wallTop, 0)

  for (const s of [-1, 1]) {
    put(box(slope, t, Lr), roofC, s * (xe / 2 - (t / 2) * sn), (ye + ya) / 2 - (t / 2) * cs, 0, { rotation: [0, c.rot, -s * theta], shade: weather })
  }
  if (turf) {
    // a turf roof is held by a board along each eaves and plain boards up the gable edges
    for (const s of [-1, 1]) {
      put(box(0.12, 0.34, Lr + 0.04), posts, s * (xe - 0.12), ye - 0.12, 0)
      for (const e of [-1, 1])
        put(box(slope, t + 0.06, 0.08), posts, s * (xe / 2 - (t / 2) * sn), (ye + ya) / 2 - (t / 2) * cs, e * (Lr / 2 + 0.03), { rotation: [0, c.rot, -s * theta] })
    }
    put(box(0.36, 0.26, Lr + 0.1), ridgeC, 0, ya + 0.02, 0)
  } else {
    // thatch: a rolled ridge in a darker straw, and one course line across each slope
    put(box(0.6, 0.34, Lr + 0.12), ridgeC, 0, ya + 0.02, 0)
    const k = 0.55 // the course's place down the slope
    for (const s of [-1, 1])
      put(box(0.16, 0.08, Lr - 0.3), roofC.clone().multiplyScalar(0.84), s * xe * k, ya - rise * k + 0.03 / cs, 0, { rotation: [0, c.rot, -s * theta] })
  }

  // posts at the corners (up to the roof), a tie beam across each gable at the wall top
  const postTop = under(w / 2 + 0.15)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(box(0.3, postTop - y, 0.3), posts, (sx * w) / 2, (postTop + y) / 2, (sz * L) / 2)
  const bands = typeof c.params.bands === 'string' ? (c.params.bands as string) : null
  for (const sz of [-1, 1]) put(box(w + 0.2, 0.26, 0.12), bands ?? posts, 0, wallTop + 0.1, sz * (L / 2 + 0.05))
  // and a post up the middle of each gable to the ridge, except where the door is
  for (const sz of [-1, 1]) if (door === 'side' || sz < 0) put(box(0.28, under(0) - y, 0.2), posts, 0, (under(0) + y) / 2, sz * (L / 2 + 0.04))

  // the door: dark planks in a post-and-lintel frame, in the middle of the +x long side or in the
  // +z gable end. onFace places a box on the door's wall: `u` along the wall, `o` out from its face
  const sill = y + 0.3, dTop = y + 2.3
  const onFace = (across: number, hgt: number, deep: number, u: number, o: number, py: number, color: string | THREE.Color) => {
    if (door === 'side') put(box(deep, hgt, across), color, w / 2 + o, py, u)
    else put(box(across, hgt, deep), color, u, py, L / 2 + o)
  }
  onFace(dw, dTop - sill, 0.12, 0, 0.03, (sill + dTop) / 2, doorC)
  // a wide (stable) door is two leaves: a batten down the meeting line
  if (dw >= 2) onFace(0.14, dTop - sill, 0.16, 0, 0.05, (sill + dTop) / 2, posts)
  for (const s of [-1, 1]) onFace(0.24, dTop + 0.05 - y, 0.24, s * (dw / 2 + 0.12), 0.06, (dTop + 0.05 + y) / 2, posts)
  onFace(dw + 0.64, 0.26, 0.26, 0, 0.08, dTop + 0.13, posts)
  // a post in the middle of each long side that has no door
  for (const s of [-1, 1]) if (door === 'end' || s < 0) put(box(0.3, postTop - y, 0.3), posts, (s * w) / 2, (postTop + y) / 2, 0)

  // small shuttered windows on the long sides: a closed shutter whose slit glows warm at night
  const ns = Math.max(0, Math.round(P(c, 'shutters', 2)))
  const slit = new THREE.PlaneGeometry(0.6, 0.16)
  const wy = y + 1.45
  for (const s of [-1, 1])
    for (let i = 0; i < ns; i++) {
      const lz = ns === 1 ? -0.3 * L : -0.3 * L + (0.6 * L * i) / (ns - 1)
      // keep clear of the door and the middle post
      if (Math.abs(lz) < (door === 'side' && s > 0 ? dw / 2 + 0.75 : 0.6)) continue
      put(box(0.12, 0.55, 0.9), posts, s * (w / 2 + 0.06), wy, lz)
      put(slit, SLIT, s * (w / 2 + 0.125), wy, lz, { rotation: [0, c.rot + (s * Math.PI) / 2, 0], unlit: true })
    }

  // the smoke vent: a boarded louvre astride the ridge under a little hood
  if (f.chimneyTop !== null) {
    // its foot reaches below the roof where the slopes pass its sides, whatever the pitch
    const lo = ya - 0.45 * Math.tan(theta) - 0.08
    put(box(0.9, ya + 0.45 - lo, 1.2), posts, f.chx, (ya + 0.45 + lo) / 2, f.chz)
    put(prism(0.62, 0.28, 1.45), ridgeC, f.chx, ya + 0.45, f.chz)
  }

  solidBox(c, 0, 0, w / 2 + 0.15, L / 2 + 0.15, 0, c.rot, { top: f.top })
  // last, as it hangs on the ground in front of the door: steps down where the ground falls away
  // from the floor, else a flat doorstone up to the sill. doorSteps builds off a +z face, so for a
  // side door it is given the house turned a quarter (its +z is then the house's +x)
  const dc: PropContext = door === 'side' ? { ...c, rot: c.rot + Math.PI / 2 } : c
  const face = (door === 'side' ? w / 2 : L / 2) + 0.15
  const hw = Math.max(0.6, dw / 2 + 0.1)
  if (y - footMinRect(dc, 0, face + 0.35, hw, 0.35) > 0.2) doorSteps(dc, out, 0, face, hw, y)
  else column(dc, out, 0, face + 0.2, 2 * hw, 0.4, footMinRect(dc, 0, face + 0.2, hw, 0.2) - 0.1, Math.max(y + 0.15, footMaxRect(dc, 0, face + 0.2, hw, 0.2) + 0.03), STEP_STONE)
}
