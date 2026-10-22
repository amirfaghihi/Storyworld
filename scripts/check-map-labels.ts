// Regression check for the map's lettering (src/map2d/labels.ts) and place search (src/map2d/search.ts).
// Runs the dialog's own layout code for Middle-earth, Bree and Hobbiton at four window sizes and three
// zooms, measuring text with node-canvas in the font the map uses, and asserts that:
//   - no two names overlap, no name sits on a marker, a '+n' chip, a control or (in places) a building
//     or smial footprint, nothing runs off the map, and no '+n' chip sits under another marker;
//   - Middle-earth letters at least 30 places at fit in a 1400×900 window, and Bree and Hobbiton every spot;
//   - the pairs that used to collide never do (Rhovanion/Mirkwood, Hobbiton/The Shire, Minas Tirith/
//     Osgiliath/Minas Morgul, the Crossing of the Ways/the West Gate, the Prancing Pony/the Inn-yard);
//   - names keep their slots between zoom steps (no more than 10% move per 10% of zoom), and once
//     the camera rests after zooming out to fit, as many are lettered as in a fresh layout;
//   - search finds annuminas, barad dur, rhun and lake town first;
//   - the town plans the map draws agree with the 3D pieces: every building's box collider, as
//     LandmarkProps registers it, lies inside that building's drawn footprint (within 0.3 m), and
//     every footprint inside its collider (src/map2d/placeFeatures.ts).
// Exit code 1 on any failure.
// Usage: npx tsx scripts/check-map-labels.ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { createCanvas } from 'canvas'
import { WorldSchema, LoreSchema, type World, type Lore } from '../src/world/schema.ts'
import { buildPlace } from '../src/places/buildPlace.ts'
import { def as bree } from '../src/places/defs/bree.ts'
import { def as hobbiton } from '../src/places/defs/hobbiton.ts'
import { markerModels, EXIT_ID, type MarkerModel } from '../src/map2d/markers.ts'
import { layoutMapFrame, regionAnchors, discHitsBox, countChipBox, MAJOR_PRIORITY, type LabelLayout, type MapFrame, type RegionAnchors } from '../src/map2d/labels.ts'
import { overlaps, type AABB } from '../src/map2d/geom/spatialHash.ts'
import { buildSearchIndex, searchPlaces, type SearchSource } from '../src/map2d/search.ts'
import { basePriority } from '../src/map2d/markers.ts'
import { extractPlaceFeatures, PLAN_KINDS, type PlaceFeatures } from '../src/map2d/placeFeatures.ts'
import { buildProps } from '../src/dressing/propKinds.ts'
import type { Collider } from '../src/player/colliderTypes.ts'
import type { LoadedWorld } from '../src/world/loadWorld.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let failures = 0
const fail = (msg: string) => {
  failures++
  console.log('  FAIL ' + msg)
}

// ---- text measurement: node-canvas in the dialog's font. Chrome on a Mac resolves the --font-ui stack to
// system-ui; node-canvas does not know 'Segoe UI' and would fall back, so measure with system-ui itself.
const mctx = createCanvas(8, 8).getContext('2d')
const widths = new Map<string, number>()
const measure = (text: string, font: string) => {
  const key = font + '|' + text
  let w = widths.get(key)
  if (w === undefined) {
    mctx.font = font.replace(/system-ui, -apple-system, [^]*?sans-serif/, 'system-ui')
    w = mctx.measureText(text).width
    widths.set(key, w)
  }
  return w
}

// ---- worlds: decoded the way loadWorld.ts does; only meta, lore and the map bounds matter here
interface W {
  name: string
  meta: World
  lore: Lore
  fit: [number, number, number, number]
  /** places: the built world and its town plan */
  world?: LoadedWorld
  plan?: PlaceFeatures
}
function overworld(id: string): W {
  const dir = path.join(root, 'public/worlds', id)
  const meta = WorldSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, 'world.json'), 'utf8')))
  const lore = LoreSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, 'lore.json'), 'utf8')))
  const png = PNG.sync.read(fs.readFileSync(path.join(dir, meta.terrain!.file)))
  const b: [number, number, number, number] = [0, 0, (png.width - 1) * meta.cell, (png.height - 1) * meta.cell]
  return { name: id, meta, lore, fit: clip(meta, b) }
}
function place(name: string, d: typeof bree): W {
  const w = buildPlace(d, [0, 0])
  const hf = w.heightfield
  const b: [number, number, number, number] = [0, 0, (hf.width - 1) * hf.cell, (hf.height - 1) * hf.cell]
  return { name, meta: w.meta, lore: w.lore, fit: clip(w.meta, b), world: w, plan: extractPlaceFeatures(w) }
}
function clip(meta: World, b: [number, number, number, number]): [number, number, number, number] {
  const mb = meta.mapBounds
  return mb ? [Math.max(b[0], mb[0]), Math.max(b[1], mb[1]), Math.min(b[2], mb[2]), Math.min(b[3], mb[3])] : b
}

// ---- the dialog's chrome at a window size (map.css): the map viewport and the controls drawn over it
interface Screen {
  W: number
  H: number
  vw: number
  vh: number
  touch: boolean
  reserved: AABB[]
  /** viewport rows the bottom sheet covers (phones) */
  bottom: number
}
function screenFor(W: number, H: number): Screen {
  const narrow = W <= 760
  const touch = W <= 820
  const ctl = touch ? 44 : 36
  const rect = (x0: number, y0: number, w: number, h: number): AABB => ({ x0, y0, x1: x0 + w, y1: y0 + h })
  if (!narrow) {
    // sheet inset 16 px with a 1 px border; a 56 px header (its rule included)
    const vw = W - 34
    const vh = H - 34 - 56
    const m = 16
    const controls = 4 * ctl + 5
    return {
      W,
      H,
      vw,
      vh,
      touch,
      bottom: 0,
      reserved: [
        rect(m, m, 48, 48), // compass
        rect(vw - m - ctl, vh - m - controls, ctl, controls), // zoom, locate, fit
        rect(m, vh - m - 34, 150, 34), // scale bar
        rect(m, vh - m - 34 - 8 - ctl, 96, ctl), // legend toggle
        rect(vw / 2 - 260, vh - 26, 520, 26), // attribution
      ],
    }
  }
  // phones: full bleed, 52 px header, bottom sheet peeking 76 px over the map
  const vw = W
  const vh = H - 52
  const peek = 76
  const m = 12
  const controls = 2 * ctl + 3
  return {
    W,
    H,
    vw,
    vh,
    touch,
    bottom: peek,
    reserved: [
      rect(m, m, 40, 40),
      rect(vw - m - ctl, vh - peek - m - controls, ctl, controls),
      rect(m, vh - peek - m - 34, 130, 34), // scale bar
      rect(m, vh - peek - m - 34 - 8 - ctl, 96, ctl), // legend toggle
      rect(0, vh - peek, vw, peek), // the sheet's peek
    ],
  }
}

function fitScale(w: W, sc: Screen): number {
  const [x0, z0, x1, z1] = w.fit
  const pad = 24
  return Math.min((sc.vw - 2 * pad) / (x1 - x0), (sc.vh - sc.bottom - 2 * pad) / (z1 - z0))
}

function modelsOf(w: W): MarkerModel[] {
  const exit = w.meta.place?.exit
  return markerModels(w.meta.landmarks, new Set(), exit ? { x: exit.x, z: exit.z, label: exit.label } : undefined)
}

// ---- verification of one layout, independent of the solver's own bookkeeping
interface Drawn {
  id: string
  text: string
  box: AABB
  kind: 'place' | 'region'
}
function drawnOf(frame: MapFrame, w: W, names: Map<string, string>): Drawn[] {
  const out: Drawn[] = []
  for (const [id, p] of frame.layout.places) if (p) out.push({ id, text: frame.clusters.find((c) => c.top.id === id)!.top.name, box: p.box, kind: 'place' })
  for (const [id, r] of frame.layout.regions) if (r) out.push({ id, text: names.get(id) ?? id, box: r.box, kind: 'region' })
  void w
  return out
}
/** Whether a convex polygon (screen px, x, y pairs) and a box overlap (separating axes). */
function polyHitsBox(poly: number[], b: AABB): boolean {
  const xs = poly.filter((_, i) => i % 2 === 0)
  const ys = poly.filter((_, i) => i % 2 === 1)
  if (Math.max(...xs) <= b.x0 || Math.min(...xs) >= b.x1 || Math.max(...ys) <= b.y0 || Math.min(...ys) >= b.y1) return false
  const corners = [b.x0, b.y0, b.x1, b.y0, b.x1, b.y1, b.x0, b.y1]
  const n = poly.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const nx = -(poly[2 * j + 1] - poly[2 * i + 1])
    const ny = poly[2 * j] - poly[2 * i]
    const proj = (a: number[]) => a.filter((_, k) => k % 2 === 0).map((x, k) => x * nx + a[2 * k + 1] * ny)
    const p = proj(poly)
    const q = proj(corners)
    if (Math.max(...p) <= Math.min(...q) || Math.max(...q) <= Math.min(...p)) return false
  }
  return true
}

/** A place's building and smial outlines in screen px for a view. */
function footprintsOnScreen(plan: PlaceFeatures | undefined, view: { cx: number; cz: number; s: number; vw: number; vh: number }): number[][] {
  if (!plan) return []
  return [...plan.buildings, ...plan.smials].map((b) => [...b.ring].map((v, i) => (i % 2 === 0 ? view.vw / 2 + (v - view.cx) * view.s : view.vh / 2 + (v - view.cz) * view.s)))
}

function verify(tag: string, frame: MapFrame, drawn: Drawn[], sc: Screen, footprints: number[][] = []): number {
  let bad = 0
  const r = frame.markerSize / 2
  const tooBad = (m: string) => {
    bad++
    if (bad <= 6) fail(`${tag}: ${m}`)
  }
  for (let i = 0; i < drawn.length; i++) {
    const a = drawn[i]
    if (a.box.x0 < 0 || a.box.y0 < 0 || a.box.x1 > sc.vw || a.box.y1 > sc.vh) tooBad(`'${a.text}' runs off the map`)
    for (let j = i + 1; j < drawn.length; j++) if (overlaps(a.box, drawn[j].box)) tooBad(`'${a.text}' overlaps '${drawn[j].text}'`)
    for (const c of frame.clusters) {
      if (discHitsBox({ x: c.px, y: c.py, r }, a.box)) tooBad(`'${a.text}' covers the marker of '${c.top.name}'`)
      if (c.members.length > 1 && overlaps(countChipBox(c.px, c.py, r, c.chip), a.box)) tooBad(`'${a.text}' covers the +n chip of '${c.top.name}'`)
    }
    for (const u of sc.reserved) if (overlaps(u, a.box)) tooBad(`'${a.text}' runs under a map control`)
    for (const f of footprints) if (polyHitsBox(f, a.box)) tooBad(`'${a.text}' sits on a building footprint`)
  }
  // a '+n' chip never sits under another badge (drawn later, it would hide the count): it has a
  // clear corner, or its marker is lifted over its neighbours (chipOver), which only another
  // lifted marker could cover
  for (const c of frame.clusters) {
    if (c.members.length < 2) continue
    const chip = countChipBox(c.px, c.py, r, c.chip)
    for (const o of frame.clusters) {
      if (o === c || !discHitsBox({ x: o.px, y: o.py, r: r + 1 }, chip)) continue
      if (!c.chipOver || o.chipOver) tooBad(`the +n chip of '${c.top.name}' is under the marker of '${o.top.name}'`)
    }
  }
  return bad
}

// ---- run
const worlds = [overworld('middle-earth'), place('bree', bree), place('hobbiton', hobbiton)]
const SCREENS: [number, number][] = [
  [1400, 900],
  [1920, 1080],
  [768, 1024],
  [390, 844],
]
const ZOOMS = [1, 2, 4]
const PAIRS: Record<string, [string, string][]> = {
  'middle-earth': [
    ['rhovanion', 'mirkwood'],
    ['hobbiton', 'shire'],
    ['minas-tirith', 'osgiliath'],
    ['minas-tirith', 'minas-morgul'],
    ['osgiliath', 'minas-morgul'],
  ],
  bree: [
    ['the-crossing', 'west-gate'],
    ['prancing-pony', 'inn-yard'],
  ],
  hobbiton: [],
}

for (const w of worlds) {
  const models = modelsOf(w)
  const anchors: RegionAnchors[] = regionAnchors(w.meta.regions, w.fit)
  const names = new Map(w.meta.regions.map((r) => [r.id, r.displayName]))
  const textOf = (id: string) => names.get(id) ?? models.find((m) => m.id === id)?.name ?? id
  console.log(`\n${w.name}: ${models.length} markers (${w.meta.landmarks.filter((l) => !l.hidden).length} landmarks${w.meta.place ? ' + the way out' : ''}), ${w.meta.regions.length} regions`)
  for (const [W, H] of SCREENS) {
    const sc = screenFor(W, H)
    const fit = fitScale(w, sc)
    const cx = (w.fit[0] + w.fit[2]) / 2
    const cz = (w.fit[1] + w.fit[3]) / 2
    const row: string[] = []
    for (const z of ZOOMS) {
      const s = fit * z
      // zoomed views centre on the spot the traveller is most likely to look at: the spawn point
      const view = z === 1 ? { cx, cz: cz + (sc.bottom / 2) / s, s, vw: sc.vw, vh: sc.vh } : { cx: w.meta.spawn[0], cz: w.meta.spawn[1], s, vw: sc.vw, vh: sc.vh }
      const frame = layoutMapFrame({ models, anchors, regionNames: names, view, touch: sc.touch, reserved: sc.reserved, obstacles: w.plan?.reserved, measure, player: { x: w.meta.spawn[0], z: w.meta.spawn[1] } })
      const drawn = drawnOf(frame, w, names)
      const tag = `${w.name} ${W}×${H} ${z}×`
      const bad = verify(tag, frame, drawn, sc, footprintsOnScreen(w.plan, view))
      const placed = [...frame.layout.places.values()].filter(Boolean).length
      const regs = [...frame.layout.regions.values()].filter(Boolean).length
      const merged = frame.clusters.reduce((n, c) => n + c.members.length - 1, 0)
      row.push(`${z}×: ${placed}/${frame.clusters.length} names${merged > 0 ? ` (+${merged} merged)` : ''}, ${regs} regions${bad ? `, ${bad} problems` : ''}`)

      // named pairs: never overlapping, neither name on the other's marker
      for (const [a, b] of PAIRS[w.name]) {
        const da = drawn.find((d) => d.id === a)
        const db = drawn.find((d) => d.id === b)
        if (da && db && overlaps(da.box, db.box)) fail(`${tag}: '${textOf(a)}' overlaps '${textOf(b)}'`)
      }

      if (z === 1 && W === 1400) {
        const total = models.length
        if (w.name === 'middle-earth') {
          if (placed < 30) fail(`${tag}: only ${placed} place names at fit (want ≥ 30 of ${total})`)
        } else {
          const missing = models.filter((m) => !frame.layout.places.get(m.id))
          if (missing.length) fail(`${tag}: unlabelled at fit: ${missing.map((m) => m.name).join(', ')}`)
        }
        const hidden = models.filter((m) => !frame.layout.places.get(m.id)).map((m) => m.name)
        if (hidden.length) row.push(`[no name at fit: ${hidden.join(', ')}]`)
      }
    }
    // hysteresis: zoom in by 10% steps from fit to 2×, re-laying out from the previous layout each
    // time. A name whose old position would now run off the map or under a control has to move (its
    // marker is being pushed toward the edge); every other change of position counts as churn.
    let prev: LabelLayout | null = null
    let worst = 0
    let edgeMoves = 0
    let steps = 0
    for (let k = 0; k <= 7; k++) {
      const s = fit * Math.pow(1.1, k)
      const view = { cx, cz, s, vw: sc.vw, vh: sc.vh }
      const frame = layoutMapFrame({ models, anchors, regionNames: names, view, touch: sc.touch, reserved: sc.reserved, obstacles: w.plan?.reserved, measure, prev })
      if (prev) {
        let both = 0
        let moved = 0
        for (const [id, p] of frame.layout.places) {
          const q = prev.places.get(id)
          if (!p || !q) continue
          both++
          if (p.slot === q.slot && p.slide === q.slide && p.far === q.far) continue
          const c = frame.clusters.find((c) => c.top.id === id)!
          const old: AABB = { x0: c.px + q.dx, y0: c.py + q.dy, x1: c.px + q.dx + q.w, y1: c.py + q.dy + q.h }
          // a marker that was merged into a neighbour and has just separated takes its place too
          const r = frame.markerSize / 2
          // ...and so does one whose old box a building now covers (buildings grow as the map zooms)
          const forced =
            old.x0 < 8 ||
            old.y0 < 8 ||
            old.x1 > sc.vw - 8 ||
            old.y1 > sc.vh - 8 ||
            sc.reserved.some((u) => overlaps(u, old)) ||
            frame.clusters.some((o) => o !== c && discHitsBox({ x: o.px, y: o.py, r }, old)) ||
            frame.polys.some((q) => polyHitsBox(Array.from(q.pts), old))
          if (forced) edgeMoves++
          else moved++
          if (process.env.CHURN) {
            const by = [...frame.layout.places].filter(([o, b]) => o !== id && b && overlaps(b.box, old)).map(([o]) => o)
            console.log(`    churn ${w.name} ${W}×${H} step ${k}: ${id} ${q.slot}${q.slide}+${q.far} → ${p.slot}${p.slide}+${p.far}${forced ? ' (forced)' : ''}${by.length ? ` old spot now under ${by.join(', ')}` : ''}`)
          }
        }
        if (both) worst = Math.max(worst, moved / both)
        steps++
      }
      prev = frame.layout
    }
    if (worst > 0.1) fail(`${w.name} ${W}×${H}: ${(worst * 100).toFixed(0)}% of names changed slot in one 10% zoom step`)
    // the way there does not matter once the camera rests: zooming out from 4× (around the spawn
    // point and the first major places) to fit, each layout from the last, then the layout the
    // camera's settling asks for, letters as many names as a fresh layout of the same view
    {
      const fitView = { cx, cz: cz + sc.bottom / 2 / fit, s: fit, vw: sc.vw, vh: sc.vh }
      const lay = (view: typeof fitView, prev: LabelLayout | null, settled: boolean) =>
        layoutMapFrame({ models, anchors, regionNames: names, view, touch: sc.touch, reserved: sc.reserved, obstacles: w.plan?.reserved, measure, prev, settled })
      const count = (f: MapFrame) => [...f.layout.places.values()].filter(Boolean).length
      const fresh = count(lay(fitView, null, false))
      const starts = [w.meta.spawn, ...models.filter((m) => m.priority >= MAJOR_PRIORITY).slice(0, 4).map((m) => [m.x, m.z] as [number, number])]
      let worstPath = Infinity
      for (const [sx, sz] of starts) {
        let prev: LabelLayout | null = null
        const N = 16
        for (let k = 0; k <= N; k++) {
          const t = k / N
          prev = lay({ cx: sx + (fitView.cx - sx) * t, cz: sz + (fitView.cz - sz) * t, s: fit * Math.pow(4, 1 - t), vw: sc.vw, vh: sc.vh }, prev, false).layout
        }
        const got = count(lay(fitView, prev, true))
        worstPath = Math.min(worstPath, got)
        if (got < fresh) fail(`${w.name} ${W}×${H}: zoomed out to fit from (${sx.toFixed(0)}, ${sz.toFixed(0)}), ${got} names once settled, ${fresh} fresh`)
      }
      row.push(`[after zooming out: ≥ ${worstPath} names, fresh ${fresh}]`)
    }
    console.log(`  ${String(W).padStart(4)}×${H}  fit s=${fit.toFixed(2)}  ${row.join('  ')}  slot churn ≤ ${(worst * 100).toFixed(0)}% per step (+${edgeMoves} forced by the edge or a marker, in ${steps} steps)`)
  }
}

// ---- search
console.log('\nsearch:')
{
  const w = worlds[0]
  const sources: SearchSource[] = [
    ...w.meta.landmarks.filter((l) => !l.hidden).map((l) => ({ id: l.id, kind: 'landmark' as const, name: l.displayName, x: l.position[0], z: l.position[1], priority: basePriority(l.type, !!l.placeId) })),
    ...w.meta.regions.map((r) => ({ id: r.id, kind: 'region' as const, name: r.displayName, x: r.polygon[0][0], z: r.polygon[0][1], priority: 1 })),
  ]
  const index = buildSearchIndex(sources)
  const cases: [string, string][] = [
    ['annuminas', 'annuminas'],
    ['barad dur', 'barad-dur'],
    ['rhun', 'rhun'],
    ['lake town', 'esgaroth'],
    ['Lake-town', 'esgaroth'],
    ['minas tirth', 'minas-tirith'],
    ['prancing', ''],
    ['old forest', 'old-forest'],
    ['erebor', 'erebor'],
    ['mordor', 'mordor'],
    ['helms deep', 'helms-deep'],
    ['thranduils', 'thranduils-halls'],
  ]
  for (const [q, want] of cases) {
    const hits = searchPlaces(index, q)
    const got = hits[0]?.entry.id ?? ''
    const ok = got === want
    if (!ok) fail(`search '${q}' → '${got}' (want '${want || 'nothing'}')`)
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} '${q}' → ${hits.slice(0, 3).map((h) => `${h.entry.name} (${h.score.toFixed(0)})`).join(', ') || 'no match'}`)
  }
  // places: the way out is searchable too
  const b = worlds[1]
  const bi = buildSearchIndex([
    ...b.meta.landmarks.map((l) => ({ id: l.id, kind: 'landmark' as const, name: l.displayName, x: l.position[0], z: l.position[1], priority: basePriority(l.type, false) })),
    { id: EXIT_ID, kind: 'exit' as const, name: b.meta.place!.exit.label, x: 0, z: 0, priority: 4 },
  ])
  for (const [q, want] of [
    ['pony', 'prancing-pony'],
    ['crossing', 'the-crossing'],
    ['out', EXIT_ID],
  ] as const) {
    const got = searchPlaces(bi, q)[0]?.entry.id ?? ''
    if (got !== want) fail(`bree search '${q}' → '${got}' (want '${want}')`)
    else console.log(`  ok   bree '${q}' → ${got}`)
  }
}

// ---- town plans vs colliders
// Each prop is built on its own, exactly as buildProps does it (same surface, same seed), with a
// collider list: a building is a box collider at least 1.2 m deep both ways, 6 m² and 2.4 m tall.
// Its rect must lie inside the drawn footprint of that prop (every point of its outline within
// 0.3 m of the footprint), and the footprint inside it, so the plan shows what you bump into.
console.log('\ntown plans:')
{
  const TOL = 0.3
  const inside = (ring: Float32Array, x: number, z: number) => {
    let c = false
    for (let i = 0, j = ring.length / 2 - 1; i < ring.length / 2; j = i++) {
      const [xi, zi, xj, zj] = [ring[2 * i], ring[2 * i + 1], ring[2 * j], ring[2 * j + 1]]
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c
    }
    return c
  }
  const segDist = (x: number, z: number, ax: number, az: number, bx: number, bz: number) => {
    const dx = bx - ax
    const dz = bz - az
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
    return Math.hypot(x - ax - t * dx, z - az - t * dz)
  }
  /** how far (x, z) lies outside a ring (0 inside) */
  const outside = (ring: Float32Array, x: number, z: number) => {
    if (inside(ring, x, z)) return 0
    let d = Infinity
    const n = ring.length / 2
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      d = Math.min(d, segDist(x, z, ring[2 * i], ring[2 * i + 1], ring[2 * j], ring[2 * j + 1]))
    }
    return d
  }
  /** distance from (x, z) to a polyline */
  const lineDist = (pts: Float32Array, x: number, z: number) => {
    let d = Infinity
    for (let i = 0; i + 3 < pts.length; i += 2) d = Math.min(d, segDist(x, z, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]))
    return d
  }
  /** points round a ring's outline, 9 per side */
  const outline = (ring: Float32Array) => {
    const out: [number, number][] = []
    const n = ring.length / 2
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      for (let k = 0; k < 9; k++) out.push([ring[2 * i] + ((ring[2 * j] - ring[2 * i]) * k) / 9, ring[2 * i + 1] + ((ring[2 * j + 1] - ring[2 * i + 1]) * k) / 9])
    }
    return out
  }
  const boxRing = (c: Extract<Collider, { kind: 'box' }>) => {
    const cs = Math.cos(c.rot)
    const sn = Math.sin(c.rot)
    // the same local → world turn as propUtil.at
    return Float32Array.from([-1, -1, 1, -1, 1, 1, -1, 1].flatMap((v, i, a) => (i % 2 ? [] : [c.x + cs * v * c.hw + sn * a[i + 1] * c.hd, c.z - sn * v * c.hw + cs * a[i + 1] * c.hd])))
  }
  /** how far (x, z) lies outside a collider's outline (0 inside) */
  const outsideCollider = (c: Collider, x: number, z: number) => (c.kind === 'circle' ? Math.max(0, Math.hypot(x - c.x, z - c.z) - c.r) : c.kind === 'box' ? outside(boxRing(c), x, z) : Infinity)

  /**
   * Holds one place's plan to the colliders its props register: every building collider inside a
   * footprint drawn from that prop and every footprint inside one of its colliders, gate posts on
   * their post colliders, mill wheels along their wheel colliders.
   */
  function checkPlan(name: string, world: LoadedWorld, plan: PlaceFeatures) {
    const { meta, surface } = world
    let buildings = 0
    let worst = 0
    let worstBack = 0
    let posts = 0
    let wheels = 0
    const byProp = <T extends { of?: string }>(list: T[]) => {
      const m = new Map<string, T[]>()
      for (const x of list) if (x.of) m.set(x.of, [...(m.get(x.of) ?? []), x])
      return m
    }
    const footprints = byProp(plan.buildings)
    const gates = byProp(plan.gates)
    const wheelBars = byProp(plan.wheels)
    const wallLines = byProp(plan.walls)
    let wallBoxes = 0
    let matched = 0
    for (const lm of meta.landmarks) {
      ;(lm.dressing?.props ?? []).forEach((p, i) => {
        const key = `${lm.id}/${i}`
        const drawn = footprints.get(key) ?? []
        matched += drawn.length
        const col: Collider[] = []
        buildProps({ position: lm.position, dressing: { props: [p] } }, surface, meta.seaLevel, meta.seed + i, col)
        const tagOf = (x: number, z: number) => `${name} ${lm.id} ${p.kind} at (${x.toFixed(1)}, ${z.toFixed(1)})`
        // a wall is drawn as a line its width: every box of it lies within the line
        const walls = wallLines.get(key)
        if (walls) {
          for (const c of col) {
            if (c.kind !== 'box') continue
            wallBoxes++
            const off = Math.max(...outline(boxRing(c)).map(([x, z]) => Math.min(...walls.map((l) => lineDist(l.pts, x, z) - l.width / 2))))
            worst = Math.max(worst, off)
            if (off > TOL) fail(`${tagOf(c.x, c.z)}: a wall collider reaches ${off.toFixed(2)} m outside the drawn wall`)
          }
        }
        for (const c of col) {
          if (c.kind !== 'box' || walls) continue
          const tall = (c.top ?? 0) - surface.height(c.x, c.z)
          if (Math.min(c.hw, c.hd) < 1.2 || 4 * c.hw * c.hd < 6 || tall < 2.4) continue
          buildings++
          if (!drawn.length) {
            fail(`${tagOf(c.x, c.z)}: a building collider with no footprint on the map`)
            continue
          }
          const pts = outline(boxRing(c))
          const out = Math.min(...drawn.map((d) => Math.max(...pts.map(([x, z]) => outside(d.ring, x, z)))))
          worst = Math.max(worst, out)
          if (out > TOL) fail(`${tagOf(c.x, c.z)}: the collider reaches ${out.toFixed(2)} m outside the drawn footprint`)
        }
        for (const d of drawn) {
          const pts = outline(d.ring)
          const back = Math.min(...col.map((c) => Math.max(...pts.map(([x, z]) => outsideCollider(c, x, z)))))
          worstBack = Math.max(worstBack, back)
          if (back > TOL) fail(`${tagOf(d.ring[0], d.ring[1])}: the drawn footprint reaches ${back.toFixed(2)} m outside every collider of its prop`)
        }
        // gate posts: each end of the drawn bar on a post collider (gateArch's width is a copy);
        // the great gate's ends are its towers, checked as buildings
        for (const g of p.kind === 'townGate' || p.kind === 'gateArch' ? (gates.get(key) ?? []) : []) {
          for (const [x, z] of [g.a, g.b]) {
            posts++
            const d = Math.min(...col.map((c) => (c.kind === 'circle' ? Math.hypot(x - c.x, z - c.z) : Infinity)))
            if (d > 0.05) fail(`${tagOf(x, z)}: a drawn gate post ${d.toFixed(2)} m from the nearest post collider`)
          }
        }
        // mill wheels: the bar is the wheel collider's long axis (waterMill's radius is a copy)
        for (const wb of wheelBars.get(key) ?? []) {
          wheels++
          const mx = (wb.pts[0] + wb.pts[2]) / 2
          const mz = (wb.pts[1] + wb.pts[3]) / 2
          const half = Math.hypot(wb.pts[2] - wb.pts[0], wb.pts[3] - wb.pts[1]) / 2
          const hit = col.find((c) => c.kind === 'box' && Math.hypot(c.x - mx, c.z - mz) < 0.05 && Math.abs(Math.max(c.hw, c.hd) - half) < 0.05)
          // the small mill's wheel has no collider of its own: it turns inside the mill's
          if (!hit && p.kind === 'waterMill') fail(`${tagOf(mx, mz)}: the drawn wheel (${half.toFixed(2)} m radius) matches no wheel collider`)
        }
      })
    }
    if (matched !== plan.buildings.length) fail(`${name}: ${plan.buildings.length} footprints drawn, ${matched} tied to a prop`)
    console.log(
      `  ${name}: ${buildings} building colliders, ${plan.buildings.length} footprints, ${plan.smials.length} smials, ${plan.hedges.length} hedge runs, ${plan.fences.length} fence runs, ${plan.walls.length} wall runs, ${plan.gates.length} gates (${posts} posts on colliders), ${wheels} wheels, ${wallBoxes} wall colliders, ${plan.bridges.length} bridge decks, ${plan.quays.length} quay runs; collider outside footprint ≤ ${worst.toFixed(3)} m, footprint outside collider ≤ ${worstBack.toFixed(3)} m`,
    )
  }

  for (const w of worlds) if (w.world && w.plan) checkPlan(w.name, w.world, w.plan)

  // Every structure kind the plan knows, built once at awkward turns and scales on Bree's ground,
  // so a kind no place uses yet is held to its colliders too.
  {
    const b = worlds.find((w) => w.name === 'bree')!.world!
    const [x0, z0] = b.meta.spawn
    const at = (dx: number, dz: number): [number, number] => [x0 + dx, z0 + dz]
    const prop = (kind: string, offset: [number, number], rotation: number, scale: number, params: Record<string, unknown> = {}) => ({ kind, offset, rotation, scale, params })
    const props = [
      prop('cottage', [0, 0], 0.7, 1.2, { width: 5, inn: true }),
      prop('waterMill', [30, 0], -0.4, 1, { wheel: 2.8 }),
      prop('waterMill', [-30, 0], 2.1, 1),
      prop('mill', [0, 30], 0.3, 1),
      prop('hall', [0, -30], -1.1, 1.3, { width: 9 }),
      prop('tower', [30, 30], 0.2, 1.4),
      prop('gate', [-30, 30], 0.5, 1, { width: 20 }),
      prop('townGate', [30, -30], 1.2, 1.1),
      prop('gateArch', [-30, -30], -0.8, 1),
      prop('gateArch', [45, 0], 0.3, 1, { width: 4 }),
      prop('wallRing', [60, 0], 0, 1, { radius: 12, gapAngle: 1, gapWidth: 0.6 }),
      prop('palisade', [0, 60], 0, 1, { radius: 10 }),
      prop('hobbitHole', [-60, 0], 0.9, 1),
      prop('bridge', [0, -60], 0.4, 1, { ruined: true }),
      prop('quay', [60, -60], 0.4, 1, { ruined: true }),
    ]
    const lm = { ...b.meta.landmarks[0], id: 'kinds', position: at(0, 0), dressing: { ...(b.meta.landmarks[0].dressing ?? { radius: 60, setting: 'village' }), props } }
    const world = { ...b, meta: { ...b.meta, landmarks: [lm] } } as LoadedWorld
    const plan = extractPlaceFeatures(world)
    checkPlan('every kind', world, plan)
    const want = { buildings: 1 + 2 + 1 + 1 + 1 + 2 + 2, smials: 1, gates: 4, wheels: 3, bridges: 2 }
    const got = { buildings: plan.buildings.length, smials: plan.smials.length, gates: plan.gates.length, wheels: plan.wheels.length, bridges: plan.bridges.length }
    for (const k of Object.keys(want) as (keyof typeof want)[]) if (want[k] !== got[k]) fail(`every kind: ${got[k]} ${k} drawn, want ${want[k]}`)
    if (!plan.walls.length) fail('every kind: the wall ring and palisade drew no walls')
  }

  // Every prop kind a place uses is either drawn on the plan or known to be furniture the map
  // leaves out; a new kind fails here until it is one or the other (placeFeatures.PLAN_KINDS).
  const FURNITURE = new Set([
    'bigTree', 'boat', 'cart', 'gardenPlot', 'haystack', 'lamp', 'partyTree', 'pony', 'signpost', 'standingStone', 'stones', 'tables',
    'stoneRing', 'barrow', 'ruins', 'troll', 'ship', 'cave', 'pool', 'crag', 'pits', 'eye', 'lavaGlow', 'smoke', 'seat', 'candles', 'webs', 'ent',
  ])
  const unknown = new Set<string>()
  for (const w of worlds) for (const lm of w.world?.meta.landmarks ?? []) for (const p of lm.dressing?.props ?? []) if (!PLAN_KINDS.has(p.kind) && !FURNITURE.has(p.kind)) unknown.add(p.kind)
  if (unknown.size) fail(`place props of kinds neither on the plan nor known furniture: ${[...unknown].join(', ')} (add them to placeFeatures.ts or to FURNITURE here)`)
}

console.log(failures ? `\n${failures} FAILURES` : '\nall map label, search and town plan checks passed')
process.exit(failures ? 1 : 0)
