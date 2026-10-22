import { useRef } from 'react'
import { useUiStore } from '@/store/stores'
import { navigate } from '@/router'
import { useWorld } from '@/world/WorldContext'
import { Icon, IconButton, type IconName } from './kit'
import { useDialogFocus } from './useDialogFocus'

/** The worlds you can roam. Each is a folder under public/worlds with a world.json. */
export const WORLDS: { id: string; name: string; story: string; blurb: string; icon: IconName }[] = [
  {
    id: 'middle-earth',
    name: 'Middle-earth',
    story: 'The Hobbit · The Lord of the Rings',
    blurb: 'A flat miniature of the Third Age, from the Grey Havens to Mordor, with Hobbiton at walking scale.',
    icon: 'ring',
  },
  {
    id: 'earth',
    name: 'Earth',
    story: 'Around the World in Eighty Days',
    blurb: 'A small planet you can walk right around, following Phileas Fogg from London to London.',
    icon: 'globe',
  },
]

export function WorldPicker() {
  const open = useUiStore((s) => s.worldsOpen)
  const setOpen = useUiStore((s) => s.setWorldsOpen)
  const { meta } = useWorld()
  const panel = useRef<HTMLDivElement>(null)
  useDialogFocus(open, panel)
  if (!open) return null
  // inside a place you are still in its parent world
  const currentId = meta.place ? meta.place.parentWorldId : meta.id
  return (
    <div className="overlay codex" onClick={() => setOpen(false)}>
      <div ref={panel} className="panel worlds" role="dialog" aria-modal="true" aria-labelledby="worlds-title" onClick={(e) => e.stopPropagation()}>
        <header>
          <span className="sw-medallion" aria-hidden="true">
            <Icon name="worlds" />
          </span>
          <div>
            <h2 id="worlds-title">Worlds</h2>
            <p className="sw-caption">Your position and discoveries are kept per world.</p>
          </div>
          <IconButton icon="close" label="Close" shortcut="Esc" tipAlign="end" onClick={() => setOpen(false)} />
        </header>
        <ul className="world-list">
          {WORLDS.map((w) => (
            <li key={w.id} className={w.id === currentId ? 'current' : ''}>
              <button
                type="button"
                aria-current={w.id === currentId || undefined}
                onClick={() => {
                  setOpen(false)
                  if (w.id !== meta.id) navigate(w.id)
                }}
              >
                <span className="sw-medallion" aria-hidden="true">
                  <Icon name={w.icon} />
                </span>
                <span>
                  <b>{w.name}</b>
                  <span className="sw-eyebrow">{w.story}</span>
                  <span className="sw-caption">{w.blurb}</span>
                </span>
                {w.id === currentId ? <span className="sw-badge">You are here</span> : <Icon name="chevronRight" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
