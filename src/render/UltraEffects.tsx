import { useEffect, useLayoutEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, Bloom, Vignette, ToneMapping, groupPasses } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
// imported directly, not through @react-three/postprocessing's <N8AO>: that wrapper lives in the
// library's shared index, which would drag n8ao into the main bundle for every tier (see vite.config)
import { N8AOPostPass } from 'n8ao'
import { timeState } from './timeOfDay'

/**
 * The `ultra` post chain. Loaded on demand (see Effects.tsx) so that n8ao, which nobody on a lower
 * tier ever runs, stays out of the bundle everyone downloads.
 *
 * What it changes against `high`, and why each one reads as "less toy":
 *  - ambient occlusion: contact darkening where things meet the ground and each other. Nothing in
 *    the scene has had any until now, which is why props looked set *on* the world rather than in it.
 *  - no tilt-shift: the blur band is the single strongest "miniature model" cue.
 *  - a lighter vignette, and multisampling instead of hard aliased edges.
 *  - a filmic tone map at the end, so highlights roll off instead of clipping flat.
 */

/**
 * Khronos PBR Neutral. ACES and AgX both desaturate the top of the range, and this world's
 * signature colours (the pale sky, the Shire's greens, the corpse-light of Minas Morgul) live
 * there: ACES strips 50–69% of their saturation. Neutral leaves hue and chroma alone below its
 * shoulder.
 */
const DEFAULT_TONE = ToneMappingMode.NEUTRAL

/**
 * Neutral lowers the midtones slightly (0.18 linear lands at 105/255 instead of 118). Without
 * this, ultra reads as a dimmer `high` rather than an upgrade; 1.15 brings every daylight
 * keyframe back to within ~3 steps of the untonemapped look.
 */
const EXPOSURE = 1.15

/**
 * How far the exposure opens at full night. Neutral's toe pulls the darkest values down hard
 * (0.02 linear lands at 11/255 instead of 39), so night under ultra came out a deeper, more
 * saturated blue in which the traveller was hard to find. An eye adjusting to the dark is the
 * filmic answer: open up as the sun goes, never so far that night stops looking like night.
 */
const NIGHT_LIFT = 0.45

/**
 * Occlusion reach (metres), how fast it fades with that reach, and how dark it gets. Intensity is an
 * exponent on the occlusion term, so it bites hardest where occlusion is already deep: a grass
 * tuft's core at 0.5 goes to 0.03 at intensity 5 (black spikes across every meadow) while a wall
 * base at 0.8 only reaches 0.33. Swept on open Eriador and the Road under the Hill in Bree:
 *   2.5 m / 2.4  buffer nearly white, walls still float
 *   5 m / 5      walls grounded, meadows full of black spikes
 *   6 m / 3      walls, trunks and fence feet grounded; tufts a dark olive      <- chosen
 *   8 m / 2.5    broad halos round trees that read as dirt
 */
const AO_RADIUS = 6
const AO_FALLOFF = 1
const AO_INTENSITY = 3

/**
 * Measured on this machine's GPU (headless Chrome, ANGLE/Metal), Bree at dusk, frame rate locked at
 * the 1.5× render scale ultra allows:
 *
 *   render pixels               high   ultra, full-res AO   ultra, half-res AO
 *   2160×1350 (retina laptop)    60    42 (p95 50 ms)       60
 *   2560×1440                    60    –                    50
 *   3840×2160 (4K)               60    15                   15
 *
 * Full-resolution occlusion is what tips a laptop over; computed at half resolution and upsampled
 * along depth edges it is indistinguishable at these radii. On a 4K screen AdaptiveQuality steps
 * the render scale down until it holds.
 */
/**
 * 2× rather than 4×. Re-measured after the grounding and hero work (2026-10-21, same views,
 * retina-laptop render size): 4× sat right at the frame budget — Bree 56.6 fps and the overworld
 * 55.6, one frame in twelve missing vsync — while 2× holds a locked 60 on both. At the 1.5× render
 * scale ultra runs at, 2× already gives clean edges; the occlusion is what the tier is for.
 */
const MSAA = 2
const AO_HALF = true

const TONE_MODES: Record<string, ToneMappingMode | null> = {
  none: null,
  neutral: ToneMappingMode.NEUTRAL,
  agx: ToneMappingMode.AGX,
  aces: ToneMappingMode.ACES_FILMIC,
}

/** dev-only: #/world?tone=none|neutral|agx|aces, for comparing operators side by side. */
function toneMode(): ToneMappingMode | null {
  if (!import.meta.env.DEV) return DEFAULT_TONE
  const name = /[?&]tone=(\w+)/.exec(location.hash)?.[1]
  return name && name in TONE_MODES ? TONE_MODES[name] : DEFAULT_TONE
}

/** dev-only: #/world?ao=0 turns the occlusion off; ?ao=view shows the occlusion buffer alone. */
function aoMode(): 'on' | 'off' | 'view' {
  if (!import.meta.env.DEV) return 'on'
  const m = /[?&]ao=(\w+)/.exec(location.hash)?.[1]
  return m === '0' ? 'off' : m === 'view' ? 'view' : 'on'
}

/** dev-only: #/world?aor=3&aoi=4&aof=1 overrides radius / intensity / falloff, for tuning by eye. */
function devNum(key: string, fallback: number): number {
  if (!import.meta.env.DEV) return fallback
  const v = Number(new RegExp(`[?&]${key}=([\\d.]+)`).exec(location.hash)?.[1])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

/** dev-only integer override, 0 allowed (e.g. ?msaa=0). */
function devInt(key: string, fallback: number): number {
  if (!import.meta.env.DEV) return fallback
  const v = Number(new RegExp(`[?&]${key}=(\\d+)`).exec(location.hash)?.[1])
  return Number.isInteger(v) && v >= 0 ? v : fallback
}

interface OcclusionProps {
  radius: number
  falloff: number
  intensity: number
  halfRes: boolean
  /** show the occlusion buffer instead of the shaded scene */
  view: boolean
}

/**
 * Ground-truth ambient occlusion from the composer's depth buffer. Depth is written by the real
 * scene pass with the real materials, so wind-swayed grass and canopies are occluded where they
 * actually are this frame — SSAO's normal pass re-renders everything with a plain material that
 * skips the wind shader, and would misalign on every moving blade.
 */
function Occlusion({ radius, falloff, intensity, halfRes, view }: OcclusionProps) {
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const pass = useMemo(() => {
    const p = new N8AOPostPass(scene, camera)
    // n8ao re-walks the scene every frame and, the first time it meets a transparent material
    // (water, mist, particles, rain — this world always has some), latches a mode that renders
    // the whole scene twice more per frame. Here that buys nothing worth two extra scene renders.
    p.autoDetectTransparency = false
    p.configuration.transparencyAware = false
    // n8ao applies gamma only when it is the last pass, and it never is here; pinning it off means
    // reordering the chain can never quietly sRGB-encode in the middle of a linear pipeline
    p.configuration.gammaCorrection = false
    // the composer appends a closing copy for passes registered here, as it does for its own <N8AO>
    groupPasses.add(p)
    return p
  }, [scene, camera])
  useEffect(() => () => pass.dispose(), [pass])
  useLayoutEffect(() => {
    // `configuration` is a Proxy: each assignment reconfigures only what changed
    Object.assign(pass.configuration, {
      aoRadius: radius,
      distanceFalloff: falloff,
      intensity,
      aoSamples: 16,
      denoiseSamples: 8,
      denoiseRadius: 12,
      halfRes,
      depthAwareUpsampling: true,
      renderMode: view ? 1 : 0,
    })
  }, [pass, radius, falloff, intensity, halfRes, view])
  return <primitive object={pass} />
}

export default function UltraEffects() {
  const gl = useThree((s) => s.gl)
  const tone = toneMode()
  const ao = aoMode()

  // the tone-map pass reads three's own exposure uniform (uploaded every frame, since the composer
  // switches programs between passes); restore it when leaving the tier
  useLayoutEffect(() => {
    const prev = gl.toneMappingExposure
    gl.toneMappingExposure = EXPOSURE
    return () => {
      gl.toneMappingExposure = prev
    }
  }, [gl])
  useFrame(() => {
    gl.toneMappingExposure = EXPOSURE * (1 + NIGHT_LIFT * (1 - timeState.day))
  })

  return (
    // keyed: the chain's length changes with the dev toggles, and the composer matches children
    // by position, so a changed chain is rebuilt rather than half-swapped
    <EffectComposer key={`${tone ?? 'none'}:${ao}`} multisampling={devInt('msaa', MSAA)} enableNormalPass={false}>
      {ao !== 'off' ? (
        <Occlusion
          radius={devNum('aor', AO_RADIUS)}
          falloff={devNum('aof', AO_FALLOFF)}
          intensity={devNum('aoi', AO_INTENSITY)}
          halfRes={devInt('aohalf', AO_HALF ? 1 : 0) === 1}
          view={ao === 'view'}
        />
      ) : (
        <></>
      )}
      <Bloom luminanceThreshold={1.0} luminanceSmoothing={0.25} intensity={0.85} mipmapBlur radius={0.7} resolutionScale={0.5} />
      <Vignette eskil={false} offset={0.3} darkness={0.28} />
      {/* last: bloom must see the scene while it is still HDR */}
      {tone !== null ? <ToneMapping mode={tone} /> : <></>}
    </EffectComposer>
  )
}
