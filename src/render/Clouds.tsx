import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useWorld } from '@/world/WorldContext'
import { playerState } from '@/store/stores'
import { getGradientMap } from './gradientMap'
import { mergeColoured, type Part } from './mergeColoured'
import { applyExtensions, sharedUniforms, MAX_CLOUDS } from './shaderExt'
import { hash2 } from '@/terrain/faceColors'
import { weatherLook } from './weather'

interface Cloud {
  x: number
  z: number
  y: number
  r: number
  speed: number
  geo: THREE.BufferGeometry
}

/** Metres across of the wrapping window that follows the traveller, so there is always sky above. */
const WINDOW = 760

function cloudGeometry(seed: number, r: number): THREE.BufferGeometry {
  const parts: Part[] = []
  const n = 6 + Math.floor(hash2(seed, 1) * 4)
  for (let i = 0; i < n; i++) {
    const a = hash2(seed, i + 10) * Math.PI * 2
    const d = Math.sqrt(hash2(seed, i + 20)) * r * 0.65
    const s = r * (0.28 + hash2(seed, i + 30) * 0.3)
    const x = Math.cos(a) * d
    const z = Math.sin(a) * d * 0.7
    const y = hash2(seed, i + 40) * r * 0.18
    parts.push({ geo: new THREE.SphereGeometry(s, 9, 6), color: '#ffffff', position: [x, y, z], scale: [1, 0.62, 1] })
    parts.push({ geo: new THREE.SphereGeometry(s * 0.9, 8, 5), color: '#d9dfe8', position: [x, y - s * 0.25, z], scale: [1, 0.45, 1] })
  }
  return mergeColoured(parts)!
}

const grey = new THREE.Color()

/**
 * Drifting low-poly clouds in a window that follows the traveller, so the sky above is never
 * empty. Weather decides how many there are, how big and low they hang and how dark they are;
 * their positions feed the cloud-shadow uniform used by ground materials.
 */
export function Clouds() {
  const { meta } = useWorld()
  const group = useRef<THREE.Group>(null)
  const material = useMemo(
    () => applyExtensions(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getGradientMap(), fog: true }), { cloudShadow: false }),
    [],
  )
  const clouds = useMemo<Cloud[]>(() => {
    const out: Cloud[] = []
    const spawn = playerState.position
    for (let i = 0; i < MAX_CLOUDS; i++) {
      const r = 18 + hash2(i, meta.seed) * 20
      out.push({
        x: spawn.x + (hash2(i, 3) - 0.5) * WINDOW,
        z: spawn.z + (hash2(i, 4) - 0.5) * WINDOW,
        y: 190 + hash2(i, 5) * 50, // well above the highest peaks (~131 m), so no cloud sits on a summit
        r,
        speed: 1.6 + hash2(i, 6) * 1.4,
        geo: cloudGeometry(i * 7 + meta.seed, r),
      })
    }
    return out
  }, [meta.seed])

  useEffect(() => () => clouds.forEach((c) => c.geo.dispose()), [clouds])

  useFrame((_, dt) => {
    const w = weatherLook()
    const wind = sharedUniforms.uWind.value
    const g = group.current
    const p = playerState.position
    // cover: more of them, bigger, lower and darker
    const shown = Math.round(4 + w.cover * (MAX_CLOUDS - 4))
    const swell = 1 + w.cover * 1.5
    const ceiling = 1 - w.cover * 0.26
    material.color.copy(grey.setRGB(1, 1, 1)).lerp(w.tint, w.gloom * 0.85)
    let n = 0
    clouds.forEach((c, i) => {
      c.x += wind.x * c.speed * dt
      c.z += wind.y * c.speed * dt
      // wrap around the traveller rather than the map, so the sky follows them
      const half = WINDOW / 2
      if (c.x - p.x > half) c.x -= WINDOW
      if (c.x - p.x < -half) c.x += WINDOW
      if (c.z - p.z > half) c.z -= WINDOW
      if (c.z - p.z < -half) c.z += WINDOW
      const m = g?.children[i]
      const visible = i < shown
      if (m) {
        m.visible = visible
        m.position.set(c.x, c.y * ceiling, c.z)
        m.scale.setScalar(swell)
      }
      if (visible) sharedUniforms.uClouds.value[n++].set(c.x, c.z, c.r * 0.9 * swell, c.y * ceiling)
    })
    sharedUniforms.uCloudCount.value = n
  })

  return (
    <group ref={group} name="clouds">
      {clouds.map((c, i) => (
        <mesh key={i} geometry={c.geo} material={material} position={[c.x, c.y, c.z]} frustumCulled />
      ))}
    </group>
  )
}
