// Diagnostics for the two extended-suite failures that look like real defects:
// the "image source is detached" page error, and frame cost on 4000x3000 pairs.
//
// This measures rather than guesses. For perf it times the actual draw calls in
// isolation, so the answer is "which call is slow", not "a frame is slow".
import { chromium } from 'playwright'

const BASE = process.argv.includes('--prod')
  ? 'http://localhost:5179/'
  : 'http://localhost:5178/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push({ message: e.message, stack: e.stack }))
await page.goto(BASE, { waitUntil: 'networkidle' })

const gen = (specs) =>
  page.evaluate(async (list) => {
    const out = []
    for (const { width, height, hue } of list) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#1e2733'
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = `hsl(${hue} 70% 60%)`
      ctx.fillRect(width * 0.1, height * 0.1, width * 0.25, height * 0.25)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = Math.max(1, width / 400)
      for (let i = 1; i < 5; i++) {
        ctx.beginPath()
        ctx.moveTo(0, (height * i) / 5)
        ctx.lineTo(width, (height * i) / 5)
        ctx.stroke()
      }
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'))
      out.push(Array.from(new Uint8Array(await blob.arrayBuffer())))
    }
    return out
  }, specs)

async function load(specs) {
  const buffers = await gen(specs)
  const inputs = await page.locator('aside input[type="file"]').all()
  for (let i = 0; i < specs.length; i++) {
    await inputs[i].setInputFiles({
      name: `p-${specs[i].width}x${specs[i].height}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(buffers[i]),
    })
    await page.waitForTimeout(900)
  }
}

// --- 1. reproduce the detached-bitmap error -------------------------------
await load([
  { width: 1200, height: 800, hue: 210 },
  { width: 1200, height: 800, hue: 150 },
])
errors.length = 0

console.log('--- clearing slot A while a pair is loaded ---')
await page.locator('aside button', { hasText: 'Clear' }).first().click()
await page.waitForTimeout(600)
console.log(errors.length ? `error after Clear A: ${errors[0].message}` : 'no error after Clear A')
if (errors[0]?.stack) console.log(errors[0].stack.split('\n').slice(0, 4).join('\n'))

errors.length = 0
const remaining = await page.locator('aside button', { hasText: 'Clear' }).count()
if (remaining) {
  await page.locator('aside button', { hasText: 'Clear' }).first().click()
  await page.waitForTimeout(600)
  console.log(errors.length ? `error after Clear B: ${errors[0].message}` : 'no error after Clear B')
}

// --- 2. where the frame time goes on a 12MP pair --------------------------
errors.length = 0
await load([
  { width: 4000, height: 3000, hue: 200 },
  { width: 4000, height: 3000, hue: 40 },
])
await page.waitForTimeout(600)

const cost = await page.evaluate(async () => {
  const canvas = document.querySelector('canvas')
  const ctx = canvas.getContext('2d')
  // Recreate the exact draw the renderer performs: a 4000x3000 bitmap scaled to
  // fit the viewport. Use a bitmap of the same size so the measurement is real.
  const src = document.createElement('canvas')
  src.width = 4000
  src.height = 3000
  const sctx = src.getContext('2d')
  sctx.fillStyle = '#1e2733'
  sctx.fillRect(0, 0, 4000, 3000)
  for (let i = 0; i < 40; i++) {
    sctx.fillStyle = `hsl(${i * 9} 70% 55%)`
    sctx.fillRect(i * 97, i * 71, 400, 300)
  }
  const bitmap = await createImageBitmap(src)

  const scale = Math.min(1440 / 4000, 830 / 3000) // ~0.27, the fit scale
  const time = (label, smoothing, quality, runs = 12) => {
    ctx.imageSmoothingEnabled = smoothing
    if (quality) ctx.imageSmoothingQuality = quality
    // Warm up, then measure.
    ctx.drawImage(bitmap, 0, 0, 4000 * scale, 3000 * scale)
    const t0 = performance.now()
    for (let i = 0; i < runs; i++) {
      ctx.drawImage(bitmap, i % 3, 0, 4000 * scale, 3000 * scale)
    }
    return { label, ms: (performance.now() - t0) / runs }
  }

  const results = [
    time('downscale, smoothing high', true, 'high'),
    time('downscale, smoothing medium', true, 'medium'),
    time('downscale, smoothing low', true, 'low'),
    time('downscale, smoothing off', false, null),
  ]

  // And a pre-downscaled source of the size actually needed.
  const small = document.createElement('canvas')
  small.width = Math.round(4000 * scale)
  small.height = Math.round(3000 * scale)
  small.getContext('2d').drawImage(src, 0, 0, small.width, small.height)
  const smallBitmap = await createImageBitmap(small)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(smallBitmap, 0, 0)
  const t0 = performance.now()
  for (let i = 0; i < 12; i++) ctx.drawImage(smallBitmap, i % 3, 0)
  results.push({ label: 'pre-downscaled 1:1 draw', ms: (performance.now() - t0) / 12 })

  bitmap.close()
  smallBitmap.close()
  return { scale, results }
})

console.log(`\n--- per-drawImage cost at fit scale ${cost.scale.toFixed(3)} (4000x3000 source) ---`)
for (const r of cost.results) console.log(`  ${r.ms.toFixed(2)}ms  ${r.label}`)
console.log('\nsplit mode issues two such draws per frame; the 60fps budget is 16.7ms total.')

await browser.close()
