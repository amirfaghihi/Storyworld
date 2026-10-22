import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useWorld } from '@/world/WorldContext'
import { playerState, useUiStore, type Portal } from '@/store/stores'
import { KINDS } from '@/dressing/propKinds'
import { mergeColoured, type Part } from '@/render/mergeColoured'
import { getGradientMap } from '@/render/gradientMap'
import { applyExtensions } from '@/render/shaderExt'
import { TextSprite } from './TextSprite'
import { timeState } from '@/render/timeOfDay'
import { useTerrainVersion } from '@/editor/useTerrainVersion'

interface Door {
  x: number
  z: number
  radius: number
  label: string
  portal: Portal
}

/**
 * Doorways between the overworld and its places: a gate arch with lanterns at each landmark
 * that has a place, and the exit gate inside a place. Standing in one shows the Enter prompt.
 */
export function Portals() {
  const { meta, surface } = useWorld()
  const doors = useMemo<Door[]>(() => {
    if (meta.place) {
      const e = meta.place.exit
      return [{ x: e.x, z: e.z, radius: e.radius, label: e.label, portal: { label: e.label, targetId: meta.place.parentWorldId, x: meta.place.returnTo[0], z: meta.place.returnTo[1] } }]
    }
    return meta.landmarks
      .filter((l) => l.placeId)
      .map((l) => ({
        x: l.position[0] + 6,
        z: l.position[1] + 8,
        radius: 7,
        label: `Enter ${l.displayName}`,
        portal: { label: `Enter ${l.displayName}`, targetId: `${meta.id}/${l.placeId}` },
      }))
  }, [meta])

  // gate geometry inside a place is already built by the dressing; the overworld needs its own.
  // The surface reads heights live, so an editor terrain brush only needs the arches rebuilt
  // (terrainVersion) for them to stand on the new ground, as the landmark dressings do.
  const terrainVersion = useTerrainVersion()
  const geo = useMemo(() => {
    if (meta.place) return null
    const parts: Part[] = []
    // built on the drawn ground, like the arches the place dressings make
    const ground = (x: number, z: number) => surface.height(x, z)
    for (const d of doors) KINDS.gateArch({ x: d.x, z: d.z, rot: 0, scale: 1, params: { width: 3, height: 3.2, ring: 2.4 }, ground, surface, seaLevel: meta.seaLevel, seed: 1 }, parts)
    return { lit: mergeColoured(parts.filter((p) => !p.unlit)), unlit: mergeColoured(parts.filter((p) => p.unlit)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doors, surface, meta, terrainVersion])
  const lit = useMemo(() => applyExtensions(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getGradientMap() }), { cloudShadow: true, weather: true }), [])
  const unlit = useMemo(() => new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.4, 2.4, 2.4) }), [])
  useEffect(
    () => () => {
      geo?.lit?.dispose()
      geo?.unlit?.dispose()
    },
    [geo],
  )

  useFrame(() => unlit.color.setScalar(timeState.emissive))
  const labels = useRef<(THREE.Sprite | null)[]>([])
  const current = useRef<Door | null>(null)
  const timer = useRef(0)
  useFrame(({ camera }, dt) => {
    // labels fade when the camera is nearly on top of them
    labels.current.forEach((sp, i) => {
      if (!sp) return
      const d = doors[i]
      const dist = Math.hypot(camera.position.x - d.x, camera.position.z - d.z)
      ;(sp.material as THREE.SpriteMaterial).opacity = THREE.MathUtils.smoothstep(dist, 4, 11)
    })
    timer.current += dt
    if (timer.current < 0.15) return
    timer.current = 0
    const p = playerState.position
    let best: Door | null = null
    for (const d of doors) if (Math.hypot(p.x - d.x, p.z - d.z) < d.radius) best = d
    if (best !== current.current) {
      current.current = best
      useUiStore.getState().setPortal(best?.portal ?? null)
    }
  })
  useEffect(() => () => useUiStore.getState().setPortal(null), [])

  return (
    <group name="portals">
      {geo?.lit && <mesh geometry={geo.lit} material={lit} castShadow receiveShadow />}
      {geo?.unlit && <mesh geometry={geo.unlit} material={unlit} />}
      {doors.map((d, i) => (
        <TextSprite
          key={d.label}
          spriteRef={(el) => {
            labels.current[i] = el
          }}
          text={d.label}
          position={[d.x, surface.visible(d.x, d.z) + 4.6, d.z]}
          height={1.0}
          color="#fff3c4"
        />
      ))}
    </group>
  )
}
