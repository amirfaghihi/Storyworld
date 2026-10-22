/**
 * Shapes the props register for the player to walk around and over. Kept apart from the solver
 * (collision.ts) so builders can describe what they made without pulling in the controller.
 *
 * Solids are 2-D footprints with an optional height band: the player is blocked only while the
 * feet are below `top` (so low walls can be stepped onto from a deck) and above `bottom` (so an
 * arch or a bridge parapet can be walked under). Decks are surfaces to stand on.
 */

/** Registry layer: props come and go with a place's dressing, trees with its vegetation tier. */
export type ColliderLayer = 'props' | 'trees'

export type SolidCircle = {
  kind: 'circle'
  x: number
  z: number
  r: number
  /** world y of the top; walkable above it */
  top?: number
  /** world y of the underside; open below it */
  bottom?: number
  layer?: ColliderLayer
}

/** A rotated box: half extents hw along local x and hd along local z, `rot` as in propUtil.at. */
export type SolidBox = {
  kind: 'box'
  x: number
  z: number
  hw: number
  hd: number
  rot: number
  top?: number
  bottom?: number
  layer?: ColliderLayer
}

/** A walkable surface above the terrain (bridge deck, quay): height runs yA -> yB along local x with an arch. */
export type Deck = {
  kind: 'deck'
  x: number
  z: number
  hw: number
  hd: number
  rot: number
  yA: number
  yB: number
  arc: number
  /** thickness below the walking surface, for walking under it */
  thick?: number
}

export type Collider = SolidCircle | SolidBox | Deck
