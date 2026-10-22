import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useWorld } from '@/world/WorldContext'
import { playerState, useUiStore } from '@/store/stores'
import { sharedUniforms } from './shaderExt'
import { MOON_DIR, SUN_DIR, SUN_LOCAL, skyUniforms } from './Sky'
import { FOG_COLOR, fogRange, sampleSky, sunDirection, timeState } from './timeOfDay'
import { advanceWeather, weatherState, type WeatherContext } from './weather'
import { auraFilter, auraMix, collectAuras, updateAura } from './auras'

const base = { sky: new THREE.Color(), horizon: new THREE.Color() }
const tmp = new THREE.Color()
const tint = new THREE.Color()
const WHITE = new THREE.Color(1, 1, 1)

/**
 * Advances both clocks — the hour and the weather — and pushes them into every atmospheric
 * system: sun direction, sky colours, fog, cloud shadows, wind, wet and snowy ground, and the
 * strength of glowing materials. Runs before the controllers so the globe can rotate the day's
 * sun into its local frame in the same frame.
 */
export function DayNight() {
  const { meta, heightfield } = useWorld()
  const { scene } = useThree()
  const isGlobe = meta.kind === 'globe'
  const fog = meta.fog ?? [160, 620]

  useEffect(() => {
    base.sky.set(meta.palette.sky ?? '#9fd0f0')
    base.horizon.set(meta.palette.horizon ?? '#e7f0f6')
    // a new world settles straight into whatever sky belongs there
    weatherState.fresh = true
    weatherState.hold = 1.2
    weatherState.source = ''
  }, [meta])

  // landmarks that ask for weather of their own (the Dead Marshes are always misty)
  const weatherSpots = useMemo(
    () =>
      meta.landmarks
        .filter((l) => l.dressing?.weather)
        .map((l) => ({ x: l.position[0], z: l.position[1], r: (l.dressing?.radius ?? 40) * 1.8, key: l.dressing!.weather! })),
    [meta],
  )
  const auras = useMemo(() => collectAuras(meta), [meta])
  const ctx = useRef<WeatherContext>({ regionId: null, biome: 2, local: null })
  const sampleTimer = useRef(0)

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.25)
    if (!timeState.paused) timeState.hour = (timeState.hour + (dt / (timeState.dayMinutes * 60)) * 24) % 24
    const look = sampleSky(timeState.hour)

    // where the traveller is standing, as far as the weather cares (twice a second is plenty)
    sampleTimer.current -= dt
    if (sampleTimer.current <= 0) {
      sampleTimer.current = 0.5
      const p = playerState.map
      ctx.current.regionId = useUiStore.getState().regionId
      ctx.current.biome = heightfield.biomeAt(p.x, p.z)
      // nearest wins, so standing at Mount Doom is not overruled by a marsh further off
      let local: string | null = null
      let nearest = Infinity
      for (const s of weatherSpots) {
        const d = Math.hypot(s.x - p.x, s.z - p.z)
        if (d < s.r && d < nearest) {
          nearest = d
          local = s.key
        }
      }
      ctx.current.local = local
    }
    const w = advanceWeather(dt, ctx.current)
    // the air of whichever place the traveller is standing in
    updateAura(auras, playerState.map.x, playerState.map.z, dt)
    const aura = auraMix.haze()

    // sun and moon
    sunDirection(timeState.hour, SUN_LOCAL)
    MOON_DIR.copy(SUN_LOCAL).negate()
    const up = THREE.MathUtils.smoothstep(SUN_LOCAL.y, -0.12, 0.06)
    timeState.day = up
    timeState.lamp = look.lamp
    timeState.gloom = w.gloom
    // lamps and windows come on in a storm as well as at night
    timeState.emissive = (1.7 + Math.max(look.lamp, w.gloom * 0.6) * 3.1) * auraMix.glow()
    timeState.lightMul = (0.22 + 0.78 * look.mul) * (0.4 + 0.6 * w.light)
    // below the horizon the directional light becomes moonlight from the opposite side
    if (!isGlobe) SUN_DIR.copy(SUN_LOCAL.y < -0.02 ? MOON_DIR : SUN_LOCAL)

    // sky colours: tint the world's own palette so each world keeps its identity, then drag the
    // result toward the weather's own colour
    tint.copy(w.tint).multiplyScalar(look.mul)
    skyUniforms.uZenith.value.copy(base.sky).multiplyScalar(look.mul).lerp(look.tint, look.tintAmount).lerp(tint, w.gloom)
    skyUniforms.uHorizon.value
      .copy(base.horizon)
      .multiplyScalar(look.mul)
      .lerp(look.tint, look.tintAmount * 0.85)
      .lerp(tint, w.gloom * 0.8)
    // an aura colours the air itself: strongest at the horizon, where you look through most of it
    if (aura > 0.002) {
      const f = auraFilter()
      tint.copy(skyUniforms.uHorizon.value).multiply(f)
      skyUniforms.uHorizon.value.lerp(tint, aura)
      tint.copy(skyUniforms.uZenith.value).multiply(f)
      skyUniforms.uZenith.value.lerp(tint, aura * 0.5)
    }
    if (w.flash > 0) {
      skyUniforms.uZenith.value.lerp(WHITE, w.flash * 0.75)
      skyUniforms.uHorizon.value.lerp(WHITE, w.flash * 0.6)
    }
    skyUniforms.uSunColor.value.copy(look.sun)
    skyUniforms.uGlowColor.value.copy(look.glow)
    // cloud cover swallows the horizon glow, the stars and the sun's disc
    skyUniforms.uGlow.value = look.glowAmount * (1 - w.cover * 0.85)
    skyUniforms.uStars.value = look.stars * (1 - w.cover)
    skyUniforms.uSunUp.value = up * (1 - w.cover * 0.92)
    skyUniforms.uTime.value = sharedUniforms.uTime.value
    // the sky's own sun stays in the real sun's direction even when the light is the moon
    skyUniforms.uSunDir.value.copy(isGlobe ? SUN_DIR : SUN_LOCAL)
    if (isGlobe) MOON_DIR.copy(SUN_DIR).negate()

    // fog and background follow the horizon, lifted slightly so distance still reads at night;
    // weather pulls the far plane in — mist closes the world down to a few dozen metres
    tmp.copy(skyUniforms.uHorizon.value).lerp(skyUniforms.uZenith.value, 0.25)
    FOG_COLOR.copy(tmp)
    fogRange.near = fog[0] * (0.35 + 0.65 * w.fog)
    fogRange.far = fog[1] * w.fog
    if (scene.fog) {
      const f = scene.fog as THREE.Fog
      f.color.copy(tmp)
      f.near = fogRange.near
      f.far = fogRange.far
    }
    if (scene.background instanceof THREE.Color) scene.background.copy(tmp)

    // weather into the shared material uniforms
    sharedUniforms.uWet.value = w.wet
    sharedUniforms.uSnowCover.value = w.snowCover
    sharedUniforms.uAshCover.value = w.ashCover
    sharedUniforms.uGloom.value = w.gloom
    sharedUniforms.uRadialUp.value = isGlobe ? 1 : 0
    sharedUniforms.uGloomColor.value.copy(w.tint)
    sharedUniforms.uWind.value.set(w.windX, w.windZ)
    // clouds only cast distinct shadows while the sun is out and the sky is not already closed
    sharedUniforms.uCloudStrength.value = 0.4 * up * (1 - w.cover * 0.9)
  }, -10)

  return null
}
