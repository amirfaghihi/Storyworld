import { useMemo } from 'react'
import { IconButton } from '@/ui/kit'
import { ICON_NAMES, type MarkerIcon, type MarkerModel } from './markers'
import { Pictogram } from './MarkerLayer'

/** The symbols of a place's town plan (drawMap placeBounds / placeStructures), legend order. */
export type PlanItem = 'building' | 'smial' | 'hedge' | 'fence' | 'wall' | 'earthwork' | 'gate' | 'bridge'
const PLAN_NAMES: Record<PlanItem, string> = {
  building: 'Building',
  smial: 'Hobbit-hole door',
  hedge: 'Hedge',
  fence: 'Fence',
  wall: 'Wall',
  earthwork: 'Dike',
  gate: 'Gate',
  bridge: 'Bridge',
}

/**
 * What the symbols mean, for the kinds of place this world actually has, plus the marker states
 * and the "you" marker. Collapsible, bottom left; closed by default so it never hides the map.
 */
export function MapLegend({
  models,
  plan = [],
  open,
  onToggle,
  attribution,
}: {
  models: MarkerModel[]
  /** the town-plan symbols this place's map shows (none on other worlds) */
  plan?: readonly PlanItem[]
  open: boolean
  onToggle: () => void
  attribution?: string
}) {
  const icons = useMemo(() => {
    const seen = new Set<MarkerIcon>()
    for (const m of models) seen.add(m.icon)
    return [...seen].sort((a, b) => ICON_NAMES[a].localeCompare(ICON_NAMES[b]))
  }, [models])
  const enterable = models.some((m) => m.enterable && m.kind === 'landmark')
  return (
    <div className="map-legend" data-map-chrome data-open={open || undefined}>
      {open && (
        <div className="map-legend__body" id="map-legend-body" role="region" aria-label="Legend">
          <ul className="map-legend__list">
            {icons.map((i) => (
              <li key={i}>
                <span className="map-legend__badge">
                  <Pictogram icon={i} size={11} />
                </span>
                {ICON_NAMES[i]}
              </li>
            ))}
          </ul>
          {plan.length > 0 && (
            <ul className="map-legend__list map-legend__plan-list">
              {plan.map((k) => (
                <li key={k}>
                  <span className="map-legend__plan" data-item={k} aria-hidden="true" />
                  {PLAN_NAMES[k]}
                </li>
              ))}
            </ul>
          )}
          <ul className="map-legend__list map-legend__states">
            <li>
              <span className="map-legend__badge" />
              Visited
            </li>
            <li>
              <span className="map-legend__badge" data-undiscovered />
              Not yet visited
            </li>
            {enterable && (
              <li>
                <span className="map-legend__badge" data-enterable />
                Can be entered
              </li>
            )}
            <li>
              <span className="map-legend__badge map-legend__badge--count">+2</span>
              Places close together
            </li>
            <li>
              <span className="map-legend__you" />
              You, and the way you face
            </li>
          </ul>
          {attribution && <p className="map-legend__credit">{attribution}</p>}
        </div>
      )}
      <IconButton icon="layers" label="Legend" showLabel variant="solid" size="sm" tip={false} aria-expanded={open} aria-controls={open ? 'map-legend-body' : undefined} onClick={onToggle} />
    </div>
  )
}
