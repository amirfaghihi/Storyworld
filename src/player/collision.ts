/**
 * Collision and walking for places. No physics engine: solid set pieces register 2-D footprints
 * (circles and rotated boxes with an optional height band) and decks to stand on, the terrain is
 * the drawn TerrainSurface, and the Walker moves a body over both.
 *
 * The Walker is collide-and-slide: each frame is cut into sub-steps short enough that the body
 * cannot pass through a fence rail, every blocked sub-step slides along the wall that stopped
 * it, and the velocity keeps whatever part runs along the walls. Steep slopes, deep water and
 * deck edges are walls with a normal like any solid, so the body glides along a shore or a
 * contour instead of stopping dead. Vertically it stands exactly on the ground: snapped up when
 * the ground rises, glued down while it falls away no faster than a walkable slope, and falling
 * under gravity off anything steeper.
 *
 * It lives here rather than in KinematicController so scripts can drive the very same code in
 * node, without React or the stores.
 */
import type { Collider, ColliderLayer, Deck } from './colliderTypes'
import type { TerrainSurface } from '@/terrain/surface'
import type { GroundProbe } from '@/store/stores'

export type { Collider, ColliderLayer, SolidCircle, SolidBox, Deck } from './colliderTypes'

/** body footprint radius */
export const BODY_RADIUS = 0.45
/** height of the body, for walking under parapets and into the side of a deck */
export const BODY_HEIGHT = 1.9
/** the highest deck edge the body steps straight onto */
export const STEP_UP = 0.85
/** metres below sea level the body may wade */
export const WADE_DEPTH = 1.35
/** steepest walkable ground (gradient magnitude, rise / run; about 62 degrees) */
export const MAX_SLOPE = 1.9
const ACCEL = 30
/** longest sub-step: well under a fence rail plus the body radius (0.12 + 0.45), so nothing tunnels */
const MAX_SUBSTEP = 0.25
const MAX_SUBSTEPS = 6
const PUSH_ITERS = 4
const SLIDE_ITERS = 3
/** extra push-out so the next sub-step starts just clear of the wall */
const SKIN = 0.002
/** overlap left after the push passes that counts as being wedged between solids */
const PINCH = 0.01
/** a frame that ends in a crease having moved less than this was only shuffled by push-outs */
const CREASE_REST = 0.005
const DECK_THICK = 0.6
/** half-width of the central differences for the slope rule and for the shore normal */
const GRAD_E = 0.5
const SHORE_E = 1.0
const GRAVITY = 22
/**
 * Ground further below an idle, grounded body than this was moved out from under it (an editor
 * drag, a deck taken away): snap down to it rather than fall. A body that is moving or already
 * in the air always falls, however far.
 */
const SNAP_FAR = 6
/** extra drop allowed per sub-step before the body leaves the ground, over MAX_SLOPE per metre */
const GLUE = 0.06
/** ground probe distance ahead and behind for the slope speed factor */
const GRADE_PROBE = 0.6
const SPIRAL_STEP = 0.5
const SPIRAL_MAX = 6
/** [ring step, radius] passes for place(): fine and near first, then coarse and far for drowned spots */
const PLACE_SEARCH: [number, number][] = [
  [SPIRAL_STEP, SPIRAL_MAX],
  [3, 90],
]
const TAU = Math.PI * 2

// ---------- registry and spatial hash ----------

interface Entry {
  c: Collider
  /** cached cos / sin of the box or deck rotation */
  cs: number
  sn: number
  /** bounding radius around (c.x, c.z) */
  ext: number
  tree: boolean
  /** query stamp, so an entry spanning several cells is returned once */
  stamp: number
}

/** Grid cell size in metres: a body query touches one to four cells, a house a handful. */
const CELL = 8
const layers = new Map<ColliderLayer, Collider[]>()
const grid = new Map<number, Entry[]>()
let decks: Entry[] = []
let total = 0
let version = 0
let stamp = 0
const cand: Entry[] = []

const cellKey = (ix: number, iz: number) => (ix * 73856093) ^ (iz * 19349663)

function rebuild() {
  grid.clear()
  decks = []
  total = 0
  version++
  for (const [layer, list] of layers) {
    total += list.length
    for (const c of list) {
      const rot = c.kind === 'circle' ? 0 : c.rot
      const e: Entry = {
        c,
        cs: Math.cos(rot),
        sn: Math.sin(rot),
        ext: c.kind === 'circle' ? c.r : Math.hypot(c.hw, c.hd),
        tree: layer === 'trees' || (c.kind !== 'deck' && c.layer === 'trees'),
        stamp: 0,
      }
      // decks are few and asked for by point, so they stay in a plain list
      if (c.kind === 'deck') {
        decks.push(e)
        continue
      }
      for (let ix = Math.floor((c.x - e.ext) / CELL); ix <= Math.floor((c.x + e.ext) / CELL); ix++)
        for (let iz = Math.floor((c.z - e.ext) / CELL); iz <= Math.floor((c.z + e.ext) / CELL); iz++) {
          const k = cellKey(ix, iz)
          let b = grid.get(k)
          if (!b) grid.set(k, (b = []))
          b.push(e)
        }
    }
  }
}

/** Replace one layer's colliders (props come and go with a place's dressing, trees with its vegetation tier). */
export function setColliderLayer(layer: ColliderLayer, list: Collider[]) {
  layers.set(layer, list)
  rebuild()
}
export function clearColliderLayer(layer: ColliderLayer) {
  if (layers.delete(layer)) rebuild()
}
/** The 'props' layer, under the names LandmarkProps has always used. */
export function setColliders(list: Collider[]) {
  setColliderLayer('props', list)
}
export function clearColliders() {
  clearColliderLayer('props')
}
export function colliderCount() {
  return total
}
/** Bumped whenever any layer changes, so the controller can re-check a body the change may have landed on. */
export function colliderVersion() {
  return version
}

/** Solids whose footprint may lie within r of (x, z), into `cand`. */
function query(x: number, z: number, r: number) {
  stamp++
  cand.length = 0
  const ix1 = Math.floor((x + r) / CELL), iz1 = Math.floor((z + r) / CELL)
  for (let ix = Math.floor((x - r) / CELL); ix <= ix1; ix++)
    for (let iz = Math.floor((z - r) / CELL); iz <= iz1; iz++) {
      const b = grid.get(cellKey(ix, iz))
      if (!b) continue
      for (const e of b)
        if (e.stamp !== stamp) {
          e.stamp = stamp
          cand.push(e)
        }
    }
  return cand
}

// ---------- shapes ----------

const pen = { nx: 0, nz: 0, depth: 0 }

/** Overlap of a circle (x, z, r) with a solid: fills `pen` with the push-out normal and depth. */
function penetrate(e: Entry, x: number, z: number, r: number): boolean {
  const c = e.c
  if (c.kind === 'circle') {
    const dx = x - c.x, dz = z - c.z
    const d = Math.hypot(dx, dz)
    const min = c.r + r
    if (d >= min) return false
    if (d < 1e-6) {
      pen.nx = 1
      pen.nz = 0
    } else {
      pen.nx = dx / d
      pen.nz = dz / d
    }
    pen.depth = min - d
    return true
  }
  if (c.kind !== 'box') return false
  // to box-local space (rotation matches propUtil.at: +rot turns local +x toward -z)
  const cs = e.cs, sn = e.sn
  const dx = x - c.x, dz = z - c.z
  const lx = cs * dx - sn * dz, lz = sn * dx + cs * dz
  const ex = lx - Math.max(-c.hw, Math.min(c.hw, lx))
  const ez = lz - Math.max(-c.hd, Math.min(c.hd, lz))
  const d = Math.hypot(ex, ez)
  let nlx: number, nlz: number
  if (d > 1e-6) {
    if (d >= r) return false
    nlx = ex / d
    nlz = ez / d
    pen.depth = r - d
  } else {
    // centre inside the box: leave through the nearest face
    const px = c.hw - Math.abs(lx), pz = c.hd - Math.abs(lz)
    if (px < pz) {
      nlx = Math.sign(lx) || 1
      nlz = 0
      pen.depth = px + r
    } else {
      nlx = 0
      nlz = Math.sign(lz) || 1
      pen.depth = pz + r
    }
  }
  // back to world space
  pen.nx = cs * nlx + sn * nlz
  pen.nz = -sn * nlx + cs * nlz
  return true
}

/**
 * Whether a solid stands in the way of feet at feetY. On a deck, solids whose top is below the
 * feet are skipped (the bank fence under a bridge). Anything with a `bottom` above the head is
 * skipped too (a parapet seen from the water). Standing on terrain a solid is never skipped for
 * its top: walking down a slope toward a cart, the cart's top can be below the feet. A NaN
 * feetY ignores the height bands altogether.
 */
function relevant(c: Collider, feetY: number, onDeck: boolean) {
  if (c.kind === 'deck') return false
  if (onDeck && c.top !== undefined && c.top < feetY) return false
  if (c.bottom !== undefined && c.bottom > feetY + BODY_HEIGHT) return false
  return true
}

/** Contact normals gathered while moving: a fixed pool, nearly-equal normals kept once. */
export class Contacts {
  n = 0
  readonly nx = new Float64Array(16)
  readonly nz = new Float64Array(16)
  clear() {
    this.n = 0
  }
  add(nx: number, nz: number) {
    for (let i = 0; i < this.n; i++) if (this.nx[i] * nx + this.nz[i] * nz > 0.999) return
    if (this.n === this.nx.length) return
    this.nx[this.n] = nx
    this.nz[this.n] = nz
    this.n++
  }
}

/**
 * Push a circle at (x, z) out of every solid in the way of feet at feetY. Up to four passes, so
 * corners between pieces resolve; each push adds its normal to `contacts`. The result goes to
 * `out`. Returns false when the circle is still wedged more than a centimetre deep (a pinch
 * between solids): the caller should keep the old position.
 */
export function collideCircle(x: number, z: number, r: number, feetY: number, onDeck: boolean, out: { x: number; z: number }, contacts?: Contacts): boolean {
  for (let it = 0; it < PUSH_ITERS; it++) {
    let any = false
    for (const e of query(x, z, r + 0.1)) {
      if (!relevant(e.c, feetY, onDeck) || !penetrate(e, x, z, r)) continue
      x += pen.nx * (pen.depth + SKIN)
      z += pen.nz * (pen.depth + SKIN)
      contacts?.add(pen.nx, pen.nz)
      any = true
    }
    if (!any) {
      out.x = x
      out.z = z
      return true
    }
  }
  out.x = x
  out.z = z
  for (const e of query(x, z, r + 0.1)) if (relevant(e.c, feetY, onDeck) && penetrate(e, x, z, r) && pen.depth > PINCH) return false
  return true
}

const legacy = { x: 0, z: 0, hit: false }
const legacyContacts = new Contacts()
/** Push a circle out of every solid, ignoring heights. Kept for older callers; the Walker uses collideCircle. */
export function resolveCircle(x: number, z: number, r: number) {
  legacyContacts.clear()
  collideCircle(x, z, r, NaN, false, legacy, legacyContacts)
  legacy.hit = legacyContacts.n > 0
  return legacy
}

/** True when a point is inside a solid piece (within its height band, 0.3 m margin). Keeps the camera out of buildings; trunks are skipped unless asked for, so a wood does not yank the camera about. */
export function pointInSolid(x: number, y: number, z: number, skipTrees = true): boolean {
  for (const e of query(x, z, 0.3)) {
    const c = e.c
    if (c.kind === 'deck' || (skipTrees && e.tree)) continue
    if ((c.top !== undefined && y > c.top) || (c.bottom !== undefined && y < c.bottom)) continue
    if (c.kind === 'circle') {
      if (Math.hypot(x - c.x, z - c.z) < c.r + 0.3) return true
    } else {
      const dx = x - c.x, dz = z - c.z
      const lx = e.cs * dx - e.sn * dz
      const lz = e.sn * dx + e.cs * dz
      if (Math.abs(lx) < c.hw + 0.3 && Math.abs(lz) < c.hd + 0.3) return true
    }
  }
  return false
}

/** A deck under a point: its walking height there, the deck, and the point in the deck's local axes. */
export interface DeckHit {
  y: number
  c: Deck
  lx: number
  lz: number
  cs: number
  sn: number
}
const deckScratch: DeckHit = { y: 0, c: undefined as unknown as Deck, lx: 0, lz: 0, cs: 1, sn: 0 }

/** Highest walkable deck under (x, z), written into `out` (a shared scratch object by default), or null. */
export function deckAt(x: number, z: number, out: DeckHit = deckScratch): DeckHit | null {
  let found = false
  for (const e of decks) {
    const c = e.c as Deck
    const dx = x - c.x, dz = z - c.z
    if (dx * dx + dz * dz > e.ext * e.ext) continue
    const lx = e.cs * dx - e.sn * dz
    const lz = e.sn * dx + e.cs * dz
    if (Math.abs(lx) > c.hw || Math.abs(lz) > c.hd) continue
    const t = (lx + c.hw) / (2 * c.hw)
    const y = c.yA + (c.yB - c.yA) * t + Math.sin(t * Math.PI) * c.arc
    if (found && y <= out.y) continue
    found = true
    out.y = y
    out.c = c
    out.lx = lx
    out.lz = lz
    out.cs = e.cs
    out.sn = e.sn
  }
  return found ? out : null
}

/** Highest walkable deck under (x, z), or -Infinity when there is none. */
export function deckHeight(x: number, z: number): number {
  return deckAt(x, z)?.y ?? -Infinity
}

// ---------- walking ----------

/** What the Walker moves: playerState fits it. */
export interface WalkBody {
  position: { x: number; y: number; z: number }
  velocity: { x: number; z: number }
  /** vertical speed, non-zero only while falling */
  vy: number
  grounded: boolean
}

const RING_COS: number[] = []
const RING_SIN: number[] = []

/**
 * Moves a body over one world's drawn terrain and the registered colliders. All per-frame
 * scratch lives on the instance, so step() allocates nothing.
 */
export class Walker {
  /** set by step(): the body touched a solid this frame */
  hit = false
  /** set by step(): a sub-step could not move at all (a crease, a dead end) */
  stuck = false
  /** set by step(): standing on a deck after the move */
  onDeck = false
  /** rise / run along the direction of travel, positive uphill (0 when not moving) */
  grade = 0
  readonly contacts = new Contacts()

  private readonly sea: number
  // support(): what the last call found besides the height
  private supDeck = false
  private readonly over: DeckHit = { ...deckScratch }
  private hasOver = false
  private readonly deckTmp: DeckHit = { ...deckScratch }
  // scratch
  private readonly res = { x: 0, z: 0 }
  private readonly blk = { nx: 0, nz: 0, terrain: false }
  private readonly water = { x: 0, z: 0, nx: 0, nz: 0, pushed: false }
  private tnx = 0
  private tnz = 0
  private stepOnDeck = false

  constructor(readonly surface: TerrainSurface) {
    this.sea = surface.seaLevel
  }

  /** drawn terrain height */
  private H(x: number, z: number) {
    return this.surface.height(x, z)
  }

  /**
   * Height the body would stand at on (x, z) with its feet at feetY: a deck counts when it is
   * above the terrain and at most STEP_UP above the feet, otherwise the terrain. Records whether
   * a deck carried it, and any deck overhead that did not (for the deck-edge wall).
   */
  support(x: number, z: number, feetY: number): number {
    const t = this.H(x, z)
    const d = deckAt(x, z, this.deckTmp)
    this.supDeck = false
    this.hasOver = false
    if (d && d.y > t) {
      if (d.y <= feetY + STEP_UP) {
        this.supDeck = true
        return d.y
      }
      Object.assign(this.over, d)
      this.hasOver = true
    }
    return t
  }

  /** Where a body put down at (x, z) stands: on a deck if one spans the point, else on the terrain. */
  standY(x: number, z: number): number {
    const t = this.H(x, z)
    const d = deckAt(x, z, this.deckTmp)
    this.supDeck = !!d && d.y > t
    return this.supDeck ? d!.y : t
  }

  /**
   * Put a body down at (x, z) clear of every solid and out of water too deep to wade: the point
   * itself if it is fit, or pushed out, else the nearest fit point on rings 0.5 m to 6 m out, then
   * on coarser rings to 90 m. Returns false (and the point as asked) when nothing is found.
   */
  place(x: number, z: number, out: { x: number; y: number; z: number }): boolean {
    const hf = this.surface.hf
    // Close in first, then much further out on a coarser spiral: a spot in the middle of a pool
    // (the editor's "Go there" on Bywater) has no dry ground within 6 m, and a body set down
    // deeper than it can wade cannot move at all.
    for (const [step, max] of PLACE_SEARCH) {
      for (let ring = 0; ring * step <= max; ring++) {
        const rad = ring * step
        const n = ring === 0 ? 1 : 12
        for (let i = 0; i < n; i++) {
          // stagger alternate rings so the search covers the gaps between spokes
          const a = ((i + (ring % 2) * 0.5) / 12) * TAU
          const cx = hf.clampX(x + Math.cos(a) * rad)
          const cz = hf.clampZ(z + Math.sin(a) * rad)
          const y = this.standY(cx, cz)
          if (y < this.sea - WADE_DEPTH) continue
          if (!collideCircle(cx, cz, BODY_RADIUS, y, this.supDeck, this.res)) continue
          const px = hf.clampX(this.res.x), pz = hf.clampZ(this.res.z)
          const py = this.standY(px, pz)
          // the push-out can carry it back into the water it was meant to avoid
          if (py < this.sea - WADE_DEPTH) continue
          out.x = px
          out.z = pz
          out.y = py
          return true
        }
      }
    }
    out.x = hf.clampX(x)
    out.z = hf.clampZ(z)
    out.y = this.standY(out.x, out.z)
    return false
  }

  /**
   * Free a body that solids have appeared on (props built after spawn, an editor change, a new
   * tree tier): push it out where it stands, or put it down at the nearest free point if it is
   * wedged. Its height is left for the next step. Returns true only when it had to be put down
   * somewhere else.
   */
  unstick(body: WalkBody): boolean {
    const p = body.position
    const hf = this.surface.hf
    this.support(p.x, p.z, p.y)
    if (collideCircle(p.x, p.z, BODY_RADIUS, p.y, this.supDeck, this.res)) {
      p.x = hf.clampX(this.res.x)
      p.z = hf.clampZ(this.res.z)
      return false
    }
    this.place(p.x, p.z, p)
    body.vy = 0
    body.grounded = true
    return true
  }

  /**
   * One frame: accelerate toward the wish direction (length up to 1) at `maxSpeed` scaled by the
   * slope ahead, slide the body through the colliders and over the terrain, and stand it on the
   * ground. dt should already be capped (the controller uses 1/20 s).
   */
  step(body: WalkBody, wishX: number, wishZ: number, maxSpeed: number, dt: number) {
    const p = body.position
    const v = body.velocity
    const hf = this.surface.hf
    const moving = wishX !== 0 || wishZ !== 0

    // Slower uphill, a little quicker downhill. The grade is read along the way the body is
    // actually going once it is under way: pushing into a slope face or a bank it slides along
    // the contour, and the face it cannot climb must not slow that slide.
    this.grade = 0
    if (moving) {
      const vl = Math.hypot(v.x, v.z)
      const wl = Math.hypot(wishX, wishZ)
      const dx = vl > 0.5 ? v.x / vl : wishX / wl
      const dz = vl > 0.5 ? v.z / vl : wishZ / wl
      this.grade = (this.support(p.x + dx * GRADE_PROBE, p.z + dz * GRADE_PROBE, p.y) - this.support(p.x - dx * GRADE_PROBE, p.z - dz * GRADE_PROBE, p.y)) / (2 * GRADE_PROBE)
      const g = this.grade
      maxSpeed *= g > 0 ? 1 - 0.55 * Math.min(g, 1) : 1 + 0.15 * Math.min(-g, 0.6)
    }
    let tx = wishX * maxSpeed - v.x
    let tz = wishZ * maxSpeed - v.z
    const tl = Math.hypot(tx, tz)
    const acc = ACCEL * dt
    if (tl > acc) {
      tx *= acc / tl
      tz *= acc / tl
    }
    v.x += tx
    v.z += tz
    if (!moving && Math.hypot(v.x, v.z) < 0.05) v.x = v.z = 0

    const contacts = this.contacts
    contacts.clear()
    this.tnx = this.tnz = 0
    this.hit = false
    this.stuck = false
    this.support(p.x, p.z, p.y)
    this.stepOnDeck = this.supDeck
    const x0 = p.x, y0 = p.y, z0 = p.z, grounded0 = body.grounded

    // sub-steps short enough that no wall is skipped, at any frame rate
    const speed = Math.hypot(v.x, v.z)
    const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil((speed * dt) / MAX_SUBSTEP)))
    const h = dt / n
    for (let s = 0; s < n; s++) {
      let mx = v.x * h, mz = v.z * h
      for (let it = 0; it < SLIDE_ITERS; it++) {
        if (this.tryMove(body, mx, mz)) break
        // wedged between solids: stay put this sub-step
        if (!this.blocked) break
        const b = this.blk
        if (b.terrain) {
          this.tnx += b.nx
          this.tnz += b.nz
        } else contacts.add(b.nx, b.nz)
        // slide: drop the part of the move that runs into the wall
        const d = mx * b.nx + mz * b.nz
        if (d >= 0) break
        mx -= b.nx * d
        mz -= b.nz * d
        if (it === SLIDE_ITERS - 1) {
          // a third wall: inch along the last slide rather than stop
          if (!this.tryMove(body, mx * 0.5, mz * 0.5) && !this.tryMove(body, mx * 0.25, mz * 0.25)) this.stuck = true
        }
      }
    }
    this.hit = contacts.n > 0

    // Keep the part of the velocity that runs along the walls. Terrain walls (slope faces,
    // shores) merge into one normal. Solids are solved order-independently: each single-wall
    // projection is tried and the longest that clears every wall wins; when none does, the
    // walls form a crease and the body stops. (Projecting wall by wall in turn jitters at the
    // seams between hedge segments.)
    const tn = Math.hypot(this.tnx, this.tnz)
    if (tn > 1e-6) {
      const nx = this.tnx / tn, nz = this.tnz / tn
      const d = v.x * nx + v.z * nz
      if (d < 0) {
        v.x -= nx * d
        v.z -= nz * d
      }
    }
    let violated = false
    let bx = 0, bz = 0, bl = -1
    for (let i = 0; i < contacts.n; i++) {
      const ax = contacts.nx[i], az = contacts.nz[i]
      const d = v.x * ax + v.z * az
      if (d >= 0) continue
      violated = true
      const cx = v.x - ax * d, cz = v.z - az * d
      let ok = true
      for (let j = 0; j < contacts.n && ok; j++) if (cx * contacts.nx[j] + cz * contacts.nz[j] < -1e-4) ok = false
      if (ok && cx * cx + cz * cz > bl) {
        bx = cx
        bz = cz
        bl = cx * cx + cz * cz
      }
    }
    if (violated) {
      if (bl >= 0) {
        v.x = bx
        v.z = bz
      } else {
        v.x = v.z = 0
        // Pressed into a crease the push-outs alone move the body, by a skin's width this way
        // or that each frame (a post against its gate leaf): keep it where the frame began so
        // it rests still. A body that ran into the crease this frame keeps the run.
        if (grounded0 && body.grounded && Math.hypot(p.x - x0, p.z - z0) < CREASE_REST) {
          p.x = x0
          p.y = y0
          p.z = z0
        }
      }
      if (Math.hypot(v.x, v.z) < 0.05) v.x = v.z = 0
    }

    // off a ledge: fall under gravity until the ground (or a deck) catches the feet
    if (!body.grounded) {
      body.vy -= GRAVITY * dt
      const fallFrom = p.y
      p.y += body.vy * dt
      // The drop can bring the feet into the height band of a solid the sub-steps passed over
      // (the parapet below a deck edge): push out at the new height now, not a frame late.
      this.support(p.x, p.z, p.y)
      if (collideCircle(p.x, p.z, BODY_RADIUS, p.y, this.supDeck, this.res)) {
        p.x = hf.clampX(this.res.x)
        p.z = hf.clampZ(this.res.z)
      }
      // A deck only counts as support within STEP_UP of the feet, so asking at the height after
      // the drop lets a fast frame carry the feet more than STEP_UP under a deck and on through
      // it (at 20 fps from 7.5 m up). Asking at the height the feet fell from catches any deck
      // the drop crossed.
      const g = this.support(p.x, p.z, fallFrom)
      if (p.y <= g) {
        p.y = g
        body.vy = 0
        body.grounded = true
      }
    }
    // Pinned at the map rim the body cannot go on outward, so neither can its velocity (or the
    // avatar would run on the spot).
    if (v.x !== 0 && hf.clampX(p.x + Math.sign(v.x) * 1e-3) === p.x) v.x = 0
    if (v.z !== 0 && hf.clampZ(p.z + Math.sign(v.z) * 1e-3) === p.z) v.z = 0

    this.support(p.x, p.z, p.y)
    this.onDeck = this.supDeck && body.grounded
  }

  /** set by tryMove when it failed on a wall (blk holds the wall), not on a pinch */
  private blocked = false

  /** Move the body by (mx, mz) if the resolved spot is walkable; otherwise leave it and say why. */
  private tryMove(body: WalkBody, mx: number, mz: number): boolean {
    const p = body.position
    const hf = this.surface.hf
    this.blocked = false
    let cx = hf.clampX(p.x + mx), cz = hf.clampZ(p.z + mz)
    // Solids hanging over the ground (a parapet above a bank that rises under the bridge) are
    // judged at the height the feet climb to, so the body meets them as walls instead of
    // standing up inside one.
    const fy = Math.max(p.y, this.H(cx, cz))
    for (let k = 0; k < 2; k++) {
      if (!collideCircle(cx, cz, BODY_RADIUS, fy, this.stepOnDeck, this.res, this.contacts)) return false
      cx = hf.clampX(this.res.x)
      cz = hf.clampZ(this.res.z)
      if (!this.waterPush(cx, cz, p.y)) return false
      if (!this.water.pushed) break
      // the shore pushed the body back: a terrain wall, and the solids get one more look
      this.tnx += this.water.nx
      this.tnz += this.water.nz
      cx = hf.clampX(this.water.x)
      cz = hf.clampZ(this.water.z)
      if (k === 1 && !collideCircle(cx, cz, BODY_RADIUS, fy, this.stepOnDeck, this.res, this.contacts)) return false
    }
    if (this.walkBlock(p, cx, cz, mx, mz)) {
      this.blocked = true
      return false
    }
    const dist = Math.hypot(cx - p.x, cz - p.z)
    p.x = cx
    p.z = cz
    // Stand on the ground: rising ground lifts the feet at once (they never trail below it);
    // falling ground keeps them glued while it drops no faster than a walkable slope; past
    // that the body leaves the ground and step() lets it fall.
    const g = this.support(cx, cz, p.y)
    if (g >= p.y || (body.grounded && dist === 0 && p.y - g > SNAP_FAR)) {
      p.y = g
      body.vy = 0
      body.grounded = true
    } else if (body.grounded && p.y - g <= MAX_SLOPE * dist + GLUE) {
      p.y = g
    } else body.grounded = false
    return true
  }

  /**
   * Whether (tx, tz) cannot be walked onto from the body's spot, by an intended move (mx, mz).
   * When it cannot, `blk` holds the wall's horizontal normal and whether it is terrain.
   */
  private walkBlock(p: { x: number; y: number; z: number }, tx: number, tz: number, mx: number, mz: number): boolean {
    if (Math.hypot(tx - p.x, tz - p.z) < 1e-6) return false
    const there = this.support(tx, tz, p.y)
    const b = this.blk
    // the side of a deck: too high to step onto but low enough to hit the body
    if (this.hasOver) {
      const o = this.over
      if (o.y - (o.c.thick ?? DECK_THICK) < p.y + BODY_HEIGHT && o.y > p.y + STEP_UP) {
        const fx = o.c.hw - Math.abs(o.lx), fz = o.c.hd - Math.abs(o.lz)
        const nlx = fx < fz ? Math.sign(o.lx) : 0, nlz = fx < fz ? 0 : Math.sign(o.lz)
        b.nx = o.cs * nlx + o.sn * nlz
        b.nz = -o.sn * nlx + o.cs * nlz
        b.terrain = false
        return true
      }
    }
    if (this.supDeck) return false
    // Too steep to climb. The rule is on the gradient magnitude, so a diagonal approach climbs
    // no steeper face than a straight one; the intended move decides uphill, since a shore
    // push-out can carry the body sideways up a bank.
    const here = this.support(p.x, p.z, p.y)
    if (there > here) {
      const e = GRAD_E
      const gx = (this.H(tx + e, tz) - this.H(tx - e, tz)) / (2 * e)
      const gz = (this.H(tx, tz + e) - this.H(tx, tz - e)) / (2 * e)
      const G = Math.hypot(gx, gz)
      if (G > MAX_SLOPE && mx * gx + mz * gz > 0) {
        b.nx = -gx / G
        b.nz = -gz / G
        b.terrain = true
        return true
      }
    }
    return false
  }

  /**
   * Bring a point that lies deeper than the wade limit back onto the shoreline, by Newton steps
   * up the terrain gradient. The wide stencil smooths the staircase of the 2 m grid, so the
   * shore normal turns gently along a diagonal shore. A deck the feet can stand on (feetY up to
   * STEP_UP below it) counts as dry. Returns false if it cannot.
   */
  private waterPush(x: number, z: number, feetY: number): boolean {
    const w = this.water
    const limit = this.sea - WADE_DEPTH
    w.pushed = false
    for (let k = 0; k < 4; k++) {
      const hh = this.H(x, z)
      const d = deckAt(x, z, this.deckTmp)
      // a deck only lifts the limit when it is what the feet stand on, not a bridge overhead
      if (hh >= limit || (d && d.y > hh && d.y <= feetY + STEP_UP)) {
        w.x = x
        w.z = z
        return true
      }
      const e = SHORE_E
      const gx = (this.H(x + e, z) - this.H(x - e, z)) / (2 * e)
      const gz = (this.H(x, z + e) - this.H(x, z - e)) / (2 * e)
      const g2 = gx * gx + gz * gz
      if (g2 < 1e-8) return false
      const gl = Math.sqrt(g2)
      const st = Math.min((limit - hh + 0.01) / g2, 0.5 / gl)
      x += gx * st
      z += gz * st
      w.nx = gx / gl
      w.nz = gz / gl
      w.pushed = true
    }
    w.x = x
    w.z = z
    return this.H(x, z) >= limit
  }

  /**
   * Publish the ground under the body for the avatar: a ring of support samples round it, the
   * least-squares plane through them. `ringR` is the ring radius (GROUND_RING_R); the ring size
   * is out.ring's length. out.sample is the caller's to bind (to support at the body's feet).
   */
  probe(body: WalkBody, out: GroundProbe, ringR: number) {
    const p = body.position
    const N = out.ring.length
    if (RING_COS.length !== N) {
      RING_COS.length = RING_SIN.length = 0
      for (let i = 0; i < N; i++) {
        RING_COS.push(Math.cos((i / N) * TAU))
        RING_SIN.push(Math.sin((i / N) * TAU))
      }
    }
    const R = ringR
    let sx = 0, sz = 0, sc = 0
    for (let i = 0; i < N; i++) {
      const dx = R * RING_COS[i], dz = R * RING_SIN[i]
      const hh = this.support(p.x + dx, p.z + dz, p.y)
      out.ring[i] = hh
      sx += hh * dx
      sz += hh * dz
      sc += hh
    }
    // the ring is symmetric, so the three least-squares sums decouple
    const k = 2 / (N * R * R)
    out.plane.gx = sx * k
    out.plane.gz = sz * k
    out.plane.c = sc / N
    out.normal.set(-out.plane.gx, 1, -out.plane.gz).normalize()
    out.y = this.support(p.x, p.z, p.y)
    out.onDeck = this.supDeck
    out.gradeFwd = this.grade
    out.valid = true
  }
}
