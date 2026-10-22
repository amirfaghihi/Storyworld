import { useEffect } from 'react'
import { timeState } from '@/render/timeOfDay'
import { useSettingsStore } from '@/store/stores'

/** lamp (DayNight copies the time-of-day keyframes' lamp into timeState) above which the HUD goes dark */
const TO_NIGHT = 0.62
/** ...and below which it comes back; the gap keeps a scrubbed time slider from flickering the HUD */
const TO_DAY = 0.42

/**
 * Drives the two document-level attributes tokens.css keys off:
 *   <html data-scene="day|night">  parchment glass by day, ink glass by night (about 19:58 to 07:05 with
 *                                  the current keyframes)
 *   <html data-quality="low|...">  the low tier drops the backdrop blur
 * It keys on the lamp alone, not the weather, so a dark stormy noon keeps the day glass. Checked four
 * times a second from rAF, and the DOM is written only when the value changes.
 */
export function useSceneTone() {
  const quality = useSettingsStore((s) => s.quality)
  useEffect(() => {
    document.documentElement.dataset.quality = quality
  }, [quality])
  useEffect(() => {
    const root = document.documentElement
    // a world change remounts the HUD: carry on from the tone already showing rather than flash day
    let night = root.dataset.scene === 'night'
    let raf = 0
    let last = -Infinity
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick)
      if (t - last < 250) return
      last = t
      if (!night && timeState.lamp > TO_NIGHT) night = true
      else if (night && timeState.lamp < TO_DAY) night = false
      const v = night ? 'night' : 'day'
      if (root.dataset.scene !== v) root.dataset.scene = v
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
}
