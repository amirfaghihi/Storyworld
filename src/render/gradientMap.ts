import * as THREE from 'three'
import { applyExtensions } from './shaderExt'

let cached: THREE.DataTexture | null = null

/** Shared 3-step toon gradient used by every MeshToonMaterial in the scene. */
export function getGradientMap(): THREE.DataTexture {
  if (cached) return cached
  const steps = [0.42, 0.72, 1.0]
  const data = new Uint8Array(steps.length * 4)
  steps.forEach((s, i) => {
    const v = Math.round(s * 255)
    data[i * 4] = v
    data[i * 4 + 1] = v
    data[i * 4 + 2] = v
    data[i * 4 + 3] = 255
  })
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  cached = tex
  return tex
}

const materials = new Map<string, THREE.MeshToonMaterial>()

/** Cached toon material by colour (for props that share colours). */
export function toonMaterial(color: string, extra: Partial<THREE.MeshToonMaterialParameters> = {}): THREE.MeshToonMaterial {
  const key = color + JSON.stringify(extra)
  let m = materials.get(key)
  if (!m) {
    m = applyExtensions(new THREE.MeshToonMaterial({ color, gradientMap: getGradientMap(), ...extra }), { cloudShadow: true, weather: true })
    materials.set(key, m)
  }
  return m
}
