import { useEffect, useState, useSyncExternalStore } from 'react'
import type { MapView } from './drawMap'

/**
 * The map dialog's camera: where the view is centred, how far it is zoomed, and every gesture that
 * moves it (wheel and trackpad pinch, drag with inertia, two-finger pinch, double-click, keyboard).
 *
 * The camera lives outside React. A gesture changes `view` in place and calls the frame listeners
 * from one requestAnimationFrame loop that runs only while something moves, so the canvas, the
 * markers and the scale bar follow every frame without React re-rendering anything. React hears
 * only about the few things buttons need (whether you can zoom further in or out), and only when
 * they change. Because the camera object is created once per dialog, no re-render ever resets it
 * (the old map kept its drag state in a render-local variable and lost it on the first re-render).
 */

export interface CameraLimits {
  /** what "fit" frames, world metres [x0, z0, x1, z1] */
  fit: [number, number, number, number]
  /** CSS px per metre */
  maxS: number
  /** how far past the fit bounds the view may wander, as a fraction of the viewport */
  slack: number
}

/** Viewport margins (CSS px) that the map's own panels cover, kept out of "fit" and "centre". */
export interface CameraInsets {
  top: number
  right: number
  bottom: number
  left: number
}

type FrameListener = (view: Readonly<MapView>, moving: boolean) => void

export interface ZoomState {
  canZoomIn: boolean
  canZoomOut: boolean
}

const FIT_PAD = 24
const MIN_OF_FIT = 0.85
const DRAG_THRESHOLD = 5
const SETTLE_MS = 140

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Elements inside the viewport that take their own pointer input (controls, panels, the tooltip). */
const OWN_INPUT = '[data-map-chrome], .map-tooltip'
/** Elements a double-click on should not zoom. */
const NO_DBLCLICK = '[data-map-chrome], .map-marker, .map-you-edge'

export class MapCamera {
  readonly view: MapView = { cx: 0, cz: 0, s: 1, vw: 0, vh: 0, dpr: 1 }
  private limits: CameraLimits | null = null
  /** panels currently over the map: "centre" and "reveal" aim at the part they leave free */
  insets: CameraInsets = { top: 0, right: 0, bottom: 0, left: 0 }
  /**
   * panels that are always there (the phone sheet's peek): "fit" leaves them out too. A side card
   * that comes and goes does not change the fit, or opening it would zoom the map.
   */
  fitInsets: CameraInsets = { top: 0, right: 0, bottom: 0, left: 0 }
  /** false until the first viewport size and limits arrive and the view has been placed */
  placed = false

  private frameListeners = new Set<FrameListener>()
  private settleListeners = new Set<() => void>()
  private zoomListeners = new Set<() => void>()
  private resizeListeners = new Set<() => void>()
  private zoom: ZoomState = { canZoomIn: true, canZoomOut: true }

  private raf = 0
  private lastT = 0
  private redraw = false
  private settleTimer: ReturnType<typeof setTimeout> | undefined
  private wasMoving = false

  // what is in motion
  private gesture = false
  private wheelZoom: { s: number; px: number; py: number } | null = null
  private inertia: { vx: number; vy: number } | null = null
  private flight: { t0: number; ms: number; from: [number, number, number]; to: [number, number, number] } | null = null

  // ---- reading

  get fitScale(): number {
    const L = this.limits
    const { vw, vh } = this.view
    if (!L || !vw || !vh) return 1
    const i = this.fitInsets
    const w = Math.max(40, vw - i.left - i.right - 2 * FIT_PAD)
    const h = Math.max(40, vh - i.top - i.bottom - 2 * FIT_PAD)
    return Math.min(w / (L.fit[2] - L.fit[0]), h / (L.fit[3] - L.fit[1]))
  }
  get minS(): number {
    return this.fitScale * MIN_OF_FIT
  }
  get maxS(): number {
    return Math.max(this.limits?.maxS ?? 10, this.fitScale * 2)
  }
  get moving(): boolean {
    return this.gesture || !!this.wheelZoom || !!this.inertia || !!this.flight
  }

  /** World point → CSS px in the viewport. */
  toScreen(x: number, z: number): [number, number] {
    const v = this.view
    return [v.vw / 2 + (x - v.cx) * v.s, v.vh / 2 + (z - v.cz) * v.s]
  }
  /** CSS px in the viewport → world point. */
  toWorld(px: number, py: number): [number, number] {
    const v = this.view
    return [v.cx + (px - v.vw / 2) / v.s, v.cz + (py - v.vh / 2) / v.s]
  }

  // ---- listening

  /** Called on every frame the view changes (and on redraw requests), with whether it is still moving. */
  onFrame(fn: FrameListener): () => void {
    this.frameListeners.add(fn)
    return () => this.frameListeners.delete(fn)
  }
  /** Called once the view has stopped moving for a moment (time for a full-detail frame and a fresh label layout). */
  onSettle(fn: () => void): () => void {
    this.settleListeners.add(fn)
    return () => this.settleListeners.delete(fn)
  }
  subscribeZoom = (fn: () => void): (() => void) => {
    this.zoomListeners.add(fn)
    return () => this.zoomListeners.delete(fn)
  }
  getZoom = (): ZoomState => this.zoom
  /**
   * Called when the viewport's size changes (a window resize, a phone turning), after the view
   * has the new size: panels sized from the map's height re-measure here, not on the window's
   * resize event, which comes before the map has its new size.
   */
  onResize(fn: () => void): () => void {
    this.resizeListeners.add(fn)
    return () => this.resizeListeners.delete(fn)
  }

  // ---- configuring

  setViewport(vw: number, vh: number, dpr: number): void {
    const v = this.view
    if (v.vw === vw && v.vh === vh && v.dpr === dpr) return
    v.vw = vw
    v.vh = vh
    v.dpr = dpr
    if (this.placed) this.clampView()
    this.requestFrame(true)
    for (const fn of this.resizeListeners) fn()
  }

  /**
   * Sets what the panels cover (`insets`) and what always does (`fitInsets`). An open panel lets
   * the map travel further on its side (see clamped), so a place by the map's edge can come out
   * from under it; when the panel closes or shrinks that travel goes, and a view that used it
   * glides back in with the panel rather than show a band of void until the next drag jumps it.
   * A flight or gesture under way clamps every step with the new insets already.
   */
  setInsets(insets: CameraInsets, fitInsets: CameraInsets = this.fitInsets): void {
    this.insets = insets
    this.fitInsets = fitInsets
    if (!this.placed || this.moving) return
    const v = this.view
    const s = clamp(v.s, this.minS, this.maxS)
    const [x, z] = this.clamped(v.cx, v.cz, s)
    if (Math.abs(x - v.cx) * s > 0.5 || Math.abs(z - v.cz) * s > 0.5 || Math.abs(s / v.s - 1) > 1e-3) this.flyTo(x, z, s, 260)
  }

  setLimits(limits: CameraLimits): void {
    this.limits = limits
    if (this.placed) this.clampView()
    this.requestFrame(true)
  }

  /** Whether the camera has both a viewport size and limits, so it can be placed. */
  get ready(): boolean {
    return !!this.limits && this.view.vw > 0 && this.view.vh > 0
  }

  // ---- moving: instant

  /** Puts the view at (x, z) with scale s (clamped), with no animation. */
  jumpTo(x: number, z: number, s = this.view.s): void {
    this.stop()
    const v = this.view
    v.cx = x
    v.cz = z
    v.s = s
    this.placed = true
    this.clampView()
    this.requestFrame(true)
    this.scheduleSettle()
  }

  /** Moves the map by (dx, dy) CSS px: the map follows the finger. */
  panBy(dx: number, dy: number): void {
    const v = this.view
    v.cx -= dx / v.s
    v.cz -= dy / v.s
    this.clampView()
    this.requestFrame(true)
  }

  /** Zooms by `factor` keeping the world point under (px, py) where it is. */
  zoomAt(px: number, py: number, factor: number): void {
    const v = this.view
    const [wx, wz] = this.toWorld(px, py)
    v.s = clamp(v.s * factor, this.minS, this.maxS)
    v.cx = wx - (px - v.vw / 2) / v.s
    v.cz = wz - (py - v.vh / 2) / v.s
    this.clampView()
    this.requestFrame(true)
  }

  // ---- moving: animated

  /** Eases the zoom to `factor` times the current (or pending) zoom about (px, py). */
  zoomBy(factor: number, px = this.view.vw / 2, py = this.view.vh / 2): void {
    this.flight = null
    this.inertia = null
    const base = this.wheelZoom?.s ?? this.view.s
    const s = clamp(base * factor, this.minS, this.maxS)
    if (reducedMotion()) {
      this.wheelZoom = null
      this.zoomAt(px, py, s / this.view.s)
      this.scheduleSettle()
      return
    }
    this.wheelZoom = { s, px, py }
    this.requestFrame(false)
  }

  /** Flies to (x, z) at scale s (default: keep the zoom), easing centre and log-zoom together. */
  flyTo(x: number, z: number, s = this.view.s, ms?: number): void {
    const v = this.view
    s = clamp(s, this.minS, this.maxS)
    // aim at the clamped destination, so the flight does not end in a jump
    const to = this.clamped(x, z, s)
    if (reducedMotion() || !this.placed) {
      this.jumpTo(to[0], to[1], s)
      return
    }
    const dist = Math.hypot((to[0] - v.cx) * v.s, (to[1] - v.cz) * v.s) + Math.abs(Math.log(s / v.s)) * 300
    this.stop()
    this.flight = { t0: performance.now(), ms: ms ?? clamp(300 + dist * 0.35, 300, 700), from: [v.cx, v.cz, Math.log(v.s)], to: [to[0], to[1], Math.log(s)] }
    this.requestFrame(false)
  }

  /** Pans by a share of the viewport (keyboard arrows), with a short glide. */
  nudge(fx: number, fy: number): void {
    const v = this.view
    this.flyTo(v.cx + (fx * v.vw) / v.s, v.cz + (fy * v.vh) / v.s, v.s, 180)
  }

  /** Frames a world box [x0, z0, x1, z1] inside the free part of the viewport. */
  fitBox(box: [number, number, number, number], pad = 48, maxS = this.maxS): void {
    const v = this.view
    const i = this.insets
    const w = Math.max(40, v.vw - i.left - i.right - 2 * pad)
    const h = Math.max(40, v.vh - i.top - i.bottom - 2 * pad)
    const s = Math.min(maxS, w / Math.max(1e-6, box[2] - box[0]), h / Math.max(1e-6, box[3] - box[1]))
    const [x, z] = this.centreFor((box[0] + box[2]) / 2, (box[1] + box[3]) / 2, s)
    this.flyTo(x, z, s)
  }

  /** Shows the whole map. */
  fit(animate = true): void {
    const L = this.limits
    if (!L) return
    const s = this.fitScale
    const i = this.fitInsets
    const x = (L.fit[0] + L.fit[2]) / 2 + (i.right - i.left) / 2 / s
    const z = (L.fit[1] + L.fit[3]) / 2 + (i.bottom - i.top) / 2 / s
    if (animate) this.flyTo(x, z, s)
    else this.jumpTo(x, z, s)
  }

  /**
   * The view centre that puts world point (x, z) in the middle of the part of the viewport no
   * panel covers, at scale s.
   */
  centreFor(x: number, z: number, s = this.view.s): [number, number] {
    const i = this.insets
    return [x + (i.right - i.left) / 2 / s, z + (i.bottom - i.top) / 2 / s]
  }

  /** Brings a world point into the free part of the viewport if it is hidden or near an edge; else leaves the view alone. */
  reveal(x: number, z: number, margin = 56): void {
    const [px, py] = this.toScreen(x, z)
    const i = this.insets
    const v = this.view
    if (px > i.left + margin && px < v.vw - i.right - margin && py > i.top + margin && py < v.vh - i.bottom - margin) return
    const [cx, cz] = this.centreFor(x, z)
    this.flyTo(cx, cz)
  }

  /** Stops every animation (a new gesture takes over). */
  stop(): void {
    this.wheelZoom = null
    this.inertia = null
    this.flight = null
  }

  /** Asks for a frame without moving: the base map changed, or the canvas was resized. */
  invalidate(): void {
    this.requestFrame(true)
  }

  // ---- internals

  /**
   * The nearest view centre to (x, z) at scale s that keeps the map filling the viewport (no
   * slack), for first views: opening on the traveller near a coast should not show a band of void.
   */
  snugCentre(x: number, z: number, s: number): [number, number] {
    return this.clamped(x, z, s, 0)
  }

  private clamped(x: number, z: number, s: number, slackOverride?: number): [number, number] {
    const L = this.limits
    const v = this.view
    if (!L || !v.vw) return [x, z]
    const [x0, z0, x1, z1] = L.fit
    const slack = slackOverride ?? L.slack
    const hw = v.vw / 2 / s
    const hh = v.vh / 2 / s
    const sx = (slack * v.vw) / s
    const sz = (slack * v.vh) / s
    // a panel over the map (the phone's sheet, the side card) hides its edge of the view: the
    // map may move that much further, so a place near the map's edge can still come out from
    // under the panel (selecting it must never leave it hidden)
    const i = this.insets
    const lox = x0 - sx + hw - i.left / s
    const hix = x1 + sx - hw + i.right / s
    const loz = z0 - sz + hh - i.top / s
    const hiz = z1 + sz - hh + i.bottom / s
    return [lox > hix ? (x0 + x1) / 2 : clamp(x, lox, hix), loz > hiz ? (z0 + z1) / 2 : clamp(z, loz, hiz)]
  }

  private clampView(): void {
    const v = this.view
    v.s = clamp(v.s, this.minS, this.maxS)
    const [x, z] = this.clamped(v.cx, v.cz, v.s)
    v.cx = x
    v.cz = z
    this.updateZoomState()
  }

  private updateZoomState(): void {
    const s = this.wheelZoom?.s ?? this.view.s
    const canZoomIn = s < this.maxS * 0.999
    const canZoomOut = s > this.minS * 1.001
    if (canZoomIn !== this.zoom.canZoomIn || canZoomOut !== this.zoom.canZoomOut) {
      this.zoom = { canZoomIn, canZoomOut }
      for (const fn of this.zoomListeners) fn()
    }
  }

  private requestFrame(redraw: boolean): void {
    if (redraw) this.redraw = true
    if (!this.raf && typeof requestAnimationFrame !== 'undefined') {
      this.lastT = performance.now()
      this.raf = requestAnimationFrame(this.tick)
    }
  }

  private tick = (t: number): void => {
    this.raf = 0
    const dt = Math.min(64, Math.max(0, t - this.lastT))
    this.lastT = t
    const v = this.view
    let changed = this.redraw
    this.redraw = false

    if (this.flight) {
      const f = this.flight
      const k = Math.min(1, (performance.now() - f.t0) / f.ms)
      const e = easeInOutCubic(k)
      v.cx = f.from[0] + (f.to[0] - f.from[0]) * e
      v.cz = f.from[1] + (f.to[1] - f.from[1]) * e
      v.s = Math.exp(f.from[2] + (f.to[2] - f.from[2]) * e)
      if (k >= 1) this.flight = null
      this.clampView()
      changed = true
    }
    if (this.wheelZoom) {
      const w = this.wheelZoom
      // ease the zoom toward the wheel's target (τ ≈ 90 ms), about the cursor
      const k = 1 - Math.exp(-dt / 90)
      const next = Math.exp(Math.log(v.s) + (Math.log(w.s) - Math.log(v.s)) * k)
      const done = Math.abs(Math.log(w.s / next)) < 0.003
      this.wheelZoom = done ? null : w
      this.zoomAt(w.px, w.py, (done ? w.s : next) / v.s)
      changed = true
    }
    if (this.inertia && !this.gesture) {
      const m = this.inertia
      this.panBy(m.vx * dt, m.vy * dt)
      const decay = Math.exp(-dt / 325)
      m.vx *= decay
      m.vy *= decay
      if (Math.hypot(m.vx, m.vy) < 0.02) this.inertia = null
      changed = true
    }

    const moving = this.moving
    if (changed) for (const fn of this.frameListeners) fn(v, moving)
    if (moving) {
      this.wasMoving = true
      this.requestFrame(false)
    } else if (this.wasMoving) {
      this.wasMoving = false
      this.scheduleSettle()
    }
  }

  private scheduleSettle(): void {
    clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => {
      if (this.moving) return
      for (const fn of this.settleListeners) fn()
    }, SETTLE_MS)
  }

  /**
   * Wires the gestures to the viewport element; returns the cleanup. The wheel listener is native
   * and non-passive: React's onWheel is passive, so a trackpad pinch (a wheel event with ctrlKey)
   * would zoom the whole page instead of the map.
   */
  attach(el: HTMLElement): () => void {
    const local = (e: { clientX: number; clientY: number }): [number, number] => {
      const r = el.getBoundingClientRect()
      return [e.clientX - r.left, e.clientY - r.top]
    }
    const ownInput = (t: EventTarget | null) => t instanceof Element && !!t.closest(OWN_INPUT)

    const onWheel = (e: WheelEvent) => {
      // over a panel or control the wheel scrolls that, as anywhere else on a page
      if (ownInput(e.target)) return
      e.preventDefault()
      if (!this.placed) return
      const [px, py] = local(e)
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.view.vh : 1)
      if (e.ctrlKey) {
        // trackpad pinch: follow the fingers exactly
        this.stop()
        this.zoomAt(px, py, Math.exp(-dy * 0.01))
        this.scheduleSettle()
      } else this.zoomBy(Math.exp(-dy * 0.0022), px, py)
    }

    // Safari's trackpad pinch arrives as gesture events rather than ctrl+wheel
    let gestureScale = 1
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      gestureScale = 1
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const g = e as Event & { scale: number; clientX: number; clientY: number }
      const [px, py] = local(g)
      this.stop()
      this.zoomAt(px, py, g.scale / gestureScale)
      gestureScale = g.scale
      this.scheduleSettle()
    }

    const pointers = new Map<number, { x: number; y: number }>()
    let start: { x: number; y: number } | null = null
    let dragging = false
    let suppressClick = false
    let pinch: { d: number; mx: number; my: number } | null = null
    // recent pointer positions for the release velocity (a fixed ring, no per-move allocation)
    const SAMPLES = 8
    const sx = new Float64Array(SAMPLES)
    const sy = new Float64Array(SAMPLES)
    const st = new Float64Array(SAMPLES)
    let sn = 0
    const sample = (x: number, y: number) => {
      const i = sn++ % SAMPLES
      sx[i] = x
      sy[i] = y
      st[i] = performance.now()
    }
    const pinchOf = () => {
      const [a, b] = [...pointers.values()]
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
    }

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (ownInput(e.target) || !this.placed) return
      const [x, y] = local(e)
      pointers.set(e.pointerId, { x, y })
      suppressClick = false
      this.inertia = null
      this.flight = null
      if (pointers.size === 1) {
        start = { x, y }
        dragging = false
        sn = 0
        sample(x, y)
      } else if (pointers.size === 2) {
        // a second finger turns the drag into a pinch
        pinch = pinchOf()
        dragging = true
        this.gesture = true
        for (const id of pointers.keys()) if (!el.hasPointerCapture(id)) el.setPointerCapture(id)
      }
    }
    const onMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId)
      if (!p) return
      const [x, y] = local(e)
      const dx = x - p.x
      const dy = y - p.y
      p.x = x
      p.y = y
      if (pointers.size === 1) {
        if (!dragging && start && Math.hypot(x - start.x, y - start.y) > DRAG_THRESHOLD) {
          // capture only now, so a plain click on a marker still reaches the marker
          dragging = true
          this.gesture = true
          this.wheelZoom = null
          el.setPointerCapture(e.pointerId)
          el.classList.add('is-dragging')
        }
        if (dragging) {
          this.panBy(dx, dy)
          sample(x, y)
        }
      } else if (pointers.size === 2 && pinch) {
        const now = pinchOf()
        this.panBy(now.mx - pinch.mx, now.my - pinch.my)
        if (pinch.d > 0) this.zoomAt(now.mx, now.my, now.d / pinch.d)
        pinch = now
      }
    }
    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (pointers.size === 1) {
        // one finger left after a pinch: carry on panning from where it is
        const [rest] = pointers.values()
        start = { x: rest.x, y: rest.y }
        pinch = null
        sn = 0
        return
      }
      if (pointers.size > 0) return
      el.classList.remove('is-dragging')
      if (dragging) {
        suppressClick = true
        // release velocity from the last ~100 ms of movement
        const n = Math.min(sn, SAMPLES)
        const last = (sn - 1) % SAMPLES
        const now = performance.now()
        let first = last
        for (let k = 1; k < n; k++) {
          const i = (sn - 1 - k) % SAMPLES
          if (now - st[i] > 100) break
          first = i
        }
        const dt = st[last] - st[first]
        if (dt > 8 && e.type === 'pointerup' && !reducedMotion() && now - st[last] < 60) {
          const vx = (sx[last] - sx[first]) / dt
          const vy = (sy[last] - sy[first]) / dt
          if (Math.hypot(vx, vy) > 0.25) this.inertia = { vx, vy }
        }
      }
      dragging = false
      pinch = null
      start = null
      this.gesture = false
      this.requestFrame(false)
    }
    // a window that loses focus mid-press may never send the pointer's end: drop every press
    const onBlur = () => {
      if (!pointers.size) return
      for (const id of pointers.keys()) if (el.hasPointerCapture(id)) el.releasePointerCapture(id)
      pointers.clear()
      el.classList.remove('is-dragging')
      dragging = false
      pinch = null
      start = null
      this.gesture = false
      this.requestFrame(false)
    }
    // a drag that ends over a marker must not also click it
    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClick) return
      suppressClick = false
      e.stopPropagation()
      e.preventDefault()
    }
    const onDblClick = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest(NO_DBLCLICK)) return
      const [px, py] = local(e)
      this.zoomBy(e.shiftKey ? 0.5 : 2, px, py)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', onGestureStart)
    el.addEventListener('gesturechange', onGestureChange)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    // Ends are heard on the window: a press is only captured once it moves past the drag
    // threshold, so one released outside the viewport before then never reaches `el`, and a
    // pointer left behind in `pointers` would turn the next press into a two-finger pinch.
    // (A captured pointer's end still targets `el` and bubbles here; onUp ignores repeats.)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('blur', onBlur)
    el.addEventListener('click', onClickCapture, true)
    el.addEventListener('dblclick', onDblClick)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('blur', onBlur)
      el.removeEventListener('click', onClickCapture, true)
      el.removeEventListener('dblclick', onDblClick)
    }
  }

  /** Stops the frame loop and timers (the dialog closed). */
  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    clearTimeout(this.settleTimer)
    this.stop()
  }
}

/** One camera for the life of the dialog; it is never recreated by a re-render. */
export function useMapCamera(): MapCamera {
  const [cam] = useState(() => new MapCamera())
  useEffect(() => () => cam.dispose(), [cam])
  return cam
}

/** Whether the zoom buttons can act; re-renders only when that changes. */
export function useMapZoom(cam: MapCamera): ZoomState {
  return useSyncExternalStore(cam.subscribeZoom, cam.getZoom)
}
