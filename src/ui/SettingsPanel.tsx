import { useEffect, useRef, type CSSProperties } from 'react'
import { useSettingsStore, baseStepFor, type Quality } from '@/store/stores'
import { SCALE_STEPS } from '@/render/AdaptiveQuality'
import { ambience } from '@/audio/mixer'
import { Icon, IconButton, SegmentedControl, type SegmentOption } from '@/ui/kit'

/**
 * One line per tier, saying what the tier actually changes (Lights, Effects, Vegetation, Grass,
 * WeatherFx read the tier through byQuality / atLeast), so the choice is not a guess.
 */
const QUALITY: SegmentOption<Quality>[] = [
  { value: 'low', label: 'Low', title: 'Fastest: no shadows or glow, sparse grass and woods. For phones and older laptops.' },
  { value: 'medium', label: 'Medium', title: 'Sun shadows and a soft glow, lighter grass and woods.' },
  { value: 'high', label: 'High', title: 'Full grass and woods, trees cast shadows, and the miniature tilt-shift look.' },
  { value: 'ultra', label: 'Ultra', title: 'Ambient occlusion, film-like tone, wider and sharper shadows, no tilt-shift. Needs a strong GPU.' },
]

const KEYS: [string[], string][] = [
  [['W', 'A', 'S', 'D'], 'Walk'],
  [['Shift'], 'Run'],
  [['Q', 'E'], 'Turn'],
  [['M'], 'Map'],
  [['C'], 'Codex'],
  [['Tab'], 'Editor'],
  [['Enter'], 'Go through a door'],
  [['T'], 'Freeze time'],
  [['[', ']'], 'Hour back / on'],
  [['Y'], 'Next weather'],
  [['Esc'], 'Close / free cursor'],
  [['⇧', 'Tab'], 'Reach the buttons'],
]

/**
 * The gear popover: Graphics (a segmented control plus what the tier does, and the render-scale note
 * that used to sit under the hint), Sound (mute, volume, and which bed is playing, since silence is
 * otherwise indistinguishable from a bug), and the controls reference. It replaces the native quality
 * <select>, which kept focus after a pick and swallowed WASD, M and C, and the old Sound panel.
 */
export function SettingsPanel() {
  const quality = useSettingsStore((s) => s.quality)
  const setQuality = useSettingsStore((s) => s.setQuality)
  const scaleStep = useSettingsStore((s) => s.scaleStep)
  const muted = useSettingsStore((s) => s.muted)
  const volume = useSettingsStore((s) => s.volume)
  const setMuted = useSettingsStore((s) => s.setMuted)
  const setVolume = useSettingsStore((s) => s.setVolume)
  const nowPlaying = useRef<HTMLParagraphElement>(null)
  const scaled = scaleStep > baseStepFor(quality)

  useEffect(() => {
    let raf = 0
    let shown = ''
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const next = ambience.playing ? `Playing ${ambience.playing}` : 'No ambience found in public/audio'
      if (nowPlaying.current && next !== shown) {
        shown = next
        nowPlaying.current.textContent = next
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <>
      <section className="sw-section">
        <h3 className="sw-section__title sw-eyebrow">
          <Icon name="quality" />
          Graphics
        </h3>
        <SegmentedControl label="Graphics quality" value={quality} options={QUALITY} onChange={setQuality} />
        <p className="sw-caption" aria-live="polite">
          {QUALITY.find((q) => q.value === quality)?.title}
          {scaled && ` Rendering at ${SCALE_STEPS[scaleStep]}× for now to hold the frame rate.`}
        </p>
      </section>
      <section className="sw-section">
        <h3 className="sw-section__title sw-eyebrow">
          <Icon name={muted ? 'soundOff' : 'soundOn'} />
          Sound
        </h3>
        <div className="sw-row">
          {/* one toggle pattern, as on the toolbar: a fixed name and aria-pressed (a name that also flipped
              read as "Sound on, toggle button, pressed" while muted) */}
          <IconButton icon={muted ? 'soundOff' : 'soundOn'} label="Mute ambience" pressed={muted} size="sm" variant="outline" tip={false} onClick={() => setMuted(!muted)} />
          <input
            className="sw-range"
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={volume}
            disabled={muted}
            aria-label="Ambience volume"
            onPointerDown={(e) => {
              // a range input left focused keeps every key (useInput leaves inputs alone): after a drag with the
              // pointer, give focus back to the page so WASD walks again. The release can land outside it.
              const el = e.currentTarget
              const up = () => {
                el.blur()
                window.removeEventListener('pointerup', up)
                window.removeEventListener('pointercancel', up)
              }
              window.addEventListener('pointerup', up)
              window.addEventListener('pointercancel', up)
            }}
            style={{ '--fill': `${volume * 100}%` } as CSSProperties}
            onChange={(e) => setVolume(+e.target.value)}
          />
          <span className="sw-value">{muted ? 'Off' : `${Math.round(volume * 100)}%`}</span>
        </div>
        <p ref={nowPlaying} className="sw-caption">
          …
        </p>
      </section>
      <section className="sw-section">
        <h3 className="sw-section__title sw-eyebrow">
          <Icon name="help" />
          Controls
        </h3>
        <dl className="sw-keys">
          {KEYS.map(([keys, what]) => (
            <div key={what}>
              <dt>
                {keys.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  )
}
