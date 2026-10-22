import type { LandmarkType } from '@/world/schema'
import { pointInPolygon } from './geom/polylabel'

/**
 * Map markers: what is pinned on the big map, which pictogram each pin shows, how important it is,
 * and how pins that would sit on top of each other merge into one. Pure (no DOM, no React), so the
 * label check in scripts/ can run the same code in node.
 */

/** Marker pictograms, drawn for Storyworld on a 16-unit grid and filled with currentColor. */
export const MARKER_ICONS = {
  city: 'M2 14V8l2-2 2 2V5l2-3 2 3v3l2-2 2 2v6z',
  village: 'M3 8l5-5 5 5v6H3zM7 14v-3h2v3z',
  fortress: 'M4 14V5h1.5v1.5H7V5h2v1.5h1.5V5H12v9z',
  ruin: 'M3 14V7a5 5 0 0 1 8-4l-1.5 1.5A3 3 0 0 0 5 7v7zM11 14V8h2v6z',
  forest: 'M5 2l3.5 6H6.5v3h-3V8H1.5zM11 4l3.5 6h-2v3h-3v-3h-2z',
  tree: 'M8 2a4.5 4.5 0 0 1 1 8.9V14H7v-3.1A4.5 4.5 0 0 1 8 2z',
  mountain: 'M1 14L6 5l2.5 4L11 6l4 8z',
  hill: 'M1 13c2-5 5-7 7-7s5 2 7 7z',
  home: 'M2 13a6 6 0 0 1 12 0zM8 9.2a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z',
  inn: 'M3 4h7v10H3zM10 6h2.5a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-1.5 1.5H10v-1.5h2V7.5h-2z',
  mill: 'M8 1l1.5 5.5L15 8l-5.5 1.5L8 15l-1.5-5.5L1 8l5.5-1.5z',
  water: 'M1 6c2-1.5 3-1.5 5 0s3 1.5 5 0 3-1.5 4 0v2c-1-1.5-2-1.5-4 0s-3 1.5-5 0-3-1.5-5 0zM1 10c2-1.5 3-1.5 5 0s3 1.5 5 0 3-1.5 4 0v2c-1-1.5-2-1.5-4 0s-3 1.5-5 0-3-1.5-5 0z',
  waymark: 'M6 14l.8-10L8 2l1.2 2L10 14z',
  gate: 'M2 14V4h2v10zM12 14V4h2v10zM4 5h8v2H4z',
  door: 'M4 14V3h8v11zM9 8h1.5v1.5H9z',
  other: 'M8 2l6 6-6 6-6-6zM8 5.5L5.5 8 8 10.5 10.5 8z',
} as const

export type MarkerIcon = keyof typeof MARKER_ICONS

/** Pictograms whose shape has a hole in it (drawn with fill-rule evenodd). */
export const EVENODD_ICONS: ReadonlySet<MarkerIcon> = new Set(['village', 'home', 'door', 'other'])

/** Names for the legend and for screen readers. */
export const ICON_NAMES: Record<MarkerIcon, string> = {
  city: 'City',
  village: 'Village',
  fortress: 'Fortress',
  ruin: 'Ruin',
  forest: 'Forest',
  tree: 'Great tree',
  mountain: 'Mountain',
  hill: 'Hill',
  home: 'Home',
  inn: 'Inn',
  mill: 'Mill',
  water: 'Water',
  waymark: 'Waymark',
  gate: 'Gate',
  door: 'Way out',
  other: 'Landmark',
}

/** What each landmark type is called on the place card and in the tooltip. */
export const TYPE_NAMES: Record<LandmarkType | 'exit', string> = {
  city: 'City',
  village: 'Village',
  fortress: 'Fortress',
  ruin: 'Ruin',
  forest: 'Forest',
  tree: 'Great tree',
  mountain: 'Mountain',
  hill: 'Hill',
  home: 'Home',
  inn: 'Inn',
  mill: 'Mill',
  water: 'Water',
  other: 'Landmark',
  exit: 'Way out',
}

/** Marker badge diameter in CSS px (map.css --map-marker / --map-marker-touch). */
export const MARKER_SIZE = 22
export const MARKER_SIZE_TOUCH = 28

/** Base importance per landmark type: cities outrank villages outrank lone stones. */
const TYPE_PRIORITY: Record<LandmarkType, number> = {
  city: 6,
  fortress: 5,
  village: 5,
  inn: 5,
  mountain: 4,
  forest: 4,
  ruin: 3,
  home: 3,
  mill: 3,
  tree: 3,
  water: 3,
  hill: 3,
  other: 2,
}

/** The landmark fields the map reads (a subset of the schema's Landmark, so places and tests can pass plain objects). */
export interface MarkerSource {
  id: string
  displayName: string
  type: LandmarkType
  position: [number, number]
  placeId?: string
  hidden?: boolean
  mapIcon?: string
  dressing?: { props?: { kind: string }[] }
}

export interface MarkerModel {
  id: string
  name: string
  /** 'exit' is the way out of a place, a synthetic marker that is not a landmark */
  kind: 'landmark' | 'exit'
  type: LandmarkType | 'exit'
  icon: MarkerIcon
  x: number
  z: number
  /** base importance (type, +3 when it leads somewhere) */
  priority: number
  /** it opens into a place of its own, or out of this one */
  enterable: boolean
  discovered: boolean
}

const isIcon = (s: string | undefined): s is MarkerIcon => !!s && s in MARKER_ICONS

/**
 * The pictogram for a landmark: its own mapIcon when it names one, else one read from what stands
 * there (a town gate draws as a gate, a signpost or standing stone as a waymark), else the type's.
 * The props check gives Bree's many 'other' spots shapes that say what they are.
 */
export function iconFor(lm: MarkerSource): MarkerIcon {
  if (isIcon(lm.mapIcon)) return lm.mapIcon
  const kinds = new Set((lm.dressing?.props ?? []).map((p) => p.kind))
  if (kinds.has('townGate') || kinds.has('gateArch')) return 'gate'
  if (lm.type === 'other' && (kinds.has('signpost') || kinds.has('standingStone'))) return 'waymark'
  return lm.type
}

export function basePriority(type: LandmarkType | 'exit', leadsSomewhere: boolean): number {
  return (type === 'exit' ? 4 : TYPE_PRIORITY[type] ?? 2) + (leadsSomewhere ? 3 : 0)
}

/** Every marker the map shows for a world: visible landmarks, plus the way out when it is a place. */
export function markerModels(landmarks: MarkerSource[], discovered: ReadonlySet<string>, exit?: { x: number; z: number; label: string }): MarkerModel[] {
  const out: MarkerModel[] = landmarks
    .filter((l) => !l.hidden)
    .map((l) => ({
      id: l.id,
      name: l.displayName,
      kind: 'landmark' as const,
      type: l.type,
      icon: iconFor(l),
      x: l.position[0],
      z: l.position[1],
      priority: basePriority(l.type, !!l.placeId),
      enterable: !!l.placeId,
      discovered: discovered.has(l.id),
    }))
  if (exit) out.push({ id: EXIT_ID, name: exit.label, kind: 'exit', type: 'exit', icon: 'door', x: exit.x, z: exit.z, priority: basePriority('exit', true), enterable: true, discovered: true })
  return out
}

/** Marker id of a place's way out. */
export const EXIT_ID = '__exit'

/** A pin on screen: one marker, or several that sit too close to tell apart (shown as the top one plus '+n'). */
export interface Cluster {
  /** the marker drawn, and the id the cluster goes by */
  top: MarkerModel
  members: MarkerModel[]
  /** screen position in CSS px */
  px: number
  py: number
  /** which corner of the badge its '+n' chip sits on (labels.placeChips decides; top right by default) */
  chip?: ChipCorner
  /** every corner is under a neighbour's badge: the marker is drawn over its neighbours so the count shows */
  chipOver?: boolean
}

/** A corner of a badge: top right, top left, bottom right, bottom left. */
export type ChipCorner = 'tr' | 'tl' | 'br' | 'bl'

/** Importance with the moment's state on top: what the traveller is looking at wins its slot. */
export function effectivePriority(m: MarkerModel, state: { selectedId?: string | null; hoveredId?: string | null; searchIds?: ReadonlySet<string> }): number {
  let p = m.priority
  if (m.id === state.selectedId) p += 100
  if (m.id === state.hoveredId) p += 50
  if (state.searchIds?.has(m.id)) p += 40
  if (m.discovered) p += 0.5
  return p
}

/**
 * Greedy screen-space clustering: markers in priority order; one whose centre lands within
 * `minGap` px of an already placed pin joins that pin instead of drawing on top of it. The
 * selected marker never joins another (it is always drawn), so it is placed first.
 * `project` maps world (x, z) to CSS px. Markers well outside the viewport are left out.
 */
export function clusterMarkers(
  models: MarkerModel[],
  project: (x: number, z: number) => [number, number],
  minGap: number,
  viewport: { w: number; h: number; margin: number },
  state: { selectedId?: string | null; hoveredId?: string | null; searchIds?: ReadonlySet<string> } = {},
): Cluster[] {
  const order = models
    .map((m) => ({ m, p: effectivePriority(m, state) }))
    // ties broken by id so the same view always clusters the same way
    .sort((a, b) => b.p - a.p || (a.m.id < b.m.id ? -1 : 1))
  const clusters: Cluster[] = []
  const g2 = minGap * minGap
  const { w, h, margin } = viewport
  for (const { m } of order) {
    const [px, py] = project(m.x, m.z)
    if (px < -margin || py < -margin || px > w + margin || py > h + margin) continue
    let host: Cluster | null = null
    if (m.id !== state.selectedId) {
      for (const c of clusters) {
        const dx = c.px - px
        const dy = c.py - py
        if (dx * dx + dy * dy < g2) {
          host = c
          break
        }
      }
    }
    if (host) host.members.push(m)
    else clusters.push({ top: m, members: [m], px, py })
  }
  return clusters
}

/** The parts of a region the map needs to name the region a place lies in. */
export interface RegionSource {
  id: string
  displayName: string
  polygon: [number, number][]
}

/**
 * The region a place belongs to: the one its lore names, else the smallest region whose outline
 * contains it (the same rule the HUD uses for where the traveller stands), else none. Smallest,
 * because regions nest: Mirkwood lies inside Rhovanion and is the better answer.
 */
export function regionFor(regions: RegionSource[], x: number, z: number, loreRegionId?: string): RegionSource | null {
  if (loreRegionId) {
    const r = regions.find((r) => r.id === loreRegionId)
    if (r) return r
  }
  let best: RegionSource | null = null
  let bestArea = Infinity
  for (const r of regions) {
    if (r.polygon.length < 3 || !pointInPolygon(x, z, r.polygon)) continue
    const a = polygonArea(r.polygon)
    if (a < bestArea) {
      bestArea = a
      best = r
    }
  }
  return best
}

export function polygonArea(poly: readonly [number, number][]): number {
  let a = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1])
  return Math.abs(a / 2)
}

const KM_PER_DEG = 111.19
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

/**
 * How far a place is from the traveller and which way: "96 m NE · ≈ 16 s on foot". On a globe the
 * map is in degrees, so distances come out in km along the surface (near enough at these scales).
 */
export function distanceTo(from: { x: number; z: number }, to: { x: number; z: number }, globe: boolean, walkSpeed = 6) {
  let dx = to.x - from.x
  let dz = to.z - from.z
  if (globe) {
    if (dx > 180) dx -= 360
    if (dx < -180) dx += 360
    const lat = ((90 - (from.z + to.z) / 2) * Math.PI) / 180
    dx *= KM_PER_DEG * 1000 * Math.cos(lat)
    dz *= KM_PER_DEG * 1000
  }
  const metres = Math.hypot(dx, dz)
  // north is -z on the map
  const bearing = (Math.atan2(dx, -dz) + Math.PI * 2) % (Math.PI * 2)
  const dir = POINTS[Math.round(bearing / (Math.PI / 4)) % 8]
  const short = metres >= 1000 ? `${+(metres / 1000).toFixed(metres >= 10000 ? 0 : 1)} km` : `${Math.round(metres)} m`
  const secs = metres / walkSpeed
  const time = globe ? '' : secs < 90 ? ` · ≈ ${Math.max(1, Math.round(secs))} s on foot` : ` · ≈ ${Math.round(secs / 60)} min on foot`
  return { metres, short, long: metres < 3 ? 'You are here' : `${short} ${dir}${time}` }
}
