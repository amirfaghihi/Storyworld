import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useWorld } from '@/world/WorldContext'
import { useSettingsStore, byQuality } from '@/store/stores'
import { onTerrainEdit } from '@/editor/terrainEdit'
import { FOG_COLOR, timeState } from './timeOfDay'
import { weatherLook } from './weather'
import { auraMix, auraState } from './auras'

/**
 * What the weather looks like from inside it: falling rain, snow and ash in a box that follows
 * the camera, and low mist that lies on the ground.
 *
 * The falling stuff is simulated in a box around the camera and wrapped when it leaves, so a
 * couple of thousand particles cover the whole visible world. Each kind keeps its own particles
 * alive at all times and only its draw range and opacity change, which lets rain thin out while
 * snow thickens instead of one stopping dead as the other starts.
 */

/** Half-extent of the simulation box: metres either side of the camera. */
const HALF_XZ = 26
const HALF_Y = 17

type Kind = 'rain' | 'snow' | 'ash'

/** Folds a coordinate back into [centre - half, centre + half) however far outside it has drifted. */
function wrap(v: number, centre: number, half: number): number {
  const size = half * 2
  const d = v - centre + half
  return centre - half + ((d % size) + size) % size
}

class Fall {
  pos: Float32Array
  vel: Float32Array
  seed: Float32Array
  /** rain needs two vertices per drop (the streak); snow and ash one */
  readonly stride: number
  geometry: THREE.BufferGeometry
  attr: THREE.BufferAttribute

  constructor(
    readonly kind: Kind,
    readonly count: number,
  ) {
    this.stride = kind === 'rain' ? 2 : 1
    this.pos = new Float32Array(count * this.stride * 3)
    this.vel = new Float32Array(count * 3)
    this.seed = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      this.seed[i] = Math.random()
      this.reset(i, Math.random() * 2 - 1)
    }
    this.geometry = new THREE.BufferGeometry()
    this.attr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)
    this.geometry.setAttribute('position', this.attr)
    // the box moves with the camera, so culling it would be wrong
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
  }

  private reset(i: number, yFrac: number) {
    const o = i * this.stride * 3
    this.pos[o] = (Math.random() * 2 - 1) * HALF_XZ
    this.pos[o + 1] = yFrac * HALF_Y
    this.pos[o + 2] = (Math.random() * 2 - 1) * HALF_XZ
    const v = i * 3
    switch (this.kind) {
      case 'rain':
        this.vel.set([0, -26 - Math.random() * 10, 0], v)
        break
      case 'snow':
        this.vel.set([0, -1.5 - Math.random() * 1.2, 0], v)
        break
      case 'ash':
        this.vel.set([0, -1.1 - Math.random() * 1.0, 0], v)
        break
    }
  }

  /**
   * `cam` is the box centre; `wx`/`wz` the wind. Positions are world-space, so the weather
   * stands still while the traveller runs through it; anything that leaves the box is wrapped
   * round to the far side, however far away it has ended up.
   */
  update(dt: number, cam: THREE.Vector3, wx: number, wz: number, t: number) {
    const { pos, vel, seed, stride, count } = this
    const drift = this.kind === 'rain' ? 0.16 : this.kind === 'snow' ? 1.1 : 1.6
    const swirl = this.kind === 'rain' ? 0 : this.kind === 'snow' ? 0.5 : 0.85
    for (let i = 0; i < count; i++) {
      const o = i * stride * 3
      const v = i * 3
      const s = seed[i]
      const vx = wx * drift + (swirl ? Math.sin(t * (0.8 + s) + s * 30) * swirl : 0)
      const vz = wz * drift + (swirl ? Math.cos(t * (0.7 + s) + s * 21) * swirl : 0)
      pos[o] = wrap(pos[o] + vx * dt, cam.x, HALF_XZ)
      pos[o + 1] = wrap(pos[o + 1] + vel[v + 1] * dt, cam.y, HALF_Y)
      pos[o + 2] = wrap(pos[o + 2] + vz * dt, cam.z, HALF_XZ)
      if (stride === 2) {
        // the streak trails behind the drop along its own velocity
        const len = 0.018
        pos[o + 3] = pos[o] - vx * len
        pos[o + 4] = pos[o + 1] - vel[v + 1] * len
        pos[o + 5] = pos[o + 2] - vz * len
      }
    }
    this.attr.needsUpdate = true
  }

  /** Show only as many particles as the weather calls for. */
  setAmount(a: number) {
    this.geometry.setDrawRange(0, Math.round(this.count * Math.min(1, a)) * this.stride)
  }
}

const flakeVert = /* glsl */ `
  uniform float uSize;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (300.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`
const flakeFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.15, d) * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`

/** Rain, snow and ash falling around the camera. */
function Falling() {
  const camera = useThree((s) => s.camera)
  const quality = useSettingsStore((s) => s.quality)
  const n = byQuality(quality, { low: 480, medium: 1100, high: 2200, ultra: 2200 })

  const systems = useMemo(
    () => ({
      rain: new Fall('rain', n),
      snow: new Fall('snow', Math.round(n * 0.75)),
      ash: new Fall('ash', Math.round(n * 0.6)),
    }),
    [n],
  )
  const rainMat = useMemo(
    () => new THREE.LineBasicMaterial({ color: '#cfe2f2', transparent: true, opacity: 0, depthWrite: false, fog: false }),
    [],
  )
  const flake = (color: string, size: number) =>
    new THREE.ShaderMaterial({
      vertexShader: flakeVert,
      fragmentShader: flakeFrag,
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 }, uSize: { value: size } },
      transparent: true,
      depthWrite: false,
    })
  const snowMat = useMemo(() => flake('#ffffff', 1.15), [])
  const ashMat = useMemo(() => flake('#59514d', 0.65), [])

  const objects = useMemo(() => {
    const rain = new THREE.LineSegments(systems.rain.geometry, rainMat)
    const snow = new THREE.Points(systems.snow.geometry, snowMat)
    const ash = new THREE.Points(systems.ash.geometry, ashMat)
    for (const o of [rain, snow, ash]) {
      o.frustumCulled = false
      o.renderOrder = 6
    }
    return { rain, snow, ash }
  }, [systems, rainMat, snowMat, ashMat])

  useEffect(
    () => () => {
      for (const s of Object.values(systems)) s.geometry.dispose()
      rainMat.dispose()
      snowMat.dispose()
      ashMat.dispose()
    },
    [systems, rainMat, snowMat, ashMat],
  )

  const time = useRef(0)

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    time.current += dt
    const w = weatherLook()
    // the light on falling water and snow follows the sky
    const lit = 0.35 + 0.65 * timeState.lightMul
    const amounts: [Kind, number][] = [
      ['rain', w.rain],
      ['snow', w.snow],
      ['ash', w.ash],
    ]
    for (const [kind, amount] of amounts) {
      const obj = objects[kind]
      obj.visible = amount > 0.01
      if (!obj.visible) continue
      const sys = systems[kind]
      sys.setAmount(amount)
      sys.update(dt, camera.position, w.windX, w.windZ, time.current)
      if (kind === 'rain') rainMat.opacity = Math.min(0.5, amount * 0.45) * lit
      else {
        const m = kind === 'snow' ? snowMat : ashMat
        m.uniforms.uOpacity.value = Math.min(0.95, amount) * (kind === 'snow' ? lit : 0.75)
      }
    }
  })

  return (
    <group name="falling">
      <primitive object={objects.rain} />
      <primitive object={objects.snow} />
      <primitive object={objects.ash} />
    </group>
  )
}

const mistVert = /* glsl */ `
  uniform sampler2D uHeight;
  uniform vec2 uGrid; // heightfield pixels (width, height)
  uniform float uCell; // metres per pixel
  uniform float uSeaLevel;
  uniform float uLift;
  uniform float uTime;
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    // lie on the land: the sheet takes the ground's own shape, so mist pools in the hollows
    // pixel i is the terrain vertex at i * cell, and texel i is centred at (i + 0.5) / width
    float ground = texture2D(uHeight, (wp.xz / uCell + 0.5) / uGrid).r;
    ground = max(ground, uSeaLevel);
    wp.y = ground + uLift + sin(wp.x * 0.04 + uTime * 0.2) * 0.5 + cos(wp.z * 0.035 - uTime * 0.17) * 0.5;
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
const mistFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAmount;
  uniform float uTime;
  uniform float uRadius;
  uniform vec3 uCentre;
  uniform float uDrift;
  varying vec3 vWorld;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }

  void main() {
    vec2 q = vWorld.xz * 0.018 + vec2(uTime * uDrift, uTime * uDrift * 0.6);
    float n = noise(q) * 0.6 + noise(q * 2.3 + 11.0) * 0.3 + noise(q * 5.1) * 0.1;
    float a = smoothstep(0.34, 0.78, n) * uAmount;
    // fade out at the rim of the sheet and right next to the camera
    a *= 1.0 - smoothstep(uRadius * 0.55, uRadius, length(vWorld.xz - uCentre.xz));
    a *= smoothstep(1.5, 7.0, distance(vWorld, cameraPosition));
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`

const MIST_SIZE = 300
const WHITE = new THREE.Color(1, 1, 1)

/**
 * Two sheets of low mist that take the shape of the land and follow the traveller. They carry
 * both the weather's mist and a place's own luminous ground haze, whichever is thicker.
 */
function Mist() {
  const { meta, heightfield } = useWorld()
  const camera = useThree((s) => s.camera)
  const group = useRef<THREE.Group>(null)

  const heightTex = useMemo(() => {
    const tex = new THREE.DataTexture(heightfield.data, heightfield.width, heightfield.height, THREE.RedFormat, THREE.FloatType)
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = false
    tex.needsUpdate = true
    return tex
  }, [heightfield])
  useEffect(() => onTerrainEdit(() => void (heightTex.needsUpdate = true)), [heightTex])
  useEffect(() => () => heightTex.dispose(), [heightTex])

  const layers = useMemo(
    () =>
      [
        { lift: 1.1, drift: 0.006, alpha: 1.0 },
        { lift: 3.4, drift: 0.011, alpha: 0.7 },
      ].map((l) => ({
        ...l,
        material: new THREE.ShaderMaterial({
          vertexShader: mistVert,
          fragmentShader: mistFrag,
          uniforms: {
            uHeight: { value: heightTex },
            uGrid: { value: new THREE.Vector2(heightfield.width, heightfield.height) },
            uCell: { value: heightfield.cell },
            uSeaLevel: { value: meta.seaLevel },
            uLift: { value: l.lift },
            uTime: { value: 0 },
            uColor: { value: new THREE.Color('#eef3f7') },
            uAmount: { value: 0 },
            uRadius: { value: MIST_SIZE / 2 },
            uCentre: { value: new THREE.Vector3() },
            uDrift: { value: l.drift },
          },
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      })),
    [heightTex, heightfield, meta.seaLevel],
  )
  useEffect(() => () => layers.forEach((l) => l.material.dispose()), [layers])
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(MIST_SIZE, MIST_SIZE, 64, 64)
    g.rotateX(-Math.PI / 2)
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
    return g
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame((_, dt) => {
    const w = weatherLook()
    const haze = auraMix.ground()
    const thickness = Math.max(w.mist, haze)
    const g = group.current
    const on = thickness > 0.01
    if (g) {
      g.visible = on
      // keep the sheet centred on the traveller, snapped so its own noise does not swim
      g.position.set(Math.round(camera.position.x / 8) * 8, 0, Math.round(camera.position.z / 8) * 8)
    }
    if (!on) return
    for (const l of layers) {
      const u = l.material.uniforms
      u.uTime.value += Math.min(dt, 0.05)
      // a place's own haze glows a little in its own colour rather than dimming with the day
      u.uAmount.value = l.alpha * (w.mist * (0.55 + 0.45 * timeState.lightMul) + haze * 0.6)
      u.uColor.value
        .copy(FOG_COLOR)
        .lerp(WHITE, 0.35 * (1 - w.gloom))
        .lerp(w.tint, w.gloom * 0.5)
        .lerp(auraState.air, Math.min(0.9, haze * 1.4))
      u.uCentre.value.copy(g?.position ?? camera.position)
    }
  })

  return (
    <group ref={group} name="mist">
      {layers.map((l, i) => (
        <mesh key={i} geometry={geometry} material={l.material} renderOrder={5} />
      ))}
    </group>
  )
}

/** Everything you can see of the weather. `mist` is flat-world only (it samples the height map). */
export function WeatherFx({ mist = true }: { mist?: boolean }) {
  return (
    <>
      <Falling />
      {mist && <Mist />}
    </>
  )
}
