/** Shared types for the whole app. */

export type CompareMode = 'split' | 'sidebyside' | 'fade' | 'diff' | 'flicker' | 'spyglass'

export const MODE_ORDER: CompareMode[] = [
  'split',
  'sidebyside',
  'fade',
  'diff',
  'flicker',
  'spyglass',
]

export const MODE_LABEL: Record<CompareMode, string> = {
  split: 'Split',
  sidebyside: 'Side by side',
  fade: 'Fade',
  diff: 'Difference',
  flicker: 'Flicker',
  spyglass: 'Spyglass',
}

export const MODE_HINT: Record<CompareMode, string> = {
  split: 'Drag the divider to wipe between the two images',
  sidebyside: 'Two panes sharing one synchronised zoom and pan',
  fade: 'Cross-fade from A to B with the opacity slider',
  diff: 'Highlight pixels that differ, with an adjustable threshold',
  flicker: 'Alternate rapidly between A and B to spot movement',
  spyglass: 'A lens that reveals the other image under your cursor',
}

export type Axis = 'vertical' | 'horizontal'
export type Channel = 'rgb' | 'r' | 'g' | 'b' | 'gray'
export type DiffStyle = 'heat' | 'gray' | 'red'
export type Slot = 'a' | 'b'

export const CHANNEL_LABEL: Record<Channel, string> = {
  rgb: 'RGB',
  r: 'R',
  g: 'G',
  b: 'B',
  gray: 'Gray',
}

export const DIFF_STYLE_LABEL: Record<DiffStyle, string> = {
  heat: 'Heatmap',
  gray: 'Grayscale',
  red: 'Red mask',
}

/** A decoded image plus the original file facts we report in the UI. */
export interface LoadedImage {
  bitmap: ImageBitmap
  /** Natural pixel size as decoded (post-rasterisation for sizeless SVG). */
  width: number
  height: number
  name: string
  /** Bytes of the source file; 0 for generated/sample sources. */
  bytes: number
  type: string
  /** True when this came from a vector source rasterised at a chosen size. */
  vector: boolean
}

/**
 * Images normalised for comparison: `b` is resampled to `a`'s exact dimensions
 * so that every mode can assume a 1:1 pixel correspondence.
 */
export interface PreparedScene {
  a: ImageBitmap
  b: ImageBitmap
  width: number
  height: number
  /** Set when B was resampled, for the "resampled to A" notice. */
  resampledFrom: { width: number; height: number } | null
}

export interface Transform {
  scale: number
  tx: number
  ty: number
}

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DiffStats {
  changed: number
  total: number
  ratio: number
  maxDelta: number
  meanDelta: number
}

export interface DiffSettings {
  threshold: number
  gain: number
  style: DiffStyle
  offsetX: number
  offsetY: number
}

export interface DiffResult {
  bitmap: ImageBitmap
  stats: DiffStats
}

/** Everything the user can change from the UI. Serialisable by design. */
export interface Settings {
  mode: CompareMode
  splitPos: number
  splitAxis: Axis
  sideAxis: Axis
  opacity: number
  diffThreshold: number
  diffGain: number
  diffStyle: DiffStyle
  flickerMs: number
  flickerPlaying: boolean
  lensRadius: number
  lensZoom: number
  offsetX: number
  offsetY: number
  channel: Channel
  showLabels: boolean
  checkerboard: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'split',
  splitPos: 0.5,
  splitAxis: 'vertical',
  sideAxis: 'vertical',
  opacity: 0.5,
  diffThreshold: 8,
  // 1 = a straight mapping of difference magnitude to the colour ramp. Higher
  // values are a gamma that lifts subtle differences; see the diff worker.
  diffGain: 1,
  diffStyle: 'heat',
  flickerMs: 400,
  flickerPlaying: true,
  lensRadius: 130,
  lensZoom: 2,
  offsetX: 0,
  offsetY: 0,
  channel: 'rgb',
  showLabels: true,
  checkerboard: false,
}

/**
 * Mutable render state, deliberately outside React. Pointer handlers mutate this
 * and request a frame, so a pan drag costs zero React renders.
 */
export interface Scene {
  settings: Settings
  transform: Transform
  prepared: PreparedScene | null
  /** Channel-filtered layers, rebuilt only when images or channel change. */
  layers: { a: ImageBitmap; b: ImageBitmap } | null
  layerKey: string
  diff: DiffResult | null
  /** Viewport size in CSS pixels. */
  viewport: Size
  /**
   * Width in CSS px of the right-edge strip covered by the floating panel
   * column. Canvas overlays anchored to the right edge inset by this much so
   * they are not drawn underneath it.
   */
  obstructedRight: number
  dpr: number
  cursor: Point | null
  pointerInside: boolean
  /** Space held: momentarily show B (or A if B is already showing). */
  holdSwap: boolean
  /** Which image the flicker loop is currently showing. */
  flickerShowB: boolean
  /** Set while dragging the split divider, to suppress panning. */
  draggingDivider: boolean
}
