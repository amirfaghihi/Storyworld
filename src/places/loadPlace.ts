import { loadWorld, type LoadedWorld } from '@/world/loadWorld'
import { buildPlace } from './buildPlace'
import type { PlaceDef } from './types'

/** Place definitions are code-split so the overworld bundle stays small. */
const REGISTRY: Record<string, () => Promise<{ def: PlaceDef }>> = {
  hobbiton: () => import('./defs/hobbiton'),
  bree: () => import('./defs/bree'),
  edoras: () => import('./defs/edoras'),
}

export async function loadPlace(worldId: string, placeId: string): Promise<LoadedWorld> {
  const load = REGISTRY[placeId]
  if (!load) throw new Error(`unknown place "${placeId}"`)
  const [{ def }, parent] = await Promise.all([load(), loadWorld(worldId)])
  const anchor = parent.meta.landmarks.find((l) => l.placeId === placeId)
  const returnTo: [number, number] = anchor
    ? [anchor.position[0] + def.returnOffset[0], anchor.position[1] + def.returnOffset[1]]
    : parent.meta.spawn
  const t0 = performance.now()
  const place = buildPlace(def, returnTo)
  if (import.meta.env.DEV) console.info(`place: ${def.name} built in ${(performance.now() - t0).toFixed(0)} ms`)
  return place
}
