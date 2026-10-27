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
import { groundOverrides, overrideWeight } from '@/dressing/ground'
import { onTerrainEdit } from '@/editor/terrainEdit'
import { getMoodMap, moodAt } from '@/vegetation/mood'
import { makePropContext } from '@/dressing/propUtil'
import { channelFootprint } from '@/dressing/kinds/channel'
import { waterfallPoolFootprint } from '@/dressing/kinds/waterfall'
import { wingFloorFootprint } from '@/dressing/kinds/wing'
import { colonnadeFloorFootprint } from '@/dressing/kinds/colonnade'

const CELL = 1.0 // metres between tufts
const BLADE_FOOT = 0.13 // half width of a blade's base, before instance scale (tuftGeometry's w)

/** Three-blade grass tuft, 1 m tall before instance scaling. Vertex colour darkens the base. */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const blade = (angle: number, lean: number) => {
    const c = Math.cos(angle), s = Math.sin(angle)
    const w = BLADE_FOOT
    // triangle: two base verts + tip (tip leans away from centre)
    const verts = [
      [-w * c, 0, -w * s],
      [w * c, 0, w * s],
      [lean * -s * 0.25, 1, lean * c * 0.25],
    ]
    for (const v of verts) pos.push(v[0], v[1], v[2])
    col.push(0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 1.08, 1.08, 1.08)
  }
  blade(0, 1)
  blade(Math.PI / 3, -1)
  blade((2 * Math.PI) / 3, 1)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.computeVertexNormals()
  return g
}

const dummy = new THREE.Object3D()
const col = new THREE.Color()

/**
 * Grass tufts in a square window that follows the player. Cells are addressed in absolute grid
 * coordinates; only the tufts that fall outside the window are re-placed, so moving is cheap.
 */
export function Grass() {
  const { heightfield: hf, surface, meta } = useWorld()
  const quality = useSettingsStore((s) => s.quality)
  const count = byQuality(quality, { low: 3600, medium: 8100, high: 16900, ultra: 16900 }) // window = sqrt(count) * CELL metres
  const side = Math.floor(Math.sqrt(count))
  const total = side * side

  const geometry = useMemo(tuftGeometry, [])
  const material = useMemo(
    () =>
      applyExtensions(
        new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getGradientMap(), side: THREE.DoubleSide }),
        { wind: 0.22, windMode: 'grass', cloudShadow: true, weather: true },
      ),
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

  const pal = useMemo(() => makePalette(meta.palette), [meta.palette])
  const noise = useMemo(() => terrainNoise(meta.seed), [meta.seed])
  const overrides = useMemo(() => groundOverrides(meta), [meta])
  const tuftScale = meta.place ? 0.62 : 1 // 1:1 places: finer grass at eye level
  // no tufts through a stream's channel, whose water is drawn only a hand's breadth above the
  // ground, nor through a waterfall's plunge pool (a disc 4 cm over it)
  const bare = useMemo(() => {
    const rects: { x: number; z: number; hw: number; hd: number; cs: number; sn: number; r: number }[] = []
    const discs: { x: number; z: number; r: number }[] = []
    for (const lm of meta.landmarks)
      for (const [i, p] of (lm.dressing?.props ?? []).entries()) {
        if (p.kind === 'channel') {
          const f = channelFootprint(makePropContext(lm, p, surface, meta.seaLevel, meta.seed + i))
          rects.push({ ...f, cs: Math.cos(f.rot), sn: Math.sin(f.rot), r: Math.hypot(f.hw, f.hd) })
        } else if (p.kind === 'waterfall') {
          const f = waterfallPoolFootprint(makePropContext(lm, p, surface, meta.seaLevel, meta.seed + i))
          if (f.r > 0) discs.push(f)
        } else if (p.kind === 'wing' || p.kind === 'colonnade') {
          // the floors of buildings you can walk into (Hall of Fire, the east porch)
          const ctx = makePropContext(lm, p, surface, meta.seaLevel, meta.seed + i)
          const f = p.kind === 'wing' ? wingFloorFootprint(ctx) : colonnadeFloorFootprint(ctx)
          if (f) rects.push({ ...f, cs: Math.cos(f.rot), sn: Math.sin(f.rot), r: Math.hypot(f.hw, f.hd) })
        }
      }
    return { rects, discs }
  }, [meta, surface])
  const onBare = (x: number, z: number) =>
    bare.rects.some((b) => {
      const dx = x - b.x, dz = z - b.z
      if (Math.abs(dx) > b.r || Math.abs(dz) > b.r) return false
      return Math.abs(b.cs * dx - b.sn * dz) < b.hw && Math.abs(b.sn * dx + b.cs * dz) < b.hd
    }) || bare.discs.some((b) => (x - b.x) ** 2 + (z - b.z) ** 2 < b.r * b.r)
  // absolute grid cell of each instance
  const cells = useRef(new Int32Array(total * 2).fill(0x7fffffff))

  const place = (i: number, gx: number, gz: number) => {
    cells.current[i * 2] = gx
    cells.current[i * 2 + 1] = gz
    const r1 = hash2(gx, gz), r2 = hash2(gx + 31, gz + 17), r3 = hash2(gx + 7, gz + 91)
    const x = (gx + r1) * CELL
    const z = (gz + r2) * CELL
    const b = hf.biomeAt(x, z)
    const grassy = b === BIOME.grass || b === BIOME.forest || b === BIOME.marsh || (b === BIOME.sand && r3 > 0.8)
    const slope = grassy ? hf.slopeAt(x, z) : 9
    const grows = grassy && slope <= 0.85 && r3 >= 0.18 && !onBare(x, z)
    const y = grows ? surface.height(x, z) : 0
    const sx = (1.0 + r3 * 0.6) * tuftScale
    const h = (0.28 + r2 * 0.3) * tuftScale
    // Each blade's base runs straight through the centre to two feet BLADE_FOOT·sx out, so on
    // a slope or across a crease in the mesh the downhill feet would hang in the air: stand the
    // tuft on its lowest foot. A blade at local angle a points along world angle a - yaw once
    // the tuft is turned by yaw.
    const yaw = r1 * Math.PI * 2
    let base = y
    if (grows) {
      const foot = BLADE_FOOT * sx
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI) / 3 - yaw
        const dx = foot * Math.cos(a), dz = foot * Math.sin(a)
        base = Math.min(base, surface.height(x + dx, z + dz), surface.height(x - dx, z - dz))
      }
      base -= 0.02
    }
    // Across a sharp crease the lowest foot can lie so far below the centre that a short tuft
    // would end under the ground it grows from; such a spot keeps no tuft rather than a buried
    // one (or one hovering on its other feet). It needs a third of the tuft to show.
    if (!grows || base + h < y + h / 3) {
      dummy.position.set(x, -100, z)
      dummy.scale.setScalar(0.0001)
    } else {
      dummy.position.set(x, base, z)
      dummy.rotation.set(0, yaw, 0)
      dummy.scale.set(sx, h, sx)
      faceColor(col, pal, { biome: b === BIOME.sand ? BIOME.grass : b, h: y, slope, rnd: r3, patch: noise.patch(x, z), detail: noise.detail(x, z), seaLevel: meta.seaLevel, mood: b === BIOME.forest ? moodAt(getMoodMap(meta, hf), hf, x, z) : undefined })
      for (const o of overrides) {
        const w = overrideWeight(o, x, z)
        if (w > 0) col.lerp(o.color, w * 0.85)
      }
      col.multiplyScalar(1.12)
      mesh.setColorAt(i, col)
    }
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }

  // tufts shrink to nothing toward the window edge (see shaderExt grass mode)
  useEffect(() => {
    sharedUniforms.uGrassFar.value = (side * CELL) / 2
  }, [side])
  const initialised = useRef(false)
  useEffect(
    () =>
      onTerrainEdit((r) => {
        if (!initialised.current) return
        const c = cells.current
        let changed = false
        for (let i = 0; i < total; i++) {
          const gx = c[i * 2], gz = c[i * 2 + 1]
          const x = gx * CELL, z = gz * CELL
          if (x >= r.minX - CELL && x <= r.maxX + CELL && z >= r.minZ - CELL && z <= r.maxZ + CELL) {
            place(i, gx, gz)
            changed = true
          }
        }
        if (changed) {
          mesh.instanceMatrix.needsUpdate = true
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mesh, total],
  )
  useFrame(() => {
    if (!playerState.ready) return
    const p = playerState.position
    const cx = Math.floor(p.x / CELL) - side / 2
    const cz = Math.floor(p.z / CELL) - side / 2
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
        while (gx < cx) { gx += side; moved = true }
        while (gx >= cx + side) { gx -= side; moved = true }
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

  return <primitive object={mesh} />
}
