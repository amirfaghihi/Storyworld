/**
 * Place-scale kinds that live in their own files (first written for Edoras and Rivendell). Each file exports
 * one builder under the kind's name; PLACE_KINDS spreads this table in. These files import from
 * propUtil and placeUtil, never from placeKinds.ts, so there is no import cycle.
 */
import type { Part } from '@/render/mergeColoured'
import type { PropContext } from '../propUtil'
import { greatHall } from './greatHall'
import { longhouse } from './longhouse'
import { stair } from './stair'
import { channel } from './channel'
import { springBasin } from './springBasin'
import { banner } from './banner'
import { flowerPatch } from './flowerPatch'
import { wing } from './wing'
import { colonnade } from './colonnade'
import { hearth } from './hearth'
import { waterfall } from './waterfall'

export const FILE_KINDS: Record<string, (c: PropContext, out: Part[]) => void> = {
  greatHall,
  longhouse,
  stair,
  channel,
  springBasin,
  banner,
  flowerPatch,
  wing,
  colonnade,
  hearth,
  waterfall,
}
