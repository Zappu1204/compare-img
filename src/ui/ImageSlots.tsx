import { useRef } from 'react'
import { ACCEPT_ATTR } from '../core/imageLoader'
import { formatAspect, formatBytes, shortenName } from '../core/util'
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
      {mismatch && (
        <p className="mt-2 rounded border border-warn/30 bg-warn/10 px-2 py-1.5 text-[10px] leading-snug text-warn">
          B is resampled to {images.a!.width}×{images.a!.height} so the two align. Edges may
          show faint resampling noise in the difference view.
        </p>
      )}
    </Panel>
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
