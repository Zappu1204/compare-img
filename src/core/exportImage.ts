import type { Scene } from '../types'
import { paintScene } from './renderer'
import { downloadBlob, timestampedName } from './util'

/**
 * Export helpers. Every source is a local blob, so the canvas is never tainted
 * and `toBlob` always succeeds — no CORS caveats.
 */

/**
 * Export the comparison as it appears on screen, including divider, labels and
 * lens. Rendered at `scale`x the viewport for a crisper file than the display.
 */
export async function exportView(scene: Scene, scale = 2): Promise<void> {
  const { viewport } = scene
  const width = Math.max(1, Math.round(viewport.width * scale))
  const height = Math.max(1, Math.round(viewport.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a 2D drawing context')

  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.fillStyle = '#121212'
  ctx.fillRect(0, 0, viewport.width, viewport.height)
  paintScene(ctx, scene, true)

  const blob = await toBlob(canvas)
  downloadBlob(blob, timestampedName(scene.settings.mode))
}

/**
 * Export the difference map at full image resolution, independent of the
 * current zoom — the point of a diff export is the pixels, not the viewport.
 */
export async function exportDiff(scene: Scene): Promise<void> {
  const diff = scene.diff
  if (!diff) throw new Error('No difference map has been calculated yet')

  const canvas = document.createElement('canvas')
  canvas.width = diff.bitmap.width
  canvas.height = diff.bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a 2D drawing context')
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(diff.bitmap, 0, 0)

  const blob = await toBlob(canvas)
  downloadBlob(blob, timestampedName('diff'))
}

/**
 * Export both source images side by side, each at its own full native
 * resolution.
 *
 * The canvas is sized to fit both natives rather than assuming one shared grid,
 * so a 500x500 original beside a 2000x2000 upscale exports as 2516x2000 with
 * every pixel of each image intact. Resampling either one to match the other
 * would defeat the purpose of the export. Images are top-aligned and the shorter
 * one leaves workspace grey below it.
 */
export async function exportPair(scene: Scene): Promise<void> {
  const prepared = scene.prepared
  if (!prepared) throw new Error('Load both images first')

  const { aSize, bSize } = prepared
  const gap = 16
  const canvas = document.createElement('canvas')
  canvas.width = aSize.width + gap + bSize.width
  canvas.height = Math.max(aSize.height, bSize.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a 2D drawing context')
  ctx.fillStyle = '#121212'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(prepared.a, 0, 0)
  ctx.drawImage(prepared.b, aSize.width + gap, 0)

  const blob = await toBlob(canvas)
  downloadBlob(blob, timestampedName('pair'))
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not encode the PNG file'))
    }, 'image/png')
  })
}
