import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { PRESETS, formatClock, setHour, timeState } from '@/render/timeOfDay'
import { KINDS, WEATHERS, setWeather, weatherState, type WeatherKind } from '@/render/weather'
import { Icon, Popover, SegmentedControl, Tip, WEATHER_ICON, type IconName } from '@/ui/kit'

const PRESET_ICON: Record<string, IconName> = { Dawn: 'dawn', Noon: 'sun', Dusk: 'dusk', Night: 'moon' }
const DAY_LENGTHS = [4, 12, 30, 90] as const

function phaseName(h: number): string {
  if (h < 5) return 'Night'
  if (h < 7.5) return 'Dawn'
  if (h < 11) return 'Morning'
  if (h < 14) return 'Midday'
  if (h < 18) return 'Afternoon'
  if (h < 20.5) return 'Dusk'
  return 'Night'
}
/** the weather the sky is showing: the one being eased into once it is more than half arrived (as currentWeather) */
const shownWeather = (): WeatherKind => (weatherState.t > 0.5 ? weatherState.next : weatherState.kind)

/**
 * The time-and-weather chip and its popover; it replaces the old Clock. The chip shows the sun or moon,
 * HH:MM, a weather icon only when the weather is not clear (the old label read "☀ 16:00 ☀"), and a
 * pause mark while time is frozen. The popover holds everything the clock panel had: the hour as a
 * slider drawn as the day's sky, the Dawn/Noon/Dusk/Night presets, freeze, the length of a day, and the
 * weather (Auto or one of the kinds).
 * Like the old clock, the live parts tick from rAF and write the DOM directly, so the time can move
 * every frame without re-rendering the HUD.
 */
export function SkyChip({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [, force] = useState(0)
  const [byKey, setByKey] = useState(false)
  const chip = useRef<HTMLButtonElement>(null)
  const time = useRef<HTMLSpanElement>(null)
  const bigTime = useRef<HTMLDivElement>(null)
  const phase = useRef<HTMLDivElement>(null)
  const slider = useRef<HTMLInputElement>(null)
  const tiles = useRef<(HTMLButtonElement | null)[]>([])
  const dragging = useRef(false)
  const rendered = useRef('')

  useEffect(() => {
    let raf = 0
    let shown = ''
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = chip.current
      if (el) {
        const p = timeState.lamp > 0.5 ? 'night' : 'day'
        if (el.dataset.phase !== p) el.dataset.phase = p
        const w = shownWeather()
        if (el.dataset.weather !== w) el.dataset.weather = w
        const paused = String(timeState.paused)
        if (el.dataset.paused !== paused) el.dataset.paused = paused
      }
      // the caption carries the day length too, so a change from the segmented control shows at once
      const label = `${formatClock(timeState.hour)}|${timeState.dayMinutes}`
      if (label !== shown) {
        shown = label
        const clock = formatClock(timeState.hour)
        if (time.current) time.current.textContent = clock
        if (bigTime.current) bigTime.current.textContent = clock
        if (phase.current) phase.current.textContent = `${phaseName(timeState.hour)} · a day lasts ${timeState.dayMinutes} min`
      }
      if (slider.current && !dragging.current) slider.current.value = String(timeState.hour)
      // T and Y change these from the keyboard while the panel is open: re-render so its toggles follow
      if (open) {
        const state = `${timeState.paused}|${weatherState.locked}`
        if (state !== rendered.current) {
          rendered.current = state
          force((x) => x + 1)
        }
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // re-run on open: the popover's refs only exist while it is open, and `shown` must reset to fill them
  }, [open])

  const locked = weatherState.locked
  const choices: (WeatherKind | null)[] = [null, ...KINDS]
  const pickWeather = (k: WeatherKind | null) => {
    setWeather(k)
    force((x) => x + 1)
  }
  // a radiogroup: arrow keys move the choice (and are kept from walking the player). Only while a tile has
  // focus, and a mouse pick gives focus back to the page (the tile's onClick), so after clicking a weather
  // the arrow keys walk again rather than cycling the weather.
  const onTilesKey = (e: KeyboardEvent) => {
    const cols = 4
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? cols : e.key === 'ArrowUp' ? -cols : 0
    if (!d) return
    e.preventDefault()
    e.stopPropagation()
    const i = Math.max(0, choices.indexOf(locked))
    const j = (i + d + choices.length) % choices.length
    pickWeather(choices[j])
    tiles.current[j]?.focus()
  }

  return (
    <div className="sw-popover-anchor">
      <button
        ref={chip}
        type="button"
        className="sw-chip sw-glass"
        data-phase="day"
        data-weather="clear"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={(e) => {
          setByKey(e.detail === 0)
          onOpenChange(!open)
          if (e.detail > 0) e.currentTarget.blur()
        }}
      >
        <span className="sw-chip__phase">
          <Icon name="sun" data-k="day" />
          <Icon name="moon" data-k="night" />
        </span>
        <span className="sw-visually-hidden">Time and weather: </span>
        {/* static children: the rAF above owns this text, React must never re-set it */}
        <span ref={time} className="sw-chip__time">
          --:--
        </span>
        <span className="sw-chip__paused">
          <Icon name="pause" />
        </span>
        <span className="sw-chip__weather">
          {KINDS.filter((k) => k !== 'clear').map((k) => (
            <Icon key={k} name={WEATHER_ICON[k]} data-k={k} />
          ))}
        </span>
        <Tip label="Time and weather" align="start" />
      </button>
      {/* a sibling of the chip, never its child: the chip is glass, and backdrop-filter would trap a nested popover */}
      <Popover open={open} onClose={() => onOpenChange(false)} anchor={chip} label="Time and weather" align="end" focusOnOpen={byKey}>
        <section className="sw-section">
          <div className="sw-sky-head">
            <div>
              <div ref={bigTime} className="sw-sky-time">
                --:--
              </div>
              <div ref={phase} className="sw-caption" />
            </div>
            <button
              type="button"
              className="sw-btn sw-btn--sm sw-btn--icon sw-btn--outline"
              aria-label="Freeze time"
              aria-pressed={timeState.paused}
              aria-keyshortcuts="T"
              onClick={() => {
                timeState.paused = !timeState.paused
                force((x) => x + 1)
              }}
            >
              <Icon name={timeState.paused ? 'play' : 'pause'} />
              <Tip label={timeState.paused ? 'Let time run' : 'Freeze time'} shortcut="T" align="end" />
            </button>
          </div>
          <input
            ref={slider}
            className="sw-range sw-range--sky"
            type="range"
            min={0}
            max={24}
            step={0.05}
            defaultValue={timeState.hour}
            aria-label="Hour of the day"
            onPointerDown={() => {
              // the release can land outside the slider, so listen for it on the window
              dragging.current = true
              const up = () => {
                dragging.current = false
                // a focused range input keeps every key (useInput leaves inputs alone), so after a drag give
                // focus back to the page and WASD walks again; keyboard users never come through here
                slider.current?.blur()
                window.removeEventListener('pointerup', up)
                window.removeEventListener('pointercancel', up)
              }
              window.addEventListener('pointerup', up)
              window.addEventListener('pointercancel', up)
            }}
            onChange={(e) => setHour(+e.target.value)}
          />
          <div className="sw-btn-group" style={{ '--n': PRESETS.length } as CSSProperties}>
            {PRESETS.map(([name, h]) => (
              <button key={name} type="button" className="sw-btn sw-btn--sm sw-btn--outline" onClick={() => setHour(h)}>
                <Icon name={PRESET_ICON[name] ?? 'clock'} />
                {name}
              </button>
            ))}
          </div>
          <div className="sw-section__title sw-eyebrow">Length of a day</div>
          <SegmentedControl
            label="Length of a day"
            value={timeState.dayMinutes}
            options={DAY_LENGTHS.map((m) => ({ value: m, label: `${m} min` }))}
            onChange={(m) => {
              timeState.dayMinutes = m
              force((x) => x + 1)
            }}
          />
        </section>
        <section className="sw-section">
          <h3 className="sw-section__title sw-eyebrow">
            <Icon name="cloudy" />
            Weather
          </h3>
          <div className="sw-tiles" role="radiogroup" aria-label="Weather" onKeyDown={onTilesKey}>
            {choices.map((k, j) => (
              <button
                key={k ?? 'auto'}
                ref={(el) => {
                  tiles.current[j] = el
                }}
                type="button"
                role="radio"
                className="sw-tile"
                aria-checked={locked === k}
                tabIndex={locked === k ? 0 : -1}
                title={k ? undefined : 'Let the land choose its own weather'}
                onClick={(e) => {
                  pickWeather(k)
                  if (e.detail > 0) e.currentTarget.blur()
                }}
              >
                <Icon name={k ? WEATHER_ICON[k] : 'auto'} />
                {k ? WEATHERS[k].label : 'Auto'}
              </button>
            ))}
          </div>
          <p className="sw-caption">
            <kbd>T</kbd> freeze · <kbd>[</kbd> <kbd>]</kbd> hour · <kbd>Y</kbd> weather
          </p>
        </section>
      </Popover>
    </div>
  )
}
