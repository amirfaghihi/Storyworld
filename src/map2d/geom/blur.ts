/**
 * Separable box blur with clamped edges. Three passes are close to a Gaussian, which is what the
 * map wants: the 2 m biome and height grids have hard cell steps, and tracing or shading a blurred
 * copy turns those steps into curves before anything is drawn.
 */
export function boxBlur(src: ArrayLike<number>, w: number, h: number, r: number, passes = 1): Float32Array {
  const a = Float32Array.from(src)
  if (r < 1 || passes < 1) return a
  const b = new Float32Array(a.length)
  const inv = 1 / (2 * r + 1)
  for (let p = 0; p < passes; p++) {
    // rows: a -> b
    for (let y = 0; y < h; y++) {
      const row = y * w
      let acc = 0
      for (let x = -r; x <= r; x++) acc += a[row + (x < 0 ? 0 : x >= w ? w - 1 : x)]
      for (let x = 0; x < w; x++) {
        b[row + x] = acc * inv
        const add = x + r + 1
        const sub = x - r
        acc += a[row + (add >= w ? w - 1 : add)] - a[row + (sub < 0 ? 0 : sub)]
      }
    }
    // columns: b -> a
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let y = -r; y <= r; y++) acc += b[(y < 0 ? 0 : y >= h ? h - 1 : y) * w + x]
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc * inv
        const add = y + r + 1
        const sub = y - r
        acc += b[(add >= h ? h - 1 : add) * w + x] - b[(sub < 0 ? 0 : sub) * w + x]
      }
    }
  }
  return a
}
