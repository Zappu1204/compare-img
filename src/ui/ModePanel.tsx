import { DEFAULT_SETTINGS, DIFF_STYLE_LABEL, MODE_HINT, MODE_LABEL } from '../types'
import type { DiffStyle } from '../types'
import { useStore } from '../state/store'
import { Panel, SegmentedControl, Slider } from './primitives'

/** Controls for whichever comparison mode is active. */
export function ModePanel() {
  const { state, patch } = useStore()
  const { settings } = state
  const { mode } = settings

  return (
    <Panel title={MODE_LABEL[mode]}>
      <p className="mb-3 text-[11px] leading-snug text-ink-faint">{MODE_HINT[mode]}</p>

      {mode === 'split' && (
        <div className="space-y-3">
          <Slider
            label="Divider"
            value={Math.round(settings.splitPos * 100)}
            min={0}
            max={100}
            display={`${Math.round(settings.splitPos * 100)}%`}
            onChange={(value) => patch({ splitPos: value / 100 })}
            onReset={() => patch({ splitPos: 0.5 })}
          />
          <LabelledRow label="Direction">
            <SegmentedControl
              label="Divider direction"
              value={settings.splitAxis}
              onChange={(splitAxis) => patch({ splitAxis })}
              options={[
                { value: 'vertical', label: 'Vertical', title: 'Vertical divider (X)' },
                { value: 'horizontal', label: 'Horizontal', title: 'Horizontal divider (X)' },
              ]}
            />
          </LabelledRow>
        </div>
      )}

      {mode === 'sidebyside' && (
        <LabelledRow label="Layout">
          <SegmentedControl
            label="Pane layout"
            value={settings.sideAxis}
            onChange={(sideAxis) => patch({ sideAxis })}
            options={[
              { value: 'vertical', label: 'Columns', title: 'Panes side by side (X)' },
              { value: 'horizontal', label: 'Rows', title: 'Panes stacked (X)' },
            ]}
          />
        </LabelledRow>
      )}

      {mode === 'fade' && (
        <Slider
          label="Opacity of B"
          value={Math.round(settings.opacity * 100)}
          min={0}
          max={100}
          display={`${Math.round(settings.opacity * 100)}%`}
          onChange={(value) => patch({ opacity: value / 100 })}
          onReset={() => patch({ opacity: 0.5 })}
        />
      )}

      {mode === 'diff' && (
        <div className="space-y-3">
          <Slider
            label="Threshold"
            value={settings.diffThreshold}
            min={0}
            max={128}
            display={`±${settings.diffThreshold}`}
            onChange={(diffThreshold) => patch({ diffThreshold })}
            onReset={() => patch({ diffThreshold: DEFAULT_SETTINGS.diffThreshold })}
          />
          <p className="-mt-1.5 text-[10px] leading-snug text-ink-faint">
            Ignore differences smaller than this, per channel (0–255). Raise it to hide
            compression noise.
          </p>
          <Slider
            label="Amplify"
            value={settings.diffGain}
            min={1}
            max={6}
            step={0.25}
            display={settings.diffGain === 1 ? 'linear' : `γ 1/${settings.diffGain}`}
            onChange={(diffGain) => patch({ diffGain })}
            onReset={() => patch({ diffGain: DEFAULT_SETTINGS.diffGain })}
          />
          <p className="-mt-1.5 text-[10px] leading-snug text-ink-faint">
            Brighten faint differences without flattening the scale — the colour ramp still
            separates small changes from large ones.
          </p>
          <LabelledRow label="Style">
            <SegmentedControl<DiffStyle>
              label="Difference style"
              value={settings.diffStyle}
              onChange={(diffStyle) => patch({ diffStyle })}
              options={(['heat', 'gray', 'red'] as DiffStyle[]).map((value) => ({
                value,
                label: DIFF_STYLE_LABEL[value],
              }))}
            />
          </LabelledRow>
          {settings.diffStyle === 'heat' && <HeatLegend />}
        </div>
      )}

      {mode === 'flicker' && (
        <div className="space-y-3">
          <Slider
            label="Interval"
            value={settings.flickerMs}
            min={50}
            max={2000}
            step={10}
            display={`${settings.flickerMs} ms · ${(1000 / settings.flickerMs).toFixed(1)} fps`}
            onChange={(flickerMs) => patch({ flickerMs })}
            onReset={() => patch({ flickerMs: DEFAULT_SETTINGS.flickerMs })}
          />
          <button
            type="button"
            onClick={() => patch({ flickerPlaying: !settings.flickerPlaying })}
            className="w-full rounded border border-line bg-surface-3 px-2 py-1.5 text-[12px] font-medium text-ink-dim hover:border-line-strong hover:text-ink"
          >
            {settings.flickerPlaying ? 'Pause' : 'Play'}
            <span className="ml-1.5 text-ink-faint">Space</span>
          </button>
        </div>
      )}

      {mode === 'spyglass' && (
        <div className="space-y-3">
          <Slider
            label="Lens size"
            value={settings.lensRadius}
            min={40}
            max={400}
            display={`${settings.lensRadius} px`}
            onChange={(lensRadius) => patch({ lensRadius })}
            onReset={() => patch({ lensRadius: DEFAULT_SETTINGS.lensRadius })}
          />
          <Slider
            label="Magnification"
            value={settings.lensZoom}
            min={1}
            max={8}
            step={0.1}
            display={`${settings.lensZoom.toFixed(1)}×`}
            onChange={(lensZoom) => patch({ lensZoom })}
            onReset={() => patch({ lensZoom: DEFAULT_SETTINGS.lensZoom })}
          />
        </div>
      )}
    </Panel>
  )
}

function LabelledRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="block text-[11px] font-medium tracking-wide text-ink-dim uppercase">
        {label}
      </span>
      {children}
    </div>
  )
}

/**
 * Key for the heatmap ramp. A colour scale that isn't labelled can't be read —
 * the gradient here is the same blue-to-red sequence the diff worker writes.
 */
function HeatLegend() {
  return (
    <div className="space-y-1">
      <div
        className="h-1.5 w-full rounded-full"
        style={{
          background:
            'linear-gradient(to right, #0050ff, #00ffff, #00ff00, #ffff00, #ff2600)',
        }}
      />
      <div className="flex justify-between text-[10px] text-ink-faint">
        <span>subtle</span>
        <span>strong</span>
      </div>
    </div>
  )
}
