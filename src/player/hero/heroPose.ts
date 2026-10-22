import * as THREE from 'three'
import { DIM, type HeroRig } from './heroParts'
import type { ClothUniforms } from './cloak'

/**
 * Poses the wanderer each frame. There are no legs, so nothing steps: the body glides with a slight
 * rise and fall, breathes when still, leans into the climb, the speed and the turns, and the cloth
 * shader is fed a lag spring so the hem trails, swings out on turns and overshoots when stopping.
 * The staff is planted on the ground at rest and carried while moving; either way its foot never
 * goes into the ground. Arms reach the staff grip and the strap by two-bone IK.
 *
 * Everything here works in avatar space (see heroParts.ts). All temporaries are module-level, so a
 * frame allocates nothing.
 */

export interface HeroPoseInput {
  t: number
  dt: number
  /** horizontal speed, m/s */
  speed: number
  /** turn rate, rad/s, positive turning left (toward +X) */
  yawRate: number
  /** rise over run along the direction of travel, positive uphill */
  gradeFwd: number
  /** ground height relative to the avatar root at avatar-space (x, z) */
  ground: (x: number, z: number) => number
  /** the body's base above the root: 0 on foot, the deck top in the boat */
  baseY: number
}

export interface HeroPoseState {
  glide: number
  flutter: number
  moveW: number
  runW: number
  accel: number
  prevSpeed: number
  pitch: number
  roll: number
  lagX: number
  lagZ: number
  lagVX: number
  lagVZ: number
  carry: number
  /** last staff foot and up-the-shaft direction, avatar space (for checks) */
  staffFoot: THREE.Vector3
  staffDir: THREE.Vector3
}

export function createPoseState(): HeroPoseState {
  return {
    glide: 0,
    flutter: 0,
    moveW: 0,
    runW: 0,
    accel: 0,
    prevSpeed: 0,
    pitch: 0,
    roll: 0,
    lagX: 0,
    lagZ: 0,
    lagVX: 0,
    lagVZ: 0,
    carry: 0,
    staffFoot: new THREE.Vector3(),
    staffDir: new THREE.Vector3(0, 1, 0),
  }
}

const { damp, clamp, lerp } = THREE.MathUtils
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

const TAU = Math.PI * 2
/** Cloak lag spring: natural frequency and damping ratio (lightly damped, so it overshoots). */
const LAG_OMEGA = 7
const LAG_ZETA = 0.4
/** The planted staff's grip may slide this far along the shaft to keep the foot on the ground. */
const GRIP_MIN = 0.8
const GRIP_MAX = 1.45
/** Grip height up the shaft while carried. */
const GRIP_CARRY = 0.85
/** The carried staff's foot keeps this far off the ground. */
const CARRY_CLEAR = 0.03

const Y = new THREE.Vector3(0, 1, 0)
const POLE_L = new THREE.Vector3(0.3, -0.1, -1).normalize()
const POLE_R = new THREE.Vector3(-0.7, -0.2, -1).normalize()
const CARRY_DIR = new THREE.Vector3(0.1, 0.94, 0.33).normalize()
const SATCHEL = new THREE.Vector3(...DIM.satchel)

const _inv = new THREE.Matrix4()
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _qi = new THREE.Quaternion()
const _n = new THREE.Vector3()
const _b = new THREE.Vector3()
const _x = new THREE.Vector3()
const _y = new THREE.Vector3()
const _z = new THREE.Vector3()
const _d = new THREE.Vector3()
const _S = new THREE.Vector3()
const _E = new THREE.Vector3()
const _H = new THREE.Vector3()
const _T = new THREE.Vector3()
const _footP = new THREE.Vector3()
const _footC = new THREE.Vector3()
const _dirP = new THREE.Vector3()
const _dirC = new THREE.Vector3()
const _hand = new THREE.Vector3()
const _top = new THREE.Vector3()

/** Rotation whose -Y points along `dir` with +Z as close to `pole` as it can be. */
function aim(out: THREE.Quaternion, dir: THREE.Vector3, pole: THREE.Vector3): THREE.Quaternion {
  _y.copy(dir).normalize().negate()
  _z.copy(pole).addScaledVector(_y, -pole.dot(_y))
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1).addScaledVector(_y, -_y.z)
  _z.normalize()
  _x.crossVectors(_y, _z)
  _m.makeBasis(_x, _y, _z)
  return out.setFromRotationMatrix(_m)
}

/**
 * Two-bone IK in the parent's (body) space: shoulder at `S`, hand target `T`. Sets the shoulder
 * and elbow rotations and returns, in `outE` and `outH`, where the elbow and the hand ended up
 * (the hand falls short of `T` when it is out of reach).
 */
function solveArm(shoulder: THREE.Object3D, elbow: THREE.Object3D, T: THREE.Vector3, pole: THREE.Vector3, outE: THREE.Vector3, outH: THREE.Vector3) {
  const L1 = DIM.upperArm, L2 = DIM.forearm
  _S.copy(shoulder.position)
  _n.subVectors(T, _S)
  let d = _n.length()
  _n.divideScalar(d || 1)
  d = clamp(d, Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-4)
  outH.copy(_S).addScaledVector(_n, d)
  const a = (L1 * L1 + d * d - L2 * L2) / (2 * d)
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a))
  _b.copy(pole).addScaledVector(_n, -pole.dot(_n)).normalize()
  outE.copy(_S).addScaledVector(_n, a).addScaledVector(_b, h)
  aim(shoulder.quaternion, _d.subVectors(outE, _S), pole)
  aim(_q, _d.subVectors(outH, outE), pole)
  elbow.quaternion.copy(_qi.copy(shoulder.quaternion).invert().multiply(_q))
}

function setCap(u: ClothUniforms, i: number, a: THREE.Vector3, b: THREE.Vector3, r: number) {
  u.uClCapA.value[i].set(a.x, a.y, a.z, r)
  u.uClCapB.value[i].set(b.x, b.y, b.z, 0)
}

/** Pose the rig and write the cloth's motion uniforms (not the ground ones: Avatar owns those). */
export function poseHero(rig: HeroRig, st: HeroPoseState, inp: HeroPoseInput, cloth: ClothUniforms): void {
  const { t, speed: v, yawRate } = inp
  const dt = Math.max(inp.dt, 1e-4)

  // --- gait weights and the forward acceleration (from the speed's change)
  st.accel = damp(st.accel, (v - st.prevSpeed) / dt, 6, dt)
  st.prevSpeed = v
  st.moveW = damp(st.moveW, smooth(0.2, 1.5, v), 6, dt)
  st.runW = damp(st.runW, smooth(6.5, 10.5, v), 4, dt)
  st.glide += dt * TAU * (0.9 + 0.12 * v)
  st.flutter += dt * (2 + 0.9 * v)
  const mw = st.moveW, rw = st.runW
  const breathe = Math.sin((TAU * t) / 4.2)

  // --- body: a glide that rises a little twice per stride, breathing when still, leaning into
  //     the speed, the climb and the turns (never the whole root: the hem drape keeps the ground)
  const bob = mw * (0.012 + 0.008 * rw) * (0.5 - 0.5 * Math.cos(2 * st.glide))
  const pitchT = mw * (0.04 + 0.08 * rw) + clamp(st.accel * 0.01, -0.05, 0.06) + clamp(0.15 * inp.gradeFwd, -0.05, 0.08)
  const rollT = -clamp(yawRate * Math.max(v, 2) * 0.012, -0.14, 0.14)
  st.pitch = damp(st.pitch, pitchT, 5, dt)
  st.roll = damp(st.roll, rollT, 5, dt)
  const body = rig.body
  body.position.set((1 - mw) * 0.008 * Math.sin(TAU * 0.17 * t), inp.baseY + bob + (1 - mw) * 0.004 * (0.5 + 0.5 * breathe), 0)
  body.rotation.set(st.pitch, mw * 0.035 * Math.sin(st.glide), st.roll)
  body.updateMatrix()
  _inv.copy(body.matrix).invert()

  // the head keeps the eyes level against the lean, and looks about when idle
  rig.neck.rotation.set(-st.pitch * 0.6 + (1 - mw) * 0.03 * Math.sin(0.8 * t), (1 - mw) * 0.18 * Math.sin(0.45 * t), -st.roll * 0.3)

  // --- cloth: a lag spring trails the hem with speed and swings it out on turns
  // (the turn swing is kept small: swung far, the inner front edge would sweep across the robe).
  // Going downhill the ground rises behind, so a full trail would only be squashed up the slope by
  // the drape, its hem up by the shoulders on the steepest ground: it trails less the steeper it is.
  const trailMax = lerp(0.45, 0.12, smooth(0.2, 1.4, -inp.gradeFwd))
  const lagTX = clamp(0.03 * v + 0.012 * st.accel, -0.08, trailMax)
  const lagTZ = clamp(-0.025 * yawRate * v, -0.2, 0.2)
  const w2 = LAG_OMEGA * LAG_OMEGA, c2 = 2 * LAG_ZETA * LAG_OMEGA
  st.lagVX += (w2 * (lagTX - st.lagX) - c2 * st.lagVX) * dt
  st.lagVZ += (w2 * (lagTZ - st.lagZ) - c2 * st.lagVZ) * dt
  st.lagX += st.lagVX * dt
  st.lagZ += st.lagVZ * dt
  cloth.uClLag.value.set(st.lagX, st.lagZ)
  cloth.uClFlap.value = smooth(5, 11, v) * mw
  cloth.uClFlare.value = smooth(1, 10, v) * 0.8
  cloth.uClPhase.value = st.flutter

  // --- staff: planted beside the right foot-line at rest, carried leaning forward when moving.
  //     Planted, the foot is on the ground and the grip slides along the shaft to the hand;
  //     carried, the foot is lifted, and slides up through the hand rather than into rising ground.
  st.carry = damp(st.carry, smooth(0.4, 2.0, v), 5, dt)
  const carry = st.carry
  const [fx, fz] = DIM.staffFoot
  _footP.set(fx, inp.ground(fx, fz), fz)
  _T.set(-0.36, 1.07, 0.27).applyMatrix4(body.matrix)
  _dirP.subVectors(_T, _footP)
  const sP = clamp(_dirP.length(), GRIP_MIN, GRIP_MAX)
  _dirP.normalize()
  _T.set(-0.4, 1.02, 0.3 + 0.03 * Math.sin(st.glide)).applyMatrix4(body.matrix)
  _dirC.copy(CARRY_DIR)
  _dirC.z += 0.05 * Math.sin(st.glide)
  _dirC.normalize()
  _footC.copy(_T).addScaledVector(_dirC, -GRIP_CARRY)
  const foot = st.staffFoot.lerpVectors(_footP, _footC, carry)
  const dir = st.staffDir.lerpVectors(_dirP, _dirC, carry).normalize()
  let s = lerp(sP, GRIP_CARRY, carry)
  const g = inp.ground(foot.x, foot.z) + CARRY_CLEAR * carry
  if (foot.y < g) {
    const k = (g - foot.y) / Math.max(dir.y, 0.3)
    foot.addScaledVector(dir, k)
    s = Math.max(0.3, s - k)
  }
  rig.staff.position.copy(foot)
  rig.staff.quaternion.setFromUnitVectors(Y, dir)
  _hand.copy(foot).addScaledVector(dir, s).applyMatrix4(_inv)

  // --- arms: the right hand holds the grip; the left rests on the strap, swings a little when
  //     gliding and grips the strap higher at a run (drawn back, it would poke out of the cloak)
  solveArm(rig.shoulderR, rig.elbowR, _hand, POLE_R, _E, _H)
  // a little wider than the sleeves: the cloak's grid is coarse, and an elbow could slip between rows
  setCap(cloth, 2, rig.shoulderR.position, _E, 0.09)
  setCap(cloth, 3, _E, _H, 0.085)
  const sw = Math.sin(st.glide)
  _T.set(lerp(0.1, lerp(0.2, 0.13, rw), mw), lerp(1.06, lerp(1.0 + 0.02 * sw, 1.16, rw), mw), lerp(0.215, lerp(0.17 + 0.05 * sw, 0.2, rw), mw))
  solveArm(rig.shoulderL, rig.elbowL, _T, POLE_L, _E, _H)
  setCap(cloth, 0, rig.shoulderL.position, _E, 0.09)
  setCap(cloth, 1, _E, _H, 0.085)
  setCap(cloth, 4, SATCHEL, SATCHEL, DIM.satchelR)
  _top.copy(foot).addScaledVector(dir, 1.3).applyMatrix4(_inv)
  _footC.copy(foot).applyMatrix4(_inv)
  setCap(cloth, 5, _footC, _top, 0.035)
}
