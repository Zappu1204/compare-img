import type { DiffResult, DiffSettings, DiffStats, PreparedScene } from '../../types'
import { readPixels, resample } from '../prepare'
import DiffWorker from './diffWorker?worker'

type WorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number; bitmap: ImageBitmap; stats: DiffStats }

/**
 * Owns the diff worker: uploads pixels once per image pair, then coalesces
 * recompute requests so a slider drag produces one in-flight job plus at most
 * one queued job, rather than a backlog.
 *
 * The engine owns the result bitmap's lifetime, so `onResult` is the *only* way
 * a result is published — including `null` when one is dropped. Anything holding
 * a reference must follow that callback rather than keeping its own copy, or it
 * will eventually draw a closed bitmap.
 */
export class DiffEngine {
  private worker: Worker | null = null
  private sceneKey = ''
  private nextId = 1
  private inFlight = 0
  private pending: DiffSettings | null = null
  private latest: DiffResult | null = null
  /** True once the worker holds this scene's pixels and can serve `compute`. */
  private ready = false
  private onResult: (result: DiffResult | null) => void
  private onError: (message: string) => void

  constructor(
    onResult: (result: DiffResult | null) => void,
    onError: (message: string) => void,
  ) {
    this.onResult = onResult
    this.onError = onError
  }

  get result(): DiffResult | null {
    return this.latest
  }

  /** Point the engine at a pair of images. No-op if already loaded. */
  setScene(scene: PreparedScene | null): void {
    const key = scene
      ? `${scene.aSize.width}x${scene.aSize.height}:` +
        `${scene.bSize.width}x${scene.bSize.height}:${identity(scene)}`
      : ''
    if (key === this.sceneKey) return
    this.sceneKey = key
    this.ready = false
    this.dropResult()

    if (!scene) {
      this.terminate()
      return
    }

    void this.upload(scene, key)
  }

  /**
   * Get both images onto one pixel grid and hand them to the worker.
   *
   * Differencing is the one operation that genuinely cannot be
   * resolution-independent: it needs pixel i of A to correspond to pixel i of B.
   * So this is the only place a resample survives, and the rule is that it only
   * ever goes **upwards** — the coarser image is projected onto the finer grid,
   * never the reverse.
   *
   * Usually that means A onto B's grid, the upscale-inspection case: detail that
   * exists only in the upscale then registers as a difference, which is what such
   * a tool should report. Comparing on A's grid instead would average that detail
   * away and pronounce the upscale identical to its own blurred source.
   *
   * But "always B's grid" is the wrong generalisation, and picking it was a real
   * defect: when B is the *smaller* image (1920x1080 vs 1600x900), it downscales A
   * and throws away pixels that genuinely exist — the precise harm this whole
   * module was built to prevent, reintroduced at the last step. Choosing by area
   * keeps the principle rather than the special case, and also makes the diff
   * export land at the finer resolution either way.
   *
   * The cost is that worker memory scales with the larger image: a 500x500 vs 8K
   * pair is ~132MB per buffer. That is the accepted trade for reporting the truth.
   */
  private async upload(scene: PreparedScene, key: string): Promise<void> {
    try {
      const { aSize, bSize } = scene
      // Compare on whichever grid is finer, so neither image is ever downsampled.
      const grid = bSize.width * bSize.height >= aSize.width * aSize.height ? bSize : aSize
      const { width, height } = grid
      const [projectedA, projectedB] = await Promise.all([
        aSize.width === width && aSize.height === height
          ? scene.a
          : resample(scene.a, width, height),
        bSize.width === width && bSize.height === height
          ? scene.b
          : resample(scene.b, width, height),
      ])

      // The resample yields to the event loop, so the pair may have changed
      // underneath us. Drop the work rather than uploading the wrong images.
      if (this.sceneKey !== key) {
        if (projectedA !== scene.a) projectedA.close()
        if (projectedB !== scene.b) projectedB.close()
        return
      }

      this.ensureWorker()
      const a = readPixels(projectedA)
      const b = readPixels(projectedB)
      if (projectedA !== scene.a) projectedA.close()
      if (projectedB !== scene.b) projectedB.close()

      // Transfer the buffers: they are not needed on this thread again.
      this.worker!.postMessage(
        { type: 'init', a: a.data.buffer, b: b.data.buffer, width, height },
        [a.data.buffer, b.data.buffer],
      )
      this.ready = true

      // A request that arrived while the pixels were being prepared is held, not
      // dropped, because the worker ignores `compute` before `init`.
      if (this.pending && this.inFlight === 0) {
        const next = this.pending
        this.pending = null
        this.dispatch(next)
      }
    } catch (error) {
      this.onError(error instanceof Error ? error.message : 'Could not read image pixels')
    }
  }

  /** Request a diff. Safe to call on every slider tick. */
  request(settings: DiffSettings): void {
    // Queue while the pixels are still being prepared, or while a job is out;
    // in both cases only the newest request is worth keeping.
    if (!this.ready || this.inFlight > 0) {
      if (this.sceneKey !== '') this.pending = settings
      return
    }
    this.dispatch(settings)
  }

  private dispatch(settings: DiffSettings): void {
    if (!this.worker) return
    this.inFlight = this.nextId++
    this.worker.postMessage({ type: 'compute', id: this.inFlight, settings })
  }

  private ensureWorker(): void {
    if (this.worker) return
    this.worker = new DiffWorker()
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data
      if (msg.type !== 'result') return
      if (msg.id !== this.inFlight) {
        // A superseded job: release its bitmap so it does not leak.
        msg.bitmap.close()
        return
      }
      this.inFlight = 0
      this.latest?.bitmap.close()
      this.latest = { bitmap: msg.bitmap, stats: msg.stats }
      this.onResult(this.latest)

      if (this.pending) {
        const next = this.pending
        this.pending = null
        this.dispatch(next)
      }
    }
    this.worker.onerror = (event) => {
      this.onError(event.message || 'The difference calculation failed')
      this.inFlight = 0
    }
  }

  private dropResult(): void {
    const had = this.latest !== null
    this.latest?.bitmap.close()
    this.latest = null
    this.inFlight = 0
    this.pending = null
    // Tell the consumer *before* the closed bitmap can be drawn again. Closing
    // it while the scene still referenced it was a real defect: swapping A/B, or
    // reloading a pair, left the renderer holding a detached bitmap and the next
    // paint threw "the image source is detached", killing the frame.
    if (had) this.onResult(null)
  }

  terminate(): void {
    this.dropResult()
    this.worker?.terminate()
    this.worker = null
    this.sceneKey = ''
    this.ready = false
  }
}

/**
 * ImageBitmaps have no stable id, so combine both native sizes with a per-object
 * counter. Together with the fact that a new pair always yields a new
 * `PreparedScene` object, this is enough to detect a scene change — including a
 * swap, where the sizes trade places but the pair is genuinely different.
 */
let sceneCounter = 0
const sceneIds = new WeakMap<object, number>()
function identity(scene: PreparedScene): number {
  let id = sceneIds.get(scene)
  if (id === undefined) {
    id = ++sceneCounter
    sceneIds.set(scene, id)
  }
  return id
}
