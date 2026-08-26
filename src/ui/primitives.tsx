import type { ReactNode } from 'react'

/** Small shared UI primitives, kept together so styling stays consistent. */

export function IconButton({
  onClick,
  title,
  active,
  disabled,
  children,
}: {
  onClick: () => void
  title: string
  active?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      className={[
        'inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded px-2',
        'border text-[12px] font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'border-accent/60 bg-accent/15 text-accent'
          : 'border-line bg-surface-3 text-ink-dim hover:border-line-strong hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string; title?: string }[]
  onChange: (value: T) => void
  label?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex overflow-hidden rounded border border-line bg-surface-3"
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          title={option.title ?? option.label}
          // Labels here are often a single letter ("R", "G", "B"), which tells a
          // screen reader nothing. The descriptive title becomes the name.
          aria-label={option.title ?? option.label}
          aria-pressed={value === option.value}
          className={[
            'px-2.5 py-1.5 text-[12px] font-medium transition-colors',
            index > 0 ? 'border-l border-line' : '',
            value === option.value
              ? 'bg-accent/15 text-accent'
              : 'text-ink-dim hover:bg-surface-2 hover:text-ink',
          ].join(' ')}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Labelled slider with a live value readout and optional numeric entry. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  display,
  onChange,
  onReset,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  display?: string
  onChange: (value: number) => void
  onReset?: () => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-[11px] font-medium tracking-wide text-ink-dim uppercase">
          {label}
        </label>
        <button
          type="button"
          onClick={onReset}
          disabled={!onReset}
          title={onReset ? 'Reset to default' : undefined}
          className="font-mono text-[11px] text-ink tabular-nums enabled:hover:text-accent disabled:cursor-default"
        >
          {display ?? value}
        </button>
      </div>
      <input
        type="range"
        className="rng"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

export function Panel({
  title,
  children,
  actions,
}: {
  title: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className="rounded-lg border border-line bg-surface/95 p-3 shadow-xl backdrop-blur-sm">
      <header className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold tracking-widest text-ink-faint uppercase">
          {title}
        </h2>
        {actions}
      </header>
      {children}
    </section>
  )
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-1.5">{children}</div>
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-1 items-center gap-1.5">
      <span className="w-3 shrink-0 font-mono text-[11px] text-ink-faint">{label}</span>
      {children}
    </label>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-block min-w-5 rounded border border-line-strong bg-surface-3 px-1.5 py-0.5 text-center font-mono text-[10px] text-ink-dim">
      {children}
    </kbd>
  )
}
