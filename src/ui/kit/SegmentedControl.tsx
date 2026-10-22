import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export interface SegmentOption<T> {
  value: T
  label: ReactNode
  icon?: IconName
  /** native tooltip / longer description */
  title?: string
}

/**
 * A single-choice control drawn as a track with a sliding thumb (kit.css .sw-seg; the thumb is ::before,
 * positioned by --i / --n). ARIA radiogroup with roving tabindex: Tab enters on the checked option, arrow
 * keys move the choice. Arrow keys are stopped here so they do not also walk the player.
 * A pick made with the mouse gives focus back to the page, as IconButton does: a radio left focused by a
 * click would keep taking the arrow keys (changing the quality or the day length) while the popover stays
 * open, instead of walking. Keyboard picks (event.detail === 0, and arrow moves) keep focus in the group.
 */
export function SegmentedControl<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: SegmentOption<T>[]; onChange: (v: T) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const i = Math.max(0, options.findIndex((o) => o.value === value))
  const move = (d: number) => {
    const j = (i + d + options.length) % options.length
    onChange(options[j].value)
    refs.current[j]?.focus()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    e.stopPropagation()
    move(d)
  }
  return (
    <div className="sw-seg" role="radiogroup" aria-label={label} style={{ '--n': options.length, '--i': i } as CSSProperties} onKeyDown={onKeyDown}>
      {options.map((o, j) => (
        <button
          key={String(o.value)}
          ref={(el) => {
            refs.current[j] = el
          }}
          type="button"
          role="radio"
          aria-checked={j === i}
          tabIndex={j === i ? 0 : -1}
          className="sw-seg__opt"
          title={o.title}
          onClick={(e) => {
            onChange(o.value)
            if (e.detail > 0) e.currentTarget.blur()
          }}
        >
          {o.icon && <Icon name={o.icon} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}
