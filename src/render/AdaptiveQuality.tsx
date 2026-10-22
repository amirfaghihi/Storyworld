import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useSettingsStore, baseStepFor } from '@/store/stores'

/** Render-scale steps; the quality tier caps the top step. */
export const SCALE_STEPS = [1.5, 1.25, 1.0, 0.85, 0.7]
const LOW_FPS = 48
const HIGH_FPS = 57
const WARMUP = 4 // seconds after mount before judging (shader compiles stutter)
/** seconds to watch after stepping down, the first of which is skipped while the canvas resizes */
const PROBE_SECONDS = 4
/** a step down has to buy at least this much frame rate to be kept */
const MIN_GAIN = 1.08
/** first wait before trying a step down again after one bought nothing; doubles each time, to a cap */
const FUTILE_COOLDOWN = 60
const FUTILE_COOLDOWN_MAX = 600

/**
 * Watches the real frame rate and steps the render resolution down when it sags for a few
 * seconds, then back up when there is headroom for a while. The scene is usually GPU-fill-bound
 * at high pixel counts, so resolution is normally the lever that moves the frame time.
 *
 * Not always, though. A browser frame-rate cap (Chrome's Energy Saver holds pages to 30 fps on
 * battery), a 30 Hz display, or a busy main thread all show up as a low frame rate that no amount
 * of downscaling will lift — and before this check each of them walked the render scale all the
 * way to 0.7×, so the world turned blurry and stayed just as slow. So every step down is a trial:
 * if the next few seconds are not clearly faster, the step is undone and no further step down is
 * tried for a while.
 */
export function AdaptiveQuality() {
  const frames = useRef(0)
  const acc = useRef(0)
  const low = useRef(0)
  const high = useRef(0)
  const age = useRef(0)
  const lowSum = useRef(0)
  // the step down being tried: where it came from, the frame rate that prompted it, and what it measured since
  const trial = useRef<{ from: number; before: number; seconds: number; sum: number; n: number } | null>(null)
  const futileUntil = useRef(0)
  const futileWait = useRef(FUTILE_COOLDOWN)
  const futileFps = useRef(0)

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.25)
    age.current += dt
    frames.current++
    acc.current += dt
    if (acc.current < 1) return
    const fps = frames.current / acc.current
    frames.current = 0
    acc.current = 0
    if (age.current < WARMUP) return
    const s = useSettingsStore.getState()
    const maxStep = SCALE_STEPS.length - 1
    const minStep = baseStepFor(s.quality)
    let step = Math.max(s.scaleStep, minStep)

    const t = trial.current
    if (t) {
      t.seconds++
      if (t.seconds > 1) {
        t.sum += fps
        t.n++
      }
      if (t.seconds < PROBE_SECONDS) return
      trial.current = null
      const after = t.sum / Math.max(1, t.n)
      if (after < t.before * MIN_GAIN) {
        // resolution was not what held the frame rate down: put it back and leave it alone a while
        futileUntil.current = age.current + futileWait.current
        futileWait.current = Math.min(FUTILE_COOLDOWN_MAX, futileWait.current * 2)
        futileFps.current = t.before
        low.current = high.current = 0
        lowSum.current = 0
        if (s.scaleStep !== t.from) s.setScaleStep(t.from)
        if (import.meta.env.DEV) console.info(`adaptive quality: ${t.before.toFixed(0)} -> ${after.toFixed(0)} fps at a lower scale; not resolution-bound, back to ${SCALE_STEPS[t.from]}`)
        return
      }
      futileWait.current = FUTILE_COOLDOWN
    }

    if (fps < LOW_FPS) {
      low.current++
      lowSum.current += fps
      high.current = 0
    } else if (fps > HIGH_FPS) {
      high.current++
      low.current = 0
      lowSum.current = 0
    } else {
      low.current = 0
      lowSum.current = 0
      high.current = 0
    }
    if (low.current >= 3 && step < maxStep) {
      const before = lowSum.current / low.current
      low.current = 0
      lowSum.current = 0
      // after a futile trial, only try again once the wait is over, or sooner if things got clearly worse
      const waiting = age.current < futileUntil.current && before > futileFps.current * 0.8
      if (!waiting) {
        trial.current = { from: step, before, seconds: 0, sum: 0, n: 0 }
        step++
      }
    } else if (high.current >= 12 && step > minStep) {
      step--
      high.current = 0
    }
    if (step !== s.scaleStep) {
      s.setScaleStep(step)
      if (import.meta.env.DEV) console.info(`adaptive quality: ${fps.toFixed(0)} fps -> render scale ${SCALE_STEPS[step]}`)
    }
  })
  return null
}
