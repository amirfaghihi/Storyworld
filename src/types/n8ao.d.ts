/**
 * n8ao ships no type declarations. This covers the slice of N8AOPostPass that UltraEffects uses;
 * extend it rather than reaching for `any` if more of the pass is needed.
 */
declare module 'n8ao' {
  import type { Camera, Scene } from 'three'
  import { Pass } from 'postprocessing'

  export interface N8AOConfiguration {
    aoRadius: number
    distanceFalloff: number
    intensity: number
    aoSamples: number
    denoiseSamples: number
    denoiseRadius: number
    halfRes: boolean
    depthAwareUpsampling: boolean
    screenSpaceRadius: boolean
    /** 0 combined, 1 occlusion only, 2 no occlusion, 3 split, 4 split occlusion */
    renderMode: 0 | 1 | 2 | 3 | 4
    transparencyAware: boolean
    gammaCorrection: boolean
  }

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number)
    /** when true, every frame re-scans the scene and latches transparencyAware on first sight */
    autoDetectTransparency: boolean
    /** a Proxy: assigning a field reconfigures the pass */
    configuration: N8AOConfiguration
  }
}
