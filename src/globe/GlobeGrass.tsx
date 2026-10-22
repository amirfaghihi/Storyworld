import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useWorld } from '@/world/WorldContext'
import { playerState, useSettingsStore, byQuality } from '@/store/stores'
import { getGradientMap } from '@/render/gradientMap'
import { applyExtensions, sharedUniforms } from '@/render/shaderExt'
import { faceColor, hash2, makePalette } from '@/terrain/faceColors'
import { terrainNoise } from '@/terrain/terrainNoise'
import { BIOME } from '@/world/biomes'
import { getMoodMap, MOODS, MOOD_IDS } from '@/vegetation/mood'

const CELL_M = 1.0
const dummy = new THREE.Object3D()
const dirV = new THREE.Vector3()
const q = new THREE.Quaternion()
const yawQ = new THREE.Quaternion()
const yAxis = new THREE.Vector3(0, 1, 0)
const col = new THREE.Color()

function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = []
  const c: number[] = []
  const blade = (angle: number, lean: number) => {
    const cs = Math.cos(angle), sn = Math.sin(angle)
    const w = 0.13
    for (const v of [[-w * cs, 0, -w * sn], [w * cs, 0, w * sn], [lean * -sn * 0.25, 1, lean * cs * 0.25]]) pos.push(v[0], v[1], v[2])
    c.push(0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 1.08, 1.08, 1.08)
  }
  blade(0, 1)
  blade(Math.PI / 3, -1)
  blade((2 * Math.PI) / 3, 1)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3))
  g.computeVertexNormals()
  return g
}

/**
 * Grass on the globe: a window of tufts on a fixed latitude/longitude lattice around the traveller,
 * thinned toward the poles so density stays even, each tuft standing on its local up.
 */
export function GlobeGrass() {
  const { meta, heightfield: hf, globe } = useWorld()
  const quality = useSettingsStore((s) => s.quality)
  const count = byQuality(quality, { low: 3600, medium: 7200, high: 14400, ultra: 14400 })
  const side = Math.floor(Math.sqrt(count))
  const total = side * side
  const dTheta = globe ? CELL_M / globe.metresPerDegree() : 1 // degrees per lattice cell
  const wrap = Math.round(360 / dTheta)

  const geometry = useMemo(tuftGeometry, [])
  const material = useMemo(
    () => applyExtensions(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getGradientMap(), side: THREE.DoubleSide }), { wind: 0.22, windMode: 'grass', weather: true }),
    [],
  )
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, material, total)
    m.frustumCulled = false
    m.receiveShadow = true
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    return m
  }, [geometry, material, total])
  useEffect(() => () => mesh.dispose(), [mesh])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => {
    sharedUniforms.uGrassFar.value = (side * CELL_M) / 2
  }, [side])

  const pal = useMemo(() => makePalette(meta.palette), [meta.palette])
  const noise = useMemo(() => terrainNoise(meta.seed), [meta.seed])
  const moodMap = useMemo(() => getMoodMap(meta, hf), [meta, hf])
  const cells = useRef(new Int32Array(total * 2).fill(0x7fffffff))

  const place = (i: number, gx: number, gz: number) => {
    if (!globe) return
    cells.current[i * 2] = gx
    cells.current[i * 2 + 1] = gz
    const r1 = hash2(gx, gz), r2 = hash2(gx + 31, gz + 17), r3 = hash2(gx + 7, gz + 91)
    const x = (((gx + r1) * dTheta) % 360 + 360) % 360
    const z = (gz + r2) * dTheta
    const lat = 90 - z
    const coslat = Math.cos(THREE.MathUtils.degToRad(lat))
    const b = z < 0 || z > 180 ? BIOME.water : globe.biomeAt(x, z)
    const grassy = b === BIOME.grass || b === BIOME.forest || b === BIOME.marsh
    // thin the lattice toward the poles (cells get narrower) and by the usual sparsity
    if (!grassy || r3 < 0.18 || hash2(gx + 3, gz + 5) > coslat) {
      dummy.position.set(0, -1000, 0)
      dummy.scale.setScalar(0.0001)
      dummy.quaternion.identity()
    } else {
      globe.dirFromMap(x, z, dirV)
      const slope = globe.slopeAtDir(dirV)
      if (slope > 0.85) {
        dummy.position.set(0, -1000, 0)
        dummy.scale.setScalar(0.0001)
      } else {
        const h = globe.heightAtDir(dirV)
        dummy.position.copy(dirV).multiplyScalar(globe.radius + h - 0.02)
        globe.frame(dirV, q)
        dummy.quaternion.copy(q).multiply(yawQ.setFromAxisAngle(yAxis, r1 * Math.PI * 2))
        const th = (0.28 + r2 * 0.3) * 0.75
        dummy.scale.set((1.0 + r3 * 0.6) * 0.75, th, (1.0 + r3 * 0.6) * 0.75)
        const ix = Math.min(globe.width - 1, Math.floor(x / globe.cell)), iz = Math.min(globe.height - 1, Math.floor(z / globe.cell))
        const mpd = globe.metresPerDegree()
        faceColor(col, pal, { biome: b, h, slope, rnd: r3, patch: noise.patch(x * mpd, z * mpd), detail: noise.detail(x * mpd, z * mpd), seaLevel: meta.seaLevel, mood: b === BIOME.forest ? MOODS[MOOD_IDS[moodMap[iz * globe.width + ix]]] : undefined })
        col.multiplyScalar(1.12)
        mesh.setColorAt(i, col)
      }
    }
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }

  const initialised = useRef(false)
  useFrame(() => {
    if (!playerState.ready || !globe) return
    const cx = Math.floor(playerState.map.x / dTheta) - side / 2
    const cz = Math.floor(playerState.map.z / dTheta) - side / 2
    let changed = false
    if (!initialised.current) {
      initialised.current = true
      for (let i = 0; i < total; i++) place(i, cx + (i % side), cz + Math.floor(i / side))
      changed = true
    } else {
      const c = cells.current
      for (let i = 0; i < total; i++) {
        let gx = c[i * 2], gz = c[i * 2 + 1]
        let moved = false
        // longitude wraps: bring the cell into the window modulo the lattice width
        let rel = ((gx - cx) % wrap + wrap) % wrap
        if (rel >= side) {
          rel = ((gx % side) - (cx % side) + side * 2) % side
          gx = cx + rel
          moved = true
        }
        while (gz < cz) { gz += side; moved = true }
        while (gz >= cz + side) { gz -= side; moved = true }
        if (moved) { place(i, gx, gz); changed = true }
      }
    }
    if (changed) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  })
  if (!globe) return null
  return <primitive object={mesh} />
}
