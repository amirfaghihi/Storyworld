import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useWorld } from '@/world/WorldContext'
import { playerState, useSettingsStore, byQuality } from '@/store/stores'
import { hash2 } from '@/terrain/faceColors'
import { chimneyTop } from '@/dressing/placeKinds'
import { makePropContext } from '@/dressing/propUtil'
import { useTerrainVersion } from '@/editor/useTerrainVersion'
import { useEditorStore } from '@/editor/editorStore'
import { timeState } from './timeOfDay'
import { AURAS, auraState } from './auras'

type Kind = 'smoke' | 'embers' | 'fireflies' | 'leaves' | 'candles' | 'dust' | 'wisp' | 'spore'

interface EmitterDef {
  kind: Kind
  x: number
  y: number
  z: number
  radius: number
  count: number
  color: THREE.Color
  color2?: THREE.Color
  scale: number
  /** motes belonging to a landmark's aura: only drawn while that aura is in force */
  aura?: string
}

const vert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (420.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`
const frag = /* glsl */ `
  uniform float uHdr;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.12, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * uHdr, a);
    #include <colorspace_fragment>
  }
`

class Emitter {
  pos: Float32Array
  vel: Float32Array
  life: Float32Array
  maxLife: Float32Array
  seed: Float32Array
  size: Float32Array
  alpha: Float32Array
  color: Float32Array
  geometry: THREE.BufferGeometry
  constructor(readonly def: EmitterDef) {
    const n = def.count
    this.pos = new Float32Array(n * 3)
    this.vel = new Float32Array(n * 3)
    this.life = new Float32Array(n)
    this.maxLife = new Float32Array(n)
    this.seed = new Float32Array(n)
    this.size = new Float32Array(n)
    this.alpha = new Float32Array(n)
    this.color = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      this.seed[i] = hash2(i, def.x)
      this.spawn(i, true)
    }
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3))
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(def.x, def.y, def.z), def.radius + 80)
  }

  spawn(i: number, initial = false) {
    const d = this.def
    const r = () => Math.random()
    const a = r() * Math.PI * 2
    const rad = Math.sqrt(r()) * d.radius
    let x = d.x + Math.cos(a) * rad
    let z = d.z + Math.sin(a) * rad
    let y = d.y
    const c = d.color2 && r() > 0.5 ? d.color2 : d.color
    this.color[i * 3] = c.r
    this.color[i * 3 + 1] = c.g
    this.color[i * 3 + 2] = c.b
    switch (d.kind) {
      case 'smoke':
        this.vel.set([(r() - 0.5) * 0.6, (1.0 + r() * 1.6) * d.scale, (r() - 0.5) * 0.6], i * 3)
        this.maxLife[i] = 5 + r() * 5
        break
      case 'embers':
        this.vel.set([(r() - 0.5) * 3, 3 + r() * 5, (r() - 0.5) * 3], i * 3)
        this.maxLife[i] = 1.5 + r() * 2.5
        break
      case 'fireflies':
        y = d.y + r() * 6
        this.vel.set([(r() - 0.5), (r() - 0.5) * 0.4, (r() - 0.5)], i * 3)
        this.maxLife[i] = 4 + r() * 6
        break
      case 'leaves':
        y = d.y + 6 + r() * 9
        this.vel.set([(r() - 0.5) * 0.8, -0.6 - r() * 0.6, (r() - 0.5) * 0.8], i * 3)
        this.maxLife[i] = 8 + r() * 6
        break
      case 'candles':
        y = d.y + 0.6 + r() * 1.2
        this.vel.set([0, 0, 0], i * 3)
        this.maxLife[i] = 6 + r() * 6
        break
      case 'dust':
        // motes of light hanging in the air, drifting barely at all
        y = d.y + 0.4 + r() * d.scale
        this.vel.set([(r() - 0.5) * 0.25, (r() - 0.35) * 0.12, (r() - 0.5) * 0.25], i * 3)
        this.maxLife[i] = 9 + r() * 9
        break
      case 'wisp':
        y = d.y + 0.5 + r() * d.scale
        this.vel.set([0, 0, 0], i * 3)
        this.maxLife[i] = 10 + r() * 10
        break
      case 'spore':
        y = d.y + r() * d.scale
        this.vel.set([(r() - 0.5) * 0.4, -0.08 - r() * 0.14, (r() - 0.5) * 0.4], i * 3)
        this.maxLife[i] = 12 + r() * 10
        break
    }
    this.pos.set([x, y, z], i * 3)
    this.life[i] = initial ? r() * this.maxLife[i] : 0
  }

  update(dt: number, t: number) {
    const d = this.def
    const n = d.count
    for (let i = 0; i < n; i++) {
      this.life[i] += dt
      if (this.life[i] >= this.maxLife[i]) this.spawn(i)
      const k = this.life[i] / this.maxLife[i]
      const o = i * 3
      switch (d.kind) {
        case 'smoke': {
          this.vel[o] += Math.sin(t * 0.7 + this.seed[i] * 10) * 0.15 * dt + 0.25 * dt
          this.vel[o + 2] += Math.cos(t * 0.6 + this.seed[i] * 7) * 0.15 * dt + 0.1 * dt
          this.size[i] = (2 + k * 9) * d.scale
          this.alpha[i] = 0.32 * Math.sin(k * Math.PI)
          break
        }
        case 'embers':
          this.vel[o + 1] -= 1.5 * dt
          this.size[i] = 0.9 * (1 - k) + 0.2
          this.alpha[i] = 1 - k * k
          break
        case 'fireflies': {
          this.vel[o] += (Math.random() - 0.5) * 1.5 * dt
          this.vel[o + 1] += (Math.random() - 0.5) * 0.8 * dt
          this.vel[o + 2] += (Math.random() - 0.5) * 1.5 * dt
          const sp = Math.hypot(this.vel[o], this.vel[o + 1], this.vel[o + 2])
          if (sp > 1.2) { this.vel[o] *= 1.2 / sp; this.vel[o + 1] *= 1.2 / sp; this.vel[o + 2] *= 1.2 / sp }
          this.size[i] = 0.45
          this.alpha[i] = Math.max(0, Math.sin(t * 2.2 + this.seed[i] * 20)) * Math.sin(k * Math.PI)
          break
        }
        case 'leaves':
          this.vel[o] = Math.sin(t * 1.3 + this.seed[i] * 9) * 0.9
          this.vel[o + 2] = Math.cos(t * 1.1 + this.seed[i] * 5) * 0.9
          this.size[i] = 0.5
          this.alpha[i] = Math.min(1, k * 6) * (1 - Math.max(0, (k - 0.85) / 0.15))
          break
        case 'candles':
          this.size[i] = 1.1 + 0.3 * Math.sin(t * 5 + this.seed[i] * 30)
          this.alpha[i] = (0.5 + 0.5 * Math.sin(t * 1.7 + this.seed[i] * 40)) * Math.sin(k * Math.PI)
          break
        case 'dust': {
          const s = this.seed[i]
          this.vel[o] = Math.sin(t * 0.35 + s * 24) * 0.22
          this.vel[o + 1] = Math.sin(t * 0.27 + s * 11) * 0.14
          this.vel[o + 2] = Math.cos(t * 0.31 + s * 17) * 0.22
          this.size[i] = 0.24 + 0.14 * s
          this.alpha[i] = Math.sin(k * Math.PI) * (0.45 + 0.55 * Math.abs(Math.sin(t * 0.9 + s * 30)))
          break
        }
        case 'wisp': {
          // a lazy circle, drifting: a light that seems to be going somewhere of its own
          const s = this.seed[i]
          const sp = 0.3 + s * 0.3
          this.vel[o] = Math.cos(t * sp + s * 40) * (1.1 + s)
          this.vel[o + 1] = Math.sin(t * 0.5 + s * 13) * 0.3
          this.vel[o + 2] = Math.sin(t * sp + s * 40) * (1.1 + s)
          this.size[i] = 0.8 + 0.35 * Math.sin(t * 1.3 + s * 50)
          this.alpha[i] = Math.sin(k * Math.PI) * (0.35 + 0.65 * Math.max(0, Math.sin(t * 0.6 + s * 22)))
          break
        }
        case 'spore': {
          const s = this.seed[i]
          this.vel[o] = Math.sin(t * 0.5 + s * 19) * 0.35
          this.vel[o + 2] = Math.cos(t * 0.42 + s * 27) * 0.35
          this.size[i] = 0.2 + 0.18 * s
          this.alpha[i] = Math.sin(k * Math.PI) * 0.55
          break
        }
      }
      this.pos[o] += this.vel[o] * dt
      this.pos[o + 1] += this.vel[o + 1] * dt
      this.pos[o + 2] += this.vel[o + 2] * dt
    }
    ;(this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(this.geometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true
    ;(this.geometry.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true
  }
}

/** Emitters derived from the landmark dressings: smoke, embers, fireflies, falling leaves, marsh lights. */
function deriveEmitters(world: ReturnType<typeof useWorld>, density: number): EmitterDef[] {
  const { meta, surface } = world
  const out: EmitterDef[] = []
  // the drawn ground, so motes and smoke start where the terrain and the props are
  const g = (x: number, z: number) => surface.height(x, z)
  const C = (s: string) => new THREE.Color(s)
  for (const lm of meta.landmarks) {
    const d = lm.dressing
    if (!d) continue
    const [lx, lz] = lm.position
    for (const [i, p] of d.props.entries()) {
      const x = lx + p.offset[0], z = lz + p.offset[1]
      if (p.kind === 'smoke') {
        out.push({ kind: 'smoke', x, y: g(x, z) + 34, z, radius: 6, count: Math.round(160 * density), color: C('#3a3236'), color2: C('#5a5058'), scale: 2.2 })
        out.push({ kind: 'embers', x, y: g(x, z) + 30, z, radius: 6, count: Math.round(120 * density), color: C('#ff8a2a'), color2: C('#ffd070'), scale: 1 })
      } else if (p.kind === 'lavaGlow') {
        out.push({ kind: 'embers', x, y: g(x, z) + 6, z, radius: 22, count: Math.round(90 * density), color: C('#ff6a1a'), color2: C('#ffb347'), scale: 1 })
      } else if (p.kind === 'hobbitHole') {
        out.push({ kind: 'smoke', x, y: g(x, z) + 3.4, z, radius: 0.3, count: Math.round(22 * density), color: C('#d8d8dc'), color2: C('#c8c4c0'), scale: 0.35 })
      } else if (p.kind === 'candles') {
        const r = typeof p.params.radius === 'number' ? p.params.radius : 25
        out.push({ kind: 'candles', x, y: g(x, z), z, radius: r, count: Math.round(50 * density), color: C('#9fd8ff'), color2: C('#cfe8ff'), scale: 1 })
      } else if (p.kind === 'pits') {
        out.push({ kind: 'smoke', x, y: g(x, z) + 4, z, radius: 18, count: Math.round(70 * density), color: C('#4a4046'), color2: C('#6a6068'), scale: 0.9 })
      } else {
        // chimney smoke starts just above the chimney the builder drew: same context (and so the
        // same ground, floor and seed) as buildProps gives the piece
        const top = chimneyTop(p.kind, makePropContext(lm, p, surface, meta.seaLevel, meta.seed + i))
        if (top) out.push({ kind: 'smoke', x: top[0], y: top[1] + 0.4, z: top[2], radius: 0.25, count: Math.round(26 * density), color: C('#e4e2de'), color2: C('#cfcbc6'), scale: 0.3 })
      }
    }
    // motes belonging to the place's own air
    const aura = d.aura ? AURAS[d.aura] : undefined
    if (aura?.motes) {
      const m = aura.motes
      out.push({
        kind: m.kind,
        x: lx,
        y: g(lx, lz),
        z: lz,
        radius: d.radius * 1.25,
        count: Math.round(m.count * density),
        color: C(m.color),
        color2: m.color2 ? C(m.color2) : undefined,
        scale: m.height,
        aura: lm.id,
      })
    }
    if (d.vegetation?.palette === 'golden') {
      out.push({ kind: 'fireflies', x: lx, y: g(lx, lz) + 1.5, z: lz, radius: d.radius * 0.6, count: Math.round(140 * density), color: C('#e8ff9a'), color2: C('#fff1a8'), scale: 1 })
      out.push({ kind: 'leaves', x: lx, y: g(lx, lz), z: lz, radius: d.radius * 0.7, count: Math.round(90 * density), color: C('#e0b43a'), color2: C('#f2d060'), scale: 1 })
    } else if (d.vegetation?.palette === 'dark' || d.vegetation?.palette === 'willow') {
      out.push({ kind: 'leaves', x: lx, y: g(lx, lz), z: lz, radius: d.radius * 0.7, count: Math.round(70 * density), color: C('#7fb85a'), color2: C('#a3c24a'), scale: 1 })
    }
  }
  return out
}

export function Particles() {
  const world = useWorld()
  const quality = useSettingsStore((s) => s.quality)
  const density = byQuality(quality, { low: 0.3, medium: 0.6, high: 1, ultra: 1 })
  // rebuilt when the props are (LandmarkProps): a terrain stroke or a moved piece moves its chimney
  const terrainVersion = useTerrainVersion()
  const revision = useEditorStore((s) => s.revision)
  const emitters = useMemo(
    () => deriveEmitters(world, density).map((d) => new Emitter(d)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world, density, terrainVersion, revision],
  )
  const additive = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: { uHdr: { value: 1.9 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    [],
  )
  const normal = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: { uHdr: { value: 1.0 } }, transparent: true, depthWrite: false }),
    [],
  )
  const points = useMemo(
    () =>
      emitters.map((e) => {
        const m = new THREE.Points(e.geometry, e.def.kind === 'smoke' || e.def.kind === 'leaves' || e.def.kind === 'spore' ? normal : additive)
        m.frustumCulled = true
        return m
      }),
    [emitters, additive, normal],
  )
  const time = useRef(0)
  useEffect(() => () => emitters.forEach((e) => e.geometry.dispose()), [emitters])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    time.current += dt
    const p = playerState.position
    additive.uniforms.uHdr.value = 1.5 + timeState.lamp * 1.8
    // smoke and leaves are lit by the sun, so they go dark with it and with the weather
    normal.uniforms.uHdr.value = (0.28 + 0.72 * timeState.day) * (1 - 0.4 * timeState.gloom)
    emitters.forEach((e, i) => {
      // only simulate emitters near enough to be seen
      const d = Math.hypot(e.def.x - p.x, e.def.z - p.z)
      // fireflies and candles come out at dusk
      const nocturnal = e.def.kind === 'fireflies' || e.def.kind === 'candles'
      // motes only exist while their own aura is in force
      const inAura = !e.def.aura || (auraState.id === e.def.aura && auraState.strength > 0.03)
      const visible = d < 420 + e.def.radius && inAura && (!nocturnal || timeState.lamp > 0.12)
      points[i].visible = visible
      if (visible) e.update(dt, time.current)
    })
  })

  return (
    <group name="particles">
      {points.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  )
}
