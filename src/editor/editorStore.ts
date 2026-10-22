import { create } from 'zustand'

export type Tool = 'raise' | 'lower' | 'smooth' | 'flatten' | 'paint' | 'landmark'

export interface EditorState {
  enabled: boolean
  tool: Tool
  radius: number // metres
  strength: number // 0..1
  biome: number // biome index for the paint tool
  selectedLandmark: string | null
  /** bumps whenever landmarks change so React views re-read the mutated meta */
  revision: number
  dirty: boolean
  status: string | null
  setEnabled: (v: boolean) => void
  setTool: (t: Tool) => void
  setRadius: (r: number) => void
  setStrength: (s: number) => void
  setBiome: (b: number) => void
  selectLandmark: (id: string | null) => void
  bump: () => void
  setDirty: (v: boolean) => void
  setStatus: (s: string | null) => void
}

export const useEditorStore = create<EditorState>()((set) => ({
  enabled: false,
  tool: 'raise',
  radius: 18,
  strength: 0.5,
  biome: 2,
  selectedLandmark: null,
  revision: 0,
  dirty: false,
  status: null,
  setEnabled: (enabled) => set({ enabled }),
  setTool: (tool) => set({ tool }),
  setRadius: (radius) => set({ radius }),
  setStrength: (strength) => set({ strength }),
  setBiome: (biome) => set({ biome }),
  selectLandmark: (selectedLandmark) => set({ selectedLandmark }),
  bump: () => set((s) => ({ revision: s.revision + 1 })),
  setDirty: (dirty) => set({ dirty }),
  setStatus: (status) => set({ status }),
}))
