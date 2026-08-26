import { MODE_LABEL, MODE_ORDER, type CompareMode } from '../types'
import { useStore } from '../state/store'
import { IconButton } from './primitives'

/**
 * Top toolbar: mode switcher, zoom presets, view actions, export.
 * Kept to a single row so the canvas keeps the maximum vertical space.
 */
export function Toolbar({
  onZoom,
  onFit,
  onReset,
  onFullscreen,
  onExportView,
  onExportDiff,
  scale,
}: {
  onZoom: (scale: number) => void
  onFit: () => void
  onReset: () => void
  onFullscreen: () => void
  onExportView: () => void
  onExportDiff: () => void
  scale: number
}) {
  const { state, dispatch, patch } = useStore()
  const { settings, images, panelsOpen } = state
  const bothLoaded = Boolean(images.a && images.b)
  const anyLoaded = Boolean(images.a || images.b)

  return (
    <header className="pointer-events-auto flex flex-wrap items-center gap-2 border-b border-line bg-surface/95 px-3 py-2 backdrop-blur-sm">
      <div className="flex items-center gap-2 pr-1">
        <span className="text-[13px] font-semibold tracking-tight text-ink">
          Image Compare
        </span>
        <span
          title="Images are decoded and compared in this browser tab. Nothing is uploaded to any server."
          className="hidden items-center gap-1 rounded-full border border-ok/30 bg-ok/10 px-2 py-0.5 text-[10px] font-medium text-ok sm:inline-flex"
        >
          <LockIcon />
          100% local
        </span>
      </div>

      <div className="flex items-center overflow-hidden rounded border border-line bg-surface-3">
        {MODE_ORDER.map((mode, index) => (
          <button
            key={mode}
            type="button"
            onClick={() => patch({ mode })}
            disabled={!bothLoaded}
            title={`${MODE_LABEL[mode]} (${index + 1})`}
            aria-pressed={settings.mode === mode}
            className={[
              'flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium transition-colors',
              index > 0 ? 'border-l border-line' : '',
              'disabled:cursor-not-allowed disabled:opacity-40',
              settings.mode === mode
                ? 'bg-accent/15 text-accent'
                : 'text-ink-dim enabled:hover:bg-surface-2 enabled:hover:text-ink',
            ].join(' ')}
          >
            <ModeIcon mode={mode} />
            <span className="hidden lg:inline">{MODE_LABEL[mode]}</span>
          </button>
        ))}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-1.5 rounded border border-line bg-surface-3 px-1.5 py-1">
          <button
            type="button"
            onClick={onFit}
            disabled={!anyLoaded}
            title="Fit to screen"
            className="px-1 text-[11px] font-medium text-ink-dim hover:text-ink disabled:opacity-40"
          >
            Fit
          </button>
          {[1, 2, 4].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onZoom(preset)}
              disabled={!anyLoaded}
              title={`Zoom to ${preset * 100}%`}
              className={[
                'px-1 text-[11px] font-medium disabled:opacity-40',
                Math.abs(scale - preset) < 0.005
                  ? 'text-accent'
                  : 'text-ink-dim hover:text-ink',
              ].join(' ')}
            >
              {preset * 100}%
            </button>
          ))}
          <span className="w-12 border-l border-line pl-1.5 text-right font-mono text-[11px] text-ink tabular-nums">
            {formatScale(scale)}
          </span>
        </div>

        <IconButton onClick={() => dispatch({ type: 'swap' })} title="Swap A and B (S)" disabled={!bothLoaded}>
          <SwapIcon />
        </IconButton>
        <IconButton onClick={onReset} title="Reset zoom and pan (0)" disabled={!anyLoaded}>
          <ResetIcon />
        </IconButton>
        <IconButton
          onClick={() => dispatch({ type: 'togglePanels' })}
          title={panelsOpen ? 'Hide panels (H)' : 'Show panels (H)'}
          active={!panelsOpen}
        >
          <PanelIcon />
        </IconButton>
        <IconButton onClick={onFullscreen} title="Fullscreen (F)">
          <FullscreenIcon />
        </IconButton>

        <div className="flex items-center overflow-hidden rounded border border-line bg-surface-3">
          <button
            type="button"
            onClick={onExportView}
            disabled={!anyLoaded}
            title="Export the current view as PNG (E)"
            className="px-2.5 py-1.5 text-[12px] font-medium text-ink-dim hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            Export view
          </button>
          <button
            type="button"
            onClick={onExportDiff}
            disabled={settings.mode !== 'diff'}
            title="Export the difference map at full resolution (switch to Difference mode first)"
            className="border-l border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-dim hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            Diff
          </button>
        </div>

        <IconButton onClick={() => dispatch({ type: 'toggleShortcuts' })} title="Keyboard shortcuts (?)">
          <span className="font-mono">?</span>
        </IconButton>
      </div>
    </header>
  )
}

function formatScale(scale: number): string {
  if (scale >= 10) return `${Math.round(scale * 100)}%`
  if (scale >= 1) return `${(scale * 100).toFixed(0)}%`
  return `${(scale * 100).toFixed(1)}%`
}

// --- icons: 14px line art, matching the toolbar's weight ------------------

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function ModeIcon({ mode }: { mode: CompareMode }) {
  switch (mode) {
    case 'split':
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" {...stroke}>
          <rect x="2" y="3" width="12" height="10" rx="1" />
          <path d="M8 1.5v13" />
        </svg>
      )
    case 'sidebyside':
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" {...stroke}>
          <rect x="1.5" y="3.5" width="5.5" height="9" rx="1" />
          <rect x="9" y="3.5" width="5.5" height="9" rx="1" />
        </svg>
      )
    case 'fade':
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" {...stroke}>
          <circle cx="6" cy="8" r="4.5" />
          <circle cx="10" cy="8" r="4.5" />
        </svg>
      )
    case 'diff':
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" {...stroke}>
          <rect x="2" y="3" width="12" height="10" rx="1" />
          <path d="M5 10.5 7 6l2 3 1.5-2 1.5 3.5z" />
        </svg>
      )
    case 'flicker':
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" {...stroke}>
          <path d="M3 5.5h8M9 3 11 5.5 9 8" />
          <path d="M13 10.5H5M7 8 5 10.5 7 13" />
        </svg>
      )
    case 'spyglass':
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" {...stroke}>
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" />
        </svg>
      )
  }
}

function LockIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 16 16" {...stroke} strokeWidth={2}>
      <rect x="3.5" y="7" width="9" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  )
}

function SwapIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" {...stroke}>
      <path d="M2.5 5.5h9M9.5 3 12 5.5 9.5 8" />
      <path d="M13.5 10.5h-9M6.5 8 4 10.5 6.5 13" />
    </svg>
  )
}

function ResetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" {...stroke}>
      <path d="M13 8a5 5 0 1 1-1.6-3.7" />
      <path d="M13.5 2.5v3h-3" />
    </svg>
  )
}

function FullscreenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" {...stroke}>
      <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
    </svg>
  )
}

function PanelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" {...stroke}>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <path d="M10.5 3v10" />
    </svg>
  )
}
