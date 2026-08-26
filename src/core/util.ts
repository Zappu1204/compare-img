/** Small formatting and math helpers used across the UI. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/**
 * Aspect ratio as a small integer pair when one exists, else a decimal.
 * Photo sizes rarely reduce to anything tidy, so cap the denominator.
 */
export function formatAspect(width: number, height: number): string {
  if (!width || !height) return '—'
  const divisor = gcd(width, height)
  const w = width / divisor
  const h = height / divisor
  if (w <= 40 && h <= 40) return `${w}:${h}`
  return `${(width / height).toFixed(2)}:1`
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`
}

/** Compact count: 1234567 -> "1.23M". Keeps the diff readout narrow. */
export function formatCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(2)}M`
}

export function shortenName(name: string, max = 22): string {
  if (name.length <= max) return name
  const dot = name.lastIndexOf('.')
  if (dot < 0 || name.length - dot > 8) return `${name.slice(0, max - 1)}…`
  const ext = name.slice(dot)
  return `${name.slice(0, max - ext.length - 1)}…${ext}`
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Give the browser a tick to start the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** `image-compare-diff-2026-08-26-143012.png` */
export function timestampedName(kind: string): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  return `image-compare-${kind}-${stamp}.png`
}
