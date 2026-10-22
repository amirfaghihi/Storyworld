import { useRef, type CSSProperties } from 'react'
import { useWorld } from '@/world/WorldContext'
import { usePlayerStore, useUiStore } from '@/store/stores'
import { travelToLandmark } from '@/player/teleport'
import { Icon, IconButton } from '@/ui/kit'
import { useDialogFocus } from '@/ui/useDialogFocus'

/** Journal of discovered places. Click to read, see it on the map, or travel there. */
export function Codex() {
  const world = useWorld()
  const open = useUiStore((s) => s.codexOpen)
  const setOpen = useUiStore((s) => s.setCodexOpen)
  const setSelected = useUiStore((s) => s.setSelectedLandmark)
  const discovered = usePlayerStore((s) => s.discovered)
  const panel = useRef<HTMLDivElement>(null)
  useDialogFocus(open, panel)
  if (!open) return null
  const visible = world.meta.landmarks.filter((l) => !l.hidden)
  const found = visible.filter((l) => discovered.includes(l.id))
  const total = visible.length
  return (
    <div className="overlay codex" onClick={() => setOpen(false)}>
      <div ref={panel} className="panel" role="dialog" aria-modal="true" aria-labelledby="codex-title" onClick={(e) => e.stopPropagation()}>
        <header>
          <span className="sw-medallion" aria-hidden="true">
            <Icon name="codex" />
          </span>
          <div>
            <h2 id="codex-title">Traveller's Codex</h2>
            <p className="sw-caption">
              {found.length} of {total} places discovered
            </p>
          </div>
          <IconButton icon="close" label="Close" shortcut="C" tipAlign="end" onClick={() => setOpen(false)} />
        </header>
        <div className="sw-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={found.length} aria-label="Places discovered">
          <div style={{ '--p': `${total ? (found.length / total) * 100 : 0}%` } as CSSProperties} />
        </div>
        {found.length === 0 ? (
          <p className="sw-caption codex-empty">Walk up to a waymarker to record a place here.</p>
        ) : (
          <ul className="codex-list">
            {found.map((lm) => (
              <li key={lm.id}>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setSelected(lm.id)
                    setOpen(false)
                  }}
                >
                  <b>{lm.displayName}</b>
                  <span className="sw-eyebrow">{lm.type}</span>
                </button>
                <IconButton
                  icon="map"
                  label="Show on map"
                  size="sm"
                  tipSide="top"
                  tipAlign="end"
                  aria-label={`Show ${lm.displayName} on the map`}
                  onClick={() => {
                    setOpen(false)
                    useUiStore.getState().openMap({ id: lm.id })
                  }}
                />
                <IconButton
                  icon="arrowRight"
                  label="Travel"
                  showLabel
                  size="sm"
                  variant="soft"
                  tip={false}
                  aria-label={`Travel to ${lm.displayName}`}
                  onClick={() => {
                    travelToLandmark(lm, world.heightfield, world.meta.seaLevel, world.globe)
                    setOpen(false)
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        {world.meta.attribution && <footer>{world.meta.attribution}</footer>}
      </div>
    </div>
  )
}
