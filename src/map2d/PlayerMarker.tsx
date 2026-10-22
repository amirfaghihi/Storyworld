import { useEffect, useRef } from 'react'
import { playerState } from '@/store/stores'
import { Icon } from '@/ui/kit'
import type { MapCamera } from './useMapCamera'

/** How far inside the viewport edge the off-screen pointer sits. */
const EDGE = 28

/**
 * "You are here": an accent disc with a heading wedge, the same size at every zoom, kept live
 * while the map is open (the traveller may still be sliding or falling). When the traveller is
 * off the edge of the view, a pointer on the edge shows which way they are and takes you back.
 * Runs its own light animation loop and writes transforms only when something moved.
 */
export function PlayerMarker({ cam, onLocate }: { cam: MapCamera; onLocate: () => void }) {
  const you = useRef<HTMLDivElement>(null)
  const wedge = useRef<SVGGElement>(null)
  const edge = useRef<HTMLButtonElement>(null)
  const arrow = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let raf = 0
    let lx = NaN
    let ly = NaN
    let lh = NaN
    let lOff: boolean | null = null
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const v = cam.view
      if (!cam.placed || !v.vw) return
      const px = v.vw / 2 + (playerState.map.x - v.cx) * v.s
      const py = v.vh / 2 + (playerState.map.z - v.cz) * v.s
      // the same heading convention as the minimap: 0° points north (up), clockwise
      const heading = ((Math.PI - playerState.yaw) * 180) / Math.PI
      const off = px < 0 || py < 0 || px > v.vw || py > v.vh
      if (px === lx && py === ly && heading === lh && off === lOff) return
      lx = px
      ly = py
      lh = heading
      if (off !== lOff) {
        lOff = off
        if (you.current) you.current.hidden = off
        if (edge.current) edge.current.hidden = !off
      }
      if (!off) {
        if (you.current) you.current.style.transform = `translate3d(${px}px, ${py}px, 0)`
        wedge.current?.setAttribute('transform', `rotate(${heading} 32 32)`)
      } else if (edge.current) {
        const ex = Math.min(v.vw - EDGE, Math.max(EDGE, px))
        const ey = Math.min(v.vh - EDGE, Math.max(EDGE, py))
        edge.current.style.transform = `translate3d(${ex}px, ${ey}px, 0)`
        const toward = (Math.atan2(py - ey, px - ex) * 180) / Math.PI
        if (arrow.current) arrow.current.style.transform = `rotate(${toward}deg)`
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [cam])
  return (
    <>
      <div className="map-you" ref={you} aria-hidden="true" hidden>
        <svg viewBox="0 0 64 64" width="64" height="64">
          <g ref={wedge}>
            <path d="M32 32 14.8 7.4A30 30 0 0 1 49.2 7.4Z" className="map-you__wedge" />
          </g>
          <circle cx="32" cy="32" r="8" className="map-you__pulse" />
          <circle cx="32" cy="32" r="8" className="map-you__ring" />
          <circle cx="32" cy="32" r="6" className="map-you__dot" />
        </svg>
      </div>
      <button type="button" className="map-you-edge" ref={edge} hidden onClick={onLocate} aria-label="You are off the map view: centre on me" data-map-chrome>
        <span className="map-you-edge__arrow" ref={arrow}>
          <Icon name="chevronRight" />
        </span>
        <span className="map-you-edge__label">You</span>
      </button>
    </>
  )
}
