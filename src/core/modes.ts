import type { Point, Rect, Scene, Size, Transform } from '../types'
import { pickMip, type MipChain } from './mip'
import { fitToViewport } from './transform'

/**
 * Drawing primitives and the six mode renderers.
 *
 * Every mode draws into the same context under the same transform, so
 * "synchronised zoom and pan" is structural rather than a feature that has to
 * be kept in step. A mode's only job is to decide which layer goes where.
 */

const LABEL_FONT = '600 12px ui-sans-serif, system-ui, -apple-system, sans-serif'
const DIVIDER_WIDTH = 1.5
const CHECKER_SIZE = 12

export interface DrawContext {
  ctx: CanvasRenderingContext2D
  scene: Scene
  /** Layer A after channel isolation; falls back to the prepared bitmap. */
  layerA: ImageBitmap
  layerB: ImageBitmap
  viewport: Size
  /** True while rendering for export, so we can skip cursor-driven overlays. */
  forExport: boolean
}

/**
 * Downscaled copies of the bitmaps currently being drawn.
 *
 * A registry keyed by the bitmap itself, rather than a parameter threaded
 * through every renderer: a mip is a pure rendering optimisation that must not
 * influence what any mode decides to draw, and every draw already goes through
 * `drawLayer`. Keyed weakly so a chain cannot outlive its source bitmap.
 */
const mips = new WeakMap<ImageBitmap, MipChain>()

export function registerMip(chain: MipChain): void {
  mips.set(chain.source, chain)
}

export function unregisterMip(chain: MipChain | null): void {
  if (chain) mips.delete(chain.source)
}

/** Draw a bitmap under a transform, optionally shifted in image space. */
export function drawLayer(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  t: Transform,
  offsetX = 0,
  offsetY = 0,
): void {
  // When zoomed out, draw a pre-downscaled copy instead of asking the browser to
  // resample the full-resolution bitmap every frame. Measured on a 4000x3000
  // image at fit scale that is the difference between ~24ms and ~0.02ms per draw.
  const mip = pickMip(mips.get(bitmap) ?? null, bitmap, t.scale)

  // Nearest-neighbour above 1:1 so pixel inspection shows real pixels rather
  // than interpolation; smooth below it to keep downscaled previews clean.
  ctx.imageSmoothingEnabled = t.scale < 1
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    mip.bitmap,
    // The offset is in *source* image space, so it scales by the transform's
    // scale — not the mip's, which is relative to a smaller bitmap.
    t.tx + offsetX * t.scale,
    t.ty + offsetY * t.scale,
    mip.bitmap.width * mip.scale,
    mip.bitmap.height * mip.scale,
  )
}

export function withClip(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  draw: () => void,
): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x, rect.y, rect.width, rect.height)
  ctx.clip()
  draw()
  ctx.restore()
}

/** Transparency checkerboard, drawn only inside the image's screen rect. */
export function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x, rect.y, rect.width, rect.height)
  ctx.clip()
  ctx.fillStyle = '#2a2a2a'
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  ctx.fillStyle = '#343434'
  const startX = Math.floor(rect.x / CHECKER_SIZE) * CHECKER_SIZE
  const startY = Math.floor(rect.y / CHECKER_SIZE) * CHECKER_SIZE
  for (let y = startY; y < rect.y + rect.height; y += CHECKER_SIZE) {
    for (let x = startX; x < rect.x + rect.width; x += CHECKER_SIZE) {
      const odd = ((x / CHECKER_SIZE) & 1) ^ ((y / CHECKER_SIZE) & 1)
      if (odd) ctx.fillRect(x, y, CHECKER_SIZE, CHECKER_SIZE)
    }
  }
  ctx.restore()
}

export function imageScreenRect(t: Transform, size: Size): Rect {
  return {
    x: t.tx,
    y: t.ty,
    width: size.width * t.scale,
    height: size.height * t.scale,
  }
}

/** A pill label. `align` positions it relative to the given anchor point. */
export function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: 'left' | 'right' | 'centre' = 'left',
): void {
  ctx.save()
  ctx.font = LABEL_FONT
  ctx.textBaseline = 'middle'
  const padX = 8
  const height = 22
  const width = ctx.measureText(text).width + padX * 2
  let left = x
  if (align === 'right') left = x - width
  if (align === 'centre') left = x - width / 2

  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)'
  roundRect(ctx, left, y - height / 2, width, height, 4)
  ctx.fill()
  ctx.fillStyle = '#ededed'
  ctx.fillText(text, left + padX, y + 0.5)
  ctx.restore()
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// ---------------------------------------------------------------------------
// Mode 1 — Split slider
// ---------------------------------------------------------------------------

export function renderSplit(dc: DrawContext): void {
  const { ctx, scene, layerA, layerB, viewport } = dc
  const { splitPos, splitAxis, showLabels, offsetX, offsetY } = scene.settings
  const vertical = splitAxis === 'vertical'
  const cut = vertical ? viewport.width * splitPos : viewport.height * splitPos

  const first = vertical
    ? { x: 0, y: 0, width: cut, height: viewport.height }
    : { x: 0, y: 0, width: viewport.width, height: cut }
  const second = vertical
    ? { x: cut, y: 0, width: viewport.width - cut, height: viewport.height }
    : { x: 0, y: cut, width: viewport.width, height: viewport.height - cut }

  // Space-hold swaps which side shows which image.
  const [near, far] = scene.holdSwap ? [layerB, layerA] : [layerA, layerB]
  const [nearOff, farOff] = scene.holdSwap
    ? [{ x: offsetX, y: offsetY }, { x: 0, y: 0 }]
    : [{ x: 0, y: 0 }, { x: offsetX, y: offsetY }]

  withClip(ctx, first, () => drawLayer(ctx, near, scene.transform, nearOff.x, nearOff.y))
  withClip(ctx, second, () => drawLayer(ctx, far, scene.transform, farOff.x, farOff.y))

  // The divider is drawn on the canvas, not in the DOM, so exports match.
  ctx.save()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.lineWidth = DIVIDER_WIDTH
  ctx.beginPath()
  if (vertical) {
    ctx.moveTo(cut, 0)
    ctx.lineTo(cut, viewport.height)
  } else {
    ctx.moveTo(0, cut)
    ctx.lineTo(viewport.width, cut)
  }
  ctx.stroke()
  drawGrip(ctx, vertical, cut, viewport)
  ctx.restore()

  if (showLabels) {
    const labelA = scene.holdSwap ? 'After' : 'Before'
    const labelB = scene.holdSwap ? 'Before' : 'After'
    if (vertical) {
      drawLabel(ctx, labelA, 14, 22)
      drawLabel(ctx, labelB, rightEdge(dc), 22, 'right')
    } else {
      drawLabel(ctx, labelA, 14, 22)
      drawLabel(ctx, labelB, 14, viewport.height - 22)
    }
  }
}

/**
 * X coordinate for right-anchored overlays.
 *
 * The floating control panel is a DOM element over the canvas, so anything
 * drawn at the true right edge is simply hidden behind it. Inset by whatever
 * the panel column occupies — except when exporting, where the PNG stands alone
 * and the full width is visible.
 */
function rightEdge(dc: DrawContext): number {
  const inset = dc.forExport ? 0 : dc.scene.obstructedRight
  return dc.viewport.width - 14 - inset
}

/** Round grip on the divider, echoing the DOM drag handle's position. */
function drawGrip(
  ctx: CanvasRenderingContext2D,
  vertical: boolean,
  cut: number,
  viewport: Size,
): void {
  const cx = vertical ? cut : viewport.width / 2
  const cy = vertical ? viewport.height / 2 : cut
  ctx.beginPath()
  ctx.arc(cx, cy, 15, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(18, 18, 18, 0.75)'
  ctx.fill()
  ctx.lineWidth = 1.25
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.stroke()

  // Two chevrons pointing away from the line.
  ctx.beginPath()
  const arrow = 4
  const gap = 5
  if (vertical) {
    ctx.moveTo(cx - gap, cy - arrow)
    ctx.lineTo(cx - gap - arrow, cy)
    ctx.lineTo(cx - gap, cy + arrow)
    ctx.moveTo(cx + gap, cy - arrow)
    ctx.lineTo(cx + gap + arrow, cy)
    ctx.lineTo(cx + gap, cy + arrow)
  } else {
    ctx.moveTo(cx - arrow, cy - gap)
    ctx.lineTo(cx, cy - gap - arrow)
    ctx.lineTo(cx + arrow, cy - gap)
    ctx.moveTo(cx - arrow, cy + gap)
    ctx.lineTo(cx, cy + gap + arrow)
    ctx.lineTo(cx + arrow, cy + gap)
  }
  ctx.stroke()
}

// ---------------------------------------------------------------------------
// Mode 2 — Side by side
// ---------------------------------------------------------------------------

/**
 * Two panes sharing one transform. Each pane re-centres the *same* transform
 * within its own rect, so equivalent image regions appear in both panes and
 * cannot drift apart.
 */
export function sidePanes(viewport: Size, vertical: boolean): [Rect, Rect] {
  const gap = 2
  if (vertical) {
    const w = (viewport.width - gap) / 2
    return [
      { x: 0, y: 0, width: w, height: viewport.height },
      { x: w + gap, y: 0, width: w, height: viewport.height },
    ]
  }
  const h = (viewport.height - gap) / 2
  return [
    { x: 0, y: 0, width: viewport.width, height: h },
    { x: 0, y: h + gap, width: viewport.width, height: h },
  ]
}

/**
 * Convert a viewport point into the space the shared transform lives in.
 *
 * Side-by-side draws each pane with the shared transform shifted by the pane's
 * origin, so a raw viewport point means something different in each pane. Zoom
 * and pinch anchors must be un-shifted by the origin of whichever pane the
 * point falls in, or zooming with the cursor in the second pane pins the wrong
 * image coordinate and the content slides out from under the cursor.
 */
export function anchorInTransformSpace(scene: Scene, point: Point): Point {
  if (scene.settings.mode !== 'sidebyside') return point
  const [, paneB] = sidePanes(scene.viewport, scene.settings.sideAxis === 'vertical')
  const inSecondPane =
    scene.settings.sideAxis === 'vertical' ? point.x >= paneB.x : point.y >= paneB.y
  if (!inSecondPane) return point
  return { x: point.x - paneB.x, y: point.y - paneB.y }
}

export function renderSideBySide(dc: DrawContext): void {
  const { ctx, scene, layerA, layerB, viewport } = dc
  const { sideAxis, showLabels, offsetX, offsetY } = scene.settings
  const vertical = sideAxis === 'vertical'
  const [paneA, paneB] = sidePanes(viewport, vertical)

  const [first, second] = scene.holdSwap ? [layerB, layerA] : [layerA, layerB]
  const [firstOff, secondOff] = scene.holdSwap
    ? [{ x: offsetX, y: offsetY }, { x: 0, y: 0 }]
    : [{ x: 0, y: 0 }, { x: offsetX, y: offsetY }]

  for (const [pane, layer, off] of [
    [paneA, first, firstOff],
    [paneB, second, secondOff],
  ] as const) {
    // Shift the shared transform into pane-local space: same image coordinates,
    // different screen origin.
    const local: Transform = {
      scale: scene.transform.scale,
      tx: scene.transform.tx + pane.x,
      ty: scene.transform.ty + pane.y,
    }
    withClip(ctx, pane, () => {
      if (scene.settings.checkerboard) {
        drawCheckerboard(ctx, imageScreenRect(local, layer))
      }
      drawLayer(ctx, layer, local, off.x, off.y)
    })
  }

  // Divider between the panes.
  ctx.save()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
  ctx.lineWidth = 1
  ctx.beginPath()
  if (vertical) {
    ctx.moveTo(paneB.x - 1, 0)
    ctx.lineTo(paneB.x - 1, viewport.height)
  } else {
    ctx.moveTo(0, paneB.y - 1)
    ctx.lineTo(viewport.width, paneB.y - 1)
  }
  ctx.stroke()
  ctx.restore()

  if (showLabels) {
    const labelA = scene.holdSwap ? 'After' : 'Before'
    const labelB = scene.holdSwap ? 'Before' : 'After'
    drawLabel(ctx, labelA, paneA.x + 14, paneA.y + 22)
    drawLabel(ctx, labelB, paneB.x + 14, paneB.y + 22)
  }
}

// ---------------------------------------------------------------------------
// Mode 3 — Fade
// ---------------------------------------------------------------------------

export function renderFade(dc: DrawContext): void {
  const { ctx, scene, layerA, layerB } = dc
  const { opacity, offsetX, offsetY } = scene.settings
  // Space-hold jumps to the far end of the fade.
  const alpha = scene.holdSwap ? 1 - opacity : opacity

  drawLayer(ctx, layerA, scene.transform)
  if (alpha > 0) {
    ctx.save()
    ctx.globalAlpha = alpha
    drawLayer(ctx, layerB, scene.transform, offsetX, offsetY)
    ctx.restore()
  }

  if (scene.settings.showLabels) {
    drawLabel(ctx, `A ${Math.round((1 - alpha) * 100)}%  ·  B ${Math.round(alpha * 100)}%`, 14, 22)
  }
}

// ---------------------------------------------------------------------------
// Mode 4 — Pixel difference
// ---------------------------------------------------------------------------

export function renderDiff(dc: DrawContext): void {
  const { ctx, scene, layerA } = dc
  const diff = scene.diff
  if (!diff) {
    // Fall back to A while the worker's first result is pending, so the
    // viewport never flashes empty on entering the mode.
    ctx.save()
    ctx.globalAlpha = 0.25
    drawLayer(ctx, layerA, scene.transform)
    ctx.restore()
    return
  }
  // The diff map is already in A's pixel space and has the offset baked in.
  drawLayer(ctx, diff.bitmap, scene.transform)
}

// ---------------------------------------------------------------------------
// Mode 5 — Flicker
// ---------------------------------------------------------------------------

export function renderFlicker(dc: DrawContext): void {
  const { ctx, scene, layerA, layerB } = dc
  const { offsetX, offsetY, showLabels } = scene.settings
  // holdSwap inverts whatever the timer is currently showing.
  const showB = scene.holdSwap ? !scene.flickerShowB : scene.flickerShowB

  if (showB) {
    drawLayer(ctx, layerB, scene.transform, offsetX, offsetY)
  } else {
    drawLayer(ctx, layerA, scene.transform)
  }

  if (showLabels) {
    drawLabel(ctx, showB ? 'After' : 'Before', 14, 22)
  }
  // A fixed marker for the B frame gives a peripheral cue about which image is
  // showing, which is hard to read from the label alone at speed.
  ctx.save()
  ctx.fillStyle = showB ? '#4c9aff' : 'rgba(255,255,255,0.25)'
  ctx.beginPath()
  ctx.arc(rightEdge(dc) - 6, 22, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Mode 6 — Spyglass
// ---------------------------------------------------------------------------

export function renderSpyglass(dc: DrawContext): void {
  const { ctx, scene, layerA, layerB, viewport, forExport } = dc
  const { lensRadius, lensZoom, offsetX, offsetY, showLabels } = scene.settings

  const base = scene.holdSwap ? layerB : layerA
  const lens = scene.holdSwap ? layerA : layerB
  const baseOff = scene.holdSwap ? { x: offsetX, y: offsetY } : { x: 0, y: 0 }
  const lensOff = scene.holdSwap ? { x: 0, y: 0 } : { x: offsetX, y: offsetY }

  drawLayer(ctx, base, scene.transform, baseOff.x, baseOff.y)

  // With no cursor (touch idle, or an export) park the lens at the centre so
  // the mode is never blank.
  const centre: Point =
    scene.cursor && (scene.pointerInside || forExport)
      ? scene.cursor
      : { x: viewport.width / 2, y: viewport.height / 2 }

  const magnified: Transform = {
    scale: scene.transform.scale * lensZoom,
    // Keep the image point under the cursor fixed while scaling up.
    tx: centre.x - (centre.x - scene.transform.tx) * lensZoom,
    ty: centre.y - (centre.y - scene.transform.ty) * lensZoom,
  }

  ctx.save()
  ctx.beginPath()
  ctx.arc(centre.x, centre.y, lensRadius, 0, Math.PI * 2)
  ctx.clip()
  // Dark backing so the lens reads as a distinct surface over the base image.
  ctx.fillStyle = '#121212'
  ctx.fill()
  drawLayer(ctx, lens, magnified, lensOff.x, lensOff.y)
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.arc(centre.x, centre.y, lensRadius, 0, Math.PI * 2)
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.stroke()
  // Crosshair marking the exact sample point.
  ctx.beginPath()
  ctx.moveTo(centre.x - 6, centre.y)
  ctx.lineTo(centre.x + 6, centre.y)
  ctx.moveTo(centre.x, centre.y - 6)
  ctx.lineTo(centre.x, centre.y + 6)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()

  if (showLabels) {
    // The top-left label names the *base* image, matching every other mode's
    // convention that a corner label describes the pixels beneath it. What the
    // lens shows is named on the lens itself, so the two are never confused.
    drawLabel(ctx, scene.holdSwap ? 'After' : 'Before', 14, 22)
    drawLabel(
      ctx,
      `${scene.holdSwap ? 'Before' : 'After'} · ${lensZoom.toFixed(1)}×`,
      centre.x,
      centre.y + lensRadius + 18,
      'centre',
    )
  }
}

/** Initial transform for a freshly loaded pair. */
export function initialTransform(image: Size, viewport: Size): Transform {
  return fitToViewport(image, viewport)
}
