import { useMemo } from 'react'
import * as THREE from 'three'
import { useWorld } from '@/world/WorldContext'
import { useSettingsStore, byQuality, atLeast } from '@/store/stores'
import { hash2 } from '@/terrain/faceColors'
import { BIOME } from '@/world/biomes'
import { getMoodMap, MOODS, MOOD_IDS, pickType, type Mood } from '@/vegetation/mood'
import { Instanced, makeGeometries, PALETTES } from '@/vegetation/Vegetation'
import type { Instance, ScatterResult, VegType } from '@/vegetation/scatter'
import type { GlobeField } from './globeField'
import type { World } from '@/world/schema'

const dirV = new THREE.Vector3()
const q = new THREE.Quaternion()

/** Area-uniform scatter over the latitude/longitude grid; every instance carries its local up. */
function globeScatter(globe: GlobeField, meta: World, density: number): ScatterResult {
  const res: ScatterResult = { pine: [], fir: [], round: [], oak: [], birch: [], mallorn: [], dead: [], rock: [], crag: [], bush: [], flower: [], fern: [], log: [], mushroom: [], glowcap: [] }
  const { width, height, cell } = globe
  const moodMap = getMoodMap(meta, globe.hf)
  const mpd = globe.metresPerDegree()
  const pxArea = (cell * mpd) * (cell * mpd) // m^2 per pixel at the equator
  for (let iz = 1; iz < height - 1; iz++) {
    const lat = 90 - (iz + 0.5) * cell
    const coslat = Math.cos(THREE.MathUtils.degToRad(lat))
    if (coslat < 0.05) continue
    for (let ix = 0; ix < width; ix++) {
      const i = iz * width + ix
      const b = globe.hf.biome[i]
      const h = globe.hf.data[i]
      if (b === BIOME.water || b === BIOME.riverbed || h < meta.seaLevel + 0.6) continue
      const r = hash2(ix, iz), r2 = hash2(ix * 3 + 11, iz * 5 + 17)
      const mood: Mood = MOODS[MOOD_IDS[moodMap[i]]]
      let type: VegType | null = null
      let per = 0 // desired instances per m^2
      let tall = false
      switch (b) {
        case BIOME.forest:
          per = 0.06 * mood.density
          type = h > 40 && r2 > 0.4 ? (r2 > 0.75 ? 'fir' : 'pine') : pickType(mood, hash2(ix * 13 + 1, iz * 17 + 9))
          tall = true
          break
        case BIOME.grass:
          if (r2 < 0.35) { per = 0.0035; type = pickType(mood, hash2(ix * 13 + 1, iz * 17 + 9)) }
          else if (r2 < 0.6) { per = 0.004; type = 'bush' }
          else { per = 0.008 * mood.flowers; type = 'flower' }
          break
        case BIOME.rock:
          per = 0.012
          type = r2 > 0.6 && h > 40 ? 'crag' : 'rock'
          break
        case BIOME.snow:
          per = 0.003
          type = 'rock'
          break
        case BIOME.sand:
          per = 0.0015
          type = r2 > 0.5 ? 'rock' : 'bush'
          break
      }
      if (!type) continue
      const p = per * pxArea * coslat * density
      if (r > p) continue
      const x = (ix + 0.5 + (r2 - 0.5) * 0.9) * cell
      const z = (iz + 0.5 + (hash2(ix + 99, iz + 7) - 0.5) * 0.9) * cell
      globe.dirFromMap(x, z, dirV)
      const slope = globe.slopeAtDir(dirV)
      if (type !== 'rock' && type !== 'crag' && slope > 0.95) continue
      const isTree = type === 'pine' || type === 'fir' || type === 'round' || type === 'oak' || type === 'birch'
      const groveIdx = (hash2(Math.floor(ix / 30), Math.floor(iz / 30)) * 0.75 + hash2(ix + 1, iz + 2) * 0.25) % 1
      const fams = (type === 'pine' || type === 'fir') && mood.conifer ? mood.conifer : mood.canopy
      const family = isTree ? fams[Math.floor(groveIdx * fams.length) % fams.length] : undefined
      const trunk = isTree ? (type === 'birch' ? (['#e8e4dc', '#f6f3ee'] as [string, string]) : mood.trunk[Math.floor(hash2(ix + 3, iz + 4) * mood.trunk.length) % mood.trunk.length]) : undefined
      const scale =
        type === 'rock' ? 0.7 + r2 * 1.3 : type === 'crag' ? 0.8 + r2 * 1.6 : type === 'flower' ? 0.6 + r2 * 0.6 : (tall ? 0.8 + hash2(ix + 5, iz + 3) * 0.7 : 0.6 + hash2(ix + 5, iz + 3) * 0.9) * (isTree ? mood.treeScale : 1)
      const hh = globe.heightAtDir(dirV)
      const pos = dirV.clone().multiplyScalar(globe.radius + hh)
      globe.frame(dirV, q)
      const inst: Instance = { x: pos.x, y: pos.y, z: pos.z, scale, rot: r2 * Math.PI * 2, tint: hash2(ix + 1, iz + 2), grove: groveIdx, family, trunk, tall, quat: [q.x, q.y, q.z, q.w] }
      res[type].push(inst)
    }
  }
  return res
}

export function GlobeVegetation() {
  const { meta, globe } = useWorld()
  const quality = useSettingsStore((s) => s.quality)
  const density = byQuality(quality, { low: 0.4, medium: 0.7, high: 1, ultra: 1 })
  const geos = useMemo(makeGeometries, [])
  const items = useMemo(() => {
    if (!globe) return null
    const t0 = performance.now()
    const r = globeScatter(globe, meta, density)
    if (import.meta.env.DEV) console.info(`globe vegetation: ${Object.entries(r).map(([k, v]) => `${k} ${v.length}`).join(', ')} in ${(performance.now() - t0).toFixed(0)} ms`)
    return r
  }, [globe, meta, density])
  if (!items) return null
  const asTrunk = (l: Instance[]) => l.map((t) => ({ ...t, family: t.trunk }))
  const short = (l: Instance[]) => l.filter((i) => !i.tall)
  const tall = (l: Instance[]) => l.filter((i) => i.tall)
  const shadows = atLeast(quality, 'high')
  const FADE = 5, FADE_TALL = 8
  return (
    <group name="vegetation">
      <Instanced geometry={geos.trunk} items={asTrunk([...short(items.pine), ...short(items.fir), ...short(items.round), ...short(items.oak)])} palette={PALETTES.trunk} castShadow={shadows} wind={0} nearFade={FADE} />
      <Instanced geometry={geos.tallTrunk} items={asTrunk([...tall(items.pine), ...tall(items.fir), ...tall(items.round), ...tall(items.oak)])} palette={PALETTES.trunk} castShadow={shadows} wind={0} nearFade={FADE_TALL} />
      <Instanced geometry={geos.pine} items={short(items.pine)} palette={PALETTES.pine} castShadow={shadows} nearFade={FADE} />
      <Instanced geometry={geos.tallPine} items={tall(items.pine)} palette={PALETTES.pine} castShadow={false} nearFade={FADE_TALL} />
      <Instanced geometry={geos.fir} items={short(items.fir)} palette={PALETTES.pine} castShadow={shadows} nearFade={FADE} />
      <Instanced geometry={geos.tallFir} items={tall(items.fir)} palette={PALETTES.pine} castShadow={false} nearFade={FADE_TALL} />
      <Instanced geometry={geos.round} items={short(items.round)} palette={PALETTES.round} castShadow={shadows} nearFade={FADE} />
      <Instanced geometry={geos.tallRound} items={tall(items.round)} palette={PALETTES.round} castShadow={false} nearFade={FADE_TALL} />
      <Instanced geometry={geos.oak} items={short(items.oak)} palette={PALETTES.round} castShadow={shadows} nearFade={FADE} />
      <Instanced geometry={geos.tallOak} items={tall(items.oak)} palette={PALETTES.round} castShadow={false} nearFade={FADE_TALL} />
      <Instanced geometry={geos.birch} items={asTrunk(short(items.birch))} palette={PALETTES.birchTrunk} castShadow={shadows} wind={0} nearFade={FADE} />
      <Instanced geometry={geos.birchCanopy} items={short(items.birch)} palette={PALETTES.round} castShadow={shadows} wind={1.4} nearFade={FADE} />
      <Instanced geometry={geos.tallBirch} items={asTrunk(tall(items.birch))} palette={PALETTES.birchTrunk} castShadow={shadows} wind={0} nearFade={FADE_TALL} />
      <Instanced geometry={geos.tallBirchCanopy} items={tall(items.birch)} palette={PALETTES.round} castShadow={false} wind={1.4} nearFade={FADE_TALL} />
      <Instanced geometry={geos.rock} items={items.rock} palette={PALETTES.rock} castShadow={false} wind={0} />
      <Instanced geometry={geos.crag} items={items.crag} palette={PALETTES.crag} castShadow={shadows} wind={0} />
      <Instanced geometry={geos.bush} items={items.bush} palette={PALETTES.bush} castShadow={false} wind={1.6} />
      <Instanced geometry={geos.flower} items={items.flower} palette={PALETTES.flower} castShadow={false} yOffset={-0.05} wind={2.5} />
    </group>
  )
}
