import type { ReactNode } from 'react'

export type TipAlign = 'center' | 'start' | 'end'
export type TipSide = 'bottom' | 'top'

/**
 * The tooltip bubble. Pure CSS: it is a child of its trigger and shows on :hover (after --tip-delay,
 * fine pointers only) and immediately on :focus-visible (kit.css .sw-tip). aria-hidden because the trigger
 * already carries the same text as its accessible name; the shortcut is exposed with aria-keyshortcuts.
 */
export function Tip({ label, shortcut, align = 'center', side = 'bottom' }: { label: ReactNode; shortcut?: string; align?: TipAlign; side?: TipSide }) {
  return (
    <span className="sw-tip" data-align={align === 'center' ? undefined : align} data-side={side === 'bottom' ? undefined : side} aria-hidden="true">
      {label}
      {shortcut && <kbd className="sw-kbd">{shortcut}</kbd>}
    </span>
  )
}

/** Tooltip for a trigger that is not an IconButton (e.g. the minimap canvas). */
export function Tooltip({ label, shortcut, align, side, children }: { label: ReactNode; shortcut?: string; align?: TipAlign; side?: TipSide; children: ReactNode }) {
  return (
    <span className="sw-tip-host">
      {children}
      <Tip label={label} shortcut={shortcut} align={align} side={side} />
    </span>
  )
}
