import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useWorld } from '@/world/WorldContext'
import type { LoadedWorld } from '@/world/loadWorld'
import { playerState, usePlayerStore, useUiStore, type MapFocus } from '@/store/stores'
import { travelToLandmark } from '@/player/teleport'
import { navigate } from '@/router'
import { useEditorStore } from '@/editor/editorStore'
import { IconButton } from '@/ui/kit'
import { EXIT_ID, basePriority, markerModels, regionFor, type MarkerModel } from './markers'
import { regionAnchors } from './labels'
import { extractPlaceFeatures } from './placeFeatures'
import type { PlanItem } from './MapLegend'
import { buildSearchIndex, type SearchEntry, type SearchSource } from './search'
import { useMapCamera } from './useMapCamera'
import { MapViewport } from './MapViewport'
import { MapSearch } from './MapSearch'
import { PlaceCard, type CardSubject } from './PlaceCard'
import { PlaceList } from './PlaceList'
import { BottomSheet, SHEET_PEEK, sheetHeight, type SheetSnap } from './BottomSheet'
import './map.css'

/** The desktop side panel's width plus its margin (map.css .map-panel). */
const PANEL_W = 372
/** Zoom (as a multiple of fit) that "show on map", search and the phone's first view open at. */
const CLOSE_UP = 2.5
/**
 * The world's own keys (useInput: the codex, time, weather). With the map open they would act
 * behind it, or open the codex over it, so the map marks them handled and they do nothing.
 */
const WORLD_KEYS = new Set(['KeyC', 'KeyT', 'KeyY', 'BracketLeft', 'BracketRight'])

type Selection = { kind: 'landmark' | 'exit' | 'region'; id: string }

function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const m = matchMedia(query)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches)
}

/**
 * The full map (M). A dialog over the world: a header with the world's name, search, the places
 * list and close; the map filling the rest, with constant-size markers and names laid out so they
 * never collide; a card for the selected place (a side panel on desktop, a bottom sheet on
 * phones) from which you travel. A click only ever selects; travel is the card's button.
 */
export function OverviewMap() {
  const open = useUiStore((s) => s.mapOpen)
  const world = useWorld()
  if (!open) return null
  return <MapDialog key={world.meta.id} world={world} />
}

function MapDialog({ world }: { world: LoadedWorld }) {
  const { meta } = world
  const cam = useMapCamera()
  const mapFocus = useUiStore((s) => s.mapFocus)
  const regionId = useUiStore((s) => s.regionId)
  const discovered = usePlayerStore((s) => s.discovered)
  const revision = useEditorStore((s) => s.revision)
  const narrow = useMedia('(max-width: 760px)')
  const coarse = useMedia('(pointer: coarse)')
  const touch = narrow || coarse

  const [selection, setSelection] = useState<Selection | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [snap, setSnap] = useState<SheetSnap>('peek')
  const [highlightId, setHighlightId] = useState<string | null>(null)

  const root = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const cardHeading = useRef<HTMLHeadingElement>(null)
  const focusCard = useRef(false)

  // ---- what is on the map

  const discoveredSet = useMemo(() => new Set(discovered), [discovered])
  const models = useMemo(() => {
    const exit = meta.place?.exit
    return markerModels(meta.landmarks, discoveredSet, exit ? { x: exit.x, z: exit.z, label: exit.label } : undefined)
    // revision: landmark edits in the editor change meta.landmarks in place
  }, [meta, discoveredSet, revision])
  const modelById = useMemo(() => new Map(models.map((m) => [m.id, m])), [models])
  const fitBox = useMemo((): [number, number, number, number] => {
    const [W, H] = meta.size
    const mb = meta.mapBounds
    return mb ? [Math.max(0, mb[0]), Math.max(0, mb[1]), Math.min(W, mb[2]), Math.min(H, mb[3])] : [0, 0, W, H]
  }, [meta])
  const anchors = useMemo(() => regionAnchors(meta.regions, fitBox), [meta, fitBox, revision])
  // a place's town plan (the same one the map draws): names keep off its buildings and smials,
  // and the legend explains the symbols it has
  const plan = useMemo(() => extractPlaceFeatures(world), [world, revision])
  const planItems = useMemo(() => {
    const items: PlanItem[] = []
    if (plan.buildings.length) items.push('building')
    if (plan.smials.length) items.push('smial')
    if (plan.hedges.length) items.push('hedge')
    if (plan.fences.length) items.push('fence')
    if (plan.walls.length) items.push('wall')
    if (world.features?.ditches?.length) items.push('earthwork')
    if (plan.gates.length) items.push('gate')
    if (plan.bridges.length) items.push('bridge')
    return items
  }, [plan, world])
  const regionNames = useMemo(() => new Map(meta.regions.map((r) => [r.id, r.displayName])), [meta])
  const loreRegion = useCallback((id: string) => world.lore.landmarks[id]?.region, [world])
  const regionOf = useCallback((m: MarkerModel) => (m.kind === 'exit' ? undefined : regionFor(meta.regions, m.x, m.z, loreRegion(m.id))?.displayName), [meta, loreRegion])
  const summaryOf = useCallback((m: MarkerModel) => (m.kind === 'exit' ? `The way out of ${meta.name}.` : world.lore.landmarks[m.id]?.summary), [world, meta])

  // where the traveller was when the map opened (they do not walk while it is open)
  const [from] = useState(() => ({ x: playerState.map.x, z: playerState.map.z }))
  const fromPair = useMemo((): [number, number] => [from.x, from.z], [from])

  const searchIndex = useMemo(() => {
    const sources: SearchSource[] = models.map((m) => ({ id: m.id, kind: m.kind, name: m.name, x: m.x, z: m.z, priority: m.priority, discovered: m.discovered }))
    for (const a of anchors) {
      const r = meta.regions.find((r) => r.id === a.id)
      if (!r) continue
      const [x, z] = a.points[0] ?? [(a.box[0] + a.box[2]) / 2, (a.box[1] + a.box[3]) / 2]
      sources.push({ id: r.id, kind: 'region', name: r.displayName, x, z, priority: basePriority('other', false) - 1 })
    }
    return buildSearchIndex(sources)
  }, [models, anchors, meta])

  // ---- panels and the camera's free area

  const panelOpen = !!selection || listOpen
  const sheetH = snap === 'peek' ? SHEET_PEEK : 0
  /**
   * Tells the camera what the panels cover, so "centre on" and "reveal" aim at the free part of
   * the map: on phones the sheet at the given height (the sheet's own numbers, from the map's
   * height), on desktop the side panel. Called from the effect below, and directly wherever a
   * panel is about to open and the camera moves before React has re-rendered (select, the
   * first view), so the move already allows for it.
   */
  const syncInsets = useCallback(
    (sheetSnap: SheetSnap, panel: boolean) => {
      const mapH = cam.view.vh || Math.max(200, window.innerHeight - 52)
      cam.setInsets(
        narrow ? { top: 0, right: 0, left: 0, bottom: sheetHeight(sheetSnap, mapH) } : { top: 0, left: 0, bottom: 0, right: panel ? PANEL_W : 0 },
        { top: 0, right: 0, left: 0, bottom: narrow ? SHEET_PEEK : 0 },
      )
    },
    [cam, narrow],
  )
  useEffect(() => {
    syncInsets(snap, panelOpen)
    // The sheet's heights follow the map's height, which changes when a phone turns. The camera
    // tells once the map has its new size (the window's resize event comes before it does), the
    // same moment the sheet itself re-measures, so the two agree.
    return cam.onResize(() => syncInsets(snap, panelOpen))
  }, [cam, syncInsets, panelOpen, snap])
  const panels = useRef({ snap, panelOpen })
  panels.current = { snap, panelOpen }
  const chromeKey = `${narrow}|${panelOpen}|${legendOpen}|${narrow ? snap : ''}|${sheetH}`

  // ---- selecting

  const select = useCallback(
    (id: string, byKeyboard = false) => {
      const m = modelById.get(id)
      if (!m) return
      setSelection({ kind: m.kind, id })
      setQuery('')
      // a card opens: half a sheet on a phone (never more, so the place stays in view above it)
      const sheetSnap: SheetSnap = narrow ? 'half' : panels.current.snap
      if (narrow) setSnap(sheetSnap)
      syncInsets(sheetSnap, true)
      focusCard.current = byKeyboard
      // after the panel has opened, make sure the marker is not hidden under it
      requestAnimationFrame(() => cam.reveal(m.x, m.z))
    },
    [modelById, narrow, cam, syncInsets],
  )
  const deselect = useCallback(() => {
    const id = selection?.id
    setSelection(null)
    if (narrow) setSnap(listOpen ? 'half' : 'peek')
    // give focus back to the marker the card was about, if focus was in the card
    if (id && root.current?.querySelector('.map-card')?.contains(document.activeElement)) {
      const btn = [...(root.current?.querySelectorAll<HTMLElement>('.map-marker') ?? [])].find((b) => b.getAttribute('aria-pressed') === 'true')
      ;(btn && !btn.hidden ? btn : root.current?.querySelector<HTMLElement>('.map-viewport'))?.focus()
    }
  }, [selection, narrow, listOpen])
  // The card's title takes focus so a screen reader reads the new card, but a focus ring there
  // only helps someone steering by keyboard: it shows when the last input was a key.
  const keyboardInput = useRef(false)
  useEffect(() => {
    const onKey = () => {
      keyboardInput.current = true
    }
    const onPointer = () => {
      keyboardInput.current = false
    }
    // capture, and registered before the map's key handler below, which may stop the event
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointer, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointer, true)
    }
  }, [])
  useEffect(() => {
    const h = cardHeading.current
    if (focusCard.current && selection && h) {
      focusCard.current = false
      h.toggleAttribute('data-focus-ring', keyboardInput.current)
      // no scrolling into view: on a phone the sheet is still sliding up, and the browser would
      // scroll the whole map up under the header to show the title
      h.focus({ preventScroll: true })
    }
  }, [selection])

  const openCluster = useCallback(
    (members: MarkerModel[]) => {
      // zoom until the closest two of them sit a couple of badges apart
      let minD = Infinity
      for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) minD = Math.min(minD, Math.hypot(members[i].x - members[j].x, members[i].z - members[j].z))
      const size = touch ? 28 : 22
      const s = Math.max(cam.view.s * 2, (size * 2.2) / Math.max(minD, 1e-3))
      const cx = members.reduce((a, m) => a + m.x, 0) / members.length
      const cz = members.reduce((a, m) => a + m.z, 0) / members.length
      const [x, z] = cam.centreFor(cx, cz, s)
      cam.flyTo(x, z, s)
    },
    [cam, touch],
  )

  const locate = useCallback(() => {
    const s = Math.max(cam.view.s, cam.fitScale * CLOSE_UP)
    const [x, z] = cam.centreFor(playerState.map.x, playerState.map.z, s)
    cam.flyTo(x, z, s)
  }, [cam])

  const pickSearch = useCallback(
    (e: SearchEntry) => {
      searchInput.current?.blur()
      if (e.kind === 'region') {
        const a = anchors.find((a) => a.id === e.id)
        setSelection({ kind: 'region', id: e.id })
        setQuery('')
        if (narrow) setSnap('half')
        syncInsets('half', true)
        if (a) requestAnimationFrame(() => cam.fitBox(a.box, 48))
        return
      }
      const m = modelById.get(e.id)
      if (!m) return
      select(m.id, true)
      const s = Math.max(cam.view.s, cam.fitScale * CLOSE_UP)
      requestAnimationFrame(() => {
        const [x, z] = cam.centreFor(m.x, m.z, s)
        cam.flyTo(x, z, s)
      })
    },
    [anchors, modelById, select, cam, narrow, syncInsets],
  )

  // ---- placing the camera: on open, and whenever someone asks the open map to show something

  const applyFocus = useCallback(
    (f: MapFocus | null, animate: boolean) => {
      const m = f?.id ? modelById.get(f.id) : undefined
      // the panels as they will be once this lands (on the first view, before any effect has
      // told the camera, the phone's peek must already count, or the first fit ignores it)
      if (m) syncInsets('half', true)
      else syncInsets(panels.current.snap, panels.current.panelOpen)
      const fit = cam.fitScale
      const go = (x: number, z: number, s: number) => {
        const c = cam.centreFor(x, z, s)
        // snug (no void showing) suits a first look round; with a card open the place must stay
        // in the free part, which near the map's edge needs the usual slack
        const [cx, cz] = m ? c : cam.snugCentre(c[0], c[1], s)
        if (animate) cam.flyTo(cx, cz, s)
        else cam.jumpTo(cx, cz, s)
      }
      if (m) {
        setSelection({ kind: m.kind, id: m.id })
        if (narrow) setSnap('half')
        go(m.x, m.z, fit * CLOSE_UP)
      } else if (f && f.x !== undefined && f.z !== undefined) go(f.x, f.z, f.scale ?? fit * CLOSE_UP)
      else if (narrow) go(playerState.map.x, playerState.map.z, fit * CLOSE_UP)
      // desktop: the whole map, which has the traveller in it wherever they are (centring on them
      // at this zoom would only slide the map off-centre)
      else cam.fit(animate)
    },
    [cam, modelById, narrow, syncInsets],
  )
  const onReady = useCallback(() => applyFocus(useUiStore.getState().mapFocus, false), [applyFocus])
  const firstFocus = useRef(mapFocus)
  useEffect(() => {
    if (mapFocus === firstFocus.current || !cam.placed) return
    firstFocus.current = mapFocus
    if (mapFocus) applyFocus(mapFocus, true)
  }, [mapFocus, applyFocus, cam])

  // ---- leaving the map

  const close = useCallback(() => useUiStore.getState().setMapOpen(false), [])
  const travel = useCallback(() => {
    if (!selection || selection.kind === 'region') return
    if (selection.kind === 'exit') {
      const e = meta.place!.exit
      travelToLandmark({ position: [e.x, e.z], discoverRadius: e.radius * 3 }, world.heightfield, meta.seaLevel, world.globe)
      close()
      return
    }
    const lm = meta.landmarks.find((l) => l.id === selection.id)
    if (!lm) return
    travelToLandmark(lm, world.heightfield, meta.seaLevel, world.globe)
    close()
    useUiStore.getState().setSelectedLandmark(lm.id)
  }, [selection, meta, world, close])
  const enter = useCallback(() => {
    const lm = selection && meta.landmarks.find((l) => l.id === selection.id)
    if (!lm?.placeId) return
    close()
    navigate(`${meta.id}/${lm.placeId}`)
  }, [selection, meta, close])
  const leave = useCallback(() => {
    const p = meta.place
    if (!p) return
    close()
    navigate(p.parentWorldId, p.returnTo[0], p.returnTo[1])
  }, [meta, close])

  // ---- keyboard: the map's keys, layered Escape, and a focus trap

  const state = useRef({ selection, query, listOpen, legendOpen, snap, narrow })
  state.current = { selection, query, listOpen, legendOpen, snap, narrow }
  useEffect(() => {
    const focusViewport = () => root.current?.querySelector<HTMLElement>('.map-viewport')?.focus({ preventScroll: true })
    const escape = (inSearch: boolean) => {
      const s = state.current
      if (inSearch && s.query) setQuery('')
      else if (s.selection) deselect()
      else if (inSearch || s.query) {
        setQuery('')
        focusViewport()
      } else if (s.legendOpen) setLegendOpen(false)
      else if (s.listOpen || (s.narrow && s.snap !== 'peek')) {
        setListOpen(false)
        setSnap('peek')
      } else close()
    }
    // Capture phase on window: runs before useInput's global keys and before any control, so a key
    // the map uses does exactly one thing (Escape closes only the innermost layer).
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null
      const inField = !!t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable)
      const consume = () => {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
      if (e.key === 'Escape') {
        consume()
        escape(inField && t === searchInput.current)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        consume()
        searchInput.current?.focus()
        return
      }
      if (inField || e.metaKey || e.ctrlKey || e.altKey) return
      if (WORLD_KEYS.has(e.code)) {
        // preventDefault is enough: useInput skips handled events
        e.preventDefault()
        return
      }
      // arrows inside the panels belong to their controls (the sort switch, the sheet handle)
      const inPanel = !!t?.closest('.map-panel, .map-sheet-panel, .map-header, .map-legend')
      const pan = e.shiftKey ? 0.45 : 0.15
      switch (e.key) {
        case 'm':
        case 'M':
          consume()
          close()
          return
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown':
          if (inPanel) return
          consume()
          cam.nudge(e.key === 'ArrowLeft' ? -pan : e.key === 'ArrowRight' ? pan : 0, e.key === 'ArrowUp' ? -pan : e.key === 'ArrowDown' ? pan : 0)
          return
        case '+':
        case '=':
          consume()
          cam.zoomBy(1.5)
          return
        case '-':
        case '_':
        case '−':
          consume()
          cam.zoomBy(1 / 1.5)
          return
        case '0':
          consume()
          cam.fit()
          return
        case 'l':
        case 'L':
          consume()
          locate()
          return
        case '/':
          consume()
          searchInput.current?.focus()
          return
      }
    }
    // Tab stays inside the dialog (bubble phase, so controls that handle Tab themselves go first)
    const onTab = (e: KeyboardEvent) => {
      const el = root.current
      if (e.key !== 'Tab' || !el || e.defaultPrevented) return
      const f = [...el.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter(
        (n) => !n.hasAttribute('disabled') && !n.closest('[hidden]') && n.getClientRects().length > 0,
      )
      if (!f.length) return
      const first = f[0]
      const last = f[f.length - 1]
      const inside = el.contains(document.activeElement)
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keydown', onTab)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keydown', onTab)
    }
  }, [cam, close, deselect, locate])

  // focus moves into the map on open and back to whatever opened it on close
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    root.current?.querySelector<HTMLElement>('.map-viewport')?.focus({ preventScroll: true })
    return () => {
      if (opener && opener !== document.body && document.contains(opener)) opener.focus({ preventScroll: true })
    }
  }, [])

  // ---- render

  const landmarks = models.filter((m) => m.kind === 'landmark')
  const visited = landmarks.filter((m) => m.discovered).length
  const here = regionId ? regionNames.get(regionId) : undefined
  const selModel = selection && selection.kind !== 'region' ? modelById.get(selection.id) : undefined
  const subject: CardSubject | null = !selection
    ? null
    : selection.kind === 'region'
      ? { kind: 'region', id: selection.id, name: regionNames.get(selection.id) ?? selection.id, summary: world.lore.regions[selection.id]?.summary }
      : selModel
        ? { kind: selModel.kind, model: selModel }
        : null
  const canEnter = !!selModel && selModel.kind === 'landmark' && !!meta.landmarks.find((l) => l.id === selModel.id)?.placeId && !meta.place

  const card = subject && (
    <PlaceCard
      subject={subject}
      region={selModel ? regionOf(selModel) : undefined}
      from={from}
      globe={meta.kind === 'globe'}
      speedScale={meta.speedScale}
      placeName={meta.name}
      canEnter={canEnter}
      inPlace={!!meta.place}
      headingRef={cardHeading}
      onClose={deselect}
      onBack={listOpen ? () => setSelection(null) : undefined}
      onTravel={travel}
      onEnter={enter}
      onLeave={leave}
    />
  )
  const list = (
    <PlaceList
      models={models}
      regions={meta.regions}
      loreRegion={loreRegion}
      from={from}
      globe={meta.kind === 'globe'}
      selectedId={selection?.id ?? null}
      onChoose={(id) => {
        const m = modelById.get(id)
        if (!m) return
        select(id, true)
        const s = Math.max(cam.view.s, cam.fitScale * 1.5)
        requestAnimationFrame(() => {
          const [x, z] = cam.centreFor(m.x, m.z, s)
          cam.flyTo(x, z, s)
        })
      }}
      onHover={setHighlightId}
    />
  )

  return (
    <div
      className="map-dialog sw-tone-day"
      role="dialog"
      aria-modal="true"
      aria-labelledby="map-dialog-title"
      ref={root}
      onPointerDown={(e) => {
        // a press on the dim backdrop around the sheet closes the map
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="map-sheet">
        <header className="map-header">
          <div className="map-heading">
            <h1 id="map-dialog-title" className="map-title">
              {meta.name}
            </h1>
            <p className="map-subtitle">
              {here ? `${here} · ` : ''}
              {visited} of {landmarks.length} places visited
            </p>
          </div>
          <MapSearch
            index={searchIndex}
            query={query}
            onQuery={setQuery}
            onPick={pickSearch}
            iconOf={(e) => (e.kind === 'region' ? null : (modelById.get(e.id)?.icon ?? null))}
            detailOf={(e) => (e.kind === 'region' ? 'Region' : e.id === EXIT_ID ? 'Way out' : ((modelById.get(e.id) && regionOf(modelById.get(e.id)!)) ?? ''))}
            from={fromPair}
            inputRef={searchInput}
          />
          {!narrow && (
            <button
              type="button"
              className="sw-btn sw-btn--outline map-list-toggle"
              aria-expanded={listOpen}
              aria-controls="map-panel"
              onClick={(e) => {
                // the list replaces whatever card is open; pressed again, the panel closes
                setListOpen(!listOpen)
                setSelection(null)
                if (e.detail > 0) e.currentTarget.blur()
              }}
            >
              <svg className="sw-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 6.5h11M9 12h11M9 17.5h11" />
                <circle cx="4.75" cy="6.5" r="1.1" />
                <circle cx="4.75" cy="12" r="1.1" />
                <circle cx="4.75" cy="17.5" r="1.1" />
              </svg>
              <span>Places</span>
            </button>
          )}
          <IconButton icon="close" label="Close map" shortcut="M" tipAlign="end" onClick={close} />
        </header>
        <MapViewport
          world={world}
          cam={cam}
          models={models}
          anchors={anchors}
          obstacles={plan.reserved}
          planItems={planItems}
          regionNames={regionNames}
          selectedId={selection && selection.kind !== 'region' ? selection.id : null}
          highlightId={highlightId}
          touch={touch}
          chromeKey={chromeKey}
          legendOpen={legendOpen}
          onToggleLegend={() => setLegendOpen((v) => !v)}
          onSelect={select}
          onOpenCluster={openCluster}
          onBackgroundTap={() => {
            if (state.current.selection) deselect()
          }}
          onLocate={locate}
          onReady={onReady}
          regionOf={regionOf}
          summaryOf={summaryOf}
        >
          {!narrow && panelOpen && (
            <aside className="map-panel" id="map-panel" data-map-chrome aria-label={card ? 'Selected place' : 'Places'}>
              {card ?? (
                <>
                  <header className="map-panel__head">
                    <h2>Places</h2>
                    <IconButton icon="close" label="Close the list" size="sm" tipAlign="end" onClick={() => setListOpen(false)} />
                  </header>
                  {list}
                </>
              )}
            </aside>
          )}
          {narrow && (
            <BottomSheet
              snap={snap}
              onSnap={(s) => {
                setSnap(s)
                if (s === 'peek') setSelection(null)
              }}
              label={subject ? 'Selected place' : 'Places'}
              peek={subject ? (subject.kind === 'region' ? subject.name : subject.model.name) : `${models.length} places · ${visited} visited`}
              peekWhenOpen={!subject}
            >
              {card ?? list}
            </BottomSheet>
          )}
        </MapViewport>
      </div>
    </div>
  )
}

