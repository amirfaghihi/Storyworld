import { useMemo, useState, type Ref } from 'react'
import { Icon } from '@/ui/kit'
import { searchPlaces, type SearchEntry } from './search'
import type { MarkerIcon } from './markers'
import { Pictogram } from './MarkerLayer'

/**
 * Place search in the map's header: an ARIA combobox over landmark and region names, forgiving
 * about accents, hyphens and one slip ("barad dur" finds Barad-dûr). Up and Down move through the
 * results, Enter picks one (the map flies there and opens its card); Escape is the dialog's,
 * which clears the search before it closes anything else.
 */
export function MapSearch({
  index,
  query,
  onQuery,
  onPick,
  iconOf,
  detailOf,
  from,
  inputRef,
}: {
  index: SearchEntry[]
  query: string
  onQuery: (q: string) => void
  onPick: (e: SearchEntry) => void
  iconOf: (e: SearchEntry) => MarkerIcon | null
  /** the line under a result's name (its region, or "Region") */
  detailOf: (e: SearchEntry) => string
  from: [number, number]
  inputRef?: Ref<HTMLInputElement>
}) {
  const [active, setActive] = useState(0)
  const [focused, setFocused] = useState(false)
  const hits = useMemo(() => searchPlaces(index, query, { limit: 8, from }), [index, query, from])
  const open = focused && query.trim().length > 0
  const pick = (i: number) => {
    const h = hits[i]
    if (!h) return
    onPick(h.entry)
  }
  return (
    <div className="map-search" data-open={open || undefined}>
      <Icon name="search" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="Search places"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="map-search-results"
        aria-activedescendant={open && hits[active] ? `map-search-${active}` : undefined}
        placeholder="Search places"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => {
          onQuery(e.target.value)
          setActive(0)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (!hits.length) return
            setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            pick(active)
          }
        }}
      />
      {query && (
        <button type="button" className="map-search__clear" aria-label="Clear search" onClick={() => onQuery('')}>
          <Icon name="close" />
        </button>
      )}
      {open && (
        <ul className="map-search__results" id="map-search-results" role="listbox" aria-label="Places found">
          {hits.length === 0 && <li className="map-search__none">No place by that name</li>}
          {hits.map((h, i) => {
            const icon = iconOf(h.entry)
            return (
              <li
                key={h.entry.kind + h.entry.id}
                id={`map-search-${i}`}
                role="option"
                aria-selected={i === active}
                // keep focus in the input, so the list does not close before the click lands
                onPointerDown={(e) => e.preventDefault()}
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(i)}
              >
                <span className="map-search__icon">{icon ? <Pictogram icon={icon} size={12} /> : <Icon name="map" />}</span>
                <span className="map-search__name">{h.entry.name}</span>
                <span className="map-search__detail">{detailOf(h.entry)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
