import { useEffect, useRef, type ReactNode } from 'react'

export type SheetSnap = 'peek' | 'half' | 'full'

const setSheet = (el: HTMLElement, h: string) => (el.parentElement ?? el).style.setProperty('--sheet', h)

const ORDER: SheetSnap[] = ['peek', 'half', 'full']
/** Heights per snap; peek is the strip that always shows above the bottom edge. */
export const SHEET_PEEK = 76
/** The sheet's own height as a share of the map it lies over (map.css .map-sheet-panel). */
const SHEET_MAX = 0.92

/**
 * The least a half-open sheet shows: the 44 px handle over a card's title, a line of its summary
 * and its Travel button. Below this the card is a strip with nothing in it.
 */
const SHEET_HALF_MIN = 200

/**
 * How much of the sheet shows at a snap, in CSS px, over a map `mapH` px tall. The camera keeps
 * selected places out from under the sheet with these same numbers, so they must be the sheet's
 * real heights. Half leaves a little over half the map free (436 of 792 px on a 390×844 phone),
 * room for the selected place above the card, and on a tall map keeps at least 240 px of map
 * free. A short map (a phone held sideways: 323 px on a 667×375 one) cannot spare both, and the
 * card comes first, so half never drops under SHEET_HALF_MIN (123 px of map stay free there,
 * enough for the place above it). Full is the whole sheet.
 */
export function sheetHeight(snap: SheetSnap, mapH: number): number {
  const full = Math.round(mapH * SHEET_MAX)
  if (snap === 'peek') return SHEET_PEEK
  if (snap === 'full') return full
  const roomy = Math.min(Math.max(mapH * 0.45, 280), mapH - 240)
  // on the very shortest maps (268 px on a 568×320 phone) the floor gives a little back, so the
  // place keeps about a hundred pixels of map above the card
  return Math.round(Math.min(Math.max(roomy, Math.min(SHEET_HALF_MIN, mapH * 0.62)), full))
}

const mapHeightOf = (el: HTMLElement) => (el.parentElement ?? el).clientHeight || window.innerHeight

/**
 * The phone layout's panel: a sheet over the bottom of the map that peeks (a handle and a line of
 * text), opens half way, or nearly full. Drag the handle, or tap it to step through the heights.
 * The sheet stays the same element at every height (only its offset changes), so content keeps
 * its scroll position and focus; its body is sized to the part that shows, so a card's footer
 * (Travel here) sits above the screen's edge at every height.
 *
 * `peek` is the handle's line of text. With `peekWhenOpen` false it shows only while the sheet is
 * down: a place card names its place in its own title, and the name should not appear twice.
 */
export function BottomSheet({
  snap,
  onSnap,
  label,
  peek,
  peekWhenOpen = true,
  children,
}: {
  snap: SheetSnap
  onSnap: (s: SheetSnap) => void
  label: string
  peek: ReactNode
  peekWhenOpen?: boolean
  children: ReactNode
}) {
  const sheet = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null)

  // the visible height drives --sheet on the map viewport: the sheet's offset, its body's height,
  // and the line the map's controls sit above. The map's height changes when a phone turns.
  useEffect(() => {
    const el = sheet.current
    if (!el) return
    const apply = () => {
      if (!drag.current) setSheet(el, `${sheetHeight(snap, mapHeightOf(el))}px`)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el.parentElement ?? el)
    return () => ro.disconnect()
  }, [snap])

  const onDown = (e: React.PointerEvent) => {
    const el = sheet.current
    if (!el) return
    drag.current = { y: e.clientY, h: sheetHeight(snap, mapHeightOf(el)), moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
    el.dataset.dragging = ''
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    const el = sheet.current
    if (!d || !el) return
    const dy = e.clientY - d.y
    if (Math.abs(dy) > 4) d.moved = true
    const h = Math.min(sheetHeight('full', mapHeightOf(el)), Math.max(SHEET_PEEK, d.h - dy))
    setSheet(el, `${h}px`)
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    const el = sheet.current
    drag.current = null
    if (!d || !el) return
    delete el.dataset.dragging
    const mapH = mapHeightOf(el)
    if (!d.moved) {
      // a tap steps up, and from full back down to peek
      onSnap(ORDER[(ORDER.indexOf(snap) + 1) % ORDER.length])
      return
    }
    const h = d.h - (e.clientY - d.y)
    let best: SheetSnap = 'peek'
    for (const s of ORDER) if (Math.abs(sheetHeight(s, mapH) - h) < Math.abs(sheetHeight(best, mapH) - h)) best = s
    setSheet(el, `${sheetHeight(best, mapH)}px`)
    onSnap(best)
  }
  // The browser took the pointer (a scroll, a system gesture): neither a tap nor a drag to keep,
  // so the sheet goes back to where it was.
  const onCancel = () => {
    const el = sheet.current
    const d = drag.current
    drag.current = null
    if (!el || !d) return
    delete el.dataset.dragging
    setSheet(el, `${sheetHeight(snap, mapHeightOf(el))}px`)
  }

  const showPeek = snap === 'peek' || peekWhenOpen
  return (
    <section className="map-sheet-panel" ref={sheet} data-snap={snap} data-compact={showPeek ? undefined : ''} aria-label={label} data-map-chrome>
      <button
        type="button"
        className="map-sheet-panel__handle"
        aria-label={snap === 'full' ? `Lower ${label.toLowerCase()}` : `Raise ${label.toLowerCase()}`}
        aria-expanded={snap !== 'peek'}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const i = ORDER.indexOf(snap) + (e.key === 'ArrowUp' ? 1 : -1)
            onSnap(ORDER[Math.max(0, Math.min(ORDER.length - 1, i))])
          }
        }}
        onClick={(e) => {
          // keyboard activation (pointer taps are handled on pointerup)
          if (e.detail === 0) onSnap(ORDER[(ORDER.indexOf(snap) + 1) % ORDER.length])
        }}
      >
        <span className="map-sheet-panel__grip" />
        {showPeek && <span className="map-sheet-panel__peek">{peek}</span>}
      </button>
      <div className="map-sheet-panel__body" hidden={snap === 'peek'}>
        {children}
      </div>
    </section>
  )
}
