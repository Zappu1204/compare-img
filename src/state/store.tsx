import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import {
  DEFAULT_SETTINGS,
  type LoadedImage,
  type Scene,
  type Settings,
  type Slot,
} from '../types'

/**
 * React owns the UI state; the mutable `Scene` mirrors it for the renderer.
 *
 * Anything the user can see in a control lives in the reducer. Anything the
 * render loop reads every frame also lives on the scene ref, which pointer
 * handlers may mutate directly to avoid a re-render per pointer event.
 */

export interface AppState {
  images: { a: LoadedImage | null; b: LoadedImage | null }
  settings: Settings
  busy: boolean
  error: string | null
  notice: string | null
  showShortcuts: boolean
  panelsOpen: boolean
}

const INITIAL: AppState = {
  images: { a: null, b: null },
  settings: DEFAULT_SETTINGS,
  busy: false,
  error: null,
  notice: null,
  showShortcuts: false,
  panelsOpen: true,
}

type Action =
  | { type: 'setImage'; slot: Slot; image: LoadedImage | null }
  | { type: 'setBoth'; a: LoadedImage; b: LoadedImage }
  | { type: 'swap' }
  | { type: 'patchSettings'; patch: Partial<Settings> }
  | { type: 'resetSettings' }
  | { type: 'busy'; busy: boolean }
  | { type: 'error'; error: string | null }
  | { type: 'notice'; notice: string | null }
  | { type: 'toggleShortcuts'; open?: boolean }
  | { type: 'togglePanels'; open?: boolean }
  | { type: 'clear' }

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'setImage': {
      const previous = state.images[action.slot]
      // Release the old bitmap's memory; nothing else holds a reference.
      if (previous && previous !== action.image) previous.bitmap.close()
      return {
        ...state,
        images: { ...state.images, [action.slot]: action.image },
        error: null,
      }
    }
    case 'setBoth': {
      state.images.a?.bitmap.close()
      state.images.b?.bitmap.close()
      return { ...state, images: { a: action.a, b: action.b }, error: null }
    }
    case 'swap':
      return {
        ...state,
        images: { a: state.images.b, b: state.images.a },
        // The offset was measured for the old orientation, so invert it.
        settings: {
          ...state.settings,
          offsetX: -state.settings.offsetX,
          offsetY: -state.settings.offsetY,
        },
      }
    case 'patchSettings':
      return { ...state, settings: { ...state.settings, ...action.patch } }
    case 'resetSettings':
      // Keep the current mode; resetting should not yank the view away.
      return { ...state, settings: { ...DEFAULT_SETTINGS, mode: state.settings.mode } }
    case 'busy':
      return { ...state, busy: action.busy }
    case 'error':
      return { ...state, error: action.error, busy: false }
    case 'notice':
      return { ...state, notice: action.notice }
    case 'toggleShortcuts':
      return { ...state, showShortcuts: action.open ?? !state.showShortcuts }
    case 'togglePanels':
      return { ...state, panelsOpen: action.open ?? !state.panelsOpen }
    case 'clear':
      state.images.a?.bitmap.close()
      state.images.b?.bitmap.close()
      return { ...INITIAL, settings: state.settings }
    default:
      return state
  }
}

export interface Store {
  state: AppState
  dispatch: React.Dispatch<Action>
  sceneRef: React.RefObject<Scene>
  /** Update settings in both React state and the scene, then repaint. */
  patch: (patch: Partial<Settings>) => void
  /** Registered by the workspace so any control can trigger a repaint. */
  setRenderHook: (fn: (() => void) | null) => void
  requestRender: () => void
}

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL)

  const sceneRef = useRef<Scene>({
    settings: DEFAULT_SETTINGS,
    transform: { scale: 1, tx: 0, ty: 0 },
    prepared: null,
    layers: null,
    layerKey: '',
    diff: null,
    viewport: { width: 1, height: 1 },
    obstructedRight: 0,
    dpr: 1,
    cursor: null,
    pointerInside: false,
    holdSwap: false,
    flickerShowB: false,
    draggingDivider: false,
  })

  const renderHook = useRef<(() => void) | null>(null)

  const requestRender = useCallback(() => {
    renderHook.current?.()
  }, [])

  const setRenderHook = useCallback((fn: (() => void) | null) => {
    renderHook.current = fn
  }, [])

  const patch = useCallback(
    (next: Partial<Settings>) => {
      // Write through to the scene immediately so the next frame is correct
      // even though the React re-render is asynchronous.
      sceneRef.current.settings = { ...sceneRef.current.settings, ...next }
      dispatch({ type: 'patchSettings', patch: next })
      renderHook.current?.()
    },
    [dispatch],
  )

  const store = useMemo<Store>(
    () => ({ state, dispatch, sceneRef, patch, setRenderHook, requestRender }),
    [state, patch, setRenderHook, requestRender],
  )

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used inside a StoreProvider')
  return store
}

/** Convenience: the settings object alone. */
export function useSettings(): Settings {
  return useStore().state.settings
}
