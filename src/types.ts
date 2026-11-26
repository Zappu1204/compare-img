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

/**
 * How Image A is filtered when it is magnified past its native resolution.
 *
 * Only A needs this choice. It is the low-resolution baseline, so above 1:1 the
 * browser must invent pixels: `pixelated` shows the true source grid for judging
 * what the upscaler had to work from, `smooth` interpolates as other viewers do.
 * B is the sharp reference and is always interpolated smoothly.
 */
export type BaselineFilter = 'smooth' | 'pixelated'

export const BASELINE_FILTER_LABEL: Record<BaselineFilter, string> = {
  smooth: 'Smooth',
  pixelated: 'Pixels',
}

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
 * A pair ready to draw, with **both native buffers intact**.
 *
 * Nothing here is resampled. Alignment comes from mapping each image's own pixel
 * grid onto one shared reference box instead of forcing both onto one grid, which
 * is what lets a 500×500 original and a 4000×4000 upscale be compared with the
 * upscale's real detail still present. See `drawLayer` for the mapping.
 *
 * `width`/`height` are that reference box — A's dimensions. They define what the
 * transform's `scale` means (1.0 = A at 1:1) and therefore what the zoom presets
 * mean; B renders at `scale * (bSize.width / width)`, so a 4× upscale draws at a
 * quarter of the transform scale and lands in the identical screen rect.
 */
export interface PreparedScene {
  a: ImageBitmap
  b: ImageBitmap
  /** The shared reference box every layer is mapped into: A's native size. */
  width: number
  height: number
  /** True native dimensions, for the info panel and per-image render scales. */
  aSize: Size
  bSize: Size
  /** True when the two natives differ, so the UI can explain the mapping. */
  mismatched: boolean
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
  /** Display filter for Image A when magnified past 1:1. */
  baselineFilter: BaselineFilter
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
  baselineFilter: 'smooth',
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
