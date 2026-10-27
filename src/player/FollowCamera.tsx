import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useWorld } from '@/world/WorldContext'
import { playerState, cameraState } from '@/store/stores'
import { pointInSolid, colliderCount } from './collision'

const target = new THREE.Vector3()
const lookAt = new THREE.Vector3()
const desired = new THREE.Vector3()
const probe = new THREE.Vector3()
const craned = new THREE.Vector3()
const ARM_STEPS = 14
/** ...and at least one probe per this many metres, so a long arm cannot step over a thin wall */
const ARM_PROBE = 0.5
const armSteps = (distance: number) => Math.max(ARM_STEPS, Math.ceil(distance / ARM_PROBE))
/** the most the arm may be lifted over rolling ground before it cranes or pulls in (metres) */
const MAX_LIFT = 6
/** the crane raises the arm's pitch in these steps (radians), up to CRANE_TOP */
const CRANE_STEP = 0.05
const CRANE_TOP = 1.4
const feet = new THREE.Vector3()

/**
 * The crane (places with `cameraCrane`): when the ground behind the traveller is too high to lift
 * the arm over, try a steeper arm at full length before pulling in. Takes the first pitch above
 * `pitch` whose line of sight meets no solid and needs a lift of MAX_LIFT or less, and from which
 * her feet are in sight too (otherwise a bench above hides all but her hood), writes that camera
 * position to `out` and returns true; false when none clears.
 */
function crane(hf: { sampleHeight(x: number, z: number): number }, yaw: number, pitch: number, distance: number, out: THREE.Vector3): boolean {
  for (let s = 1; pitch + s * CRANE_STEP <= CRANE_TOP + 1e-9; s++) {
    const p = pitch + s * CRANE_STEP
    const cp = Math.cos(p)
    craned.set(target.x + Math.sin(yaw) * cp * distance, target.y + Math.sin(p) * distance, target.z + Math.cos(yaw) * cp * distance)
    let lift = 0
    let blocked = false
    const n = armSteps(distance)
    for (let i = 1; i <= n; i++) {
      const t = i / n
      probe.lerpVectors(target, craned, t)
      if (colliderCount() > 0 && pointInSolid(probe.x, probe.y, probe.z)) {
        blocked = true
        break
      }
      const need = hf.sampleHeight(probe.x, probe.z) + 0.9 - probe.y
      if (need > 0) lift = Math.max(lift, need / t)
    }
    if (blocked || lift > MAX_LIFT) continue
    craned.y += lift
    // the feet must show as well as the shoulders
    feet.set(target.x, target.y - 1.6, target.z)
    let seen = true
    for (let i = 1; i < n; i++) {
      probe.lerpVectors(feet, craned, i / n)
      if (hf.sampleHeight(probe.x, probe.z) + 0.2 > probe.y) {
        seen = false
        break
      }
    }
    if (seen) {
      out.copy(craned)
      return true
    }
  }
  return false
}

/** Third-person orbit camera. Clamped above the terrain and water instead of using collision. */
export function FollowCamera() {
  const { heightfield: hf, meta } = useWorld()
  const first = useRef(true)
  const camY = useRef(0)
  const seenTeleports = useRef(-1)

  useFrame(({ camera }, rawDt) => {
    if (!playerState.ready) return
    const dt = Math.min(rawDt, 1 / 20)
    const p = playerState.position
    // The player stands exactly on the ground, so a deck step-up or a kink between terrain
    // facets lifts them in one frame. Only the camera smooths that, so the view does not pump;
    // A teleport is followed at once. Anything else is eased, including a long fall off a cliff:
    // snapping whenever the gap passed 3 m made the view lurch 3 m at a time all the way down.
    // Airborne, the ease is brisker so the camera does not trail far behind a fast drop.
    if (first.current || playerState.teleports !== seenTeleports.current) {
      camY.current = p.y
      seenTeleports.current = playerState.teleports
    } else camY.current = THREE.MathUtils.damp(camY.current, p.y, playerState.grounded ? 12 : 30, dt)
    // look at the traveller's shoulders: her hood now peaks at ~2.17 m, so 1.7 framed her low
    target.set(p.x, camY.current + 1.8, p.z)

    const { yaw, pitch, distance } = cameraState
    const cp = Math.cos(pitch)
    desired.set(
      target.x + Math.sin(yaw) * cp * distance,
      target.y + Math.sin(pitch) * distance,
      target.z + Math.cos(yaw) * cp * distance,
    )
    // spring arm: when a hill lies between camera and traveller, first try lifting the camera
    // over it (rolling country); when that needs too much, or a building is in the way, pull in.
    // A place with cameraCrane first tries raising the arm's pitch before it pulls in.
    let lift = 0
    let tMax = 1
    const n = armSteps(distance)
    for (let i = 1; i <= n; i++) {
      const t = i / n
      probe.lerpVectors(target, desired, t)
      if (colliderCount() > 0 && pointInSolid(probe.x, probe.y, probe.z)) {
        tMax = Math.max(0.12, (i - 1) / n)
        break
      }
      const need = hf.sampleHeight(probe.x, probe.z) + 0.9 - probe.y
      if (need > 0) lift = Math.max(lift, need / t)
    }
    if (tMax < 1) desired.lerpVectors(target, desired, tMax)
    else if (lift > 0) {
      if (lift <= MAX_LIFT) desired.y += lift
      else if (meta.cameraCrane && crane(hf, yaw, pitch, distance, desired)) {
        // craned up over the cliff at full length; the look-at point stays on the traveller
      } else {
        // too steep to look over: shorten the arm until the line of sight clears
        for (let i = n - 1; i >= 2; i--) {
          const t = i / n
          probe.lerpVectors(target, desired, t)
          let clear = true
          for (let k = 1; k <= i; k++) {
            const tk = k / n
            const px = target.x + (desired.x - target.x) * tk
            const pz = target.z + (desired.z - target.z) * tk
            const py = target.y + (probe.y - target.y) * (k / i)
            if (hf.sampleHeight(px, pz) + 0.9 > py) {
              clear = false
              break
            }
          }
          if (clear) {
            tMax = t
            break
          }
        }
        desired.lerpVectors(target, desired, Math.max(0.12, tMax))
      }
    }
    // keep the camera above ground and water
    const ground = Math.max(hf.sampleHeight(desired.x, desired.z), meta.seaLevel) + 1.6
    if (desired.y < ground) desired.y = ground
    // negative pitch: camera sits low and the view tilts up over the player's head
    lookAt.copy(target)
    if (pitch < 0) lookAt.y += -pitch * distance * 1.3

    if (first.current) {
      camera.position.copy(desired)
      first.current = false
    } else {
      const k = 1 - Math.exp(-10 * dt)
      camera.position.lerp(desired, k)
    }
    camera.lookAt(lookAt)
  })
  return null
}
