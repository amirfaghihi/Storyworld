import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useWorld } from '@/world/WorldContext'
import { playerState, useSettingsStore, byQuality } from '@/store/stores'
import { BIOME } from '@/world/biomes'
import { hash2 } from '@/terrain/faceColors'
import { SUN_DIR } from './Sky'
import { sampleSky, timeState } from './timeOfDay'
import { weatherLook } from './weather'
import { auraMix, auraState } from './auras'

/**
 * Shafts of daylight falling through a canopy.
 *
 * Every forest pixel is a candidate; a fixed pool of shafts is re-assigned to the nearest
 * candidates a few times a second and re-aimed along the sun every frame, so a handful of meshes
 * covers the whole wood. They are additive tubes that fade at both ends and are brightest where
 * you look straight into them, which is the cheap way to make a solid mesh read as lit air.
 */

const vert = /* glsl */ `
  varying float vT;
  varying float vFacing;
  varying float vNear;
  void main() {
    vT = uv.y; // 0 at the foot of the shaft, 1 at the canopy
    // a hand-written shader gets no instancing for free: without this every shaft sits at the
    // world origin and none of them are ever seen
    vec4 local = vec4(position, 1.0);
    vec3 ln = normal;
    #ifdef USE_INSTANCING
      local = instanceMatrix * local;
      ln = mat3(instanceMatrix) * ln;
    #endif
    vec4 mv = modelViewMatrix * local;
    vec3 n = normalize(normalMatrix * ln);
    vec3 toCam = -mv.xyz;
    float d = length(toCam);
    vFacing = abs(dot(n, toCam / max(1e-4, d)));
    // a shaft you are standing inside should not smear across the whole view
    vNear = smoothstep(2.5, 11.0, d);
    gl_Position = projectionMatrix * mv;
  }
`
const frag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying float vT;
  varying float vFacing;
  varying float vNear;
  void main() {
    // brightest where it comes through the canopy, spent before it reaches the floor.
    // Both varyings are clamped first: a triangle crossing the near plane can interpolate them
    // out of range, and pow() of a negative number is a NaN that the bloom blur spreads over
    // the entire frame.
    float f = clamp(vFacing, 0.0, 1.0);
    float a = smoothstep(0.08, 0.7, clamp(vT, 0.0, 1.0)) * pow(f, 0.7) * uStrength * clamp(vNear, 0.0, 1.0);
    a = clamp(a, 0.0, 1.0);
    if (a < 0.004) discard;
    // additive blending already multiplies by alpha, so the colour carries the fade and the
    // alpha stays at one; premultiplying both would square it away to nothing
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }
`

const LEN = 13 // metres from canopy to where the shaft fades out
const REACH = 78 // only shafts this close to the traveller are drawn
const CANOPY = 10.5 // where the shafts come through

const dummy = new THREE.Object3D()
const axis = new THREE.Vector3()
const down = new THREE.Vector3(0, -1, 0)
const q = new THREE.Quaternion()
const tint = new THREE.Color()

export function LightShafts() {
  const { heightfield: hf, surface, meta } = useWorld()
  const quality = useSettingsStore((s) => s.quality)
  const slots = byQuality(quality, { low: 0, medium: 22, high: 40, ultra: 40 })

  /** Every place a shaft could fall: the forest floor, thinned to about one per 90 m². */
  const spots = useMemo(() => {
    if (!slots) return new Float32Array(0)
    const out: number[] = []
    const { width, height, cell } = hf
    for (let iz = 1; iz < height - 1; iz += 2) {
      for (let ix = 1; ix < width - 1; ix += 2) {
        if (hf.biome[iz * width + ix] !== BIOME.forest) continue
        const r = hash2(ix * 5 + 2, iz * 9 + 6)
        if (r > 0.34) continue
        const x = (ix + hash2(ix, iz)) * cell
        const z = (iz + hash2(ix + 13, iz + 7)) * cell
        // the drawn ground, so the pool of light lands on the triangles you see
        out.push(x, surface.height(x, z), z)
      }
    }
    if (import.meta.env.DEV) console.info(`light shafts: ${out.length / 3} places in the woods`)
    return new Float32Array(out)
  }, [hf, surface, slots])

  const geometry = useMemo(() => {
    // a tube, slightly wider where it lands; uv.y runs 0 at the bottom to 1 at the top
    const g = new THREE.CylinderGeometry(0.25, 1.1, LEN, 7, 1, true)
    g.translate(0, -LEN / 2, 0) // hang from the origin, which sits at the canopy
    return g
  }, [])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        uniforms: { uColor: { value: new THREE.Color('#ffe9b0') }, uStrength: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    [],
  )
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, material, Math.max(1, slots))
    m.frustumCulled = false
    m.renderOrder = 4
    m.count = 0
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    return m
  }, [geometry, material, slots])
  useEffect(() => () => mesh.dispose(), [mesh])
  useEffect(() => () => material.dispose(), [material])

  /** indices into `spots` currently in use */
  const chosen = useRef<number[]>([])
  const repick = useRef(0)

  useFrame((_, dt) => {
    if (!slots || spots.length === 0) {
      mesh.count = 0
      return
    }
    const w = weatherLook()
    const look = sampleSky(timeState.hour)
    // no shafts without a sun, and none through a closed sky
    const strength =
      Math.max(0, Math.min(1, (SUN_DIR.y - 0.05) / 0.45)) *
      timeState.day *
      (1 - w.cover * 0.85) *
      (0.55 + auraMix.shafts())
    material.uniforms.uStrength.value = Math.min(0.34, strength * 0.2)
    if (strength < 0.01) {
      mesh.count = 0
      return
    }
    tint.copy(look.sun).lerp(auraState.air, auraMix.haze() * 0.7)
    material.uniforms.uColor.value.copy(tint)

    const p = playerState.position
    repick.current -= dt
    if (repick.current <= 0) {
      repick.current = 0.4
      // nearest candidates first; a partial selection is enough for a pool this small
      const near: { i: number; d: number }[] = []
      for (let i = 0; i < spots.length; i += 3) {
        const d = Math.hypot(spots[i] - p.x, spots[i + 2] - p.z)
        if (d < REACH) near.push({ i, d })
      }
      near.sort((a, b) => a.d - b.d)
      chosen.current = near.slice(0, slots).map((n) => n.i)
    }

    // aim every shaft along the sun: the top stays put, the foot swings with the hour
    axis.copy(SUN_DIR).negate()
    q.setFromUnitVectors(down, axis)
    let n = 0
    for (const i of chosen.current) {
      dummy.position.set(spots[i], spots[i + 1] + CANOPY, spots[i + 2])
      dummy.quaternion.copy(q)
      const s = 0.7 + hash2(i, 3) * 0.8
      dummy.scale.set(s, 1, s)
      dummy.updateMatrix()
      mesh.setMatrixAt(n++, dummy.matrix)
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
  })

  if (!slots || meta.kind === 'globe') return null
  return <primitive object={mesh} />
}
