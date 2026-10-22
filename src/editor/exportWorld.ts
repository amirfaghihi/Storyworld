/**
 * Writes the edited world back to the same files the build script produces: terrain.png
 * (R,G = 16-bit height, B = biome) and world.json. In dev the Vite server saves them into
 * public/worlds/<id>/ so a reload round-trips; in production they download.
 */
import type { LoadedWorld } from '@/world/loadWorld'

export function encodeTerrain(world: LoadedWorld): HTMLCanvasElement {
  const { heightfield: hf, meta } = world
  if (!meta.terrain) throw new Error('this world has no terrain file (generated place)')
  const { heightOffset, heightScale } = meta.terrain
  const canvas = document.createElement('canvas')
  canvas.width = hf.width
  canvas.height = hf.height
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(hf.width, hf.height)
  const d = img.data
  for (let i = 0; i < hf.width * hf.height; i++) {
    const enc = Math.max(0, Math.min(65535, Math.round(((hf.data[i] - heightOffset) / heightScale) * 65535)))
    d[i * 4] = enc >> 8
    d[i * 4 + 1] = enc & 255
    d[i * 4 + 2] = hf.biome[i]
    d[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

export function worldJson(world: LoadedWorld): string {
  const m = world.meta
  const out = {
    ...m,
    landmarks: m.landmarks.map((l) => ({ ...l, position: [+l.position[0].toFixed(1), +l.position[1].toFixed(1)] })),
  }
  return JSON.stringify(out, null, 2) + '\n'
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'))
}

export async function saveToProject(world: LoadedWorld): Promise<string> {
  const png = await toBlob(encodeTerrain(world))
  const buf = new Uint8Array(await png.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  const res = await fetch('/__editor/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: world.meta.id, world: worldJson(world), terrainPng: btoa(bin) }),
  })
  if (!res.ok) throw new Error(`save failed: ${res.status} ${await res.text()}`)
  const j = (await res.json()) as { files: string[] }
  return j.files.join(', ')
}

export async function downloadWorld(world: LoadedWorld) {
  const png = await toBlob(encodeTerrain(world))
  const json = new Blob([worldJson(world)], { type: 'application/json' })
  for (const [name, blob] of [['terrain.png', png], ['world.json', json]] as const) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }
}
