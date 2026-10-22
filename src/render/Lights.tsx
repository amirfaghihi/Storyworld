import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { playerState, useSettingsStore, atLeast, byQuality } from '@/store/stores'
import { SUN_DIR } from './Sky'
import { sampleSky, timeState } from './timeOfDay'
import { weatherLook } from './weather'
import { auraFilter, auraMix, auraState } from './auras'

const cloud = new THREE.Color()
const UP = new THREE.Vector3(0, 1, 0)
const axisX = new THREE.Vector3()
const axisY = new THREE.Vector3()
const snapped = new THREE.Vector3()

/**
 * Moves `p` onto the shadow map's texel grid, measured in the shadow camera's own image plane.
 *
 * The shadow box is recentred on the traveller every frame, so as they walk the texel grid slides
 * under the world and every shadow edge shimmers — a temporal crawl that no spatial anti-aliasing
 * touches. Snapping the centre to whole texels keeps the grid fixed against the ground. The axes
 * match the ones three's shadow camera gets from `lookAt` with a +Y up, so a whole-texel step in
 * them is a whole-texel step in the map.
 */
function snapToTexels(p: THREE.Vector3, sun: THREE.Vector3, texel: number, out: THREE.Vector3): THREE.Vector3 {
  axisX.crossVectors(UP, sun)
  if (axisX.lengthSq() < 1e-8) return out.copy(p)
  axisX.normalize()
  axisY.crossVectors(sun, axisX)
  const a = p.dot(axisX)
  const b = p.dot(axisY)
  return out
    .copy(p)
    .addScaledVector(axisX, Math.round(a / texel) * texel - a)
    .addScaledVector(axisY, Math.round(b / texel) * texel - b)
}

/**
 * Hemisphere fill + one directional light that is the sun by day and the moon by night, both
 * coloured by the clock and dimmed by the weather. Under cloud the sun's colour is dragged
 * toward the cloud's, which is what makes an overcast day read as flat rather than merely dark.
 * The shadow camera follows the player so shadows stay crisp.
 */
export function Lights() {
  const quality = useSettingsStore((s) => s.quality)
  const lightRef = useRef<THREE.DirectionalLight>(null)
  const hemiRef = useRef<THREE.HemisphereLight>(null)
  const target = useMemo(() => new THREE.Object3D(), [])
  const shadows = atLeast(quality, 'medium')
  const ultra = atLeast(quality, 'ultra')
  // 3072 rather than 4096: three allocates a colour attachment it never samples beside the depth
  // texture, so a 4k map costs ~134 MB, not 64. 3072 is ~75 MB.
  const shadowRes = byQuality(quality, { low: 1024, medium: 1024, high: 2048, ultra: 3072 })
  // Half-width of the shadow box, metres. Ultra widens it: with the tilt-shift gone, the band where
  // shadows simply stop — between the box edge and the fog — is in plain view. 150 m at 3072 is
  // still a slightly finer texel (4.9 cm) than high's 110 m at 2048 (5.4 cm).
  const half = ultra ? 75 : 55

  // three sizes the map and fixes the shadow camera's projection only when `shadow.map` is null,
  // and r3f never calls updateProjectionMatrix for `shadow-camera-*` props. Switching tier in a
  // running session would otherwise keep the old resolution and the old box, silently.
  useEffect(() => {
    const shadow = lightRef.current?.shadow
    if (!shadow) return
    if (shadow.map) {
      shadow.map.dispose()
      shadow.map = null
    }
    shadow.camera.updateProjectionMatrix()
  }, [shadowRes, half])

  useFrame(() => {
    const look = sampleSky(timeState.hour)
    const w = weatherLook()
    // a lightning strike is a very bright, very brief, very white sun
    const flash = w.flash
    const l = lightRef.current
    if (l) {
      const p = ultra ? snapToTexels(playerState.position, SUN_DIR, (half * 2) / shadowRes, snapped) : playerState.position
      target.position.copy(p)
      l.position.set(p.x + SUN_DIR.x * 120, p.y + SUN_DIR.y * 120, p.z + SUN_DIR.z * 120)
      l.color.copy(look.sun).lerp(cloud.copy(w.tint), w.gloom * 0.6)
      // the light of the place colours the sunlight that reaches the ground
      if (auraMix.fillI() > 0.002) l.color.lerp(auraState.fill, Math.min(0.75, auraMix.fillI() * 0.6))
      l.intensity = look.sunI * w.light * auraMix.sun() + flash * 2.6
      // moonlight and storm light cast only the faintest shadows
      l.castShadow = shadows && look.sunI * w.light > 0.8
    }
    const hemi = hemiRef.current
    if (hemi) {
      // overcast sky scatters light: the fill takes the cloud's colour from above
      hemi.color.copy(look.ambSky).lerp(cloud.copy(w.tint), w.gloom * 0.7)
      hemi.groundColor.copy(look.ambGround)
      hemi.intensity = look.ambI * w.amb + flash * 1.4
      // a place with an aura is lit by something of its own, from every side; the sky-side fill
      // is filtered through the air's colour, the ground-side takes the place's own light
      const fill = auraMix.fillI()
      if (fill > 0.002) {
        cloud.copy(hemi.color).multiply(auraFilter())
        hemi.color.lerp(cloud, Math.min(1, fill * 1.45))
        hemi.groundColor.lerp(auraState.fill, Math.min(0.9, fill))
        hemi.intensity = hemi.intensity * auraMix.sun() + fill * 0.35
      }
    }
  })

  return (
    <>
      <hemisphereLight ref={hemiRef} args={['#cfe6ff', '#8a7a5a', 1.0]} />
      <directionalLight
        ref={lightRef}
        color="#ffe9c4"
        intensity={2.6}
        castShadow={shadows}
        target={target}
        shadow-mapSize={[shadowRes, shadowRes]}
        // In three 0.184 PCF *is* the soft filter (PCFSoftShadowMap is deprecated and rewritten to
        // PCF): a 5-tap rotated disc whose width is radius × one texel. Past ~2.5 the dithered
        // penumbra starts to read as noise, since nothing temporal averages it away.
        shadow-radius={ultra ? 2.5 : 1}
        shadow-camera-near={20}
        shadow-camera-far={260}
        shadow-camera-left={-half}
        shadow-camera-right={half}
        shadow-camera-top={half}
        shadow-camera-bottom={-half}
        // ultra's texel is within 10% of high's, so the tuned offsets carry over unchanged
        shadow-bias={-0.0006}
        shadow-normalBias={0.03}
      />
      <primitive object={target} />
    </>
  )
}
