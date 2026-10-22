import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
const visibleFocusables = (el: Element) => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => !n.hasAttribute('disabled') && n.getClientRects().length > 0)
/** another open modal dialog (the map), which owns focus while it is up */
const otherModal = (self: Element) => [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].find((d) => d !== self && !self.contains(d))

/**
 * Modal focus for the Codex and the World picker: focus the dialog's first control when it opens, keep
 * Tab inside it, and hand focus back to whatever had it (usually a toolbar button reached by keyboard)
 * when it closes. A toolbar button clicked with the mouse has already given focus back to the page, so
 * closing then leaves focus on the page and the world's keys keep working.
 * Closing can hand over to another modal in the same update (the Codex's "Show on map" closes the Codex
 * and opens the map). Focus must then end up inside that dialog, never on the toolbar button behind it.
 */
export function useDialogFocus(open: boolean, panel: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = panel.current
    if (!open || !el) return
    const back = document.activeElement as HTMLElement | null
    const focusables = () => visibleFocusables(el)
    focusables()[0]?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const f = focusables()
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
    // on window, so a Tab pressed after a click on the dialog's padding (focus on <body>) is caught too
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const next = otherModal(el)
      // the next dialog already took focus: leave it there
      if (next?.contains(document.activeElement)) return
      // Give focus back to the opener even when another dialog is opening: React runs this cleanup before
      // the new dialog's mount effects, and the map remembers whatever has focus when it opens as the
      // place to return to when it closes, then moves focus into itself.
      if (back && back !== document.body && document.contains(back)) back.focus({ preventScroll: true })
      // If that dialog does not pull focus in by the next frame, put it there, so focus is never left on the
      // page behind a modal. A text field is skipped so a phone does not raise its keyboard.
      if (next)
        requestAnimationFrame(() => {
          const d = otherModal(el)
          if (!d || d.contains(document.activeElement)) return
          const target = d.querySelector<HTMLElement>('[data-autofocus]') ?? visibleFocusables(d).find((n) => !(n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement))
          target?.focus({ preventScroll: true })
        })
    }
  }, [open, panel])
}
