import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useWorld } from '@/world/WorldContext'
import { faceColor, hash2, makePalette } from '@/terrain/faceColors'
import { terrainNoise } from '@/terrain/terrainNoise'
import { getGradientMap } from '@/render/gradientMap'
import { applyExtensions } from '@/render/shaderExt'
import { getMoodMap, MOODS, MOOD_IDS } from '@/vegetation/mood'
import { BIOME } from '@/world/biomes'
import type { GlobeField } from './globeField'

const CHUNKS = 4 // chunks per cube-face side
const QUADS = 26 // quads per chunk side (~3 m at radius 200)

/** cube face param (u, v in -1..1) -> cube point */
function cubePoint(face: number, u: number, v: number, out: THREE.Vector3) {
  switch (face) {
    case 0: return out.set(1, v, -u)
    case 1: return out.set(-1, v, u)
    case 2: return out.set(u, 1, -v)
    case 3: return out.set(u, -1, v)
    case 4: return out.set(u, v, 1)
    default: return out.set(-u, v, -1)
  }
}

const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), D = new THREE.Vector3()
const col = new THREE.Color()

function buildGlobeChunks(globe: GlobeField, pal: ReturnType<typeof makePalette>, seaLevel: number, seed: number, moodMap: Uint8Array) {
  const noise = terrainNoise(seed)
  const mpd = globe.metresPerDegree()
  const R = globe.radius
  const chunks: THREE.BufferGeometry[] = []
  const vert = (face: number, u: number, v: number, out: THREE.Vector3) => {
    cubePoint(face, u, v, out).normalize()
    const h = globe.heightAtDir(out)
    return out.multiplyScalar(R + h)
  }
  for (let face = 0; face < 6; face++) {
    for (let cz = 0; cz < CHUNKS; cz++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        const pos = new Float32Array(QUADS * QUADS * 6 * 3)
        const colors = new Float32Array(QUADS * QUADS * 6 * 3)
        let o = 0
        const emit = (ua: number, va: number, ub: number, vb: number, uc: number, vc: number, rnd: number) => {
          vert(face, ua, va, A)
          vert(face, ub, vb, B)
          vert(face, uc, vc, C)
          D.copy(A).add(B).add(C).normalize() // centroid direction = local up
          N.subVectors(B, A).cross(C.clone().sub(A))
          if (N.dot(D) < 0) {
            const t = B.clone()
            B.copy(C)
            C.copy(t)
            N.negate()
          }
          N.normalize()
          const cosS = THREE.MathUtils.clamp(N.dot(D), 0.05, 1)
          const slope = Math.sqrt(1 - cosS * cosS) / cosS
          const [mx, mz] = globe.mapFromDir(D)
          const mh = (A.length() + B.length() + C.length()) / 3 - R
          const biome = globe.biomeAt(mx, mz)
          const ix = Math.min(globe.width - 1, Math.floor(mx / globe.cell)), iz = Math.min(globe.height - 1, Math.floor(mz / globe.cell))
          const mood = biome === BIOME.forest ? MOODS[MOOD_IDS[moodMap[iz * globe.width + ix]]] : undefined
          faceColor(col, pal, { biome, h: mh, slope, rnd, patch: noise.patch(mx * mpd, mz * mpd), detail: noise.detail(mx * mpd, mz * mpd), seaLevel, mood })
          for (const P of [A, B, C]) {
            pos[o] = P.x; pos[o + 1] = P.y; pos[o + 2] = P.z
            colors[o] = col.r; colors[o + 1] = col.g; colors[o + 2] = col.b
            o += 3
          }
        }
        const step = 2 / (CHUNKS * QUADS)
        for (let qz = 0; qz < QUADS; qz++) {
          for (let qx = 0; qx < QUADS; qx++) {
            const u0 = -1 + (cx * QUADS + qx) * step, v0 = -1 + (cz * QUADS + qz) * step
            const u1 = u0 + step, v1 = v0 + step
            const gx = face * 1000 + cx * QUADS + qx, gz = cz * QUADS + qz
            const r1 = hash2(gx, gz), r2 = hash2(gx + 7919, gz + 104729)
            if (r1 > 0.5) {
              emit(u0, v0, u1, v0, u1, v1, r1)
              emit(u0, v0, u1, v1, u0, v1, r2)
            } else {
              emit(u0, v0, u1, v0, u0, v1, r1)
              emit(u1, v0, u1, v1, u0, v1, r2)
            }
          }
        }
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        g.computeVertexNormals()
        g.computeBoundingSphere()
        chunks.push(g)
      }
    }
  }
  return chunks
}

/** Cube-sphere terrain displaced by the latitude/longitude height grid, per-face toon colours. */
export function GlobeTerrain() {
  const { meta, heightfield, globe } = useWorld()
  const chunks = useMemo(() => {
    if (!globe) return []
    const t0 = performance.now()
    const c = buildGlobeChunks(globe, makePalette(meta.palette), meta.seaLevel, meta.seed, getMoodMap(meta, heightfield))
    if (import.meta.env.DEV) console.info(`globe terrain: ${c.length} chunks in ${(performance.now() - t0).toFixed(0)} ms`)
    return c
  }, [globe, meta, heightfield])
  const material = useMemo(() => applyExtensions(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getGradientMap() }), { weather: true }), [])
  useEffect(() => () => chunks.forEach((c) => c.dispose()), [chunks])
  useEffect(() => () => material.dispose(), [material])
  return (
    <group name="terrain">
      {chunks.map((g, i) => (
        <mesh key={i} geometry={g} material={material} receiveShadow castShadow frustumCulled />
      ))}
    </group>
  )
}
