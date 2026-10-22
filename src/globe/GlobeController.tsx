import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useWorld } from '@/world/WorldContext'
import { playerState, cameraState, usePlayerStore, useUiStore } from '@/store/stores'
import { input } from '@/player/useInput'
import { WALK_SPEED, RUN_SPEED } from '@/player/KinematicController'
import { writeHash } from '@/router'
import { SUN_DIR, SUN_LOCAL } from '@/render/Sky'

const ACCEL = 30
const MAX_CLIMB = 2.6 // a small planet has steep relief; the traveller scrambles
const FLOAT_DEPTH = 0.8 // deeper water than this and the traveller boards the boat
const BOAT_SPEED = 1.5

const dir = new THREE.Vector3()
const east = new THREE.Vector3()
const south = new THREE.Vector3()
const wish = new THREE.Vector3()
const tmp = new THREE.Vector3()
const cand = new THREE.Vector3()
const candDir = new THREE.Vector3()
const local = new THREE.Vector3()
const inv = new THREE.Quaternion()
/** dev counters: why steps were rejected */
const dbg = { moved: 0, climb: 0, frames: 0 }
if (import.meta.env.DEV) (window as unknown as { __gdbg: unknown }).__gdbg = dbg

/** Walks the traveller over the sphere: velocity lives in the local tangent plane, position is re-projected onto the terrain. */
export function GlobeController() {
  const { meta, globe } = useWorld()
  const saveTimer = useRef(0)

  useEffect(() => {
    if (!globe) return
    const saved = usePlayerStore.getState().positions[meta.id]
    const m = /[?&]x=([-\d.]+)&z=([-\d.]+)/.exec(location.hash)
    let x: number, z: number
    if (m) [x, z] = [parseFloat(m[1]), parseFloat(m[2])]
    else if (saved) [x, z] = saved
    else [x, z] = meta.spawn
    x = ((x % 360) + 360) % 360
    z = Math.min(179.9, Math.max(0.1, z))
    globe.dirFromMap(x, z, dir)
    const h0 = globe.heightAtDir(dir)
    playerState.afloat = h0 < meta.seaLevel - FLOAT_DEPTH
    globe.surface(dir, playerState.position, playerState.afloat ? meta.seaLevel + 0.1 : -Infinity)
    playerState.up.copy(dir)
    globe.frame(dir, playerState.frame)
    playerState.map.x = x
    playerState.map.z = z
    playerState.velocity.set(0, 0, 0)
    playerState.ready = true
    cameraState.distance = meta.cameraDistance ?? 12
    SUN_DIR.copy(SUN_LOCAL).applyQuaternion(playerState.frame)
    return () => {
      playerState.ready = false
      playerState.afloat = false
      playerState.up.set(0, 1, 0)
      playerState.frame.identity()
      SUN_DIR.copy(SUN_LOCAL)
    }
  }, [globe, meta])

  useFrame((_, rawDt) => {
    if (!globe || !playerState.ready) return
    const dt = Math.min(rawDt, 1 / 20)
    const p = playerState.position
    const mapOpen = useUiStore.getState().mapOpen
    dir.copy(p).normalize()
    globe.basis(dir, east, south)

    dbg.frames++
    const f = mapOpen ? 0 : input.forward
    const s = mapOpen ? 0 : input.strafe
    const moving = f !== 0 || s !== 0
    if (!mapOpen && input.turn) cameraState.yaw -= input.turn * 1.9 * dt
    const yaw = cameraState.yaw
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw)
    const rx = -fz, rz = fx
    const wx = fx * f + rx * s, wz = fz * f + rz * s
    wish.set(0, 0, 0).addScaledVector(east, wx).addScaledVector(south, wz)
    if (wish.lengthSq() > 1) wish.normalize()
    const speedScale = (meta.speedScale ?? 1) * (playerState.afloat ? BOAT_SPEED : 1)
    wish.multiplyScalar((input.run ? RUN_SPEED : WALK_SPEED) * speedScale)

    const v = playerState.velocity
    // keep velocity in the tangent plane as the frame turns
    v.addScaledVector(dir, -v.dot(dir))
    tmp.subVectors(wish, v)
    const step = ACCEL * dt
    if (tmp.length() > step) tmp.setLength(step)
    v.add(tmp)
    if (!moving && v.length() < 0.05) v.set(0, 0, 0)

    const sea = meta.seaLevel
    const hHere = Math.max(globe.heightAtDir(dir), sea - FLOAT_DEPTH)
    const tryMove = (vx: THREE.Vector3): boolean => {
      cand.copy(p).addScaledVector(vx, dt)
      candDir.copy(cand).normalize()
      const hRaw = globe.heightAtDir(candDir)
      const afloat = hRaw < sea - FLOAT_DEPTH
      // afloat the boat sits on the water; wading and walking follow the ground
      const h = afloat ? sea + 0.1 : hRaw
      const dist = vx.length() * dt
      if (!afloat && dist > 1e-4 && (h - hHere) / dist > MAX_CLIMB) {
        dbg.climb++
        return false
      }
      globe.surface(candDir, p, afloat ? sea + 0.1 : -Infinity)
      playerState.afloat = afloat
      dbg.moved++
      return true
    }
    if (!tryMove(v)) {
      // slide: try the east and south components separately
      const ve = tmp.copy(east).multiplyScalar(v.dot(east))
      if (!tryMove(ve)) {
        const vs = tmp.copy(south).multiplyScalar(v.dot(south))
        if (!tryMove(vs)) v.set(0, 0, 0)
        else v.copy(vs)
      } else v.copy(ve)
    }

    dir.copy(p).normalize()
    playerState.up.copy(dir)
    globe.frame(dir, playerState.frame)
    const [mx, mz] = globe.mapFromDir(dir)
    playerState.map.x = mx
    playerState.map.z = mz
    // the sun stays in the same place in the local sky
    SUN_DIR.copy(SUN_LOCAL).applyQuaternion(playerState.frame)

    playerState.speed = v.length()
    playerState.running = input.run && playerState.speed > WALK_SPEED * speedScale + 0.5
    if (playerState.speed > 0.2) {
      inv.copy(playerState.frame).invert()
      local.copy(v).applyQuaternion(inv)
      const targetYaw = Math.atan2(local.x, local.z)
      let d = targetYaw - playerState.yaw
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      playerState.yaw += d * (1 - Math.exp(-12 * dt))
    }

    saveTimer.current += dt
    if (saveTimer.current > 1.5) {
      saveTimer.current = 0
      usePlayerStore.getState().setPosition(meta.id, +mx.toFixed(2), +mz.toFixed(2))
      writeHash(meta.id, mx, mz)
    }
  })
  return null
}
