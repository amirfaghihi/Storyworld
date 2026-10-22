/**
 * `springBasin`: the horse-head spring (SPEC A.5). Clear water pours from a stone carved as a
 * horse's head into a broad basin, and the overflow spills through a notch in the front rim into
 * the stream's first channel piece. Our own design: a squat dressed back stone with a coping, and
 * a head of a few chamfered blocks (brow, a muzzle tapering to the nose and tilted down, two ears);
 * nothing from any film fountain or illustration.
 *
 * Frame: the origin is the basin's centre, local x across, the front (and the spill notch) on
 * local +z, the carved stone behind the basin on local -z. `c.scale` is ignored (real metres).
 * Grounding: plinth under the basin and the stone; every block runs down to the footing.
 * Colliders: the basin (top at the rim, she stands at it) and the back stone (top at its head).
 */
import * as THREE from 'three'
import type { Part } from '@/render/mergeColoured'
import { type PropContext, P, S, at, plinth, box, solidBox } from '../propUtil'
import { column } from '../placeUtil'

export const SPRING_BASIN_FOOTPRINT = { width: 4.2, depth: 2.4 }
export const SPRING_STONE = '#bdb6a6'
export const SPRING_WATER = '#6f9fba'
/** the falling water and the spill: paler, broken water */
const FALLING = '#b4d4e3'
/** the rim walls' thickness, the notch's width and how far its sill sits below the rim */
const RIM_T = 0.3
const NOTCH = 0.6
const SILL = 0.18

export interface SpringBasinFrame {
  /** the basin's floor (top of the plinth) and the footing under everything */
  floor: number
  foot: number
  /** the water surface in the basin (world y) */
  water: number
  /** local z of the falling water (the piece's centre line, x = 0) */
  fallZ: number
  /** world point under the nose (or the plain spout), where the water leaves the stone */
  spout: [number, number, number]
  /** world point where the falling water meets the basin's surface (spray rises here) */
  splash: [number, number, number]
}

/** The numbers the builder and the spray emitter share. */
export function springBasinFrame(c: PropContext): SpringBasinFrame {
  const w = P(c, 'width', SPRING_BASIN_FOOTPRINT.width), d = P(c, 'depth', SPRING_BASIN_FOOTPRINT.depth)
  const rim = P(c, 'rim', 0.7), spout = P(c, 'spout', 2.2)
  // the plinth covers the basin and the back stone behind it (0.6 m deep)
  const { floor: y, foot } = plinth(c, w / 2, d / 2 + 0.6)
  const water = y + rim - 0.15
  const h = head(d, y + spout)
  const horse = S(c, 'carving', 'horse') === 'horse'
  const fallZ = horse ? h.fallZ : h.face + 0.45
  const [sx, sz] = at(c, 0, fallZ)
  return { floor: y, foot, water, fallZ, spout: [sx, horse ? h.tipY : h.my - 0.18, sz], splash: [sx, water, sz] }
}

/**
 * The carved head's frame on the stone's face. HEAD scales the whole head (brow 0.55 x 0.6 x 0.5,
 * muzzle 0.75 long, ears 0.3 tall at 1), so that it reads from across the forecourt; at 1.25 the
 * pricked ears just top the stone's coping.
 */
function head(d: number, stoneTop: number) {
  const k = HEAD
  const hy = stoneTop - 0.75 // the brow's centre line
  const face = -d / 2 // the back stone's front face
  const tilt = (26 * Math.PI) / 180 // how far the muzzle droops
  const mLen = 0.75 * k
  // the muzzle's top runs on from the brow's top front, so the forehead and the nose make one line
  const mz = face + 0.3 * k, my = hy + 0.2 * k
  const tipZ = mz + Math.cos(tilt) * mLen
  const tipY = my - Math.sin(tilt) * mLen - 0.12 * k // under the nose
  // the water leaves from under the nose
  return { k, hy, face, tilt, mLen, mz, my, tipY, fallZ: tipZ - 0.08 * k }
}
const HEAD = 1.25

/** A piece built at the origin, tilted about its own local x (pitch, + = front end down), then set at local (lx, lz) and height y. */
function pitched(c: PropContext, out: Part[], geo: THREE.BufferGeometry, color: string, lx: number, y: number, lz: number, pitch: number) {
  geo.rotateX(pitch)
  const [x, z] = at(c, lx, lz)
  out.push({ geo, color, position: [x, y, z], rotation: [0, c.rot, 0] })
}

/**
 * A block along local z, `w` x `h` at its back end and `wFront` x `hFront` at its front (+z) end:
 * eight-sided (its long edges chamfered) or four-sided (a plain tapering block).
 */
function block(w: number, h: number, len: number, wFront = w, hFront = h, sides: 4 | 8 = 8): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, len, sides, 1)
  g.rotateY(Math.PI / sides) // flats, not corners, to the four sides
  g.rotateX(Math.PI / 2) // the axis along z, the top end forward (+z)
  const flat = Math.cos(Math.PI / sides)
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const front = pos.getZ(i) > 0
    pos.setXY(i, ((pos.getX(i) / flat) * (front ? wFront : w)) / 2, ((pos.getY(i) / flat) * (front ? hFront : h)) / 2)
  }
  return g
}

/** A pricked ear: a slim four-sided point, leaning out to side `s`. */
function ear(s: number, k: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.012 * k, 0.055 * k, 0.3 * k, 4, 1)
  g.rotateY(Math.PI / 4)
  g.scale(1, 1, 0.7)
  g.rotateZ(-s * 0.08)
  return g
}

export function springBasin(c: PropContext, out: Part[]): void {
  const w = P(c, 'width', SPRING_BASIN_FOOTPRINT.width), d = P(c, 'depth', SPRING_BASIN_FOOTPRINT.depth)
  const rim = P(c, 'rim', 0.7), spout = P(c, 'spout', 2.2)
  const lip = Math.max(-w / 2 + RIM_T + NOTCH / 2, Math.min(w / 2 - RIM_T - NOTCH / 2, P(c, 'lip', 0)))
  const stone = S(c, 'stone', SPRING_STONE), water = S(c, 'water', SPRING_WATER)
  const carving = S(c, 'carving', 'horse')
  const f = springBasinFrame(c)
  const y = f.floor, foot = f.foot
  const top = y + rim
  const dark = shade(stone, 0.86)

  // --- the basin: rim walls round a water slab; the front wall in two pieces round the spill notch
  column(c, out, 0, -d / 2 + RIM_T / 2, w, RIM_T, foot, top, stone)
  for (const s of [-1, 1]) column(c, out, s * (w / 2 - RIM_T / 2), 0, RIM_T, d - 2 * RIM_T, foot, top, stone)
  const nl = lip - NOTCH / 2, nr = lip + NOTCH / 2
  column(c, out, (-w / 2 + nl) / 2, d / 2 - RIM_T / 2, nl + w / 2, RIM_T, foot, top, stone)
  column(c, out, (nr + w / 2) / 2, d / 2 - RIM_T / 2, w / 2 - nr, RIM_T, foot, top, stone)
  column(c, out, lip, d / 2 - RIM_T / 2, NOTCH + 0.02, RIM_T - 0.02, foot, top - SILL, dark)
  // the water fills the basin to just under the notch's sill
  column(c, out, 0, 0, w - 2 * RIM_T + 0.02, d - 2 * RIM_T + 0.02, f.water - 0.06, f.water, water)

  // --- the carved stone behind the basin, with a coping course a little proud of it
  const sw = w * 0.7
  column(c, out, 0, -d / 2 - 0.3, sw, 0.6, foot, y + spout - 0.13, stone)
  column(c, out, 0, -d / 2 - 0.3, sw + 0.16, 0.76, y + spout - 0.13, y + spout, dark)

  // --- our own horse's head on its face: brow, muzzle and ears, nothing more
  const h = head(d, y + spout)
  if (carving === 'horse') {
    const k = h.k, carved = shade(stone, 1.07)
    // the brow, standing out from the stone
    pitched(c, out, block(0.55 * k, 0.6 * k, 0.5 * k), carved, 0, h.hy + 0.1 * k, h.face + 0.25 * k, 0)
    // the muzzle, deeper than it is wide, tapering toward the nose and drooping; its back end
    // tucked into the brow
    const mid = h.mLen / 2
    pitched(c, out, block(0.36 * k, 0.4 * k, h.mLen, 0.3 * k, 0.3 * k, 4), carved, 0, h.my - Math.sin(h.tilt) * mid, h.mz + Math.cos(h.tilt) * mid, h.tilt)
    // the ears, pricked and leaning a little forward
    for (const s of [-1, 1]) pitched(c, out, ear(s, k), carved, s * 0.17 * k, h.hy + 0.5 * k, h.face + 0.28 * k, 0.25)
  } else {
    // a plain spout stone
    pitched(c, out, box(0.24, 0.16, 0.5), stone, 0, h.my - 0.12, h.face + 0.25, 0)
  }

  // --- the falling water, from under the nose down into the basin
  column(c, out, 0, f.fallZ, 0.14, 0.12, f.water - 0.02, f.spout[1] + 0.06, FALLING)

  // --- the spill: a sheet of water over the notch's sill, then down to the stream beyond the rim.
  // The channel's first piece starts 0.2 m out from the rim, its water 0.1 m under kerbs 0.2 m
  // above the ground there, so the sheet lands on that.
  const sill = top - SILL
  column(c, out, lip, d / 2 - RIM_T / 2 - 0.03, NOTCH - 0.06, RIM_T + 0.06, sill, sill + 0.035, FALLING)
  const z0 = d / 2, z1 = d / 2 + 0.45
  const y0 = sill + 0.035
  const [gx, gz] = at(c, lip, z1)
  const y1 = Math.min(y0 - 0.05, c.ground(gx, gz) + 0.1)
  const run = z1 - z0, fall = y0 - y1
  pitched(c, out, box(NOTCH - 0.12, 0.04, Math.hypot(run, fall)), FALLING, lip, (y0 + y1) / 2 - 0.02, (z0 + z1) / 2, Math.atan2(fall, run))

  // --- colliders, from the same numbers as the parts
  solidBox(c, 0, 0, w / 2, d / 2, 0, c.rot, { top })
  solidBox(c, 0, -d / 2 - 0.3, sw / 2, 0.3, 0, c.rot, { top: y + spout })
}

/** A colour a little darker (k < 1) or lighter, as a hex string. */
function shade(hex: string, k: number): string {
  return '#' + new THREE.Color(hex).multiplyScalar(k).getHexString()
}
