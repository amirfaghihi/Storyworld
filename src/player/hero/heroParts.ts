import * as THREE from 'three'
import { mergeColoured, type Part } from '@/render/mergeColoured'
import { CLOTH_ATTR, ROBE } from './cloak'

/**
 * The traveller's geometry: a legless hooded wanderer whose robe and cloak reach the ground all
 * round. Built once; the pose (heroPose.ts) moves the pivots and the cloth shader (cloak.ts) moves
 * the cloth.
 *
 * Avatar space: origin on the ground under the body centre, +Y up, +Z facing. The wanderer's
 * RIGHT is -X (the staff hand), LEFT is +X. Arm pivots run their bone down local -Y with local +Z
 * the front of the limb.
 *
 * Meshes: one cloth mesh (cloak with its lining, the long robe, the capelet, the scarf tails), one
 * rigid torso mesh (belt, strap, satchel, scarf wrap, clasp), the masked head inside its hood, the
 * mask's unlit eye slits, two segments per arm, the staff and its unlit crystal. Every lit mesh is
 * vertex-coloured so they share two materials.
 */

/** Cloak colour sets: the outer cloth, the darker lining seen through the split, and the worn hem. */
export const PALETTES = {
  // default: a dark moss-green travelling cloak ("heavy dark-green cloth"; generic folk dress)
  moss: { cloak: '#3f4f3b', lining: '#2a2620', hem: '#33402f' },
  peat: { cloak: '#5a4433', lining: '#2b2420', hem: '#4a382b' },
  storm: { cloak: '#555b5f', lining: '#2a2a2b', hem: '#474c50' },
}
export type PaletteName = keyof typeof PALETTES

export const COL = {
  hoodInner: '#1d1a17',
  // the long inner robe: undyed wool, warm grey-brown, dustier toward the ground
  robe: '#7a6a50',
  robeHem: '#5f5240',
  belt: '#2e231a',
  brass: '#a88a4e',
  leather: '#5a4330',
  leatherDark: '#45331f',
  satchel: '#6b5238',
  satchelFlap: '#584330',
  strap: '#3a2c20',
  glove: '#4a3727',
  // the head under the hood is wrapped in dark cloth; the face is a porcelain mask
  wrap: '#2b2520',
  mask: '#e6d8bb',
  // the eye slits by day (unlit: Avatar fades them to the crystal's cyan after dark)
  maskSlit: '#17130f',
  // the one warm accent: a rust wool scarf
  accent: '#a4512f',
  accentDark: '#86402a',
  staffWood: '#6e5a43',
  staffDark: '#4f3f2f',
  staffGrip: '#3b2b20',
  iron: '#4b4a48',
  // unlit and HDR-boosted for the bloom (Avatar scales it by the lamp level)
  crystal: '#9fd8ff',
}

/** Pivot positions and lengths, metres. */
export const DIM = {
  shoulderX: 0.19,
  shoulderY: 1.43,
  neckY: 1.53,
  upperArm: 0.28,
  /** elbow to the centre of the gloved grip */
  forearm: 0.29,
  /** foot to crystal tip; 0.2 m longer than at first so the crystal clears the enlarged hood from behind */
  staffLen: 2.12,
  /** idle staff foot, avatar space (outside the hem on the right) */
  staffFoot: [-0.52, 0.3] as const,
  /** satchel centre on the left hip, body space (the cloak keeps out of it) */
  satchel: [0.19, 0.87, 0.16] as const,
  satchelR: 0.11,
  /**
   * The head group (hood, wrapped head, mask) is built at life size about the neck pivot and then
   * scaled up by this, so the hooded head reads from the follow camera: a stylised ~1:6.4 head
   * (the wrapped head under the mask, chin to crown) on a 2.17 m silhouette instead of the old 1:8.5.
   */
  headScale: 1.4,
}

/** Cloak grid: columns round the covered arc, rings from the shoulders to the hem. */
export const CLOAK = {
  cols: 26,
  rings: 10,
  /** [v, y, x radius, z scale]; y interpolates linearly, the rest with smoothstep */
  profile: [
    [0.0, 1.53, 0.13, 0.85],
    [0.1, 1.45, 0.25, 0.82],
    [0.2, 1.34, 0.295, 0.82],
    [0.35, 1.13, 0.31, 0.86],
    [0.55, 0.84, 0.35, 0.92],
    [0.75, 0.52, 0.41, 0.98],
    [1.0, 0.04, 0.5, 1.0],
  ] as const,
  /** half-opening of the split front, radians from +Z: narrow at the throat, wider at the hem */
  gap: (v: number) => 0.38 + 0.27 * Math.pow(v, 1.4),
  /** an uneven, worn hem: 2.7-4 cm above the ground all round */
  hemY: (th: number) => 0.027 + 0.0042 * (1 + Math.sin(5.3 * th + 0.6)) + 0.0023 * (1 + Math.sin(12.1 * th + 2.1)),
  pivot: 1.55,
}

export interface HeroRig {
  /** add under the avatar's root (avatar space) */
  root: THREE.Group
  /** carries the bob, lean and turn roll; the cloth and the arms ride on it */
  body: THREE.Group
  neck: THREE.Group
  shoulderL: THREE.Group
  elbowL: THREE.Group
  shoulderR: THREE.Group
  elbowR: THREE.Group
  /** avatar space, posed every frame: origin at the staff's foot, +Y up the shaft */
  staff: THREE.Group
  cloth: THREE.Mesh
  crystal: THREE.Mesh
  /** the mask's eye slits: unlit, dark by day, cyan after dark (Avatar sets the colour) */
  maskGlow: THREE.Mesh
  /** every lit mesh, the cloth included */
  lit: THREE.Mesh[]
  triangles: number
}

export interface HeroMaterials {
  hero: THREE.Material
  cloth: THREE.Material
  clothDepth?: THREE.Material
  crystal: THREE.Material
  /** unlit, coloured by Avatar with the lamp level; the offline previews leave it out */
  maskGlow?: THREE.Material
}

const sstep = THREE.MathUtils.smoothstep
const cyl = (rt: number, rb: number, h: number, s = 7) => new THREE.CylinderGeometry(rt, rb, h, s, 1)
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z)

/** Accumulates the cloth's non-indexed triangles with colours and the per-vertex cloth parameters. */
class ClothBuilder {
  pos: number[] = []
  col: number[] = []
  cl: number[] = []
  vert(p: THREE.Vector3, c: THREE.Color, a: readonly number[]) {
    this.pos.push(p.x, p.y, p.z)
    this.col.push(c.r, c.g, c.b)
    this.cl.push(a[0], a[1], a[2], a[3])
  }
  /** A grid of rows x cols vertices (row-major) as quads; outward winding unless `inward`. */
  grid(P: THREE.Vector3[], C: THREE.Color[], rows: number, cols: number, a: readonly number[], inward = false, wrap = false) {
    const n = wrap ? cols : cols - 1
    for (let j = 0; j < rows - 1; j++)
      for (let i = 0; i < n; i++) {
        const i1 = (i + 1) % cols
        const A = j * cols + i, B = j * cols + i1, Cc = (j + 1) * cols + i, D = (j + 1) * cols + i1
        const tris = inward ? [A, B, Cc, B, D, Cc] : [A, Cc, B, B, Cc, D]
        for (const k of tris) this.vert(P[k], C[k], a)
      }
  }
  /** A rigid primitive inside the cloth (scarf tails): every vertex gets the same parameters. */
  part(geo: THREE.BufferGeometry, m: THREE.Matrix4, color: string, a: readonly number[]) {
    const g = geo.index ? geo.toNonIndexed() : geo
    g.applyMatrix4(m)
    const c = new THREE.Color(color)
    const p = g.attributes.position
    const v = new THREE.Vector3()
    for (let i = 0; i < p.count; i++) this.vert(v.fromBufferAttribute(p, i), c, a)
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setAttribute(CLOTH_ATTR, new THREE.Float32BufferAttribute(this.cl, 4))
    g.computeVertexNormals()
    g.computeBoundingSphere()
    return g
  }
}

function cloakProfile(v: number): [number, number, number] {
  const P = CLOAK.profile
  for (let i = 1; i < P.length; i++)
    if (v <= P[i][0]) {
      const t = (v - P[i - 1][0]) / (P[i][0] - P[i - 1][0])
      const s = t * t * (3 - 2 * t)
      return [P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t, P[i - 1][2] + (P[i][2] - P[i - 1][2]) * s, P[i - 1][3] + (P[i][3] - P[i - 1][3]) * s]
    }
  const L = P[P.length - 1]
  return [L[1], L[2], L[3]]
}

/** Cloak (outer + lining), robe, capelet and scarf tails, all in body space. */
function buildCloth(pal: (typeof PALETTES)[PaletteName]): THREE.BufferGeometry {
  const b = new ClothBuilder()

  // --- the cloak: a split-front grid, pleated, flaring to the hem; the lining is the same grid
  //     pulled in by a centimetre and wound inward so it shows through the opening
  {
    const C = CLOAK.cols, R = CLOAK.rings
    const outer: THREE.Vector3[] = [], lining: THREE.Vector3[] = []
    const oc: THREE.Color[] = [], lc: THREE.Color[] = []
    const cloak = new THREE.Color(pal.cloak), hem = new THREE.Color(pal.hem), lin = new THREE.Color(pal.lining)
    for (let j = 0; j <= R; j++) {
      const v = Math.pow(j / R, 0.92)
      const gap = CLOAK.gap(v)
      for (let i = 0; i <= C; i++) {
        const th = gap + (i / C) * (Math.PI * 2 - 2 * gap) // 0 = front (+Z), PI = back
        const [y0, r0, zs] = cloakProfile(v)
        let y = y0
        const hemY = CLOAK.hemY(th)
        if (j === R) y = hemY
        else if (v > 0.75) y += (hemY - 0.04) * ((v - 0.75) / 0.25)
        // pleats deepen toward the hem; the hem edge itself is a little ragged
        const r = r0 * (1 + 0.055 * Math.pow(v, 1.5) * Math.sin(th * 9)) * (1 + 0.025 * Math.pow(v, 6) * Math.sin(th * 17 + 0.4))
        const p = new THREE.Vector3(Math.sin(th) * r, y, Math.cos(th) * r * zs)
        outer.push(p)
        const rl = Math.hypot(p.x, p.z)
        lining.push(new THREE.Vector3(p.x - (p.x / rl) * 0.012, y + 0.002, p.z - (p.z / rl) * 0.012))
        // worn darker hem, and the pleat valleys a shade darker than the ridges
        const k = 1 - 0.09 * v * (0.5 - 0.5 * Math.sin(th * 9))
        oc.push(cloak.clone().lerp(hem, sstep(v, 0.8, 1)).multiplyScalar(k))
        lc.push(lin.clone().multiplyScalar(0.9 + 0.1 * (1 - v)))
      }
    }
    const a = [CLOAK.pivot, 1, 1, 1]
    b.grid(outer, oc, R + 1, C + 1, a)
    b.grid(lining, lc, R + 1, C + 1, a, true)
  }

  // --- the long robe: closed all round, chest to the ground, visible through the cloak's split
  {
    const S = 16
    const rows: [number, number, number][] = [
      // [y, radius, z scale]
      [1.57, 0.07, 0.8],
      [1.5, 0.14, 0.78],
      [1.42, 0.185, 0.78],
      [1.3, 0.19, 0.78],
      [1.15, 0.185, 0.82],
    ]
    for (const y of [1.0, 0.82, 0.62, 0.42, 0.22, 0.028]) rows.push([y, ROBE.radius(y), ROBE.zs])
    const P: THREE.Vector3[] = [], Cc: THREE.Color[] = []
    const robe = new THREE.Color(COL.robe), robeHem = new THREE.Color(COL.robeHem)
    rows.forEach(([y0, r0, zs], j) => {
      for (let i = 0; i < S; i++) {
        const th = (i / S) * Math.PI * 2
        const low = 1 - sstep(y0, 0.0, ROBE.pivot)
        const y = j === rows.length - 1 ? 0.028 + 0.003 * (1 + Math.sin(7 * th)) : y0
        // soft vertical folds below the belt, inside the keep-out gap the cloak holds
        const r = r0 * (1 + 0.03 * low * Math.sin(th * 10 + 0.5))
        P.push(new THREE.Vector3(Math.sin(th) * r, y, Math.cos(th) * r * zs))
        Cc.push(robe.clone().lerp(robeHem, 1 - sstep(y0, 0.0, 0.5)).multiplyScalar(1 - 0.06 * low * (0.5 - 0.5 * Math.sin(th * 10 + 0.5))))
      }
    })
    b.grid(P, Cc, rows.length, S, [ROBE.pivot, ROBE.trail, 0.35, 0], false, true)
  }

  // --- the shoulder capelet: a short second layer over the cloak, open at the throat
  {
    const S = 18, gap = 0.38
    const rows: [number, number][] = [
      [1.585, 0.11],
      [1.53, 0.2],
      [1.46, 0.285],
      [1.37, 0.345],
      [1.27, 0.375],
    ]
    const outer: THREE.Vector3[] = [], inner: THREE.Vector3[] = []
    const oc: THREE.Color[] = [], ic: THREE.Color[] = []
    const top = new THREE.Color(pal.cloak).offsetHSL(0, 0, 0.025)
    const lin = new THREE.Color(pal.lining)
    rows.forEach(([y0, r0], j) => {
      const edge = j / (rows.length - 1)
      for (let i = 0; i <= S; i++) {
        const th = gap + (i / S) * (Math.PI * 2 - 2 * gap)
        const r = r0 * (1 + 0.04 * Math.sin(th * 9) * edge * edge)
        const y = y0 + (j === rows.length - 1 ? 0.018 * Math.sin(th * 7 + 1) : 0)
        const p = new THREE.Vector3(Math.sin(th) * r, y, Math.cos(th) * r * 0.86)
        outer.push(p)
        inner.push(new THREE.Vector3(p.x * (1 - 0.012 / r), y - 0.004, p.z * (1 - 0.012 / r)))
        oc.push(top.clone().multiplyScalar(1 - 0.06 * edge * (0.5 - 0.5 * Math.sin(th * 9))))
        ic.push(lin)
      }
    })
    const a = [1.585, 0.5, 0.6, 0]
    b.grid(outer, oc, rows.length, S + 1, a)
    b.grid(inner, ic, rows.length, S + 1, a, true)
  }

  // --- the scarf's two tails, hanging down the left of the chest from the wrap
  {
    const m = new THREE.Matrix4()
    const o = new THREE.Object3D()
    const tail = (x: number, y: number, z: number, h: number, rz: number, color: string) => {
      o.position.set(x, y, z)
      o.rotation.set(-0.12, 0.25, rz)
      o.updateMatrix()
      m.copy(o.matrix)
      b.part(box(0.07, h, 0.014), m, color, [1.5, 0, 1.3, 0])
    }
    tail(0.07, 1.35, 0.168, 0.24, 0.1, COL.accent)
    tail(0.115, 1.38, 0.155, 0.17, 0.22, COL.accentDark)
  }
  return b.build()
}

/**
 * A partial lathe shell open at the front (+Z) with an inset inner shell wound inward, and a rim
 * strip joining the two along both edges of the opening: without it the 12 mm between the shells
 * shows as a see-through sliver when the hood is seen from three-quarters.
 */
function shell(profile: [number, number][], segs: number, gapHalf: number, outer: string, inner: string, warp: (v: THREE.Vector3) => void, rimColor: string | THREE.Color = outer): Part[] {
  const g = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segs,
    gapHalf,
    Math.PI * 2 - 2 * gapHalf,
  )
  const a = g.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < a.count; i++) {
    warp(v.fromBufferAttribute(a, i))
    a.setXYZ(i, v.x, v.y, v.z)
  }
  const ig = g.clone()
  const b = ig.attributes.position
  for (let i = 0; i < b.count; i++) {
    const x = b.getX(i), z = b.getZ(i), r = Math.hypot(x, z) || 1
    b.setXYZ(i, x - (x / r) * 0.012, b.getY(i) - 0.004, z - (z / r) * 0.012)
  }
  const idx = ig.index!.array as Uint16Array | Uint32Array
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1]
    idx[i + 1] = idx[i + 2]
    idx[i + 2] = t
  }
  // The rim: LatheGeometry lays its vertices out column by column (index = column * P + point), and
  // the inner shell keeps that layout. Each quad faces out of the opening, away from the next column in.
  const P = profile.length
  const rim: number[] = []
  const o0 = new THREE.Vector3(), o1 = new THREE.Vector3(), n0 = new THREE.Vector3(), n1 = new THREE.Vector3()
  const nb = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3()
  for (const [col, next] of [
    [0, 1],
    [segs, segs - 1],
  ]) {
    for (let j = 0; j < P - 1; j++) {
      o0.fromBufferAttribute(a, col * P + j)
      o1.fromBufferAttribute(a, col * P + j + 1)
      n0.fromBufferAttribute(b, col * P + j)
      n1.fromBufferAttribute(b, col * P + j + 1)
      nb.fromBufferAttribute(a, next * P + j)
      const outward = e1.subVectors(o1, o0).cross(e2.subVectors(n1, o0)).dot(nb.sub(o0)) < 0
      const quad = outward ? [o0, o1, n1, o0, n1, n0] : [o0, n1, o1, o0, n0, n1]
      for (const q of quad) rim.push(q.x, q.y, q.z)
    }
  }
  const rg = new THREE.BufferGeometry()
  rg.setAttribute('position', new THREE.Float32BufferAttribute(rim, 3))
  return [
    { geo: g, color: outer },
    { geo: ig, color: inner },
    { geo: rg, color: rimColor },
  ]
}

/** A strap laid over the robe's chest: a ribbon following the surface from one point to another. */
function strap(from: [number, number], to: [number, number], width: number, segs: number): THREE.BufferGeometry {
  const pos: number[] = []
  const at = (t: number, side: number) => {
    const x = from[0] + (to[0] - from[0]) * t
    const y = from[1] + (to[1] - from[1]) * t
    const dx = to[0] - from[0], dy = to[1] - from[1]
    const l = Math.hypot(dx, dy)
    // offset across the strap, perpendicular to its run in the x/y plane
    const ox = (-dy / l) * width * 0.5 * side, oy = (dx / l) * width * 0.5 * side
    const X = x + ox, Y = y + oy
    const r = Y > ROBE.pivot ? 0.19 : ROBE.radius(Y)
    const zs = Y > 1.15 ? 0.78 : 0.84
    const z = Math.sqrt(Math.max(0, r * r - X * X)) * zs + 0.01
    return [X, Y, z]
  }
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs
    const a = at(t0, -1), b = at(t0, 1), c = at(t1, -1), d = at(t1, 1)
    pos.push(...a, ...c, ...b, ...b, ...c, ...d)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return g
}

/** A tapering, slightly crooked shaft as a ring-per-step tube along +Y. */
function gnarledShaft(len: number, steps: number, sides: number): THREE.BufferGeometry {
  const pos: number[] = []
  const ring = (i: number): THREE.Vector3[] => {
    const t = i / steps
    const y = t * len
    // a crooked line with a couple of knuckles, thicker at the head
    const cx = 0.012 * Math.sin(t * 9.1 + 0.4) + 0.006 * Math.sin(t * 23 + 1)
    const cz = 0.01 * Math.sin(t * 7.3 + 2.1) + 0.005 * Math.sin(t * 19 + 0.3)
    const r = 0.021 + 0.004 * (1 - t) + 0.012 * sstep(t, 0.85, 1) + 0.004 * Math.max(0, Math.sin(t * 31))
    const pts: THREE.Vector3[] = []
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2 + i * 0.4
      pts.push(new THREE.Vector3(cx + Math.sin(a) * r, y, cz + Math.cos(a) * r))
    }
    return pts
  }
  let prev = ring(0)
  for (let i = 1; i <= steps; i++) {
    const cur = ring(i)
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides
      const a = prev[k], b = prev[k1], c = cur[k], d = cur[k1]
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
      pos.push(b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z)
    }
    prev = cur
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return g
}

/**
 * The porcelain mask, in head space (before the head scale). A softly convex oval, broadest at the
 * brow and narrowing to a rounded chin, curving back toward its edges; the faintest nose ridge runs
 * down the middle from between the eyes. `maskZ` is its front surface, used to lay the eye slits and
 * the painted line on it.
 */
const MASK = { cy: 0.14, a: 0.091, b: 0.116, z0: 0.106, spokes: 16 }
function maskOutline(th: number): [number, number] {
  // th = 0 at the brow's top, clockwise seen from the front (toward -X, the wanderer's right)
  const c = Math.cos(th), s = Math.sin(th)
  const chin = 1 - 0.3 * Math.pow(Math.max(0, -c), 1.6)
  const brow = 1 + 0.06 * Math.max(0, c)
  return [MASK.a * s * chin * brow, MASK.cy + MASK.b * c]
}
function maskZ(x: number, y: number): number {
  const u = x / MASK.a, v = (y - MASK.cy) / MASK.b
  // the nose ridge: a few millimetres along the centre line, between the eyes down to above the chin
  const ridge = 0.0025 * Math.max(0, 1 - Math.abs(x) / 0.015) * sstep(-v, -0.25, 0.05) * (1 - sstep(-v, 0.45, 0.7))
  return MASK.z0 - 0.042 * u * u - 0.02 * v * v - 0.012 * v + ridge
}
function maskGeo(): THREE.BufferGeometry {
  const S = MASK.spokes
  const rings = [0.36, 0.72, 1]
  const pt = (k: number, t: number) => {
    const [ox, oy] = maskOutline((k / S) * Math.PI * 2)
    const x = ox * t, y = MASK.cy + (oy - MASK.cy) * t
    return new THREE.Vector3(x, y, maskZ(x, y))
  }
  const pos: number[] = []
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
  const centre = new THREE.Vector3(0, MASK.cy, maskZ(0, MASK.cy))
  for (let k = 0; k < S; k++) {
    // spoke k runs toward -X (clockwise from the front), so (centre, k+1, k) faces +Z
    tri(centre, pt(k + 1, rings[0]), pt(k, rings[0]))
    for (let r = 1; r < rings.length; r++) {
      const a = pt(k, rings[r - 1]), b = pt(k + 1, rings[r - 1]), c = pt(k, rings[r]), d = pt(k + 1, rings[r])
      tri(a, b, c)
      tri(b, d, c)
    }
    // the edge turns back into the hood's shadow, so the mask has a thickness from three-quarters
    const e0 = pt(k, 1), e1 = pt(k + 1, 1)
    const back = (v: THREE.Vector3) => new THREE.Vector3(v.x * 0.9, MASK.cy + (v.y - MASK.cy) * 0.93, v.z - 0.03)
    const f0 = back(e0), f1 = back(e1)
    tri(e0, e1, f0)
    tri(e1, f1, f0)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return g
}
/** A flat almond laid on the mask: inner corner, two upper and two lower points, outer corner. */
function almond(side: number, cx: number, cy: number, len: number, h: number, tilt: number, lift: number): number[] {
  const pts: [number, number][] = [
    [-0.5, 0],
    [-0.18, 0.5],
    [0.2, 0.42],
    [0.5, 0],
    [0.16, -0.36],
    [-0.2, -0.4],
  ]
  const P = pts.map(([u, w]) => {
    const x = cx + u * len, y = cy + w * h + tilt * (u + 0.5) * len
    return [side * x, y, maskZ(side * x, y) + lift]
  })
  const out: number[] = []
  // a fan from the inner corner; winding faces +Z on either side
  for (let i = 1; i < P.length - 1; i++) {
    const [a, b, c] = side > 0 ? [P[0], P[i + 1], P[i]] : [P[0], P[i], P[i + 1]]
    out.push(...a, ...b, ...c)
  }
  return out
}
/** A thin brush stroke down the mask's centre line from y0 to y1, tapering from w0 to w1. */
function centreLine(y0: number, y1: number, w0: number, w1: number, segs: number, lift: number): THREE.BufferGeometry {
  const pos: number[] = []
  for (let i = 0; i < segs; i++) {
    const ta = i / segs, tb = (i + 1) / segs
    const ya = y0 + (y1 - y0) * ta, yb = y0 + (y1 - y0) * tb
    const wa = (w0 + (w1 - w0) * ta) / 2, wb = (w0 + (w1 - w0) * tb) / 2
    const a = [-wa, ya, maskZ(-wa, ya) + lift], b = [wa, ya, maskZ(wa, ya) + lift]
    const c = [-wb, yb, maskZ(-wb, yb) + lift], d = [wb, yb, maskZ(wb, yb) + lift]
    // y0 above y1: a/b on top
    pos.push(...a, ...c, ...b, ...b, ...c, ...d)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return g
}

function group(name: string, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group {
  const o = new THREE.Group()
  o.name = name
  o.position.set(x, y, z)
  parent.add(o)
  return o
}

function mesh(name: string, geo: THREE.BufferGeometry | null, mat: THREE.Material, parent: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(geo ?? new THREE.BufferGeometry(), mat)
  m.name = name
  parent.add(m)
  return m
}

/** Build the wanderer once. Materials are optional so offline previews can use the bare geometry. */
export function buildHero(paletteName: PaletteName = 'moss', mats?: HeroMaterials): HeroRig {
  const pal = PALETTES[paletteName]
  const fallback = new THREE.MeshBasicMaterial({ vertexColors: true })
  const heroMat = mats?.hero ?? fallback
  const root = new THREE.Group()
  root.name = 'hero'
  const body = group('body', root)
  const neck = group('neck', body, 0, DIM.neckY, 0)
  const shoulderL = group('shoulderL', body, DIM.shoulderX, DIM.shoulderY, 0)
  const elbowL = group('elbowL', shoulderL, 0, -DIM.upperArm, 0)
  const shoulderR = group('shoulderR', body, -DIM.shoulderX, DIM.shoulderY, 0)
  const elbowR = group('elbowR', shoulderR, 0, -DIM.upperArm, 0)
  const staff = group('staff', root)

  const cloth = mesh('cloth', buildCloth(pal), mats?.cloth ?? fallback, body)
  if (mats?.clothDepth) cloth.customDepthMaterial = mats.clothDepth

  // torso fittings over the robe; the belt sits where the robe starts to hang, so they agree
  const [sx, sy, sz] = DIM.satchel
  const torso = mesh(
    'torso',
    mergeColoured([
      { geo: cyl(0.188, 0.188, 0.05, 14), color: COL.belt, position: [0, ROBE.pivot, 0], scale: [1, 1, ROBE.zs] },
      { geo: box(0.052, 0.045, 0.014), color: COL.brass, position: [0, ROBE.pivot, 0.188 * ROBE.zs + 0.006] },
      { geo: strap([-0.15, 1.44], [0.17, 0.98], 0.038, 5), color: COL.strap },
      // the satchel on the left hip, its flap and buckle
      { geo: box(0.17, 0.15, 0.065), color: COL.satchel, position: [sx, sy, sz], rotation: [0, 0.85, 0] },
      { geo: box(0.176, 0.07, 0.072), color: COL.satchelFlap, position: [sx, sy + 0.045, sz], rotation: [0.06, 0.85, 0] },
      { geo: box(0.025, 0.03, 0.01), color: COL.brass, position: [sx + 0.03, sy + 0.02, sz + 0.035], rotation: [0, 0.85, 0] },
      // a pouch on the right hip, where the cloak's opening shows it
      { geo: box(0.08, 0.1, 0.045), color: COL.leather, position: [-0.12, 0.93, 0.15], rotation: [0, -0.5, 0] },
      { geo: box(0.085, 0.035, 0.05), color: COL.leatherDark, position: [-0.12, 0.97, 0.152], rotation: [0, -0.5, 0] },
      // the scarf wrapped at the throat, and a brass clasp holding the capelet
      { geo: new THREE.TorusGeometry(0.1, 0.042, 4, 10), color: COL.accent, position: [0, 1.5, 0.012], rotation: [Math.PI / 2, 0, 0], scale: [1.08, 1, 0.92] },
      { geo: new THREE.OctahedronGeometry(0.026, 0), color: COL.brass, position: [0, 1.445, 0.2], scale: [1, 1, 0.5] },
    ]),
    heroMat,
    body,
  )

  // head space: origin at the neck pivot, scaled up as a group (DIM.headScale). No face: a dark
  // wrapped head carries a porcelain mask, set back in the deep hood's opening.
  const headG = group('headScale', neck)
  headG.scale.setScalar(DIM.headScale)
  // the mask's upper part sits in the hood's shade (baked, a little: the mask must still read)
  const maskShade = (_x: number, y: number) => 0.97 - 0.13 * sstep(y, 0.17, 0.26)
  const head = mesh(
    'head',
    mergeColoured([
      { geo: new THREE.SphereGeometry(0.108, 7, 5), color: COL.wrap, position: [0, 0.132, -0.012], scale: [0.95, 1.12, 1] },
      { geo: maskGeo(), color: COL.mask, shade: (x, y, z) => maskShade(x, y) * (z < 0.06 ? 0.86 : 1) },
      // one thin painted stroke in the scarf's rust, from the brow's top down to between the eyes
      { geo: centreLine(MASK.cy + MASK.b - 0.009, MASK.cy + 0.013, 0.0095, 0.0025, 4, 0.0012), color: COL.accent, shade: maskShade },
      // the deep hood: a peak leaning back at the crown, a brim over the brow, a dark inside;
      // its lower edge tucks in so it sits inside the capelet's collar once scaled up
      ...shell(
        [
          [0.155, -0.085],
          [0.165, -0.03],
          [0.19, 0.06],
          [0.196, 0.16],
          [0.178, 0.25],
          [0.13, 0.32],
          [0.06, 0.37],
          [0.0, 0.39],
        ],
        14,
        0.78,
        pal.cloak,
        COL.hoodInner,
        (v) => {
          const r = Math.hypot(v.x, v.z)
          const front = r < 1e-4 ? 0 : Math.max(0, v.z / r)
          v.z = v.z * 1.12 - 0.02
          if (v.y > 0.2) v.z += 0.085 * ((v.y - 0.2) / 0.19) * front
          if (v.y > 0.26) {
            const t = (v.y - 0.26) / 0.13
            v.z -= 0.15 * t * (1 - front)
            v.y += 0.06 * t * t * (1 - front)
          }
        },
        // a worn, lighter edge round the opening: it frames the pale mask against the dark inside
        new THREE.Color(pal.cloak).lerp(new THREE.Color('#d9cfb4'), 0.18),
      ),
    ]),
    heroMat,
    headG,
  )
  // the eye slits: a separate unlit mesh so they can glow after dark (dark vertex colour for previews)
  const slitGeo = new THREE.BufferGeometry()
  slitGeo.setAttribute('position', new THREE.Float32BufferAttribute([...almond(1, 0.041, 0.146, 0.056, 0.018, 0.07, 0.0015), ...almond(-1, 0.041, 0.146, 0.056, 0.018, 0.07, 0.0015)], 3))
  const maskGlow = mesh('maskGlow', mergeColoured([{ geo: slitGeo, color: COL.maskSlit }]), mats?.maskGlow ?? fallback, headG)

  // sleeves of the robe with a darker turned-back cuff, and gloved hands
  const arms: THREE.Mesh[] = []
  for (const [side, sh, el] of [
    [1, shoulderL, elbowL],
    [-1, shoulderR, elbowR],
  ] as const) {
    arms.push(
      mesh('upperArm', mergeColoured([{ geo: cyl(0.066, 0.06, 0.29, 7), color: COL.robe, position: [0, -0.14, 0] }]), heroMat, sh),
      mesh(
        'forearm',
        mergeColoured([
          { geo: cyl(0.058, 0.072, 0.19, 7), color: COL.robe, position: [0, -0.095, 0] },
          { geo: cyl(0.076, 0.074, 0.035, 7), color: COL.robeHem, position: [0, -0.19, 0] },
          { geo: box(0.07, 0.09, 0.066), color: COL.glove, position: [0, -0.265, 0.005] },
          { geo: box(0.024, 0.05, 0.03), color: COL.glove, position: [side * -0.033, -0.245, 0.035] },
        ]),
        heroMat,
        el,
      ),
    )
  }

  // the staff: crooked wood, an iron ferrule, a wrapped grip, and a claw of wood round the crystal
  const prong = (a: number): Part => ({
    geo: new THREE.ConeGeometry(0.013, 0.17, 4),
    color: COL.staffDark,
    position: [Math.sin(a) * 0.035, 2.0, Math.cos(a) * 0.035],
    rotation: [Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3],
  })
  const staffMesh = mesh(
    'staff',
    mergeColoured([
      { geo: gnarledShaft(1.94, 14, 5), color: COL.staffWood },
      { geo: cyl(0.026, 0.02, 0.05, 6), color: COL.iron, position: [0, 0.025, 0] },
      { geo: cyl(0.03, 0.03, 0.2, 6), color: COL.staffGrip, position: [0, 1.12, 0] },
      { geo: new THREE.OctahedronGeometry(0.024, 0), color: COL.staffDark, position: [0.012, 0.62, 0.006], scale: [1, 1.4, 1] },
      { geo: new THREE.OctahedronGeometry(0.03, 0), color: COL.staffDark, position: [0.0, 1.92, 0.0], scale: [1.2, 1, 1.2] },
      prong(0.3),
      prong(2.4),
      prong(4.4),
    ]),
    heroMat,
    staff,
  )
  const crystal = mesh(
    'crystal',
    mergeColoured([{ geo: new THREE.OctahedronGeometry(0.055, 0), color: COL.crystal, position: [0, 2.04, 0], scale: [0.8, 1.45, 0.8] }]),
    mats?.crystal ?? fallback,
    staff,
  )

  const lit = [cloth, torso, head, ...arms, staffMesh]
  let triangles = (crystal.geometry.attributes.position.count + maskGlow.geometry.attributes.position.count) / 3
  for (const m of lit) triangles += m.geometry.attributes.position.count / 3
  return { root, body, neck, shoulderL, elbowL, shoulderR, elbowR, staff, cloth, crystal, maskGlow, lit, triangles }
}
