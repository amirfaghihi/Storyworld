import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useWorld } from '@/world/WorldContext'
import { playerState, cameraState, usePlayerStore, useUiStore, GROUND_RING_R } from '@/store/stores'
import { input } from './useInput'
import { writeHash } from '@/router'
import { Walker, colliderVersion } from './collision'

export const WALK_SPEED = 6
export const RUN_SPEED = 12

/**
 * Moves the player over the drawn terrain and around the place's solids. No physics engine: the
 * Walker (collision.ts) slides the body along walls and stands it exactly on the surface; this
 * component turns input into a wish direction, faces the player and publishes the ground.
 */
export function KinematicController() {
  const { heightfield: hf, surface, meta } = useWorld()
  const saveTimer = useRef(0)
  const walker = useMemo(() => new Walker(surface), [surface])
  const seenColliders = useRef(-1)

  // spawn: persisted position for this world, or the world's spawn point, on whatever is there
  // (a deck included) and clear of every solid
  useEffect(() => {
    const saved = usePlayerStore.getState().positions[meta.id]
    const fromHash = readSpawnFromHash()
    let x: number, z: number
    if (fromHash) [x, z] = fromHash
    else if (saved) [x, z] = saved
    else [x, z] = meta.spawn
    const p = playerState.position
    walker.place(x, z, p)
    seenColliders.current = colliderVersion()
    playerState.map.x = p.x
    playerState.map.z = p.z
    playerState.up.set(0, 1, 0)
    playerState.frame.identity()
    playerState.velocity.set(0, 0, 0)
    playerState.vy = 0
    playerState.grounded = true
    playerState.teleports++
    // the support function the avatar probes feet and staff with, at the feet's current height
    playerState.ground.sample = (sx, sz) => walker.support(sx, sz, playerState.position.y)
    playerState.ready = true
    cameraState.distance = meta.cameraDistance ?? 13
    if (meta.spawnYaw !== undefined && !fromHash && !saved) {
      cameraState.yaw = meta.spawnYaw
      playerState.yaw = meta.spawnYaw + Math.PI
    }
    return () => {
      playerState.ready = false
      playerState.ground.valid = false
      playerState.grounded = true
      playerState.vy = 0
    }
  }, [hf, meta, walker])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const p = playerState.position
    const mapOpen = useUiStore.getState().mapOpen

    // Solids arrived or moved (props built after spawn, an editor change, a new tree tier): if
    // one now sits on the player, put the player down beside it instead of leaving them wedged.
    const cv = colliderVersion()
    if (cv !== seenColliders.current) {
      seenColliders.current = cv
      if (walker.unstick(playerState)) playerState.velocity.set(0, 0, 0)
    }

    // desired horizontal direction relative to camera yaw
    const f = mapOpen ? 0 : input.forward
    const s = mapOpen ? 0 : input.strafe
    if (!mapOpen && input.turn) cameraState.yaw -= input.turn * 1.9 * dt
    const yaw = cameraState.yaw
    // camera looks along -Z when yaw = PI; forward = direction from camera to player
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw)
    const rx = -fz, rz = fx
    let wx = fx * f + rx * s, wz = fz * f + rz * s
    const wl = Math.hypot(wx, wz)
    if (wl > 1) {
      wx /= wl
      wz /= wl
    }
    const speedScale = meta.speedScale ?? 1
    walker.step(playerState, wx, wz, (input.run ? RUN_SPEED : WALK_SPEED) * speedScale, dt)
    playerState.map.x = p.x
    playerState.map.z = p.z
    walker.probe(playerState, playerState.ground, GROUND_RING_R)

    const v = playerState.velocity
    playerState.speed = Math.hypot(v.x, v.z)
    playerState.running = input.run && playerState.speed > WALK_SPEED * speedScale + 0.5
    if (playerState.speed > 0.2) {
      const targetYaw = Math.atan2(v.x, v.z)
      playerState.yaw = dampAngle(playerState.yaw, targetYaw, 12, dt)
    }

    // persist position occasionally
    saveTimer.current += dt
    if (saveTimer.current > 1.5) {
      saveTimer.current = 0
      usePlayerStore.getState().setPosition(meta.id, +p.x.toFixed(1), +p.z.toFixed(1))
      writeHash(meta.id, p.x, p.z)
    }
  })
  return null
}

function dampAngle(a: number, b: number, lambda: number, dt: number) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * (1 - Math.exp(-lambda * dt))
}

function readSpawnFromHash(): [number, number] | null {
  const m = /[?&]x=([-\d.]+)&z=([-\d.]+)/.exec(location.hash)
  if (!m) return null
  const x = parseFloat(m[1]), z = parseFloat(m[2])
  return Number.isFinite(x) && Number.isFinite(z) ? [x, z] : null
}
