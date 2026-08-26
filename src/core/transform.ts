import type { Point, Size, Transform } from '../types'

/**
 * Screen (CSS px) = image px * scale + translate.
 * `dpr` is applied only at draw time, so all maths here stays in CSS pixels.
 */

export const MIN_SCALE = 0.02
export const MAX_SCALE = 64

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

export function imageToScreen(t: Transform, p: Point): Point {
  return { x: p.x * t.scale + t.tx, y: p.y * t.scale + t.ty }
}

export function screenToImage(t: Transform, p: Point): Point {
  return { x: (p.x - t.tx) / t.scale, y: (p.y - t.ty) / t.scale }
}

/**
 * Zoom by `factor` while keeping the image point under `anchor` pinned to it.
 * Derived from screenToImage(t, anchor) === screenToImage(t', anchor).
 */
export function zoomAt(t: Transform, anchor: Point, factor: number): Transform {
  const scale = clampScale(t.scale * factor)
  // Recover the effective factor after clamping so the anchor stays exact.
  const applied = scale / t.scale
  return {
    scale,
    tx: anchor.x - (anchor.x - t.tx) * applied,
    ty: anchor.y - (anchor.y - t.ty) * applied,
  }
}

/** Scale so the image fits inside the viewport with padding, then centre it. */
export function fitToViewport(image: Size, viewport: Size, padding = 24): Transform {
  const availW = Math.max(1, viewport.width - padding * 2)
  const availH = Math.max(1, viewport.height - padding * 2)
  if (image.width <= 0 || image.height <= 0) return { scale: 1, tx: 0, ty: 0 }
  const scale = clampScale(Math.min(availW / image.width, availH / image.height))
  return centred(image, viewport, scale)
}

/** Centre the image in the viewport at a given scale. */
export function centred(image: Size, viewport: Size, scale: number): Transform {
  return {
    scale,
    tx: (viewport.width - image.width * scale) / 2,
    ty: (viewport.height - image.height * scale) / 2,
  }
}

/** Apply a zoom preset (100%, 200%, ...) about the viewport centre. */
export function setScaleAboutCentre(
  t: Transform,
  viewport: Size,
  nextScale: number,
): Transform {
  const centre = { x: viewport.width / 2, y: viewport.height / 2 }
  return zoomAt(t, centre, clampScale(nextScale) / t.scale)
}

export function translate(t: Transform, dx: number, dy: number): Transform {
  return { scale: t.scale, tx: t.tx + dx, ty: t.ty + dy }
}

export function transformsEqual(a: Transform, b: Transform): boolean {
  return a.scale === b.scale && a.tx === b.tx && a.ty === b.ty
}
