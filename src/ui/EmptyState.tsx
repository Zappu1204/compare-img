import { useRef } from 'react'
import { ACCEPT_ATTR } from '../core/imageLoader'
import { Kbd } from './primitives'

/** First-run state: explains the three input routes and offers samples. */
export function EmptyState({
  hasOne,
  onPick,
  onSamples,
}: {
  hasOne: boolean
  onPick: (files: File[]) => void
  onSamples: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div className="pointer-events-auto w-full max-w-md rounded-xl border border-line bg-surface/90 p-6 text-center shadow-2xl backdrop-blur-sm">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-surface-3">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ink-dim">
            <rect x="2.5" y="5" width="12" height="11" rx="1.5" />
            <rect x="9.5" y="8" width="12" height="11" rx="1.5" />
          </svg>
        </div>

        <h1 className="text-[15px] font-semibold text-ink">
          {hasOne ? 'Add the second image' : 'Compare two images'}
        </h1>
        <p className="mx-auto mt-1.5 max-w-xs text-[12px] leading-relaxed text-ink-dim">
          {hasOne
            ? 'One more image and every comparison mode unlocks.'
            : 'Drop two images anywhere, paste from the clipboard, or choose files. Everything happens in this tab — no uploads.'}
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-md bg-accent px-3.5 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-accent-dim"
          >
            Choose images
          </button>
          <button
            type="button"
            onClick={onSamples}
            className="rounded-md border border-line bg-surface-3 px-3.5 py-2 text-[12px] font-medium text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
          >
            Try a sample pair
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            if (files.length > 0) onPick(files)
            event.target.value = ''
          }}
        />

        <div className="mt-5 flex items-center justify-center gap-4 border-t border-line pt-4 text-[10px] text-ink-faint">
          <span className="flex items-center gap-1.5">
            <Kbd>Ctrl</Kbd>
            <Kbd>V</Kbd> paste
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>?</Kbd> shortcuts
          </span>
          <span>PNG · JPG · WebP · AVIF · SVG</span>
        </div>
      </div>
    </div>
  )
}

/** Full-window highlight while a drag is in progress. */
export function DropOverlay({ bothLoaded }: { bothLoaded: boolean }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 p-3">
      <div className="flex h-full w-full items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent/10 backdrop-blur-[2px]">
        {bothLoaded ? (
          // With both slots full, the drop position decides the target, so show
          // the split explicitly rather than making the user guess.
          <div className="grid h-full w-full grid-cols-2">
            <DropHalf label="Replace A" sublabel="Before" />
            <DropHalf label="Replace B" sublabel="After" divider />
          </div>
        ) : (
          <p className="text-[14px] font-semibold text-accent">Drop to load</p>
        )}
      </div>
    </div>
  )
}

function DropHalf({
  label,
  sublabel,
  divider,
}: {
  label: string
  sublabel: string
  divider?: boolean
}) {
  return (
    <div
      className={[
        'flex flex-col items-center justify-center gap-0.5',
        divider ? 'border-l-2 border-dashed border-accent/50' : '',
      ].join(' ')}
    >
      <span className="text-[14px] font-semibold text-accent">{label}</span>
      <span className="text-[11px] text-accent/70">{sublabel}</span>
    </div>
  )
}
