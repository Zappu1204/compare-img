import { useEffect, useState } from 'react'
import type { Size } from '../types'

/**
 * Track an element's CSS size and the device pixel ratio.
 *
 * The DPR listener uses a `resolution` media query rather than polling, so
 * moving a window between a laptop screen and an external monitor re-renders
 * at the right density.
 */
export function useCanvasSize(
  ref: React.RefObject<HTMLElement | null>,
): { size: Size; dpr: number } {
  const [size, setSize] = useState<Size>({ width: 1, height: 1 })
  const [dpr, setDpr] = useState(() =>
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
  )

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      // contentRect is in CSS pixels, which is the unit all our maths uses.
      const { width, height } = entry.contentRect
      setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      )
    })
    observer.observe(element)

    const rect = element.getBoundingClientRect()
    setSize({ width: rect.width, height: rect.height })

    return () => observer.disconnect()
  }, [ref])

  useEffect(() => {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    const onChange = () => setDpr(window.devicePixelRatio || 1)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [dpr])

  return { size, dpr }
}
