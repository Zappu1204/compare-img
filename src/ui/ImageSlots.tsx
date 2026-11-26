import { useEffect, useRef, useState } from 'react'
import { ACCEPT_ATTR } from '../core/imageLoader'
import { formatAspect, formatBytes, formatScale, shortenName } from '../core/util'
import { useStore } from '../state/store'
import type { LoadedImage, Slot } from '../types'
import { Panel } from './primitives'

/** Per-slot thumbnails and image facts. */
export function ImageSlots({
  onPick,
}: {
  onPick: (files: File[], slot: Slot) => void
}) {
  const { state } = useStore()
  const { images } = state
  const mismatch =
    images.a && images.b && (images.a.width !== images.b.width || images.a.height !== images.b.height)

  return (
    <Panel title="Images">
      <div className="space-y-2">
        <SlotCard slot="a" image={images.a} onPick={onPick} />
        <SlotCard slot="b" image={images.b} onPick={onPick} />
      </div>
      {mismatch && <RenderScales a={images.a!} b={images.b!} />}
    </Panel>
  )
}

/**
 * What the resolution-independent path is actually doing, stated plainly.
 *
 * This replaces a notice that claimed B was resampled into A's grid — true of
 * the old design, and the very thing that destroyed an upscale's detail before
 * anyone could look at it. Nothing is resampled now, so the useful disclosure is
 * the asymmetry: both images fill one screen box, so each is drawn at its own
 * render scale. Seeing "A 400% · B 100%" tells the user why A looks soft and
 * blocky while B looks sharp — that difference is the measurement, not an
 * artefact of the viewer.
 */
function RenderScales({ a, b }: { a: LoadedImage; b: LoadedImage }) {
  const { sceneRef } = useStore()
  const [scale, setScale] = useState(1)

  // Poll rather than subscribe: pan and zoom deliberately bypass React, so a
  // per-frame read is the cheap way to stay current. `setState` with an equal
  // value is a no-op, so a still viewport costs no re-renders.
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

  // The reference box is A's size, so A renders at the transform scale itself
  // and B at that scale times its own resolution ratio.
  const aScale = scale
  const bScale = scale * (a.width / b.width)

  return (
    <div className="mt-2 space-y-1 rounded border border-line bg-surface-2 px-2 py-1.5 text-[10px] leading-snug">
      <p className="text-ink-dim">
        Different resolutions. Both kept at full native size and mapped to one
        shared viewport — neither is resampled.
      </p>
      <p className="font-mono text-ink tabular-nums">
        Render scale · A {formatScale(aScale)} · B {formatScale(bScale)}
      </p>
      <p className="text-ink-faint">
        {bScale < aScale
          ? 'A is magnified past its native pixels; B still has detail in reserve.'
          : 'Both are drawn near their native density.'}
      </p>
    </div>
  )
}

function SlotCard({
  slot,
  image,
  onPick,
}: {
  slot: Slot
  image: LoadedImage | null
  onPick: (files: File[], slot: Slot) => void
}) {
  const { dispatch } = useStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const title = slot === 'a' ? 'A · Before' : 'B · After'

  return (
    <div className="rounded border border-line bg-surface-2 p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-ink">{title}</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-[10px] font-medium text-accent hover:underline"
          >
            {image ? 'Replace' : 'Choose'}
          </button>
          {image && (
            <button
              type="button"
              onClick={() => dispatch({ type: 'setImage', slot, image: null })}
              title={`Remove image ${slot.toUpperCase()}`}
              className="text-[10px] font-medium text-ink-faint hover:text-danger"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length > 0) onPick(files, slot)
          // Reset so choosing the same file twice still fires a change event.
          event.target.value = ''
        }}
      />

      {image ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
          <dt className="text-ink-faint">File</dt>
          <dd className="truncate text-ink" title={image.name}>
            {shortenName(image.name)}
          </dd>
          <dt className="text-ink-faint">Size</dt>
          <dd className="font-mono text-ink tabular-nums">
            {image.width}×{image.height}
          </dd>
          <dt className="text-ink-faint">Ratio</dt>
          <dd className="font-mono text-ink-dim tabular-nums">
            {formatAspect(image.width, image.height)}
          </dd>
          <dt className="text-ink-faint">Bytes</dt>
          <dd className="font-mono text-ink-dim tabular-nums">{formatBytes(image.bytes)}</dd>
          <dt className="text-ink-faint">Type</dt>
          <dd className="truncate text-ink-dim">
            {image.type.replace('image/', '')}
            {image.vector && <span className="text-ink-faint"> · rasterised</span>}
          </dd>
        </dl>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full rounded border border-dashed border-line-strong py-2.5 text-[11px] text-ink-faint hover:border-accent hover:text-accent"
        >
          Drop, paste or choose an image
        </button>
      )}
    </div>
  )
}
