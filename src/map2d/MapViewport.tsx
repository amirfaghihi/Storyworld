import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { LoadedWorld } from '@/world/loadWorld'
import { useSettingsStore } from '@/store/stores'
import { drawMap } from './drawMap'
import { getPreparedMap, onPrepared, type PreparedMap } from './prepareMap'
import { mapThemeFor } from './mapTheme'
import type { AABB } from './geom/spatialHash'
import type { MarkerModel } from './markers'
import type { RegionAnchors } from './labels'
import { MarkerLayer } from './MarkerLayer'
import { PlayerMarker } from './PlayerMarker'
import { MapTooltip } from './MapTooltip'
import { Compass } from './Compass'
import { ScaleBar } from './ScaleBar'
import { ZoomControls } from './ZoomControls'
import { MapLegend, type PlanItem } from './MapLegend'
import type { MapCamera } from './useMapCamera'

/** Wait after the last moving frame before a full-detail frame. */
const FULL_DELAY = 140

/** The fit box before the prepared map knows it: the same rule prepareMap uses (mapBounds ∩ the world). */
function fallbackFit(world: LoadedWorld): [number, number, number, number] {
  const [W, H] = world.meta.size
  const mb = world.meta.mapBounds
  return mb ? [Math.max(0, mb[0]), Math.max(0, mb[1]), Math.min(W, mb[2]), Math.min(H, mb[3])] : [0, 0, W, H]
}

interface Props {
  world: LoadedWorld
  cam: MapCamera
  models: MarkerModel[]
  anchors: RegionAnchors[]
  /** world outlines names keep off (a place's buildings) */
  obstacles: readonly ArrayLike<number>[]
  /** the town-plan symbols the legend explains */
  planItems: readonly PlanItem[]
  regionNames: ReadonlyMap<string, string>
  selectedId: string | null
  highlightId: string | null
  touch: boolean
  /** changes whenever a panel opens or closes */
  chromeKey: string
  legendOpen: boolean
  onToggleLegend: () => void
  onSelect: (id: string, byKeyboard: boolean) => void
  onOpenCluster: (members: MarkerModel[]) => void
  onBackgroundTap: () => void
  onLocate: () => void
  /** the camera has a size and limits for the first time: place it */
  onReady: () => void
  regionOf: (m: MarkerModel) => string | undefined
  summaryOf: (m: MarkerModel) => string | undefined
  /** panels drawn over the map (the place card, the list, the phone sheet) */
  children?: ReactNode
}

/**
 * The map itself: the base-map canvas (drawn by drawMap through the prepared-map seam), and over
 * it, in screen space, the markers, names, the "you" marker, the tooltip and the controls. The
 * canvas backing store is vw·dpr × vh·dpr, so line work is crisp at any zoom. During gestures and
 * the first frames after opening it draws 'fast' frames (cached tiles, a few new ones per frame);
 * once the camera has settled it draws one 'full' frame.
 */
export const MapViewport = memo(function MapViewport(p: Props) {
  const { world, cam } = p
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [pm, setPm] = useState<PreparedMap | null>(() => getPreparedMap(world))
  const [hoverId, setHoverId] = useState<string | null>(null)
  const pmRef = useRef(pm)
  pmRef.current = pm
  const quality = useSettingsStore((s) => s.quality)
  const qualityRef = useRef(quality)
  qualityRef.current = quality
  const theme = mapThemeFor(world)
  const isGlobe = world.meta.kind === 'globe'

  // the prepared map arrives (or is re-prepared after a terrain edit)
  useEffect(() => {
    setPm(getPreparedMap(world))
    return onPrepared(world, () => setPm(getPreparedMap(world)))
  }, [world])

  // the camera's limits: what "fit" frames, and how far in you may zoom
  useEffect(() => {
    cam.setLimits({ fit: pm?.fitBounds ?? fallbackFit(world), maxS: isGlobe ? 40 : world.meta.place ? 14 : 10, slack: 0.4 })
  }, [cam, pm, world, isGlobe])

  // gestures
  useEffect(() => {
    const el = host.current
    if (!el) return
    return cam.attach(el)
  }, [cam])

  // drawing
  const fullTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // whether the canvas shows a 'fast' frame that a 'full' one has not yet replaced. Two things
  // ask for the full frame once motion stops (this component's own timer and the camera's
  // settle), and both land within a few ms of each other; only the first should pay for it.
  const needsFull = useRef(false)
  const draw = useCallback(
    (detail: 'fast' | 'full') => {
      const c = canvas.current
      const ctx = c?.getContext('2d')
      const prepared = pmRef.current
      if (!c || !ctx || !cam.placed) return
      if (!prepared) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, c.width, c.height)
        return
      }
      if (detail === 'full' && !needsFull.current) return
      drawMap(ctx, prepared, cam.view, theme, { detail, quality: qualityRef.current })
      needsFull.current = detail === 'fast'
    },
    [cam, theme],
  )
  const scheduleFull = useCallback(() => {
    clearTimeout(fullTimer.current)
    fullTimer.current = setTimeout(() => {
      if (!cam.moving) draw('full')
    }, FULL_DELAY)
  }, [cam, draw])
  const drawRef = useRef({ draw, scheduleFull })
  drawRef.current = { draw, scheduleFull }
  useEffect(() => {
    const offFrame = cam.onFrame((_v, moving) => {
      draw('fast')
      if (!moving) scheduleFull()
    })
    const offSettle = cam.onSettle(() => {
      clearTimeout(fullTimer.current)
      draw('full')
    })
    return () => {
      offFrame()
      offSettle()
      clearTimeout(fullTimer.current)
    }
  }, [cam, draw, scheduleFull])
  // a new prepared map or quality: a quick frame now, the full one when the dust settles
  useEffect(() => {
    cam.invalidate()
  }, [cam, pm, quality])

  // size the canvas to the viewport, in device pixels
  const onReady = useRef(p.onReady)
  onReady.current = p.onReady
  useEffect(() => {
    const el = host.current
    const c = canvas.current
    if (!el || !c) return
    const resize = () => {
      const r = el.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const vw = Math.round(r.width)
      const vh = Math.round(r.height)
      if (!vw || !vh) return
      cam.setViewport(vw, vh, dpr)
      // Setting a canvas's width or height clears it, even to the same value, so touch them only
      // when the backing store really changes. Resize notifications arrive after this frame's
      // requestAnimationFrame has drawn, so repaint here and now, or the frame would show blank.
      const w = Math.round(vw * dpr)
      const h = Math.round(vh * dpr)
      if (c.width !== w || c.height !== h) {
        c.width = w
        c.height = h
        drawRef.current.draw('fast')
        drawRef.current.scheduleFull()
      }
      if (!cam.placed && cam.ready) onReady.current()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    // A change of devicePixelRatio alone (the window moved to another screen, browser zoom that
    // leaves the rounded CSS size alone) resizes nothing, so watch the resolution itself.
    let mq: MediaQueryList | null = null
    const watchDpr = () => {
      mq?.removeEventListener('change', onDpr)
      mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      mq.addEventListener('change', onDpr)
    }
    const onDpr = () => {
      resize()
      watchDpr()
    }
    watchDpr()
    return () => {
      ro.disconnect()
      mq?.removeEventListener('change', onDpr)
    }
  }, [cam])
  // limits may arrive after the size (or the other way round): place the camera once both are known
  useEffect(() => {
    if (!cam.placed && cam.ready) onReady.current()
  }, [cam, pm])

  // the map's own controls and panels, which names keep clear of
  const getReserved = useCallback((): AABB[] => {
    const el = host.current
    if (!el) return []
    const base = el.getBoundingClientRect()
    const out: AABB[] = []
    for (const n of el.querySelectorAll<HTMLElement>('[data-map-chrome]')) {
      if (n.hidden || n.classList.contains('map-you-edge')) continue
      const r = n.getBoundingClientRect()
      if (!r.width || !r.height) continue
      out.push({ x0: r.left - base.left, y0: r.top - base.top, x1: r.right - base.left, y1: r.bottom - base.top })
    }
    return out
  }, [])

  const hovered = hoverId ? (p.models.find((m) => m.id === hoverId) ?? null) : null
  const markerSize = p.touch ? 28 : 22

  return (
    <div className="map-viewport" ref={host} role="region" aria-roledescription="map" aria-label={`Map of ${world.meta.name}. Arrow keys pan, plus and minus zoom, 0 shows the whole map.`} tabIndex={0}>
      <canvas className="map-base" ref={canvas} onClick={p.onBackgroundTap} aria-hidden="true" />
      {!pm && (
        <div className="map-loading" role="status">
          <span className="map-loading__dot" />
          Drawing the map…
        </div>
      )}
      <MarkerLayer
        cam={cam}
        models={p.models}
        anchors={p.anchors}
        obstacles={p.obstacles}
        regionNames={p.regionNames}
        selectedId={p.selectedId}
        highlightId={p.highlightId}
        touch={p.touch}
        chromeKey={p.chromeKey}
        getReserved={getReserved}
        onSelect={p.onSelect}
        onOpenCluster={p.onOpenCluster}
        onHover={setHoverId}
      />
      <PlayerMarker cam={cam} onLocate={p.onLocate} />
      <MapTooltip cam={cam} model={hovered} region={hovered ? p.regionOf(hovered) : undefined} summary={hovered ? p.summaryOf(hovered) : undefined} markerSize={markerSize} />
      <Compass />
      <div className="map-corner" data-map-chrome-group>
        <MapLegend models={p.models} plan={p.planItems} open={p.legendOpen} onToggle={p.onToggleLegend} attribution={world.meta.attribution} />
        <ScaleBar cam={cam} globe={isGlobe} speedScale={world.meta.speedScale ?? 1} />
      </div>
      <ZoomControls cam={cam} onLocate={p.onLocate} />
      {world.meta.attribution && (
        <p className="map-attribution" data-map-chrome>
          {world.meta.attribution}
        </p>
      )}
      {p.children}
    </div>
  )
})
