/**
 * Cached downscaled copies ("mips") of the layer bitmaps.
 *
 * Why this exists: `drawImage` with `imageSmoothingQuality = 'high'` resamples
 * the *whole* source every call. Measured on a 4000×3000 bitmap drawn at fit
 * scale (~0.28), that is ~24ms per draw — already over the 16.7ms frame budget,
 * and split mode issues two draws per frame. Dropping to `'low'` costs ~6ms but
 * visibly degrades the downscale, which is the wrong trade for a tool whose
 * whole purpose is judging image differences.
 *
 * Instead, resample once into a bitmap near the size actually needed and draw
 * that. The same measurement puts a 1:1 draw of the pre-scaled bitmap at
 * ~0.02ms. Quality is *better* than a per-frame `'high'` downscale, because the
 * mip chain halves repeatedly instead of doing one huge reduction in a single
 * step.
 *
 * Mips are only used when zoomed out far enough that one is genuinely smaller
 * than the requested size; at or above 1:1 the original bitmap is drawn directly
 * so pixel inspection always shows real pixels.
 */

/**
 * Below this scale a mip is worth using; above it, draw the source.
 *
 * This is a short-circuit, not the safety mechanism. The level-selection rule in
 * `pickMip` already refuses any level smaller than the target width, so at 1:1
 * and above every level is too small and the source is returned regardless.
 * Verified by mutation: raising this to 8 changes nothing observable. Kept
 * because it states the intent and skips the loop in the common zoomed-in case.
 */
const MIP_THRESHOLD = 0.7
/** Stop halving here — smaller than any realistic viewport. */
const MIN_MIP_EDGE = 64

export interface MipChain {
  /** Progressively halved copies, largest first. Excludes the original. */
  levels: ImageBitmap[]
  /** The bitmap these were built from, for cache invalidation. */
  source: ImageBitmap
}

/**
 * Build halved copies of a bitmap down to `MIN_MIP_EDGE`.
 *
 * Each level is produced from the level above rather than from the original, so
 * every step is a 2:1 reduction — the case browsers resample well and cheaply.
 */
export async function buildMipChain(source: ImageBitmap): Promise<MipChain> {
  const levels: ImageBitmap[] = []
  let width = source.width
  let height = source.height
  let previous: ImageBitmap = source

  while (width > MIN_MIP_EDGE * 2 && height > MIN_MIP_EDGE * 2) {
    width = Math.max(1, Math.floor(width / 2))
    height = Math.max(1, Math.floor(height / 2))
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) break
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(previous, 0, 0, width, height)
    const level = canvas.transferToImageBitmap()
    levels.push(level)
    previous = level
    // A dozen levels covers any image a browser can decode; the guard is only
    // here so a pathological input cannot spin.
    if (levels.length > 16) break
  }

  return { levels, source }
}

export function closeMipChain(chain: MipChain | null): void {
  if (!chain) return
  for (const level of chain.levels) level.close()
}

/**
 * Pick the bitmap to draw for a given transform, plus the scale to draw it at.
 *
 * The returned scale is relative to the chosen bitmap, so callers multiply the
 * bitmap's own dimensions by it and get the same on-screen rect either way.
 */
export function pickMip(
  chain: MipChain | null,
  bitmap: ImageBitmap,
  scale: number,
): { bitmap: ImageBitmap; scale: number } {
  if (!chain || chain.source !== bitmap || scale >= MIP_THRESHOLD) {
    return { bitmap, scale }
  }
  // The smallest level that is still at least as large as the target size, so
  // the final draw is a mild downscale rather than an upscale of a too-small mip.
  const targetWidth = bitmap.width * scale
  let chosen: ImageBitmap = bitmap
  for (const level of chain.levels) {
    if (level.width < targetWidth) break
    chosen = level
  }
  if (chosen === bitmap) return { bitmap, scale }
  return { bitmap: chosen, scale: (bitmap.width * scale) / chosen.width }
}
