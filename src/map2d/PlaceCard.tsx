import type { Ref } from 'react'
import { WALK_SPEED } from '@/player/KinematicController'
import { LoreBody } from '@/lore/LoreCard'
import { IconButton } from '@/ui/kit'
import { TYPE_NAMES, distanceTo, type MarkerModel } from './markers'
import { Pictogram } from './MarkerLayer'

export type CardSubject = { kind: 'landmark' | 'exit'; model: MarkerModel } | { kind: 'region'; id: string; name: string; summary?: string }

interface Props {
  subject: CardSubject
  /** eyebrow region name for a landmark */
  region?: string
  from: { x: number; z: number }
  globe: boolean
  speedScale?: number
  placeName: string
  /** the place a landmark leads into, when it can be entered from here */
  canEnter: boolean
  /** you are inside a place (a town plan), so every card offers the way back out */
  inPlace: boolean
  headingRef?: Ref<HTMLHeadingElement>
  onClose: () => void
  onBack?: () => void
  onTravel: () => void
  onEnter: () => void
  onLeave: () => void
}

/**
 * The selected place: what it is and where, its lore, and what you can do (travel there, step
 * inside, leave). Travel only ever happens from here, never from a single click on the map.
 * Styled after the HUD's lore card, so a place reads the same on the map and in the world.
 */
export function PlaceCard({ subject, region, from, globe, speedScale, placeName, canEnter, inPlace, headingRef, onClose, onBack, onTravel, onEnter, onLeave }: Props) {
  const m = subject.kind === 'region' ? null : subject.model
  const eyebrow = subject.kind === 'region' ? 'Region' : subject.kind === 'exit' ? `Way out · ${placeName}` : `${TYPE_NAMES[subject.model.type]}${region ? ` · ${region}` : ''}`
  const title = subject.kind === 'region' ? subject.name : subject.model.name
  const dist = m ? distanceTo(from, m, globe, WALK_SPEED * (speedScale ?? 1)) : null
  return (
    <article className="map-card" aria-labelledby="map-card-title">
      <header className="map-card__head">
        {onBack && <IconButton icon="chevronLeft" label="Back to the list" size="sm" tipAlign="start" onClick={onBack} />}
        <div className="map-card__heading">
          <span className="sw-eyebrow">{eyebrow}</span>
          {/* focused when the card opens; data-focus-ring (set by the dialog) marks a keyboard opening */}
          <h2 id="map-card-title" ref={headingRef} tabIndex={-1} onBlur={(e) => e.currentTarget.removeAttribute('data-focus-ring')}>
            {m && (
              <span className="map-card__badge" data-discovered={m.discovered || m.kind === 'exit'}>
                <Pictogram icon={m.icon} size={14} />
              </span>
            )}
            {title}
          </h2>
        </div>
        <IconButton icon="close" label="Close" shortcut="Escape" size="sm" tipAlign="end" onClick={onClose} />
      </header>
      <div className="map-card__body">
        {m && (
          <p className="map-card__meta">
            {dist && <span className="map-card__chip">{dist.long}</span>}
            {m.kind === 'landmark' && <span className="map-card__state" data-discovered={m.discovered}>{m.discovered ? 'Visited' : 'Not yet visited'}</span>}
          </p>
        )}
        <div className="map-card__lore">
          {subject.kind === 'landmark' && <LoreBody landmarkId={subject.model.id} compact />}
          {subject.kind === 'exit' && <p>The way back out of {placeName}, to the wider world.</p>}
          {subject.kind === 'region' && <p>{subject.summary ?? 'No notes written for this region yet.'}</p>}
        </div>
      </div>
      {(m || inPlace) && (
        <footer className="map-card__foot">
          {subject.kind === 'exit' ? (
            <>
              <IconButton icon="leave" label={`Leave ${placeName}`} showLabel variant="primary" size="lg" tip={false} onClick={onLeave} />
              <IconButton icon="arrowRight" label="Go to the way out" showLabel variant="outline" tip={false} onClick={onTravel} />
            </>
          ) : (
            <>
              {m && <IconButton icon="arrowRight" label="Travel here" showLabel variant="primary" size="lg" tip={false} onClick={onTravel} />}
              {m && canEnter && <IconButton icon="door" label={`Enter ${m.name}`} showLabel variant="outline" tip={false} onClick={onEnter} />}
              {inPlace && <IconButton icon="leave" label={`Leave ${placeName}`} showLabel variant={m ? 'outline' : 'primary'} size={m ? undefined : 'lg'} tip={false} onClick={onLeave} />}
            </>
          )}
        </footer>
      )}
    </article>
  )
}
