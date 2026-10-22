import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { TextSprite } from './TextSprite'
import { useWorld } from '@/world/WorldContext'
import { playerState, usePlayerStore, useUiStore } from '@/store/stores'
import { toonMaterial } from '@/render/gradientMap'
import type { Landmark, LandmarkType } from '@/world/schema'
import { useTerrainVersion } from '@/editor/useTerrainVersion'
import { useEditorStore } from '@/editor/editorStore'

export const TYPE_COLOR: Record<LandmarkType, string> = {
  city: '#f2c14e',
  village: '#e0a458',
  fortress: '#c0392b',
  ruin: '#9b8ea3',
  forest: '#4caf50',
  mountain: '#dfe6ee',
  other: '#7fb3d5',
  home: '#e0a458',
  inn: '#c9542f',
  mill: '#b8a080',
  tree: '#8fd05a',
  water: '#4d8fd6',
  hill: '#9ccd5e',
}

const LABEL_FADE_NEAR = 60
const LABEL_FADE_FAR = 260

function Marker({ lm, y }: { lm: Landmark; y: number }) {
  const textRef = useRef<THREE.Sprite>(null)
  const pinRef = useRef<THREE.Group>(null)
  const color = TYPE_COLOR[lm.type]
  const mat = toonMaterial(color)
  const pole = toonMaterial('#5a4634')

  useFrame(({ clock }) => {
    const d = Math.hypot(playerState.position.x - lm.position[0], playerState.position.z - lm.position[1])
    const t = 1 - THREE.MathUtils.smoothstep(d, LABEL_FADE_NEAR, LABEL_FADE_FAR)
    const near = 1 - THREE.MathUtils.smoothstep(d, 4, 14) // hide label when standing on it
    if (textRef.current) {
      const m = textRef.current.material as THREE.SpriteMaterial
      m.opacity = t * (1 - near * 0.7)
      textRef.current.visible = t > 0.02
    }
    if (pinRef.current) {
      pinRef.current.position.y = y + 3.2 + Math.sin(clock.elapsedTime * 1.6 + lm.position[0]) * 0.15
      pinRef.current.rotation.y = clock.elapsedTime * 0.6
    }
  })

  return (
    <group position={[lm.position[0], 0, lm.position[1]]}>
      {/* waymarker pole */}
      <mesh position={[0, y + 1.25, 0]} material={pole} castShadow>
        <cylinderGeometry args={[0.08, 0.1, 2.5, 5]} />
      </mesh>
      <group ref={pinRef} position={[0, y + 3.2, 0]}>
        <mesh material={mat} castShadow>
          <octahedronGeometry args={[0.45, 0]} />
        </mesh>
      </group>
      <TextSprite spriteRef={textRef} text={lm.displayName} position={[0, y + 5.4, 0]} height={1.5} />
    </group>
  )
}

/** Renders every landmark and handles discovery when the player walks up to one. */
export function Landmarks() {
  const { meta, surface } = useWorld()
  const terrainVersion = useTerrainVersion()
  const revision = useEditorStore((s) => s.revision)
  // each waymarker's foot: 0.1 m into the lowest ground under its pole (or the water), so it never shows air
  const ys = useMemo(
    () => meta.landmarks.map((l) => Math.max(meta.seaLevel, surface.footprintMin(l.position[0], l.position[1], 0.1)) - 0.1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meta, surface, terrainVersion, revision],
  )
  const nearRef = useRef<string | null>(null)
  const timer = useRef(0)

  useFrame((_, dt) => {
    timer.current += dt
    if (timer.current < 0.2) return
    timer.current = 0
    const p = playerState.position
    let best: Landmark | null = null
    let bestD = Infinity
    for (const lm of meta.landmarks) {
      if (lm.hidden) continue
      const d = Math.hypot(p.x - lm.position[0], p.z - lm.position[1])
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
      {meta.landmarks.map((lm, i) => (lm.hidden ? null : <Marker key={`${lm.id}_${revision}`} lm={lm} y={ys[i]} />))}
    </group>
  )
}
