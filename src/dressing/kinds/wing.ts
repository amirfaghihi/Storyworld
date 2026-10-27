/**
 * `wing`: every range of the Last Homely House in Rivendell (Rivendell spec A.1).
 *
 * Read from the books, in our own design: one large house of many rooms, steps and halls, its
 * windows lit at night and its doors standing open on firelight. Each range is a plain block of
 * pale dressed stone on a low plinth, under a low hipped roof of blue-grey slate with deep eaves
 * and a plain fascia. The Elvish touch is restraint: tall round-headed windows under a plain
 * lintel, a sill course and a string course at each floor, a round-headed fanlight over a tall
 * door. No carving, no tracery, no curving or swooping roof lines, no finials, no tower.
 *
 * Frame: the origin is the range's centre; local x runs across (width), local z along the ridge
 * (length). Doors sit centred on the faces listed in `doors` ('+x', '-x', '+z', '-z'). Windows
 * run along both long sides (the +-x faces), one row per storey. `c.scale` is ignored: every size
 * is in metres.
 *
 * Two builds:
 * - closed (`enter: ''`): one body box to the ridge; she cannot go in. Door steps where the ground
 *   falls away from a door (none on Rivendell's level shelf).
 * - enterable (`enter: '-x'` etc.): four 0.6 m walls with a doorway on the `enter` face, a lintel
 *   over it, and a roof box whose underside is just under the eaves line, which she walks under
 *   and which keeps the follow camera inside. Inside: dimmed wall faces, a plain floor slab and
 *   three dark beams under the ceiling; no windows unless asked for (the Hall of Fire has none, so
 *   its fire is the only strong light). Smoke leaves through the ridge louvre (`chimneyTop`).
 *
 * Params (all optional; see WING_DEFAULTS): width, length, storeys, storeyHeight, roof 'hip' |
 * 'gable', pitch (rise over the roof's span), eaves, doors, doorWidth, doorsOpen, windows (per long
 * side per storey), lowWindow (a face: one ground-floor window there sits low, its sill a seat),
 * bellcote, louvres, enter; colours wall, roofColor, trim, plinthColor, glow.
 */
import * as THREE from 'three'
import type { Part } from '@/render/mergeColoured'
import { hash2 } from '@/terrain/faceColors'
import { type PropContext, P, S, B, at, plinth, solidBox, box, cone, gableRoofLow, roofBase } from '../propUtil'
import { doorSteps, stepDeck } from '../placeUtil'

/** Default size, full extents in metres along local x (width) and local z (length); not scaled. */
export const WING_FOOTPRINT = { width: 9, length: 18 } as const

/** Every param's default (Rivendell spec A.1). */
export const WING_DEFAULTS = {
  width: WING_FOOTPRINT.width,
  length: WING_FOOTPRINT.length,
  storeys: 2,
  storeyHeight: 3.4,
  roof: 'hip' as 'hip' | 'gable',
  pitch: 0.3,
  eaves: 1.0,
  doors: '+z',
  doorWidth: 2.4,
  doorsOpen: true,
  windows: 4,
  /** windows per storey on each gable end; -1 = one per 5 m of width when `windows` > 0 (an addition to spec A.1) */
  gableWindows: -1,
  lowWindow: '',
  bellcote: false,
  louvres: 0,
  enter: '',
  wall: '#e6e0d0',
  roofColor: '#6d8aa8',
  trim: '#b9b2a2',
  plinthColor: '#bdb6a6',
  glow: '#ffd890',
}

export type WingFace = '+x' | '-x' | '+z' | '-z'
const FACES: readonly WingFace[] = ['+x', '-x', '+z', '-z']
const isFace = (s: string): s is WingFace => (FACES as readonly string[]).includes(s)

/** wall thickness of an enterable wing */
const WALL_T = 0.6
/** the fascia band at the eaves: its height (the roof planes start on top of it) */
const BAND = 0.3
/** the louvre's body top and vent band above the ridge */
const LOUVRE_BODY = 0.35
const LOUVRE_VENT = 0.25
/** the lintel collider's underside above the floor in an enterable doorway (spec A.1) */
const LINTEL_BOTTOM = 2.6
const LEAF = '#5a4632'
const FLOOR_SLAB = '#8f887c'
const BEAM = '#6a5d4e'
const BELL = '#9a8a5a'
const VENT = '#3a3630'
/** how much of the `glow` colour windows and open doors take (see the builder) */
const GLOW_DAY = 0.55
const GLOW_DOOR = 0.65

/** A face's outward yaw (added to c.rot so a part's +z points out of that face) and its half-length. */
function faceInfo(face: WingFace, w: number, L: number) {
  switch (face) {
    case '+x':
      return { yaw: Math.PI / 2, half: L / 2, dist: w / 2 }
    case '-x':
      return { yaw: -Math.PI / 2, half: L / 2, dist: w / 2 }
    case '+z':
      return { yaw: 0, half: w / 2, dist: L / 2 }
    default:
      return { yaw: Math.PI, half: w / 2, dist: L / 2 }
  }
}

/**
 * A point on a face in the wing's local (x, z): `u` along the face (in the direction of the face
 * part's own +x, so pieces built in a face frame line up), `o` out from the wall plane.
 */
function onFace(face: WingFace, w: number, L: number, u: number, o: number): [number, number] {
  switch (face) {
    case '+x':
      return [w / 2 + o, -u]
    case '-x':
      return [-w / 2 - o, u]
    case '+z':
      return [u, L / 2 + o]
    default:
      return [-u, -L / 2 - o]
  }
}

function parseFaces(s: string): WingFace[] {
  const out: WingFace[] = []
  for (const t of s.split(',')) {
    const f = t.trim()
    if (isFace(f) && !out.includes(f)) out.push(f)
  }
  return out
}

/** The window sizes for a storey `sh` tall: pane width, round-head radius, sill and pane height (to the springing). */
function windowSize(sh: number) {
  const tall = sh >= 5
  const pw = tall ? 1.3 : 1.0
  const r = pw / 2
  const sill = tall ? 1.4 : 0.9
  // the head (arch + lintel) stays 0.2 m clear of the storey line above, or of the eaves
  const room = sh - sill - r - 0.2 - 0.2
  const ph = tall ? Math.max(1.0, Math.min(0.4 * sh, room)) : Math.max(0.8, Math.min(1.9, room))
  return { pw, r, sill, ph }
}

/**
 * The numbers the builder, the town map, the chimney smoke and the integrator's checks must agree
 * on. Heights are world y; positions are the wing's local (x, z) unless named world.
 */
export function wingFrame(c: PropContext) {
  const D = WING_DEFAULTS
  const w = Math.max(3, P(c, 'width', D.width))
  const L = Math.max(3, P(c, 'length', D.length))
  const storeys = Math.max(1, Math.round(P(c, 'storeys', D.storeys)))
  const storeyHeight = Math.max(2.4, P(c, 'storeyHeight', D.storeyHeight))
  const h = storeys * storeyHeight
  const roof: 'hip' | 'gable' = S(c, 'roof', D.roof) === 'gable' ? 'gable' : 'hip'
  const pitch = Math.max(0.05, P(c, 'pitch', D.pitch))
  const eaves = Math.max(0, P(c, 'eaves', D.eaves))
  const hw = w / 2 + 0.2
  const hd = L / 2 + 0.2
  const enterRaw = S(c, 'enter', D.enter).trim()
  const enter: WingFace | null = isFace(enterRaw) ? enterRaw : null
  // a closed wing may bury its floor a little (the body hides it); one you walk into stands on its
  // highest ground, or the slope comes up through the floor inside
  const { floor, foot } = plinth(c, hw, hd, enter ? 0 : 0.45)
  const span = w + 2 * eaves
  const roofLength = L + 2 * eaves
  const rise = pitch * span
  /** the eaves line (the fascia's foot and the walls' top), and the ridge */
  const eavesY = floor + h
  const ridgeY = floor + h + rise
  /** half-length of the ridge along local z: a hip roof's ends fall at the side slopes' pitch */
  const ridgeHalf = roof === 'hip' ? Math.max(0, (roofLength - span) / 2) : roofLength / 2

  const doorFaces = parseFaces(S(c, 'doors', D.doors))
  if (enter && !doorFaces.includes(enter)) doorFaces.push(enter)
  const lowRaw = S(c, 'lowWindow', D.lowWindow).trim()
  const lowWindow: WingFace | null = isFace(lowRaw) ? lowRaw : null
  const doorWidth = Math.max(enter ? 1.2 : 0.8, P(c, 'doorWidth', D.doorWidth))
  /** the doorway's clear height: 2.8, or less in a low storey so its surround stays under the eaves */
  const doorHeight = enter ? Math.max(2.3, Math.min(2.8, storeyHeight - 0.6)) : Math.min(2.8, storeyHeight - 0.6) // a doorway she walks through clears her hood
  const doors = doorFaces.map((face) => {
    const [lx, lz] = onFace(face, w, L, 0, 0)
    const [x, z] = at(c, lx, lz)
    return { face, lx, lz, x, z, width: doorWidth, height: doorHeight, enter: face === enter }
  })

  const windows = Math.max(0, Math.round(P(c, 'windows', D.windows)))
  // the gable ends: -1 (auto) gives one window per 5 m of width when the long sides have any
  const gw = Math.round(P(c, 'gableWindows', D.gableWindows))
  const gableWindows = gw >= 0 ? gw : windows > 0 ? Math.max(1, Math.floor(w / 5)) : 0
  const nl = Math.max(0, Math.round(P(c, 'louvres', D.louvres)))
  const lr = Math.max(0, ridgeHalf - 1.2)
  const louvreZ = nl === 0 ? [] : nl === 1 ? [0] : Array.from({ length: nl }, (_, i) => -lr + (2 * lr * i) / (nl - 1))
  const bellcote = B(c, 'bellcote', D.bellcote)
  // on the ridge near the +z end: L/2 - 2 on a gable, but a hip's ridge stops short of that
  const bellZ = Math.min(L / 2 - 2, Math.max(0, ridgeHalf - 0.3))

  return {
    w, L, storeys, storeyHeight, h, roof, pitch, eaves, span, roofLength, rise,
    floor, foot, eavesY, ridgeY, ridgeHalf,
    /** the body box's (closed) or the roof box's (enterable) half extents: the map footprint */
    hw, hd,
    enter,
    doors, doorWidth, doorHeight,
    lowWindow,
    windows,
    gableWindows,
    louvreZ,
    /** smoke from the first louvre (null without one) */
    chx: 0,
    chz: louvreZ[0] ?? 0,
    chimneyTop: louvreZ.length > 0 ? ridgeY + 1.0 : null,
    /** the bell-cote's foot on the ridge (local x, world y, local z), or null */
    bell: bellcote ? ([0, ridgeY, bellZ] as [number, number, number]) : null,
    /** an enterable wing's roof box underside (she walks under it, the camera stays under it) */
    roofBottom: enter ? floor + h - 0.2 : null,
    /**
     * What the town map draws: a building of half extents hw x hd turned with the wing, its ridge
     * line `ridge` either side of the centre along local z (the drawn ridge of a hip is shorter than
     * the house). An enterable wing is drawn as its roof box (spec: no ridge line, `ridge` 0).
     */
    map: { hw, hd, ridge: enter ? 0 : ridgeHalf },
  }
}

/**
 * The bare floor inside an enterable wing (no grass tufts through it), in the shape
 * channelFootprint gives: a rect of half extents hw x hd at world (x, z) turned by rot. Null for a
 * closed wing, whose walls already cover the ground.
 */
export function wingFloorFootprint(c: PropContext): { x: number; z: number; hw: number; hd: number; rot: number } | null {
  if (!isFace(S(c, 'enter', WING_DEFAULTS.enter).trim())) return null
  const w = Math.max(3, P(c, 'width', WING_DEFAULTS.width))
  const L = Math.max(3, P(c, 'length', WING_DEFAULTS.length))
  // the whole footing, walls included, and a little over the doorway's threshold
  return { x: c.x, z: c.z, hw: w / 2 + 0.2, hd: L / 2 + 0.2, rot: c.rot }
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
    const outward = n[0] * (fc[0] - cen[0]) + n[1] * (fc[1] - cen[1]) + n[2] * (fc[2] - cen[2]) >= 0
    for (let i = 1; i < f.length - 1; i++) {
      const tri = outward ? [f[0], f[i], f[i + 1]] : [f[0], f[i + 1], f[i]]
      for (const p of tri) pos.push(p[0], p[1], p[2])
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return g
}

/** A box with no back (-z) face, for pieces set against a wall: 10 triangles instead of 12. */
function slab(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d)
  const idx = g.index!.array
  g.setIndex(Array.from(idx).slice(0, 30))
  g.clearGroups()
  return g
}

/** A round-headed pane facing +z: `pw` wide, upright sides `ph` tall from y = 0, a half-disc of 6 segments on top. */
function archPane(pw: number, ph: number): THREE.BufferGeometry {
  const r = pw / 2
  const pts = [new THREE.Vector2(-r, 0), new THREE.Vector2(r, 0), new THREE.Vector2(r, ph)]
  for (let k = 1; k < 6; k++) pts.push(new THREE.Vector2(r * Math.cos((Math.PI * k) / 6), ph + r * Math.sin((Math.PI * k) / 6)))
  pts.push(new THREE.Vector2(-r, ph))
  return new THREE.ShapeGeometry(new THREE.Shape(pts))
}

/** [a, b] less every interval in `cut` (each [lo, hi]); pieces shorter than `min` are dropped. */
function spans(a: number, b: number, cut: [number, number][], min = 0.3): [number, number][] {
  let out: [number, number][] = [[a, b]]
  for (const [lo, hi] of cut) {
    const next: [number, number][] = []
    for (const [p, q] of out) {
      if (hi <= p || lo >= q) next.push([p, q])
      else {
        if (lo > p) next.push([p, lo])
        if (hi < q) next.push([hi, q])
      }
    }
    out = next
  }
  return out.filter(([p, q]) => q - p >= min)
}

/** `n` window centres evenly along [a, b] (each in the middle of its own share). */
const evenly = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((i + 0.5) * (b - a)) / n)

export function wing(c: PropContext, out: Part[]): void {
  const f = wingFrame(c)
  const { w, L, storeys, storeyHeight: sh, h, floor: y, foot, eavesY, ridgeY, ridgeHalf, span, roofLength: Lr, enter, doorWidth: dw, doorHeight: dh } = f
  const D = WING_DEFAULTS
  // each range's stone a shade different, by seed, so the house does not read as one casting
  const wallC = new THREE.Color(S(c, 'wall', D.wall)).multiplyScalar(0.97 + 0.05 * hash2(c.seed, 17))
  const roofC = new THREE.Color(S(c, 'roofColor', D.roofColor)).multiplyScalar(0.96 + 0.06 * hash2(c.seed, 23))
  const trim = S(c, 'trim', D.trim)
  const stone = S(c, 'plinthColor', D.plinthColor)
  // the glow colour is the light at night: unlit parts are drawn x1.7 by day and up to x4.8 at
  // night, so panes take it at GLOW_DAY to read warm amber by day instead of white, and still burn
  // bright after dark; open doors (firelight) a little stronger
  const glowWin = new THREE.Color(S(c, 'glow', D.glow)).multiplyScalar(GLOW_DAY)
  const glow = new THREE.Color(S(c, 'glow', D.glow)).multiplyScalar(GLOW_DOOR)
  const doorsOpen = B(c, 'doorsOpen', D.doorsOpen)
  const inner = wallC.clone().multiplyScalar(0.75)

  /** a part in the wing's frame at world height py, turned a further `yaw` */
  const put = (geo: THREE.BufferGeometry, color: string | THREE.Color, lx: number, py: number, lz: number, yaw = 0, extra: Partial<Part> = {}) => {
    const [x, z] = at(c, lx, lz)
    out.push({ geo, color, position: [x, py, z], rotation: [0, c.rot + yaw, 0], ...extra })
  }
  /** an upright box in the wing's axes between world heights */
  const block = (lx: number, lz: number, sx: number, sz: number, bottom: number, top: number, color: string | THREE.Color, extra: Partial<Part> = {}) =>
    put(box(sx, Math.max(0.02, top - bottom), sz), color, lx, (top + bottom) / 2, lz, 0, extra)
  /** a piece on a face: `u` along it, `o` out from the wall plane, its own +z pointing out */
  const onWall = (face: WingFace, geo: THREE.BufferGeometry, color: string | THREE.Color, u: number, o: number, py: number, extra: Partial<Part> = {}) => {
    const [lx, lz] = onFace(face, w, L, u, o)
    put(geo, color, lx, py, lz, faceInfo(face, w, L).yaw, extra)
  }
  // the stone darkens a little toward the ground
  const grime = (_x: number, vy: number) => 0.9 + 0.1 * Math.min(1, Math.max(0, (vy - y) / 3))

  // ---- footing, walls, plinth course, string courses ----
  if (y - foot > 0.02) block(0, 0, w + 0.4, L + 0.4, foot, y, stone)
  const doorFace = new Map(f.doors.map((d) => [d.face, d]))
  /** the door surround's half-width along its face, and a margin either side */
  const doorHalf = (dw + 0.6) / 2
  if (!enter) {
    block(0, 0, w, L, y, eavesY, wallC, { shade: grime })
    block(0, 0, w + 0.1, L + 0.1, y - 0.05, y + 0.35, stone)
  } else {
    // four walls WALL_T thick, the enter face split round its doorway; the long (+-x) walls run
    // the full length, the end walls fit between them
    for (const face of FACES) {
      const { half } = faceInfo(face, w, L)
      const side = face === '+x' || face === '-x'
      const along = side ? half : half - WALL_T
      const door: [number, number][] = face === enter ? [[-dw / 2, dw / 2]] : []
      for (const [p, q] of spans(-along, along, door, 0.05)) onWall(face, box(q - p, h, WALL_T), wallC, (p + q) / 2, -WALL_T / 2, y + h / 2, { shade: grime })
      // the plinth course and string courses outside, round the corners
      for (const [p, q] of spans(-half - 0.05, half + 0.05, door, 0.05)) {
        onWall(face, slab(q - p, 0.4, 0.05), stone, (p + q) / 2, 0.025, y + 0.15)
        for (let k = 1; k < storeys; k++) onWall(face, slab(q - p, 0.18, 0.05), trim, (p + q) / 2, 0.025, y + k * sh)
      }
      // the inner faces, dimmed
      const ih = side ? L / 2 - WALL_T : w / 2 - WALL_T
      for (const [p, q] of spans(-ih, ih, door, 0.05)) {
        const [ilx, ilz] = onFace(face, w, L, (p + q) / 2, -WALL_T - 0.02)
        put(new THREE.PlaneGeometry(q - p, h), inner, ilx, y + h / 2, ilz, faceInfo(face, w, L).yaw + Math.PI)
      }
      if (face === enter) {
        // the wall over the doorway, dim inside like the rest
        onWall(face, box(dw, h - dh, WALL_T), wallC, 0, -WALL_T / 2, y + (h + dh) / 2)
        const [ilx, ilz] = onFace(face, w, L, 0, -WALL_T - 0.02)
        put(new THREE.PlaneGeometry(dw, h - dh), inner, ilx, y + (h + dh) / 2, ilz, faceInfo(face, w, L).yaw + Math.PI)
      }
    }
    // inside: a plain floor and dark beams across under the ceiling
    // (its top 2 cm over the floor, so she walks the shelf without sinking into it)
    block(0, 0, w - 2 * WALL_T, L - 2 * WALL_T, y - 0.1, y + 0.02, FLOOR_SLAB)
    const nb = Math.max(1, Math.round(L / 6))
    for (let i = 0; i < nb; i++) block(0, -L / 2 + ((i + 1) * L) / (nb + 1), w - 2 * WALL_T, 0.3, eavesY - 0.32, eavesY, BEAM)
  }
  if (!enter) for (let k = 1; k < storeys; k++) block(0, 0, w + 0.1, L + 0.1, y + k * sh - 0.09, y + k * sh + 0.09, trim)

  // ---- the roof: a fascia band all round at the eaves (its underside the soffit), then a low hip
  // (or gable) of slate up to the ridge ----
  block(0, 0, span, Lr, eavesY, eavesY + BAND, trim)
  {
    const y1 = eavesY + BAND - y
    const a = ridgeY - y
    const xe = span / 2, ze = Lr / 2
    const b: V3[] = [[-xe, y1, -ze], [xe, y1, -ze], [xe, y1, ze], [-xe, y1, ze]]
    let geo: THREE.BufferGeometry
    if (ridgeHalf < 0.02) {
      const apex: V3 = [0, a, 0]
      geo = convex([b, [b[0], b[1], apex], [b[1], b[2], apex], [b[2], b[3], apex], [b[3], b[0], apex]])
    } else {
      const r0: V3 = [0, a, -ridgeHalf], r1: V3 = [0, a, ridgeHalf]
      geo = convex([b, [b[0], b[3], r1, r0], [b[1], b[2], r1, r0], [b[0], b[1], r0], [b[2], b[3], r1]])
    }
    put(geo, roofC, 0, y, 0)
    // a slim ridge piece in a darker slate along a hip's ridge, or the gable's
    if (ridgeHalf >= 0.02) block(0, 0, 0.26, 2 * ridgeHalf + 0.26, ridgeY - 0.2, ridgeY + 0.07, roofC.clone().multiplyScalar(0.82))
  }

  // ---- louvres on the ridge: a stone body, a dark vent band, a small slate gable on top ----
  for (const lz of f.louvreZ) {
    block(0, lz, 1.4, 1.8, ridgeY - 0.5, ridgeY + LOUVRE_BODY, trim)
    block(0, lz, 1.3, 1.7, ridgeY + LOUVRE_BODY, ridgeY + LOUVRE_BODY + LOUVRE_VENT, VENT)
    const cap = gableRoofLow(2, 2.4, 0.5)
    put(cap, roofC, 0, ridgeY + LOUVRE_BODY + LOUVRE_VENT + roofBase(cap), lz)
  }

  // ---- the bell-cote: a small stone gable on the ridge with a bell hanging in it (never a tower) ----
  if (f.bell) {
    const bz = f.bell[2]
    const base = ridgeY + 0.1
    block(0, bz, 1.7, 0.6, ridgeY - 0.7, base, wallC)
    for (const s of [-1, 1]) block(s * 0.6, bz, 0.3, 0.3, base, base + 1.4, wallC)
    block(0, bz, 1.5, 0.36, base + 1.4, base + 1.58, trim)
    const cr = gableRoofLow(1.8, 1.2, 0.5)
    put(cr, roofC, 0, base + 1.58 + roofBase(cr), bz)
    block(0, bz, 0.06, 0.06, base + 1.12, base + 1.4, trim)
    put(cone(0.3, 0.4, 8), BELL, 0, base + 0.92, bz)
  }

  // ---- doors: a plain stone surround (two jambs and a head); an open door is a warm glow, a shut
  // one two dark leaves; a tall storey gets a round-headed fanlight over it ----
  for (const d of f.doors) {
    const face = d.face
    const headTop = Math.min(y + dh + 0.4, y + sh - 0.12)
    for (const s of [-1, 1]) onWall(face, slab(0.3, headTop - y, 0.3), trim, s * (dw / 2 + 0.15), 0, (headTop + y) / 2)
    onWall(face, slab(dw + 0.6, headTop - y - dh, 0.3), trim, 0, 0, (headTop + y + dh) / 2)
    if (d.enter) continue
    if (doorsOpen) onWall(face, new THREE.PlaneGeometry(dw, dh), glow, 0, 0.07, y + dh / 2, { unlit: true })
    else for (const s of [-1, 1]) onWall(face, slab(dw / 2 - 0.02, dh, 0.08), LEAF, (s * dw) / 4, 0.04, y + dh / 2)
    const fr = dw / 2
    if (doorsOpen && sh - (dh + 0.4) >= fr + 0.5 && face !== enter) {
      // the fanlight: a half-disc of glow over the head, under a thin hood
      onWall(face, archPane(dw, 0.01), glowWin, 0, 0.07, headTop + 0.05, { unlit: true })
      onWall(face, slab(dw + 0.5, 0.18, 0.12), trim, 0, 0, headTop + 0.05 + fr + 0.14)
    }
  }

  // ---- windows: round-headed panes along both long sides, a row per storey, glowing warm; a plain
  // lintel over each and a sill course under each row ----
  const ws = windowSize(sh)
  const winHalf = 0.65 * (ws.pw / 1.0)
  /** windows per storey on a face: `windows` on the long sides, and a row sized to the width on each gable end */
  const rowOf = (face: WingFace) => (face === '+x' || face === '-x' ? f.windows : f.gableWindows)
  /** the window centres (u along the face) for a face, the same on every storey so they stack */
  const layout = (face: WingFace, n: number): number[] => {
    const { half } = faceInfo(face, w, L)
    if (n <= 0) return []
    const margin = 0.4
    if (!doorFace.has(face)) return evenly(-half + margin, half - margin, n)
    // with a door on the face, share the windows between the two sides of it
    const gap = doorHalf + 0.35 + winHalf
    if (half - margin - gap < 2 * winHalf) return []
    const left = Math.floor(n / 2), right = n - left
    return [...evenly(-half + margin, -gap + winHalf, left), ...evenly(gap - winHalf, half - margin, right)]
  }
  // which window is the low one: on lowWindow's face, the one nearest that face's door (or its centre)
  let low: { face: WingFace; u: number } | null = null
  if (f.lowWindow) {
    const us = layout(f.lowWindow, rowOf(f.lowWindow))
    if (us.length > 0) low = { face: f.lowWindow, u: us.reduce((m, u) => (Math.abs(u) < Math.abs(m) || (Math.abs(u) === Math.abs(m) && u > m) ? u : m)) }
    else {
      // a face with no row of windows (a gable end): one low window beside its door, or at its centre
      const { half } = faceInfo(f.lowWindow, w, L)
      const u = doorFace.has(f.lowWindow) ? Math.min(half - winHalf - 0.3, doorHalf + 0.35 + winHalf) : 0
      low = { face: f.lowWindow, u }
    }
  }
  const pane = (face: WingFace, u: number, sill: number, ph: number) => {
    onWall(face, archPane(ws.pw, ph), glowWin, u, 0.06, sill, { unlit: true })
    onWall(face, slab(ws.pw + 0.3, 0.2, 0.12), trim, u, 0, sill + ph + ws.r + 0.08)
  }
  for (const face of FACES) {
    const us = layout(face, rowOf(face))
    if (us.length === 0) continue
    const { half } = faceInfo(face, w, L)
    for (let k = 0; k < storeys; k++) {
      const base = y + k * sh
      const cut: [number, number][] = []
      if (k === 0 && doorFace.has(face)) cut.push([-doorHalf - 0.1, doorHalf + 0.1])
      for (const u of us) {
        if (k === 0 && low && low.face === face && u === low.u) {
          cut.push([u - winHalf - 0.05, u + winHalf + 0.05])
          continue
        }
        pane(face, u, base + ws.sill, ws.ph)
      }
      // the sill course under the row, broken by the door and the low window
      for (const [p, q] of spans(-half, half, cut)) onWall(face, slab(q - p, 0.12, 0.14), trim, (p + q) / 2, 0, base + ws.sill - 0.06)
    }
  }
  if (low) {
    // the low window: the same head line, its sill at 0.5 m, a deep sill board to sit on
    const lowSill = 0.5
    pane(low.face, low.u, y + lowSill, ws.ph + (ws.sill - lowSill))
    onWall(low.face, slab(1.4, 0.15, 0.45), trim, low.u, 0, y + lowSill - 0.075)
    const [bx, bz] = onFace(low.face, w, L, low.u, 0.225)
    const side = low.face === '+x' || low.face === '-x'
    solidBox(c, bx, bz, side ? 0.225 : 0.7, side ? 0.7 : 0.225, 0, c.rot, { top: y + lowSill })
  }

  // ---- colliders ----
  if (!enter) {
    // one body box over the walls and roof: she cannot go in
    solidBox(c, 0, 0, f.hw, f.hd, 0, c.rot, { top: ridgeY })
  } else {
    for (const face of FACES) {
      const { half } = faceInfo(face, w, L)
      const along = face === '+x' || face === '-x' ? half : half - WALL_T
      // the enter face's wall pieces reach out over the door surround's 0.15 m
      const out0 = face === enter ? 0.15 : 0
      const pieces = face === enter ? spans(-along, along, [[-dw / 2, dw / 2]], 0.05) : [[-along, along] as [number, number]]
      for (const [p, q] of pieces) {
        const m = (p + q) / 2, len = q - p
        const [lx, lz] = onFace(face, w, L, m, (out0 - WALL_T) / 2)
        const side = face === '+x' || face === '-x'
        const th = (WALL_T + out0) / 2
        solidBox(c, lx, lz, side ? th : len / 2, side ? len / 2 : th, 0, c.rot, { top: y + h })
      }
      if (face === enter) {
        const [lx, lz] = onFace(face, w, L, 0, (0.15 - WALL_T) / 2)
        const side = face === '+x' || face === '-x'
        const th = (WALL_T + 0.15) / 2
        solidBox(c, lx, lz, side ? th : dw / 2, side ? dw / 2 : th, 0, c.rot, { bottom: y + Math.min(LINTEL_BOTTOM, dh), top: y + h })
      }
    }
    // the roof box: she walks under it, and the follow camera stays under it
    solidBox(c, 0, 0, f.hw, f.hd, 0, c.rot, { bottom: f.roofBottom!, top: ridgeY })
    // a floor standing above the ground gets a deck over the inside and through the doorway
    const ground = c.ground(c.x, c.z)
    if (y - ground > 0.05 && c.colliders) {
      c.colliders.push({ kind: 'deck', x: c.x, z: c.z, hw: w / 2 - WALL_T, hd: L / 2 - WALL_T, rot: c.rot, yA: y + 0.02, yB: y + 0.02, arc: 0, thick: y + 0.02 - foot })
      const ec: PropContext = { ...c, rot: c.rot + faceInfo(enter, w, L).yaw }
      const dist = faceInfo(enter, w, L).dist
      stepDeck(ec, 0, dist - WALL_T, dist + 0.2, dw / 2, y + 0.02, y + 0.02)
    }
  }

  // last, as they hang on the ground in front of each door: steps down where the ground falls away
  // (none on a level terrace). doorSteps builds off a +z face, so it is given the wing turned to face.
  for (const d of f.doors) {
    const { yaw, dist } = faceInfo(d.face, w, L)
    doorSteps({ ...c, rot: c.rot + yaw }, out, 0, dist + 0.2, dw / 2, d.enter ? y + 0.02 : y)
  }
}
