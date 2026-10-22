// Mirrors BIOME in scripts/build-world.ts (blue channel of terrain.png)
export const BIOME = {
  water: 0,
  sand: 1,
  grass: 2,
  forest: 3,
  rock: 4,
  snow: 5,
  ash: 6,
  marsh: 7,
  road: 8,
  riverbed: 9,
} as const
export type BiomeId = (typeof BIOME)[keyof typeof BIOME]

export const BIOME_NAMES: Record<number, string> = Object.fromEntries(Object.entries(BIOME).map(([k, v]) => [v, k]))
