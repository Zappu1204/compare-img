import type { Scene, Size } from '../types'
import {
  drawCheckerboard,
  imageScreenRect,
  renderDiff,
  renderFade,
  renderFlicker,
  renderSideBySide,
  renderSplit,
  renderSpyglass,
  type DrawContext,
} from './modes'

/**
 * The single canvas renderer.
 *
 * Pointer handlers mutate the Scene object and call `requestRender()`; the loop
 * coalesces those into one paint per animation frame. Nothing here touches
 * React, so a pan drag costs zero re-renders.
 */
export class Renderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private scene: Scene
  private frame = 0
  private dirty = true

  constructor(canvas: HTMLCanvasElement, scene: Scene) {
    this.canvas = canvas
    this.scene = scene
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('This browser does not support 2D canvas rendering')
    this.ctx = ctx
  }

  requestRender(): void {
    this.dirty = true
    if (this.frame !== 0) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      if (!this.dirty) return
      this.dirty = false
      this.draw()
    })
  }

  /** Match the backing store to the CSS size times device pixel ratio. */
  resize(viewport: Size, dpr: number): void {
    const width = Math.max(1, Math.round(viewport.width * dpr))
    const height = Math.max(1, Math.round(viewport.height * dpr))
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
    this.requestRender()
  }

  private draw(): void {
    const { ctx, scene } = this
    const { viewport, dpr } = scene

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#121212'
    ctx.fillRect(0, 0, viewport.width, viewport.height)

    paintScene(ctx, scene, false)
  }

  destroy(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame)
    this.frame = 0
  }
}

/**
 * Paint the current scene into a context already scaled to CSS pixels.
 * Shared by the live renderer and the exporter so both produce the same image.
 */
export function paintScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  forExport: boolean,
): void {
  const prepared = scene.prepared
  if (!prepared) return

  const layerA = scene.layers?.a ?? prepared.a
  const layerB = scene.layers?.b ?? prepared.b

  const dc: DrawContext = {
    ctx,
    scene,
    layerA,
    layerB,
    viewport: scene.viewport,
    forExport,
  }

  // Side-by-side manages its own per-pane backdrop.
  if (scene.settings.checkerboard && scene.settings.mode !== 'sidebyside') {
    drawCheckerboard(ctx, imageScreenRect(scene.transform, prepared))
  }

  switch (scene.settings.mode) {
    case 'split':
      renderSplit(dc)
      break
    case 'sidebyside':
      renderSideBySide(dc)
      break
    case 'fade':
      renderFade(dc)
      break
    case 'diff':
      renderDiff(dc)
      break
    case 'flicker':
      renderFlicker(dc)
      break
    case 'spyglass':
      renderSpyglass(dc)
      break
  }
}
