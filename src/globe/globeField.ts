/**
 * Spherical world helpers. The height grid is equirectangular: x = longitude + 180 (0..360),
 * z = 90 - latitude (0..180), both in degrees ("map coordinates"), the same axes the flat
 * worlds use in metres so maps, regions and saved positions work unchanged.
 * Local frame at a point: +x east, +y up (radial), +z south, matching the flat world's yaw.
 */
import * as THREE from 'three'
import type { Heightfield } from '@/terrain/heightfield'

const Y = new THREE.Vector3(0, 1, 0)
const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const tmpM = new THREE.Matrix4()

export class GlobeField {
  readonly width: number
  readonly height: number
  readonly cell: number // degrees per pixel
  constructor(
    readonly hf: Heightfield,
    readonly radius: number,
  ) {
    this.width = hf.width
    this.height = hf.height
    this.cell = hf.cell
  }

  /** Bilinear height with longitude wrap-around. */
  heightAt(x: number, z: number): number {
    const { width, height, cell, data } = this.hf
    let gx = x / cell - 0.5
    const gz = Math.min(height - 1.001, Math.max(0, z / cell - 0.5))
    gx = ((gx % width) + width) % width
    const x0 = Math.floor(gx), z0 = Math.floor(gz)
    const x1 = (x0 + 1) % width, z1 = Math.min(height - 1, z0 + 1)
    const tx = gx - x0, tz = gz - z0
    const a = data[z0 * width + x0] + (data[z0 * width + x1] - data[z0 * width + x0]) * tx
    const b = data[z1 * width + x0] + (data[z1 * width + x1] - data[z1 * width + x0]) * tx
    return a + (b - a) * tz
  }
  biomeAt(x: number, z: number): number {
    const { width, height, cell } = this.hf
    const ix = ((Math.floor(x / cell) % width) + width) % width
    const iz = Math.min(height - 1, Math.max(0, Math.floor(z / cell)))
    return this.hf.biome[iz * width + ix]
  }

  /** Unit direction for map coordinates. */
  dirFromMap(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const lat = THREE.MathUtils.degToRad(90 - z)
    const lon = THREE.MathUtils.degToRad(x - 180)
    const c = Math.cos(lat)
    return out.set(c * Math.sin(lon), Math.sin(lat), c * Math.cos(lon))
  }
  mapFromDir(d: THREE.Vector3): [number, number] {
    const lat = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1))
    const lon = Math.atan2(d.x, d.z)
    return [((THREE.MathUtils.radToDeg(lon) + 180) % 360 + 360) % 360, 90 - THREE.MathUtils.radToDeg(lat)]
  }
  heightAtDir(d: THREE.Vector3): number {
    const [x, z] = this.mapFromDir(d)
    return this.heightAt(x, z)
  }
  biomeAtDir(d: THREE.Vector3): number {
    const [x, z] = this.mapFromDir(d)
    return this.biomeAt(x, z)
  }
  /** Point on the terrain surface along direction d. */
  surface(d: THREE.Vector3, out = new THREE.Vector3(), minHeight = -Infinity): THREE.Vector3 {
    const h = Math.max(minHeight, this.heightAtDir(d))
    return out.copy(d).multiplyScalar(this.radius + h)
  }
  /** Metres of ground covered per degree at this direction (for slopes and spacing). */
  metresPerDegree(): number {
    return (this.radius * Math.PI) / 180
  }
  /** Local basis: east, up, south. Falls back to a fixed basis at the poles. */
  basis(d: THREE.Vector3, east: THREE.Vector3, south: THREE.Vector3) {
    east.crossVectors(Y, d)
    if (east.lengthSq() < 1e-8) east.set(1, 0, 0)
    east.normalize()
    south.crossVectors(east, d).normalize() // east x up = south (right-handed)
  }
  frame(d: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
    this.basis(d, tmpA, tmpB)
    tmpM.makeBasis(tmpA, d, tmpB)
    return out.setFromRotationMatrix(tmpM)
  }
  /** Rise/run at a surface direction, sampling ~1 m along east and south. */
  slopeAtDir(d: THREE.Vector3): number {
    const step = 1 / this.metresPerDegree() // one metre in degrees
    const [x, z] = this.mapFromDir(d)
    const coslat = Math.max(0.05, Math.cos(THREE.MathUtils.degToRad(90 - z)))
    const dx = (this.heightAt(x + step / coslat, z) - this.heightAt(x - step / coslat, z)) / 2
    const dz = (this.heightAt(x, Math.min(180, z + step)) - this.heightAt(x, Math.max(0, z - step))) / 2
    return Math.hypot(dx, dz)
  }
  /** Great-circle distance in metres between two map positions. */
  distance(ax: number, az: number, bx: number, bz: number): number {
    this.dirFromMap(ax, az, tmpA)
    this.dirFromMap(bx, bz, tmpB)
    return this.radius * Math.acos(THREE.MathUtils.clamp(tmpA.dot(tmpB), -1, 1))
  }
  /** Move a direction by a tangent offset (metres east, metres south) along the sphere. */
  offset(d: THREE.Vector3, east: number, south: number, out = new THREE.Vector3()): THREE.Vector3 {
    this.basis(d, tmpA, tmpB)
    out.copy(d).multiplyScalar(this.radius).addScaledVector(tmpA, east).addScaledVector(tmpB, south)
    return out.normalize()
  }
}
