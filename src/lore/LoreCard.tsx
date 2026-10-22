import { useEffect, useState } from 'react'
import { useWorld } from '@/world/WorldContext'
import { useUiStore } from '@/store/stores'
import { Icon, IconButton } from '@/ui/kit'

const SOURCE_NAMES: Record<string, string> = { 'tolkiengateway.net': 'Tolkien Gateway', 'en.wikipedia.org': 'Wikipedia', 'www.gutenberg.org': 'Project Gutenberg' }
function sourceName(url: string): string {
  try {
    const host = new URL(url).hostname
    return SOURCE_NAMES[host] ?? host.replace(/^www\./, '')
  } catch {
    return 'the source'
  }
}

/**
 * Story information for the landmark the player is near, or one picked on the map / codex. The card
 * starts under the top bar (hud.css), and on phones it starts as a one-line bar at the bottom.
 */
export function LoreCard() {
  const world = useWorld()
  const near = useUiStore((s) => s.nearLandmark)
  const selected = useUiStore((s) => s.selectedLandmark)
  const setSelected = useUiStore((s) => s.setSelectedLandmark)
  const id = selected ?? near
  // phones: start as a one-line bar so the card does not cover the touch controls
  const small = typeof window !== 'undefined' && window.innerWidth < 760
  const [expanded, setExpanded] = useState(!small)
  useEffect(() => {
    if (small) setExpanded(!!selected)
  }, [id, selected, small])
  if (!id) return null
  const lm = world.meta.landmarks.find((l) => l.id === id)
  if (!lm) return null
  const lore = world.lore.landmarks[id]
  const region = lore?.region ? world.meta.regions.find((r) => r.id === lore.region) : null
  const toggle = () => small && setExpanded((e) => !e)

  return (
    <aside className={`lore-card ${expanded ? '' : 'collapsed'}`} aria-labelledby="lore-title">
      {/* on phones the whole header toggles the card (a big target); the chevron is its keyboard path */}
      <header onClick={toggle}>
        <div className="lore-card__heading">
          <div className="eyebrow">
            {lm.type}
            {region ? ` · ${region.displayName}` : ''}
          </div>
          <h2 id="lore-title">{lm.displayName}</h2>
        </div>
        {/* the actions must not also toggle the card */}
        <div className="lore-card__actions" onClick={(e) => e.stopPropagation()}>
          <IconButton icon="map" label="Show on map" size="sm" tipAlign="end" onClick={() => useUiStore.getState().openMap({ id })} />
          {selected ? (
            <IconButton icon="close" label="Close" size="sm" shortcut="Esc" tipAlign="end" onClick={() => setSelected(null)} />
          ) : (
            small && (
              <button type="button" className="lore-toggle sw-btn sw-btn--sm sw-btn--icon" aria-expanded={expanded} aria-label={expanded ? 'Fold the story notes' : 'Unfold the story notes'} onClick={toggle}>
                <Icon name="chevronDown" />
              </button>
            )
          )}
        </div>
      </header>
      <LoreBody landmarkId={id} />
    </aside>
  )
}

/**
 * The story notes for one landmark — the land, the summary, what happened there, who was there,
 * and where to read more — without the card's header or close button, so the map's place card
 * and the lore card show the same words. `compact` keeps only the first story event.
 */
export function LoreBody({ landmarkId, compact = false }: { landmarkId: string; compact?: boolean }) {
  const world = useWorld()
  const lm = world.meta.landmarks.find((l) => l.id === landmarkId)
  if (!lm) return null
  const lore = world.lore.landmarks[landmarkId]
  const events = lore ? (compact ? lore.storyEvents.slice(0, 1) : lore.storyEvents) : []
  return (
    <>
      {lm.dressing?.setting && (
        <p className="setting">
          <span className="eyebrow">The land</span>
          {lm.dressing.setting}
        </p>
      )}
      {lore ? (
        <>
          <p>{lore.summary}</p>
          {events.length > 0 && (
            <div className="events">
              <h3>In the story</h3>
              <ul>
                {events.map((e, i) => (
                  <li key={i}>
                    <span className="ref">
                      {e.book}
                      {e.chapter ? `, ${e.chapter}` : ''}
                    </span>
                    {e.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {lore.characters.length > 0 && <div className="chars">{lore.characters.join(' · ')}</div>}
          {lore.sourceUrl && (
            <a className="sw-link" href={lore.sourceUrl} target="_blank" rel="noreferrer">
              Read more on {sourceName(lore.sourceUrl)}
              <Icon name="external" />
            </a>
          )}
        </>
      ) : (
        <p className="muted sw-caption">No notes written for this place yet.</p>
      )}
    </>
  )
}
