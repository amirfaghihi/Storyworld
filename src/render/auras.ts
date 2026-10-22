/**
 * Auras: the air of a particular place.
 *
 * Some places in a story are not just differently shaped, they are differently lit — Lórien is
 * gold under the mallorns, the Morgul valley gives off a corpse-light, the Dead Marshes glimmer.
 * An aura is a named recipe for that: a colour the air takes, a fill light, what the sun is
 * allowed to do inside it, a luminous haze on the ground, motes drifting in it, and how strongly
 * anything glowing burns. A landmark asks for one with `dressing.aura`.
 *
 * The strength is 1 well inside the landmark and eases to 0 at the edge, so walking into Lórien
 * is a gradual change rather than a line on the ground. Only the strongest aura at a point
 * applies; they do not stack.
 */
import * as THREE from 'three'
import type { World } from '@/world/schema'

export interface MoteDef {
  kind: 'dust' | 'wisp' | 'spore' | 'embers'
  color: string
  color2?: string
  /** particles at full density */
  count: number
  /** how far above the ground they live */
  height: number
}

export interface AuraDef {
  label: string
  /** the colour the air itself takes */
  air: string
  /** 0..1 how far the fog and horizon are pulled toward `air` */
  haze: number
  /** a local fill light, as if the place were lit by something of its own */
  fill: string
  fillI: number
  /** multiplies the sun inside: a sorcerous gloom swallows daylight */
  sun: number
  /** 0..1 luminous haze lying on the ground */
  ground: number
  /** multiplies the emissive strength of lamps, windows, crystals and glowing props */
  glow: number
  /** 0..1 shafts of light falling through the canopy */
  shafts: number
  motes?: MoteDef
}

export const AURAS: Record<string, AuraDef> = {
  /** Lórien: gold light under the mallorns, motes of it hanging in the air. */
  golden: {
    label: 'the Golden Wood',
    air: '#f2d489', haze: 0.5, fill: '#ffe6a0', fillI: 0.85, sun: 1.12, ground: 0.12, glow: 1.4, shafts: 1.5,
    motes: { kind: 'dust', color: '#ffe8a0', color2: '#fff6d0', count: 220, height: 7 },
  },
  /** Rivendell: a cool silver valley full of falling water. */
  silver: {
    label: 'the hidden valley',
    air: '#cfe2f4', haze: 0.34, fill: '#d8e8ff', fillI: 0.6, sun: 1.0, ground: 0.2, glow: 1.3, shafts: 0.8,
    motes: { kind: 'dust', color: '#e8f4ff', color2: '#ffffff', count: 180, height: 6 },
  },
  /** Minas Morgul: a corpse-light that eats the daylight. */
  morgul: {
    label: 'the corpse-light',
    air: '#a2eeb4', haze: 0.42, fill: '#8cf0a6', fillI: 0.6, sun: 0.5, ground: 0.28, glow: 1.8, shafts: 0,
    motes: { kind: 'wisp', color: '#a8ffb8', color2: '#d8ffe0', count: 90, height: 5 },
  },
  /** Dol Guldur: a sorcerous grey sickness; nothing sings. */
  sorcery: {
    label: 'the Hill of Sorcery',
    air: '#6d7a6a', haze: 0.58, fill: '#7d8f7a', fillI: 0.35, sun: 0.44, ground: 0.22, glow: 1.2, shafts: 0,
    motes: { kind: 'spore', color: '#7a8a72', color2: '#98a48c', count: 130, height: 8 },
  },
  /** Orodruin and the Dark Tower: firelight from below. */
  ember: {
    label: 'the fire below',
    air: '#ff6a2e', haze: 0.42, fill: '#ff7a3c', fillI: 0.85, sun: 0.62, ground: 0.12, glow: 1.5, shafts: 0,
    motes: { kind: 'embers', color: '#ff8a2a', color2: '#ffd070', count: 160, height: 6 },
  },
  /** Fangorn and the Old Forest: a dim green light and a stuffy stillness. */
  deepwood: {
    label: 'the old wood',
    air: '#48703f', haze: 0.46, fill: '#78a06a', fillI: 0.45, sun: 0.6, ground: 0.1, glow: 1.1, shafts: 1.7,
    motes: { kind: 'spore', color: '#9fc27a', color2: '#d0e0a0', count: 150, height: 9 },
  },
  /** The Dead Marshes: candles in the water that are not candles. */
  marshlight: {
    label: 'the marsh-lights',
    air: '#8fb6b0', haze: 0.44, fill: '#a0d8ff', fillI: 0.5, sun: 0.8, ground: 0.55, glow: 1.6, shafts: 0,
    motes: { kind: 'wisp', color: '#a8e0ff', color2: '#e0f4ff', count: 110, height: 3 },
  },
  /** The Barrow-downs: a fog that comes up out of nowhere. */
  barrow: {
    label: 'the barrow-fog',
    air: '#c6d0d8', haze: 0.4, fill: '#b8c8dc', fillI: 0.45, sun: 0.82, ground: 0.5, glow: 1.2, shafts: 0,
    motes: { kind: 'dust', color: '#dbe6f0', count: 90, height: 4 },
  },
  /** Mithlond: sea-light off the water, and the road into the West. */
  seasilver: {
    label: 'the sea-light',
    air: '#d6e6f0', haze: 0.28, fill: '#e4f2ff', fillI: 0.55, sun: 1.05, ground: 0.14, glow: 1.3, shafts: 0.5,
    motes: { kind: 'dust', color: '#eef6ff', count: 110, height: 8 },
  },
  /** The West-gate of Moria: the shadow under the mountain. */
  deep: {
    label: 'the shadow of the mountain',
    air: '#414150', haze: 0.5, fill: '#6e6e88', fillI: 0.3, sun: 0.5, ground: 0.16, glow: 1.4, shafts: 0,
    motes: { kind: 'spore', color: '#6a6a80', count: 80, height: 6 },
  },
}

export const AURA_IDS = Object.keys(AURAS)

/** A landmark's aura and the circle it fills. */
export interface AuraSpot {
  x: number
  z: number
  /** full strength within `inner`, gone by `r` */
  r: number
  inner: number
  def: AuraDef
  id: string
}

/**
 * How much further than the dressing radius the air of a place carries. The miniature world puts
 * places close together — the Old Forest is 55 m from Hobbiton — so this stays tight, or a
 * neighbour's weather-light bleeds over the gate.
 */
const REACH = 1.25

export function collectAuras(meta: World): AuraSpot[] {
  const out: AuraSpot[] = []
  for (const lm of meta.landmarks) {
    const key = lm.dressing?.aura
    const def = key ? AURAS[key] : undefined
    if (!def) continue
    const r = (lm.dressing!.radius ?? 40) * REACH
    out.push({ x: lm.position[0], z: lm.position[1], r, inner: r * 0.35, def, id: lm.id })
  }
  return out
}

/** The aura in force where the traveller is standing. Written once per frame by DayNight. */
export const auraState = {
  /** 0..1 */
  strength: 0,
  air: new THREE.Color('#ffffff'),
  haze: 0,
  fill: new THREE.Color('#ffffff'),
  fillI: 0,
  sun: 1,
  ground: 0,
  glow: 1,
  shafts: 0,
  /** which aura, for the HUD and for the mote emitters */
  id: null as string | null,
}
if (import.meta.env.DEV) (window as unknown as { __aura: unknown }).__aura = auraState

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

const targetAir = new THREE.Color()
const targetFill = new THREE.Color()

/**
 * Finds the strongest aura at (x, z) and eases the live state toward it, so crossing from one
 * place to another is a fade rather than a cut.
 */
export function updateAura(spots: AuraSpot[], x: number, z: number, dt: number) {
  let best: AuraSpot | null = null
  let bestW = 0
  for (const s of spots) {
    const d = Math.hypot(x - s.x, z - s.z)
    if (d >= s.r) continue
    const w = 1 - smooth(s.inner, s.r, d)
    if (w > bestW) {
      bestW = w
      best = s
    }
  }
  const a = auraState
  const k = Math.min(1, dt * 3) // a short lag so a step across the boundary does not snap
  if (best) {
    a.id = best.id
    targetAir.set(best.def.air)
    targetFill.set(best.def.fill)
    a.strength += (bestW - a.strength) * k
    a.air.lerp(targetAir, k)
    a.fill.lerp(targetFill, k)
    a.haze += (best.def.haze - a.haze) * k
    a.fillI += (best.def.fillI - a.fillI) * k
    a.sun += (best.def.sun - a.sun) * k
    a.ground += (best.def.ground - a.ground) * k
    a.glow += (best.def.glow - a.glow) * k
    a.shafts += (best.def.shafts - a.shafts) * k
  } else {
    a.strength += (0 - a.strength) * k
    a.sun += (1 - a.sun) * k
    a.glow += (1 - a.glow) * k
    a.shafts += (0 - a.shafts) * k
    if (a.strength < 0.002) a.id = null
  }
  return a
}

const filter = new THREE.Color()

/**
 * The air colour as a *filter* rather than a paint: the hue at full brightness, so multiplying a
 * pale sky by it forces the colour without washing everything toward grey. Lerping a pale sky
 * straight at a dark saturated colour lands halfway in the mud; this does not.
 */
export function auraFilter(): THREE.Color {
  const a = auraState.air
  const m = Math.max(a.r, a.g, a.b, 1e-4)
  return filter.setRGB(a.r / m, a.g / m, a.b / m)
}

/** Everything the aura contributes, already scaled by how deep into it you are. */
export const auraMix = {
  haze: () => auraState.haze * auraState.strength,
  fillI: () => auraState.fillI * auraState.strength,
  sun: () => 1 + (auraState.sun - 1) * auraState.strength,
  ground: () => auraState.ground * auraState.strength,
  glow: () => 1 + (auraState.glow - 1) * auraState.strength,
  shafts: () => auraState.shafts * auraState.strength,
}
