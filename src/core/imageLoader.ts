import type { LoadedImage } from '../types'

export const ACCEPTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/bmp',
  'image/svg+xml',
]

export const ACCEPT_ATTR = `${ACCEPTED_TYPES.join(',')},image/*`

/** Width used when a vector source declares no intrinsic pixel size. */
const SVG_RASTER_WIDTH = 1600

export function isProbablyImage(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  // Some drops arrive with an empty MIME type; fall back to the extension.
  return /\.(png|jpe?g|webp|avif|gif|bmp|svg)$/i.test(file.name)
}

/**
 * Decode a file into an ImageBitmap.
 *
 * Goes via HTMLImageElement rather than `createImageBitmap(blob)` because
 * engine support for SVG-typed blobs in that call is inconsistent — Chrome
 * and Safari have both rejected them. An <img> handles every format uniformly,
 * and lets us detect sizeless SVGs before rasterising.
 */
export async function loadImageFile(file: File): Promise<LoadedImage> {
  if (!isProbablyImage(file)) {
    throw new Error(`"${file.name}" is not a supported image file`)
  }

  const url = URL.createObjectURL(file)
  try {
    const img = await decodeElement(url, file.name)
    const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)

    let width = img.naturalWidth
    let height = img.naturalHeight
    let bitmap: ImageBitmap

    if (isSvg) {
      // A sizeless SVG reports 0 in Firefox and 300x150 in Chrome; in both
      // cases rasterise at a fixed width, keeping the viewBox aspect ratio.
      const ratio = width > 0 && height > 0 ? height / width : await svgRatio(file)
      width = SVG_RASTER_WIDTH
      height = Math.max(1, Math.round(SVG_RASTER_WIDTH * ratio))
      bitmap = await rasterise(img, width, height)
    } else {
      if (!width || !height) throw new Error(`"${file.name}" has no readable dimensions`)
      bitmap = await createImageBitmap(img)
    }

    return {
      bitmap,
      width,
      height,
      name: file.name,
      bytes: file.size,
      type: file.type || 'image/*',
      vector: isSvg,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function decodeElement(url: string, name: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'sync'
    img.onload = () => resolve(img)
    img.onerror = () =>
      reject(new Error(`Could not decode "${name}" — the file may be corrupt`))
    img.src = url
  })
}

/** Read height/width from an SVG's viewBox so rasterising keeps its shape. */
async function svgRatio(file: File): Promise<number> {
  try {
    const text = await file.text()
    const viewBox = /viewBox\s*=\s*["']([^"']+)["']/i.exec(text)
    if (viewBox) {
      const parts = viewBox[1].split(/[\s,]+/).map(Number)
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) return parts[3] / parts[2]
    }
  } catch {
    // Unreadable text content is not fatal — fall through to square.
  }
  return 1
}

async function rasterise(
  img: HTMLImageElement,
  width: number,
  height: number,
): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a 2D drawing context')
  ctx.drawImage(img, 0, 0, width, height)
  return canvas.transferToImageBitmap()
}

/** Load one of the bundled sample images by URL. */
export async function loadSample(url: string, name: string): Promise<LoadedImage> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load sample "${name}"`)
  const blob = await response.blob()
  const type = blob.type || (name.endsWith('.svg') ? 'image/svg+xml' : 'image/png')
  return loadImageFile(new File([blob], name, { type }))
}

/**
 * Pull image files out of a drop or paste event.
 * Clipboard images arrive as `image.png` with no useful name, so label them.
 */
export function filesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return []
  const files = Array.from(dt.files ?? [])
  if (files.length > 0) return files.filter(isProbablyImage)

  // Some sources expose images only through `items`.
  const out: File[] = []
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file && isProbablyImage(file)) out.push(file)
    }
  }
  return out
}
