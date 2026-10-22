import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import * as THREE from 'three'

/** Ground probe ring: GROUND_RING_N support samples on a circle of GROUND_RING_R metres round the player. */
export const GROUND_RING_N = 12
export const GROUND_RING_R = 0.7

/**
 * The ground under the player, published by the controller every frame after it has moved. The
 * avatar reads it to plant feet, staff, cloak and contact shadow, so it never samples the terrain
 * itself and always agrees with what the player is standing on (terrain or a bridge deck).
 */
export interface GroundProbe {
  /** false on the globe, before spawn and while afloat: nothing should conform to it */
  valid: boolean
  /** support height under the player (equals position.y while grounded) */
  y: number
  /** standing on a walkable deck rather than the terrain */
  onDeck: boolean
  /** least-squares plane through the ring, world axes: y = c + gx * (X - p.x) + gz * (Z - p.z) */
  plane: { gx: number; gz: number; c: number }
  /** normalize(-gx, 1, -gz) */
  normal: THREE.Vector3
  /** support y at p + R * (cos a_i, sin a_i), a_i = i * 2π / N, angle measured as atan2(dz, dx) */
  ring: Float32Array
  /** rise / run along the direction of travel, positive uphill */
  gradeFwd: number
  /** the controller's own support function (terrain, or a deck within step-up of the feet) */
  sample: (x: number, z: number) => number
}

const ground: GroundProbe = {
  valid: false,
  y: 0,
  onDeck: false,
  plane: { gx: 0, gz: 0, c: 0 },
  normal: new THREE.Vector3(0, 1, 0),
  ring: new Float32Array(GROUND_RING_N),
  gradeFwd: 0,
  sample: () => 0,
}

/** Per-frame mutable player state. Not React state: read/written inside useFrame. */
export const playerState = {
  position: new THREE.Vector3(0, 0, 0),
  velocity: new THREE.Vector3(),
  /** local up (radial on a globe, +Y on flat worlds) and the rotation taking +Y to it */
  up: new THREE.Vector3(0, 1, 0),
  frame: new THREE.Quaternion(),
  /** position in map coordinates: metres (x, z) on flat worlds, degrees (lon+180, 90-lat) on globes */
  map: { x: 0, z: 0 },
  yaw: 0, // facing direction (radians, around local up)
  /** on a globe: riding the boat over deep water */
  afloat: false,
  speed: 0,
  running: false,
  grounded: true,
  /** vertical speed in m/s, non-zero only while falling off a ledge */
  vy: 0,
  /**
   * bumped whenever the body is put down somewhere rather than walked there (spawn, fast travel),
   * so followers can jump with it instead of easing across the gap; a long fall is not a teleport
   */
  teleports: 0,
  ground,
  ready: false,
}

/** Camera orbit state shared between input, camera and controller. */
export const cameraState = {
  yaw: Math.PI, // camera starts north of the player, looking south (+Z)
  pitch: 0.38,
  distance: 13,
}
if (import.meta.env.DEV) (window as unknown as { __cam: unknown }).__cam = cameraState

export interface PersistedPlayer {
  /** last position per world/place id */
  positions: Record<string, [number, number]>
  discovered: string[]
  setPosition: (id: string, x: number, z: number) => void
  discover: (id: string) => void
  reset: () => void
}

export const usePlayerStore = create<PersistedPlayer>()(
  persist(
    (set) => ({
      positions: {},
      discovered: [],
      setPosition: (id, x, z) => set((s) => ({ positions: { ...s.positions, [id]: [x, z] } })),
      discover: (id) => set((s) => (s.discovered.includes(id) ? s : { discovered: [...s.discovered, id] })),
      reset: () => set({ positions: {}, discovered: [] }),
    }),
    {
      name: 'storyworld.player',
      version: 2,
      migrate: (state: unknown) => {
        const s = (state ?? {}) as { worldId?: string | null; x?: number; z?: number; discovered?: string[]; positions?: Record<string, [number, number]> }
        const positions = s.positions ?? {}
        if (s.worldId && typeof s.x === 'number' && typeof s.z === 'number') positions[s.worldId] = [s.x, s.z]
        return { positions, discovered: s.discovered ?? [] }
      },
    },
  ),
)

export type Quality = 'low' | 'medium' | 'high' | 'ultra'

/**
 * The tiers in order, cheapest first. Everything that varies by tier must compare *rank*
 * (`atLeast`) or look the value up in a table (`byQuality`) — never `quality === 'high'`.
 * A bare equality check reads as "the most of this", but the moment a tier exists above
 * `high` the check turns false for it and the ternary's final branch (the *low* setting)
 * wins, silently making the better tier worse.
 */
export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'] as const

/** Rank of a tier, falling back to `high` for an unknown string out of persisted storage. */
export function qualityRank(q: Quality): number {
  const i = QUALITY_ORDER.indexOf(q as (typeof QUALITY_ORDER)[number])
  return i < 0 ? QUALITY_ORDER.indexOf('high') : i
}

/** True when `q` is `tier` or better. */
export function atLeast(q: Quality, tier: Quality): boolean {
  return qualityRank(q) >= qualityRank(tier)
}

/** Value for the current tier from a complete low→ultra table. */
export function byQuality<T>(q: Quality, table: Record<Quality, T>): T {
  return table[q] ?? table.high
}

/** Render-scale floor per tier: the index into SCALE_STEPS that AdaptiveQuality may not beat. */
const BASE_STEP: Record<Quality, number> = { low: 2, medium: 1, high: 0, ultra: 0 }
export function baseStepFor(q: Quality): number {
  return BASE_STEP[q] ?? BASE_STEP.high
}

export interface Settings {
  quality: Quality
  setQuality: (q: Quality) => void
  /** index into SCALE_STEPS (render resolution); chosen at runtime by AdaptiveQuality */
  scaleStep: number
  setScaleStep: (i: number) => void
  /** ambient sound off */
  muted: boolean
  setMuted: (v: boolean) => void
  /** 0..1 ambient volume */
  volume: number
  setVolume: (v: number) => void
  /** minimap turns with the traveller instead of keeping north up */
  minimapHeadingUp: boolean
  setMinimapHeadingUp: (v: boolean) => void
  /** minimap zoom factor, MINIMAP_ZOOM_MIN..MINIMAP_ZOOM_MAX (1 = the world's default radius) */
  minimapZoom: number
  setMinimapZoom: (v: number) => void
}

export const MINIMAP_ZOOM_MIN = 0.5
export const MINIMAP_ZOOM_MAX = 2
const clampMinimapZoom = (v: number) => (Number.isFinite(v) ? Math.min(MINIMAP_ZOOM_MAX, Math.max(MINIMAP_ZOOM_MIN, v)) : 1)

/**
 * First-run tier: phones and low-core machines start lower; the user can always change it.
 * Never picks `ultra` — that tier costs too much to hand to someone who did not ask for it.
 */
function defaultQuality(): Quality {
  if (typeof navigator === 'undefined') return 'high'
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
  const cores = navigator.hardwareConcurrency ?? 8
  if (coarse) return 'low'
  if (cores <= 4) return 'medium'
  return 'high'
}

export const useSettingsStore = create<Settings>()(
  persist(
    (set) => ({
      quality: defaultQuality(),
      setQuality: (quality) => set({ quality, scaleStep: baseStepFor(quality) }),
      scaleStep: baseStepFor(defaultQuality()),
      setScaleStep: (scaleStep) => set({ scaleStep }),
      muted: false,
      setMuted: (muted) => set({ muted }),
      volume: 0.55,
      setVolume: (volume) => set({ volume }),
      minimapHeadingUp: false,
      setMinimapHeadingUp: (minimapHeadingUp) => set({ minimapHeadingUp }),
      minimapZoom: 1,
      setMinimapZoom: (v) => set({ minimapZoom: clampMinimapZoom(v) }),
    }),
    {
      name: 'storyworld.settings',
      partialize: (s) => ({ quality: s.quality, muted: s.muted, volume: s.volume, minimapHeadingUp: s.minimapHeadingUp, minimapZoom: s.minimapZoom }) as Settings,
      // a persisted tier must also seed the render-scale floor
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Settings>
        // an unknown tier can come back from storage (an older or newer build); fall back rather than trust it
        const raw = (p.quality ?? current.quality) as Quality
        const q = QUALITY_ORDER.includes(raw as (typeof QUALITY_ORDER)[number]) ? raw : current.quality
        return {
          ...current,
          quality: q,
          scaleStep: baseStepFor(q),
          muted: p.muted ?? current.muted,
          volume: typeof p.volume === 'number' ? p.volume : current.volume,
          minimapHeadingUp: typeof p.minimapHeadingUp === 'boolean' ? p.minimapHeadingUp : current.minimapHeadingUp,
          minimapZoom: typeof p.minimapZoom === 'number' ? clampMinimapZoom(p.minimapZoom) : current.minimapZoom,
        }
      },
    },
  ),
)

/** A doorway between the overworld and a place, shown as a prompt when the player stands near it. */
export interface Portal {
  label: string
  targetId: string
  x?: number
  z?: number
}

if (import.meta.env.DEV) (window as unknown as { __settings: unknown }).__settings = useSettingsStore

/** What the map should centre on when it opens: a landmark, or a point and zoom. */
export interface MapFocus {
  id?: string
  x?: number
  z?: number
  scale?: number
}

export interface UiState {
  portal: Portal | null
  setPortal: (p: Portal | null) => void
  worldsOpen: boolean
  setWorldsOpen: (v: boolean) => void
  mapOpen: boolean
  /** set by openMap; cleared when the map closes */
  mapFocus: MapFocus | null
  /** open the map, optionally centred on a landmark ("Show on map") or a point (the minimap) */
  openMap: (focus?: MapFocus) => void
  codexOpen: boolean
  nearLandmark: string | null // landmark id the player is standing near
  selectedLandmark: string | null // opened from map/codex
  regionId: string | null
  toast: string | null
  pointerLocked: boolean
  setPointerLocked: (v: boolean) => void
  setMapOpen: (v: boolean) => void
  setCodexOpen: (v: boolean) => void
  setNearLandmark: (id: string | null) => void
  setSelectedLandmark: (id: string | null) => void
  setRegion: (id: string | null) => void
  setToast: (t: string | null) => void
}
export const useUiStore = create<UiState>()((set) => ({
  portal: null,
  setPortal: (portal) => set({ portal }),
  worldsOpen: false,
  setWorldsOpen: (worldsOpen) => set({ worldsOpen }),
  mapOpen: false,
  mapFocus: null,
  openMap: (focus) => set({ mapOpen: true, mapFocus: focus ?? null }),
  codexOpen: false,
  nearLandmark: null,
  selectedLandmark: null,
  regionId: null,
  toast: null,
  pointerLocked: false,
  setPointerLocked: (pointerLocked) => set({ pointerLocked }),
  setMapOpen: (mapOpen) => set(mapOpen ? { mapOpen } : { mapOpen, mapFocus: null }),
  setCodexOpen: (codexOpen) => set({ codexOpen }),
  setNearLandmark: (nearLandmark) => set({ nearLandmark }),
  setSelectedLandmark: (selectedLandmark) => set({ selectedLandmark }),
  setRegion: (regionId) => set({ regionId }),
  setToast: (toast) => set({ toast }),
}))
