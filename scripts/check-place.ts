// Measures a place the way the traveller will meet it, so a layout is judged by numbers rather
// than by eye. Builds the place and all of its props exactly as the app does (props register
// their colliders), then reports:
//   - ground, slope and biome at the spawn, the exit and every spot;
//   - a walk flood fill from the spawn on a 1 m grid that honours the controller's climb limits,
//     deep water, bridges and every solid prop (walls, hedges, buildings, shut gates), and lists
//     anything it cannot reach;
//   - the ground spread under every tall solid (a building's footprint): a large spread means one
//     end is buried or the other stands on stilts;
//   - colliders that overlap a spot centre, the spawn or the exit.
// Tree trunks are not included (they come from the vegetation tier at runtime).
// Usage: npx tsx scripts/check-place.ts <placeId | path/to/draft.ts> [--all]   (exit code 1 on any ** problem)
// A draft outside src/places/defs works too, as long as it exports `def` and imports only types.
import { buildPlace } from '../src/places/buildPlace.ts'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildProps, KINDS } from '../src/dressing/propKinds.ts'
import { setColliderLayer, pointInSolid, deckHeight, MAX_SLOPE, STEP_UP, WADE_DEPTH } from '../src/player/collision.ts'
import type { Collider } from '../src/player/colliderTypes.ts'
import type { PlaceDef } from '../src/places/types.ts'

const id = process.argv[2]
if (!id) {
  console.error('usage: npx tsx scripts/check-place.ts <placeId | path/to/draft.ts> [--all]')
  process.exit(2)
}
const file = id.endsWith('.ts') ? pathToFileURL(path.resolve(id)).href : `../src/places/defs/${id}.ts`
const { def } = (await import(file)) as { def: PlaceDef }
const BIOME = ['water', 'sand', 'grass', 'forest', 'rock', 'snow', 'ash', 'marsh', 'road', 'riverbed']
let problems = 0
const flag = (msg: string) => {
  problems++
  return `  ** ${msg}`
}

const t0 = performance.now()
const place = buildPlace(def, [0, 0])
const tBuild = performance.now() - t0
const { heightfield: hf, surface, meta } = place
const colliders: Collider[] = []
for (const l of meta.landmarks) if (l.dressing?.props.length) buildProps(l, surface, meta.seaLevel, meta.seed, colliders)
setColliderLayer('props', colliders)
const unknown = new Set<string>()
for (const l of meta.landmarks) for (const p of l.dressing?.props ?? []) if (!KINDS[p.kind]) unknown.add(p.kind)
const tAll = performance.now() - t0

const counts: Record<number, number> = {}
let lo = Infinity, hi = -Infinity
for (let i = 0; i < hf.data.length; i++) {
  lo = Math.min(lo, hf.data[i])
  hi = Math.max(hi, hf.data[i])
  counts[hf.biome[i]] = (counts[hf.biome[i]] ?? 0) + 1
}
console.log(`${def.name}: ${def.size[0]} x ${def.size[1]} m, cell ${def.cell}, height ${lo.toFixed(1)} .. ${hi.toFixed(1)} m, sea ${def.seaLevel}`)
console.log('biomes: ' + Object.entries(counts).map(([b, n]) => `${BIOME[+b]} ${((n / hf.data.length) * 100).toFixed(1)}%`).join(', '))
if (unknown.size) console.log(`unknown prop kinds (not built, so not checked): ${[...unknown].join(', ')}`)
console.log(`built in ${tBuild.toFixed(0)} ms (terrain) / ${tAll.toFixed(0)} ms (with props); ${meta.landmarks.length} spots, ${colliders.length} colliders`)

// the height the feet are at: a deck where one is within reach of the ground, else the drawn ground
function walkY(x: number, z: number): number {
  const g = surface.height(x, z)
  const d = deckHeight(x, z)
  return d > g - 0.5 && d < g + 6 ? Math.max(d, g) : g
}
const wet = (x: number, z: number) => surface.height(x, z) < def.seaLevel - WADE_DEPTH && !(deckHeight(x, z) > -Infinity)
const blocked = (x: number, z: number) => pointInSolid(x, walkY(x, z) + STEP_UP * 0.5, z, true)

console.log('\nwhere                          ground  slope  biome')
const pts: [string, number, number][] = [['SPAWN', def.spawn[0], def.spawn[1]], ['EXIT', def.exit.x, def.exit.z]]
for (const s of def.spots) pts.push([`${s.id} (${s.displayName})`, s.position[0], s.position[1]])
for (const [name, x, z] of pts) {
  const y = surface.height(x, z)
  const sl = hf.slopeAt(x, z)
  // a spot is often centred on its own building or pond, so only the spawn and exit must be clear
  const hard = name === 'SPAWN' || name === 'EXIT'
  let warn = ''
  if (sl > MAX_SLOPE) warn += hard ? flag('too steep to stand') : '  (steep)'
  if (wet(x, z)) warn += hard ? flag('under water') : '  (water)'
  if (blocked(x, z)) warn += hard ? flag('inside a solid prop') : '  (inside a prop)'
  console.log(`${name.slice(0, 30).padEnd(30)} ${y.toFixed(1).padStart(6)}  ${sl.toFixed(2).padStart(5)}  ${BIOME[hf.biomeAt(x, z)]}${warn}`)
}

// walk flood fill on a 1 m grid
const STEP = 1
const GW = Math.floor(def.size[0] / STEP), GH = Math.floor(def.size[1] / STEP)
const ys = new Float32Array(GW * GH)
const ok = new Uint8Array(GW * GH)
for (let j = 0; j < GH; j++)
  for (let i = 0; i < GW; i++) {
    const x = (i + 0.5) * STEP, z = (j + 0.5) * STEP
    ys[j * GW + i] = walkY(x, z)
    ok[j * GW + i] = wet(x, z) || blocked(x, z) ? 0 : 1
  }
const cellOf = (x: number, z: number) => Math.min(GH - 1, Math.max(0, Math.floor(z / STEP))) * GW + Math.min(GW - 1, Math.max(0, Math.floor(x / STEP)))
const seen = new Uint8Array(GW * GH)
const start = cellOf(def.spawn[0], def.spawn[1])
const stack = [start]
seen[start] = 1
let reached = 0, open = 0
for (let k = 0; k < ok.length; k++) open += ok[k]
const rise = Math.max(STEP_UP, MAX_SLOPE * STEP)
while (stack.length) {
  const k = stack.pop()!
  reached++
  const i = k % GW, j = (k / GW) | 0
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ni = i + di, nj = j + dj
    if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue
    const n = nj * GW + ni
    if (seen[n] || !ok[n] || Math.abs(ys[n] - ys[k]) > rise) continue
    seen[n] = 1
    stack.push(n)
  }
}
console.log(`\nwalkable from the spawn: ${((reached / (GW * GH)) * 100).toFixed(0)}% of the map, ${((reached / Math.max(1, open)) * 100).toFixed(0)}% of the open ground`)
const reach = (name: string, x: number, z: number, r = 3) => {
  // reachable if any grid cell within r of the point was reached
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dz * dz <= r * r && seen[cellOf(x + dx, z + dz)]) return
  console.log(flag(`unreachable: ${name} at ${x.toFixed(0)},${z.toFixed(0)}`))
}
// a spot counts as reached when the traveller can get inside the radius that discovers it
for (const s of def.spots) reach(s.id, s.position[0], s.position[1], s.discoverRadius ?? 14)
reach('the exit', def.exit.x, def.exit.z, def.exit.radius ?? 3)

// ground spread under tall solids: one per building-like collider
console.log('\nbuilding footprints                     spread  (a water mill straddling its bank is expected)')
let tall = 0
for (const c of colliders) {
  if (c.kind === 'deck') continue
  const g = surface.height(c.x, c.z)
  if (c.top === undefined || c.top - g < 2.5) continue
  const isBox = c.kind === 'box'
  // only building-sized footprints: posts, walls and fences are thin and follow the ground
  if (isBox ? Math.min(c.hw, c.hd) < 1.5 : c.r < 1.5) continue
  const mn = isBox ? surface.footprintMinRect(c.x, c.z, c.hw, c.hd, c.rot) : surface.footprintMin(c.x, c.z, c.r)
  const mx = isBox ? surface.footprintMaxRect(c.x, c.z, c.hw, c.hd, c.rot) : surface.footprintMax(c.x, c.z, c.r)
  const size = isBox ? `${(c.hw * 2).toFixed(1)}x${(c.hd * 2).toFixed(1)}` : `r${c.r.toFixed(1)}`
  const spread = mx - mn
  const owner = def.spots.reduce((b, s) => (Math.hypot(s.position[0] - c.x, s.position[1] - c.z) < Math.hypot(b.position[0] - c.x, b.position[1] - c.z) ? s : b), def.spots[0])
  tall++
  if (spread > 1.2 || process.argv.includes('--all'))
    console.log(`${`${owner.id} ${c.kind} ${size}`.padEnd(38)} ${spread.toFixed(2).padStart(5)} m at ${c.x.toFixed(0)},${c.z.toFixed(0)}${spread > 1.2 ? flag('uneven ground under a building') : ''}`)
}
console.log(`${tall} building footprints checked${process.argv.includes('--all') ? '' : ' (only problems listed; --all lists every one)'}`)

console.log(problems ? `\n${problems} problem(s)` : '\nno problems')
process.exit(problems ? 1 : 0)
