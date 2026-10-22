import * as THREE from 'three'
import type { World } from '@/world/schema'

/** Terrain colour for each ground kind a dressing can ask for. */
export const GROUND_COLORS: Record<string, string> = {
  stone: '#9a968c',
  sand: '#e2cf9a',
  ash: '#4e4648',
  marsh: '#5f7a4f',
  snowyRock: '#c9ccd2',
  darkForest: '#3a5a34',
  golden: '#c9a83c',
  lava: '#3a2a28',
  rubble: '#8d8478',
  blight: '#6c6a58',
  meadow: '#9ccd5e',
  lush: '#4f9a5c',
  downs: '#8fbf5f',
  village: '#a9a06a',
  scorched: '#5a4c42',
  rust: '#7a5a44',
}

export interface GroundOverride {
  x: number
  z: number
  r: number
  inner: number
  blend: number
  kind: string
  color: THREE.Color
}

export function groundOverrides(world: World): GroundOverride[] {
  const out: GroundOverride[] = []
  for (const lm of world.landmarks) {
    const g = lm.dressing?.ground
    if (!g) continue
    out.push({
      x: lm.position[0],
      z: lm.position[1],
      r: lm.dressing!.radius,
      inner: g.inner,
      blend: g.blend,
      kind: g.kind,
      color: new THREE.Color(GROUND_COLORS[g.kind] ?? '#888888'),
    })
  }
  return out
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** 0..1 influence of an override at (x, z): full inside `inner * r`, fading to 0 at `r`. */
export function overrideWeight(o: GroundOverride, x: number, z: number): number {
  const d = Math.hypot(x - o.x, z - o.z)
  if (d >= o.r) return 0
  return o.blend * (1 - smooth(o.inner * o.r, o.r, d))
}

export interface VegOverride {
  x: number
  z: number
  r: number
  density: number
  palette: string
  flowers?: string
}

export function vegOverrides(world: World): VegOverride[] {
  const out: VegOverride[] = []
  for (const lm of world.landmarks) {
    const v = lm.dressing?.vegetation
    if (!v) continue
    out.push({ x: lm.position[0], z: lm.position[1], r: lm.dressing!.radius, density: v.density, palette: v.palette, flowers: v.flowers })
  }
  return out
}
