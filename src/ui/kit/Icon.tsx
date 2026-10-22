import type { ReactNode, SVGProps } from 'react'
import type { WeatherKind } from '@/render/weather'

/**
 * The UI icon set (HUD, panels and the map's controls; the map's filled marker pictograms are separate). 24 x 24, drawn with currentColor strokes (1.75 wide, round caps and joins) so an
 * icon takes the colour of the text around it and reads the same in the day and night tones.
 * Drawn for Storyworld; no icon font, no emoji (emoji render in colour and differ per platform).
 */
const PATHS = {
  map: (
    <>
      <path d="M9 4.5 3.75 6.4v13.1L9 17.6l6 2 5.25-1.9V4.6L15 6.5l-6-2Z" />
      <path d="M9 4.5v13.1M15 6.5v13.1" />
    </>
  ),
  codex: (
    <>
      <path d="M12 6.6C10.2 5.3 7.7 4.6 3.75 4.6v13.1c3.95 0 6.45.7 8.25 2 1.8-1.3 4.3-2 8.25-2V4.6c-3.95 0-6.45.7-8.25 2Z" />
      <path d="M12 6.6v13.1" />
      <path d="M15.5 4.9v4.6l1.4-1 1.4 1V4.7" />
    </>
  ),
  worlds: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.6 10.5h16.8M3.9 14.5h16.2" />
      <path d="M12 3.5c2.3 2.3 3.5 5.1 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.1-3.5-8.5S9.7 5.8 12 3.5Z" />
    </>
  ),
  edit: (
    <>
      <path d="M4.5 19.5 5.6 15 15.3 5.3a2 2 0 0 1 2.85 0l.85.85a2 2 0 0 1 0 2.85L9.3 18.7l-4.8.8Z" />
      <path d="m13.6 7 3.4 3.4" />
    </>
  ),
  door: (
    <>
      <path d="M6 20v-9a6 6 0 0 1 12 0v9" />
      <path d="M3.5 20h17" />
      <path d="M9 20v-8.5a3 3 0 0 1 6 0V20" />
      <circle cx="12" cy="15.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  leave: (
    <>
      <path d="M13.5 4.5H7a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 7 19.5h6.5" />
      <path d="M10.5 12h9.5M16.5 8.5 20 12l-3.5 3.5" />
    </>
  ),
  soundOn: (
    <>
      <path d="M4 9.5h3.3L12 5.6v12.8l-4.7-3.9H4Z" />
      <path d="M15.4 9.2a4 4 0 0 1 0 5.6M17.9 6.7a7.5 7.5 0 0 1 0 10.6" />
    </>
  ),
  soundOff: (
    <>
      <path d="M4 9.5h3.3L12 5.6v12.8l-4.7-3.9H4Z" />
      <path d="m15.5 9.5 5 5M20.5 9.5l-5 5" />
    </>
  ),
  settings: (
    <>
      <path d="M10.16 5.35L10.59 3.11A9 9 0 0 1 13.41 3.11L13.84 5.35A6.9 6.9 0 0 1 15.4 5.99L17.29 4.72A9 9 0 0 1 19.28 6.71L18.01 8.6A6.9 6.9 0 0 1 18.65 10.16L20.89 10.59A9 9 0 0 1 20.89 13.41L18.65 13.84A6.9 6.9 0 0 1 18.01 15.4L19.28 17.29A9 9 0 0 1 17.29 19.28L15.4 18.01A6.9 6.9 0 0 1 13.84 18.65L13.41 20.89A9 9 0 0 1 10.59 20.89L10.16 18.65A6.9 6.9 0 0 1 8.6 18.01L6.71 19.28A9 9 0 0 1 4.72 17.29L5.99 15.4A6.9 6.9 0 0 1 5.35 13.84L3.11 13.41A9 9 0 0 1 3.11 10.59L5.35 10.16A6.9 6.9 0 0 1 5.99 8.6L4.72 6.71A9 9 0 0 1 6.71 4.72L8.6 5.99A6.9 6.9 0 0 1 10.16 5.35Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  chevronRight: (
    <>
      <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9.5M17.5 7H20M4 17h2.5M10.5 17H20" />
      <circle cx="15.5" cy="7" r="2" />
      <circle cx="8.5" cy="17" r="2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.75v2M12 19.25v2M5.46 5.46l1.41 1.41M17.13 17.13l1.41 1.41M2.75 12h2M19.25 12h2M5.46 18.54l1.41-1.41M17.13 6.87l1.41-1.41" />
    </>
  ),
  moon: (
    <>
      <path d="M19.5 14.6A7.9 7.9 0 0 1 9.4 4.5a7.9 7.9 0 1 0 10.1 10.1Z" />
    </>
  ),
  dawn: (
    <>
      <path d="M3 19h18M7.5 19a4.5 4.5 0 0 1 9 0M12 4v6.5M9.6 6.4 12 4l2.4 2.4M4.6 12.4l1.4 1.4M19.4 12.4 18 13.8" />
    </>
  ),
  dusk: (
    <>
      <path d="M3 19h18M7.5 19a4.5 4.5 0 0 1 9 0M12 4v6.5M9.6 8.1l2.4 2.4 2.4-2.4M4.6 12.4l1.4 1.4M19.4 12.4 18 13.8" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  play: (
    <>
      <path d="M8 5.8v12.4l9.8-6.2Z" />
    </>
  ),
  pause: (
    <>
      <path d="M9 6v12M15 6v12" />
    </>
  ),
  close: (
    <>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </>
  ),
  chevronDown: (
    <>
      <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
    </>
  ),
  arrowRight: (
    <>
      <path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" />
    </>
  ),
  external: (
    <>
      <path d="M13.5 4.5h6v6M19.5 4.5 11 13" />
      <path d="M17.5 14v4.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1H10" />
    </>
  ),
  auto: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.8 4.2v3.6h-3.6" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.5" />
      <circle cx="12" cy="16.9" r=".6" fill="currentColor" />
    </>
  ),
  run: (
    <>
      <path d="M5.5 6.5 11 12l-5.5 5.5M12.5 6.5 18 12l-5.5 5.5" />
    </>
  ),
  quality: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="m3.5 16.5 5-5 4 4 2.5-2.5 5.5 5.5" />
      <circle cx="15.5" cy="9.5" r="1.5" />
    </>
  ),
  clear: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.75v2M12 19.25v2M5.46 5.46l1.41 1.41M17.13 17.13l1.41 1.41M2.75 12h2M19.25 12h2M5.46 18.54l1.41-1.41M17.13 6.87l1.41-1.41" />
    </>
  ),
  cloudy: (
    <>
      <path d="M7 18.5h10a4 4 0 0 0 .5-7.97A5.5 5.5 0 0 0 6.6 10.05 4 4 0 0 0 7 18.5Z" />
    </>
  ),
  rain: (
    <>
      <path d="M7.3 14.5h9.4a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.2 7.1a3.7 3.7 0 0 0 .1 7.4Z" />
      <path d="m8.5 17.5-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5" />
    </>
  ),
  storm: (
    <>
      <path d="M7.3 14.5h9.4a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.2 7.1a3.7 3.7 0 0 0 .1 7.4Z" />
      <path d="m12.8 16-2 3.2h2.6l-1.8 3" />
    </>
  ),
  snow: (
    <>
      <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />
      <path d="m9.8 4.2 2.2 2 2.2-2M9.8 19.8l2.2-2 2.2 2" />
    </>
  ),
  mist: (
    <>
      <path d="M4 8h12.5M7.5 12H20M4 16h11M17.5 16H20" />
    </>
  ),
  ash: (
    <>
      <path d="M3 20 9 10.5h6L21 20" />
      <path d="m9 10.5 1.6 1.8 1.4-1.3 1.4 1.3 1.6-1.8" />
      <circle cx="8.5" cy="5" r=".9" fill="currentColor" />
      <circle cx="12.5" cy="3.5" r=".9" fill="currentColor" />
      <circle cx="15.5" cy="6" r=".9" fill="currentColor" />
    </>
  ),
  ring: (
    <>
      <ellipse cx="12" cy="13.5" rx="7.75" ry="5.75" />
      <ellipse cx="12" cy="13" rx="4.75" ry="3" />
      <path d="M18.5 3.5v3.5M16.75 5.25h3.5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M5 7.6c2 .2 3 1.4 2.6 3.2-.3 1.3 1 2.1 2.3 2 1.6-.1 2 1.3 1.3 2.8-.5 1.1 0 2.5 1 3.2M14.5 4c-.4 1.3.1 2.6 1.5 2.9 1.5.3 2.2 1.6 1.6 3-.5 1.2.3 2.4 1.7 2.3" />
    </>
  ),
  // The map's controls. Chevrons and +/- share the 5.5-unit arms of close and chevronDown so a joined
  // zoom group reads as one set.
  search: (
    <>
      <circle cx="10.75" cy="10.75" r="6.25" />
      <path d="m15.3 15.3 4.7 4.7" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5.5v13M5.5 12h13" />
    </>
  ),
  minus: (
    <>
      <path d="M5.5 12h13" />
    </>
  ),
  // "Where am I": a crosshair around a dot, the convention people know from phone maps.
  locate: (
    <>
      <circle cx="12" cy="12" r="6" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      <circle cx="12" cy="12" r="1.75" fill="currentColor" stroke="none" />
    </>
  ),
  // "Show everything": four corners framing a block, so it does not read as fullscreen.
  fit: (
    <>
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
      <rect x="8.75" y="8.75" width="6.5" height="6.5" rx="1" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3.75 3.5 8.25 12 12.75l8.5-4.5L12 3.75Z" />
      <path d="m3.5 12.25 8.5 4.5 8.5-4.5M3.5 16.25l8.5 4.5 8.5-4.5" />
    </>
  ),
  // A plain needle in a ring: the map's own compass is a geometric star, never a copied rose.
  compass: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m15.75 8.25-2.1 5.4-5.4 2.1 2.1-5.4 5.4-2.1Z" />
    </>
  ),
  chevronLeft: (
    <>
      <path d="m14.5 6.5-5.5 5.5 5.5 5.5" />
    </>
  ),
  chevronUp: (
    <>
      <path d="m6.5 14.5 5.5-5.5 5.5 5.5" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS

export function Icon({ name, className, ...rest }: { name: IconName } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      className={className ? `sw-icon ${className}` : 'sw-icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  )
}

/** Weather kind to icon. Checked against WeatherKind, so a new kind fails to compile until it has one. */
export const WEATHER_ICON = {
  clear: 'clear',
  cloudy: 'cloudy',
  rain: 'rain',
  storm: 'storm',
  snow: 'snow',
  mist: 'mist',
  ash: 'ash',
} as const satisfies Record<WeatherKind, IconName>
