import type { ButtonHTMLAttributes, MouseEvent, Ref } from 'react'
import { Icon, type IconName } from './Icon'
import { Tip, type TipAlign, type TipSide } from './Tooltip'

export type ButtonVariant = 'ghost' | 'solid' | 'outline' | 'soft' | 'primary' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: IconName
  /** accessible name, tooltip text, and the visible label when showLabel is set */
  label: string
  /** key hint shown as a badge in the tooltip and announced through aria-keyshortcuts ("M", "Tab") */
  shortcut?: string
  /** true: always show the label; 'wide': only on wide fine-pointer screens (kit.css .sw-btn--collapsible) */
  showLabel?: boolean | 'wide'
  variant?: ButtonVariant
  size?: ButtonSize
  /** toggle buttons (mute, editor): sets aria-pressed */
  pressed?: boolean
  /** popover triggers: sets aria-expanded + aria-haspopup */
  expanded?: boolean
  /** tooltip text when it should differ from label; false for no tooltip */
  tip?: string | false
  tipAlign?: TipAlign
  tipSide?: TipSide
  ref?: Ref<HTMLButtonElement>
}

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

/**
 * The one button of the HUD. Icon-only by default (with a tooltip carrying the label and shortcut),
 * or icon + label. A click that came from a pointer gives focus straight back to the page, so the
 * world's keys (WASD, Space, Tab for the editor, M, C) keep working after the player clicks a button;
 * keyboard activation (event.detail === 0) keeps focus where it is.
 */
export function IconButton({ icon, label, shortcut, showLabel, variant = 'ghost', size = 'md', pressed, expanded, tip, tipAlign, tipSide, className, onClick, ref, ...rest }: Props) {
  const labelVisible = showLabel === true
  return (
    <button
      ref={ref}
      type="button"
      className={cx(
        'sw-btn',
        variant !== 'ghost' && `sw-btn--${variant}`,
        size !== 'md' && `sw-btn--${size}`,
        !labelVisible && 'sw-btn--icon',
        showLabel === 'wide' && 'sw-btn--collapsible',
        className,
      )}
      aria-label={labelVisible ? undefined : label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-haspopup={expanded === undefined ? undefined : 'dialog'}
      aria-keyshortcuts={shortcut}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        onClick?.(e)
        if (e.detail > 0) e.currentTarget.blur()
      }}
      {...rest}
    >
      <Icon name={icon} />
      {showLabel && <span className="sw-btn__label">{label}</span>}
      {tip !== false && <Tip label={tip ?? label} shortcut={shortcut} align={tipAlign} side={tipSide} />}
    </button>
  )
}
