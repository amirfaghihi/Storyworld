import type { Landmark, LandmarkType, LoreEntry, Prop, Region } from '@/world/schema'

/** A hill/knoll: rounded bump of height `h` fading out at radius `r` (optionally elliptical). */
export interface Hill {
  x: number
  z: number
  r: number
  h: number
  /** stretch along local x (default 1) and rotation of that axis */
  rx?: number
  rot?: number
}
/**
 * A cut platform: level at `h` out to 0.55 r, blending back into the land by r (both a cell
 * further out in practice, so the drawn core is level too). Later flats in the list win where
 * they overlap earlier ones, so a flat's rim must not reach another flat's core.
 */
export interface Flat {
  x: number
  z: number
  r: number
  /** target height; defaults to the base height */
  h?: number
  /** how much of the land's own roll the rim (0.55 r to r) gives up, 0..1 (default 1); the core is always level */
  strength?: number
}
export interface River {
  points: [number, number][]
  width: number
  /** metres below sea level at the centre */
  depth: number
  /** width of the sloping bank beyond the water's edge */
  bank?: number
  /** broad shallow valley the river runs in: lowers the land within `width` by up to `depth` */
  valley?: { width: number; depth: number }
}
export interface Pond {
  x: number
  z: number
  r: number
  depth: number
}
export interface Lane {
  points: [number, number][]
  width: number
}
export interface Wood {
  x: number
  z: number
  r: number
}

export interface Spot {
  id: string
  displayName: string
  type: LandmarkType
  position: [number, number]
  discoverRadius?: number
  /** how the land looks here (shown in the lore card) */
  setting: string
  radius?: number
  ground?: { kind: string; blend?: number; inner?: number }
  vegetation?: { density?: number; palette?: string; flowers?: string }
  props?: Partial<Prop>[]
  lore: LoreEntry
  /** map marker pictogram (passed through to the landmark) */
  mapIcon?: string
}

/**
 * Recipe for an enterable place. Terrain is synthesised at runtime from these shapes, so a
 * place is a few hundred lines of data rather than a heightmap file.
 */
export interface PlaceDef {
  id: string
  name: string
  parentWorldId: string
  size: [number, number]
  cell: number
  seed: number
  seaLevel: number
  palette: Record<string, string>
  base: { height: number; roll: number; wavelength: number }
  /** height above which the land lies under snow (bare rock where it is too steep to hold it) */
  snowline?: number
  /** wooded hills around the edge so the horizon is closed */
  rim?: { width: number; height: number }
  hills: Hill[]
  flats: Flat[]
  rivers: River[]
  ponds: Pond[]
  lanes: Lane[]
  woods: Wood[]
  spawn: [number, number]
  spawnYaw?: number
  /** camera pitch (radians, looking down) on a fresh arrival at the spawn; default DEFAULT_PITCH */
  spawnPitch?: number
  cameraDistance?: number
  speedScale?: number
  fog?: [number, number]
  exit: { x: number; z: number; radius?: number; label: string }
  /** offset from the parent landmark where the traveller reappears */
  returnOffset: [number, number]
  spots: Spot[]
  regions: Region[]
  /** free-standing props not tied to a spot (fences, carts, trees...) */
  props?: (Partial<Prop> & { at: [number, number] })[]
}

export type { Landmark }
