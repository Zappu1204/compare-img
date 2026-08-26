import { MODE_LABEL, MODE_ORDER } from '../types'
import { useStore } from '../state/store'
import { Kbd } from './primitives'

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  {
    title: 'Comparison',
    rows: [
      [['Space'], 'Hold to reveal the other image · play/pause in Flicker'],
      [['1', '–', '6'], 'Switch mode'],
      [['S'], 'Swap A and B'],
      [['X'], 'Flip split or pane direction'],
      [['L'], 'Toggle overlay labels'],
    ],
  },
  {
    title: 'Viewport',
    rows: [
      [['Scroll'], 'Zoom at the cursor'],
      [['Drag'], 'Pan · two-finger pinch to zoom'],
      [['Double-click'], 'Toggle fit and 100%'],
      [['0'], 'Reset zoom and pan'],
      [['↑', '↓', '←', '→'], 'Nudge B by 1 px · Shift for 10 px'],
    ],
  },
  {
    title: 'Workspace',
    rows: [
      [['Ctrl', 'V'], 'Paste an image from the clipboard'],
      [['E'], 'Export the current view as PNG'],
      [['F'], 'Fullscreen'],
      [['H'], 'Hide or show the panels'],
      [['?'], 'This list'],
    ],
  },
]

export function ShortcutsHelp() {
  const { state, dispatch } = useStore()
  if (!state.showShortcuts) return null

  const close = () => dispatch({ type: 'toggleShortcuts', open: false })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={close}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(event) => event.stopPropagation()}
        className="max-h-full w-full max-w-2xl overflow-auto rounded-xl border border-line bg-surface p-5 shadow-2xl"
      >
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-ink">Keyboard &amp; pointer</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded px-2 py-1 text-[11px] text-ink-dim hover:bg-surface-3 hover:text-ink"
          >
            Esc
          </button>
        </header>

        <div className="grid gap-5 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-[10px] font-semibold tracking-widest text-ink-faint uppercase">
                {group.title}
              </h3>
              <dl className="space-y-1.5">
                {group.rows.map(([keys, description]) => (
                  <div key={description} className="flex items-start gap-2.5">
                    <dt className="flex shrink-0 items-center gap-1 pt-px">
                      {keys.map((key, index) =>
                        key === '–' ? (
                          <span key={index} className="text-[10px] text-ink-faint">
                            –
                          </span>
                        ) : (
                          <Kbd key={index}>{key}</Kbd>
                        ),
                      )}
                    </dt>
                    <dd className="text-[11px] leading-snug text-ink-dim">{description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}

          <section>
            <h3 className="mb-2 text-[10px] font-semibold tracking-widest text-ink-faint uppercase">
              Modes
            </h3>
            <dl className="space-y-1.5">
              {MODE_ORDER.map((mode, index) => (
                <div key={mode} className="flex items-center gap-2.5">
                  <dt className="shrink-0">
                    <Kbd>{index + 1}</Kbd>
                  </dt>
                  <dd className="text-[11px] text-ink-dim">{MODE_LABEL[mode]}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        <p className="mt-5 border-t border-line pt-3 text-[10px] leading-relaxed text-ink-faint">
          Every image is decoded and compared inside this browser tab using the Canvas API
          and a Web Worker. No file ever leaves your machine, and the app makes no network
          requests after it loads.
        </p>
      </div>
    </div>
  )
}
