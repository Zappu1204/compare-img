import { useCallback, useEffect, useState } from 'react'
import { filesFromDataTransfer, loadImageFile, loadSample } from '../core/imageLoader'
import { useStore } from '../state/store'
import type { LoadedImage, Slot } from '../types'

/**
 * The three ingestion routes: drag-and-drop, file picker, clipboard paste.
 *
 * Paste reads `clipboardData.files` from the event rather than calling
 * `navigator.clipboard.read()`, which avoids a permission prompt and works in
 * Firefox where the async clipboard read is not available for images.
 */
export function useIngest() {
  const { state, dispatch } = useStore()
  const [dragging, setDragging] = useState(false)

  const setImage = useCallback(
    (slot: Slot, image: LoadedImage) => {
      dispatch({ type: 'setImage', slot, image })
    },
    [dispatch],
  )

  const fail = useCallback(
    (error: unknown) => {
      dispatch({
        type: 'error',
        error: error instanceof Error ? error.message : 'Could not load that image',
      })
    },
    [dispatch],
  )

  /** Load files into explicit slots, or fill A then B when unspecified. */
  const acceptFiles = useCallback(
    async (files: File[], preferred?: Slot) => {
      if (files.length === 0) return
      dispatch({ type: 'busy', busy: true })
      try {
        if (files.length >= 2 && !preferred) {
          const [a, b] = await Promise.all([
            loadImageFile(files[0]),
            loadImageFile(files[1]),
          ])
          dispatch({ type: 'setBoth', a, b })
          dispatch({ type: 'notice', notice: `Loaded ${a.name} and ${b.name}` })
        } else {
          const image = await loadImageFile(files[0])
          const slot = preferred ?? nextSlot(state.images)
          setImage(slot, image)
          dispatch({
            type: 'notice',
            notice: `Loaded ${image.name} as ${slot === 'a' ? 'A (before)' : 'B (after)'}`,
          })
        }
      } catch (error) {
        fail(error)
      } finally {
        dispatch({ type: 'busy', busy: false })
      }
    },
    [dispatch, fail, setImage, state.images],
  )

  const loadSamples = useCallback(async () => {
    dispatch({ type: 'busy', busy: true })
    try {
      const [a, b] = await Promise.all([
        loadSample(`${import.meta.env.BASE_URL}samples/before.svg`, 'sample-before.svg'),
        loadSample(`${import.meta.env.BASE_URL}samples/after.svg`, 'sample-after.svg'),
      ])
      dispatch({ type: 'setBoth', a, b })
      dispatch({ type: 'notice', notice: 'Loaded the sample pair' })
    } catch (error) {
      fail(error)
    } finally {
      dispatch({ type: 'busy', busy: false })
    }
  }, [dispatch, fail])

  // --- clipboard --------------------------------------------------------
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      // Let text inputs keep their own paste behaviour.
      if (isTextTarget(event.target)) return
      const files = filesFromDataTransfer(event.clipboardData)
      if (files.length === 0) return
      event.preventDefault()
      void acceptFiles(files)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [acceptFiles])

  // --- window-level drag and drop ---------------------------------------
  useEffect(() => {
    // dragenter/leave fire per element, so count depth to know when the
    // pointer has genuinely left the window.
    let depth = 0

    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files')

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth++
      setDragging(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDrop = (event: DragEvent) => {
      const files = filesFromDataTransfer(event.dataTransfer)
      event.preventDefault()
      depth = 0
      setDragging(false)
      if (files.length === 0) return
      // With both slots full, which half you drop on picks the target.
      const bothLoaded = Boolean(state.images.a && state.images.b)
      const preferred: Slot | undefined =
        files.length >= 2
          ? undefined
          : bothLoaded
            ? event.clientX < window.innerWidth / 2
              ? 'a'
              : 'b'
            : undefined
      void acceptFiles(files, preferred)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [acceptFiles, state.images.a, state.images.b])

  return { dragging, acceptFiles, loadSamples }
}

function nextSlot(images: { a: LoadedImage | null; b: LoadedImage | null }): Slot {
  if (!images.a) return 'a'
  if (!images.b) return 'b'
  // Both full: replace B, the one people iterate on.
  return 'b'
}

export function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}
