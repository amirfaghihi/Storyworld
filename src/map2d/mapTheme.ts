import type { LoadedWorld } from '@/world/loadWorld'

/**
 * Colours and inks the map draws with, derived from the world's palette. This is the seam between
 * the map dialog and the map renderer: the renderer owns what goes in here, the dialog only
 * passes it through.
 *
 * Every land colour is the world's own palette colour mixed toward the paper, so the map reads as
 * a tinted drawing of this world (Mordor's ash and the Shire's meadows come out different without
 * anyone choosing map colours by hand), while the inks stay one family across worlds. The paper,
 * void and ink come from the --map-* tokens in tokens.css when a document is available.
 */
export interface MapTheme {
  [token: string]: string
}

export type RGB = [number, number, number]

/** '#rgb', '#rrggbb' or 'rgb(a)(…)' → [r, g, b] (0–255); anything else is null. */
export function parseColor(c: string | undefined): RGB | null {
  if (!c) return null
  const s = c.trim()
  if (s[0] === '#') {
    const h = s.slice(1)
    if (h.length === 3 || h.length === 4) return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
    if (h.length === 6 || h.length === 8) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
    return null
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(s)
  if (!m) return null
  const [r, g, b] = m[1].split(/[\s,/]+/).map(Number)
  return [r, g, b].every((v) => Number.isFinite(v)) ? [r, g, b] : null
}

export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

export const toHex = (c: RGB): string => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')

/** CSS colour with alpha from a theme token. */
export function rgba(c: RGB, a = 1): string {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`
}

const FALLBACK = {
  paper: '#f3ead6',
  void: '#e2d6bd',
  ink: '#2b2620',
}

let cssTokens: Partial<typeof FALLBACK> | null = null
function readCssTokens(): Partial<typeof FALLBACK> {
  if (cssTokens) return cssTokens
  cssTokens = {}
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return cssTokens
  const cs = getComputedStyle(document.documentElement)
  for (const k of ['paper', 'void', 'ink'] as const) {
    const v = cs.getPropertyValue(`--map-${k}`).trim()
    if (parseColor(v)) cssTokens[k] = v
  }
  return cssTokens
}

const themes = new WeakMap<LoadedWorld, MapTheme>()

/** The world's map theme; the same object every call for a world, so renderer caches stay warm. */
export function mapThemeFor(world: LoadedWorld): MapTheme {
  let t = themes.get(world)
  if (!t) {
    t = deriveTheme(world.meta.palette)
    themes.set(world, t)
  }
  return t
}

/** Builds a theme from a world palette (palette keys as in world.json; missing keys fall back). */
export function deriveTheme(pal: Record<string, string>): MapTheme {
  const css = readCssTokens()
  const P = (k: string, fb: string): RGB => parseColor(pal[k]) ?? parseColor(fb)!
  const paper = parseColor(css.paper) ?? parseColor(FALLBACK.paper)!
  const ink = parseColor(css.ink) ?? parseColor(FALLBACK.ink)!
  const voidC = parseColor(css.void) ?? parseColor(FALLBACK.void)!
  const grass = P('grass', '#7fb85a')
  const forest = P('forest', '#3f8a46')
  const forestDark = P('forestDark', '#2f6a44')
  const water = P('water', '#4d8fd6')
  const waterDeep = P('waterDeep', '#2c5fa8')
  const ash = mix(P('ash', '#5b524f'), P('ashPurple', pal.ash ?? '#5b524f'), 0.35)
  const rock = P('rockWarm', pal.rock ?? '#a68b6a')
  return {
    paper: toHex(paper),
    void: toHex(voidC),
    hatch: toHex(mix(voidC, ink, 0.35)),
    ink: toHex(ink),
    // hypsometric wash: lowland green to a drier upland tone, both well toward the paper
    low: toHex(mix(grass, paper, 0.6)),
    high: toHex(mix(P('grassDry', pal.grass ?? '#b8b95a'), paper, 0.55)),
    sand: toHex(mix(P('sand', '#e6d3a0'), paper, 0.4)),
    forest: toHex(mix(forest, paper, 0.45)),
    forestCrown: toHex(mix(forest, paper, 0.12)),
    forestInk: toHex(mix(forestDark, ink, 0.15)),
    forestDark: toHex(mix(forestDark, ink, 0.25)),
    rock: toHex(mix(rock, paper, 0.45)),
    snow: '#fbfaf6',
    ash: toHex(mix(ash, paper, 0.45)),
    marsh: toHex(mix(P('marsh', '#6f8f5a'), paper, 0.5)),
    marshInk: toHex(mix(P('marsh', '#6f8f5a'), ink, 0.35)),
    water: toHex(mix(water, paper, 0.55)),
    waterDeep: toHex(mix(waterDeep, paper, 0.5)),
    waterLine: toHex(mix(waterDeep, ink, 0.2)),
    road: '#8a6f4e',
    roadFill: toHex(mix(P('road', '#c9b48a'), paper, 0.15)),
    ditch: toHex(mix(mix(rock, paper, 0.45), ink, 0.5)),
  }
}
