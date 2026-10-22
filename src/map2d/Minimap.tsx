import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useWorld } from '@/world/WorldContext'
import type { LoadedWorld } from '@/world/loadWorld'
import { cameraState, playerState, usePlayerStore, useSettingsStore, useUiStore, MINIMAP_ZOOM_MAX, MINIMAP_ZOOM_MIN } from '@/store/stores'
import { IconButton, Tooltip } from '@/ui/kit'
import { drawMap, lastDrawStats, type MapView } from './drawMap'
import { getPreparedMap, makeCanvas, onPrepared, type MapCanvas } from './prepareMap'
import { mapThemeFor } from './mapTheme'
import { EVENODD_ICONS, MARKER_ICONS, distanceTo, effectivePriority, markerModels, type MarkerIcon, type MarkerModel } from './markers'
import './minimap.css'

/*
 * The corner minimap: the big map's own renderer (prepareMap/drawMap) at a fixed local scale, in the
 * same paper style, with marker badges, the traveller's arrow and a north mark. No place names: at
 * this size they collided at every spot measured, and the badges say what a place is.
 *
 * It draws only when something it shows has changed (the traveller moved half a minimap pixel or
 * turned half a degree, the map was re-prepared, the size, zoom, mode or markers changed), and at
 * most 30 times a second. A tick that finds nothing changed costs a few number compares, so standing
 * still draws nothing.
 */

/** Degrees from centre to edge on a globe, whose map is in degrees rather than metres. */
const GLOBE_RADIUS = 36
/** Redraws at most this often (ms), however fast the screen refreshes. */
const MIN_FRAME_MS = 1000 / 30 - 2
/** Movement or turn that counts as a change: half a CSS pixel, half a degree. */
const MOVE_PX = 0.5
const TURN_RAD = (0.5 * Math.PI) / 180
/** How often the footer's "nearest place" line may change while moving. */
const FOOT_MS = 250
/** Phones, tablets, narrow windows: the card is just the map (minimap.css, tokens.css --minimap-size). */
const COMPACT_QUERY = '(pointer: coarse), (max-width: 760px)'

/**
 * Metres from the centre to the edge of the minimap at zoom 1: about a ninth of the world's shorter
 * side, so a town fills the card about as much as a province does on the overworld (Middle-earth
 * 109 m, Bree 48 m, Hobbiton 44 m). A globe keeps its 36 degrees.
 */
function baseRadius(world: LoadedWorld): number {
  if (world.meta.kind === 'globe') return GLOBE_RADIUS
  const hf = world.heightfield
  // the same extent the map renderer draws: a flat grid's pixels are vertices
  const w = (hf.width - 1) * hf.cell
  const h = (hf.height - 1) * hf.cell
  return Math.min(140, Math.max(40, 0.11 * Math.min(w, h)))
}

/** Radians folded into [0, 2π). */
const wrapAngle = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
/** Smallest difference between two angles. */
const angleGap = (a: number, b: number) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI)

const matches = (q: string) => typeof window.matchMedia === 'function' && window.matchMedia(q).matches

/* painter:start — plain canvas code (no React, no stores), so a node timing script can run it as is */

/** Colours for what the minimap draws over the base map. */
interface Inks {
  paper: string
  ink: string
  void: string
  accent: string
  accentInk: string
}

type BadgeState = 'found' | 'unfound' | 'exit' | 'selected'
/** A sprite's slot in its icon's list: state × enterable, so a lookup builds no key string per draw. */
const STATE_SLOT: Record<BadgeState, number> = { found: 0, unfound: 2, exit: 4, selected: 6 }
type SpriteCache = Map<MarkerIcon, (MapCanvas | undefined)[]>

const iconPaths = new Map<MarkerIcon, Path2D>()
function iconPath(icon: MarkerIcon): Path2D {
  let p = iconPaths.get(icon)
  if (!p) iconPaths.set(icon, (p = new Path2D(MARKER_ICONS[icon])))
  return p
}

/**
 * One marker badge as a small image, painted once per look and kept: a paper disc with an ink rim
 * (dashed while undiscovered, the same states as the big map's badges), the pictogram inside, and an
 * accent ring when it opens into a place. Blitting these is far cheaper than tracing paths each draw.
 */
function badgeSprite(cache: SpriteCache, icon: MarkerIcon, state: BadgeState, enterable: boolean, size: number, dpr: number, k: Inks): MapCanvas {
  let slots = cache.get(icon)
  if (!slots) cache.set(icon, (slots = []))
  const slot = STATE_SLOT[state] + (enterable ? 1 : 0)
  let c = slots[slot]
  if (c) return c
  const n = Math.ceil((size + 8) * dpr)
  c = makeCanvas(n, n)
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.translate(n / dpr / 2, n / dpr / 2)
  const r = size / 2
  const arc = (rad: number) => {
    g.beginPath()
    g.arc(0, 0, rad, 0, Math.PI * 2)
  }
  if (enterable) {
    arc(r + 3)
    g.fillStyle = k.accent
    g.fill()
    arc(r + 1.5)
    g.fillStyle = k.paper
    g.fill()
  }
  arc(r)
  g.fillStyle = state === 'exit' ? k.ink : state === 'selected' ? k.accent : k.paper
  g.fill()
  arc(r - 0.65)
  g.lineWidth = 1.3
  g.strokeStyle = state === 'selected' ? k.paper : k.ink
  if (state === 'unfound') g.setLineDash([2.2, 1.6])
  g.stroke()
  g.setLineDash([])
  const px = size * 0.64
  g.save()
  g.translate(-px / 2, -px / 2)
  g.scale(px / 16, px / 16)
  g.fillStyle = state === 'exit' ? k.paper : state === 'selected' ? k.accentInk : k.ink
  if (state === 'unfound') g.globalAlpha = 0.72
  g.fill(iconPath(icon), EVENODD_ICONS.has(icon) ? 'evenodd' : 'nonzero')
  g.restore()
  slots[slot] = c
  return c
}

/** World point → CSS pixel in the (possibly rotated) view; writes into `out` so nothing is allocated. */
function project(v: MapView, period: number, x: number, z: number, out: Float32Array) {
  let dx = x - v.cx
  if (period) dx -= Math.round(dx / period) * period
  const ex = dx * v.s
  const ez = (z - v.cz) * v.s
  const rot = v.rotation ?? 0
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  out[0] = v.vw / 2 + ex * cos - ez * sin
  out[1] = v.vh / 2 + ex * sin + ez * cos
}

/**
 * The markers, most important first. One that would land on a badge already drawn is left out
 * rather than stacked (there are no "+n" chips at this size; the big map has them). `placed` is
 * scratch space, at least 2 floats per marker.
 */
function paintMarkers(ctx: CanvasRenderingContext2D, v: MapView, period: number, marks: readonly MarkerModel[], selectedId: string | null, badge: number, placed: Float32Array, xy: Float32Array, sprite: (m: MarkerModel, selected: boolean) => MapCanvas) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const gap2 = (badge + 1) * (badge + 1)
  const h = badge / 2 + 3
  let n = 0
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]
    project(v, period, m.x, m.z, xy)
    const px = xy[0]
    const py = xy[1]
    if (px < -h || py < -h || px > v.vw + h || py > v.vh + h) continue
    let taken = false
    for (let j = 0; j < n; j += 2) {
      const a = placed[j] - px
      const b = placed[j + 1] - py
      if (a * a + b * b < gap2) {
        taken = true
        break
      }
    }
    if (taken) continue
    placed[n++] = px
    placed[n++] = py
    const img = sprite(m, m.id === selectedId)
    ctx.drawImage(img as CanvasImageSource, Math.round(px * v.dpr - img.width / 2), Math.round(py * v.dpr - img.height / 2))
  }
}

/** A selected place beyond the edge gets an accent tick on the rim, pointing the way to it. */
function paintTargetTick(ctx: CanvasRenderingContext2D, v: MapView, period: number, m: MarkerModel, xy: Float32Array, k: Inks) {
  project(v, period, m.x, m.z, xy)
  const hw = v.vw / 2
  const hh = v.vh / 2
  const ux = xy[0] - hw
  const uy = xy[1] - hh
  const inset = 7
  if (Math.abs(ux) <= hw - inset && Math.abs(uy) <= hh - inset) return
  const t = Math.min((hw - inset) / Math.max(Math.abs(ux), 1e-6), (hh - inset) / Math.max(Math.abs(uy), 1e-6))
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0)
  ctx.translate(hw + ux * t, hh + uy * t)
  ctx.rotate(Math.atan2(uy, ux))
  ctx.beginPath()
  ctx.moveTo(5, 0)
  ctx.lineTo(-4, -5)
  ctx.lineTo(-4, 5)
  ctx.closePath()
  ctx.lineJoin = 'round'
  ctx.lineWidth = 2
  ctx.strokeStyle = k.paper
  ctx.stroke()
  ctx.fillStyle = k.accent
  ctx.fill()
}

/**
 * The north mark: a small paper disc with an N traced as a stroke (a glyph, not text), on the rim
 * at the top in north-up, orbiting the rim as the map turns in heading-up.
 */
function paintNorth(ctx: CanvasRenderingContext2D, v: MapView, k: Inks) {
  const rot = v.rotation ?? 0
  const r = Math.min(v.vw, v.vh) / 2 - 10
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0)
  ctx.translate(v.vw / 2 + Math.sin(rot) * r, v.vh / 2 - Math.cos(rot) * r)
  ctx.beginPath()
  ctx.arc(0, 0, 7, 0, Math.PI * 2)
  ctx.fillStyle = k.paper
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = k.ink
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-2.3, 3.2)
  ctx.lineTo(-2.3, -3.2)
  ctx.lineTo(2.3, 3.2)
  ctx.lineTo(2.3, -3.2)
  ctx.lineJoin = 'miter'
  ctx.lineCap = 'butt'
  ctx.lineWidth = 1.5
  ctx.stroke()
}

/**
 * The traveller at the centre: a faint wedge for the way they face and an accent arrow with a
 * paper rim. `heading` is the arrow's clockwise angle from up on screen.
 */
function paintPlayer(ctx: CanvasRenderingContext2D, v: MapView, heading: number, k: Inks) {
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0)
  ctx.translate(v.vw / 2, v.vh / 2)
  ctx.rotate(heading)
  const half = (35 * Math.PI) / 180
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.arc(0, 0, 26, -Math.PI / 2 - half, -Math.PI / 2 + half)
  ctx.closePath()
  ctx.globalAlpha = 0.22
  ctx.fillStyle = k.accent
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.beginPath()
  ctx.moveTo(0, -8)
  ctx.lineTo(6, 7)
  ctx.lineTo(0, 3.5)
  ctx.lineTo(-6, 7)
  ctx.closePath()
  ctx.lineJoin = 'round'
  ctx.lineWidth = 3
  ctx.strokeStyle = k.paper
  ctx.stroke()
  ctx.fillStyle = k.accent
  ctx.fill()
}

/* painter:end */

/** Reads the colours the overlay draws with: the map's own inks, and the accent from tokens.css. */
function readInks(theme: Record<string, string>): Inks {
  let accent = ''
  let accentInk = ''
  try {
    const cs = getComputedStyle(document.documentElement)
    accent = cs.getPropertyValue('--accent').trim()
    accentInk = cs.getPropertyValue('--accent-ink').trim()
  } catch {
    // no styles (tests): the fallbacks below
  }
  return { paper: theme.paper ?? '#f3ead6', ink: theme.ink ?? '#2b2620', void: theme.void ?? '#e2d6bd', accent: accent || '#a8432a', accentInk: accentInk || '#fff8ec' }
}

/** A marker pictogram for the footer, in the text colour. */
function Glyph({ icon }: { icon: MarkerIcon }) {
  return (
    <svg className="minimap-foot__icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={MARKER_ICONS[icon]} fillRule={EVENODD_ICONS.has(icon) ? 'evenodd' : 'nonzero'} />
    </svg>
  )
}

/** Corner minimap: the local map around the traveller, north-up or heading-up; opens the big map. */
export function Minimap() {
  const world = useWorld()
  const headingUp = useSettingsStore((s) => s.minimapHeadingUp)
  const setHeadingUp = useSettingsStore((s) => s.setMinimapHeadingUp)
  const zoom = useSettingsStore((s) => s.minimapZoom)
  const quality = useSettingsStore((s) => s.quality)
  const discovered = usePlayerStore((s) => s.discovered)
  const selectedId = useUiStore((s) => s.selectedLandmark)
  const regionId = useUiStore((s) => s.regionId)
  const viewRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState<{ icon: MarkerIcon; text: string } | null>(null)
  // on the compact card the footer is hidden and no longer kept up to date, so it describes nothing
  const [compactUi, setCompactUi] = useState(() => matches(COMPACT_QUERY))

  const meta = world.meta
  const radius = baseRadius(world) * zoom
  const region = meta.regions.find((r) => r.id === regionId)?.displayName ?? (meta.place ? meta.name : 'The Wild')

  // every marker the big map would show, most important first (what the traveller selected leads)
  const marks = useMemo(() => {
    const exit = meta.place?.exit
    const models = markerModels(meta.landmarks, new Set(discovered), exit ? { x: exit.x, z: exit.z, label: exit.label } : undefined)
    const state = { selectedId }
    return models
      .map((m) => ({ m, p: effectivePriority(m, state) }))
      .sort((a, b) => b.p - a.p || (a.m.id < b.m.id ? -1 : 1))
      .map((o) => o.m)
  }, [meta, discovered, selectedId])

  // What the draw loop reads. The loop lives for the world; settings and markers reach it through
  // this ref (and mark it dirty) instead of restarting it.
  const live = useRef({ radius, headingUp, quality, marks, selectedId, dirty: true })
  useEffect(() => {
    const l = live.current
    l.headingUp = headingUp
    l.quality = quality
    l.marks = marks
    l.selectedId = selectedId
    l.dirty = true
  }, [headingUp, quality, marks, selectedId])
  // apart from the rest, so a marker change mid-wheel does not snap back a zoom not yet saved
  useEffect(() => {
    live.current.radius = radius
    live.current.dirty = true
  }, [radius])

  useEffect(() => {
    const host = viewRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return
    const theme = mapThemeFor(world)
    const inks = readInks(theme)
    const globe = world.meta.kind === 'globe'
    const period = globe ? 360 : 0
    const l = live.current
    l.dirty = true

    const view: MapView = { cx: 0, cz: 0, s: 1, vw: 0, vh: 0, dpr: 1, rotation: 0 }
    const opts: { detail: 'fast'; quality: typeof l.quality } = { detail: 'fast', quality: l.quality }
    const xy = new Float32Array(2)
    let placed = new Float32Array(64)
    const sprites: SpriteCache = new Map()
    // badges are 14 px on the full card, 12 on the compact one; sprites are kept per size and dpr
    let badge = 14
    let spriteDpr = 0
    let spriteBadge = 0
    let cssW = 0
    let cssH = 0
    // what the last draw showed, to tell whether anything has changed since
    let lastX = NaN
    let lastZ = NaN
    let lastRot = NaN
    let lastHeading = NaN
    let lastDraw = -Infinity
    // the footer's nearest-place line
    let lastFoot = -Infinity
    let footPending = true
    let footText = ''
    let compact = matches(COMPACT_QUERY)
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia(COMPACT_QUERY) : null
    const onCompact = () => {
      compact = !!mq?.matches
      setCompactUi(compact)
      l.dirty = true
      footPending = true
    }
    mq?.addEventListener('change', onCompact)

    // the backing store is the CSS size × the device pixel ratio, so the browser never rescales it
    // (the old minimap drew 176 px and was squeezed to 110 by CSS on phones)
    const fitBacking = () => {
      const dpr = window.devicePixelRatio || 1
      const bw = Math.max(1, Math.round(cssW * dpr))
      const bh = Math.max(1, Math.round(cssH * dpr))
      if (canvas.width !== bw) canvas.width = bw
      if (canvas.height !== bh) canvas.height = bh
      view.vw = cssW
      view.vh = cssH
      view.dpr = dpr
      l.dirty = true
    }
    const ro = new ResizeObserver((entries) => {
      const r = entries[entries.length - 1].contentRect
      cssW = r.width
      cssH = r.height
      fitBacking()
      // resizing wiped the canvas; observers run before the browser paints, so redraw now rather
      // than show a blank square for a frame
      if (cssW && cssH && !useUiStore.getState().mapOpen) drawNow(performance.now())
    })
    ro.observe(host)

    const sprite = (m: MarkerModel, selected: boolean) => {
      const state: BadgeState = selected ? 'selected' : m.kind === 'exit' ? 'exit' : m.discovered ? 'found' : 'unfound'
      return badgeSprite(sprites, m.icon, state, m.enterable && !selected, badge, view.dpr, inks)
    }

    const updateFoot = (now: number) => {
      lastFoot = now
      footPending = false
      const p = playerState.map
      const reach = l.radius * 3
      let best: MarkerModel | null = null
      let bestD = reach * reach
      for (let i = 0; i < l.marks.length; i++) {
        const m = l.marks[i]
        let dx = m.x - p.x
        if (period) dx -= Math.round(dx / period) * period
        const dz = m.z - p.z
        const d = dx * dx + dz * dz
        if (d < bestD) {
          bestD = d
          best = m
        }
      }
      // distanceTo's long form ends in a walking time; the card only has room for distance and bearing
      const text = best ? `${best.icon}|${best.name} · ${distanceTo(p, best, globe).long.split(' · ')[0]}` : ''
      if (text === footText) return
      footText = text
      setNear(best ? { icon: best.icon, text: text.slice(text.indexOf('|') + 1) } : null)
    }

    const draw = (now: number, rot: number, heading: number) => {
      const t0 = performance.now()
      const p = playerState.map
      view.cx = p.x
      view.cz = p.z
      view.s = Math.min(view.vw, view.vh) / 2 / l.radius
      view.rotation = rot
      badge = view.vw >= 160 ? 14 : 12
      if (view.dpr !== spriteDpr || badge !== spriteBadge) {
        sprites.clear()
        spriteDpr = view.dpr
        spriteBadge = badge
      }
      if (placed.length < l.marks.length * 2) placed = new Float32Array(l.marks.length * 2)

      // null until the world's map is prepared (idle-time work this call starts); onPrepared redraws
      const pm = getPreparedMap(world)
      let more = false
      if (pm) {
        // drawMap paints every pixel opaquely (the hatched void included), so nothing to clear first
        opts.quality = l.quality
        drawMap(ctx, pm, view, theme, opts)
        // a 'fast' frame paints a few new tiles and borrows the rest; come back until all are in
        more = lastDrawStats.tilesMissing > 0
      } else {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.fillStyle = inks.void
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
      paintMarkers(ctx, view, period, l.marks, l.selectedId, badge, placed, xy, sprite)
      if (l.selectedId) {
        for (let i = 0; i < l.marks.length; i++) if (l.marks[i].id === l.selectedId) paintTargetTick(ctx, view, period, l.marks[i], xy, inks)
      }
      paintNorth(ctx, view, inks)
      paintPlayer(ctx, view, heading, inks)
      ctx.setTransform(1, 0, 0, 1, 0, 0)

      lastX = p.x
      lastZ = p.z
      lastRot = rot
      lastHeading = heading
      lastDraw = now
      l.dirty = more
      stats.draws++
      stats.ms = performance.now() - t0
      if (!compact && (footPending || now - lastFoot >= FOOT_MS)) updateFoot(now)
      else footPending = true
    }

    // heading-up turns the map so the camera's view points up: the camera looks along -cameraState.yaw
    // on the map (clockwise from north), so the map turns by +yaw, and north sits at that angle
    const mapTurn = () => (l.headingUp ? wrapAngle(cameraState.yaw) : 0)
    // the arrow: the traveller faces π - playerState.yaw on the map, plus the map's own turn
    const arrowTurn = (rot: number) => wrapAngle(Math.PI - playerState.yaw + rot)
    const drawNow = (now: number) => {
      const rot = mapTurn()
      draw(now, rot, arrowTurn(rot))
    }

    let raf = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (!cssW || !cssH) return
      if ((window.devicePixelRatio || 1) !== view.dpr) fitBacking()
      // under the open map dialog nobody sees it; the first tick after it closes catches up
      if (useUiStore.getState().mapOpen) return
      const p = playerState.map
      const rot = mapTurn()
      const heading = arrowTurn(rot)
      const s = Math.min(cssW, cssH) / 2 / l.radius
      let dx = p.x - lastX
      if (period) dx -= Math.round(dx / period) * period
      const changed =
        l.dirty ||
        !(Math.abs(dx) * s < MOVE_PX) || // NaN on the first tick counts as a change
        !(Math.abs(p.z - lastZ) * s < MOVE_PX) ||
        !(angleGap(rot, lastRot) < TURN_RAD) ||
        !(angleGap(heading, lastHeading) < TURN_RAD)
      if (changed) {
        if (now - lastDraw >= MIN_FRAME_MS) draw(now, rot, heading)
      } else if (footPending && !compact && now - lastFoot >= FOOT_MS) {
        // the traveller stopped since the line was last written: bring it up to date once
        updateFoot(now)
      }
    }
    raf = requestAnimationFrame(tick)
    const offPrepared = onPrepared(world, () => {
      l.dirty = true
    })

    // The wheel over the minimap zooms it (and never reaches the page or the 3D camera). A trackpad
    // sends dozens of wheel events a second, and minimapZoom is a persisted setting (localStorage), so
    // the zoom goes straight to the draw loop and reaches the store once the wheel has rested.
    const base = baseRadius(world)
    let wheelZoom = NaN
    let wheelTimer = 0
    const commitZoom = () => {
      wheelTimer = 0
      if (!Number.isNaN(wheelZoom)) useSettingsStore.getState().setMinimapZoom(wheelZoom)
      wheelZoom = NaN
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      const z = Number.isNaN(wheelZoom) ? useSettingsStore.getState().minimapZoom : wheelZoom
      wheelZoom = Math.min(MINIMAP_ZOOM_MAX, Math.max(MINIMAP_ZOOM_MIN, z * Math.exp(e.deltaY * lines * 0.0015)))
      l.radius = base * wheelZoom
      l.dirty = true
      window.clearTimeout(wheelTimer)
      wheelTimer = window.setTimeout(commitZoom, 250)
    }
    host.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      offPrepared()
      mq?.removeEventListener('change', onCompact)
      host.removeEventListener('wheel', onWheel)
      // a zoom still waiting to be saved is kept, not lost with the card
      if (wheelTimer) {
        window.clearTimeout(wheelTimer)
        commitZoom()
      }
    }
  }, [world])

  const openMap = () => {
    const p = playerState.map
    // open on the traveller with about three minimap radii of country around them (the live radius,
    // which a wheel zoom reaches before the store does)
    const scale = Math.min(window.innerWidth, window.innerHeight) / 2 / (3 * live.current.radius)
    useUiStore.getState().openMap({ x: p.x, z: p.z, scale })
  }
  const zoomBy = (f: number) => {
    const st = useSettingsStore.getState()
    st.setMinimapZoom(Math.min(MINIMAP_ZOOM_MAX, Math.max(MINIMAP_ZOOM_MIN, st.minimapZoom * f)))
  }

  // A mouse press or a tap must not focus the map square or the toggle. Focused, they would keep the
  // world's keys (below) and the "Open map" tooltip, and the map dialog, which hands focus back to
  // whatever had it when it opened, would return it there on closing: Enter at a portal would then
  // reopen the map instead of travelling. Only the keyboard (Tab) focuses them, as useInput expects.
  // Preventing mousedown's default is what stops the focus (pointerdown's would not); the click still
  // comes. The blur after a pointer click covers a browser that focuses anyway.
  const noPointerFocus = (e: MouseEvent) => e.preventDefault()
  const onViewClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.detail > 0) e.currentTarget.blur()
    openMap()
  }

  // Keys the minimap's own controls use stop here: the world's key handler (useInput) listens on the
  // window and would otherwise also act on them (Tab toggles the editor, Enter walks through a portal).
  // Only the keyboard can focus these controls (above), so this never takes a key from the world.
  const onCardKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Tab' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') e.stopPropagation()
  }
  const onViewKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      e.preventDefault()
      e.stopPropagation()
      openMap()
    } else if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
      e.preventDefault()
      e.stopPropagation()
      // zoom grows the radius, so "+" (closer in) shrinks it
      zoomBy(e.key === '+' || e.key === '=' ? 1 / 1.25 : 1.25)
    }
  }

  return (
    <div className="minimap-card" onKeyDown={onCardKeyDown}>
      <div className="minimap-head">
        <span className="minimap-head__name">{region}</span>
        <IconButton
          icon="compass"
          label="Turn the minimap with the camera"
          tip={headingUp ? 'Heading up: click for north up' : 'North up: click for heading up'}
          size="sm"
          pressed={headingUp}
          tipSide="top"
          tipAlign="end"
          onClick={() => setHeadingUp(!headingUp)}
          onMouseDown={noPointerFocus}
        />
      </div>
      <Tooltip label="Open map" shortcut="M" side="top" align="end">
        <div
          ref={viewRef}
          className="minimap-view"
          role="button"
          tabIndex={0}
          aria-label={`Map: ${region}. Open the full map`}
          aria-keyshortcuts="M"
          aria-describedby={near && !compactUi ? 'minimap-near' : undefined}
          onClick={onViewClick}
          onMouseDown={noPointerFocus}
          onKeyDown={onViewKeyDown}
        >
          <canvas ref={canvasRef} aria-hidden="true" />
        </div>
      </Tooltip>
      <p className="minimap-foot" id="minimap-near" data-empty={near ? undefined : ''}>
        {near && <Glyph icon={near.icon} />}
        <span className="minimap-foot__text">{near ? near.text : 'No landmark nearby'}</span>
      </p>
    </div>
  )
}

/** Draw count and the last draw's cost, for checking the redraw policy from the console in dev. */
const stats = { draws: 0, ms: 0 }
if (import.meta.env.DEV) (window as unknown as { __minimap: unknown }).__minimap = stats
