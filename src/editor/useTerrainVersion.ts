import { useEffect, useState } from 'react'
import { onTerrainEdit } from './terrainEdit'

/** Increments after each committed terrain stroke (pointer up / undo). Use as a memo dependency. */
export function useTerrainVersion(): number {
  const [v, setV] = useState(0)
  useEffect(() => onTerrainEdit((_, phase) => phase === 'commit' && setV((x) => x + 1)), [])
  return v
}
