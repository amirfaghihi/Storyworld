export { buildHero, PALETTES, COL, DIM, CLOAK, type HeroRig, type HeroMaterials, type PaletteName } from './heroParts'
export { poseHero, createPoseState, type HeroPoseInput, type HeroPoseState } from './heroPose'
export {
  clothMaterial,
  clothDepthMaterial,
  heroMaterial,
  createClothUniforms,
  deformClothCPU,
  sampleDrapeGround,
  CLOTH_ATTR,
  DRAPE_CLEAR,
  DRAPE_RADII,
  ROBE,
  type ClothUniforms,
} from './cloak'
