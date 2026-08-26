/// <reference lib="webworker" />
import type { DiffSettings, DiffStats } from '../../types'

/**
 * Pixel-difference worker.
 *
 * Both images' pixels are sent once via `init`; every later `compute` reuses
 * them. That keeps threshold-slider dragging responsive on large images, since
 * a recompute costs one pass over memory already resident in the worker and
 * never touches the main thread.
 */

type InitMessage = {
  type: 'init'
  a: ArrayBuffer
  b: ArrayBuffer
  width: number
  height: number
}

type ComputeMessage = {
  type: 'compute'
  id: number
  settings: DiffSettings
}

type Incoming = InitMessage | ComputeMessage

let pixelsA: Uint8ClampedArray | null = null
let pixelsB: Uint8ClampedArray | null = null
let width = 0
let height = 0

self.onmessage = (event: MessageEvent<Incoming>) => {
  const msg = event.data
  if (msg.type === 'init') {
    pixelsA = new Uint8ClampedArray(msg.a)
    pixelsB = new Uint8ClampedArray(msg.b)
    width = msg.width
    height = msg.height
    self.postMessage({ type: 'ready' })
    return
  }
  if (msg.type === 'compute') {
    if (!pixelsA || !pixelsB) return
    void compute(msg.id, msg.settings)
  }
}

async function compute(id: number, settings: DiffSettings): Promise<void> {
  const a = pixelsA!
  const b = pixelsB!
  const { threshold, gain, style, offsetX, offsetY } = settings

  const out = new Uint8ClampedArray(width * height * 4)
  const stats: DiffStats = {
    changed: 0,
    total: width * height,
    ratio: 0,
    maxDelta: 0,
    meanDelta: 0,
  }
  let deltaSum = 0

  const dx = Math.round(offsetX)
  const dy = Math.round(offsetY)

  for (let y = 0; y < height; y++) {
    // B is sampled shifted by the calibration offset; out-of-bounds rows are
    // left transparent rather than clamped, so misalignment stays visible.
    const sy = y - dy
    const rowInside = sy >= 0 && sy < height
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const sx = x - dx
      if (!rowInside || sx < 0 || sx >= width) {
        out[i + 3] = 0
        continue
      }
      const j = (sy * width + sx) * 4

      const dr = Math.abs(a[i] - b[j])
      const dg = Math.abs(a[i + 1] - b[j + 1])
      const db = Math.abs(a[i + 2] - b[j + 2])
      const da = Math.abs(a[i + 3] - b[j + 3])

      // Max-channel distance: a shift confined to one channel stays as visible
      // as a shift spread across all three, which an average would dilute.
      const delta = Math.max(dr, dg, db, da)
      if (delta > stats.maxDelta) stats.maxDelta = delta

      if (delta <= threshold) {
        writeUnchanged(out, i, a, style)
        continue
      }

      stats.changed++
      deltaSum += delta
      // Rescale so `threshold` maps to 0 and the full range still reaches 1;
      // without this, raising the threshold would also dim what survives it.
      const span = Math.max(1, 255 - threshold)
      const normalised = (delta - threshold) / span
      // Gain is a gamma, not a multiplier. A multiplier clips: at 4x every
      // difference above a quarter of the range lands on 1.0, so the ramp
      // collapses to its top colour and magnitude stops being readable. A gamma
      // lifts faint differences while keeping the mapping strictly increasing,
      // so the whole ramp stays in use and only a true 255 delta reads as max.
      const amount = gain === 1 ? normalised : Math.pow(normalised, 1 / gain)
      writeChanged(out, i, amount, style)
    }
  }

  stats.ratio = stats.total > 0 ? stats.changed / stats.total : 0
  stats.meanDelta = stats.changed > 0 ? deltaSum / stats.changed : 0

  const bitmap = await toBitmap(out)
  self.postMessage({ type: 'result', id, bitmap, stats }, { transfer: [bitmap] })
}

function writeUnchanged(
  out: Uint8ClampedArray,
  i: number,
  a: Uint8ClampedArray,
  style: DiffSettings['style'],
): void {
  if (style === 'red') {
    // Red mask keeps a dimmed original underneath for context.
    const luma = (a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114) * 0.35
    out[i] = luma
    out[i + 1] = luma
    out[i + 2] = luma
    out[i + 3] = 255
    return
  }
  // Heatmap and grayscale both use black for "identical".
  out[i] = 0
  out[i + 1] = 0
  out[i + 2] = 0
  out[i + 3] = 255
}

function writeChanged(
  out: Uint8ClampedArray,
  i: number,
  amount: number,
  style: DiffSettings['style'],
): void {
  if (style === 'gray') {
    const v = amount * 255
    out[i] = v
    out[i + 1] = v
    out[i + 2] = v
    out[i + 3] = 255
    return
  }
  if (style === 'red') {
    out[i] = 255
    out[i + 1] = 40 * (1 - amount)
    out[i + 2] = 40 * (1 - amount)
    out[i + 3] = 255
    return
  }
  const [r, g, bl] = heat(amount)
  out[i] = r
  out[i + 1] = g
  out[i + 2] = bl
  out[i + 3] = 255
}

/**
 * Blue -> cyan -> green -> yellow -> red ramp. Ordered by luminance as well as
 * hue so magnitude still reads correctly in grayscale, or to a viewer with
 * limited colour vision.
 */
function heat(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t))
  if (x < 0.25) {
    const k = x / 0.25
    return [0, Math.round(80 + 175 * k), 255]
  }
  if (x < 0.5) {
    const k = (x - 0.25) / 0.25
    return [0, 255, Math.round(255 * (1 - k))]
  }
  if (x < 0.75) {
    const k = (x - 0.5) / 0.25
    return [Math.round(255 * k), 255, 0]
  }
  const k = (x - 0.75) / 0.25
  return [255, Math.round(255 * (1 - k * 0.85)), 0]
}

// The explicit ArrayBuffer type argument matters: the default ArrayBufferLike
// includes SharedArrayBuffer, which ImageData does not accept.
async function toBitmap(pixels: Uint8ClampedArray<ArrayBuffer>): Promise<ImageBitmap> {
  const data = new ImageData(pixels, width, height)
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(data, 0, 0)
  return canvas.transferToImageBitmap()
}
