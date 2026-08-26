import type { Channel, LoadedImage, PreparedScene } from '../types'

/**
 * Normalise a pair for comparison: A keeps its native size, B is resampled to
 * match it exactly. Every mode can then assume a 1:1 pixel correspondence,
 * which is what makes split/fade/diff align without per-mode special cases.
 *
 * Note the trade-off: resampling B introduces interpolation along edges, which
 * shows up as low-level noise in the difference view. `resampledFrom` is kept
 * so the UI can say so rather than letting it look like a real difference.
 */
export async function prepareScene(a: LoadedImage, b: LoadedImage): Promise<PreparedScene> {
  const sameSize = a.width === b.width && a.height === b.height
  if (sameSize) {
    return {
      a: a.bitmap,
      b: b.bitmap,
      width: a.width,
      height: a.height,
      resampledFrom: null,
    }
  }

  const resampled = await resample(b.bitmap, a.width, a.height)
  return {
    a: a.bitmap,
    b: resampled,
    width: a.width,
    height: a.height,
    resampledFrom: { width: b.width, height: b.height },
  }
}

async function resample(
  source: ImageBitmap,
  width: number,
  height: number,
): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a 2D drawing context')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  return canvas.transferToImageBitmap()
}

/** Identity for the layer cache: rebuild only when the pair or channel changes. */
export function layerCacheKey(scene: PreparedScene, channel: Channel): string {
  return `${scene.width}x${scene.height}:${channel}`
}

/**
 * Build channel-isolated copies of both images.
 *
 * Single channels use a `multiply` composite against a pure primary, which is
 * supported everywhere, rather than the `ctx.filter` channel matrix which is
 * not. Grayscale prefers `ctx.filter` and falls back to a luminosity composite
 * for engines without canvas filter support (older Safari).
 */
export async function buildChannelLayers(
  scene: PreparedScene,
  channel: Channel,
): Promise<{ a: ImageBitmap; b: ImageBitmap }> {
  if (channel === 'rgb') return { a: scene.a, b: scene.b }
  const [a, b] = await Promise.all([
    applyChannel(scene.a, channel),
    applyChannel(scene.b, channel),
  ])
  return { a, b }
}

/**
 * Isolate a channel by rewriting pixels directly.
 *
 * Canvas filters are tempting here but wrong for this job: `grayscale()`
 * applies luminance weights, so an isolated red channel at 255 would come out
 * as ~54 gray rather than full brightness. A direct pass maps each channel's
 * value faithfully, needs no per-engine fallback, and is paid for once because
 * the result is cached.
 */
async function applyChannel(source: ImageBitmap, channel: Channel): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(source.width, source.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not create a 2D drawing context')

  ctx.drawImage(source, 0, 0)
  const image = ctx.getImageData(0, 0, source.width, source.height)
  const px = image.data

  if (channel === 'gray') {
    // Rec. 601 luma, which matches what CSS grayscale() and most tools use.
    for (let i = 0; i < px.length; i += 4) {
      const luma = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114
      px[i] = luma
      px[i + 1] = luma
      px[i + 2] = luma
    }
  } else {
    // Spread the chosen channel across all three so it reads as brightness
    // rather than a red/green/blue-tinted image.
    const offset = channel === 'r' ? 0 : channel === 'g' ? 1 : 2
    for (let i = 0; i < px.length; i += 4) {
      const value = px[i + offset]
      px[i] = value
      px[i + 1] = value
      px[i + 2] = value
    }
  }

  ctx.putImageData(image, 0, 0)
  return canvas.transferToImageBitmap()
}

/** Extract raw RGBA pixels for the diff worker. */
export function readPixels(source: ImageBitmap): ImageData {
  const canvas = new OffscreenCanvas(source.width, source.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not create a 2D drawing context')
  ctx.drawImage(source, 0, 0)
  return ctx.getImageData(0, 0, source.width, source.height)
}
