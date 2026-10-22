import { useEffect, useRef, useState, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { useWorld } from '@/world/WorldContext'
import { playerState, useUiStore, useSettingsStore } from '@/store/stores'
import { Minimap } from '@/map2d/Minimap'
import { useEditorStore } from '@/editor/editorStore'
import { TouchControls, isTouchDevice } from './TouchControls'
import { WORLDS } from './WorldPicker'
import { SkyChip } from './SkyPanel'
import { SettingsPanel } from './SettingsPanel'
import { useSceneTone } from './useSceneTone'
import { Icon, IconButton, Popover } from './kit'
import { navigate } from '@/router'
import './hud.css'

function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Lives inside the Canvas: tracks which region the player is in (smallest containing polygon). */
export function RegionWatcher() {
  const { meta } = useWorld()
  const timer = useRef(0)
  const areas = useRef(
    meta.regions.map((r) => {
      let a = 0
      for (let i = 0, j = r.polygon.length - 1; i < r.polygon.length; j = i++) a += r.polygon[j][0] * r.polygon[i][1] - r.polygon[i][0] * r.polygon[j][1]
      return Math.abs(a) / 2
    }),
  )
  useFrame((_, dt) => {
    timer.current += dt
    if (timer.current < 0.5) return
    timer.current = 0
    const p = playerState.map
    let best: string | null = null
    let bestArea = Infinity
    meta.regions.forEach((r, i) => {
      if (areas.current[i] < bestArea && pointInPolygon(p.x, p.z, r.polygon)) {
        best = r.id
        bestArea = areas.current[i]
      }
    })
    const ui = useUiStore.getState()
    if (best !== ui.regionId) {
      ui.setRegion(best)
      const name = meta.regions.find((r) => r.id === best)?.displayName
      if (name) ui.setToast(name)
    }
  })
  return null
}

type Pop = 'sky' | 'settings' | null

/** Writes an element's rendered height to a custom property on <html>, for layouts that sit beside it. */
function useHeightVar(ref: RefObject<HTMLElement | null>, name: string) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const ro = new ResizeObserver(() => root.style.setProperty(name, `${Math.ceil(el.getBoundingClientRect().height)}px`))
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.style.removeProperty(name)
    }
  }, [ref, name])
}

/**
 * DOM overlay outside the Canvas.
 *
 * Top left, the location plate: where you are (breadcrumb, region, its one-line lore) and, in a place,
 * the way back out. Top right, the time-and-weather chip and one toolbar: Map, Codex, Worlds | Edit |
 * Mute, Settings. Only one popover is open at a time, and any dialog opening closes it.
 * The plate, chip and toolbar are glass over the scene, parchment by day and ink by night
 * (useSceneTone), because white text straight on the scene measured 1.2-1.7:1 over a bright sky.
 */
export function Hud() {
  const world = useWorld()
  const regionId = useUiStore((s) => s.regionId)
  const toast = useUiStore((s) => s.toast)
  const pointerLocked = useUiStore((s) => s.pointerLocked)
  const portal = useUiStore((s) => s.portal)
  const mapOpen = useUiStore((s) => s.mapOpen)
  const codexOpen = useUiStore((s) => s.codexOpen)
  const worldsOpen = useUiStore((s) => s.worldsOpen)
  const setToast = useUiStore((s) => s.setToast)
  const muted = useSettingsStore((s) => s.muted)
  const setMuted = useSettingsStore((s) => s.setMuted)
  const editorOn = useEditorStore((s) => s.enabled)
  const setEditor = useEditorStore((s) => s.setEnabled)
  const touchUi = isTouchDevice()
  const [pop, setPop] = useState<Pop>(null)
  const [settingsByKey, setSettingsByKey] = useState(false)
  const [hintHidden, setHintHidden] = useState(false)
  const settingsBtn = useRef<HTMLButtonElement>(null)
  const plate = useRef<HTMLElement>(null)
  const minimap = useRef<HTMLDivElement>(null)
  useSceneTone()
  // the editor sits under the plate, whose height follows the region text
  useHeightVar(plate, '--hud-plate-h')
  // the run button and the lore card keep clear of the minimap, whatever size it draws itself at
  useHeightVar(minimap, '--hud-minimap-h')

  const region = world.meta.regions.find((r) => r.id === regionId)
  const regionLore = regionId ? world.lore.regions[regionId] : undefined
  const place = world.meta.place
  const parentName = place ? (WORLDS.find((w) => w.id === place.parentWorldId)?.name ?? 'the overworld') : null

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(t)
  }, [toast, setToast])

  // the controls hint fades once the player has walked for a while; Settings > Controls keeps the list
  useEffect(() => {
    let walked = 0
    const id = setInterval(() => {
      if (playerState.speed > 0.5) walked += 0.5
      if (walked > 12) {
        setHintHidden(true)
        clearInterval(id)
      }
    }, 500)
    return () => clearInterval(id)
  }, [])

  // the map, codex or worlds opening (from a button or a key) closes any popover
  useEffect(() => {
    if (mapOpen || codexOpen || worldsOpen) setPop(null)
  }, [mapOpen, codexOpen, worldsOpen])

  const ui = useUiStore.getState
  return (
    <>
      <div className="hud-top">
        <section ref={plate} className="hud-location sw-glass" aria-label="Where you are">
          <div className="hud-location__crumbs sw-eyebrow">
            {parentName && (
              <>
                <span>{parentName}</span>
                <Icon name="chevronRight" />
              </>
            )}
            <span>{world.meta.name}</span>
          </div>
          <h1 className="hud-location__title">{region?.displayName ?? 'The Wild'}</h1>
          {regionLore && <p className="hud-location__lore">{regionLore.summary}</p>}
          {place && (
            <div className="hud-location__actions">
              <IconButton
                icon="door"
                label={`Leave ${world.meta.name}`}
                showLabel
                variant="soft"
                size="sm"
                tip={`Back to ${parentName}`}
                tipAlign="start"
                onClick={() => navigate(place.parentWorldId, place.returnTo[0], place.returnTo[1])}
              />
            </div>
          )}
        </section>

        <div className="hud-actions">
          <SkyChip open={pop === 'sky'} onOpenChange={(v) => setPop(v ? 'sky' : null)} />
          <div className="sw-toolbar sw-glass" role="toolbar" aria-label="Explore">
            <IconButton icon="map" label="Map" shortcut="M" showLabel="wide" aria-haspopup="dialog" onClick={() => ui().openMap()} />
            <IconButton icon="codex" label="Codex" shortcut="C" showLabel="wide" aria-haspopup="dialog" onClick={() => ui().setCodexOpen(true)} />
            <IconButton icon="worlds" label="Worlds" showLabel="wide" aria-haspopup="dialog" onClick={() => ui().setWorldsOpen(true)} />
            {!touchUi && world.meta.kind !== 'globe' && (
              <>
                <span className="sw-toolbar__sep" aria-hidden="true" />
                <IconButton icon="edit" label="Terrain editor" shortcut="Tab" pressed={editorOn} onClick={() => setEditor(!editorOn)} />
              </>
            )}
            <span className="sw-toolbar__sep" aria-hidden="true" />
            <IconButton icon={muted ? 'soundOff' : 'soundOn'} label="Mute ambience" tip={muted ? 'Sound is off' : 'Mute ambience'} pressed={muted} onClick={() => setMuted(!muted)} />
            <IconButton
              ref={settingsBtn}
              icon="settings"
              label="Settings"
              tip="Settings: graphics, sound, controls"
              tipAlign="end"
              expanded={pop === 'settings'}
              onClick={(e) => {
                setSettingsByKey(e.detail === 0)
                setPop(pop === 'settings' ? null : 'settings')
              }}
            />
          </div>
          {/* a sibling of the toolbar, not a child: an ancestor with backdrop-filter would become the popover's
              backdrop root (its own blur would see only the toolbar) and the containing block of position: fixed */}
          <Popover open={pop === 'settings'} onClose={() => setPop(null)} anchor={settingsBtn} label="Settings" width={320} focusOnOpen={settingsByKey}>
            <SettingsPanel />
          </Popover>
        </div>
      </div>

      <div className="hud-hint sw-glass" data-hidden={hintHidden || undefined}>
        {touchUi ? (
          <>
            <span>Left thumb to walk</span>
            <span>right thumb to look</span>
            <span>pinch to zoom</span>
          </>
        ) : pointerLocked ? (
          <>
            <span>Move the mouse to look</span>
            <span>
              <kbd>Esc</kbd> free the cursor
            </span>
            <span>
              <kbd>W</kbd>
              <kbd>A</kbd>
              <kbd>S</kbd>
              <kbd>D</kbd> walk
            </span>
            <span>
              <kbd>Shift</kbd> run
            </span>
          </>
        ) : (
          <>
            <span>
              <b>Click the world</b> to look around
            </span>
            <span>
              <kbd>W</kbd>
              <kbd>A</kbd>
              <kbd>S</kbd>
              <kbd>D</kbd> walk
            </span>
            <span>
              <kbd>Shift</kbd> run
            </span>
            <span>
              <kbd>Q</kbd>
              <kbd>E</kbd> turn
            </span>
            <span>wheel to zoom</span>
          </>
        )}
      </div>
      {/* positions the minimap only; its look belongs to Minimap.tsx */}
      <div ref={minimap} className="hud-minimap">
        <Minimap />
      </div>
      {touchUi && <TouchControls />}
      {portal && (
        <button type="button" className="portal-prompt sw-btn sw-btn--primary sw-btn--lg" onClick={() => navigate(portal.targetId, portal.x, portal.z)}>
          <Icon name="door" />
          {portal.label}
          {!touchUi && <kbd>Enter</kbd>}
        </button>
      )}
      {/* The toast remounts per region (key) to replay its animation, so it cannot be the live region: a
          role="status" that mounts already holding its text is missed by screen readers. This one stays
          mounted, empty between toasts, and only its text changes. */}
      <div className="sw-visually-hidden" role="status">
        {toast ? `Entering ${toast}` : ''}
      </div>
      {toast && (
        <div className="toast" key={toast} aria-hidden="true">
          <span>Entering</span>
          <b>{toast}</b>
        </div>
      )}
    </>
  )
}
