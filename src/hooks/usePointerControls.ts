import { useEffect } from 'react'
import type { Point, Scene } from '../types'
import { clampScale, zoomAt } from '../core/transform'
import { anchorInTransformSpace } from '../core/modes'

/**
 * Wheel zoom, drag pan, pinch zoom and cursor tracking.
 *
 * All of this mutates the scene ref and asks for a frame. React state is never
 * touched, so a pan at 120Hz produces 120 canvas paints and zero re-renders.
 */

const WHEEL_STEP = 1.12
/** Trackpad pinch arrives as a ctrl-wheel with much finer deltas. */
const PINCH_SENSITIVITY = 0.01

export function usePointerControls(
  ref: React.RefObject<HTMLElement | null>,
  sceneRef: React.RefObject<Scene>,
  requestRender: () => void,
): void {
  useEffect(() => {
    const element = ref.current
    if (!element) return

    const localPoint = (event: { clientX: number; clientY: number }): Point => {
      const rect = element.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }

    // --- wheel: zoom at cursor -------------------------------------------
    const onWheel = (event: WheelEvent) => {
      const scene = sceneRef.current
      if (!scene.prepared) return
      event.preventDefault()

      const anchor = localPoint(event)
      let factor: number
      if (event.ctrlKey) {
        // Trackpad pinch (and ctrl+wheel): treat delta as a direct exponent.
        factor = Math.exp(-event.deltaY * PINCH_SENSITIVITY)
      } else {
        // Normalise line-mode deltas so a mouse notch is one step either way.
        const notches = event.deltaMode === 1 ? event.deltaY / 3 : event.deltaY / 100
        factor = Math.pow(WHEEL_STEP, -notches)
      }
      scene.transform = zoomAt(scene.transform, anchorInTransformSpace(scene, anchor), factor)
      requestRender()
    }

    // --- pointer: pan, and pinch via two active pointers ------------------
    const active = new Map<number, Point>()
    let panning = false
    let last: Point = { x: 0, y: 0 }
    /** Distance and midpoint between two pointers at the previous event. */
    let pinchPrev: { distance: number; centre: Point } | null = null

    const onPointerDown = (event: PointerEvent) => {
      const scene = sceneRef.current
      if (!scene.prepared) return
      // The divider handle sits above the canvas and owns its own drags.
      if (scene.draggingDivider) return
      // Middle/right buttons are left to the browser.
      if (event.pointerType === 'mouse' && event.button !== 0) return

      active.set(event.pointerId, localPoint(event))
      element.setPointerCapture(event.pointerId)

      if (active.size === 1) {
        panning = true
        last = localPoint(event)
        element.style.cursor = 'grabbing'
      } else if (active.size === 2) {
        // A second finger converts the gesture from a pan into a pinch.
        panning = false
        pinchPrev = pinchState(active)
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      const scene = sceneRef.current
      const point = localPoint(event)

      // Cursor position drives the spyglass lens.
      scene.cursor = point
      scene.pointerInside = true

      if (active.has(event.pointerId)) active.set(event.pointerId, point)

      if (active.size >= 2) {
        const next = pinchState(active)
        if (pinchPrev && next && pinchPrev.distance > 0) {
          const factor = next.distance / pinchPrev.distance
          scene.transform = zoomAt(
            scene.transform,
            anchorInTransformSpace(scene, next.centre),
            factor,
          )
          // Two-finger drag also pans, by the midpoint's movement.
          scene.transform.tx += next.centre.x - pinchPrev.centre.x
          scene.transform.ty += next.centre.y - pinchPrev.centre.y
        }
        pinchPrev = next
        requestRender()
        return
      }

      if (panning && scene.prepared) {
        scene.transform = {
          scale: scene.transform.scale,
          tx: scene.transform.tx + (point.x - last.x),
          ty: scene.transform.ty + (point.y - last.y),
        }
        last = point
      }
      requestRender()
    }

    const endPointer = (event: PointerEvent) => {
      active.delete(event.pointerId)
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId)
      }
      if (active.size < 2) pinchPrev = null
      if (active.size === 0) {
        panning = false
        element.style.cursor = ''
      } else if (active.size === 1) {
        // Lifting one finger of a pinch resumes panning from the other.
        const remaining = active.values().next().value
        if (remaining) {
          last = remaining
          panning = true
        }
      }
    }

    const onPointerLeave = () => {
      const scene = sceneRef.current
      scene.pointerInside = false
      requestRender()
    }

    const onPointerEnter = () => {
      sceneRef.current.pointerInside = true
    }

    // Double-click toggles between fit and 100%.
    const onDoubleClick = (event: MouseEvent) => {
      const scene = sceneRef.current
      if (!scene.prepared) return
      event.preventDefault()
      const anchor = anchorInTransformSpace(scene, localPoint(event))
      const target = Math.abs(scene.transform.scale - 1) < 0.01 ? fitScale(scene) : 1
      scene.transform = zoomAt(scene.transform, anchor, clampScale(target) / scene.transform.scale)
      requestRender()
    }

    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointermove', onPointerMove)
    element.addEventListener('pointerup', endPointer)
    element.addEventListener('pointercancel', endPointer)
    element.addEventListener('pointerleave', onPointerLeave)
    element.addEventListener('pointerenter', onPointerEnter)
    element.addEventListener('dblclick', onDoubleClick)

    return () => {
      element.removeEventListener('wheel', onWheel)
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('pointerup', endPointer)
      element.removeEventListener('pointercancel', endPointer)
      element.removeEventListener('pointerleave', onPointerLeave)
      element.removeEventListener('pointerenter', onPointerEnter)
      element.removeEventListener('dblclick', onDoubleClick)
    }
  }, [ref, sceneRef, requestRender])
}

function pinchState(active: Map<number, Point>): { distance: number; centre: Point } | null {
  const points = Array.from(active.values()).slice(0, 2)
  if (points.length < 2) return null
  const [p, q] = points
  return {
    distance: Math.hypot(q.x - p.x, q.y - p.y),
    centre: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 },
  }
}

function fitScale(scene: Scene): number {
  const prepared = scene.prepared
  if (!prepared) return 1
  const padding = 24
  const availW = Math.max(1, scene.viewport.width - padding * 2)
  const availH = Math.max(1, scene.viewport.height - padding * 2)
  return Math.min(availW / prepared.width, availH / prepared.height)
}
