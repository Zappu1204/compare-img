import { CHANNEL_LABEL, type Channel } from '../types'
import { useStore } from '../state/store'
import { Field, Panel, Row, SegmentedControl } from './primitives'

/**
 * Alignment calibration and channel inspection.
 *
 * Offsets are in image pixels, applied to B, so they stay meaningful at any
 * zoom level and feed the diff worker unchanged.
 */
export function AlignPanel() {
  const { state, patch } = useStore()
  const { settings, images } = state
  const bothLoaded = Boolean(images.a && images.b)
  const nudged = settings.offsetX !== 0 || settings.offsetY !== 0

  const nudge = (dx: number, dy: number) => {
    patch({ offsetX: settings.offsetX + dx, offsetY: settings.offsetY + dy })
  }

  return (
    <Panel
      title="Align & inspect"
      actions={
        nudged ? (
          <button
            type="button"
            onClick={() => patch({ offsetX: 0, offsetY: 0 })}
            className="text-[10px] font-medium text-accent hover:underline"
          >
            Reset offset
          </button>
        ) : null
      }
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <span className="block text-[11px] font-medium tracking-wide text-ink-dim uppercase">
            Offset B
          </span>
          <Row>
            <Field label="X">
              <input
                type="number"
                className="num"
                value={settings.offsetX}
                disabled={!bothLoaded}
                onChange={(event) => patch({ offsetX: safeInt(event.target.value) })}
              />
            </Field>
            <Field label="Y">
              <input
                type="number"
                className="num"
                value={settings.offsetY}
                disabled={!bothLoaded}
                onChange={(event) => patch({ offsetY: safeInt(event.target.value) })}
              />
            </Field>
          </Row>
          {/* A D-pad is faster than typing for the sub-pixel hunting this is for. */}
          <div className="grid grid-cols-3 gap-1">
            <span />
            <NudgeButton label="↑" title="Nudge B up (Arrow Up)" onClick={() => nudge(0, -1)} disabled={!bothLoaded} />
            <span />
            <NudgeButton label="←" title="Nudge B left (Arrow Left)" onClick={() => nudge(-1, 0)} disabled={!bothLoaded} />
            <NudgeButton label="↓" title="Nudge B down (Arrow Down)" onClick={() => nudge(0, 1)} disabled={!bothLoaded} />
            <NudgeButton label="→" title="Nudge B right (Arrow Right)" onClick={() => nudge(1, 0)} disabled={!bothLoaded} />
          </div>
          <p className="text-[10px] leading-snug text-ink-faint">
            Arrow keys nudge by 1 px, with Shift by 10 px.
          </p>
        </div>

        <div className="space-y-1">
          <span className="block text-[11px] font-medium tracking-wide text-ink-dim uppercase">
            Channel
          </span>
          <SegmentedControl<Channel>
            label="Colour channel"
            value={settings.channel}
            onChange={(channel) => patch({ channel })}
            options={(['rgb', 'r', 'g', 'b', 'gray'] as Channel[]).map((value) => ({
              value,
              label: CHANNEL_LABEL[value],
              title:
                value === 'rgb'
                  ? 'All channels'
                  : value === 'gray'
                    ? 'Grayscale (luminance only)'
                    : `Isolate the ${CHANNEL_LABEL[value]} channel as brightness`,
            }))}
          />
        </div>

        <div className="space-y-1.5 border-t border-line pt-2.5">
          <Toggle
            label="Overlay labels"
            hint="L"
            checked={settings.showLabels}
            onChange={(showLabels) => patch({ showLabels })}
          />
          <Toggle
            label="Transparency grid"
            hint=""
            checked={settings.checkerboard}
            onChange={(checkerboard) => patch({ checkerboard })}
          />
        </div>
      </div>
    </Panel>
  )
}

function NudgeButton({
  label,
  title,
  onClick,
  disabled,
}: {
  label: string
  title: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className="rounded border border-line bg-surface-3 py-1 text-[12px] text-ink-dim hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-dim hover:text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 accent-[var(--color-accent)]"
      />
      <span className="flex-1">{label}</span>
      {hint && <span className="font-mono text-[10px] text-ink-faint">{hint}</span>}
    </label>
  )
}

/** Empty input should read as 0 rather than NaN. */
function safeInt(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}
