/**
 * `hearth`: the fire of the Hall of Fire (Rivendell spec A.3). Read from the books, in our own
 * design: a fire that burns all year on a raised stone bed inside a low kerb, a low back slab
 * behind it, and two round stone pillars flanking it, each cut with three plain bands under a
 * square cap. Nothing carved in leaf, vine or figure.
 *
 * Frame: the origin is the fire bed's centre; length runs along local x, the open front faces
 * local +z and the back slab stands on local -z. The pillars stand at local x = +-(length/2 + 0.5).
 * `c.scale` is ignored (metres).
 *
 * Grounding: plinth over the whole piece; every block runs down to the footing.
 * Colliders: the kerb box (taller than the kerb, so she stands at the fire and not in it), the back
 * slab, and a circle per pillar; the gaps between kerb and pillars are under 0.3 m.
 * Particles: hearthFrame(c).embers is the ember emitter (Particles.tsx owns the branch).
 *
 * Params (all optional): length 2.4, depth 1.2, kerb 0.35, pillars 2 (0 or 2), pillarHeight 3.2,
 * fire '#ff9a3a' (flames, unlit), glow '#ffc070' (ember bed and flame hearts, unlit),
 * stone '#a39d90'.
 */
import * as THREE from 'three'
import type { Part } from '@/render/mergeColoured'
import { hash2 } from '@/terrain/faceColors'
import { type PropContext, P, S, at, plinth, solidBox, solidCircle, box } from '../propUtil'
import { column } from '../placeUtil'

export const HEARTH_DEFAULTS = {
  length: 2.4,
  depth: 1.2,
  kerb: 0.35,
  pillars: 2,
  pillarHeight: 3.2,
  fire: '#ff9a3a',
  glow: '#ffc070',
  stone: '#a39d90',
}
export const HEARTH_FOOTPRINT = { width: HEARTH_DEFAULTS.length, depth: HEARTH_DEFAULTS.depth }

/** the kerb's width, the back slab's height and thickness */
const KERB_W = 0.25
const BACK_H = 1.4
const BACK_T = 0.4
/** the pillars: shaft radius and segments, band radius and height, band heights, cap and base */
const SHAFT_R = 0.28
const SEG = 10
const BAND_R = 0.31
const BAND_H = 0.08
const BANDS = [0.3, 1.6, 2.9]
const CAP_W = 0.7, CAP_H = 0.25
const BASE_W = 0.7, BASE_H = 0.2
/** collider radius of a pillar (spec A.3) */
const PILLAR_R = 0.3
const LOG = '#3e3024'

export interface HearthFrame {
  length: number
  depth: number
  kerb: number
  /** the floor (world y) and the footing under everything */
  floor: number
  foot: number
  /** world y of the ember bed's top */
  bed: number
  /** the ember emitter: the bed's centre at floor + kerb + 0.2 (world), and its radius */
  embers: [number, number, number]
  emberRadius: number
  /** world (x, z) of each pillar */
  pillars: [number, number][]
  /** the pillars' local x offset (+-) */
  pillarX: number
  pillarHeight: number
  /** the kerb collider's half extents */
  hw: number
  hd: number
}

/** The numbers the builder and the ember emitter share. */
export function hearthFrame(c: PropContext): HearthFrame {
  const D = HEARTH_DEFAULTS
  const length = Math.max(1.2, P(c, 'length', D.length))
  const depth = Math.max(0.8, P(c, 'depth', D.depth))
  const kerb = Math.max(0.1, P(c, 'kerb', D.kerb))
  const np = Math.round(P(c, 'pillars', D.pillars)) >= 2 ? 2 : 0
  const pillarHeight = Math.max(1.5, P(c, 'pillarHeight', D.pillarHeight))
  const pillarX = length / 2 + 0.5
  // the plinth covers the kerb, the back slab and the pillars' bases
  const reach = np ? pillarX + BASE_W / 2 : length / 2 + 0.2
  const { floor, foot } = plinth(c, reach, depth / 2 + BACK_T / 2)
  const [ex, ez] = at(c, 0, 0)
  return {
    length,
    depth,
    kerb,
    floor,
    foot,
    bed: floor + kerb - 0.04,
    embers: [ex, floor + kerb + 0.2, ez],
    emberRadius: 0.6,
    pillars: np ? [at(c, -pillarX, 0), at(c, pillarX, 0)] : [],
    pillarX,
    pillarHeight,
    hw: length / 2 + 0.15,
    hd: depth / 2 + 0.15,
  }
}

/** A colour a little darker (k < 1) or lighter, as a hex string. */
function shade(hex: string, k: number): string {
  return '#' + new THREE.Color(hex).multiplyScalar(k).getHexString()
}

export function hearth(c: PropContext, out: Part[]): void {
  const D = HEARTH_DEFAULTS
  const f = hearthFrame(c)
  const { length: L, depth: d, kerb, floor, foot, bed } = f
  const stone = S(c, 'stone', D.stone)
  const fire = S(c, 'fire', D.fire)
  const glow = S(c, 'glow', D.glow)
  const put = (geo: THREE.BufferGeometry, color: string, lx: number, y: number, lz: number, unlit = false, yaw = 0) => {
    const [x, z] = at(c, lx, lz)
    out.push({ geo, color, position: [x, y, z], rotation: [0, c.rot + yaw, 0], ...(unlit ? { unlit } : {}) })
  }

  // --- the back slab, a little darker where the smoke has blackened its face
  column(c, out, 0, -d / 2, L + 0.4, BACK_T, foot, floor + BACK_H, stone)
  column(c, out, 0, -d / 2 + BACK_T / 2 + 0.01, L - 0.4, 0.02, floor + kerb, floor + BACK_H - 0.25, shade(stone, 0.5))

  // --- the kerb: four blocks round length x depth, then a sooty stone fill up to the fire bed
  const top = floor + kerb
  column(c, out, 0, d / 2 - KERB_W / 2, L, KERB_W, foot, top, stone)
  column(c, out, 0, -d / 2 + KERB_W / 2, L, KERB_W, foot, top, stone)
  for (const s of [-1, 1]) column(c, out, s * (L / 2 - KERB_W / 2), 0, KERB_W, d - 2 * KERB_W, foot, top, stone)
  column(c, out, 0, 0, L - 2 * KERB_W + 0.02, d - 2 * KERB_W + 0.02, foot, bed - 0.08, shade(stone, 0.45))

  // --- the ember bed (light) and two half-burnt logs across it
  column(c, out, 0, 0, L - 0.5, d - 0.5, bed - 0.08, bed, glow)
  out[out.length - 1].unlit = true
  for (let i = 0; i < 2; i++) {
    const yaw = (i ? 1 : -1) * (0.18 + 0.12 * hash2(c.seed, 40 + i))
    put(box(L - 0.8, 0.15, 0.15), LOG, 0, bed + 0.06, (i ? 1 : -1) * 0.12, false, yaw)
  }

  // --- flames: seeded cones (open at the base, which the bed hides), each with a brighter heart
  for (let i = 0; i < 5; i++) {
    const r = 0.18 + 0.12 * hash2(c.seed, 10 + i)
    const h = 0.5 + 0.4 * hash2(c.seed, 20 + i)
    // spread along the bed, from one end to the other, each jittered a little
    const lx = (i - 2) * ((L - 0.9) / 4) + (hash2(c.seed, 30 + i) - 0.5) * 0.16
    const lz = (hash2(c.seed, 50 + i) - 0.5) * (d - 0.8)
    const yaw = hash2(c.seed, 60 + i) * Math.PI
    put(new THREE.ConeGeometry(r, h, 5, 1, true), fire, lx, bed - 0.02 + h / 2, lz, true, yaw)
    put(new THREE.ConeGeometry(r * 0.55, h * 0.62, 5, 1, true), glow, lx, bed - 0.02 + (h * 0.62) / 2, lz, true, yaw + 0.6)
  }

  // --- the two pillars: base, round shaft cut with three bands, square cap
  if (f.pillars.length) {
    const H = f.pillarHeight
    const band = shade(stone, 0.78)
    const light = shade(stone, 1.08)
    for (const s of [-1, 1]) {
      const lx = s * f.pillarX
      column(c, out, lx, 0, BASE_W, BASE_W, foot, floor + BASE_H, stone)
      const shaftH = H - CAP_H - BASE_H
      put(new THREE.CylinderGeometry(SHAFT_R, SHAFT_R, shaftH, SEG, 1, true), light, lx, floor + BASE_H + shaftH / 2, 0)
      for (const b of BANDS) {
        if (b + BAND_H > H - CAP_H) continue
        put(new THREE.CylinderGeometry(BAND_R, BAND_R, BAND_H, SEG, 1, true), band, lx, floor + b + BAND_H / 2, 0)
      }
      column(c, out, lx, 0, CAP_W, CAP_W, floor + H - CAP_H, floor + H, stone)
      solidCircle(c, lx, 0, PILLAR_R, 0, { top: floor + H })
    }
  }

  // --- colliders: the kerb (she stands at the fire), the back slab
  solidBox(c, 0, 0, f.hw, f.hd, 0, c.rot, { top: top + 0.6 })
  solidBox(c, 0, -d / 2, (L + 0.4) / 2, BACK_T / 2, 0, c.rot, { top: floor + BACK_H })
}
