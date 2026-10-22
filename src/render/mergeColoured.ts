import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export interface Part {
  geo: THREE.BufferGeometry
  color: string | THREE.Color
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: number | [number, number, number]
  /** rendered with an unlit material (glows, lamps, lava) */
  unlit?: boolean
  /**
   * Applied after position/rotation/scale: lets a builder make a whole set piece at the origin
   * and then seat it on the ground in one go (propUtil.onPlane).
   */
  matrix?: THREE.Matrix4
  /**
   * Multiplies the colour per vertex, given the vertex position after position/rotation/scale
   * and before `matrix` (so in the builder's own frame): ground grime, darker hems.
   */
  shade?: (x: number, y: number, z: number) => number
}

const m = new THREE.Matrix4()
const o = new THREE.Object3D()

/** The part's position/rotation/scale as a matrix, without `matrix`. */
function trs(p: Part, out: THREE.Matrix4): THREE.Matrix4 {
  o.position.set(...(p.position ?? [0, 0, 0]))
  o.rotation.set(...(p.rotation ?? [0, 0, 0]))
  if (typeof p.scale === 'number') o.scale.setScalar(p.scale)
  else o.scale.set(...(p.scale ?? [1, 1, 1]))
  o.updateMatrix()
  return out.copy(o.matrix)
}

/** The whole transform mergeColoured gives a part: position/rotation/scale, then `matrix`. */
export function partMatrix(p: Part, out = new THREE.Matrix4()): THREE.Matrix4 {
  trs(p, out)
  if (p.matrix) out.premultiply(p.matrix)
  return out
}

/**
 * Bake a list of coloured, transformed primitives into a single non-indexed geometry with
 * per-vertex colours. One draw call per merged result.
 */
export function mergeColoured(parts: Part[]): THREE.BufferGeometry | null {
  if (parts.length === 0) return null
  const geos = parts.map((p) => {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone()
    g.applyMatrix4(trs(p, m))
    const c = p.color instanceof THREE.Color ? p.color : new THREE.Color(p.color)
    const n = g.attributes.position.count
    const arr = new Float32Array(n * 3)
    const pos = g.attributes.position
    for (let i = 0; i < n; i++) {
      const k = p.shade ? p.shade(pos.getX(i), pos.getY(i), pos.getZ(i)) : 1
      arr[i * 3] = c.r * k
      arr[i * 3 + 1] = c.g * k
      arr[i * 3 + 2] = c.b * k
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    if (p.matrix) g.applyMatrix4(p.matrix)
    g.deleteAttribute('uv')
    if (g.attributes.normal) g.deleteAttribute('normal')
    return g
  })
  const merged = mergeGeometries(geos, false)
  geos.forEach((g) => g.dispose())
  if (!merged) return null
  merged.computeVertexNormals()
  merged.computeBoundingSphere()
  return merged
}
