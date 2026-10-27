/**
 * `waterfall`: a short sheer fall (Rivendell SPEC A.4). A brook reaches the lip of a flat, slides
 * over a cut lip stone and drops in a few narrow strands into a small plunge pool, from which the
 * brook runs on. Book-sourced (falls heard from Frodo's bed and round the porch at evening), our
 * own plain shapes: a dressed lip stone, two slim strands paling to foam, a round pool ringed with
 * a few stones. Nothing tall or ribbon-like, no carving.
 *
 * Frame: the origin sits on the lip line, the water falls toward local +z, local x runs across the
 * fall. `c.scale` is ignored (real metres). The terrain's step is never truly sheer (a 2 m cell
 * draws it as a steep face a couple of metres deep), so the builder finds where the flat above
 * ends (`edge`) and where the face meets the ground below (`toe`) by sampling the drawn ground, and
 * lets the water leave the lip stone and land `lean` metres out from the toe on a falling curve
 * (z grows as the square root of the drop, as a thrown jet does), which keeps it clear of the face
 * all the way down.
 *
 * Grounding: the lip stone's top course sits on the flat; a footing block under it runs down to
 * the lowest ground under it. The pool lies 4 cm over the ground at the foot (where the ground
 * falls away under its rim, a curb runs down to it); the rim stones are sunk into the ground.
 * Colliders: none (she wades the pool, as she steps over a brook).
 */
import * as THREE from 'three'
import type { Part } from '@/render/mergeColoured'
import { hash2 } from '@/terrain/faceColors'
import { type PropContext, P, S, at, footMinRect, footMinDisc } from '../propUtil'
import { column } from '../placeUtil'

export const WATERFALL_DEFAULTS = {
  width: 1.4,
  lean: 0.6,
  strands: 2,
  pool: 1.4,
  water: '#86b4cc',
  foam: '#eef4f6',
}
/** the cut lip stone, and its footing a shade darker */
export const WATERFALL_LIP_STONE = '#a8a294'
const LIP_FOOTING = '#958f82'
const RIM_STONE = '#8f897d'
/** heights over the flat: the lip stone's top, and the water sliding over it (the brook runs 3 cm up) */
const STONE_UP = 0.01
const SHEET_UP = 0.045
/** the lip stone: 0.6 m deep, its front 0.2 m out past the flat's edge, 0.3 m for the top course */
const STONE_D = 0.6
const STONE_OUT = 0.2
const COURSE = 0.3

type V3 = [number, number, number]

export interface WaterfallFrame {
  width: number
  /** world y of the flat above (the brook's bed at the lip) */
  lip: number
  /** world y of the ground at the foot */
  foot: number
  /** local z: where the flat above ends, where the water leaves the lip stone, where the face meets the ground below, where the strands land */
  edge: number
  top: number
  toe: number
  land: number
  /** world point where the strands strike the pool (spray rises here) */
  spray: V3
  /** the plunge pool, world centre and radius (r 0: none) and its surface */
  pool: { x: number; z: number; r: number; y: number }
}

/** The numbers the builder, the spray emitter and the grass share. */
export function waterfallFrame(c: PropContext): WaterfallFrame {
  const w = Math.max(0.3, P(c, 'width', WATERFALL_DEFAULTS.width))
  const lean = Math.max(0, P(c, 'lean', WATERFALL_DEFAULTS.lean))
  const poolR = Math.max(0, P(c, 'pool', WATERFALL_DEFAULTS.pool))
  const across = [-w / 2, 0, w / 2]
  const hMax = (lz: number) => Math.max(...across.map((lx) => c.ground(...at(c, lx, lz))))
  // the edge is judged across the middle half, so a fall set near a flat's corner keeps its lip
  const hMin = (lz: number) => Math.min(...[-w / 4, 0, w / 4].map((lx) => c.ground(...at(c, lx, lz))))

  // the lip: the flat the brook arrives on, just behind the origin
  let lip = -Infinity
  for (let lz = -0.6; lz <= 0.3001; lz += 0.15) lip = Math.max(lip, hMax(lz))
  if (typeof c.params.lip === 'number') lip = c.params.lip
  // the edge: the last point where the ground across is still (nearly) at the lip
  let edge = 0
  for (let lz = -0.6; lz <= 1.5001; lz += 0.05)
    if (hMin(lz) < lip - 0.08) {
      edge = Math.max(-0.6, lz - 0.05)
      break
    }
  // the toe: where the face meets the ground below (the given foot, or where it stops falling)
  const footParam = typeof c.params.foot === 'number' ? (c.params.foot as number) : undefined
  let toe = edge + 0.5
  for (let lz = edge + 0.2; lz <= edge + 8; lz += 0.05) {
    const h = hMax(lz)
    if (footParam !== undefined ? h <= footParam + 0.05 : h - hMax(lz + 0.3) < 0.04) {
      toe = lz
      break
    }
  }
  const land = toe + lean
  const foot = footParam ?? Math.max(hMax(land), c.seaLevel)
  const [x, z] = at(c, 0, land)
  const poolY = foot + 0.04
  return {
    width: w,
    lip,
    foot,
    edge,
    top: edge + STONE_OUT,
    toe,
    land,
    spray: [x, poolR > 0 ? poolY : foot, z],
    pool: { x, z, r: poolR, y: poolY },
  }
}

/** The ground the pool covers, with a little margin: for anything that must keep off it (grass tufts). */
export function waterfallPoolFootprint(c: PropContext): { x: number; z: number; r: number } {
  const f = waterfallFrame(c)
  return { x: f.pool.x, z: f.pool.z, r: f.pool.r > 0 ? f.pool.r + 0.15 : 0 }
}

/** Triangles in world space for one colour; quads are wound to face `out`. */
class Tris {
  pos: number[] = []
  quad(a: V3, b: V3, c: V3, d: V3, out: V3) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const flip = nx * out[0] + ny * out[1] + nz * out[2] < 0
    const q = flip ? [a, d, c, a, c, b] : [a, b, c, a, c, d]
    for (const p of q) this.pos.push(p[0], p[1], p[2])
  }
  part(color: string): Part | null {
    if (!this.pos.length) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    return { geo, color }
  }
}

/** fractions of the drop at the strands' cross-sections: even steps along the falling curve */
const FALL_T = [0, 0.06, 0.25, 0.64, 1]
/** the gap between neighbouring strands, wide enough that they read apart from across a court */
const GAP = 0.25
/** cross-sections from this one down are foam (the lower third) */
const FOAM_FROM = 3

export function waterfall(c: PropContext, out: Part[]): void {
  const f = waterfallFrame(c)
  const w = f.width
  const n = Math.max(1, Math.round(P(c, 'strands', WATERFALL_DEFAULTS.strands)))
  const water = S(c, 'water', WATERFALL_DEFAULTS.water)
  const foam = S(c, 'foam', WATERFALL_DEFAULTS.foam)
  // the strands read white against the rock: water paling toward foam as it falls
  const falling = mix(water, foam, 0.45)
  const cs = Math.cos(c.rot), sn = Math.sin(c.rot)
  const P3 = (lx: number, lz: number, y: number): V3 => {
    const [x, z] = at(c, lx, lz)
    return [x, y, z]
  }
  /** a direction in the piece's local (x, y, z) turned into the world */
  const dir = (lx: number, ly: number, lz: number): V3 => [cs * lx + sn * lz, ly, -sn * lx + cs * lz]

  // --- the lip stone: a top course on the flat, its front out over the edge, and a footing under it
  const sw = w + 0.6
  const sz = f.edge + STONE_OUT - STONE_D / 2
  const stoneTop = f.lip + STONE_UP
  column(c, out, 0, sz, sw, STONE_D, stoneTop - COURSE, stoneTop, WATERFALL_LIP_STONE)
  const low = footMinRect(c, 0, sz, sw / 2, STONE_D / 2) - 0.1
  if (low < stoneTop - COURSE - 0.02) column(c, out, 0, sz - 0.03, sw - 0.1, STONE_D - 0.06, low, stoneTop - COURSE + 0.02, LIP_FOOTING)

  // --- the water over the lip stone: one sheet from where the brook arrives to the stone's front
  const sheet = new Tris()
  const yTop = f.lip + SHEET_UP
  sheet.quad(P3(-w / 2, f.edge - 0.45, yTop), P3(w / 2, f.edge - 0.45, yTop), P3(w / 2, f.top, yTop), P3(-w / 2, f.top, yTop), [0, 1, 0])

  // --- the strands: each a slim prism (a flat back and a ridged front) on the falling curve, from the
  // stone's front edge down into the pool, foam on its lower third
  const yBot = f.foot + 0.02
  const upper = new Tris(), lower = new Tris(), back = new Tris()
  for (let k = 0; k < n; k++) {
    const cx = -w / 2 + ((k + 0.5) * w) / n
    const hw = Math.max(0.06, (w / n - GAP) / 2) * (0.9 + 0.2 * hash2(c.seed, k))
    const reach = (f.land - f.top) * (0.94 + 0.12 * hash2(c.seed, k + 17))
    // centre line (local z, y) and its outward normal at each cross-section
    const cz: number[] = [], cy: number[] = []
    for (const t of FALL_T) {
      cz.push(f.top + reach * Math.sqrt(t))
      cy.push(yTop + (yBot - yTop) * t)
    }
    const nz: number[] = [], ny: number[] = []
    for (let i = 0; i < FALL_T.length; i++) {
      const a = Math.max(0, i - 1), b = Math.min(FALL_T.length - 1, i + 1)
      const dz = cz[b] - cz[a], dy = cy[b] - cy[a]
      const l = Math.hypot(dz, dy) || 1
      // outward (away from the face): the tangent turned a quarter, so a falling strand faces +z
      nz.push(-dy / l)
      ny.push(dz / l)
    }
    const TH = 0.07 // how far the ridge stands proud of the back
    const L = (i: number) => P3(cx - hw, cz[i], cy[i])
    const R = (i: number) => P3(cx + hw, cz[i], cy[i])
    const M = (i: number) => P3(cx, cz[i] + nz[i] * TH, cy[i] + ny[i] * TH)
    for (let i = 0; i < FALL_T.length - 1; i++) {
      const t = i + 1 >= FOAM_FROM ? lower : upper
      const o = dir(0, ny[i] + ny[i + 1], nz[i] + nz[i + 1])
      t.quad(L(i), M(i), M(i + 1), L(i + 1), add(o, dir(-0.6, 0, 0)))
      t.quad(M(i), R(i), R(i + 1), M(i + 1), add(o, dir(0.6, 0, 0)))
      back.quad(L(i), R(i), R(i + 1), L(i + 1), [-o[0], -o[1], -o[2]])
    }
  }
  for (const [t, col] of [
    [sheet, falling],
    [upper, falling],
    [lower, foam],
    [back, water],
  ] as [Tris, string][]) {
    const p = t.part(col)
    if (p) out.push(p)
  }

  // --- the plunge pool: a level disc (its back laps into the face), a foam patch where the strands
  // strike, and a few rim stones round its open side
  const r = f.pool.r
  if (r > 0) {
    const pool = new THREE.CircleGeometry(r, 14)
    pool.rotateX(-Math.PI / 2)
    out.push({ geo: pool, color: shade(water, 0.92), position: [f.pool.x, f.pool.y, f.pool.z] })
    // where the ground falls away under the rim, a low curb runs down to it so the disc never hangs
    const under = footMinDisc(c, 0, f.land, r)
    if (under < f.foot - 0.02) {
      const curb = new THREE.CylinderGeometry(r + 0.04, r + 0.04, f.pool.y - under + 0.1, 14, 1, true)
      out.push({ geo: curb, color: RIM_STONE, position: [f.pool.x, (f.pool.y + under - 0.1) / 2, f.pool.z] })
    }
    const splash = new THREE.CircleGeometry(1, 8)
    splash.rotateX(-Math.PI / 2)
    splash.scale(Math.min(r * 0.8, w / 2 + 0.25), 1, Math.min(r * 0.5, 0.45))
    out.push({ geo: splash, color: foam, position: [f.pool.x, f.pool.y + 0.02, f.pool.z], rotation: [0, c.rot, 0] })
    for (let i = 0; i < 6; i++) {
      // round the open (+z) side from one end of the face to the other
      const a = -0.3 + ((Math.PI + 0.6) * i) / 5 + (hash2(c.seed, i + 40) - 0.5) * 0.25
      const sr = 0.25 * (0.8 + 0.45 * hash2(c.seed, i + 60))
      const lx = Math.cos(a) * (r + 0.05), lz = f.land + Math.sin(a) * (r + 0.05)
      const [x, z] = at(c, lx, lz)
      const geo = new THREE.IcosahedronGeometry(sr, 0)
      out.push({
        geo,
        color: shade(RIM_STONE, 0.92 + 0.16 * hash2(c.seed, i + 80)),
        position: [x, footMinDisc(c, lx, lz, 0.8 * sr) + 0.25 * sr, z],
        rotation: [hash2(c.seed, i + 100) * 3, hash2(c.seed, i + 120) * 3, 0],
        scale: [1, 0.7, 1],
      })
    }
  }
}

function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
/** A colour a little darker (k < 1) or lighter, as a hex string. */
function shade(hex: string, k: number): string {
  return '#' + new THREE.Color(hex).multiplyScalar(k).getHexString()
}
/** `a` toward `b` by t, as a hex string. */
function mix(a: string, b: string, t: number): string {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()
}
