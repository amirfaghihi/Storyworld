import { createContext, useContext } from 'react'
import type { LoadedWorld } from './loadWorld'

export const WorldContext = createContext<LoadedWorld | null>(null)

export function useWorld(): LoadedWorld {
  const w = useContext(WorldContext)
  if (!w) throw new Error('useWorld must be used inside WorldContext')
  return w
}
