import { useEffect, useRef, useState } from 'react'
import { cameraState, useUiStore } from '@/store/stores'
import { touch, recomputeInput } from '@/player/useInput'
import { Icon } from './kit'

/** Coarse-pointer devices (phones, tablets) get on-screen controls. */
export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0)
}

const STICK_RADIUS = 56 // css px of full deflection

/**
 * Left half: a joystick appears where the thumb lands and drives movement relative to the camera.
 * Right half: dragging looks around, pinching zooms. A Run button (a toggle, aria-pressed) toggles sprint.
 */
export function TouchControls() {
  const mapOpen = useUiStore((s) => s.mapOpen)
  const codexOpen = useUiStore((s) => s.codexOpen)
  const [stick, setStick] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null)
  const [run, setRun] = useState(false)
  const stickId = useRef<number | null>(null)
  const lookId = useRef<number | null>(null)
  const last = useRef({ x: 0, y: 0 })
  const pinch = useRef<{ d: number; dist: number } | null>(null)
  const points = useRef(new Map<number, { x: number; y: number }>())

  useEffect(() => {
    touch.run = run
    recomputeInput()
  }, [run])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      // only the world's own canvas: a thumb on the minimap or the map must not walk or turn the camera
      if (!(e.target instanceof HTMLCanvasElement) || !e.target.closest('.canvas-wrap')) return
      points.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (e.clientX < window.innerWidth * 0.45 && stickId.current === null) {
        stickId.current = e.pointerId
        setStick({ x: e.clientX, y: e.clientY, dx: 0, dy: 0 })
      } else if (lookId.current === null) {
        lookId.current = e.pointerId
        last.current = { x: e.clientX, y: e.clientY }
      }
      if (points.current.size === 2) {
        const [a, b] = [...points.current.values()]
        pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: cameraState.distance }
      }
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      const p = points.current.get(e.pointerId)
      if (p) {
        p.x = e.clientX
        p.y = e.clientY
      }
      if (pinch.current && points.current.size === 2) {
        const [a, b] = [...points.current.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        cameraState.distance = Math.min(40, Math.max(4, (pinch.current.dist * pinch.current.d) / Math.max(20, d)))
        return
      }
      if (e.pointerId === stickId.current) {
        setStick((s) => {
          if (!s) return s
          let dx = e.clientX - s.x
          let dy = e.clientY - s.y
          const len = Math.hypot(dx, dy)
          if (len > STICK_RADIUS) {
            dx *= STICK_RADIUS / len
            dy *= STICK_RADIUS / len
          }
          touch.strafe = dx / STICK_RADIUS
          touch.forward = -dy / STICK_RADIUS
          recomputeInput()
          return { ...s, dx, dy }
        })
      } else if (e.pointerId === lookId.current) {
        const dx = e.clientX - last.current.x
        const dy = e.clientY - last.current.y
        last.current = { x: e.clientX, y: e.clientY }
        cameraState.yaw -= dx * 0.005
        cameraState.pitch = Math.min(1.35, Math.max(-0.8, cameraState.pitch + dy * 0.004))
      }
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      points.current.delete(e.pointerId)
      if (points.current.size < 2) pinch.current = null
      if (e.pointerId === stickId.current) {
        stickId.current = null
        touch.forward = 0
        touch.strafe = 0
        recomputeInput()
        setStick(null)
      }
      if (e.pointerId === lookId.current) lookId.current = null
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      touch.forward = 0
      touch.strafe = 0
      recomputeInput()
    }
  }, [])

  if (mapOpen || codexOpen) return null
  return (
    <>
      {stick && (
        <div className="stick" style={{ left: stick.x, top: stick.y }}>
          <div className="stick-knob" style={{ transform: `translate(${stick.dx}px, ${stick.dy}px)` }} />
        </div>
      )}
      <button type="button" className="sw-fab sw-glass" aria-pressed={run} aria-label="Run" onPointerDown={(e) => e.stopPropagation()} onClick={() => setRun((r) => !r)}>
        <Icon name="run" />
        <span aria-hidden="true">{run ? 'Running' : 'Run'}</span>
      </button>
    </>
  )
}
