import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useWorld } from '@/world/WorldContext'
import { useEditorStore } from './editorStore'
import { applyBrush, beginStroke, endStroke, undo } from './terrainEdit'
import { invalidateOverview } from '@/map2d/renderOverview'

const TOOL_COLOR: Record<string, string> = {
  raise: '#ffd27a',
  lower: '#7ab8ff',
  smooth: '#c8ff9a',
  flatten: '#ffffff',
  paint: '#ff9ad0',
  landmark: '#ff5a3c',
}

/**
 * In-canvas half of the editor: a brush ring that follows the mouse over the terrain, strokes
 * that sculpt or paint the heightfield, and click-to-place for landmarks.
 */
export function EditorTools() {
  const world = useWorld()
  const { heightfield: hf, meta } = world
  const enabled = useEditorStore((s) => s.enabled)
  const { camera, scene, gl } = useThree()
  const ring = useRef<THREE.Mesh>(null)
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const mouse = useRef(new THREE.Vector2(0, 0))
  const hit = useRef<THREE.Vector3 | null>(null)
  const stroking = useRef(false)
  const flattenTo = useRef<number | undefined>(undefined)
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }), [])
  useEffect(() => () => material.dispose(), [material])

  useEffect(() => {
    if (!enabled) return
    const el = gl.domElement
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      mouse.current.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    }
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !(e.target instanceof HTMLCanvasElement)) return
      const s = useEditorStore.getState()
      const h = hit.current
      if (!h) return
      if (s.tool === 'landmark') {
        const sel = s.selectedLandmark ? meta.landmarks.find((l) => l.id === s.selectedLandmark) : null
        if (sel) {
          sel.position = [+h.x.toFixed(1), +h.z.toFixed(1)]
        } else {
          let n = 1
          while (meta.landmarks.some((l) => l.id === `new-place-${n}`)) n++
          const id = `new-place-${n}`
          meta.landmarks.push({ id, displayName: 'New place', type: 'other', position: [+h.x.toFixed(1), +h.z.toFixed(1)], discoverRadius: 28 })
          s.selectLandmark(id)
        }
        s.bump()
        s.setDirty(true)
        invalidateOverview(world)
        return
      }
      beginStroke(hf)
      stroking.current = true
      flattenTo.current = h.y
    }
    const onUp = () => {
      if (!stroking.current) return
      stroking.current = false
      endStroke()
      invalidateOverview(world)
      useEditorStore.getState().setDirty(true)
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') {
        e.preventDefault()
        undo(hf)
        invalidateOverview(world)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
      if (stroking.current) {
        stroking.current = false
        endStroke()
      }
    }
  }, [enabled, gl, hf, meta, world])

  useFrame((_, rawDt) => {
    if (!enabled) return
    const dt = Math.min(rawDt, 0.05)
    const s = useEditorStore.getState()
    // pick the terrain under the mouse
    raycaster.setFromCamera(mouse.current, camera)
    const terrain = scene.getObjectByName('terrain')
    const hits = terrain ? raycaster.intersectObject(terrain, true) : []
    hit.current = hits.length ? hits[0].point : null
    const m = ring.current
    if (m) {
      m.visible = !!hit.current
      if (hit.current) {
        m.position.copy(hit.current)
        m.position.y += 0.3
        const r = s.tool === 'landmark' ? 3 : s.radius
        m.scale.setScalar(r)
        material.color.set(TOOL_COLOR[s.tool])
      }
    }
    if (stroking.current && hit.current && s.tool !== 'landmark') {
      applyBrush(hf, s.tool, hit.current.x, hit.current.z, s.radius, s.strength, s.biome, dt, flattenTo.current)
    }
  })

  if (!enabled) return null
  return (
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} material={material} renderOrder={50}>
      <ringGeometry args={[0.9, 1, 56]} />
    </mesh>
  )
}
