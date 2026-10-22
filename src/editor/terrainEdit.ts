/**
 * Brush operations on the live heightfield, with undo and a dirty-rect event so the terrain
 * mesh, water, grass, vegetation and maps can refresh only what changed.
 */
import type { Heightfield } from '@/terrain/heightfield'
import { BIOME } from '@/world/biomes'
import type { Tool } from './editorStore'

export interface DirtyRect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

type Listener = (rect: DirtyRect, phase: 'stroke' | 'commit') => void
const listeners = new Set<Listener>()
export function onTerrainEdit(fn: Listener) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
function emit(rect: DirtyRect, phase: 'stroke' | 'commit') {
  listeners.forEach((l) => l(rect, phase))
}

interface Snapshot {
  heights: Float32Array
  biome: Uint8Array
}
const undoStack: Snapshot[] = []
const MAX_UNDO = 24
let strokeRect: DirtyRect | null = null

export function beginStroke(hf: Heightfield) {
  undoStack.push({ heights: hf.data.slice(), biome: hf.biome.slice() })
  if (undoStack.length > MAX_UNDO) undoStack.shift()
  strokeRect = null
}

export function endStroke() {
  if (strokeRect) emit(strokeRect, 'commit')
  strokeRect = null
}

export function canUndo() {
  return undoStack.length > 0
}

export function undo(hf: Heightfield) {
  const s = undoStack.pop()
  if (!s) return
  hf.data.set(s.heights)
  hf.biome.set(s.biome)
  emit({ minX: 0, maxX: hf.sizeX, minZ: 0, maxZ: hf.sizeZ }, 'commit')
}

const smoothstep = (t: number) => t * t * (3 - 2 * t)

/**
 * One brush dab at (x, z). `dt` scales the effect so dragging quickly or slowly feels the same.
 * Returns the affected rect.
 */
export function applyBrush(hf: Heightfield, tool: Tool, x: number, z: number, radius: number, strength: number, biome: number, dt: number, flattenTo?: number): DirtyRect | null {
  const { cell, width, height, data } = hf
  const r = radius
  const x0 = Math.max(0, Math.floor((x - r) / cell))
  const x1 = Math.min(width - 1, Math.ceil((x + r) / cell))
  const z0 = Math.max(0, Math.floor((z - r) / cell))
  const z1 = Math.min(height - 1, Math.ceil((z + r) / cell))
  if (x1 < x0 || z1 < z0) return null
  const amount = strength * 22 * dt // metres per second at full strength
  // smooth needs the unmodified neighbourhood
  const src = tool === 'smooth' ? data.slice() : data
  for (let iz = z0; iz <= z1; iz++) {
    for (let ix = x0; ix <= x1; ix++) {
      const dx = ix * cell - x
      const dz = iz * cell - z
      const d = Math.hypot(dx, dz) / r
      if (d >= 1) continue
      const w = smoothstep(1 - d)
      const i = iz * width + ix
      switch (tool) {
        case 'raise':
          data[i] += amount * w
          break
        case 'lower':
          data[i] -= amount * w
          break
        case 'flatten': {
          const target = flattenTo ?? data[i]
          data[i] += (target - data[i]) * Math.min(1, w * strength * 6 * dt)
          break
        }
        case 'smooth': {
          const xm = Math.max(0, ix - 1), xp = Math.min(width - 1, ix + 1)
          const zm = Math.max(0, iz - 1), zp = Math.min(height - 1, iz + 1)
          const avg = (src[iz * width + xm] + src[iz * width + xp] + src[zm * width + ix] + src[zp * width + ix]) * 0.25
          data[i] += (avg - data[i]) * Math.min(1, w * strength * 10 * dt)
          break
        }
        case 'paint':
          if (w > 0.15) hf.biome[i] = biome
          break
        default:
          break
      }
    }
  }
  const rect = { minX: x0 * cell, maxX: x1 * cell, minZ: z0 * cell, maxZ: z1 * cell }
  strokeRect = strokeRect
    ? { minX: Math.min(strokeRect.minX, rect.minX), maxX: Math.max(strokeRect.maxX, rect.maxX), minZ: Math.min(strokeRect.minZ, rect.minZ), maxZ: Math.max(strokeRect.maxZ, rect.maxZ) }
    : rect
  emit(rect, 'stroke')
  return rect
}

export const PAINTABLE = [BIOME.grass, BIOME.forest, BIOME.sand, BIOME.rock, BIOME.snow, BIOME.ash, BIOME.marsh, BIOME.road, BIOME.water, BIOME.riverbed]
