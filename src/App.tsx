import { Suspense, lazy, use, useEffect } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { Perf } from 'r3f-perf'
import { loadRoute } from '@/world/loadWorld'
import { WorldContext } from '@/world/WorldContext'
import { useRoute, type Route } from '@/router'
import { useInputListeners } from '@/player/useInput'
import { TerrainChunks } from '@/terrain/TerrainChunks'
import { Water } from '@/terrain/Water'
import { Vegetation } from '@/vegetation/Vegetation'
import { Sky } from '@/render/Sky'
import { Lights } from '@/render/Lights'
import { KinematicController } from '@/player/KinematicController'
import { FollowCamera } from '@/player/FollowCamera'
import { Avatar } from '@/player/Avatar'
import { Landmarks } from '@/overworld/Landmarks'
import { Portals } from '@/overworld/Portals'
import { LandmarkProps } from '@/dressing/LandmarkProps'
import { Clouds } from '@/render/Clouds'
import { Grass } from '@/vegetation/Grass'
import { Particles } from '@/render/Particles'
import { Effects } from '@/render/Effects'
import { AdaptiveQuality, SCALE_STEPS } from '@/render/AdaptiveQuality'
import { DayNight } from '@/render/DayNight'
import { WeatherFx } from '@/render/WeatherFx'
import { LightShafts } from '@/render/LightShafts'
import { useSettingsStore, useUiStore, playerState } from '@/store/stores'
import { sharedUniforms } from '@/render/shaderExt'
import { useFrame } from '@react-three/fiber'
import { Hud, RegionWatcher } from '@/ui/Hud'
import { LoadingScreen } from '@/ui/LoadingScreen'
import { LoreCard } from '@/lore/LoreCard'
import { Codex } from '@/lore/Codex'
import { EditorTools } from '@/editor/EditorTools'
import { EditorPanel } from '@/editor/EditorPanel'
import { WorldPicker } from '@/ui/WorldPicker'
import { Ambience } from '@/audio/Ambience'
import { GlobeTerrain } from '@/globe/GlobeTerrain'
import { GlobeWater } from '@/globe/GlobeWater'
import { GlobeController } from '@/globe/GlobeController'
import { GlobeCamera } from '@/globe/GlobeCamera'
import { GlobeGrass } from '@/globe/GlobeGrass'
import { GlobeVegetation } from '@/globe/GlobeVegetation'
import { GlobeLandmarks } from '@/globe/GlobeLandmarks'

/**
 * The map dialog (search, labels, place list, cards) is only needed once it is opened, so it
 * loads on demand: it was the largest part of what the map rebuild added to the bundle everyone
 * downloads. The minimap and the renderer it shares with the dialog stay in the main chunk.
 */
const loadOverviewMap = () => import('@/map2d/OverviewMap')
const OverviewMap = lazy(() => loadOverviewMap().then((m) => ({ default: m.OverviewMap })))

function MapDialogGate() {
  const open = useUiStore((s) => s.mapOpen)
  // fetch it while the player is still looking around, so the first M opens at once
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void }
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => void loadOverviewMap())
      return () => w.cancelIdleCallback?.(id)
    }
    const id = window.setTimeout(() => void loadOverviewMap(), 3000)
    return () => window.clearTimeout(id)
  }, [])
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <OverviewMap />
    </Suspense>
  )
}

/** Advances the shared shader clock. */
function Ticker() {
  useFrame((_, dt) => {
    sharedUniforms.uTime.value += Math.min(dt, 0.05)
    sharedUniforms.uPlayer.value.copy(playerState.position)
  })
  return null
}

export default function App() {
  const route = useRoute()
  return (
    <>
      {/* above the world, so walking into a place does not restart the music */}
      <Ambience />
      <Suspense fallback={<LoadingScreen label={route.placeId ? `Walking into ${route.placeId.replace(/-/g, ' ')}…` : 'Drawing the map…'} />}>
        <WorldApp key={route.id} route={route} />
      </Suspense>
    </>
  )
}

function WorldApp({ route }: { route: Route }) {
  const world = use(loadRoute(route))
  useInputListeners()
  if (import.meta.env.DEV) (window as unknown as { __world: unknown }).__world = world
  const horizon = world.meta.palette.horizon ?? '#e7f0f6'
  const [fogNear, fogFar] = world.meta.fog ?? [160, 620]
  const scaleStep = useSettingsStore((s) => s.scaleStep)
  const globe = world.meta.kind === 'globe'
  // r3f re-applies the `shadows` prop whenever the Canvas is reconfigured — which a dpr change
  // does — so the shadow filter has to be owned here. Setting it from a useEffect elsewhere gets
  // silently reverted the next time the render scale moves.
  //
  // Every tier uses PCF. three 0.184 deprecated PCFSoftShadowMap — WebGLShadowMap quietly rewrites
  // it to PCFShadowMap on the first frame (one warning, no error) — which leaves VSM as the only
  // soft filter, and VSM is wrong for this world: it promotes every shadow *receiver* to a caster,
  // so the terrain shadows itself across its whole surface. The ground goes uniformly dark, the
  // discrete shadows that give objects weight disappear into it, and the shadow pass doubles in
  // size. In 0.184 PCF is itself the soft filter, so ultra softens through `shadow.radius` and a
  // larger, texel-snapped map instead (see Lights.tsx).
  const shadowType = THREE.PCFShadowMap
  const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, SCALE_STEPS[scaleStep] ?? 1)
  // dev-only: #/world?no=water,veg,... disables components to isolate rendering problems
  const off = new Set(import.meta.env.DEV ? (/[?&]no=([\w,]+)/.exec(location.hash)?.[1] ?? '').split(',') : [])

  return (
    <WorldContext.Provider value={world}>
      <div className="canvas-wrap">
        <Canvas
          shadows={{ type: shadowType }}
          dpr={dpr}
          camera={{ fov: 50, near: 0.5, far: 1500, position: [world.meta.spawn[0], 40, world.meta.spawn[1] + 30] }}
          gl={{ antialias: false, powerPreference: 'high-performance' }}
          onCreated={(state) => {
            state.gl.toneMapping = THREE.NoToneMapping
            state.gl.outputColorSpace = THREE.SRGBColorSpace
            if (import.meta.env.DEV) (window as unknown as { __sw: unknown }).__sw = state
            state.gl.domElement.addEventListener('webglcontextlost', (e) => console.error('WebGL context lost:', (e as WebGLContextEvent).statusMessage))
          }}
        >
          <color attach="background" args={[horizon]} />
          <fog attach="fog" args={[horizon, fogNear, fogFar]} />
          {!off.has('sky') && <Sky />}
          <DayNight />
          <Lights />
          {globe ? (
            <>
              {!off.has('terrain') && <GlobeTerrain />}
              {!off.has('water') && <GlobeWater />}
              {!off.has('veg') && <GlobeVegetation />}
              {!off.has('grass') && <GlobeGrass />}
              {!off.has('landmarks') && <GlobeLandmarks />}
              <GlobeController />
              <GlobeCamera />
            </>
          ) : (
            <>
              {!off.has('terrain') && <TerrainChunks />}
              {!off.has('water') && <Water />}
              {!off.has('veg') && <Vegetation />}
              {!off.has('landmarks') && <Landmarks />}
              {!off.has('landmarks') && <Portals />}
              {!off.has('props') && <LandmarkProps />}
              {!off.has('clouds') && <Clouds />}
              {!off.has('grass') && <Grass />}
              {!off.has('particles') && <Particles />}
              {!off.has('shafts') && <LightShafts />}
              <EditorTools />
              <KinematicController />
              <FollowCamera />
            </>
          )}
          {!off.has('weather') && <WeatherFx mist={!globe} />}
          {!off.has('fx') && <Effects />}
          <Ticker />
          <AdaptiveQuality />
          {!off.has('avatar') && <Avatar />}
          <RegionWatcher />
          {import.meta.env.DEV && <Perf position="bottom-left" minimal style={{ bottom: 48 }} />}
        </Canvas>
      </div>
      <Hud />
      <LoreCard />
      <MapDialogGate />
      <Codex />
      <WorldPicker />
      {!globe && <EditorPanel />}
    </WorldContext.Provider>
  )
}
