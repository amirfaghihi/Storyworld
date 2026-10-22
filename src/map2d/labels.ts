import { SpatialHash, overlaps, type AABB } from './geom/spatialHash'
import { regionCandidates, type Pt } from './geom/polylabel'
import { fold } from './search'
import { MARKER_SIZE, MARKER_SIZE_TOUCH, clusterMarkers, effectivePriority, type ChipCorner, type Cluster, type MarkerModel } from './markers'

/**
 * Where the map writes its names. Pure (no DOM): text widths come from an injected
 * measure(text, font), so scripts/check-map-labels.ts runs the very same solver in node with
 * node-canvas and the dialog runs it with a canvas 2D context.
 *
 * Greedy and priority-ordered, the way cartographers letter a map by hand: markers and the map's
 * own controls are laid down first as obstacles, then each place name, most important first,
 * takes the first of eight slots round its marker that collides with nothing already lettered.
 * Names that find no room are left off (the marker stays, and its tooltip still names it) and
 * come back as the map zooms in and space opens up. Region names go last, into open country,
 * so they never sit on a place name or a marker. A name keeps last layout's slot while it still
 * fits there, and a new slot must clear its neighbours by a little more, so names do not jump
 * about between zoom steps.
 */

export type Slot = 'r' | 'l' | 't' | 'b' | 'tr' | 'br' | 'tl' | 'bl'

/**
 * Candidate positions in the order they are tried: right of the marker reads best, then left,
 * then above and below, then the diagonals; last, the four sides again with the name slid half
 * its height (or most of its width) along the marker, which finds room in a tight cluster.
 * On a town plan (a layout with building outlines to keep off) the four sides are tried once
 * more, held off further (FAR px steps), for a marker that stands among its own buildings.
 * A position is a slot, a slide (-1, 0, 1) and that extra distance.
 */
export const SLOTS: readonly Slot[] = ['r', 'l', 't', 'b', 'tr', 'br', 'tl', 'bl']
const FAR = [10, 20, 32]
type Position = readonly [Slot, number, number]
const NEAR: readonly Position[] = [
  ...SLOTS.map((s) => [s, 0, 0] as const),
  ...(['r', 'l', 't', 'b'] as const).flatMap((s) => [[s, -1, 0] as const, [s, 1, 0] as const]),
]
const POSITIONS: readonly Position[] = [...NEAR, ...FAR.flatMap((far) => (['r', 'l', 't', 'b'] as const).map((s) => [s, 0, far] as const))]
/**
 * Near the right edge names start on the left of their markers (lettering faces into the map),
 * so zooming in, which pushes those markers outward, does not flip them all across one by one.
 */
const MIRROR: Record<Slot, Slot> = { r: 'l', l: 'r', t: 't', b: 'b', tr: 'tl', tl: 'tr', br: 'bl', bl: 'br' }
const POSITIONS_INWARD = POSITIONS.map(([s, k, f]) => POSITIONS.find(([s2, k2, f2]) => s2 === MIRROR[s] && k2 === k && f2 === f)!)

/** The --font-ui and --font-display stacks of tokens.css (a canvas cannot read var()). */
export const FONT_UI = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
export const FONT_DISPLAY = "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif"

/** Label type sizes; touch screens get larger minor names (never under 12 px on a phone). */
export function labelFonts(touch: boolean) {
  const majorSize = 12.5
  const minorSize = touch ? 12 : 11.5
  return {
    majorSize,
    minorSize,
    major: `600 ${majorSize}px ${FONT_UI}`,
    minor: `500 ${minorSize}px ${FONT_UI}`,
    region: (size: number) => `600 ${size}px ${FONT_DISPLAY}`,
  }
}

/** Space round the text for its halo, so two names never touch halo to glyph. */
const HALO = 2
/** Gap between a marker's edge and its name. */
const GAP = 3
/** Priority at and above which a name is one the traveller is attending to (markers.effectivePriority adds 40 or more). */
const FOCUS_PRIORITY = 40
/** Priority at and above which a place name is set in the heavier face. */
export const MAJOR_PRIORITY = 5

export type Measure = (text: string, font: string) => number

export interface PlaceLabelInput {
  id: string
  text: string
  /** marker centre in CSS px */
  x: number
  y: number
  /** marker radius in CSS px */
  r: number
  priority: number
}

export interface RegionLabelInput {
  id: string
  text: string
  /** anchor candidates in CSS px, best first */
  candidates: { x: number; y: number }[]
  /** on-screen width of the region's outline (clipped to the map), which sizes the lettering */
  extent: number
  priority: number
}

/** A convex outline in CSS px (x, y pairs) the lettering must keep off, with its bounding box. */
export interface ScreenPoly {
  pts: ArrayLike<number>
  box: AABB
}

/**
 * Whether a convex polygon and a box (grown by pad) overlap: separating axes, the box's two and
 * each polygon edge's normal. Exact, so a turned building blocks only what it covers, not its
 * whole bounding box.
 */
export function polyHitsBox(poly: ScreenPoly, b: AABB, pad = 0): boolean {
  const x0 = b.x0 - pad
  const y0 = b.y0 - pad
  const x1 = b.x1 + pad
  const y1 = b.y1 + pad
  if (poly.box.x1 <= x0 || poly.box.x0 >= x1 || poly.box.y1 <= y0 || poly.box.y0 >= y1) return false
  const p = poly.pts
  const n = p.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const nx = p[2 * i + 1] - p[2 * j + 1]
    const ny = p[2 * j] - p[2 * i]
    let pmin = Infinity
    let pmax = -Infinity
    for (let k = 0; k < n; k++) {
      const d = p[2 * k] * nx + p[2 * k + 1] * ny
      if (d < pmin) pmin = d
      if (d > pmax) pmax = d
    }
    // the box's extent along this normal: its centre ± half extents projected
    const c = ((x0 + x1) / 2) * nx + ((y0 + y1) / 2) * ny
    const e = ((x1 - x0) / 2) * Math.abs(nx) + ((y1 - y0) / 2) * Math.abs(ny)
    if (pmax <= c - e || c + e <= pmin) return false
  }
  return true
}

/** A marker badge (a disc) the lettering must keep off. */
export interface MarkerDisc {
  id: string
  x: number
  y: number
  r: number
}

export interface PlacedLabel {
  slot: Slot
  /** how far the name is slid along its side (-1, 0, 1) */
  slide: number
  /** extra px between the marker and the name (0 for the usual slots) */
  far: number
  box: AABB
  /** offset of the box's top-left from the marker centre, for positioning the DOM label */
  dx: number
  dy: number
  w: number
  h: number
  major: boolean
}

export interface PlacedRegion {
  /** centre in CSS px, and which candidate it took */
  x: number
  y: number
  candidate: number
  size: number
  /** letter spacing in px */
  track: number
  w: number
  h: number
  box: AABB
}

export interface LabelLayout {
  places: Map<string, PlacedLabel | null>
  regions: Map<string, PlacedRegion | null>
}

export interface LabelLayoutInput {
  vw: number
  vh: number
  /** keep lettering this far inside the viewport */
  inset?: number
  places: PlaceLabelInput[]
  regions: RegionLabelInput[]
  markers: MarkerDisc[]
  /** screen rects of the map's own controls, the player and anything else lettering must avoid */
  reserved: AABB[]
  /** outlines lettering must avoid (a place's buildings) */
  polys?: ScreenPoly[]
  measure: Measure
  touch?: boolean
  /** the previous layout, for slot hysteresis */
  prev?: LabelLayout | null
  /**
   * the camera has come to rest: names may move to make room for more (while it moves they hold
   * their places, so the map does not shuffle its names mid-zoom)
   */
  settled?: boolean
}

/** The label box for a slot round a marker at (x, y) of radius r. */
export function slotBox(slot: Slot, x: number, y: number, r: number, w: number, h: number, slide = 0): AABB {
  // diagonal slots put the box's near corner just outside the disc (0.7·r·√2 ≈ r)
  const d = r * 0.7 + 1
  let x0: number
  let y0: number
  switch (slot) {
    case 'r':
      x0 = x + r + GAP
      y0 = y - h / 2 + slide * (h / 2)
      break
    case 'l':
      x0 = x - r - GAP - w
      y0 = y - h / 2 + slide * (h / 2)
      break
    case 't':
      x0 = x - w / 2 + slide * Math.max(0, w / 2 - r)
      y0 = y - r - GAP - h + 2
      break
    case 'b':
      x0 = x - w / 2 + slide * Math.max(0, w / 2 - r)
      y0 = y + r + GAP - 2
      break
    case 'tr':
      x0 = x + d
      y0 = y - d - h
      break
    case 'br':
      x0 = x + d
      y0 = y + d
      break
    case 'tl':
      x0 = x - d - w
      y0 = y - d - h
      break
    case 'bl':
      x0 = x - d - w
      y0 = y + d
      break
  }
  return { x0, y0, x1: x0 + w, y1: y0 + h }
}

/** Whether a disc and a box (grown by pad) overlap. */
export function discHitsBox(d: { x: number; y: number; r: number }, b: AABB, pad = 0): boolean {
  const cx = Math.max(b.x0 - pad, Math.min(d.x, b.x1 + pad))
  const cy = Math.max(b.y0 - pad, Math.min(d.y, b.y1 + pad))
  const dx = d.x - cx
  const dy = d.y - cy
  return dx * dx + dy * dy < d.r * d.r
}

const inside = (b: AABB, x0: number, y0: number, x1: number, y1: number) => b.x0 >= x0 && b.y0 >= y0 && b.x1 <= x1 && b.y1 <= y1

/** "The Hill" and "Hill" are the same name; region names that repeat a place's name are left off. */
const bare = (s: string) => fold(s).replace(/^the /, '')

export function layoutLabels(input: LabelLayoutInput): LabelLayout {
  const { vw, vh, measure, prev } = input
  const inset = input.inset ?? 8
  const fonts = labelFonts(!!input.touch)
  const markers = input.markers
  // a name's own marker is not an obstacle: the slots are built to clear it
  const hitsMarker = (b: AABB, pad: number, own: string) => {
    for (const m of markers) if (m.id !== own && discHitsBox(m, b, pad)) return true
    return false
  }
  const polys = input.polys ?? []
  const hitsPoly = (b: AABB, pad: number) => {
    for (const q of polys) if (polyHitsBox(q, b, pad)) return true
    return false
  }

  /** Letters the places in the given order, from last layout's slots or afresh; returns the names and the boxes taken. */
  const letter = (places: PlaceLabelInput[], from: LabelLayout | null | undefined) => {
    const idx = new SpatialHash(48)
    for (const r of input.reserved) idx.insert(r)
    const out = new Map<string, PlacedLabel | null>()
    let count = 0
    for (const p of places) {
      const major = p.priority >= MAJOR_PRIORITY
      const size = major ? fonts.majorSize : fonts.minorSize
      const w = Math.ceil(measure(p.text, major ? fonts.major : fonts.minor)) + 2 * HALO
      const h = Math.ceil(size * 1.2)
      const last = from?.places.get(p.id)
      const was = last ? POSITIONS.find(([s, k, f]) => s === last.slot && k === last.slide && f === last.far) : undefined
      const all = p.x > vw * 0.72 ? POSITIONS_INWARD : POSITIONS
      // the held-off positions only where buildings crowd this marker (elsewhere a name that far
      // from its marker reads as someone else's). Asking whether any building is in view was too
      // loose: on Edoras's open map it held the ford's name off its marker and let phone zoom steps
      // shuffle names.
      const reach = p.r + FAR[FAR.length - 1]
      const crowded = polys.some((q) => q.box.x0 < p.x + reach && q.box.x1 > p.x - reach && q.box.y0 < p.y + reach && q.box.y1 > p.y - reach)
      const fresh = crowded ? all : all.filter((q) => !q[2])
      const order = was ? [was, ...fresh.filter((q) => q !== was)] : fresh
      let placed: PlacedLabel | null = null
      for (const pos of order) {
        const [slot, slide, far] = pos
        const box = slotBox(slot, p.x, p.y, p.r + far, w, h, slide)
        // a position other than last time's must clear its neighbours (and the edge) by 2 px more,
        // so names settle where they are rather than trading places at every zoom step
        const pad = pos === was ? 0 : 2
        const e = inset + pad - 2
        if (!inside(box, e, e, vw - e, vh - e)) continue
        if (idx.hits(box, pad) || hitsMarker(box, pad, p.id) || hitsPoly(box, pad)) continue
        placed = { slot, slide, far, box, dx: box.x0 - p.x, dy: box.y0 - p.y, w, h, major }
        break
      }
      if (placed) {
        idx.insert(placed.box)
        count++
      }
      out.set(p.id, placed)
    }
    return { out, idx, count }
  }

  // Names already lettered last layout go first (by priority among themselves), then the ones
  // coming back as space opens: a name reappearing must not push a shown one out of its place.
  // What the traveller is pointing at (selected, hovered, searched for: priority boosted past
  // FOCUS_PRIORITY) always goes first. Holding on like that (and to last layout's slots) can
  // strand a name a fresh layout would fit: zooming out to the whole of Bree from close in kept
  // one fewer. So where it left names out, plain priority order is tried too, from last layout's
  // slots and then afresh, and a layout that letters more wins. While the camera moves it must
  // also move no more than one shown name in ten (more and the map would shuffle its names
  // mid-zoom to gain one); once it rests, more names is enough. On a tie the steadier one wins.
  const byPriority = (a: PlaceLabelInput, b: PlaceLabelInput) => b.priority - a.priority || (a.id < b.id ? -1 : 1)
  const focus = (p: PlaceLabelInput) => (p.priority >= FOCUS_PRIORITY ? 1 : 0)
  const shown = (p: PlaceLabelInput) => (p.priority >= FOCUS_PRIORITY || prev?.places.get(p.id) ? 1 : 0)
  let best = letter([...input.places].sort((a, b) => shown(b) - shown(a) || byPriority(a, b)), prev)
  if (prev && best.count < input.places.length) {
    const plain = [...input.places].sort((a, b) => focus(b) - focus(a) || byPriority(a, b))
    const steady = (out: Map<string, PlacedLabel | null>) => {
      let both = 0
      let moved = 0
      for (const [id, p] of out) {
        const q = prev.places.get(id)
        if (!p || !q) continue
        both++
        if (p.slot !== q.slot || p.slide !== q.slide || p.far !== q.far) moved++
      }
      return input.settled || moved <= both * 0.1
    }
    for (const from of [prev, null]) {
      const alt = letter(plain, from)
      if (alt.count > best.count && steady(alt.out)) best = alt
    }
  }
  const idx = best.idx
  const out: LabelLayout = { places: best.out, regions: new Map() }

  const placeNames = new Set(input.places.map((p) => bare(p.text)))
  const regions = [...input.regions].sort((a, b) => b.priority - a.priority || b.extent - a.extent || (a.id < b.id ? -1 : 1))
  for (const g of regions) {
    // a region the size of a stamp, or one the whole view sits inside, needs no name
    if (g.extent < 90 || g.extent > 1.3 * vw || placeNames.has(bare(g.text))) {
      out.regions.set(g.id, null)
      continue
    }
    const size = Math.max(12, Math.min(19, Math.round(0.05 * g.extent)))
    const track = Math.round(size * 0.22 * 10) / 10
    const text = g.text.toUpperCase()
    const w = Math.ceil(measure(text, fonts.region(size)) + track * text.length) + 2 * HALO
    const h = Math.ceil(size * 1.2)
    const was = prev?.regions.get(g.id)?.candidate
    const order = g.candidates.map((_, i) => i)
    if (was !== undefined && was < order.length) order.unshift(...order.splice(was, 1))
    let placed: PlacedRegion | null = null
    for (const i of order) {
      const c = g.candidates[i]
      const box = { x0: c.x - w / 2, y0: c.y - h / 2, x1: c.x + w / 2, y1: c.y + h / 2 }
      if (!inside(box, inset, inset, vw - inset, vh - inset)) continue
      if (idx.hits(box, 4) || hitsMarker(box, 4, '') || hitsPoly(box, 4)) continue
      placed = { x: c.x, y: c.y, candidate: i, size, track, w, h, box }
      break
    }
    if (placed) idx.insert(placed.box)
    out.regions.set(g.id, placed)
  }
  return out
}

/** A region's name anchors in world metres, best first, and its outline's box. */
export interface RegionAnchors {
  id: string
  points: Pt[]
  box: [number, number, number, number]
}

/**
 * Anchor candidates for every region, once per world: the authored label point when there is
 * one, then interior points of the outline ranked by room. A smaller region lying inside a larger
 * one (Mirkwood in Rhovanion) is cut out of the larger as a hole, so the two names never stack.
 */
export function regionAnchors(regions: { id: string; polygon: [number, number][]; label?: [number, number] }[], bounds: [number, number, number, number]): RegionAnchors[] {
  const boxOf = (poly: [number, number][]): [number, number, number, number] => {
    let x0 = Infinity
    let z0 = Infinity
    let x1 = -Infinity
    let z1 = -Infinity
    for (const [x, z] of poly) {
      x0 = Math.min(x0, x)
      z0 = Math.min(z0, z)
      x1 = Math.max(x1, x)
      z1 = Math.max(z1, z)
    }
    return [Math.max(x0, bounds[0]), Math.max(z0, bounds[1]), Math.min(x1, bounds[2]), Math.min(z1, bounds[3])]
  }
  const area = (b: [number, number, number, number]) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])
  const boxes = regions.map((r) => boxOf(r.polygon))
  return regions.map((r, i) => {
    const holes = regions
      .filter((o, j) => j !== i && o.polygon.length >= 3 && area(boxes[j]) < area(boxes[i]) && overlaps(toAabb(boxes[j]), toAabb(boxes[i])))
      .map((o) => o.polygon)
    const pts: Pt[] = r.label ? [r.label] : []
    for (const c of regionCandidates(r.polygon, holes, bounds, 12)) pts.push([c.x, c.z])
    return { id: r.id, points: pts, box: boxes[i] }
  })
}

const toAabb = (b: [number, number, number, number]): AABB => ({ x0: b[0], y0: b[1], x1: b[2], y1: b[3] })

/** The obstacle id of the player's own marker. */
export const PLAYER_ID = '__you'

/** Markers closer than this fraction of a badge merge into one pin with a '+n' chip. */
export const CLUSTER_GAP = 0.8

export interface MapFrameInput {
  models: MarkerModel[]
  anchors: RegionAnchors[]
  regionNames: ReadonlyMap<string, string>
  /** the camera: world centre, CSS px per metre, viewport size */
  view: { cx: number; cz: number; s: number; vw: number; vh: number }
  touch: boolean
  selectedId?: string | null
  /** the player's world position, kept clear of lettering */
  player?: { x: number; z: number } | null
  reserved: AABB[]
  /**
   * World outlines (x, z pairs, convex) lettering keeps off as well: a place's buildings and
   * smials, so a name never covers the plan. Projected with the camera; those in view are tested.
   */
  obstacles?: readonly ArrayLike<number>[]
  measure: Measure
  prev?: LabelLayout | null
  /** the camera has come to rest (see LabelLayoutInput.settled) */
  settled?: boolean
}

export interface MapFrame {
  clusters: Cluster[]
  layout: LabelLayout
  markerSize: number
  /** the obstacle outlines in view, in CSS px, as the layout saw them */
  polys: ScreenPoly[]
}

/**
 * One layout of the map's DOM layer for a camera: which markers merge, and where every name
 * goes. The dialog runs it when the zoom changes enough to matter and when the camera settles;
 * the node check runs it for every world, viewport and zoom it tests.
 */
export function layoutMapFrame(f: MapFrameInput): MapFrame {
  const { cx, cz, s, vw, vh } = f.view
  const size = f.touch ? MARKER_SIZE_TOUCH : MARKER_SIZE
  const r = size / 2
  const project = (x: number, z: number): [number, number] => [vw / 2 + (x - cx) * s, vh / 2 + (z - cz) * s]
  const state = { selectedId: f.selectedId }
  const clusters = placeChips(clusterMarkers(f.models, project, size * CLUSTER_GAP, { w: vw, h: vh, margin: 0 }, state), r)
  const markers: MarkerDisc[] = clusters.map((c) => ({ id: c.top.id, x: c.px, y: c.py, r: r + 1 }))
  const reserved = [...f.reserved]
  for (const c of clusters) if (c.members.length > 1) reserved.push(countChipBox(c.px, c.py, r, c.chip))
  const polys = f.obstacles ? obstaclesOnScreen(f.obstacles, f.view) : undefined
  if (f.player) {
    // the "you" disc (PlayerMarker: 12 px with a 2 px ring); its heading wedge is translucent and may sit under names
    const [px, py] = project(f.player.x, f.player.z)
    markers.push({ id: PLAYER_ID, x: px, y: py, r: 8 })
  }
  const places: PlaceLabelInput[] = clusters.map((c) => ({ id: c.top.id, text: c.top.name, x: c.px, y: c.py, r, priority: effectivePriority(c.top, state) }))
  const regions: RegionLabelInput[] = []
  for (const a of f.anchors) {
    const text = f.regionNames.get(a.id)
    if (!text || !a.points.length) continue
    regions.push({ id: a.id, text, extent: (a.box[2] - a.box[0]) * s, priority: 0, candidates: a.points.map(([x, z]) => ({ x: vw / 2 + (x - cx) * s, y: vh / 2 + (z - cz) * s })) })
  }
  const layout = layoutLabels({ vw, vh, places, regions, markers, reserved, polys, measure: f.measure, touch: f.touch, prev: f.prev, settled: f.settled })
  return { clusters, layout, markerSize: size, polys: polys ?? [] }
}

/** World outlines projected for a camera, keeping those that reach into the viewport. */
export function obstaclesOnScreen(rings: readonly ArrayLike<number>[], view: { cx: number; cz: number; s: number; vw: number; vh: number }): ScreenPoly[] {
  const { cx, cz, s, vw, vh } = view
  const out: ScreenPoly[] = []
  for (const r of rings) {
    const pts = new Float64Array(r.length)
    const box: AABB = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
    for (let i = 0; i < r.length; i += 2) {
      const x = (pts[i] = vw / 2 + (r[i] - cx) * s)
      const y = (pts[i + 1] = vh / 2 + (r[i + 1] - cz) * s)
      box.x0 = Math.min(box.x0, x)
      box.x1 = Math.max(box.x1, x)
      box.y0 = Math.min(box.y0, y)
      box.y1 = Math.max(box.y1, y)
    }
    if (box.x1 > 0 && box.y1 > 0 && box.x0 < vw && box.y0 < vh) out.push({ pts, box })
  }
  return out
}

/**
 * Where a cluster's '+n' chip sits (map.css .map-marker__count): over the top right corner of the
 * badge, or mirrored to another corner.
 */
export function countChipBox(x: number, y: number, r: number, corner: ChipCorner = 'tr'): AABB {
  const right = corner === 'tr' || corner === 'br'
  const top = corner === 'tr' || corner === 'tl'
  const x0 = right ? x + r - 8 : x - r - 14
  const y0 = top ? y - r - 6 : y + r - 10
  return { x0, y0, x1: x0 + 22, y1: y0 + 16 }
}

const CORNERS: readonly ChipCorner[] = ['tr', 'tl', 'br', 'bl']

/**
 * Keeps every '+n' chip in sight. Clustering only keeps badge centres apart, so a neighbour can
 * sit where the chip goes; drawn later (lower priority, later in the DOM), it would cover the
 * count. The chip moves to another corner of the badge when one is clear. When none is, the
 * cluster is drawn over its neighbours (chipOver) with the chip on a corner no other lifted
 * marker covers: the chip then hides a sliver of a neighbour's badge, which is better than
 * merging the neighbours into the cluster, since they can outrank it (Bree beside Hobbiton on a
 * phone). Only where two lifted clusters would each cover the other's count does the lower
 * ranked one (later in the list) join the other. `r` is the badge radius; the clusters are
 * changed in place and returned.
 */
export function placeChips(clusters: Cluster[], r: number): Cluster[] {
  const covers = (o: Cluster, c: Cluster, corner: ChipCorner) => o !== c && discHitsBox({ x: o.px, y: o.py, r: r + 1 }, countChipBox(c.px, c.py, r, corner))
  for (const c of clusters) {
    c.chip = undefined
    c.chipOver = undefined
  }
  for (let k = 0; k < clusters.length; k++) {
    const c = clusters[k]
    if (c.members.length < 2) continue
    c.chip = CORNERS.find((q) => !clusters.some((o) => covers(o, c, q)))
    if (c.chip) continue
    // lifted, c would cover the chip of any lifted neighbour under its badge
    const blocks = clusters.some((o) => o.chipOver && o.chip && covers(c, o, o.chip))
    const corner = blocks ? undefined : CORNERS.find((q) => !clusters.some((o) => o.chipOver && covers(o, c, q)))
    if (corner) {
      c.chip = corner
      c.chipOver = true
      continue
    }
    // nowhere to show the count: the cluster joins the higher ranked lifted neighbour in its way
    const host = clusters.find((o) => o.chipOver && (covers(o, c, 'tr') || (o.chip && covers(c, o, o.chip))))
    c.chip = 'tr'
    if (!host) continue
    host.members.push(...c.members)
    clusters.splice(k, 1)
    // the host's count changed but not its place; everything after c is looked at again
    k--
  }
  return clusters
}
