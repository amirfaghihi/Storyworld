import { z } from 'zod'

export const LandmarkTypeSchema = z.enum(['city', 'village', 'fortress', 'ruin', 'forest', 'mountain', 'other', 'home', 'inn', 'mill', 'tree', 'water', 'hill'])
export type LandmarkType = z.infer<typeof LandmarkTypeSchema>

export const PropSchema = z.object({
  kind: z.string(),
  offset: z.tuple([z.number(), z.number()]).default([0, 0]),
  rotation: z.number().default(0),
  scale: z.number().default(1),
  color: z.string().optional(),
  params: z.record(z.string(), z.unknown()).default({}),
})
export type Prop = z.infer<typeof PropSchema>

export const DressingSchema = z.object({
  radius: z.number(),
  setting: z.string(),
  ground: z.object({ kind: z.string(), blend: z.number().default(1), inner: z.number().default(0.4) }).optional(),
  vegetation: z.object({ density: z.number().default(1), palette: z.string().default('default'), flowers: z.string().optional() }).optional(),
  /** weather bias near this landmark (see LOCAL_WEATHER in src/render/weather.ts) */
  weather: z.string().optional(),
  /** the air of this place: light, haze, motes (see AURAS in src/render/auras.ts) */
  aura: z.string().optional(),
  /** where the overworld Enter arch stands, from the landmark; default [6, 8] (see Portals.tsx) */
  portal: z.tuple([z.number(), z.number()]).optional(),
  props: z.array(PropSchema).default([]),
})
export type Dressing = z.infer<typeof DressingSchema>

export const LandmarkSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  type: LandmarkTypeSchema,
  position: z.tuple([z.number(), z.number()]), // world metres [x, z]
  discoverRadius: z.number().default(28),
  placeId: z.string().optional(),
  dressing: DressingSchema.optional(),
  /** carries scenery only: no marker, no map pin, no codex entry */
  hidden: z.boolean().optional(),
  /** map marker pictogram; the map picks one from `type` when absent */
  mapIcon: z.string().optional(),
})
export type Landmark = z.infer<typeof LandmarkSchema>

export const RegionSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  polygon: z.array(z.tuple([z.number(), z.number()])),
  biome: z.string().optional(),
  /** forest mood for trees and forest floor (see src/vegetation/mood.ts) */
  mood: z.string().optional(),
  /** where the map writes the region's name [x, z], and at what angle (radians); placed automatically when absent */
  label: z.tuple([z.number(), z.number()]).optional(),
  labelAngle: z.number().optional(),
})
export type Region = z.infer<typeof RegionSchema>

/** Present on enterable places (Hobbiton...). The place is a small world generated at runtime. */
export const PlaceInfoSchema = z.object({
  parentWorldId: z.string(),
  /** where the traveller steps back out to the parent world */
  exit: z.object({ x: z.number(), z: z.number(), radius: z.number().default(6), label: z.string() }),
  /** parent-world position to return to */
  returnTo: z.tuple([z.number(), z.number()]),
})
export type PlaceInfo = z.infer<typeof PlaceInfoSchema>

export const WorldSchema = z.object({
  id: z.string(),
  name: z.string(),
  seed: z.number(),
  attribution: z.string().optional(),
  size: z.tuple([z.number(), z.number()]),
  cell: z.number(),
  seaLevel: z.number(),
  /** encoded heightmap file; absent for runtime-generated places */
  terrain: z.object({ file: z.string(), heightOffset: z.number(), heightScale: z.number() }).optional(),
  palette: z.record(z.string(), z.string()),
  spawn: z.tuple([z.number(), z.number()]),
  landmarks: z.array(LandmarkSchema),
  regions: z.array(RegionSchema),
  /** 'flat' (default) or 'globe': a sphere whose height grid is latitude/longitude */
  kind: z.enum(['flat', 'globe']).optional(),
  /** globe sea-level radius in metres */
  radius: z.number().optional(),
  /** metres between terrain mesh vertices (default 4) */
  terrainSpacing: z.number().optional(),
  /** fog start/end distances in metres */
  fog: z.tuple([z.number(), z.number()]).optional(),
  /** default follow-camera distance */
  cameraDistance: z.number().optional(),
  /** multiplies walk/run speed (a 1:1 place feels right a little slower than the miniature) */
  speedScale: z.number().optional(),
  /** initial camera yaw when spawning at the spawn point */
  spawnYaw: z.number().optional(),
  spawnPitch: z.number().optional(),
  /** the follow camera cranes up (raises its pitch) before it pulls in against steep ground */
  cameraCrane: z.boolean().optional(),
  /** the part of the map worth showing [x0, z0, x1, z1]; places leave out their wooded rim */
  mapBounds: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  place: PlaceInfoSchema.optional(),
})
export type World = z.infer<typeof WorldSchema>

export const StoryEventSchema = z.object({ book: z.string(), chapter: z.string().optional(), text: z.string() })
export const LoreEntrySchema = z.object({
  summary: z.string(),
  region: z.string().optional(),
  storyEvents: z.array(StoryEventSchema).default([]),
  characters: z.array(z.string()).default([]),
  sourceUrl: z.string().optional(),
})
export type LoreEntry = z.infer<typeof LoreEntrySchema>
export const LoreSchema = z.object({
  landmarks: z.record(z.string(), LoreEntrySchema),
  regions: z.record(z.string(), LoreEntrySchema),
})
export type Lore = z.infer<typeof LoreSchema>
