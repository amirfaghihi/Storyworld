/**
 * `colonnade`: an open porch against a house wall (Rivendell spec A.2, the east porch where the
 * Council sat). Read from the books, in our own design: a paved floor, a row of plain square stone
 * piers along the open front, a beam on their caps and a low lean-to slate roof that falls from the
 * house wall to the front. One end may be closed by a solid wall, which leaves a shadowed back
 * corner (where Strider sat apart). No carving, no tracery, no arches, no curved roof.
 *
 * Frame: the origin is the floor's centre; length runs along local x, depth along local z, the open
 * front faces local +z and the back (local -z) stands against the house. Nothing is built at the
 * back: the wing's wall is the porch's back wall. `c.scale` is ignored (metres).
 *
 * Grounding: the floor is level at `floor` (default the highest ground under the footprint, the
 * house floor); where it stands above the ground a footing runs down to the lowest ground - 0.1 and
 * the floor is a deck. Door steps along the open front, last, where the ground falls away.
 *
 * Colliders, from the same numbers as the parts: a circle per pier, the end wall(s), the balustrade
 * runs, a floor deck when raised, and the roof box (bottom above her head, so she walks under it
 * while the camera arm is held under the roof).
 *
 * Params (all optional): length 12, depth 7, height 3.6 (pier top above the floor), spacing 3,
 * floor (absolute), roof 'lean' | 'flat', endWall '' | '+x' | '-x' | '+x,-x', steps true,
 * balustrade 0 (height of a low front wall; 0 none), gaps (comma list of local x centres of its
 * openings), stone '#d8d2c2', roofColor '#6d8aa8'.
 */
import * as THREE from 'three'
import type { Part } from '@/render/mergeColoured'
import { hash2 } from '@/terrain/faceColors'
import { type PropContext, P, S, B, at, footMinRect, footMaxRect, solidBox, solidCircle, box } from '../propUtil'
import { column, doorSteps, toLocal } from '../placeUtil'

export const COLONNADE_DEFAULTS = {
  length: 12,
  depth: 7,
  height: 3.6,
  spacing: 3,
  roof: 'lean' as 'lean' | 'flat',
  endWall: '',
  steps: true,
  balustrade: 0,
  gaps: '',
  stone: '#d8d2c2',
  roofColor: '#6d8aa8',
}
/** footprint for the map tables (PLACE_FOOTPRINT) */
export const COLONNADE_FOOTPRINT = { width: COLONNADE_DEFAULTS.length, length: COLONNADE_DEFAULTS.depth }

/** pier shaft, base and cap */
const SHAFT = 0.4
const BASE = 0.6, BASE_H = 0.25
const CAP = 0.6, CAP_H = 0.2
/** the beam along the pier caps */
const BEAM = 0.3
/** the roof slab's thickness and overhang past the floor all round */
const ROOF_T = 0.25
const ROOF_OVER = 0.5
/** the rise of a lean-to roof from front to back */
const LEAN_RISE = 0.6
/** the end walls' thickness; the balustrade's thickness and the width of its openings */
const END_T = 0.4
const BAL_T = 0.3
const GAP_W = 1.4
/** the pier collider's radius (spec A.2) */
const PIER_R = 0.25
/** the paving stands this proud of the floor level, so it shows on level ground */
const PAVE = 0.02

export interface ColonnadeFrame {
  length: number
  depth: number
  height: number
  /** the floor level (world y), the paving's top, and the footing under everything */
  floor: number
  top: number
  foot: number
  /** the roof box's (and the map footprint's) half extents along local x and z */
  hw: number
  hd: number
  /** local x of every pier, and the local z of the pier row */
  cols: number[]
  colZ: number
  /** world (x, z) of every pier */
  piers: [number, number][]
  /** world y of the beam's top (the roof's underside at the pier row) */
  beamTop: number
  /** the roof's fall per metre toward the front (0 for a flat roof) */
  slope: number
  /** the roof box: open below roofBottom, closed up to roofTop (the drawn roof's highest point) */
  roofBottom: number
  roofTop: number
  /** which ends are closed: -1 and/or +1 (local x side) */
  ends: number[]
}

/** The numbers the builder, the map and the checks share. Heights are world y. */
export function colonnadeFrame(c: PropContext): ColonnadeFrame {
  const D = COLONNADE_DEFAULTS
  const length = Math.max(2, P(c, 'length', D.length))
  const depth = Math.max(1.5, P(c, 'depth', D.depth))
  const height = Math.max(2.4, P(c, 'height', D.height))
  const spacing = Math.max(1.6, P(c, 'spacing', D.spacing))
  const lo = footMinRect(c, 0, 0, length / 2, depth / 2)
  const floor = typeof c.params.floor === 'number' ? (c.params.floor as number) : footMaxRect(c, 0, 0, length / 2, depth / 2)
  const foot = Math.min(lo, floor) - 0.1
  const n = Math.max(2, Math.round(length / spacing) + 1)
  const inset = 0.3
  const cols = Array.from({ length: n }, (_, i) => -length / 2 + inset + ((length - 2 * inset) * i) / (n - 1))
  const colZ = depth / 2 - 0.3
  const piers = cols.map((lx) => at(c, lx, colZ))
  const beamTop = floor + height + BEAM
  const slope = S(c, 'roof', D.roof) === 'flat' ? 0 : LEAN_RISE / depth
  // the roof's top surface at its back edge (local z = -depth/2 - ROOF_OVER) is its highest point
  const backZ = -depth / 2 - ROOF_OVER
  const roofTop = beamTop + (colZ - backZ) * slope + ROOF_T / Math.cos(Math.atan(slope))
  const ends = S(c, 'endWall', D.endWall)
    .split(',')
    .map((s) => s.trim())
    .flatMap((s) => (s === '+x' ? [1] : s === '-x' ? [-1] : []))
  return {
    length,
    depth,
    height,
    floor,
    top: floor + PAVE,
    foot,
    hw: length / 2 + 0.2,
    hd: depth / 2 + 0.2,
    cols,
    colZ,
    piers,
    beamTop,
    slope,
    roofBottom: floor + height - 0.2,
    roofTop: Math.max(floor + height + 0.9, Math.ceil(roofTop * 20) / 20),
    ends: [...new Set(ends)],
  }
}

/**
 * The paved floor as a rotated rect (the shape Grass.tsx keeps bare, as channelFootprint): the slab
 * runs from 0.3 m under the house wall to the open front, plus a 0.1 m margin for the tufts.
 */
export function colonnadeFloorFootprint(c: PropContext): { x: number; z: number; hw: number; hd: number; rot: number } {
  const L = Math.max(2, P(c, 'length', COLONNADE_DEFAULTS.length))
  const d = Math.max(1.5, P(c, 'depth', COLONNADE_DEFAULTS.depth))
  const [x, z] = at(c, 0, -0.15)
  return { x, z, hw: L / 2 + 0.1, hd: d / 2 + 0.15 + 0.1, rot: c.rot }
}

/** A colour a little darker (k < 1) or lighter, as a hex string. */
function shade(hex: string, k: number): string {
  return '#' + new THREE.Color(hex).multiplyScalar(k).getHexString()
}

/**
 * A wall running along local z at local x = lx, `t` thick, from z0 to z1, its bottom at world y
 * `bottom` and its top following top(lz): an end wall closing up to a sloping roof. World space.
 */
function wallAlongZ(c: PropContext, lx: number, t: number, z0: number, z1: number, bottom: number, top: (lz: number) => number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(t, 1, z1 - z0).toNonIndexed()
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const lz = (z0 + z1) / 2 + pos.getZ(i)
    const [x, z] = at(c, lx + pos.getX(i), lz)
    pos.setXYZ(i, x, pos.getY(i) < 0 ? bottom : top(lz), z)
  }
  g.deleteAttribute('uv')
  g.computeVertexNormals()
  return g
}

export function colonnade(c: PropContext, out: Part[]): void {
  const D = COLONNADE_DEFAULTS
  const f = colonnadeFrame(c)
  const { length: L, depth: d, height, floor, top, foot, cols, colZ, slope, beamTop } = f
  const stone = S(c, 'stone', D.stone)
  const roofC = S(c, 'roofColor', D.roofColor)
  const bal = Math.max(0, P(c, 'balustrade', D.balustrade))
  const put = (geo: THREE.BufferGeometry, color: string, lx: number, y: number, lz: number) => {
    const [x, z] = at(c, lx, lz)
    out.push({ geo, color, position: [x, y, z], rotation: [0, c.rot, 0] })
  }
  // the roof's underside above local z (it rests on the beam at the pier row)
  const under = (lz: number) => beamTop + (colZ - lz) * slope

  // the back corner(s) behind a closed end lie in shadow: the paving and the wall darken toward them
  const closed = f.ends
  const gloom = (wx: number, wz: number) => {
    if (!closed.length) return 1
    const [lx, lz] = toLocal(c, wx, wz)
    let k = 1
    for (const s of closed) {
      const dist = Math.hypot(L / 2 - s * lx, lz + d / 2)
      const t = Math.min(1, dist / 5.5)
      k = Math.min(k, 0.66 + 0.34 * t * t * (3 - 2 * t))
    }
    return k
  }

  // --- the floor: a paved slab level at the floor, its footing down to the lowest ground; it runs
  // 0.3 m back under the house wall so no seam shows there
  {
    const z0 = -d / 2 - 0.3, z1 = d / 2
    const g = new THREE.BoxGeometry(L, top - foot, z1 - z0, 4, 1, 3)
    const [x, z] = at(c, 0, (z0 + z1) / 2)
    out.push({ geo: g, color: stone, position: [x, (top + foot) / 2, z], rotation: [0, c.rot, 0], shade: (wx, _y, wz) => gloom(wx, wz) })
  }

  // --- plain square piers along the open front: base, shaft, cap; a slight seeded tone each
  cols.forEach((lx, i) => {
    const tone = shade(stone, 0.96 + 0.06 * hash2(c.seed, i))
    column(c, out, lx, colZ, BASE, BASE, top - 0.05, floor + BASE_H, tone)
    column(c, out, lx, colZ, SHAFT, SHAFT, floor + BASE_H, floor + height - CAP_H, tone)
    column(c, out, lx, colZ, CAP, CAP, floor + height - CAP_H, floor + height, tone)
  })

  // --- the beam along the caps
  column(c, out, 0, colZ, L, BEAM, floor + height, beamTop, shade(stone, 0.9))

  // --- the roof: a slab falling to the front, with a plain soffit under it in the stone's shadow tone
  {
    const a = Math.atan(slope)
    const len = (d + 2 * ROOF_OVER) / Math.cos(a)
    const roof = box(L + 2 * ROOF_OVER, ROOF_T, len)
    roof.rotateX(a)
    put(roof, roofC, 0, under(0) + ROOF_T / 2 / Math.cos(a), 0)
    // the soffit spans the floor, from the house wall to the beam's front face
    const s0 = -d / 2 - 0.3, s1 = colZ + BEAM / 2
    // 0.06 m clear of the roof's underside, so the two never fight for depth or shadow
    const soffit = box(L, 0.05, (s1 - s0) / Math.cos(a))
    soffit.rotateX(a)
    put(soffit, shade(stone, 0.8), 0, under((s0 + s1) / 2) - 0.085, (s0 + s1) / 2)
  }

  // --- the closed end(s): a solid wall up to the roof's underside, darker toward the back
  for (const s of closed) {
    const lx = s * (L / 2 - END_T / 2)
    out.push({
      geo: wallAlongZ(c, lx, END_T, -d / 2 - 0.3, d / 2, foot, (lz) => under(lz) + 0.02),
      color: stone,
      shade: (wx, _y, wz) => gloom(wx, wz),
    })
    solidBox(c, lx, -0.15, END_T / 2, d / 2 + 0.15, 0, c.rot, { top: under(-d / 2 - 0.3) })
  }

  // --- an optional low wall along the open front, between the piers, with openings at `gaps`
  if (bal > 0) {
    const gaps = S(c, 'gaps', D.gaps)
      .split(',')
      .map((s) => parseFloat(s))
      .filter((v) => Number.isFinite(v))
    // the run from end to end, cut at each opening, and at each pier (the piers stand in it)
    let runs: [number, number][] = [[-L / 2 + (closed.includes(-1) ? END_T : 0), L / 2 - (closed.includes(1) ? END_T : 0)]]
    const cut = (a: number, b: number) => {
      runs = runs.flatMap(([r0, r1]) => (b <= r0 || a >= r1 ? [[r0, r1]] : ([[r0, a], [b, r1]] as [number, number][]).filter(([p, q]) => q - p > 0.05)))
    }
    for (const g of gaps) cut(g - GAP_W / 2, g + GAP_W / 2)
    for (const lx of cols) cut(lx - SHAFT / 2, lx + SHAFT / 2)
    for (const [r0, r1] of runs) {
      column(c, out, (r0 + r1) / 2, colZ, r1 - r0, BAL_T, top - 0.05, floor + bal, stone)
      solidBox(c, (r0 + r1) / 2, colZ, (r1 - r0) / 2, BAL_T / 2, 0, c.rot, { top: floor + bal })
    }
  }

  // --- colliders: the piers, a floor deck when the floor stands proud, and the roof box
  for (const lx of cols) solidCircle(c, lx, colZ, PIER_R, 0, { top: floor + height })
  if (c.colliders && top - footMinRect(c, 0, 0, L / 2, d / 2) > 0.05) {
    // the floor deck: its height runs along its own local x, so turn it a quarter to span the depth
    const [x, z] = at(c, 0, 0)
    c.colliders.push({ kind: 'deck', x, z, hw: d / 2, hd: L / 2, rot: c.rot - Math.PI / 2, yA: top, yB: top, arc: 0, thick: top - foot })
  }
  solidBox(c, 0, 0, f.hw, f.hd, 0, c.rot, { bottom: f.roofBottom, top: f.roofTop })

  // --- steps down from the open front where the ground falls away (last: the part list above is the
  // same on any ground)
  if (B(c, 'steps', D.steps)) doorSteps(c, out, 0, d / 2, L / 2 - 0.3, top)
}
