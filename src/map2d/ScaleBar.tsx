import { useEffect, useRef } from 'react'
import { WALK_SPEED } from '@/player/KinematicController'
import type { MapCamera } from './useMapCamera'

/** Target bar length in CSS px; the bar shows the round distance nearest to it. */
const TARGET_PX = 100
/** Earth: kilometres per degree of latitude (a globe's map units are degrees). */
const KM_PER_DEG = 111.19

/** The round length (1, 2 or 5 × a power of ten) nearest to `raw`. */
export function niceLength(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / p
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p
}

const fmtMetres = (m: number) => (m >= 1000 ? `${+(m / 1000).toFixed(1)} km` : `${+m.toFixed(m < 10 ? 1 : 0)} m`)
/**
 * The middle tick: bare when it is in the end label's unit ('0 · 50 · 100 m'), with its own unit
 * when the end label has moved up to the next one ('0 · 500 m · 1 km'), where a bare 500 would
 * read as 500 km.
 */
function halfLabel(half: string, end: string): string {
  const unit = / (k?m)$/.exec(half)?.[1]
  return unit && end.endsWith(` ${unit}`) ? half.slice(0, -unit.length - 1) : half
}
const fmtTime = (sec: number) => (sec < 90 ? `${Math.max(1, Math.round(sec))} s` : sec < 5400 ? `${Math.round(sec / 60)} min` : `${+(sec / 3600).toFixed(1)} h`)

/**
 * A scale bar in round lengths, with how long that is on foot. It follows the camera every frame
 * but touches the DOM only when the length or the bar's width changes.
 */
export function ScaleBar({ cam, globe, speedScale = 1 }: { cam: MapCamera; globe: boolean; speedScale?: number }) {
  const bar = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLSpanElement>(null)
  const half = useRef<HTMLSpanElement>(null)
  const foot = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let lastW = -1
    let lastL = -1
    const update = () => {
      const v = cam.view
      if (!v.s) return
      let unitsPerPx = 1 / v.s
      let km = false
      if (globe) {
        // degrees → km along the parallel at the view's centre latitude
        const lat = ((90 - v.cz) * Math.PI) / 180
        unitsPerPx = (KM_PER_DEG * Math.max(0.05, Math.cos(lat))) / v.s
        km = true
      }
      const L = niceLength(TARGET_PX * unitsPerPx)
      const w = Math.round(L / unitsPerPx)
      if (w === lastW && L === lastL) return
      lastW = w
      lastL = L
      if (bar.current) bar.current.style.width = `${w}px`
      const end = km ? `${+L.toFixed(1)} km` : fmtMetres(L)
      if (label.current) label.current.textContent = end
      if (half.current) half.current.textContent = halfLabel(km ? `${+(L / 2).toFixed(2)} km` : fmtMetres(L / 2), end)
      if (foot.current) foot.current.textContent = globe ? '' : `≈ ${fmtTime(L / (WALK_SPEED * speedScale))} on foot`
    }
    update()
    const off = cam.onFrame(update)
    return () => {
      off()
    }
  }, [cam, globe, speedScale])
  return (
    <div className="map-scalebar" data-map-chrome aria-hidden="true">
      <div className="map-scalebar__scale" ref={bar}>
        <div className="map-scalebar__bar">
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="map-scalebar__ticks">
          <span>0</span>
          <span ref={half} />
          <span ref={label} />
        </div>
      </div>
      <span className="map-scalebar__foot" ref={foot} />
    </div>
  )
}
