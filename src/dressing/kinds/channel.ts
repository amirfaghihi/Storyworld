/**
 * `channel`: the stream in its stone channel (SPEC A.4). Water in a place is one flat plane at sea
 * level, so a stream running down a hill is drawn: a water ribbon between two stone kerbs whose
 * tops follow the drawn ground, so a cascade forms by itself where a bank drops (and the water
 * there reads paler, broken). `kerb: 0` is a natural brook: only the ribbon, draped on the ground.
 * `covered` lays a stone slab over the kerbs: a culvert under a way or a wall, or a slab at a door.
 *
 * A line piece along local x, centred on the origin, the water running toward local +x. The def
 * chains pieces along a polyline, each 0.2 m longer than its share, so neighbours overlap 0.1 m
 * past the joint. A piece cannot see its neighbours, so where the line turns the def passes the
 * turn (radians, + toward local +z) as `joinIn` (from the previous piece) and `joinOut` (into the
 * next): that end is cut on the bisector through the joint (a mitre), so kerbs and water meet in a
 * clean corner instead of one kerb running across the other's water.
 *
 * No colliders: a 0.2 m kerb registered as a solid would be a wall she could not step off a deck
 * over. She steps over it the way she wades a ford.
 */
import * as THREE from 'three'
import type { Part } from '@/render/mergeColoured'
import { hash2 } from '@/terrain/faceColors'
import { type PropContext, P, S, B, at } from '../propUtil'

/** Default size of a piece (water width and kerb width each side, metres). */
export const CHANNEL_FOOTPRINT = { length: 10, width: 0.9, kerb: 0.35 }
/** Running water: a light blue-grey a little paler than the place's water plane, so it reads as moving. */
export const CHANNEL_WATER = '#78a7c0'
export const CHANNEL_STONE = '#a39d90'
/** the paler water along the kerbs and over a cascade */
const EDGE_WATER = '#bcd3de'
const BROKEN_WATER = '#9fc2d4'
/** width of the pale strip along each edge of the water */
const EDGE = 0.07
/** water steeper than this along a segment reads as broken (a cascade) */
const RAPID_GRADE = 0.22

type V3 = [number, number, number]

/** Triangles in world space for one colour; quads are wound to face `out`. */
class Tris {
  pos: number[] = []
  quad(a: V3, b: V3, c: V3, d: V3, out: V3) {
    // facing: the normal three.js computes for (a, b, c) is (b - a) x (c - a)
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

/**
 * The ground a piece covers, as a rectangle turned by `rot` (half extents along and across), with a
 * little margin: for anything that must keep off it, such as grass tufts growing through the water.
 */
export function channelFootprint(c: PropContext): { x: number; z: number; hw: number; hd: number; rot: number } {
  const L = P(c, 'length', CHANNEL_FOOTPRINT.length)
  const wd = P(c, 'width', CHANNEL_FOOTPRINT.width)
  const kerb = Math.max(0, P(c, 'kerb', CHANNEL_FOOTPRINT.kerb))
  // a brook's bow reaches up to 0.3 m to the side, and it widens by 15 % mid-piece
  const half = kerb === 0 ? wd * 0.575 + Math.min(0.3, 0.05 * L) : wd / 2 + kerb + (B(c, 'covered') ? 0.1 : 0)
  return { x: c.x, z: c.z, hw: L / 2, hd: half + 0.15, rot: c.rot }
}

export function channel(c: PropContext, out: Part[]): void {
  const L = P(c, 'length', CHANNEL_FOOTPRINT.length)
  const wd = P(c, 'width', CHANNEL_FOOTPRINT.width)
  const kerb = Math.max(0, P(c, 'kerb', CHANNEL_FOOTPRINT.kerb))
  const kh = P(c, 'kerbHeight', 0.2)
  const drop = P(c, 'drop', 0.1)
  const covered = B(c, 'covered')
  const water = S(c, 'water', CHANNEL_WATER)
  const stone = S(c, 'stone', CHANNEL_STONE)
  const brook = kerb === 0
  const W = wd + 2 * kerb
  // a brook is short and wanders over uneven ground: finer segments keep it on the ground
  const n = Math.max(1, Math.ceil(L / (brook ? 0.5 : 1)))

  // The ends. Where the def gave a turn, the end is cut on the bisector through the joint (0.1 m
  // in from the end), reaching 6 cm past it to cover rounding in the def's positions; a straight
  // joint keeps the plain 0.1 m overlap. Every line along the piece (an edge of the water, a face
  // of a kerb) runs from start(z) to end(z) through the same n + 1 cross-sections: square ones in
  // between, and the two ends, which slant along a mitre.
  const joinIn = c.params.joinIn, joinOut = c.params.joinOut
  const turnIn = typeof joinIn === 'number' && Math.abs(joinIn) > 0.03 ? Math.tan(Math.max(-1.1, Math.min(1.1, joinIn / 2))) : null
  const turnOut = typeof joinOut === 'number' && Math.abs(joinOut) > 0.03 ? Math.tan(Math.max(-1.1, Math.min(1.1, joinOut / 2))) : null
  const start = (z: number) => (turnIn === null ? -L / 2 : -L / 2 + 0.04 + z * turnIn)
  const end = (z: number) => Math.max(turnOut === null ? L / 2 : L / 2 - 0.04 - z * turnOut, start(z) + 0.05)
  const s0 = start(0), e0 = end(0)
  const section = (z: number, k: number) => (k <= 0 ? start(z) : k >= n ? end(z) : Math.min(end(z), Math.max(start(z), s0 + ((e0 - s0) * k) / n)))
  /** local x of line z at cross-section i (a fractional i lies between two) */
  const lxAt = (z: number, i: number) => {
    const k = Math.floor(i), f = i - k
    return f === 0 ? section(z, k) : section(z, k) + (section(z, k + 1) - section(z, k)) * f
  }
  const ground = (z: number, i: number) => c.ground(...at(c, lxAt(z, i), z))
  const P3 = (z: number, i: number, y: number): V3 => {
    const [x, wz] = at(c, lxAt(z, i), z)
    return [x, y, wz]
  }

  // --- heights per cross-section
  // A built channel is level across: its kerbs stand on the high side of the ground under the
  // cross-section and their footing runs below the low side; the water sits `drop` under the kerb
  // tops. A segment whose ground bulges between its two cross-sections lifts both, so the water is
  // never under the ground anywhere along it. Mitred ends take the height at the joint all along
  // the mitre, which is what the next piece takes too.
  const ACROSS = [0, 1, 2, 3, 4].map((k) => -W / 2 + (W * k) / 4)
  const hiAt = (i: number) => Math.max(...ACROSS.map((z) => ground(z, i)))
  const loAt = (i: number) => Math.min(...ACROSS.map((z) => ground(z, i)))
  const lvl: number[] = [], low: number[] = []
  // The water's four lines: its two edges and the inner sides of the pale strips along them. In a
  // channel they run straight between the kerbs. A brook wanders: it bows gently to one side and back
  // within the piece (straight at both ends, so it meets its neighbours), widens a little between,
  // and where it ends free (the def gave the joint before it but none after) it narrows away into
  // the ground.
  const NW = 4
  // (every piece bows the same way, so one runs smoothly into the next)
  const sway = brook ? Math.min(0.3, 0.05 * L) : 0
  const fades = brook && typeof joinIn === 'number' && typeof joinOut !== 'number'
  const wz = (j: number, i: number) => {
    const u = i / n
    let h = wd / 2
    if (brook) {
      h *= 1 + 0.15 * Math.sin(Math.PI * u)
      if (fades) h *= 1 - 0.8 * Math.min(1, Math.max(0, (u - 0.5) / 0.5)) ** 2
    }
    const e = Math.min(EDGE, h * 0.3)
    return sway * Math.sin(2 * Math.PI * u) + [-h, -h + e, h - e, h][j]
  }
  // a brook lies on the ground itself and follows it across: a height per vertex, lifted per cell
  const H: number[][] = [[], [], [], []]
  const lift = kh - drop
  if (!brook) {
    for (let i = 0; i <= n; i++) {
      lvl.push(hiAt(i))
      low.push(loAt(i))
    }
    for (let i = 0; i < n; i++)
      for (const t of [0.25, 0.5, 0.75]) {
        const up = hiAt(i + t) - (lvl[i] + (lvl[i + 1] - lvl[i]) * t)
        if (up > 0) (lvl[i] += up), (lvl[i + 1] += up)
        const dn = low[i] + (low[i + 1] - low[i]) * t - loAt(i + t)
        if (dn > 0) (low[i] -= dn), (low[i + 1] -= dn)
      }
  } else {
    for (let j = 0; j < NW; j++) for (let i = 0; i <= n; i++) H[j].push(ground(wz(j, i), i) + lift)
    // each cell is drawn as two triangles split from (i, j) to (i+1, j+1)
    for (let j = 0; j < NW - 1; j++)
      for (let i = 0; i < n; i++) {
        const a = H[j][i], b = H[j][i + 1], cc = H[j + 1][i + 1], d = H[j + 1][i]
        let up = 0
        for (const s of [0.2, 0.5, 0.8])
          for (const t of [0.2, 0.5, 0.8]) {
            const h = s >= t ? a + s * (b - a) + t * (cc - b) : a + t * (d - a) + s * (cc - d)
            const z = (wz(j, i) + (wz(j, i + 1) - wz(j, i)) * s) * (1 - t) + (wz(j + 1, i) + (wz(j + 1, i + 1) - wz(j + 1, i)) * s) * t
            up = Math.max(up, ground(z, i + s) + lift - h)
          }
        if (up > 0) for (const [jj, ii] of [[j, i], [j, i + 1], [j + 1, i + 1], [j + 1, i]]) H[jj][ii] += up
      }
  }
  const kerbTop = (i: number) => lvl[i] + kh
  const foot = (i: number) => low[i] - 0.15
  /** water surface on water line j (wz) at cross-section i */
  const surface = (j: number, i: number) => (brook ? H[j][i] : lvl[i] + kh - drop)
  const waterFoot = (j: number, i: number) => (brook ? H[j][i] - lift - 0.1 : foot(i))

  const cs = Math.cos(c.rot), sn = Math.sin(c.rot)
  const UP: V3 = [0, 1, 0], DOWN: V3 = [0, -1, 0]
  const side = (s: number): V3 => [sn * s, 0, cs * s] // local +-z
  const ahead = (s: number): V3 => [cs * s, 0, -sn * s] // local +-x

  // --- the water: a pale strip along each edge and the stream between, broken where it is steep
  const calm = new Tris(), edge = new Tris(), broken = new Tris()
  for (let i = 0; i < n; i++) {
    const run = Math.abs(lxAt(0, i + 1) - lxAt(0, i))
    const steep = Math.abs((surface(1, i + 1) + surface(2, i + 1) - surface(1, i) - surface(2, i)) / 2) > RAPID_GRADE * run
    for (let j = 0; j < NW - 1; j++) {
      const t = j === 1 ? (steep ? broken : calm) : edge
      t.quad(P3(wz(j, i), i, surface(j, i)), P3(wz(j, i + 1), i + 1, surface(j, i + 1)), P3(wz(j + 1, i + 1), i + 1, surface(j + 1, i + 1)), P3(wz(j + 1, i), i, surface(j + 1, i)), UP)
    }
  }
  // a brook's thin edges on the ground (a kerbed channel's are inside its kerbs)
  if (brook)
    for (const [j, s] of [[0, -1], [NW - 1, 1]]) {
      for (let i = 0; i < n; i++) edge.quad(P3(wz(j, i), i, waterFoot(j, i)), P3(wz(j, i + 1), i + 1, waterFoot(j, i + 1)), P3(wz(j, i + 1), i + 1, surface(j, i + 1)), P3(wz(j, i), i, surface(j, i)), side(s))
    }
  // both ends closed from the surface down below the ground (at a joint the face lies inside the
  // next piece; where a culvert meets the kerbless brook, or at the line's two ends, it shows)
  for (const [i, s] of [[0, -1], [n, 1]]) {
    const j1 = NW - 1
    edge.quad(P3(wz(0, i), i, waterFoot(0, i)), P3(wz(j1, i), i, waterFoot(j1, i)), P3(wz(j1, i), i, surface(j1, i)), P3(wz(0, i), i, surface(0, i)), ahead(s))
  }

  // --- the kerbs: long stones in two tones of the same stone, so the joints between them read
  const kerbA = new Tris(), kerbB = new Tris()
  if (!brook)
    for (const s of [-1, 1]) {
      const zi = (s * wd) / 2, zo = (s * W) / 2
      for (let i = 0; i < n; i++) {
        const t = hash2(c.seed * 2 + (s > 0 ? 1 : 0), i) < 0.5 ? kerbA : kerbB
        t.quad(P3(zi, i, kerbTop(i)), P3(zi, i + 1, kerbTop(i + 1)), P3(zo, i + 1, kerbTop(i + 1)), P3(zo, i, kerbTop(i)), UP)
        t.quad(P3(zi, i, foot(i)), P3(zi, i + 1, foot(i + 1)), P3(zi, i + 1, kerbTop(i + 1)), P3(zi, i, kerbTop(i)), side(-s))
        t.quad(P3(zo, i, foot(i)), P3(zo, i + 1, foot(i + 1)), P3(zo, i + 1, kerbTop(i + 1)), P3(zo, i, kerbTop(i)), side(s))
      }
      for (const [i, e] of [[0, -1], [n, 1]]) kerbA.quad(P3(zi, i, foot(i)), P3(zo, i, foot(i)), P3(zo, i, kerbTop(i)), P3(zi, i, kerbTop(i)), ahead(e))
    }

  // --- the cover: one slab lying on the kerbs, a little wider than them; its ends are the culvert's
  // mouths, so they are closed even at a joint
  const slab = new Tris()
  if (covered && !brook) {
    const hw = W / 2 + 0.1
    const lo = (i: number) => kerbTop(i) - 0.02, hi = (i: number) => kerbTop(i) + 0.08
    for (let i = 0; i < n; i++) {
      slab.quad(P3(-hw, i, hi(i)), P3(-hw, i + 1, hi(i + 1)), P3(hw, i + 1, hi(i + 1)), P3(hw, i, hi(i)), UP)
      slab.quad(P3(-hw, i, lo(i)), P3(-hw, i + 1, lo(i + 1)), P3(hw, i + 1, lo(i + 1)), P3(hw, i, lo(i)), DOWN)
      for (const s of [-1, 1]) slab.quad(P3(s * hw, i, lo(i)), P3(s * hw, i + 1, lo(i + 1)), P3(s * hw, i + 1, hi(i + 1)), P3(s * hw, i, hi(i)), side(s))
    }
    for (const [i, e] of [[0, -1], [n, 1]]) slab.quad(P3(-hw, i, lo(i)), P3(hw, i, lo(i)), P3(hw, i, hi(i)), P3(-hw, i, hi(i)), ahead(e))
  }

  for (const [t, col] of [
    [calm, water],
    [edge, EDGE_WATER],
    [broken, BROKEN_WATER],
    [kerbA, stone],
    [kerbB, shade(stone, 0.93)],
    [slab, stone],
  ] as [Tris, string][]) {
    const p = t.part(col)
    if (p) out.push(p)
  }
}

/** A colour a little darker (k < 1) or lighter, as a hex string. */
function shade(hex: string, k: number): string {
  return '#' + new THREE.Color(hex).multiplyScalar(k).getHexString()
}
