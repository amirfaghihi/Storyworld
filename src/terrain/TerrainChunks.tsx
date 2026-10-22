import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { useWorld } from '@/world/WorldContext'
import { buildTerrainChunks, buildChunk, chunksInRect, meshOptions, type TerrainChunk } from './buildChunks'
import { onTerrainEdit } from '@/editor/terrainEdit'
import { makePalette } from './faceColors'
import { getGradientMap } from '@/render/gradientMap'
import { groundOverrides } from '@/dressing/ground'
import { applyExtensions } from '@/render/shaderExt'
import { getMoodMap } from '@/vegetation/mood'

// the mesh options live in buildChunks so TerrainSurface reads the same ones
export { TERRAIN_SPACING } from './buildChunks'

export function TerrainChunks() {
  const { meta, heightfield, surface } = useWorld()
  const opts = useMemo(() => meshOptions({ terrainSpacing: meta.terrainSpacing }), [meta.terrainSpacing])
  const initial = useMemo(() => {
    const t0 = performance.now()
    const pal = makePalette(meta.palette)
    const c = buildTerrainChunks(heightfield, pal, meta.seaLevel, opts, meta.seed, groundOverrides(meta), getMoodMap(meta, heightfield))
    if (import.meta.env.DEV) console.info(`terrain: ${c.length} chunks in ${(performance.now() - t0).toFixed(0)} ms`)
    return c
  }, [meta, heightfield, opts])
  const [chunks, setChunks] = useState<TerrainChunk[]>(initial)
  useEffect(() => setChunks(initial), [initial])

  // editor: rebuild only the chunks under the brush
  useEffect(
    () =>
      onTerrainEdit((rect) => {
        const pal = makePalette(meta.palette)
        const overrides = groundOverrides(meta)
        const keys = chunksInRect(heightfield, opts, rect.minX, rect.maxX, rect.minZ, rect.maxZ)
        // A brush can turn a chunk into a mountain chunk or back. Re-read those flags before the
        // rebuild lands, so props, trees and grass re-placed on the new terrain see them.
        surface.refresh(keys)
        setChunks((prev) => {
          const next = prev.slice()
          for (const [cx, cz] of keys) {
            const key = `${cx}_${cz}`
            const i = next.findIndex((c) => c.key === key)
            const fresh = buildChunk(heightfield, pal, meta.seaLevel, opts, meta.seed, overrides, cx, cz, undefined, undefined, undefined, getMoodMap(meta, heightfield))
            if (i >= 0) {
              next[i].geometry.dispose()
              next[i] = fresh
            } else next.push(fresh)
          }
          return next
        })
      }),
    [meta, heightfield, surface, opts],
  )

  const material = useMemo(
    () => applyExtensions(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getGradientMap() }), { cloudShadow: true, weather: true }),
    [],
  )

  useEffect(() => () => initial.forEach((c) => c.geometry.dispose()), [initial])
  useEffect(() => () => material.dispose(), [material])

  return (
    <group name="terrain">
      {chunks.map((c) => (
        <mesh key={c.key} geometry={c.geometry} material={material} receiveShadow frustumCulled />
      ))}
    </group>
  )
}
