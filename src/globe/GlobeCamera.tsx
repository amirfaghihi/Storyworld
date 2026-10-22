import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useWorld } from '@/world/WorldContext'
import { playerState, cameraState } from '@/store/stores'

const target = new THREE.Vector3()
const lookAt = new THREE.Vector3()
const desired = new THREE.Vector3()
const off = new THREE.Vector3()
const probe = new THREE.Vector3()
const pd = new THREE.Vector3()
const ARM_STEPS = 12

/** Orbit camera in the traveller's local frame; kept above the curved ground with a short spring arm. */
export function GlobeCamera() {
  const { globe, meta } = useWorld()
  const first = useRef(true)
  useFrame(({ camera }, rawDt) => {
    if (!globe || !playerState.ready) return
    const dt = Math.min(rawDt, 1 / 20)
    const up = playerState.up
    target.copy(playerState.position).addScaledVector(up, 1.7)
    const { yaw, pitch, distance } = cameraState
    const cp = Math.cos(pitch)
    off.set(Math.sin(yaw) * cp * distance, Math.sin(pitch) * distance, Math.cos(yaw) * cp * distance).applyQuaternion(playerState.frame)
    desired.copy(target).add(off)
    // spring arm against the terrain
    let tMax = 1
    for (let i = 1; i <= ARM_STEPS; i++) {
      const t = i / ARM_STEPS
      probe.lerpVectors(target, desired, t)
      pd.copy(probe).normalize()
      const g = Math.max(globe.heightAtDir(pd), meta.seaLevel)
      if (probe.length() < globe.radius + g + 0.9) {
        tMax = Math.max(0.15, (i - 1) / ARM_STEPS)
        break
      }
    }
    if (tMax < 1) desired.lerpVectors(target, desired, tMax)
    pd.copy(desired).normalize()
    const ground = globe.radius + Math.max(globe.heightAtDir(pd), meta.seaLevel) + 1.6
    if (desired.length() < ground) desired.copy(pd).multiplyScalar(ground)
    lookAt.copy(target)
    if (pitch < 0) lookAt.addScaledVector(up, -pitch * distance * 1.3)
    if (first.current) {
      camera.position.copy(desired)
      first.current = false
    } else camera.position.lerp(desired, 1 - Math.exp(-10 * dt))
    camera.up.copy(up)
    camera.lookAt(lookAt)
  })
  return null
}
