/**
 * `banner`: the king's standard of Rohan, a white horse on a green field (RotK). A pole with a
 * gilt finial; the cloth hangs from a crossbar (style 'hang', the default) or flies from the pole
 * ('fly'). The device is our own plain running horse made of a few flat pieces, shown on both
 * faces of the cloth. Props get no wind, so the cloth is static: the part near its fixed edge
 * hangs flat and carries the device, and the free end is baked into a few folds seeded by c.seed.
 *
 * Frame: origin at the foot of the pole. The cloth's front faces local +z (world (sin rot, cos
 * rot)); a hanging cloth spans local x, a flying one runs along local +x from the pole. The pole
 * is the only collider.
 */
import * as THREE from 'three'
import type { Part } from '@/render/mergeColoured'
import { hash2 } from '@/terrain/faceColors'
import { type PropContext, P, S, footMinDisc, solidCircle, box, cyl, cone } from '../propUtil'

const POLE = '#4a3626'

type V2 = [number, number]

/** A thin quad from (x0, y0) to (x1, y1), w0 wide at its start and w1 at its end. */
function limb(x0: number, y0: number, x1: number, y1: number, w0: number, w1: number): V2[] {
  const len = Math.hypot(x1 - x0, y1 - y0)
  const nx = -(y1 - y0) / len, ny = (x1 - x0) / len
  return [
    [x0 - (nx * w0) / 2, y0 - (ny * w0) / 2],
    [x1 - (nx * w1) / 2, y1 - (ny * w1) / 2],
    [x1 + (nx * w1) / 2, y1 + (ny * w1) / 2],
    [x0 + (nx * w0) / 2, y0 + (ny * w0) / 2],
  ]
}

/** A jointed leg (or a tail): one limb per segment, each run on past its joints by half the joint's width so no notch shows. */
function leg(pts: V2[], ws: number[]): V2[][] {
  return pts.slice(1).map((p, i) => {
    const [x0, y0] = pts[i], [x1, y1] = p
    const l = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / l, uy = (y1 - y0) / l
    const e0 = i > 0 ? ws[i] / 2 : 0, e1 = i + 2 < pts.length ? ws[i + 1] / 2 : 0
    return limb(x0 - ux * e0, y0 - uy * e0, x1 + ux * e1, y1 + uy * e1, ws[i], ws[i + 1])
  })
}

/**
 * Our own running horse, facing -x (toward the pole of a flying flag), as convex outlines in a
 * frame about 1.7 wide: barrel, a neck stretched forward, a tapered head with one ear, legs at the
 * full reach of a gallop (one knee and one hock bent) and a streaming tail. 31 triangles a face.
 * Not drawn from any emblem.
 */
const HORSE: V2[][] = [
  // barrel, chest to croup
  [[-0.46, -0.16], [-0.28, -0.26], [0.18, -0.24], [0.4, -0.18], [0.52, -0.04], [0.44, 0.12], [-0.26, 0.17], [-0.5, -0.02]],
  // neck and head, one ear
  [[-0.5, -0.04], [-0.22, 0.16], [-0.52, 0.5], [-0.7, 0.36]],
  limb(-0.56, 0.48, -0.84, 0.27, 0.19, 0.09),
  [[-0.54, 0.47], [-0.48, 0.64], [-0.62, 0.5]],
  // forelegs reaching forward, one knee folded; hind legs thrown back, one hock bent
  ...leg([[-0.4, -0.14], [-0.62, -0.34], [-0.78, -0.54]], [0.13, 0.08, 0.07]),
  ...leg([[-0.26, -0.2], [-0.5, -0.36], [-0.4, -0.56]], [0.13, 0.08, 0.07]),
  ...leg([[0.4, -0.12], [0.62, -0.34], [0.86, -0.46]], [0.16, 0.08, 0.07]),
  ...leg([[0.28, -0.18], [0.44, -0.4], [0.34, -0.6]], [0.16, 0.08, 0.07]),
  // tail streaming back
  ...leg([[0.46, 0.06], [0.72, 0.16], [0.9, 0.06]], [0.08, 0.12, 0.07]),
]
const HORSE_BOX = (() => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const poly of HORSE)
    for (const [x, y] of poly) {
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 }
})()

/**
 * Flat convex outlines (local x, y) as one geometry: each fanned into triangles once facing +z at
 * zFront and once facing -z at zBack (the same shape seen through the cloth from behind).
 */
function faces(outlines: V2[][], zFront: number, zBack: number): THREE.BufferGeometry {
  const v: number[] = []
  for (const o of outlines)
    for (let i = 1; i + 1 < o.length; i++) {
      const a = o[0], b = o[i], d = o[i + 1]
      // wound counter-clockwise seen from +z, whichever way the outline was written
      const ccw = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]) > 0
      const [p, q] = ccw ? [b, d] : [d, b]
      v.push(a[0], a[1], zFront, p[0], p[1], zFront, q[0], q[1], zFront)
      v.push(a[0], a[1], zBack, q[0], q[1], zBack, p[0], p[1], zBack)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
  return g
}

export function banner(c: PropContext, out: Part[]): void {
  const height = P(c, 'height', 6)
  const fly = S(c, 'style', 'hang') === 'fly'
  const across = P(c, 'width', 1.1) // across the cloth: its width hanging, its height flying
  const along = P(c, 'cloth', 2.2) // from the fixed edge to the free one
  const shape = S(c, 'deviceShape', 'horse')
  const ripple = Math.max(0, P(c, 'ripple', 0.12))
  // every piece is built in the prop's local frame with world heights, then turned and moved
  const put = (geo: THREE.BufferGeometry, color: string, lx = 0, y = 0, lz = 0) => {
    geo.translate(lx, y, lz)
    out.push({ geo, color, position: [c.x, 0, c.z], rotation: [0, c.rot, 0] })
  }

  // the pole's top stays at the centre ground + height, where its collider ends; its foot runs
  // below the lowest ground round it
  const top = c.ground(c.x, c.z) + height
  const foot = footMinDisc(c, 0, 0, 0.12) - 0.15
  put(cyl(0.07, 0.09, top - foot, 5), POLE, 0, (top + foot) / 2, 0)
  put(cone(0.12, 0.3, 5), S(c, 'finial', '#d9b24a'), 0, top + 0.15, 0)
  solidCircle(c, 0, 0, 0.12, height)

  // The cloth, `th` thick. Hanging, it sits just in front of the pole (its back face, and the
  // device on it, clear the pole) and covers the front of a crossbar that meets the pole; flying,
  // it runs from the pole's side in the pole's own plane.
  const th = 0.04
  const zc = fly ? 0 : 0.13
  if (!fly) put(box(across + 0.4, 0.08, 0.08), POLE, 0, top - 0.2, 0.07)
  const clothTop = fly ? top - 0.25 : top - 0.16
  // cloth coordinates: `a` from the fixed edge toward the free one (down a hanging cloth, out
  // along a flying one), `b` across it; the first FLAT of `a` hangs flat
  const FLAT = 0.68
  const toLocal = (a: number, b: number): V2 => (fly ? [0.08 + a, clothTop - across / 2 + b] : [b, clothTop - a])
  // folds: five nodes across the cloth, each pushed forward by 0..ripple (forward only, so a
  // hanging cloth never folds back into its pole); none at the flat part, all at the free edge
  const phase = hash2(c.seed, 41) * Math.PI * 2
  const node = (k: number) => ripple * (0.5 + 0.5 * Math.sin(phase + k * 1.9))
  const g = new THREE.BoxGeometry(across, along, th, 4, 2, 1)
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const bx = pos.getX(i), by = pos.getY(i), bz = pos.getZ(i)
    // the box's middle row of vertices moves to the end of the flat part
    const t = 0.5 - by / along // 0 at the fixed edge, 1 at the free one
    const a = t <= 0.5 ? (t / 0.5) * FLAT * along : FLAT * along + ((t - 0.5) / 0.5) * (1 - FLAT) * along
    const free = Math.max(0, (a - FLAT * along) / ((1 - FLAT) * along))
    const dz = free * node(Math.round(((bx + across / 2) / across) * 4))
    const [x, y] = toLocal(a, bx)
    pos.setXYZ(i, x, y, zc + bz + dz)
  }
  g.deleteAttribute('uv')
  g.deleteAttribute('normal')
  put(g, S(c, 'field', '#2f6b3a'))

  // the device on the flat part, 1.2 cm proud of each face
  if (shape !== 'horse' && shape !== 'band') return
  const room = FLAT * along
  let outlines: V2[][]
  let ca: number // the device's centre along the cloth
  if (shape === 'band') {
    // a plain band straight across the cloth, a fifth of the flat part deep (outline x = across)
    ca = room * 0.5
    const d = room * 0.1, e = across / 2 - 0.01
    outlines = [[[-e, -d], [e, -d], [e, d], [-e, d]]]
    if (fly) outlines = outlines.map((o) => o.map(([x, y]): V2 => [y, x]))
  } else {
    // upright, 80% of a hanging cloth's width, or 85% of a flying flag's flat length
    const k = fly ? Math.min((room * 0.85) / HORSE_BOX.w, (across * 0.8) / HORSE_BOX.h) : Math.min((across * 0.8) / HORSE_BOX.w, (room * 0.8) / HORSE_BOX.h)
    // hanging, a little above the middle of the cloth, kept inside the flat part
    const hh = (HORSE_BOX.h * k) / 2
    ca = fly ? room * 0.5 : Math.max(hh + 0.12, Math.min(along * 0.42, room - hh - 0.08))
    outlines = HORSE.map((o) => o.map(([x, y]): V2 => [(x - HORSE_BOX.cx) * k, (y - HORSE_BOX.cy) * k]))
  }
  const [ox, oy] = toLocal(ca, 0)
  put(faces(outlines.map((o) => o.map(([x, y]): V2 => [ox + x, oy + y])), zc + th / 2 + 0.012, zc - th / 2 - 0.012), S(c, 'device', '#f2efe6'))
}
