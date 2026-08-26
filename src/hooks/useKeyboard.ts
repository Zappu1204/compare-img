import { useEffect } from 'react'
import { MODE_ORDER, type Scene } from '../types'
import { useStore } from '../state/store'
import { isTextTarget } from './useIngest'

/**
 * Global shortcuts: Space (hold to swap), 1-6 (modes), 0 (reset view),
 * F (fullscreen), plus arrow-key nudging and a few conveniences.
 *
 * Everything is suppressed while a text field or slider has focus, so typing an
 * offset value does not switch modes underneath you.
 */
export function useKeyboard(options: {
  sceneRef: React.RefObject<Scene>
  requestRender: () => void
  resetView: () => void
  toggleFullscreen: () => void
  onExport: () => void
}): void {
  const { sceneRef, requestRender, resetView, toggleFullscreen, onExport } = options
  const { state, dispatch, patch } = useStore()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextTarget(event.target)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const scene = sceneRef.current
      const settings = scene.settings

      // Space: hold to reveal the other image. In flicker it pauses instead,
      // since the mode is already alternating.
      if (event.code === 'Space') {
        // Stop the page from scrolling, and ignore auto-repeat.
        event.preventDefault()
        if (event.repeat) return
        if (settings.mode === 'flicker') {
          patch({ flickerPlaying: !settings.flickerPlaying })
        } else {
          scene.holdSwap = true
          requestRender()
        }
        return
      }

      // 1-6: modes.
      const digit = Number(event.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= MODE_ORDER.length) {
        event.preventDefault()
        patch({ mode: MODE_ORDER[digit - 1] })
        return
      }

      switch (event.key) {
        case '0':
          event.preventDefault()
          resetView()
          return
        case 'f':
        case 'F':
          event.preventDefault()
          toggleFullscreen()
          return
        case '?':
          event.preventDefault()
          dispatch({ type: 'toggleShortcuts' })
          return
        case 'Escape':
          if (state.showShortcuts) {
            event.preventDefault()
            dispatch({ type: 'toggleShortcuts', open: false })
          }
          return
        case 's':
        case 'S':
          event.preventDefault()
          dispatch({ type: 'swap' })
          return
        case 'e':
        case 'E':
          event.preventDefault()
          onExport()
          return
        case 'l':
        case 'L':
          event.preventDefault()
          patch({ showLabels: !settings.showLabels })
          return
        case 'x':
        case 'X': {
          event.preventDefault()
          // Flip the axis of whichever mode has one.
          if (settings.mode === 'split') {
            patch({ splitAxis: settings.splitAxis === 'vertical' ? 'horizontal' : 'vertical' })
          } else if (settings.mode === 'sidebyside') {
            patch({ sideAxis: settings.sideAxis === 'vertical' ? 'horizontal' : 'vertical' })
          }
          return
        }
        case 'h':
        case 'H':
          event.preventDefault()
          dispatch({ type: 'togglePanels' })
          return
      }

      // Arrows nudge: the split divider in split mode, otherwise B's offset.
      const step = event.shiftKey ? 10 : 1
      if (event.key.startsWith('Arrow')) {
        event.preventDefault()
        if (settings.mode === 'split') {
          const delta = step / Math.max(1, scene.viewport.width)
          if (event.key === 'ArrowLeft') patch({ splitPos: clamp01(settings.splitPos - delta) })
          if (event.key === 'ArrowRight') patch({ splitPos: clamp01(settings.splitPos + delta) })
          if (event.key === 'ArrowUp') patch({ splitPos: clamp01(settings.splitPos - delta) })
          if (event.key === 'ArrowDown') patch({ splitPos: clamp01(settings.splitPos + delta) })
          return
        }
        if (event.key === 'ArrowLeft') patch({ offsetX: settings.offsetX - step })
        if (event.key === 'ArrowRight') patch({ offsetX: settings.offsetX + step })
        if (event.key === 'ArrowUp') patch({ offsetY: settings.offsetY - step })
        if (event.key === 'ArrowDown') patch({ offsetY: settings.offsetY + step })
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      const scene = sceneRef.current
      if (scene.holdSwap) {
        scene.holdSwap = false
        requestRender()
      }
    }

    // Losing focus mid-hold would otherwise leave the view stuck swapped.
    const onBlur = () => {
      const scene = sceneRef.current
      if (scene.holdSwap) {
        scene.holdSwap = false
        requestRender()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [
    dispatch,
    onExport,
    patch,
    requestRender,
    resetView,
    sceneRef,
    state.showShortcuts,
    toggleFullscreen,
  ])
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
