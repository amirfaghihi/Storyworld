import { useEffect } from 'react'
import { useRoute } from '@/router'
import { useUiStore, useSettingsStore } from '@/store/stores'
import { timeState } from '@/render/timeOfDay'
import { weatherState } from '@/render/weather'
import { ambience, candidates, type Scene } from './mixer'

/**
 * Drives the ambient bed from where the traveller is and what the sky is doing.
 *
 * Mounted outside the Canvas and above the world, so that walking into a place or stepping
 * between worlds does not restart the music — only an actual change of bed does. Browsers will
 * not start audio without a gesture, so the context waits for the first click or key.
 */
export function Ambience() {
  const route = useRoute()
  const muted = useSettingsStore((s) => s.muted)
  const volume = useSettingsStore((s) => s.volume)

  // the first gesture of the session unlocks audio; after that these listeners are done
  useEffect(() => {
    const unlock = () => ambience.start()
    const opts = { once: true, passive: true } as const
    window.addEventListener('pointerdown', unlock, opts)
    window.addEventListener('keydown', unlock, opts)
    window.addEventListener('touchstart', unlock, opts)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      window.removeEventListener('touchstart', unlock)
    }
  }, [])

  useEffect(() => ambience.setMuted(muted), [muted])
  useEffect(() => ambience.setVolume(volume), [volume])

  // the situation changes slowly; twice a second is more than enough to follow it
  useEffect(() => {
    let last = ''
    const tick = () => {
      const scene: Scene = {
        worldId: route.worldId,
        placeId: route.placeId,
        regionId: useUiStore.getState().regionId,
        weather: weatherState.t > 0.5 ? weatherState.next : weatherState.kind,
        night: timeState.lamp > 0.5,
      }
      const names = candidates(scene)
      const key = names.join('|')
      if (key === last) return
      last = key
      void ambience.want(names)
    }
    tick()
    const id = window.setInterval(tick, 500)
    return () => window.clearInterval(id)
  }, [route.worldId, route.placeId])

  useEffect(() => () => ambience.stop(), [])
  return null
}
