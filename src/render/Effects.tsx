import { lazy, Suspense } from 'react'
import { EffectComposer, Bloom, Vignette, TiltShift2 } from '@react-three/postprocessing'
import { useSettingsStore, atLeast, type Quality } from '@/store/stores'
import { useWorld } from '@/world/WorldContext'

/** The ultra chain lives in its own chunk: n8ao should cost nothing to anyone not running it. */
const UltraEffects = lazy(() => import('./UltraEffects'))

/**
 * Post-processing. Bloom for HDR glows (lava, lamps, the Eye, sun), a light tilt-shift for the
 * miniature-diorama feel, and a soft vignette. Disabled on the low quality tier. `ultra` swaps in
 * a different chain altogether (UltraEffects.tsx); this one is the cartoon look and stays as it is.
 */
export function Effects() {
  const quality = useSettingsStore((s) => s.quality)
  if (quality === 'low') return null
  if (atLeast(quality, 'ultra')) {
    return (
      // the high chain covers the moment the ultra chunk takes to arrive, rather than no post at all
      <Suspense fallback={<StandardEffects quality="high" />}>
        <UltraEffects />
      </Suspense>
    )
  }
  return <StandardEffects quality={quality} />
}

function StandardEffects({ quality }: { quality: Quality }) {
  const { meta } = useWorld()
  const blur = meta.place ? 0.045 : 0.09
  return (
    <EffectComposer multisampling={quality === 'high' ? 2 : 0} enableNormalPass={false}>
      <Bloom luminanceThreshold={1.0} luminanceSmoothing={0.25} intensity={0.85} mipmapBlur radius={0.7} resolutionScale={0.5} />
      {quality === 'high' ? <TiltShift2 blur={blur} taper={0.55} /> : <></>}
      <Vignette eskil={false} offset={0.22} darkness={0.5} />
    </EffectComposer>
  )
}
