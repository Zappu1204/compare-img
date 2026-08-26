import { useCallback, useEffect, useRef, useState } from 'react'
import { exportDiff, exportView } from './core/exportImage'
import { fitToViewport, setScaleAboutCentre } from './core/transform'
import { useIngest } from './hooks/useIngest'
import { useKeyboard } from './hooks/useKeyboard'
import { StoreProvider, useStore } from './state/store'
import { AlignPanel } from './ui/AlignPanel'
import { DropOverlay, EmptyState } from './ui/EmptyState'
import { ImageSlots } from './ui/ImageSlots'
import { ModePanel } from './ui/ModePanel'
import { ShortcutsHelp } from './ui/ShortcutsHelp'
import { Toolbar } from './ui/Toolbar'
import { Workspace } from './ui/Workspace'
import type { Slot } from './types'

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}

function Shell() {
  const { state, dispatch, sceneRef, requestRender } = useStore()
  const workspaceRef = useRef<HTMLDivElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const { dragging, acceptFiles, loadSamples } = useIngest()
  // Mirrored into React state only so the toolbar readout can show it; the
  // renderer itself reads the transform straight off the scene ref.
  const [scale, setScale] = useState(1)

  const { images, settings, panelsOpen, busy, error, notice } = state
  const anyLoaded = Boolean(images.a || images.b)
  const bothLoaded = Boolean(images.a && images.b)

  // Poll the transform for the zoom readout. One read per frame is far cheaper
  // than re-rendering React on every pan event.
  useEffect(() => {
    let frame = 0
    const tick = () => {
      const next = sceneRef.current.transform.scale
      setScale((prev) => (Math.abs(prev - next) < 0.0005 ? prev : next))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [sceneRef])

  const fit = useCallback(() => {
    const scene = sceneRef.current
    if (!scene.prepared) return
    scene.transform = fitToViewport(scene.prepared, scene.viewport)
    requestRender()
  }, [requestRender, sceneRef])

  const zoomTo = useCallback(
    (target: number) => {
      const scene = sceneRef.current
      if (!scene.prepared) return
      scene.transform = setScaleAboutCentre(scene.transform, scene.viewport, target)
      requestRender()
    },
    [requestRender, sceneRef],
  )

  const toggleFullscreen = useCallback(() => {
    const element = shellRef.current
    if (!element) return
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void element.requestFullscreen().catch(() => {
        dispatch({ type: 'error', error: 'This browser refused to enter fullscreen' })
      })
    }
  }, [dispatch])

  const doExportView = useCallback(() => {
    if (!sceneRef.current.prepared) return
    void exportView(sceneRef.current).catch((err: unknown) =>
      dispatch({
        type: 'error',
        error: err instanceof Error ? err.message : 'Export failed',
      }),
    )
  }, [dispatch, sceneRef])

  const doExportDiff = useCallback(() => {
    void exportDiff(sceneRef.current).catch((err: unknown) =>
      dispatch({
        type: 'error',
        error: err instanceof Error ? err.message : 'Export failed',
      }),
    )
  }, [dispatch, sceneRef])

  useKeyboard({
    sceneRef,
    requestRender,
    resetView: fit,
    toggleFullscreen,
    onExport: doExportView,
  })

  // Transient messages clear themselves.
  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => dispatch({ type: 'notice', notice: null }), 2600)
    return () => window.clearTimeout(id)
  }, [notice, dispatch])

  useEffect(() => {
    if (!error) return
    const id = window.setTimeout(() => dispatch({ type: 'error', error: null }), 6000)
    return () => window.clearTimeout(id)
  }, [error, dispatch])

  const onPickForSlot = useCallback(
    (files: File[], slot: Slot) => void acceptFiles(files, slot),
    [acceptFiles],
  )

  // Tell the renderer how much of the right edge the floating panel covers, so
  // canvas overlays anchored there are not drawn underneath it.
  const panelRef = useRef<HTMLElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const scene = sceneRef.current
    const panel = panelRef.current
    const main = mainRef.current
    if (!panel || !main) {
      scene.obstructedRight = 0
      requestRender()
      return
    }
    const measure = () => {
      const width = main.getBoundingClientRect().right - panel.getBoundingClientRect().left
      const next = Math.max(0, Math.round(width))
      if (next === scene.obstructedRight) return
      scene.obstructedRight = next
      requestRender()
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(panel)
    observer.observe(main)
    return () => observer.disconnect()
    // Re-attach when the panel mounts or unmounts, since the ref changes then.
  }, [panelsOpen, bothLoaded, anyLoaded, requestRender, sceneRef])

  return (
    <div ref={shellRef} className="flex h-full flex-col overflow-hidden bg-canvas">
      <Toolbar
        scale={scale}
        onZoom={zoomTo}
        onFit={fit}
        onReset={fit}
        onFullscreen={toggleFullscreen}
        onExportView={doExportView}
        onExportDiff={doExportDiff}
      />

      <main ref={mainRef} className="relative flex-1 overflow-hidden">
        <div
          ref={workspaceRef}
          className="absolute inset-0 touch-none"
          style={{ cursor: settings.mode === 'spyglass' ? 'none' : undefined }}
        >
          <Workspace containerRef={workspaceRef} />
        </div>

        {!bothLoaded && (
          <EmptyState
            hasOne={anyLoaded}
            onPick={(files) => void acceptFiles(files)}
            onSamples={() => void loadSamples()}
          />
        )}

        {panelsOpen && (
          <aside
            ref={panelRef}
            className="pointer-events-none absolute top-3 right-3 bottom-3 flex w-64 flex-col gap-2.5 overflow-y-auto"
          >
            <div className="pointer-events-auto contents">
              <ImageSlots onPick={onPickForSlot} />
              {bothLoaded && <ModePanel />}
              {bothLoaded && <AlignPanel />}
            </div>
          </aside>
        )}

        {busy && (
          <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full border border-line bg-surface/95 px-3 py-1.5 text-[11px] text-ink-dim shadow-lg">
            Working…
          </div>
        )}

        {notice && !error && (
          <div className="pointer-events-none absolute bottom-3 left-3 rounded border border-line bg-surface/95 px-2.5 py-1.5 text-[11px] text-ink-dim shadow-lg">
            {notice}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="absolute bottom-3 left-3 max-w-sm rounded border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger shadow-lg"
          >
            {error}
          </div>
        )}
      </main>

      {dragging && <DropOverlay bothLoaded={bothLoaded} />}
      <ShortcutsHelp />
    </div>
  )
}
