import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { playerState } from '@/store/stores'
import type { AABB } from './geom/spatialHash'
import { EVENODD_ICONS, MARKER_ICONS, TYPE_NAMES, type MarkerIcon, type MarkerModel } from './markers'
import { labelFonts, layoutMapFrame, type MapFrame, type Measure, type RegionAnchors } from './labels'
import type { MapCamera } from './useMapCamera'

/** A marker pictogram (16-unit grid, filled with currentColor). */
export function Pictogram({ icon, size = 13 }: { icon: MarkerIcon; size?: number }) {
  return (
    <svg className="map-pictogram" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <path d={MARKER_ICONS[icon]} fillRule={EVENODD_ICONS.has(icon) ? 'evenodd' : 'nonzero'} />
    </svg>
  )
}

/** Text widths from a canvas in the label fonts, remembered (the same few dozen names every layout). */
function makeMeasure(): Measure {
  const ctx = document.createElement('canvas').getContext('2d')
  const cache = new Map<string, number>()
  return (text, font) => {
    const key = font + '|' + text
    let w = cache.get(key)
    if (w === undefined) {
      if (ctx) {
        ctx.font = font
        w = ctx.measureText(text).width
      } else w = text.length * 7
      cache.set(key, w)
    }
    return w
  }
}

/** Zoom change (as a ratio) after which names are laid out again mid-gesture. */
const RELAYOUT_ZOOM = 1.06
/**
 * Pan (CSS px) after which they are laid out again: only markers on screen take part in a
 * layout, so one dragged in from beyond the edge must appear as it arrives, not after the glide.
 */
const RELAYOUT_PAN = 24
/** ...but not more often than this while a gesture runs. */
const RELAYOUT_MIN_MS = 90
const HOVER_DELAY = 120

interface Props {
  cam: MapCamera
  models: MarkerModel[]
  anchors: RegionAnchors[]
  /** world outlines names keep off (a place's buildings) */
  obstacles: readonly ArrayLike<number>[]
  regionNames: ReadonlyMap<string, string>
  selectedId: string | null
  /** a marker to emphasise (the row the pointer is over in the place list) */
  highlightId: string | null
  touch: boolean
  /** changes whenever the map's panels open or close, so names make way for them */
  chromeKey: string
  /** the map's controls and panels, as rects in viewport px */
  getReserved: () => AABB[]
  onSelect: (id: string, byKeyboard: boolean) => void
  onOpenCluster: (members: MarkerModel[]) => void
  onHover: (id: string | null) => void
}

/**
 * The map's DOM layer: a real <button> per marker (constant size, so they never grow with zoom),
 * each carrying its name, plus the region names. React renders them when the layout changes (a
 * new zoom band, the camera settling, a selection); between layouts each frame only moves them,
 * through transforms written straight to the elements.
 */
export const MarkerLayer = memo(function MarkerLayer({ cam, models, anchors, obstacles, regionNames, selectedId, highlightId, touch, chromeKey, getReserved, onSelect, onOpenCluster, onHover }: Props) {
  const measure = useMemo(makeMeasure, [])
  const [frame, setFrame] = useState<MapFrame | null>(null)
  const frameRef = useRef<MapFrame | null>(null)
  const markerEls = useRef(new Map<string, HTMLElement>())
  const regionEls = useRef(new Map<string, HTMLElement>())
  const laidOut = useRef({ s: 0, cx: 0, cz: 0, vw: 0, vh: 0, t: 0 })
  const anchorById = useMemo(() => new Map(anchors.map((a) => [a.id, a])), [anchors])
  const modelById = useMemo(() => new Map(models.map((m) => [m.id, m])), [models])

  // what the layout depends on besides the camera, read through a ref so the camera listeners stay put
  const inputs = useRef({ models, anchors, obstacles, regionNames, selectedId, touch, getReserved })
  inputs.current = { models, anchors, obstacles, regionNames, selectedId, touch, getReserved }

  // `settled`: the camera has come to rest, so names may move to fit more (labels.layoutLabels)
  const relayout = useCallback((settled = false) => {
    if (!cam.placed) return
    const v = cam.view
    const i = inputs.current
    const f = layoutMapFrame({
      models: i.models,
      anchors: i.anchors,
      regionNames: i.regionNames,
      view: v,
      touch: i.touch,
      selectedId: i.selectedId,
      player: playerState.map,
      reserved: i.getReserved(),
      obstacles: i.obstacles,
      measure,
      prev: frameRef.current?.layout,
      settled,
    })
    frameRef.current = f
    laidOut.current = { s: v.s, cx: v.cx, cz: v.cz, vw: v.vw, vh: v.vh, t: performance.now() }
    setFrame(f)
  }, [cam, measure])

  // move every element to where the camera puts it (no allocation: this runs every frame)
  const place = useCallback(() => {
    const v = cam.view
    const hw = v.vw / 2
    const hh = v.vh / 2
    for (const [id, el] of markerEls.current) {
      const m = modelById.get(id)
      if (!m) continue
      el.style.transform = `translate3d(${hw + (m.x - v.cx) * v.s}px, ${hh + (m.z - v.cz) * v.s}px, 0)`
    }
    const f = frameRef.current
    if (!f) return
    for (const [id, el] of regionEls.current) {
      const r = f.layout.regions.get(id)
      const a = anchorById.get(id)
      if (!r || !a) continue
      const [x, z] = a.points[r.candidate]
      el.style.transform = `translate3d(${hw + (x - v.cx) * v.s - r.w / 2}px, ${hh + (z - v.cz) * v.s - r.h / 2}px, 0)`
    }
  }, [cam, modelById, anchorById])

  useEffect(() => {
    const offFrame = cam.onFrame((v, moving) => {
      const L = laidOut.current
      const zoomed = Math.abs(Math.log(v.s / (L.s || v.s))) > Math.log(RELAYOUT_ZOOM)
      const panned = Math.hypot(v.cx - L.cx, v.cz - L.cz) * v.s > RELAYOUT_PAN
      const resized = v.vw !== L.vw || v.vh !== L.vh
      if (cam.placed && (resized || ((zoomed || panned) && (!moving || performance.now() - L.t > RELAYOUT_MIN_MS)))) relayout()
      place()
    })
    const offSettle = cam.onSettle(() => relayout(true))
    return () => {
      offFrame()
      offSettle()
    }
  }, [cam, relayout, place])

  // a new selection, marker set or panel arrangement lays the names out again
  useEffect(() => relayout(), [relayout, models, anchors, obstacles, selectedId, touch])
  // panels slide in and out, so measure them again once they have arrived
  useEffect(() => {
    relayout()
    const t = setTimeout(() => relayout(), 320)
    return () => clearTimeout(t)
  }, [relayout, chromeKey])
  // and after every render, put the (possibly new) elements where they belong
  useEffect(place)

  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(hoverTimer.current), [])
  const hoverIn = (id: string, now: boolean) => {
    clearTimeout(hoverTimer.current)
    if (now) onHover(id)
    else hoverTimer.current = setTimeout(() => onHover(id), HOVER_DELAY)
  }
  const hoverOut = () => {
    clearTimeout(hoverTimer.current)
    onHover(null)
  }

  const clusterOf = useMemo(() => new Map(frame?.clusters.map((c) => [c.top.id, c]) ?? []), [frame])
  const fonts = labelFonts(touch)
  const size = frame?.markerSize ?? 22
  // tab order follows importance, then reading order (top to bottom)
  const ordered = useMemo(() => [...models].sort((a, b) => b.priority - a.priority || a.z - b.z || a.x - b.x), [models])

  return (
    <>
      <div className="map-layer map-regions" aria-hidden="true">
        {frame &&
          [...frame.layout.regions].map(([id, r]) =>
            r ? (
              <div
                key={id}
                className="map-region-label"
                ref={(el) => {
                  if (el) regionEls.current.set(id, el)
                  else regionEls.current.delete(id)
                }}
                style={{ font: fonts.region(r.size), letterSpacing: `${r.track}px`, width: r.w, height: r.h, lineHeight: `${r.h}px` }}
              >
                {(regionNames.get(id) ?? '').toUpperCase()}
              </div>
            ) : null,
          )}
      </div>
      <div className="map-layer map-markers">
        {ordered.map((m) => {
          const c = clusterOf.get(m.id)
          const label = frame?.layout.places.get(m.id)
          const more = c ? c.members.length - 1 : 0
          const name = more ? `${m.name} and ${more} more ${more === 1 ? 'place' : 'places'} close by` : `${m.name}, ${TYPE_NAMES[m.type].toLowerCase()}${m.kind === 'landmark' && !m.discovered ? ', not yet visited' : ''}${m.enterable && m.kind === 'landmark' ? ', can be entered' : ''}`
          const labelStyle: CSSProperties | undefined = label
            ? { left: size / 2 + label.dx, top: size / 2 + label.dy, width: label.w, height: label.h, font: label.major ? fonts.major : fonts.minor, lineHeight: `${label.h}px` }
            : undefined
          return (
            <button
              key={m.id}
              type="button"
              ref={(el) => {
                if (el) markerEls.current.set(m.id, el)
                else markerEls.current.delete(m.id)
              }}
              className="map-marker"
              hidden={!c}
              data-kind={m.kind}
              data-discovered={m.discovered || m.kind === 'exit'}
              data-enterable={m.enterable || undefined}
              data-highlight={m.id === highlightId || undefined}
              data-chip-over={(more > 0 && c?.chipOver) || undefined}
              aria-pressed={m.id === selectedId}
              aria-label={more ? `${name}: zoom in` : name}
              onClick={(e) => {
                if (c && more) onOpenCluster(c.members)
                else onSelect(m.id, e.detail === 0)
              }}
              onPointerEnter={(e) => e.pointerType === 'mouse' && hoverIn(m.id, false)}
              onPointerLeave={hoverOut}
              onFocus={(e) => e.currentTarget.matches(':focus-visible') && hoverIn(m.id, true)}
              onBlur={hoverOut}
            >
              <span className="map-marker__badge">
                <Pictogram icon={m.icon} />
              </span>
              {label && (
                <span className="map-label" data-slot={label.slot} style={labelStyle}>
                  {m.name}
                </span>
              )}
              {more > 0 && (
                <span className="map-marker__count" data-corner={c?.chip && c.chip !== 'tr' ? c.chip : undefined}>
                  +{more}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </>
  )
})
