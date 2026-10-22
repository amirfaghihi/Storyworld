import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { playerState } from '@/store/stores'
import { getGradientMap } from '@/render/gradientMap'
import { applyExtensions } from '@/render/shaderExt'
import { timeState } from '@/render/timeOfDay'
import { buildHero, poseHero, createPoseState, createClothUniforms, clothMaterial, clothDepthMaterial, heroMaterial, sampleDrapeGround, COL } from './hero'

/**
 * The traveller: a legless hooded wanderer in a long split cloak over a robe that reaches the
 * ground (Journey-style; no legs, by design). The geometry lives in hero/heroParts.ts, the motion
 * in hero/heroPose.ts and the cloth (sway, trailing, ground drape) in the hero/cloak.ts shader.
 *
 * This component places the figure, feeds the pose the speed, turn rate and the ground the
 * controller publishes (playerState.ground), and owns the bits outside the figure: the steam
 * launch on deep water, the night glow of the crystal and of the mask's eyes, and the contact shadow.
 */

const CRYSTAL = new THREE.Color(COL.crystal)
/** the mask's eye slits: dark by day, a soft crystal cyan after dark (well under the crystal's boost) */
const SLIT_DAY = new THREE.Color(COL.maskSlit)
const SLIT_NIGHT = new THREE.Color(COL.crystal).multiplyScalar(1.3)
const UP = new THREE.Vector3(0, 1, 0)
/** The deck's top in the boat group (deck box at 0.62, 0.08 thick). */
const DECK_TOP = 0.66
const BLOB_R = 0.55

export function Avatar() {
  const root = useRef<THREE.Group>(null)
  const boat = useRef<THREE.Group>(null)
  const blob = useRef<THREE.Mesh>(null)
  const prevYaw = useRef(0)
  const yawRate = useRef(0)
  const sun = useRef<THREE.DirectionalLight | null>(null)
  const sunSearch = useRef(0)

  const hero = useMemo(() => {
    const cloth = createClothUniforms()
    const mats = {
      hero: heroMaterial(),
      cloth: clothMaterial(cloth),
      clothDepth: clothDepthMaterial(cloth),
      crystal: new THREE.MeshBasicMaterial({ color: CRYSTAL.clone() }),
      maskGlow: new THREE.MeshBasicMaterial({ color: SLIT_DAY.clone() }),
    }
    const rig = buildHero('moss', mats)
    for (const m of rig.lit) m.castShadow = true
    rig.cloth.receiveShadow = true
    // the shader trails and drapes the cloth beyond its bind-pose bounds
    rig.cloth.frustumCulled = false
    // Where the pose reads the ground: avatar-local (x, z) to world through the root's yaw, then
    // the controller's own support function, relative to the root. Built once; `at` is refreshed
    // each frame so the closure itself never allocates.
    const at = { px: 0, py: 0, pz: 0, cos: 1, sin: 0, mode: 0 as 0 | 1 | 2, deck: 0 }
    const ground = (x: number, z: number) => {
      if (at.mode === 2) return at.deck
      if (at.mode === 0) return 0
      return playerState.ground.sample(at.px + x * at.cos + z * at.sin, at.pz - x * at.sin + z * at.cos) - at.py
    }
    const input = { t: 0, dt: 0, speed: 0, yawRate: 0, gradeFwd: 0, ground, baseY: 0 }
    return { rig, cloth, mats, at, input, pose: createPoseState() }
  }, [])

  const boatMats = useMemo(
    () => ({
      hull: applyExtensions(new THREE.MeshToonMaterial({ color: '#5a3a26', gradientMap: getGradientMap() }), { cloudShadow: true }),
      deck: applyExtensions(new THREE.MeshToonMaterial({ color: '#b8905e', gradientMap: getGradientMap() }), { cloudShadow: true }),
      funnel: applyExtensions(new THREE.MeshToonMaterial({ color: '#2a2a2e', gradientMap: getGradientMap() }), { cloudShadow: true }),
      band: applyExtensions(new THREE.MeshToonMaterial({ color: '#c9542f', gradientMap: getGradientMap() }), { cloudShadow: true }),
    }),
    [],
  )
  const blobParts = useMemo(() => {
    const geo = new THREE.CircleGeometry(BLOB_R, 16).rotateX(-Math.PI / 2)
    // drawn over the ground it lies on, never into it, and never hiding what stands on it
    const mat = new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.08, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    return { geo, mat }
  }, [])

  // R3F disposes only what JSX creates; the figure, the boat's materials and the blob are built
  // here and handed in as objects, so they are freed here when the avatar leaves the scene
  useEffect(
    () => () => {
      hero.rig.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose()
      })
      Object.values(hero.mats).forEach((m) => m.dispose())
      Object.values(boatMats).forEach((m) => m.dispose())
      blobParts.geo.dispose()
      blobParts.mat.dispose()
    },
    [hero, boatMats, blobParts],
  )

  useFrame((state, rawDt) => {
    const g = root.current
    if (!g || !playerState.ready) return
    const dt = Math.min(rawDt, 0.05)
    const t = state.clock.elapsedTime
    const p = playerState.position
    const yaw = playerState.yaw
    g.position.copy(p)
    g.quaternion.copy(playerState.frame)
    g.rotateY(yaw)

    // the staff crystal burns brighter after dark
    hero.mats.crystal.color.copy(CRYSTAL).multiplyScalar(1.5 + timeState.lamp * 2.4)
    // and the mask's eye slits kindle with it
    hero.mats.maskGlow.color.lerpColors(SLIT_DAY, SLIT_NIGHT, timeState.lamp)

    // turn rate from the facing's change, smoothed: it leans the body and swings the hem out
    let dyaw = yaw - prevYaw.current
    while (dyaw > Math.PI) dyaw -= Math.PI * 2
    while (dyaw < -Math.PI) dyaw += Math.PI * 2
    prevYaw.current = yaw
    yawRate.current = THREE.MathUtils.damp(yawRate.current, dyaw / Math.max(dt, 1e-3), 6, dt)

    const afloat = playerState.afloat
    if (boat.current) {
      boat.current.visible = afloat
      if (afloat) {
        boat.current.position.y = Math.sin(t * 1.6) * 0.06 - 0.1
        boat.current.rotation.z = Math.sin(t * 1.1) * 0.04
        boat.current.rotation.x = -0.03 * Math.min(1, playerState.speed / 12) + Math.sin(t * 1.4 + 1) * 0.025
      }
    }

    // the ground the pose and the cloth stand on: the probe on flat worlds, the deck in the boat,
    // a flat plane at the root on the globe
    const gp = playerState.ground
    const onGround = gp.valid && !afloat
    const at = hero.at
    at.px = p.x
    at.py = p.y
    at.pz = p.z
    at.cos = Math.cos(yaw)
    at.sin = Math.sin(yaw)
    at.mode = afloat ? 2 : onGround ? 1 : 0
    at.deck = afloat && boat.current ? DECK_TOP + boat.current.position.y : 0

    const inp = hero.input
    inp.t = t
    inp.dt = dt
    inp.speed = playerState.speed
    inp.yawRate = yawRate.current
    inp.gradeFwd = onGround ? gp.gradeFwd : 0
    inp.baseY = at.deck
    poseHero(hero.rig, hero.pose, inp, hero.cloth)

    // the cloth drapes onto the ground round it, read through the controller's support function
    // (so a deck counts); in the air, afloat or on the globe it hangs free
    const u = hero.cloth
    if (onGround) sampleDrapeGround(u, gp.sample, p.x, p.z)
    u.uClDrape.value = onGround && playerState.grounded ? 1 : THREE.MathUtils.damp(u.uClDrape.value, 0, 8, dt)

    // contact shadow: lies in the ground's plane in world space; darker when the sun casts none
    const b = blob.current
    if (b) {
      b.visible = !afloat
      if (onGround) {
        b.position.set(p.x, gp.plane.c + 0.04, p.z)
        b.quaternion.setFromUnitVectors(UP, gp.normal)
      } else {
        b.position.copy(p).addScaledVector(playerState.up, 0.03)
        b.quaternion.copy(playerState.frame)
      }
      if (!sun.current?.parent && --sunSearch.current <= 0) {
        sunSearch.current = 60
        sun.current = (state.scene.getObjectByProperty('isDirectionalLight', true) as THREE.DirectionalLight | undefined) ?? null
      }
      blobParts.mat.opacity = sun.current?.castShadow ? 0.08 : 0.16
    }
  })

  return (
    <>
      <group ref={root}>
        {/* the steam launch the traveller boards over deep water (globe worlds) */}
        <group ref={boat} visible={false}>
          <mesh position={[0, 0.25, -0.2]} material={boatMats.hull} castShadow>
            <boxGeometry args={[1.6, 0.7, 4.2]} />
          </mesh>
          <mesh position={[0, 0.62, -0.2]} material={boatMats.deck}>
            <boxGeometry args={[1.3, 0.08, 3.6]} />
          </mesh>
          <mesh position={[0, 0.3, 2.3]} rotation={[Math.PI / 2, 0, 0]} material={boatMats.hull} castShadow>
            <coneGeometry args={[0.8, 1.2, 4]} />
          </mesh>
          <mesh position={[0, 0.9, -1.4]} material={boatMats.deck}>
            <boxGeometry args={[1.3, 0.5, 0.12]} />
          </mesh>
          <mesh position={[0, 1.35, -1.0]} material={boatMats.funnel} castShadow>
            <cylinderGeometry args={[0.16, 0.2, 1.5, 8]} />
          </mesh>
          <mesh position={[0, 1.95, -1.0]} material={boatMats.band}>
            <cylinderGeometry args={[0.19, 0.19, 0.18, 8]} />
          </mesh>
        </group>
        <primitive object={hero.rig.root} />
      </group>
      {/* faint contact shadow, in world space so it can lie on the slope */}
      <mesh ref={blob} geometry={blobParts.geo} material={blobParts.mat} renderOrder={1} />
    </>
  )
}
