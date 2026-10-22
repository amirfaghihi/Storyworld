import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { useWorld } from '@/world/WorldContext'
import { useSettingsStore, byQuality, atLeast } from '@/store/stores'
import { getGradientMap } from '@/render/gradientMap'
import { scatter, type Instance, type ScatterResult } from './scatter'
import { extractPlaceFeatures } from '@/map2d/placeFeatures'
import { vegOverrides } from '@/dressing/ground'
import { applyExtensions } from '@/render/shaderExt'
import { timeState } from '@/render/timeOfDay'
import { auraMix } from '@/render/auras'
import { useTerrainVersion } from '@/editor/useTerrainVersion'
import { setColliderLayer, clearColliderLayer, type Collider } from '@/player/collision'

/**
 * Merge parts into one geometry with per-vertex colours. Parts with colour '#ffffff' take the
 * instance colour fully, so a canopy can be tinted per tree while a trunk stays brown.
 */
function coloured(parts: { geo: THREE.BufferGeometry; color: string; y?: number; scale?: number }[]): THREE.BufferGeometry {
  const geos = parts.map(({ geo, color, y = 0, scale = 1 }) => {
    const g = geo.index ? geo.toNonIndexed() : geo
    g.scale(scale, scale, scale)
    g.translate(0, y, 0)
    const c = new THREE.Color(color)
    const arr = new Float32Array(g.attributes.position.count * 3)
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = c.r
      arr[i + 1] = c.g
      arr[i + 2] = c.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    g.deleteAttribute('uv')
    return g
  })
  const merged = mergeGeometries(geos, false)!
  merged.computeVertexNormals()
  geos.forEach((g) => g.dispose())
  return merged
}

const TALL = 4.2 // extra trunk height for forest-interior trees (metres before instance scale)

export function makeGeometries() {
  return {
    trunk: coloured([{ geo: new THREE.CylinderGeometry(0.22, 0.32, 1.6, 5), color: '#ffffff', y: 0.8 }]),
    // forest interior: a real trunk you can walk between, with roots, canopy lifted by TALL
    tallTrunk: coloured([
      { geo: new THREE.CylinderGeometry(0.26, 0.42, 1.6 + TALL, 6), color: '#ffffff', y: (1.6 + TALL) / 2 },
      { geo: new THREE.CylinderGeometry(0.2, 0.55, 0.9, 5).translate(0.35, 0, 0.1), color: '#e6e6e6', y: 0.4 },
      { geo: new THREE.CylinderGeometry(0.18, 0.5, 0.8, 5).translate(-0.3, 0, -0.25), color: '#e6e6e6', y: 0.35 },
    ]),
    tallPine: coloured([
      { geo: new THREE.ConeGeometry(1.7, 2.8, 6), color: '#d9d9d9', y: 2.4 + TALL },
      { geo: new THREE.ConeGeometry(1.25, 2.4, 6), color: '#f0f0f0', y: 3.9 + TALL },
      { geo: new THREE.ConeGeometry(0.8, 2.0, 6), color: '#ffffff', y: 5.3 + TALL },
    ]),
    tallRound: coloured([
      { geo: new THREE.DodecahedronGeometry(2.1, 0), color: '#e0e0e0', y: 2.9 + TALL },
      { geo: new THREE.DodecahedronGeometry(1.3, 0).translate(0.9, 0.6, 0.5), color: '#ffffff', y: 3.4 + TALL },
      { geo: new THREE.DodecahedronGeometry(1.1, 0).translate(-0.9, 0.3, -0.7), color: '#f4f4f4', y: 3.2 + TALL },
    ]),
    fir: coloured([
      { geo: new THREE.ConeGeometry(1.1, 3.2, 6), color: '#d4d4d4', y: 2.4 },
      { geo: new THREE.ConeGeometry(0.85, 2.8, 6), color: '#e8e8e8', y: 3.9 },
      { geo: new THREE.ConeGeometry(0.6, 2.4, 6), color: '#f4f4f4', y: 5.3 },
      { geo: new THREE.ConeGeometry(0.35, 1.8, 5), color: '#ffffff', y: 6.6 },
    ]),
    tallFir: coloured([
      { geo: new THREE.ConeGeometry(1.3, 3.6, 6), color: '#d4d4d4', y: 2.4 + TALL },
      { geo: new THREE.ConeGeometry(1.0, 3.2, 6), color: '#e8e8e8', y: 4.1 + TALL },
      { geo: new THREE.ConeGeometry(0.7, 2.8, 6), color: '#f4f4f4', y: 5.7 + TALL },
      { geo: new THREE.ConeGeometry(0.4, 2.0, 5), color: '#ffffff', y: 7.2 + TALL },
    ]),
    // broad oak: several blobs spreading wide
    oak: coloured([
      { geo: new THREE.DodecahedronGeometry(1.5, 0).translate(0, 0, 0), color: '#e0e0e0', y: 3.0 },
      { geo: new THREE.DodecahedronGeometry(1.25, 0).translate(1.5, -0.2, 0.4), color: '#f0f0f0', y: 3.0 },
      { geo: new THREE.DodecahedronGeometry(1.2, 0).translate(-1.4, -0.1, -0.5), color: '#ffffff', y: 3.1 },
      { geo: new THREE.DodecahedronGeometry(1.1, 0).translate(0.3, 1.0, -0.9), color: '#f6f6f6', y: 3.4 },
      { geo: new THREE.DodecahedronGeometry(1.0, 0).translate(-0.2, 0.9, 1.1), color: '#e8e8e8', y: 3.4 },
    ]),
    tallOak: coloured([
      { geo: new THREE.DodecahedronGeometry(2.2, 0), color: '#e0e0e0', y: 3.2 + TALL },
      { geo: new THREE.DodecahedronGeometry(1.7, 0).translate(2.3, -0.3, 0.6), color: '#f0f0f0', y: 3.2 + TALL },
      { geo: new THREE.DodecahedronGeometry(1.6, 0).translate(-2.1, -0.2, -0.8), color: '#ffffff', y: 3.3 + TALL },
      { geo: new THREE.DodecahedronGeometry(1.5, 0).translate(0.4, 1.5, -1.6), color: '#f6f6f6', y: 3.6 + TALL },
      { geo: new THREE.DodecahedronGeometry(1.4, 0).translate(-0.3, 1.3, 1.8), color: '#e8e8e8', y: 3.6 + TALL },
      // boughs
      { geo: new THREE.CylinderGeometry(0.12, 0.28, 2.6, 5).rotateZ(1.0).translate(1.2, 0, 0.3), color: '#7a6a5a', y: 1.2 + TALL },
      { geo: new THREE.CylinderGeometry(0.12, 0.28, 2.4, 5).rotateZ(-1.05).translate(-1.1, 0, -0.4), color: '#7a6a5a', y: 1.3 + TALL },
    ]),
    // birch: slim white trunk, small light canopy
    birch: coloured([
      { geo: new THREE.CylinderGeometry(0.1, 0.16, 3.2, 5), color: '#ffffff', y: 1.6 },
      { geo: new THREE.BoxGeometry(0.22, 0.06, 0.06).translate(0, 0, 0.1), color: '#3a3a3a', y: 1.2 },
      { geo: new THREE.BoxGeometry(0.06, 0.06, 0.22).translate(0.1, 0, 0), color: '#3a3a3a', y: 2.1 },
    ]),
    birchCanopy: coloured([
      { geo: new THREE.DodecahedronGeometry(0.9, 0), color: '#e8e8e8', y: 3.6 },
      { geo: new THREE.DodecahedronGeometry(0.7, 0).translate(0.4, 0.7, 0.2), color: '#ffffff', y: 3.8 },
      { geo: new THREE.DodecahedronGeometry(0.6, 0).translate(-0.4, 0.4, -0.3), color: '#f4f4f4', y: 3.7 },
    ]),
    tallBirch: coloured([
      { geo: new THREE.CylinderGeometry(0.12, 0.2, 3.2 + TALL, 5), color: '#ffffff', y: (3.2 + TALL) / 2 },
      { geo: new THREE.BoxGeometry(0.28, 0.07, 0.07).translate(0, 0, 0.12), color: '#3a3a3a', y: 1.4 },
      { geo: new THREE.BoxGeometry(0.07, 0.07, 0.28).translate(0.12, 0, 0), color: '#3a3a3a', y: 3.1 },
      { geo: new THREE.BoxGeometry(0.28, 0.07, 0.07).translate(-0.02, 0, -0.12), color: '#3a3a3a', y: 4.9 },
    ]),
    tallBirchCanopy: coloured([
      { geo: new THREE.DodecahedronGeometry(1.2, 0), color: '#e8e8e8', y: 3.6 + TALL },
      { geo: new THREE.DodecahedronGeometry(0.9, 0).translate(0.6, 0.9, 0.3), color: '#ffffff', y: 3.9 + TALL },
      { geo: new THREE.DodecahedronGeometry(0.8, 0).translate(-0.6, 0.5, -0.4), color: '#f4f4f4', y: 3.8 + TALL },
    ]),
    // mountain crag: a leaning spire of rock
    crag: coloured([
      { geo: new THREE.ConeGeometry(1.4, 5.5, 5).rotateZ(0.12), color: '#ffffff', y: 2.4 },
      { geo: new THREE.ConeGeometry(0.9, 3.6, 5).rotateZ(-0.2).translate(1.1, 0, 0.5), color: '#e8e8e8', y: 1.6 },
      { geo: new THREE.DodecahedronGeometry(0.9, 0).translate(-0.9, 0, -0.6), color: '#d8d8d8', y: 0.5 },
    ]),
    // undergrowth
    fern: coloured([
      { geo: new THREE.ConeGeometry(0.9, 0.25, 7).rotateX(Math.PI), color: '#ffffff', y: 0.55 },
      { geo: new THREE.ConeGeometry(0.6, 0.2, 6).rotateX(Math.PI), color: '#e8e8e8', y: 0.75 },
      { geo: new THREE.CylinderGeometry(0.03, 0.05, 0.6, 4), color: '#6a8a3a', y: 0.3 },
    ]),
    log: coloured([
      { geo: new THREE.CylinderGeometry(0.28, 0.34, 3.2, 6).rotateZ(Math.PI / 2), color: '#ffffff', y: 0.3 },
      { geo: new THREE.CylinderGeometry(0.34, 0.34, 0.12, 6).rotateZ(Math.PI / 2).translate(1.6, 0, 0), color: '#c9a878', y: 0.3 },
      { geo: new THREE.IcosahedronGeometry(0.3, 0).translate(-0.6, 0.2, 0.1), color: '#4f8a3a', y: 0.45 },
    ]),
    mushroom: coloured([
      { geo: new THREE.CylinderGeometry(0.08, 0.1, 0.35, 5), color: '#f0e6d2', y: 0.17 },
      { geo: new THREE.SphereGeometry(0.26, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), color: '#ffffff', y: 0.32 },
      { geo: new THREE.CylinderGeometry(0.05, 0.07, 0.22, 5).translate(0.32, 0, 0.1), color: '#f0e6d2', y: 0.11 },
      { geo: new THREE.SphereGeometry(0.16, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0.32, 0, 0.1), color: '#ffffff', y: 0.2 },
    ]),
    // mallorn: a slim silver bole holding a wide, layered crown of gold well above the ground
    mallorn: coloured([
      { geo: new THREE.DodecahedronGeometry(2.0, 0).scale(1.25, 0.42, 1.25), color: '#dcdcdc', y: 3.5 },
      { geo: new THREE.DodecahedronGeometry(1.5, 0).scale(1.2, 0.45, 1.2), color: '#f2f2f2', y: 4.5 },
      { geo: new THREE.DodecahedronGeometry(0.95, 0).scale(1.15, 0.5, 1.15), color: '#ffffff', y: 5.3 },
    ]),
    tallMallorn: coloured([
      { geo: new THREE.DodecahedronGeometry(3.0, 0).scale(1.3, 0.38, 1.3), color: '#d8d8d8', y: 3.4 + TALL },
      { geo: new THREE.DodecahedronGeometry(2.3, 0).scale(1.28, 0.42, 1.28), color: '#ededed', y: 5.0 + TALL },
      { geo: new THREE.DodecahedronGeometry(1.6, 0).scale(1.22, 0.46, 1.22), color: '#f8f8f8', y: 6.3 + TALL },
      { geo: new THREE.DodecahedronGeometry(1.0, 0).scale(1.1, 0.5, 1.1), color: '#ffffff', y: 7.3 + TALL },
      // boughs reaching out under the lowest tier, pale as the bark
      { geo: new THREE.CylinderGeometry(0.1, 0.24, 3.0, 5).rotateZ(1.15).translate(1.4, 0, 0.2), color: '#c8c8d0', y: 2.7 + TALL },
      { geo: new THREE.CylinderGeometry(0.1, 0.24, 2.8, 5).rotateZ(-1.2).translate(-1.3, 0, -0.5), color: '#c8c8d0', y: 2.9 + TALL },
    ]),
    // luminous mushrooms: a dark stalk and caps that take the instance colour and burn
    glowcap: coloured([
      { geo: new THREE.CylinderGeometry(0.05, 0.08, 0.4, 5), color: '#2a3630', y: 0.2 },
      { geo: new THREE.SphereGeometry(0.22, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), color: '#ffffff', y: 0.38 },
      { geo: new THREE.CylinderGeometry(0.04, 0.06, 0.26, 4).translate(0.26, 0, 0.12), color: '#2a3630', y: 0.13 },
      { geo: new THREE.SphereGeometry(0.14, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0.26, 0, 0.12), color: '#ffffff', y: 0.24 },
      { geo: new THREE.SphereGeometry(0.1, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(-0.22, 0, -0.16), color: '#ffffff', y: 0.16 },
    ]),
    // canopies are white so the instance colour defines the hue; slightly darker lower tiers
    pine: coloured([
      { geo: new THREE.ConeGeometry(1.5, 2.6, 6), color: '#d9d9d9', y: 2.4 },
      { geo: new THREE.ConeGeometry(1.1, 2.2, 6), color: '#f0f0f0', y: 3.9 },
      { geo: new THREE.ConeGeometry(0.7, 1.8, 6), color: '#ffffff', y: 5.2 },
    ]),
    round: coloured([
      { geo: new THREE.DodecahedronGeometry(1.6, 0), color: '#e0e0e0', y: 2.7 },
      { geo: new THREE.DodecahedronGeometry(1.0, 0).translate(0.5, 0.5, 0.3), color: '#ffffff', y: 3.3 },
    ]),
    dead: coloured([
      { geo: new THREE.CylinderGeometry(0.12, 0.3, 3.2, 5), color: '#ffffff', y: 1.6 },
      { geo: new THREE.CylinderGeometry(0.06, 0.12, 1.4, 4).rotateZ(0.9).translate(0.5, 0, 0), color: '#ffffff', y: 2.6 },
      { geo: new THREE.CylinderGeometry(0.05, 0.1, 1.1, 4).rotateZ(-1.1).translate(-0.4, 0, 0), color: '#ffffff', y: 2.2 },
    ]),
    rock: coloured([{ geo: new THREE.DodecahedronGeometry(1.0, 0).scale(1, 0.7, 1), color: '#ffffff', y: 0.35 }]),
    bush: coloured([
      { geo: new THREE.IcosahedronGeometry(0.8, 0).scale(1, 0.7, 1), color: '#ffffff', y: 0.4 },
      { geo: new THREE.IcosahedronGeometry(0.5, 0).translate(0.55, 0.1, 0.2), color: '#e8e8e8', y: 0.4 },
    ]),
    // a flower cluster: green base + coloured heads
    flower: coloured([
      { geo: new THREE.IcosahedronGeometry(0.45, 0).scale(1, 0.5, 1), color: '#6fae4a', y: 0.15 },
      { geo: new THREE.DodecahedronGeometry(0.18, 0).translate(0.15, 0, 0.1), color: '#ffffff', y: 0.45 },
      { geo: new THREE.DodecahedronGeometry(0.15, 0).translate(-0.2, 0, -0.05), color: '#ffffff', y: 0.4 },
      { geo: new THREE.DodecahedronGeometry(0.16, 0).translate(0.02, 0, -0.22), color: '#ffffff', y: 0.5 },
    ]),
  }
}

/** Colour families per type. `grove` picks the family, `tint` shades within it. */
export const PALETTES: Record<string, [string, string][]> = {
  trunk: [['#6b4a2f', '#8a6240'], ['#5a3d28', '#7a5a3c'], ['#7c5a3a', '#9c7a52']],
  pine: [['#2f7a45', '#4a9c5c'], ['#1f6b4f', '#3a8a63'], ['#3d8c3f', '#6fae4a'], ['#2c6f5a', '#4c9a7a'], ['#4f8a3a', '#7fb060']],
  round: [['#5bab4a', '#8fd05a'], ['#3f9a4a', '#6cbf5a'], ['#a3c24a', '#d0d85a'], ['#6fb85a', '#a8dc6a'], ['#4f9a63', '#7cc27a'], ['#d98f3a', '#f0b04a'], ['#5bab4a', '#8fd05a'], ['#e0a7c8', '#f3cfe2'], ['#6fb85a', '#98d060']],
  dead: [['#3a312e', '#4a3f3a'], ['#2e2a2a', '#3f3a38']],
  birchTrunk: [['#e8e4dc', '#f6f3ee']],
  crag: [['#7a746a', '#9a948a'], ['#6e6a62', '#8e8a80'], ['#8a8078', '#a89e92']],
  fern: [['#3f8a46', '#6aae5a'], ['#2f7a45', '#5da54c'], ['#4f9a5c', '#7cc27a']],
  log: [['#5a3d28', '#7a5a3c'], ['#4a3626', '#6b4a2f']],
  mushroom: [['#c9542f', '#e8772a'], ['#d9a83a', '#f2c14e'], ['#e8dcc0', '#f8f4ea'], ['#8e5aa8', '#b07ac8']],
  glowcap: [['#5ee8d0', '#b8fff0'], ['#7ad8ff', '#c8f0ff'], ['#9a7aff', '#d0c0ff'], ['#8fff9a', '#d8ffd0']],
  mallorn: [['#e0b43a', '#f6d868'], ['#d9a02c', '#f0c850'], ['#e8c04a', '#fae684'], ['#caa338', '#eccc62']],
  rock: [['#8d8478', '#b0a898'], ['#a68b6a', '#c4ad8e'], ['#7a7a80', '#9a9aa2'], ['#6e6a62', '#8e8a80']],
  bush: [['#5da54c', '#8cc86a'], ['#3f8a46', '#6aae5a'], ['#a3c24a', '#c9d86a'], ['#6fae4a', '#9cd06a'], ['#4f9a5c', '#7cc27a'], ['#b0663a', '#d08a5a'], ['#5da54c', '#8cc86a']],
  flower: [['#e84a5f', '#ff8a9a'], ['#f2c14e', '#ffe08a'], ['#ffffff', '#f4f0ff'], ['#8e5aa8', '#c48ad8'], ['#ff7f3f', '#ffb07a'], ['#4f8fd6', '#8ab8f0']],
}

// Small plants lean with the ground (see scatter), and a leaning stalk or a rounded base lifts
// its downhill edge off the plane it stands on, so these sink deeper than they did when they
// stood upright (-0.03 caps, -0.05 flowers): mushroom stalks by 6 cm, and the flower clump down to
// its widest ring (0.15 m up its 0.45 m base). Measured on the drawn ground with every instance posed
// as here: at the old sinks, flower clumps floated more than 5 cm in 7.2% of Bree, 8.6% of
// Hobbiton and 6.0% of the overworld (worst 0.12-0.14 m) and mushrooms in 1.8% / 1.2% (worst
// 0.06 m); at these, none does, worst 0.025 m.
const CAP_SINK = -0.06
const FLOWER_SINK = -0.15

const dummy = new THREE.Object3D()
const upTmp = new THREE.Vector3()
const yawTmp = new THREE.Quaternion()
const yAxis = new THREE.Vector3(0, 1, 0)
const cA = new THREE.Color()
const cB = new THREE.Color()

/** Pose one instance in `dummy`: on its tilted up (if any) offset by yOffset along it, yawed about it, stretched by scaleY. */
function poseInstance(it: Instance, yOffset: number) {
  if (it.quat) {
    dummy.quaternion.set(it.quat[0], it.quat[1], it.quat[2], it.quat[3])
    // offset along the instance's own up, then spin about it
    dummy.position.set(it.x, it.y, it.z).add(upTmp.set(0, yOffset, 0).applyQuaternion(dummy.quaternion))
    dummy.quaternion.multiply(yawTmp.setFromAxisAngle(yAxis, it.rot))
  } else {
    dummy.position.set(it.x, it.y + yOffset, it.z)
    dummy.rotation.set(0, it.rot, 0)
  }
  dummy.scale.set(it.scale, it.scale * (it.scaleY ?? 1), it.scale)
  dummy.updateMatrix()
}

export function Instanced({ geometry, items, palette, castShadow, yOffset = -0.15, wind = 1, nearFade = 0 }: { geometry: THREE.BufferGeometry; items: Instance[]; palette: [string, string][]; castShadow: boolean; yOffset?: number; wind?: number; nearFade?: number }) {
  const material = useMemo(
    () => applyExtensions(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getGradientMap() }), { wind, windMode: 'canopy', cloudShadow: true, nearFade, weather: true }),
    [wind, nearFade],
  )
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, material, Math.max(1, items.length))
    items.forEach((it, i) => {
      poseInstance(it, yOffset)
      m.setMatrixAt(i, dummy.matrix)
      const fam = it.family ?? palette[Math.min(palette.length - 1, Math.floor(it.grove * palette.length))]
      cA.set(fam[0])
      cB.set(fam[1])
      m.setColorAt(i, cA.lerp(cB, it.tint))
    })
    m.count = items.length
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.frustumCulled = false
    m.castShadow = castShadow
    m.receiveShadow = true
    return m
  }, [geometry, items, material, palette, castShadow, yOffset])
  useEffect(() => () => mesh.dispose(), [mesh])
  useEffect(() => () => material.dispose(), [material])
  return <primitive object={mesh} />
}

/**
 * Instanced pieces that give off their own light: drawn unlit so they keep their colour whatever
 * the hour, and scaled up after dark until the bloom pass catches them.
 */
function Glowing({ geometry, items, palette }: { geometry: THREE.BufferGeometry; items: Instance[]; palette: [string, string][] }) {
  const material = useMemo(() => new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1, 1, 1) }), [])
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, material, Math.max(1, items.length))
    items.forEach((it, i) => {
      poseInstance(it, CAP_SINK)
      m.setMatrixAt(i, dummy.matrix)
      const fam = it.family ?? palette[Math.min(palette.length - 1, Math.floor(it.grove * palette.length))]
      cA.set(fam[0])
      cB.set(fam[1])
      m.setColorAt(i, cA.lerp(cB, it.tint))
    })
    m.count = items.length
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.frustumCulled = false
    return m
  }, [geometry, items, material, palette])
  // barely there by day, bright enough to bloom once the light goes
  useFrame(() => material.color.setScalar((0.5 + timeState.lamp * 2.2) * auraMix.glow()))
  useEffect(() => () => mesh.dispose(), [mesh])
  useEffect(() => () => material.dispose(), [material])
  return <primitive object={mesh} />
}

/** How far round a building's footing the scatter keeps clear (trunk, rock or bush against the wall). */
const BUILDING_CLEAR = 0.8

/**
 * Inside a place, drop whatever the scatter put inside a building or right against its walls: the
 * scatter knows only the ground, so it once grew a pine inside Meduseld. The footings come from
 * the town plan the map draws, which matches every building's collider.
 */
function clearOfBuildings(r: ScatterResult, rings: Float32Array[]): ScatterResult {
  if (!rings.length) return r
  const inside = (x: number, z: number) => {
    for (const q of rings) {
      let inPoly = false
      let near = Infinity
      for (let i = 0, j = q.length - 2; i < q.length; j = i, i += 2) {
        const ax = q[j], az = q[j + 1], bx = q[i], bz = q[i + 1]
        if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inPoly = !inPoly
        const vx = bx - ax, vz = bz - az
        const t = Math.min(1, Math.max(0, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)))
        near = Math.min(near, Math.hypot(x - ax - vx * t, z - az - vz * t))
      }
      if (inPoly || near < BUILDING_CLEAR) return true
    }
    return false
  }
  const out = {} as ScatterResult
  for (const k of Object.keys(r) as (keyof ScatterResult)[]) out[k] = r[k].filter((t) => !inside(t.x, t.z))
  return out
}

export function Vegetation() {
  const world = useWorld()
  const { heightfield, surface, meta } = world
  const quality = useSettingsStore((s) => s.quality)
  const density = byQuality(quality, { low: 0.4, medium: 0.7, high: 1, ultra: 1 })
  const geos = useMemo(makeGeometries, [])
  const terrainVersion = useTerrainVersion()
  const items = useMemo(() => {
    const t0 = performance.now()
    const all = scatter(heightfield, surface, meta.seaLevel, density, vegOverrides(meta), meta)
    const r = meta.place ? clearOfBuildings(all, extractPlaceFeatures(world).buildings.map((b) => b.ring)) : all
    if (import.meta.env.DEV)
      console.info(
        `vegetation: pine ${r.pine.length}, fir ${r.fir.length}, round ${r.round.length}, oak ${r.oak.length}, birch ${r.birch.length}, mallorn ${r.mallorn.length}, glowcap ${r.glowcap.length}, crag ${r.crag.length}, dead ${r.dead.length}, rock ${r.rock.length}, bush ${r.bush.length}, flower ${r.flower.length}, fern ${r.fern.length}, log ${r.log.length}, mushroom ${r.mushroom.length} in ${(performance.now() - t0).toFixed(0)} ms`,
      )
    return r
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, heightfield, surface, meta, density, terrainVersion])
  const split = useMemo(() => {
    const short = (l: Instance[]) => l.filter((i) => !i.tall)
    const tall = (l: Instance[]) => l.filter((i) => i.tall)
    const asTrunk = (l: Instance[]) => l.map((t) => ({ ...t, family: t.trunk }))
    return {
      pine: short(items.pine),
      fir: short(items.fir),
      round: short(items.round),
      oak: short(items.oak),
      birch: short(items.birch),
      mallorn: short(items.mallorn),
      tallMallorn: tall(items.mallorn),
      tallPine: tall(items.pine),
      tallFir: tall(items.fir),
      tallRound: tall(items.round),
      tallOak: tall(items.oak),
      tallBirch: tall(items.birch),
      trunks: asTrunk([...short(items.pine), ...short(items.fir), ...short(items.round), ...short(items.oak), ...short(items.mallorn)]),
      tallTrunks: asTrunk([...tall(items.pine), ...tall(items.fir), ...tall(items.round), ...tall(items.oak), ...tall(items.mallorn)]),
      birchTrunks: asTrunk(short(items.birch)),
      tallBirchTrunks: asTrunk(tall(items.birch)),
    }
  }, [items])
  // In a place you walk among the trees, so each drawn trunk blocks the way. Built from the same
  // lists that are drawn, so a lower quality tier has exactly the trunks it shows. The overworld
  // is a miniature and its woods stay walk-through.
  const isPlace = !!meta.place
  useEffect(() => {
    if (!isPlace) return
    const list: Collider[] = []
    const trunks = (l: Instance[], r: number, h: number) => {
      for (const t of l) list.push({ kind: 'circle', x: t.x, z: t.z, r: r * t.scale, top: t.y + h * t.scale, layer: 'trees' })
    }
    trunks(split.trunks, 0.28, 1.6)
    trunks(split.birchTrunks, 0.28, 1.6)
    trunks(split.tallTrunks, 0.4, 1.6 + TALL)
    trunks(split.tallBirchTrunks, 0.4, 1.6 + TALL)
    trunks(items.dead, 0.25, 3.2) // the dead snag's trunk is 3.2 m tall
    setColliderLayer('trees', list)
    return () => clearColliderLayer('trees')
  }, [isPlace, split, items])
  const shadows = atLeast(quality, 'high')
  // forest-interior pieces dissolve when the camera comes within a few metres, so the view is never blocked
  const FADE = 5
  const FADE_TALL = 8 // big forest trees shrink from further away so the camera can see between them
  return (
    <group name="vegetation">
      <Instanced geometry={geos.trunk} items={split.trunks} palette={PALETTES.trunk} castShadow={shadows} wind={0} nearFade={FADE} />
      <Instanced geometry={geos.pine} items={split.pine} palette={PALETTES.pine} castShadow={shadows} nearFade={FADE} />
      <Instanced geometry={geos.round} items={split.round} palette={PALETTES.round} castShadow={shadows} nearFade={FADE} />
      <Instanced geometry={geos.tallTrunk} items={split.tallTrunks} palette={PALETTES.trunk} castShadow={shadows} wind={0} nearFade={FADE_TALL} />
      <Instanced geometry={geos.tallPine} items={split.tallPine} palette={PALETTES.pine} castShadow={false} nearFade={FADE_TALL} />
      <Instanced geometry={geos.tallRound} items={split.tallRound} palette={PALETTES.round} castShadow={false} nearFade={FADE_TALL} />
      <Instanced geometry={geos.fir} items={split.fir} palette={PALETTES.pine} castShadow={shadows} nearFade={FADE} />
      <Instanced geometry={geos.tallFir} items={split.tallFir} palette={PALETTES.pine} castShadow={false} nearFade={FADE_TALL} />
      <Instanced geometry={geos.oak} items={split.oak} palette={PALETTES.round} castShadow={shadows} nearFade={FADE} />
      <Instanced geometry={geos.tallOak} items={split.tallOak} palette={PALETTES.round} castShadow={false} nearFade={FADE_TALL} />
      <Instanced geometry={geos.birch} items={split.birchTrunks} palette={PALETTES.birchTrunk} castShadow={shadows} wind={0} nearFade={FADE} />
      <Instanced geometry={geos.birchCanopy} items={split.birch} palette={PALETTES.round} castShadow={shadows} wind={1.4} nearFade={FADE} />
      <Instanced geometry={geos.tallBirch} items={split.tallBirchTrunks} palette={PALETTES.birchTrunk} castShadow={shadows} wind={0} nearFade={FADE_TALL} />
      <Instanced geometry={geos.tallBirchCanopy} items={split.tallBirch} palette={PALETTES.round} castShadow={false} wind={1.4} nearFade={FADE_TALL} />
      <Instanced geometry={geos.mallorn} items={split.mallorn} palette={PALETTES.mallorn} castShadow={shadows} nearFade={FADE} />
      <Instanced geometry={geos.tallMallorn} items={split.tallMallorn} palette={PALETTES.mallorn} castShadow={false} nearFade={FADE_TALL} />
      <Instanced geometry={geos.crag} items={items.crag} palette={PALETTES.crag} castShadow={shadows} wind={0} />
      <Instanced geometry={geos.fern} items={items.fern} palette={PALETTES.fern} castShadow={false} yOffset={-0.05} wind={1.8} />
      <Instanced geometry={geos.log} items={items.log} palette={PALETTES.log} castShadow={shadows} yOffset={-0.08} wind={0} />
      <Instanced geometry={geos.mushroom} items={items.mushroom} palette={PALETTES.mushroom} castShadow={false} yOffset={CAP_SINK} wind={0} />
      <Instanced geometry={geos.dead} items={items.dead} palette={PALETTES.dead} castShadow={false} />
      <Instanced geometry={geos.rock} items={items.rock} palette={PALETTES.rock} castShadow={false} wind={0} />
      <Instanced geometry={geos.bush} items={items.bush} palette={PALETTES.bush} castShadow={false} wind={1.6} />
      <Instanced geometry={geos.flower} items={items.flower} palette={PALETTES.flower} castShadow={false} yOffset={FLOWER_SINK} wind={2.5} />
      <Glowing geometry={geos.glowcap} items={items.glowcap} palette={PALETTES.glowcap} />
    </group>
  )
}
