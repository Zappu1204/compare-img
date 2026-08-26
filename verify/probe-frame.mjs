// The mip fixed drawImage (24ms -> 0.01ms), yet frame intervals during a pan are
// still ~22ms. So the cost is not the layer draw. Find out what it actually is.
//
// Measures three things separately:
//   1. how long the app's own rAF callback takes (the paint itself)
//   2. how long a bare rAF loop takes with nothing else running
//   3. whether synthetic pointermove dispatch is itself the expense
import { chromium } from 'playwright'

const BASE = process.argv.includes('--prod')
  ? 'http://localhost:5179/'
  : 'http://localhost:5178/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(BASE, { waitUntil: 'networkidle' })

const gen = (w, h, hue) =>
  page.evaluate(
    async ([width, height, colour]) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#1e2733'
      ctx.fillRect(0, 0, width, height)
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = `hsl(${(colour + i * 7) % 360} 70% 55%)`
        ctx.fillRect(i * 113, i * 83, 500, 380)
      }
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'))
      return Array.from(new Uint8Array(await blob.arrayBuffer()))
    },
    [w, h, hue],
  )

async function setSlot(index, w, h, hue) {
  const bytes = await gen(w, h, hue)
  const inputs = await page.locator('aside input[type="file"]').all()
  await inputs[index].setInputFiles({
    name: `q-${w}x${h}.png`,
    mimeType: 'image/png',
    buffer: Buffer.from(bytes),
  })
  await page.waitForTimeout(1200)
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const at = (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))]
  return `median ${at(0.5).toFixed(2)}ms p95 ${at(0.95).toFixed(2)}ms max ${s[s.length - 1].toFixed(2)}ms (n=${s.length})`
}

// --- baseline: idle rAF interval with nothing loaded ---------------------
const idle = await page.evaluate(async () => {
  const gaps = []
  let last = performance.now()
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => requestAnimationFrame(r))
    const now = performance.now()
    gaps.push(now - last)
    last = now
  }
  return gaps.slice(5)
})
console.log(`idle rAF, no images:            ${stats(idle)}`)

await setSlot(0, 4000, 3000, 200)
await setSlot(1, 4000, 3000, 40)
await page.waitForTimeout(3000)
await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('1')
await page.waitForTimeout(600)

// --- rAF interval with a 12MP pair loaded, but NO interaction ------------
const loadedIdle = await page.evaluate(async () => {
  const gaps = []
  let last = performance.now()
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => requestAnimationFrame(r))
    const now = performance.now()
    gaps.push(now - last)
    last = now
  }
  return gaps.slice(5)
})
console.log(`idle rAF, 12MP pair loaded:     ${stats(loadedIdle)}`)

// --- cost of the app's paint alone, forced via requestRender ------------
const paintCost = await page.evaluate(async () => {
  // Force a repaint each frame by nudging the transform through a real pan, but
  // time only the frame callback body by wrapping rAF.
  const canvas = document.querySelector('canvas')
  const box = canvas.getBoundingClientRect()
  const fire = (type, x, y) =>
    canvas.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 1,
        bubbles: true,
      }),
    )

  const original = window.requestAnimationFrame.bind(window)
  const durations = []
  window.requestAnimationFrame = (cb) =>
    original((ts) => {
      const t0 = performance.now()
      cb(ts)
      durations.push(performance.now() - t0)
    })

  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  fire('pointerdown', cx, cy)
  for (let i = 0; i < 40; i++) {
    fire('pointermove', cx + Math.sin(i / 5) * 200, cy + Math.cos(i / 7) * 120)
    await new Promise((r) => original(r))
  }
  fire('pointerup', cx, cy)
  await new Promise((r) => setTimeout(r, 100))
  window.requestAnimationFrame = original
  return durations.filter((d) => d > 0)
})
console.log(`app rAF callback body:          ${stats(paintCost)}`)

// --- cost of dispatching the synthetic events themselves ----------------
const dispatchCost = await page.evaluate(async () => {
  const canvas = document.querySelector('canvas')
  const box = canvas.getBoundingClientRect()
  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  const times = []
  for (let i = 0; i < 40; i++) {
    const t0 = performance.now()
    canvas.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 9,
        pointerType: 'mouse',
        clientX: cx + i,
        clientY: cy + i,
        bubbles: true,
      }),
    )
    times.push(performance.now() - t0)
    await new Promise((r) => requestAnimationFrame(r))
  }
  return times
})
console.log(`synthetic pointermove dispatch: ${stats(dispatchCost)}`)

await browser.close()
console.log(
  '\nA high "idle rAF" with no images means the harness/headless compositor sets the floor,\nnot the app. Compare the app callback body against the 16.7ms budget.',
)
