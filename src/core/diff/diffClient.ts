import type { DiffResult, DiffSettings, DiffStats, PreparedScene } from '../../types'
import { readPixels } from '../prepare'
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
    const key = scene ? `${scene.width}x${scene.height}:${identity(scene)}` : ''
    if (key === this.sceneKey) return
    this.sceneKey = key
    this.dropResult()

    if (!scene) {
      this.terminate()
      return
    }

    try {
      this.ensureWorker()
      const a = readPixels(scene.a)
      const b = readPixels(scene.b)
      // Transfer the buffers: they are not needed on this thread again.
      this.worker!.postMessage(
        {
          type: 'init',
          a: a.data.buffer,
          b: b.data.buffer,
          width: scene.width,
          height: scene.height,
        },
        [a.data.buffer, b.data.buffer],
      )
    } catch (error) {
      this.onError(error instanceof Error ? error.message : 'Could not read image pixels')
    }
  }

  /** Request a diff. Safe to call on every slider tick. */
  request(settings: DiffSettings): void {
    if (!this.worker) return
    if (this.inFlight > 0) {
      // Keep only the newest request; intermediate slider values are stale.
      this.pending = settings
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
  }
}

/**
 * ImageBitmaps have no stable id, so combine dimensions with the resample
 * marker. Together with the fact that a new pair always yields new bitmap
 * objects, this is enough to detect a scene change.
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
