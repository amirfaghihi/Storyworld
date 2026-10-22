/**
 * A plain geometric compass star. The big map is always north-up, so it only says which way north
 * is; screen readers skip it. Drawn for Storyworld: four points, the north one in the accent.
 */
export function Compass() {
  return (
    <div className="map-compass" data-map-chrome aria-hidden="true">
      <svg viewBox="0 0 48 48" width="48" height="48">
        <circle cx="24" cy="26" r="15" className="map-compass__ring" />
        <path d="M24 9 27.2 22.8 24 26 20.8 22.8Z" className="map-compass__north" />
        <path d="M24 43 20.8 29.2 24 26 27.2 29.2Z" className="map-compass__point" />
        <path d="M41 26 27.2 29.2 24 26 27.2 22.8Z" className="map-compass__point" />
        <path d="M7 26 20.8 22.8 24 26 20.8 29.2Z" className="map-compass__point" />
        <text x="24" y="7.5" textAnchor="middle" className="map-compass__n">
          N
        </text>
      </svg>
    </div>
  )
}
