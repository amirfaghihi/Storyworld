import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react'

/**
 * An anchored, non-modal panel (role="dialog"). Closes on a pointer-down outside it and its trigger, and on
 * Escape. Escape is caught in the capture phase on window and stopped there, so it closes only the popover —
 * useInput's window keydown (which on Escape also clears the selected lore card) never sees it.
 * Focus moves into the panel only when it was opened from the keyboard, so a mouse user can open the
 * time panel and keep walking with WASD.
 */
export function Popover({
  open,
  onClose,
  anchor,
  label,
  width = 300,
  align = 'end',
  focusOnOpen = false,
  children,
}: {
  open: boolean
  onClose: () => void
  anchor: RefObject<HTMLElement | null>
  label: string
  width?: number
  align?: 'start' | 'end'
  focusOnOpen?: boolean
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useLayoutEffect(() => {
    close.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return
      close.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      const hadFocus = panel.current?.contains(document.activeElement)
      close.current()
      if (hadFocus) anchor.current?.focus()
    }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    if (focusOnOpen) panel.current?.querySelector<HTMLElement>('[data-autofocus], button, input, [tabindex="0"]')?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, anchor, focusOnOpen])

  if (!open) return null
  return (
    <div ref={panel} className="sw-popover" role="dialog" aria-label={label} data-align={align === 'end' ? undefined : align} style={{ '--popover-w': `${width}px` } as CSSProperties}>
      {children}
    </div>
  )
}
