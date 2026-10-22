import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useWorld } from '@/world/WorldContext'
import { playerState, usePlayerStore, useUiStore } from '@/store/stores'
import { toonMaterial } from '@/render/gradientMap'
import { TextSprite } from '@/overworld/TextSprite'
import { TYPE_COLOR } from '@/overworld/Landmarks'
import type { Landmark } from '@/world/schema'

function GlobeMarker({ lm, position, quaternion }: { lm: Landmark; position: THREE.Vector3; quaternion: THREE.Quaternion }) {
  const { globe } = useWorld()
  const textRef = useRef<THREE.Sprite>(null)
  const pinRef = useRef<THREE.Group>(null)
  const mat = toonMaterial(TYPE_COLOR[lm.type])
  const pole = toonMaterial('#5a4634')
  useFrame(({ clock }) => {
    if (!globe) return
    const d = globe.distance(playerState.map.x, playerState.map.z, lm.position[0], lm.position[1])
    const t = 1 - THREE.MathUtils.smoothstep(d, 60, 260)
    const near = 1 - THREE.MathUtils.smoothstep(d, 4, 14)
    if (textRef.current) {
      ;(textRef.current.material as THREE.SpriteMaterial).opacity = t * (1 - near * 0.7)
      textRef.current.visible = t > 0.02
    }
    if (pinRef.current) {
      pinRef.current.position.y = 3.2 + Math.sin(clock.elapsedTime * 1.6 + lm.position[0]) * 0.15
      pinRef.current.rotation.y = clock.elapsedTime * 0.6
    }
  })
  return (
    <group position={position} quaternion={quaternion}>
      <mesh position={[0, 1.2, 0]} material={pole} castShadow>
        <cylinderGeometry args={[0.08, 0.1, 2.4, 5]} />
      </mesh>
      <group ref={pinRef} position={[0, 3.2, 0]}>
        <mesh material={mat} castShadow>
          <octahedronGeometry args={[0.45, 0]} />
        </mesh>
      </group>
      <TextSprite spriteRef={textRef} text={lm.displayName} position={[0, 5.4, 0]} height={1.5} />
    </group>
  )
}

/** Waymarkers standing on the sphere; discovery by great-circle distance. */
export function GlobeLandmarks() {
  const { meta, globe } = useWorld()
  const placed = useMemo(() => {
    if (!globe) return []
    return meta.landmarks
      .filter((l) => !l.hidden)
      .map((lm) => {
        const d = globe.dirFromMap(lm.position[0], lm.position[1])
        const position = globe.surface(d, new THREE.Vector3(), meta.seaLevel)
        return { lm, position, quaternion: globe.frame(d) }
      })
  }, [meta, globe])
  const nearRef = useRef<string | null>(null)
  const timer = useRef(0)
  useFrame((_, dt) => {
    if (!globe) return
    timer.current += dt
    if (timer.current < 0.2) return
    timer.current = 0
    let best: Landmark | null = null
    let bestD = Infinity
    for (const lm of meta.landmarks) {
      if (lm.hidden) continue
      const d = globe.distance(playerState.map.x, playerState.map.z, lm.position[0], lm.position[1])
      if (d < lm.discoverRadius && d < bestD) {
        best = lm
        bestD = d
      }
    }
    const id = best?.id ?? null
    if (id !== nearRef.current) {
      nearRef.current = id
      useUiStore.getState().setNearLandmark(id)
      if (id) usePlayerStore.getState().discover(id)
    }
  })
  return (
    <group name="landmarks">
      {placed.map((p) => (
        <GlobeMarker key={p.lm.id} lm={p.lm} position={p.position} quaternion={p.quaternion} />
      ))}
    </group>
  )
}
