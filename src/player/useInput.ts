import { useEffect } from 'react'
import { cameraState, useUiStore } from '@/store/stores'
import { navigate } from '@/router'
import { useEditorStore } from '@/editor/editorStore'
import { advanceHours, timeState } from '@/render/timeOfDay'
import { KINDS, setWeather, weatherState } from '@/render/weather'

/** Module-level input state, read inside useFrame. */
export const input = {
  forward: 0, // -1..1  (W/S)
  strafe: 0, // -1..1  (A/D)
  turn: 0, // -1..1  (Q/E rotate camera)
  run: false,
  jump: false,
  pointerLocked: false,
}

/** On-screen joystick / run button state, mixed into `input` alongside the keyboard. */
export const touch = { forward: 0, strafe: 0, run: false }
if (import.meta.env.DEV) (window as unknown as { __touch: unknown }).__touch = touch

const keys = new Set<string>()
const LOOK_SPEED = 0.0022
const MIN_PITCH = -0.8 // negative = looking up
const MAX_PITCH = 1.35

function recompute() {
  const kf = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0)
  const ks = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0)
  input.forward = Math.max(-1, Math.min(1, kf + touch.forward))
  input.strafe = Math.max(-1, Math.min(1, ks + touch.strafe))
  input.turn = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0)
  input.run = keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.run
}
/** Called by the touch controls whenever the joystick moves. */
export function recomputeInput() {
  recompute()
}

function look(dx: number, dy: number) {
  cameraState.yaw -= dx * LOOK_SPEED
  cameraState.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, cameraState.pitch + dy * LOOK_SPEED * 0.8))
}

/**
 * Only the 3D view's own canvas drives the camera. The map and the minimap are canvases too, and
 * matching any canvas let a drag on them turn the camera, the wheel zoom it, and a click on the minimap
 * ask for pointer lock.
 */
const isCanvas = (t: EventTarget | null): t is HTMLCanvasElement => t instanceof HTMLCanvasElement && !!t.closest('.canvas-wrap')

/** HUD, popovers, dialogs, the map, lore card, editor: where Tab, Space and Enter belong to the focused control */
const UI_SCOPE = '.hud-top, .sw-popover, .overlay, .map-dialog, .lore-card, .editor, .portal-prompt'
const inUi = (t: EventTarget | null) => t instanceof Element && !!t.closest(UI_SCOPE)
const dialogOpen = () => {
  const u = useUiStore.getState()
  return u.mapOpen || u.codexOpen || u.worldsOpen
}

/**
 * How focus last arrived. A mouse click on a plain button (the editor's Undo, a sky preset) leaves focus on
 * it with no focus ring, and the player has not chosen it: Tab should keep its old meaning there (toggle
 * the editor), and Space or Enter should not press that button again. This is the :focus-visible
 * distinction, but tracked here rather than read from the selector at keydown time, because the spec lets
 * a key press itself make the focused element match :focus-visible, which would make every key look like
 * keyboard focus by the time our handler asks. So: a pointer press puts us in pointer mode, any key puts us
 * in keyboard mode, and whatever gains focus in pointer mode (by the click itself, or by a script running
 * after it) is remembered as pointer-focused until focus moves again.
 */
let pointerMode = false
let pointerFocused: Element | null = null
const keyboardFocus = (t: EventTarget | null) => t instanceof Element && t !== pointerFocused

/**
 * Installs keyboard + pointer listeners once (window level, so they work regardless of mount order).
 * Click the world to lock the pointer: then any mouse/touchpad movement looks around (Esc releases).
 * Without pointer lock, dragging on the canvas looks around. Wheel zooms. Q/E turn the camera.
 */
export function useInputListeners() {
  useEffect(() => {
    const ui = () => useUiStore.getState()
    const exitLock = () => {
      if (document.pointerLockElement) document.exitPointerLock()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      // something nearer the target already handled it (a popover's or the map's own Escape, say)
      if (e.defaultPrevented) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if ((e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') && inUi(e.target)) {
        // A control the keyboard focused keeps Space and Enter, so they press it and Enter on a button never
        // also walks through a nearby portal. In a dialog they always stay with the control: the game has
        // no use for them there.
        if (keyboardFocus(e.target) || dialogOpen()) return
        // A control a mouse click left focused: the key is the world's (Enter takes a nearby door, Space is
        // held like any game key), and must not press that control again. Stopping the keydown's default
        // stops Enter's click and Space's press; onKeyUp stops the keyup click some browsers send for Space.
        e.preventDefault()
      }
      if (e.code === 'Tab') {
        // Shift+Tab from the world is how the keyboard reaches the HUD; inside a dialog (the map, codex,
        // worlds) Tab only ever moves focus; and Tab from a control the keyboard focused moves on from it.
        if (e.shiftKey || dialogOpen()) return
        if (inUi(e.target) && keyboardFocus(e.target)) return
      }
      if (e.code === 'KeyM') {
        const open = !ui().mapOpen
        ui().setMapOpen(open)
        if (open) exitLock()
        return
      }
      if (e.code === 'KeyC') {
        const open = !ui().codexOpen
        ui().setCodexOpen(open)
        if (open) exitLock()
        return
      }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        const portal = ui().portal
        if (portal && !ui().mapOpen && !ui().codexOpen && !ui().worldsOpen) {
          exitLock()
          keys.clear()
          recompute()
          navigate(portal.targetId, portal.x, portal.z)
        }
        return
      }
      if (e.code === 'KeyT') {
        timeState.paused = !timeState.paused
        return
      }
      if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
        advanceHours(e.code === 'BracketRight' ? 1 : -1)
        return
      }
      if (e.code === 'KeyY') {
        // cycle through the weathers and back to letting the land choose
        const i = weatherState.locked ? KINDS.indexOf(weatherState.locked) + 1 : 0
        setWeather(i >= KINDS.length ? null : KINDS[i])
        return
      }
      if (e.code === 'Tab') {
        e.preventDefault()
        const ed = useEditorStore.getState()
        ed.setEnabled(!ed.enabled)
        if (!ed.enabled) {
          exitLock()
          ui().setMapOpen(false)
          ui().setCodexOpen(false)
        }
        return
      }
      // Escape reaches here only if no popover or map consumed it: they catch it on window in the capture
      // phase and stop it there, so one press closes only the innermost thing
      if (e.code === 'Escape') {
        ui().setMapOpen(false)
        ui().setCodexOpen(false)
        ui().setWorldsOpen(false)
        ui().setSelectedLandmark(null)
        return
      }
      if (ui().mapOpen || ui().codexOpen || ui().worldsOpen) return
      keys.add(e.code)
      recompute()
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && inUi(e.target) && !keyboardFocus(e.target) && !dialogOpen()) e.preventDefault()
      keys.delete(e.code)
      recompute()
    }
    const onBlur = () => {
      keys.clear()
      recompute()
    }
    // capture phase on window, registered at start-up: these run before any control or dialog handler
    // can move focus in response to the same press
    const onAnyPointer = () => {
      pointerMode = true
    }
    const onAnyKey = () => {
      pointerMode = false
    }
    const onFocusIn = (e: FocusEvent) => {
      pointerFocused = pointerMode && e.target instanceof Element ? e.target : null
    }

    let dragging = false
    let moved = 0
    let lastX = 0
    let lastY = 0
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return // TouchControls owns touch input
      if (e.defaultPrevented) return
      if (!isCanvas(e.target) || (e.button !== 0 && e.button !== 2)) return
      if (useEditorStore.getState().enabled && e.button === 0) return // the brush owns the left button
      dragging = true
      moved = 0
      lastX = e.clientX
      lastY = e.clientY
    }
    const onMove = (e: PointerEvent) => {
      if (document.pointerLockElement) {
        look(e.movementX, e.movementY)
        return
      }
      if (!dragging) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      moved += Math.abs(dx) + Math.abs(dy)
      look(dx * 1.6, dy * 1.6)
    }
    const onUp = (e: PointerEvent) => {
      if (!dragging) return
      dragging = false
      // a plain click (no drag) on the world engages pointer lock for free look
      if (moved < 4 && isCanvas(e.target) && !document.pointerLockElement && !ui().mapOpen && !ui().codexOpen && !useEditorStore.getState().enabled) {
        const p = e.target.requestPointerLock?.({ unadjustedMovement: true } as PointerLockOptions) as unknown
        if (p instanceof Promise) p.catch(() => e.target && (e.target as HTMLCanvasElement).requestPointerLock())
      }
    }
    const onLockChange = () => {
      input.pointerLocked = !!document.pointerLockElement
      ui().setPointerLocked(input.pointerLocked)
    }
    const onWheel = (e: WheelEvent) => {
      if (e.defaultPrevented) return
      if (!isCanvas(e.target) && !document.pointerLockElement) return
      cameraState.distance = Math.min(40, Math.max(4, cameraState.distance * (1 + e.deltaY * 0.0012)))
    }
    const onCtx = (e: MouseEvent) => {
      if (isCanvas(e.target)) e.preventDefault()
    }

    window.addEventListener('pointerdown', onAnyPointer, true)
    window.addEventListener('keydown', onAnyKey, true)
    document.addEventListener('focusin', onFocusIn)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('contextmenu', onCtx)
    document.addEventListener('pointerlockchange', onLockChange)
    return () => {
      window.removeEventListener('pointerdown', onAnyPointer, true)
      window.removeEventListener('keydown', onAnyKey, true)
      document.removeEventListener('focusin', onFocusIn)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('contextmenu', onCtx)
      document.removeEventListener('pointerlockchange', onLockChange)
    }
  }, [])
}
