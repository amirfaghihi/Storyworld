import { IconButton } from '@/ui/kit'
import { useMapZoom, type MapCamera } from './useMapCamera'

/**
 * Zoom in, zoom out, "centre on me" and "show the whole map" as one joined column of kit buttons,
 * so they look and behave like every other button in the app. Zoom +/− are hidden on phones,
 * where you pinch.
 */
export function ZoomControls({ cam, onLocate }: { cam: MapCamera; onLocate: () => void }) {
  const zoom = useMapZoom(cam)
  return (
    <div className="map-controls" data-map-chrome>
      <div className="map-zoom" role="group" aria-label="Map view">
        <IconButton className="map-zoom__step" icon="plus" label="Zoom in" shortcut="+" variant="solid" tipSide="top" tipAlign="end" disabled={!zoom.canZoomIn} onClick={() => cam.zoomBy(1.6)} />
        <IconButton className="map-zoom__step" icon="minus" label="Zoom out" shortcut="-" variant="solid" tipSide="top" tipAlign="end" disabled={!zoom.canZoomOut} onClick={() => cam.zoomBy(1 / 1.6)} />
        <IconButton icon="locate" label="Centre on me" shortcut="L" variant="solid" tipSide="top" tipAlign="end" onClick={onLocate} />
        <IconButton icon="fit" label="Show the whole map" shortcut="0" variant="solid" tipSide="top" tipAlign="end" onClick={() => cam.fit()} />
      </div>
    </div>
  )
}
