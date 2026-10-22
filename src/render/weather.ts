/**
 * Weather: a second clock, running alongside the time of day.
 *
 * One weather is active at a time and the world eases from the old one into the new over a few
 * seconds, so nothing ever snaps. Which weather comes next is rolled from a weighted table that
 * depends on where the traveller is standing — the region, the ground under their feet, and any
 * landmark with weather of its own (the Dead Marshes are always misty) — so the sky belongs to
 * the place. Rain leaves the ground wet for a while after it stops and snow lies until it melts,
 * which is what keeps a change of weather from looking like a switch being flipped.
 */
import * as THREE from 'three'

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'mist' | 'ash'
export type Precip = 'none' | 'rain' | 'snow' | 'ash'

export interface WeatherDef {
  label: string
  icon: string
  /** 0..1 cloud cover: clouds grow, multiply, sink lower and darken */
  cover: number
  /** colour the sky, clouds and light are dragged toward */
  tint: string
  /** how far toward `tint`, 0..1 */
  gloom: number
  /** multiplies the sun/moon intensity */
  light: number
  /** multiplies the hemisphere fill */
  amb: number
  /** multiplies the world's fog distances: smaller means you see less */
  fog: number
  precip: Precip
  /** 0..1 how hard it comes down */
  fall: number
  /** 0..1 ground-hugging mist */
  mist: number
  /** multiplies the wind vector (sway and cloud drift) */
  wind: number
  /** expected lightning strikes per second */
  lightning: number
}

export const WEATHERS: Record<WeatherKind, WeatherDef> = {
  clear:   { label: 'Clear',    icon: '☀', cover: 0.14, tint: '#ffffff', gloom: 0.0,  light: 1.0,  amb: 1.0,  fog: 1.0,  precip: 'none', fall: 0,    mist: 0.0,  wind: 1.0, lightning: 0 },
  cloudy:  { label: 'Cloudy',   icon: '☁', cover: 0.66, tint: '#b6c1cd', gloom: 0.3,  light: 0.7,  amb: 0.98, fog: 0.78, precip: 'none', fall: 0,    mist: 0.06, wind: 1.3, lightning: 0 },
  rain:    { label: 'Rain',     icon: '🌧', cover: 0.92, tint: '#8b97a6', gloom: 0.56, light: 0.4,  amb: 0.88, fog: 0.48, precip: 'rain', fall: 0.72, mist: 0.2,  wind: 1.55, lightning: 0 },
  storm:   { label: 'Storm',    icon: '⛈', cover: 1.0,  tint: '#5c6874', gloom: 0.68, light: 0.3,  amb: 0.8,  fog: 0.4,  precip: 'rain', fall: 1.0,  mist: 0.12, wind: 1.9, lightning: 0.075 },
  snow:    { label: 'Snow',     icon: '❄', cover: 0.86, tint: '#ccd7e6', gloom: 0.44, light: 0.58, amb: 1.06, fog: 0.4,  precip: 'snow', fall: 0.8,  mist: 0.14, wind: 1.15, lightning: 0 },
  mist:    { label: 'Mist',     icon: '🌫', cover: 0.5,  tint: '#d3dae1', gloom: 0.3,  light: 0.6,  amb: 1.02, fog: 0.2,  precip: 'none', fall: 0,    mist: 1.0,  wind: 0.45, lightning: 0 },
  ash:     { label: 'Ashfall',  icon: '🌋', cover: 0.9,  tint: '#6b4437', gloom: 0.72, light: 0.3,  amb: 0.74, fog: 0.42, precip: 'ash',  fall: 0.85, mist: 0.18, wind: 1.7, lightning: 0.012 },
}

export const KINDS = Object.keys(WEATHERS) as WeatherKind[]

type Weights = Partial<Record<WeatherKind, number>>

/** What the sky usually does in a region. Unlisted regions fall back to `DEFAULT`. */
const DEFAULT: Weights = { clear: 5, cloudy: 4, rain: 2, mist: 1 }

const REGION_WEATHER: Record<string, Weights> = {
  // Middle-earth
  shire: { clear: 5, cloudy: 4, rain: 2.5, mist: 1 },
  lindon: { clear: 3, cloudy: 4, rain: 3, mist: 2 }, // the sea coast is never settled for long
  angmar: { cloudy: 3, snow: 4, storm: 2, mist: 2 },
  forodwaith: { snow: 7, cloudy: 2, clear: 1 },
  hollin: { clear: 5, cloudy: 3, rain: 1 },
  dunland: { cloudy: 4, rain: 3, clear: 2, mist: 1 },
  enedwaith: { clear: 3, cloudy: 3, rain: 2, mist: 1 },
  eriador: { clear: 4, cloudy: 4, rain: 2, mist: 1.5 },
  rohan: { clear: 5, cloudy: 3, rain: 1.5, storm: 1 },
  ithilien: { clear: 4, cloudy: 3, rain: 2 },
  gondor: { clear: 5, cloudy: 3, rain: 1.5 },
  mordor: { ash: 7, storm: 2, cloudy: 2 },
  rhovanion: { clear: 3, cloudy: 4, rain: 2, snow: 1 },
  mirkwood: { mist: 4, cloudy: 4, rain: 2 },
  rhun: { clear: 5, cloudy: 2, storm: 1 },
  harad: { clear: 8, cloudy: 1 },
  // Earth
  antarctica: { snow: 7, cloudy: 2, storm: 1 },
  'boreal-north': { snow: 4, cloudy: 3, clear: 2, mist: 1 },
  tropics: { storm: 3, rain: 3, clear: 3, cloudy: 2 },
  europe: { cloudy: 4, clear: 3, rain: 3, mist: 1 },
  'north-america': { clear: 4, cloudy: 3, rain: 2, snow: 1 },
  'south-america': { rain: 3, clear: 3, storm: 2, cloudy: 2 },
  africa: { clear: 7, cloudy: 2, storm: 1 },
  asia: { clear: 4, cloudy: 3, rain: 2, snow: 1 },
  australia: { clear: 7, cloudy: 2, storm: 1 },
}

/** Ground underfoot overrules the region: snowfields snow, the ash plain rains ash, marshes fog up. */
const BIOME_WEATHER: Record<number, Weights> = {
  5: { snow: 14, cloudy: 3, clear: 2, mist: 2 }, // snow
  6: { ash: 14, storm: 2, cloudy: 2 }, // ash
  7: { mist: 12, rain: 3, cloudy: 2 }, // marsh
}

/** Named biases a landmark dressing can ask for, via `dressing.weather`. */
export const LOCAL_WEATHER: Record<string, Weights> = {
  misty: { mist: 12, cloudy: 2, rain: 1 },
  foul: { mist: 8, rain: 3, storm: 2 },
  ashen: { ash: 12, storm: 2 },
  fair: { clear: 8, cloudy: 2 },
  snowy: { snow: 10, cloudy: 2 },
}

/** Live weather. Mutated by the DayNight driver; read by everything else. */
export const weatherState = {
  /** the weather we are coming from */
  kind: 'clear' as WeatherKind,
  /** the weather we are easing into (equal to `kind` once settled) */
  next: 'clear' as WeatherKind,
  /** 0..1 progress from `kind` to `next` */
  t: 1,
  /** seconds left before the next roll */
  hold: 1.2,
  /** the first roll of a world arrives already settled, so you land in its own weather */
  fresh: true,
  /** non-null pins the weather and stops the rolls */
  locked: null as WeatherKind | null,
  /** 0..1 how wet the ground is; lags behind the rain */
  wet: 0,
  /** 0..1 lying snow; lags much further behind */
  snowCover: 0,
  /** 0..1 ash dust on every upward face */
  ashCover: 0,
  /** wind bearing in radians, drifting slowly */
  windAngle: 0.37,
  /** 0..1 lightning, decays within a frame or two of a strike */
  flash: 0,
  /** a second strike queued a moment after the first */
  reflash: 0,
  /** which table the last roll used: region id, 'ground', a landmark key, or 'default' */
  source: '' as string,
}
if (import.meta.env.DEV) (window as unknown as { __weather: unknown }).__weather = weatherState

/** Seconds to ease from one weather into the next. */
const TRANSITION = 16

export interface WeatherLook {
  cover: number
  tint: THREE.Color
  gloom: number
  light: number
  amb: number
  fog: number
  /** the precipitation being drawn, and how much of each so they can cross-fade */
  rain: number
  snow: number
  ash: number
  mist: number
  windX: number
  windZ: number
  flash: number
  wet: number
  snowCover: number
  ashCover: number
}

const look: WeatherLook = {
  cover: 0, tint: new THREE.Color(), gloom: 0, light: 1, amb: 1, fog: 1,
  rain: 0, snow: 0, ash: 0, mist: 0, windX: 0.9, windZ: 0.35, flash: 0,
  wet: 0, snowCover: 0, ashCover: 0,
}
const cA = new THREE.Color()
const cB = new THREE.Color()

/**
 * Weighted pick that never repeats the weather we already have, so a roll always means a visible
 * change. If the table offers nothing else, the weather simply carries on.
 */
function roll(weights: Weights, avoid: WeatherKind): WeatherKind {
  let total = 0
  for (const k of KINDS) if (k !== avoid) total += weights[k] ?? 0
  if (total <= 0) return avoid
  let r = Math.random() * total
  for (const k of KINDS) {
    if (k === avoid) continue
    r -= weights[k] ?? 0
    if (r <= 0) return k
  }
  return avoid
}

/** Where the traveller is, as far as the weather cares. */
export interface WeatherContext {
  regionId: string | null
  biome: number
  /** `weather` key from the dressing of the landmark the traveller is standing in, if any */
  local: string | null
}

function weightsFor(ctx: WeatherContext): { weights: Weights; source: string } {
  if (ctx.local && LOCAL_WEATHER[ctx.local]) return { weights: LOCAL_WEATHER[ctx.local], source: ctx.local }
  const biome = BIOME_WEATHER[ctx.biome]
  if (biome) return { weights: biome, source: 'ground' }
  const region = ctx.regionId ? REGION_WEATHER[ctx.regionId] : undefined
  return { weights: region ?? DEFAULT, source: ctx.regionId ?? 'default' }
}

/** Forces a weather now (null returns to rolling for itself). */
export function setWeather(kind: WeatherKind | null) {
  weatherState.locked = kind
  if (kind && kind !== weatherState.next) {
    weatherState.kind = currentKindForBlend()
    weatherState.next = kind
    weatherState.t = 0
  }
  if (!kind) weatherState.hold = Math.min(weatherState.hold, 8)
}

/** The kind to blend *from* when a change interrupts one already in progress. */
function currentKindForBlend(): WeatherKind {
  return weatherState.t > 0.5 ? weatherState.next : weatherState.kind
}

const ease = (t: number) => t * t * (3 - 2 * t)

/**
 * Advances the weather and returns the blended look. Reuses one object: do not hold on to it.
 */
export function advanceWeather(dt: number, ctx: WeatherContext): WeatherLook {
  const s = weatherState

  // roll for a new weather once the current one has had its time
  if (s.locked) {
    if (s.next !== s.locked) {
      s.kind = currentKindForBlend()
      s.next = s.locked
      s.t = 0
    }
  } else {
    s.hold -= dt
    const { weights, source } = weightsFor(ctx)
    // walking into somewhere with a sky of its own changes the weather then and there, rather
    // than leaving Mordor under a Shire sky for the next few minutes
    const foreign = source !== s.source && (weights[s.next] ?? 0) <= 0
    if ((s.hold <= 0 || foreign) && s.t >= 1) {
      s.source = source
      s.kind = s.next
      s.next = roll(weights, s.kind)
      s.t = s.fresh ? 1 : 0
      if (s.fresh) {
        s.kind = s.next
        s.fresh = false
      }
      s.hold = 70 + Math.random() * 170 // a weather lasts 1 to 4 minutes
    }
  }
  if (s.t < 1) s.t = Math.min(1, s.t + dt / TRANSITION)

  const a = WEATHERS[s.kind]
  const b = WEATHERS[s.next]
  const t = ease(s.t)
  const n = (x: number, y: number) => x + (y - x) * t
  look.cover = n(a.cover, b.cover)
  look.tint.copy(cA.set(a.tint)).lerp(cB.set(b.tint), t)
  look.gloom = n(a.gloom, b.gloom)
  look.light = n(a.light, b.light)
  look.amb = n(a.amb, b.amb)
  look.fog = n(a.fog, b.fog)
  look.mist = n(a.mist, b.mist)

  // precipitation cross-fades: each kind carries its own share so rain can thin out while snow
  // thickens, instead of one stopping dead and the other starting
  const share = (p: Precip) => (a.precip === p ? a.fall * (1 - t) : 0) + (b.precip === p ? b.fall * t : 0)
  look.rain = share('rain')
  look.snow = share('snow')
  look.ash = share('ash')

  // wind: the bearing wanders, the strength comes from the weather
  s.windAngle += dt * 0.035
  const strength = n(a.wind, b.wind)
  look.windX = Math.cos(s.windAngle) * strength
  look.windZ = Math.sin(s.windAngle) * strength

  // lightning: a strike whitens the sky for a frame or two, often twice
  const rate = n(a.lightning, b.lightning)
  if (s.reflash > 0) {
    s.reflash -= dt
    if (s.reflash <= 0) s.flash = 0.75
  } else if (rate > 0 && Math.random() < rate * dt) {
    s.flash = 1
    if (Math.random() < 0.55) s.reflash = 0.12 + Math.random() * 0.14
  }
  s.flash = Math.max(0, s.flash - dt * 6)
  look.flash = s.flash

  // the ground remembers: puddles dry slowly, snow lies and melts slower still
  const towards = (v: number, target: number, up: number, down: number) =>
    v < target ? Math.min(target, v + dt / up) : Math.max(target, v - dt / down)
  s.wet = towards(s.wet, Math.min(1, look.rain * 1.2), 7, 40)
  s.snowCover = towards(s.snowCover, Math.min(1, look.snow * 1.15), 26, 70)
  s.ashCover = towards(s.ashCover, Math.min(1, look.ash * 0.6), 20, 55)
  look.wet = s.wet
  look.snowCover = s.snowCover
  look.ashCover = s.ashCover
  return look
}

/** The look produced by the last `advanceWeather`. DayNight advances at priority -10, so every
 * other component reading this in a later `useFrame` sees the current frame's weather. */
export function weatherLook(): WeatherLook {
  return look
}

/** Label for the HUD: the weather being eased into, once it is more than half arrived. */
export function currentWeather(): WeatherDef {
  return WEATHERS[weatherState.t > 0.5 ? weatherState.next : weatherState.kind]
}
