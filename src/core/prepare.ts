import type { Channel, LoadedImage, PreparedScene } from '../types'

/**
 * Pair two images for comparison **without resampling either one**.
 *
 * This is the resolution-independent path. Both native buffers are kept exactly
 * as decoded; alignment comes from mapping each image's pixel grid onto one
 * shared reference box at draw time (see `drawLayer`), not from forcing both onto
 * a single grid.
 *
 * The earlier design resampled B into A's dimensions here. That made every mode
 * trivially aligned, but at a cost that defeats the tool's purpose: comparing a
 * 500×500 original against a 2000×2000 upscale destroyed the upscale's detail
 * before it could ever be seen. Measured directly — a 2px checker in B, which
 * cannot exist at 500×500, arrived on screen as flat grey. The thing the user is
 * trying to evaluate was the thing being thrown away.
 *
 * Preparation is now pure bookkeeping, so it cannot fail and costs nothing.
 */
export async function prepareScene(a: LoadedImage, b: LoadedImage): Promise<PreparedScene> {
  return {
    a: a.bitmap,
    b: b.bitmap,
    // The reference box is A's size: it defines what transform scale 1.0 means,
    // so "100%" keeps meaning "A at 1:1" and the zoom presets are unchanged.
    width: a.width,
    height: a.height,
    aSize: { width: a.width, height: a.height },
    bSize: { width: b.width, height: b.height },
    mismatched: a.width !== b.width || a.height !== b.height,
  }
}

/**
 * Resample a bitmap to an exact size.
 *
 * Not used for display — the display path keeps native buffers. This exists for
 * the difference engine, which cannot compare two different pixel grids and so
 * needs one of them projected onto the other. See `DiffEngine.setScene`.
 */
export async function resample(
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

/**
 * Identity for the layer cache. Both native sizes take part: a pair can change
 * to one with the same reference box but a different B, and the cached layers
 * would otherwise be reused for the wrong image.
 */
export function layerCacheKey(scene: PreparedScene, channel: Channel): string {
  return `${scene.aSize.width}x${scene.aSize.height}:${scene.bSize.width}x${scene.bSize.height}:${channel}`
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
