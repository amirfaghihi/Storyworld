import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useWorld } from '@/world/WorldContext'
import { getGradientMap } from '@/render/gradientMap'
import { mergeColoured } from '@/render/mergeColoured'
import { buildProps } from './propKinds'
import { applyExtensions } from '@/render/shaderExt'
import { clearColliderLayer, setColliderLayer } from '@/player/collision'
import type { Collider } from '@/player/colliderTypes'
import { useFrame } from '@react-three/fiber'
import { timeState } from '@/render/timeOfDay'
import { useTerrainVersion } from '@/editor/useTerrainVersion'
import { useEditorStore } from '@/editor/editorStore'

/** Procedural set pieces around each landmark, merged to two draw calls per landmark (lit + unlit). */
export function LandmarkProps() {
  const { meta, surface } = useWorld()
  const lit = useMemo(() => applyExtensions(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getGradientMap() }), { cloudShadow: true, weather: true }), [])
  // colour > 1 so glows exceed the bloom threshold
  const unlit = useMemo(() => new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.4, 2.4, 2.4) }), [])

  const terrainVersion = useTerrainVersion()
  const revision = useEditorStore((s) => s.revision)
  const built0 = useMemo(() => {
    const t0 = performance.now()
    // inside a place the pieces are solid; the miniature overworld stays walkable
    const colliders: Collider[] | undefined = meta.place ? [] : undefined
    const res = meta.landmarks
      .filter((l) => l.dressing && l.dressing.props.length)
      .map((l) => {
        // every piece, place kinds included, stands on the ground the terrain mesh draws
        const parts = buildProps(l, surface, meta.seaLevel, meta.seed, colliders)
        return {
          id: l.id,
          lit: mergeColoured(parts.filter((p) => !p.unlit)),
          unlit: mergeColoured(parts.filter((p) => p.unlit)),
        }
      })
    if (import.meta.env.DEV) console.info(`props: ${res.length} landmarks dressed in ${(performance.now() - t0).toFixed(0)} ms, ${colliders?.length ?? 0} colliders`)
    return { res, colliders }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, surface, terrainVersion, revision])
  useFrame(() => unlit.color.setScalar(timeState.emissive))
  const built = built0.res
  useEffect(
    () => () => {
      lit.dispose()
      unlit.dispose()
    },
    [lit, unlit],
  )
  useEffect(() => {
    setColliderLayer('props', built0.colliders ?? [])
    return () => clearColliderLayer('props')
  }, [built0])

  useEffect(
    () => () => {
      built.forEach((b) => {
        b.lit?.dispose()
        b.unlit?.dispose()
      })
    },
    [built],
  )

  return (
    <group name="props">
      {built.map((b) => (
        <group key={b.id}>
          {b.lit && <mesh geometry={b.lit} material={lit} castShadow receiveShadow />}
          {b.unlit && <mesh geometry={b.unlit} material={unlit} />}
        </group>
      ))}
    </group>
  )
}
