import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DiffEngine } from '../core/diff/diffClient'
import { buildMipChain, closeMipChain, type MipChain } from '../core/mip'
import { registerMip, unregisterMip } from '../core/modes'
import { buildChannelLayers, layerCacheKey, prepareScene } from '../core/prepare'
import { Renderer } from '../core/renderer'
import { fitToViewport } from '../core/transform'
import { useCanvasSize } from '../hooks/useCanvasSize'
import { usePointerControls } from '../hooks/usePointerControls'
import { useStore } from '../state/store'
import type { DiffResult, PreparedScene } from '../types'
import { SplitHandle } from './SplitHandle'

/**
 * Canvas host. Owns the Renderer, keeps the mutable scene in step with React
 * state, and drives the diff worker and flicker timer.
 */
export function Workspace({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
}) {
  const { state, dispatch, sceneRef, setRenderHook, patch } = useStore()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const { size, dpr } = useCanvasSize(containerRef)
  const [diffStats, setDiffStats] = useState<DiffResult['stats'] | null>(null)
  // Bumped whenever the channel layers are rebuilt. The layers live on the scene
  // ref, so this is how a React effect learns their identity changed.
  const [channelLayersReady, setChannelLayersReady] = useState(0)
  // Same for `scene.prepared`. Preparation is async, so an effect keyed on
  // `images.a/b` alone runs *before* the new bitmaps exist and would read the
  // previous pair — or null on first load.
  const [preparedReady, setPreparedReady] = useState(0)

  const { images, settings } = state
  const bothLoaded = Boolean(images.a && images.b)

  // --- renderer lifecycle ------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new Renderer(canvas, sceneRef.current)
    rendererRef.current = renderer
    const request = () => renderer.requestRender()
    setRenderHook(request)
    request()
    return () => {
      setRenderHook(null)
      renderer.destroy()
      rendererRef.current = null
    }
  }, [sceneRef, setRenderHook])

  const requestRender = useCallback(() => {
    rendererRef.current?.requestRender()
  }, [])

  // --- viewport size ----------------------------------------------------
  useEffect(() => {
    const scene = sceneRef.current
    const first = scene.viewport.width <= 1
    scene.viewport = size
    scene.dpr = dpr
    rendererRef.current?.resize(size, dpr)
    // On the first real measurement, fit whatever is already loaded.
    if (first && scene.prepared) {
      scene.transform = fitToViewport(scene.prepared, size)
    }
  }, [size, dpr, sceneRef])

  // --- prepare images ---------------------------------------------------
  useEffect(() => {
    const scene = sceneRef.current
    if (!images.a || !images.b) {
      // With one image, show it alone at native size rather than nothing.
      const only = images.a ?? images.b
      if (only) {
        const single: PreparedScene = {
          a: only.bitmap,
          b: only.bitmap,
          width: only.width,
          height: only.height,
          resampledFrom: null,
        }
        scene.prepared = single
        scene.layers = null
        scene.layerKey = ''
        scene.transform = fitToViewport(single, scene.viewport)
      } else {
        scene.prepared = null
        scene.layers = null
      }
      scene.diff = null
      setDiffStats(null)
      setPreparedReady((n) => n + 1)
      requestRender()
      return
    }

    let cancelled = false
    void (async () => {
      dispatch({ type: 'busy', busy: true })
      try {
        const prepared = await prepareScene(images.a!, images.b!)
        if (cancelled) return
        scene.prepared = prepared
        scene.layers = null
        scene.layerKey = ''
        // The previous pair's diff no longer describes anything on screen. Drop
        // the reference now rather than waiting for the engine to be re-pointed,
        // so no frame can paint a diff belonging to the old pair.
        scene.diff = null
        setDiffStats(null)
        scene.transform = fitToViewport(prepared, scene.viewport)
        setPreparedReady((n) => n + 1)
        requestRender()
      } catch (error) {
        if (!cancelled) {
          dispatch({
            type: 'error',
            error: error instanceof Error ? error.message : 'Could not prepare the images',
          })
        }
      } finally {
        if (!cancelled) dispatch({ type: 'busy', busy: false })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [images.a, images.b, dispatch, requestRender, sceneRef])

  // --- channel layers (cached) ------------------------------------------
  useEffect(() => {
    const scene = sceneRef.current
    const prepared = scene.prepared
    if (!prepared) return

    const key = layerCacheKey(prepared, settings.channel)
    if (key === scene.layerKey) return

    if (settings.channel === 'rgb') {
      // Release any filtered layers; the originals are drawn directly.
      closeLayers(scene.layers, prepared)
      scene.layers = null
      scene.layerKey = key
      setChannelLayersReady((n) => n + 1)
      requestRender()
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const layers = await buildChannelLayers(prepared, settings.channel)
        if (cancelled) {
          closeLayers(layers, prepared)
          return
        }
        closeLayers(scene.layers, prepared)
        scene.layers = layers
        scene.layerKey = key
        setChannelLayersReady((n) => n + 1)
        requestRender()
      } catch {
        // A failed channel filter is not worth interrupting the session for;
        // fall back to full colour.
        scene.layers = null
        scene.layerKey = key
        setChannelLayersReady((n) => n + 1)
        requestRender()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [settings.channel, images.a, images.b, requestRender, sceneRef])

  // --- diff engine ------------------------------------------------------
  const diffEngine = useMemo(
    () =>
      new DiffEngine(
        (result) => {
          // Follow the engine's ownership exactly, including the drop. Keeping a
          // stale reference here is what caused the renderer to draw a closed
          // bitmap after a swap or a pair reload.
          sceneRef.current.diff = result
          setDiffStats(result?.stats ?? null)
          requestRender()
        },
        (message) => dispatch({ type: 'error', error: message }),
      ),
    [dispatch, requestRender, sceneRef],
  )

  useEffect(() => () => diffEngine.terminate(), [diffEngine])

  // Only feed the worker while the diff mode is actually in use, so loading a
  // pair does not pay for a diff nobody looks at.
  const diffActive = settings.mode === 'diff' && bothLoaded
  useEffect(() => {
    if (!diffActive) return
    diffEngine.setScene(sceneRef.current.prepared)
  }, [diffActive, diffEngine, images.a, images.b, sceneRef])

  useEffect(() => {
    if (!diffActive) return
    diffEngine.request({
      threshold: settings.diffThreshold,
      gain: settings.diffGain,
      style: settings.diffStyle,
      offsetX: settings.offsetX,
      offsetY: settings.offsetY,
    })
  }, [
    diffActive,
    diffEngine,
    settings.diffThreshold,
    settings.diffGain,
    settings.diffStyle,
    settings.offsetX,
    settings.offsetY,
  ])

  // --- flicker timer ----------------------------------------------------
  useEffect(() => {
    if (settings.mode !== 'flicker' || !settings.flickerPlaying || !bothLoaded) return
    const id = window.setInterval(() => {
      const scene = sceneRef.current
      scene.flickerShowB = !scene.flickerShowB
      requestRender()
    }, Math.max(30, settings.flickerMs))
    return () => window.clearInterval(id)
  }, [
    settings.mode,
    settings.flickerPlaying,
    settings.flickerMs,
    bothLoaded,
    requestRender,
    sceneRef,
  ])

  usePointerControls(containerRef, sceneRef, requestRender)

  // --- downscaled copies of whatever is being drawn ----------------------
  // Keyed on the bitmaps `drawLayer` will actually receive: the channel-isolated
  // layers when a channel is isolated, the prepared pair otherwise, plus the diff
  // map. `layerKey` and `diffStats` change whenever those identities change, so
  // they are the triggers rather than the bitmaps themselves.
  useEffect(() => {
    const scene = sceneRef.current
    const prepared = scene.prepared
    if (!prepared) return

    const targets = [
      scene.layers?.a ?? prepared.a,
      scene.layers?.b ?? prepared.b,
      scene.diff?.bitmap,
    ].filter((b): b is ImageBitmap => Boolean(b))

    // Only worth building for images large enough that a per-frame downscale is
    // the bottleneck; below this the direct draw is already cheap.
    const worthwhile = targets.filter((b) => b.width * b.height > 2_000_000)
    if (worthwhile.length === 0) return

    let cancelled = false
    const built: MipChain[] = []
    void (async () => {
      for (const bitmap of worthwhile) {
        try {
          const chain = await buildMipChain(bitmap)
          if (cancelled) {
            closeMipChain(chain)
            return
          }
          built.push(chain)
          registerMip(chain)
        } catch {
          // A failed mip is not an error the user needs to see: rendering falls
          // back to drawing the full-resolution bitmap, exactly as before.
        }
      }
      if (!cancelled && built.length > 0) requestRender()
    })()

    return () => {
      cancelled = true
      for (const chain of built) {
        unregisterMip(chain)
        closeMipChain(chain)
      }
    }
  }, [
    settings.channel,
    channelLayersReady,
    preparedReady,
    diffStats,
    requestRender,
    sceneRef,
  ])

  // Repaint whenever any setting changes (patch already writes to the scene,
  // but a direct dispatch elsewhere may not have).
  useEffect(() => {
    sceneRef.current.settings = settings
    requestRender()
  }, [settings, requestRender, sceneRef])

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ width: '100%', height: '100%' }}
      />
      {settings.mode === 'split' && bothLoaded && (
        <SplitHandle
          axis={settings.splitAxis}
          position={settings.splitPos}
          viewport={size}
          onChange={(splitPos) => patch({ splitPos })}
          onDragState={(dragging) => {
            sceneRef.current.draggingDivider = dragging
          }}
        />
      )}
      {diffActive && diffStats && <DiffReadout stats={diffStats} />}
    </>
  )
}

function DiffReadout({ stats }: { stats: DiffResult['stats'] }) {
  const identical = stats.changed === 0
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2">
      <div className="rounded-full border border-line bg-surface/95 px-3 py-1.5 font-mono text-[11px] text-ink-dim tabular-nums shadow-lg backdrop-blur-sm">
        {identical ? (
          <span className="text-ok">Images are identical at this threshold</span>
        ) : (
          <>
            <span className="text-ink">{stats.changed.toLocaleString()}</span> px differ ·{' '}
            <span className="text-ink">{(stats.ratio * 100).toFixed(2)}%</span> · max Δ{' '}
            <span className="text-ink">{stats.maxDelta}</span> · mean Δ{' '}
            <span className="text-ink">{stats.meanDelta.toFixed(1)}</span>
          </>
        )}
      </div>
    </div>
  )
}

/** Close filtered layers, but never the shared prepared bitmaps. */
function closeLayers(
  layers: { a: ImageBitmap; b: ImageBitmap } | null,
  prepared: PreparedScene,
): void {
  if (!layers) return
  if (layers.a !== prepared.a) layers.a.close()
  if (layers.b !== prepared.b) layers.b.close()
}
