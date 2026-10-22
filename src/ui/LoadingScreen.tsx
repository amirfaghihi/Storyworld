/** Shown while a world or a place is generated. role="status" so a screen reader hears what is loading. */
export function LoadingScreen({ label = 'Drawing the map…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <div className="loading-title">Storyworld</div>
      <div className="loading-sub">{label}</div>
      <div className="loading-bar" aria-hidden="true">
        <div />
      </div>
    </div>
  )
}
