import { useMemo, useState } from 'react'
import { Icon, SegmentedControl } from '@/ui/kit'
import { distanceTo, regionFor, type MarkerModel, type RegionSource } from './markers'
import { Pictogram } from './MarkerLayer'

type Sort = 'near' | 'az'

const COLLAPSED_KEY = 'sw.map.collapsed'
function readCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}
function writeCollapsed(s: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...s]))
  } catch {
    // private mode or blocked storage: the list just opens expanded next time
  }
}

interface Group {
  id: string
  name: string
  rows: { m: MarkerModel; d: number }[]
  near: number
}

/**
 * Every place on the map, grouped by region: the region you stand in first, the rest nearest
 * first (or A–Z). Choosing one centres the map on it and opens its card. Which groups are folded
 * is remembered on this device.
 */
export function PlaceList({
  models,
  regions,
  loreRegion,
  from,
  globe,
  selectedId,
  onChoose,
  onHover,
}: {
  models: MarkerModel[]
  regions: RegionSource[]
  loreRegion: (id: string) => string | undefined
  /** the traveller's position */
  from: { x: number; z: number }
  globe: boolean
  selectedId: string | null
  onChoose: (id: string) => void
  onHover: (id: string | null) => void
}) {
  const [sort, setSort] = useState<Sort>('near')
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const here = useMemo(() => regionFor(regions, from.x, from.z)?.id ?? null, [regions, from.x, from.z])
  const groups = useMemo(() => {
    const byId = new Map<string, Group>()
    for (const m of models) {
      const r = m.kind === 'exit' ? null : regionFor(regions, m.x, m.z, loreRegion(m.id))
      const id = r?.id ?? '__elsewhere'
      let g = byId.get(id)
      if (!g) byId.set(id, (g = { id, name: r?.displayName ?? (m.kind === 'exit' ? 'Ways out' : 'Elsewhere'), rows: [], near: Infinity }))
      const d = distanceTo(from, m, globe).metres
      g.rows.push({ m, d })
      g.near = Math.min(g.near, d)
    }
    const list = [...byId.values()]
    for (const g of list) g.rows.sort(sort === 'near' ? (a, b) => a.d - b.d : (a, b) => a.m.name.localeCompare(b.m.name))
    list.sort(sort === 'near' ? (a, b) => Number(b.id === here) - Number(a.id === here) || a.near - b.near : (a, b) => a.name.localeCompare(b.name))
    return list
  }, [models, regions, loreRegion, from, globe, sort, here])

  const toggle = (id: string, open: boolean) => {
    const next = new Set(collapsed)
    if (open) next.delete(id)
    else next.add(id)
    setCollapsed(next)
    writeCollapsed(next)
  }

  return (
    <div className="map-list">
      <div className="map-list__bar">
        <span className="sw-eyebrow">
          {models.length} {models.length === 1 ? 'place' : 'places'}
        </span>
        <SegmentedControl<Sort>
          label="Sort places"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'near', label: 'Nearest' },
            { value: 'az', label: 'A–Z' },
          ]}
        />
      </div>
      <div className="map-list__groups">
        {groups.map((g) => (
          <details key={g.id} className="map-list__group" open={!collapsed.has(g.id)} onToggle={(e) => toggle(g.id, (e.currentTarget as HTMLDetailsElement).open)}>
            <summary>
              <Icon name="chevronDown" />
              <span>{g.name}</span>
              {g.id === here && <span className="map-list__here">You are here</span>}
              <span className="map-list__count">{g.rows.length}</span>
            </summary>
            <ul>
              {g.rows.map(({ m }) => {
                const dist = distanceTo(from, m, globe)
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="map-list__row"
                      aria-current={m.id === selectedId || undefined}
                      onClick={() => onChoose(m.id)}
                      onPointerEnter={() => onHover(m.id)}
                      onPointerLeave={() => onHover(null)}
                    >
                      <span className="map-list__icon" data-discovered={m.discovered || m.kind === 'exit'}>
                        <Pictogram icon={m.icon} size={12} />
                      </span>
                      <span className="map-list__name">
                        {m.name}
                        {m.kind === 'landmark' && m.discovered && <span className="sw-visually-hidden">, visited</span>}
                      </span>
                      <span className="map-list__dist">{dist.short}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </details>
        ))}
      </div>
    </div>
  )
}
