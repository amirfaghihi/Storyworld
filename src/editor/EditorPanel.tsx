import { useEffect, useState, type CSSProperties } from 'react'
import { useWorld } from '@/world/WorldContext'
import { useEditorStore, type Tool } from './editorStore'
import { BIOME_NAMES } from '@/world/biomes'
import { PAINTABLE, undo } from './terrainEdit'
import { downloadWorld, saveToProject } from './exportWorld'
import { invalidateOverview } from '@/map2d/renderOverview'
import { teleportTo } from '@/player/teleport'
import { LandmarkTypeSchema } from '@/world/schema'
import { playerState } from '@/store/stores'

/** how far along its track a range's value sits, for the kit's filled track (.sw-range reads --fill) */
const fill = (v: number, min: number, max: number) => ({ '--fill': `${((v - min) / (max - min)) * 100}%` }) as CSSProperties

const OUTLINE = 'sw-btn sw-btn--sm sw-btn--outline'

const TOOLS: [Tool, string, string][] = [
  ['raise', 'Raise', 'drag to lift the ground'],
  ['lower', 'Lower', 'drag to dig'],
  ['smooth', 'Smooth', 'soften bumps'],
  ['flatten', 'Flatten', 'level to the height where you started dragging'],
  ['paint', 'Paint', 'paint a biome'],
  ['landmark', 'Landmark', 'click to move the selected place, or add a new one'],
]

/** DOM half of the editor: tools, brush settings, landmark fields, save/export. Toggle with Tab. */
export function EditorPanel() {
  const world = useWorld()
  const { meta } = world
  const s = useEditorStore()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!s.status) return
    const t = setTimeout(() => s.setStatus(null), 4000)
    return () => clearTimeout(t)
  }, [s.status, s])
  if (!s.enabled) return null
  const isPlace = !!meta.place
  const selected = s.selectedLandmark ? meta.landmarks.find((l) => l.id === s.selectedLandmark) : undefined

  const edit = (patch: Partial<typeof meta.landmarks[number]>) => {
    if (!selected) return
    Object.assign(selected, patch)
    s.bump()
    s.setDirty(true)
    invalidateOverview(world)
  }
  const rename = (id: string) => {
    if (!selected || !id || meta.landmarks.some((l) => l.id === id && l !== selected)) return
    // keep the lore entry attached
    if (world.lore.landmarks[selected.id]) {
      world.lore.landmarks[id] = world.lore.landmarks[selected.id]
      delete world.lore.landmarks[selected.id]
    }
    selected.id = id
    s.selectLandmark(id)
    s.bump()
    s.setDirty(true)
  }
  const remove = () => {
    if (!selected) return
    meta.landmarks.splice(meta.landmarks.indexOf(selected), 1)
    s.selectLandmark(null)
    s.bump()
    s.setDirty(true)
    invalidateOverview(world)
  }
  const save = async () => {
    setBusy(true)
    try {
      const files = await saveToProject(world)
      s.setDirty(false)
      s.setStatus(`Saved ${files}`)
    } catch (e) {
      s.setStatus(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="editor">
      <header>
        <b>Editor</b>
        <span className="muted small">
          <kbd>Tab</kbd> close · right-drag to look · <kbd>⌘Z</kbd> undo
        </span>
      </header>
      <div className="tools">
        {TOOLS.map(([id, label, tip]) => (
          <button key={id} type="button" className={OUTLINE} aria-pressed={s.tool === id} title={tip} onClick={() => s.setTool(id)}>
            {label}
          </button>
        ))}
      </div>
      {s.tool !== 'landmark' && (
        <div className="row">
          <label>
            Radius <span>{s.radius.toFixed(0)} m</span>
            <input className="sw-range" style={fill(s.radius, 3, 90)} type="range" min={3} max={90} step={1} value={s.radius} onChange={(e) => s.setRadius(+e.target.value)} />
          </label>
          <label>
            Strength <span>{Math.round(s.strength * 100)}%</span>
            <input className="sw-range" style={fill(s.strength, 0.05, 1)} type="range" min={0.05} max={1} step={0.05} value={s.strength} onChange={(e) => s.setStrength(+e.target.value)} />
          </label>
        </div>
      )}
      {s.tool === 'paint' && (
        <label className="row">
          Biome
          <select value={s.biome} onChange={(e) => s.setBiome(+e.target.value)}>
            {PAINTABLE.map((b) => (
              <option key={b} value={b}>
                {BIOME_NAMES[b]}
              </option>
            ))}
          </select>
        </label>
      )}
      {s.tool === 'landmark' && (
        <div className="landmark-edit">
          <label className="row">
            Place
            <select value={selected?.id ?? ''} onChange={(e) => s.selectLandmark(e.target.value || null)}>
              <option value="">(new: click the ground)</option>
              {meta.landmarks
                .filter((l) => !l.hidden)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.displayName}
                  </option>
                ))}
            </select>
          </label>
          {selected && (
            <>
              <label className="row">
                Name
                <input value={selected.displayName} onChange={(e) => edit({ displayName: e.target.value })} />
              </label>
              <label className="row">
                Id
                <input defaultValue={selected.id} key={selected.id} onBlur={(e) => rename(e.target.value.trim())} />
              </label>
              <label className="row">
                Type
                <select value={selected.type} onChange={(e) => edit({ type: e.target.value as typeof selected.type })}>
                  {LandmarkTypeSchema.options.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="row">
                Discover radius <span>{selected.discoverRadius} m</span>
                <input className="sw-range" style={fill(selected.discoverRadius, 6, 80)} type="range" min={6} max={80} value={selected.discoverRadius} onChange={(e) => edit({ discoverRadius: +e.target.value })} />
              </label>
              <div className="row buttons">
                <button type="button" className={OUTLINE} onClick={() => teleportTo(selected.position[0], selected.position[1], world.heightfield)}>Go there</button>
                <button type="button" className={OUTLINE} onClick={() => edit({ position: [+playerState.position.x.toFixed(1), +playerState.position.z.toFixed(1)] })}>Move to me</button>
                <button type="button" className="sw-btn sw-btn--sm sw-btn--danger" onClick={remove}>
                  Delete
                </button>
              </div>
              <div className="muted small">
                at {selected.position[0]}, {selected.position[1]} · click the ground to move it
              </div>
            </>
          )}
        </div>
      )}
      <div className="row buttons">
        <button
          type="button"
          className={OUTLINE}
          onClick={() => {
            undo(world.heightfield)
            invalidateOverview(world)
          }}
        >
          Undo
        </button>
        {isPlace ? (
          <span className="muted small">Places are generated from code; edits here are not saved.</span>
        ) : (
          <>
            {import.meta.env.DEV && (
              <button type="button" className="sw-btn sw-btn--sm sw-btn--primary" disabled={busy} onClick={save}>
                {busy ? 'Saving…' : 'Save to project'}
              </button>
            )}
            <button type="button" className={OUTLINE} onClick={() => downloadWorld(world).catch((e) => s.setStatus(String(e)))}>Download</button>
          </>
        )}
      </div>
      <div className="status">
        {s.status ?? (s.dirty ? 'Unsaved changes' : 'No changes')}
      </div>
    </aside>
  )
}
