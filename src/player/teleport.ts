import { playerState, cameraState } from '@/store/stores'
import { Heightfield } from '@/terrain/heightfield'
import type { GlobeField } from '@/globe/globeField'
import { surfaceOf } from '@/terrain/surface'
import { SUN_DIR, SUN_LOCAL } from '@/render/Sky'
import { Walker } from './collision'
import * as THREE from 'three'

/**
 * Teleport (fast travel). Kept out of the controller module so Fast Refresh can hot-swap it.
 * Lands on the drawn ground, or on a deck spanning the spot, clear of every solid (the nearest
 * free point within 6 m when the spot itself is inside one).
 */
export function teleportTo(x: number, z: number, hf: { sampleHeight: (x: number, z: number) => number }) {
  const p = playerState.position
  if (hf instanceof Heightfield) new Walker(surfaceOf(hf)).place(x, z, p)
  else p.set(x, hf.sampleHeight(x, z), z)
  playerState.map.x = p.x
  playerState.map.z = p.z
  playerState.velocity.set(0, 0, 0)
  playerState.vy = 0
  playerState.grounded = true
  playerState.teleports++
}

/**
 * Arrive a short walk from a landmark, on dry and reasonably level ground, with the camera
 * turned to look at it, so the place is in view instead of underfoot.
 */
export function travelToLandmark(lm: { position: [number, number]; discoverRadius?: number }, hf: Heightfield, seaLevel: number, globe?: GlobeField) {
  if (globe) return travelOnGlobe(lm, globe, seaLevel)
  const [lx, lz] = lm.position
  const dist = Math.min(34, Math.max(18, (lm.discoverRadius ?? 28) * 0.9))
  const hl = hf.sampleHeight(lx, lz)
  let best: { x: number; z: number; score: number } | null = null
  for (let i = 0; i < 12; i++) {
    const a = Math.PI + (i / 12) * Math.PI * 2 // start due south (default camera side)
    const x = hf.clampX(lx + Math.sin(a) * dist)
    const z = hf.clampZ(lz + Math.cos(a) * dist)
    const h = hf.sampleHeight(x, z)
    if (h < seaLevel + 0.3) continue
    // prefer flat ground a little below the landmark, and the southern side
    const score = -hf.slopeAt(x, z) * 4 - Math.max(0, h - hl) * 0.3 - Math.abs(i > 6 ? 12 - i : i) * 0.15
    if (!best || score > best.score) best = { x, z, score }
  }
  const x = best?.x ?? lx
  const z = best?.z ?? lz
  teleportTo(x, z, hf)
  // camera behind the traveller, looking toward the landmark
  const dx = x - lx, dz = z - lz
  if (Math.hypot(dx, dz) > 1) cameraState.yaw = Math.atan2(dx, dz)
  cameraState.pitch = 0.42
  cameraState.distance = Math.max(cameraState.distance, 18)
  playerState.yaw = cameraState.yaw + Math.PI
}

const gDir = new THREE.Vector3()
const gCand = new THREE.Vector3()
const gBest = new THREE.Vector3()
const gLocal = new THREE.Vector3()
const gInv = new THREE.Quaternion()

function travelOnGlobe(lm: { position: [number, number]; discoverRadius?: number }, globe: GlobeField, seaLevel: number) {
  globe.dirFromMap(lm.position[0], lm.position[1], gDir)
  const dist = Math.min(34, Math.max(18, (lm.discoverRadius ?? 28) * 0.9))
  const hl = globe.heightAtDir(gDir)
  let bestScore = -Infinity
  let found = false
  for (let i = 0; i < 12; i++) {
    const a = Math.PI + (i / 12) * Math.PI * 2
    globe.offset(gDir, Math.sin(a) * dist, Math.cos(a) * dist, gCand)
    const h = globe.heightAtDir(gCand)
    if (h < seaLevel + 0.3) continue
    const score = -globe.slopeAtDir(gCand) * 4 - Math.max(0, h - hl) * 0.3 - Math.abs(i > 6 ? 12 - i : i) * 0.15
    if (score > bestScore) {
      bestScore = score
      gBest.copy(gCand)
      found = true
    }
  }
  if (!found) gBest.copy(gDir)
  globe.surface(gBest, playerState.position)
  playerState.up.copy(gBest)
  globe.frame(gBest, playerState.frame)
  const [mx, mz] = globe.mapFromDir(gBest)
  playerState.map.x = mx
  playerState.map.z = mz
  playerState.velocity.set(0, 0, 0)
  SUN_DIR.copy(SUN_LOCAL).applyQuaternion(playerState.frame)
  // camera behind the traveller, looking toward the landmark
  gInv.copy(playerState.frame).invert()
  gLocal.copy(gBest).sub(gDir).applyQuaternion(gInv)
  if (gLocal.lengthSq() > 1e-8) cameraState.yaw = Math.atan2(gLocal.x, gLocal.z)
  cameraState.pitch = 0.42
  cameraState.distance = Math.max(cameraState.distance, 18)
  playerState.yaw = cameraState.yaw + Math.PI
}
