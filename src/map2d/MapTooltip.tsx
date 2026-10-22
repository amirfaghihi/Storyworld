import { useEffect, useRef } from 'react'
import { TYPE_NAMES, type MarkerModel } from './markers'
import type { MapCamera } from './useMapCamera'

/** Gap between the marker's edge and the tooltip. */
const GAP = 10

/** The first sentence of a summary, so the tooltip stays a glance and the card holds the rest. */
function firstSentence(text: string | undefined): string {
  if (!text) return ''
  const m = /^(.{20,}?[.!?])(\s|$)/.exec(text)
  return m ? m[1] : text
}

/**
 * Hover and keyboard-focus preview of a marker: name, kind and region, one line of lore. It sits
 * beside the marker, flips to the other side near an edge, and follows the marker if the map
 * moves underneath it. Touch has no hover; a tap selects instead.
 */
export function MapTooltip({ cam, model, region, summary, markerSize }: { cam: MapCamera; model: MarkerModel | null; region?: string; summary?: string; markerSize: number }) {
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!model) return
    const place = () => {
      const t = el.current
      if (!t) return
      const v = cam.view
      const px = v.vw / 2 + (model.x - v.cx) * v.s
      const py = v.vh / 2 + (model.z - v.cz) * v.s
      const w = t.offsetWidth
      const h = t.offsetHeight
      const r = markerSize / 2
      let x = px + r + GAP
      if (x + w > v.vw - 8) x = px - r - GAP - w
      const y = Math.min(v.vh - 8 - h, Math.max(8, py - h / 2))
      t.style.transform = `translate3d(${Math.max(8, x)}px, ${y}px, 0)`
    }
    place()
    return cam.onFrame(place)
  }, [cam, model, markerSize])
  if (!model) return null
  return (
    <div className="map-tooltip" ref={el} role="tooltip">
      <strong className="map-tooltip__name">{model.name}</strong>
      <span className="map-tooltip__meta">
        {TYPE_NAMES[model.type]}
        {region ? ` · ${region}` : ''}
        {model.kind === 'landmark' && !model.discovered ? ' · not yet visited' : ''}
      </span>
      {summary && <p>{firstSentence(summary)}</p>}
    </div>
  )
}
