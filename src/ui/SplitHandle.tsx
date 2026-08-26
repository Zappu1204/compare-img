import { useCallback, useEffect, useRef } from 'react'
import type { Axis, Size } from '../types'

/**
 * Drag handle for the split divider.
 *
 * A thin DOM element rather than canvas hit-testing: it gets pointer capture
 * for free (so the drag survives leaving the strip), it is reachable by keyboard
 * as a slider, and it removes any ambiguity between "drag the divider" and
 * "pan the image".
 */
export function SplitHandle({
  axis,
  position,
  viewport,
  onChange,
  onDragState,
}: {
  axis: Axis
  position: number
  viewport: Size
  onChange: (position: number) => void
  onDragState: (dragging: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const vertical = axis === 'vertical'
  const dragging = useRef(false)

  const positionFrom = useCallback(
    (clientX: number, clientY: number) => {
      const parent = ref.current?.parentElement
      if (!parent) return position
      const rect = parent.getBoundingClientRect()
      const raw = vertical
        ? (clientX - rect.left) / Math.max(1, rect.width)
        : (clientY - rect.top) / Math.max(1, rect.height)
      return Math.min(1, Math.max(0, raw))
    },
    [position, vertical],
  )

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const onPointerDown = (event: PointerEvent) => {
      event.preventDefault()
      event.stopPropagation()
      dragging.current = true
      onDragState(true)
      element.setPointerCapture(event.pointerId)
      onChange(positionFrom(event.clientX, event.clientY))
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging.current) return
      event.preventDefault()
      onChange(positionFrom(event.clientX, event.clientY))
    }

    const onPointerUp = (event: PointerEvent) => {
      if (!dragging.current) return
      dragging.current = false
      onDragState(false)
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId)
      }
    }

    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointermove', onPointerMove)
    element.addEventListener('pointerup', onPointerUp)
    element.addEventListener('pointercancel', onPointerUp)
    return () => {
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('pointerup', onPointerUp)
      element.removeEventListener('pointercancel', onPointerUp)
    }
  }, [onChange, onDragState, positionFrom])

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 0.05 : 0.01
    const keys: Record<string, number> = vertical
      ? { ArrowLeft: -step, ArrowRight: step }
      : { ArrowUp: -step, ArrowDown: step }
    const delta = keys[event.key]
    if (delta === undefined) {
      if (event.key === 'Home') {
        event.preventDefault()
        onChange(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        onChange(1)
      }
      return
    }
    event.preventDefault()
    onChange(Math.min(1, Math.max(0, position + delta)))
  }

  // A generous invisible hit area over the 1.5px line the canvas draws.
  const offset = vertical ? viewport.width * position : viewport.height * position
  const style: React.CSSProperties = vertical
    ? { left: offset, top: 0, width: 28, height: '100%', marginLeft: -14 }
    : { top: offset, left: 0, height: 28, width: '100%', marginTop: -14 }

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Comparison divider position"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(position * 100)}
      aria-valuetext={`${Math.round(position * 100)}% across`}
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
      onKeyDown={onKeyDown}
      className={[
        'absolute z-10 touch-none',
        vertical ? 'cursor-ew-resize' : 'cursor-ns-resize',
        'focus-visible:bg-accent/20',
      ].join(' ')}
      style={style}
    />
  )
}
