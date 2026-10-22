/**
 * Heightfield: the single source of truth for ground height.
 * Used by terrain meshing, player grounding, camera clamping, vegetation scatter and the 2D map.
 *
 * Pixel (ix, iz) is the terrain vertex at world (ix * cell, iz * cell). buildPlace, build-world,
 * the editor brushes and the mesh all use that convention, so every sampler here must too.
 * Things that stand on the drawn ground should use TerrainSurface (src/terrain/surface.ts),
 * which follows the mesh's own triangles; sampleHeight is the smooth bilinear version of the
 * same vertices, for the camera, slope tests, scatter density and the map.
 */
export class Heightfield {
  readonly sizeX: number
  readonly sizeZ: number

  constructor(
    readonly width: number, // pixels
    readonly height: number,
    readonly cell: number, // metres per pixel
    readonly data: Float32Array,
    readonly biome: Uint8Array,
  ) {
    this.sizeX = width * cell
    this.sizeZ = height * cell
  }

  /** Height at integer pixel (clamped). */
  at(ix: number, iz: number): number {
    const x = ix < 0 ? 0 : ix >= this.width ? this.width - 1 : ix
    const z = iz < 0 ? 0 : iz >= this.height ? this.height - 1 : iz
    return this.data[z * this.width + x]
  }

  biomeAtPx(ix: number, iz: number): number {
    const x = ix < 0 ? 0 : ix >= this.width ? this.width - 1 : ix
    const z = iz < 0 ? 0 : iz >= this.height ? this.height - 1 : iz
    return this.biome[z * this.width + x]
  }

  /**
   * Bilinear height between the four vertices around world position (x, z), in metres. Within a
   * few centimetres of the drawn triangles in places; on the coarser overworld mesh it can be
   * further off, so use TerrainSurface for anything that must touch the visible ground.
   */
  sampleHeight(x: number, z: number): number {
    const gx = x / this.cell
    const gz = z / this.cell
    const x0 = Math.floor(gx)
    const z0 = Math.floor(gz)
    const tx = gx - x0
    const tz = gz - z0
    const h00 = this.at(x0, z0)
    const h10 = this.at(x0 + 1, z0)
    const h01 = this.at(x0, z0 + 1)
    const h11 = this.at(x0 + 1, z0 + 1)
    const a = h00 + (h10 - h00) * tx
    const b = h01 + (h11 - h01) * tx
    return a + (b - a) * tz
  }

  /**
   * Biome of the cell whose low corner vertex is at or below (x, z). Terrain faces are coloured
   * from this at their centroid, so it is deliberately a floor, not the nearest vertex.
   */
  biomeAt(x: number, z: number): number {
    return this.biomeAtPx(Math.floor(x / this.cell), Math.floor(z / this.cell))
  }

  /** Gradient magnitude (rise / run) at world position. */
  slopeAt(x: number, z: number): number {
    const d = this.cell
    const dx = (this.sampleHeight(x + d, z) - this.sampleHeight(x - d, z)) / (2 * d)
    const dz = (this.sampleHeight(x, z + d) - this.sampleHeight(x, z - d)) / (2 * d)
    return Math.hypot(dx, dz)
  }

  clampX(x: number, margin = 4) {
    return Math.min(this.sizeX - margin, Math.max(margin, x))
  }
  clampZ(z: number, margin = 4) {
    return Math.min(this.sizeZ - margin, Math.max(margin, z))
  }
}
