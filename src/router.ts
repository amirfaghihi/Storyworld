// Hash routing: #/<worldId>[/<placeId>]?x=..&z=..
import { useEffect, useState } from 'react'

export const DEFAULT_WORLD = 'middle-earth'

export interface Route {
  worldId: string
  placeId: string | null
  /** stable id used for saved positions and the hash prefix */
  id: string
}

export function parseRoute(hash = location.hash): Route {
  const m = /^#\/([\w-]+)(?:\/([\w-]+))?/.exec(hash)
  const worldId = m?.[1] ?? DEFAULT_WORLD
  const placeId = m?.[2] ?? null
  return { worldId, placeId, id: placeId ? `${worldId}/${placeId}` : worldId }
}

/** Re-renders when the route (world/place part of the hash) changes. */
export function useRoute(): Route {
  const [route, setRoute] = useState(parseRoute)
  useEffect(() => {
    const onChange = () => {
      const r = parseRoute()
      setRoute((prev) => (prev.id === r.id ? prev : r))
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function routeHash(id: string, x?: number, z?: number): string {
  return x === undefined || z === undefined ? `#/${id}` : `#/${id}?x=${x.toFixed(0)}&z=${z.toFixed(0)}`
}

/** Navigate to another world or place (remounts the scene). */
export function navigate(id: string, x?: number, z?: number) {
  location.hash = routeHash(id, x, z)
}

let lastWrite = 0
export function writeHash(id: string, x: number, z: number) {
  const now = performance.now()
  if (now - lastWrite < 1000) return
  lastWrite = now
  const h = routeHash(id, x, z)
  if (location.hash !== h) history.replaceState(null, '', h)
}
