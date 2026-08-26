// Reproduce the "image source is detached" error precisely.
//
// Theory: DiffEngine.dropResult() closes latest.bitmap, but scene.diff still
// references that same object, so the next paint draws a closed bitmap. That
// happens when the pair changes (or diff mode is left and re-entered) while a
// diff result is on screen.
import { chromium } from 'playwright'

const BASE = process.argv.includes('--prod')
  ? 'http://localhost:5179/'
  : 'http://localhost:5178/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(BASE, { waitUntil: 'networkidle' })

const blur = () => page.evaluate(() => document.activeElement?.blur())
const pressKey = async (key) => {
  await blur()
  await page.keyboard.press(key)
}

const gen = (w, h, hue) =>
  page.evaluate(
    async ([width, height, colour]) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#1e2733'
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = `hsl(${colour} 70% 60%)`
      ctx.fillRect(width * 0.1, height * 0.1, width * 0.3, height * 0.3)
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'))
      return Array.from(new Uint8Array(await blob.arrayBuffer()))
    },
    [w, h, hue],
  )

async function setSlot(index, w, h, hue) {
  const bytes = await gen(w, h, hue)
  const inputs = await page.locator('aside input[type="file"]').all()
  await inputs[index].setInputFiles({
    name: `r-${w}x${h}-${hue}.png`,
    mimeType: 'image/png',
    buffer: Buffer.from(bytes),
  })
  await page.waitForTimeout(900)
}

const report = (label) => {
  const found = errors.length > 0
  console.log(`${found ? 'REPRO ' : 'clean '} ${label}${found ? ` — ${errors[0]}` : ''}`)
  errors.length = 0
  return found
}

// Load a pair and get a diff on screen.
await setSlot(0, 1000, 700, 210)
await setSlot(1, 1000, 700, 150)
await pressKey('4')
await page.waitForTimeout(1500)
report('baseline: diff mode showing a result')

// Case 1: replace an image while the diff is displayed.
await setSlot(1, 1000, 700, 40)
await page.waitForTimeout(1200)
const case1 = report('replaced B while diff mode was active')

// Case 2: swap while the diff is displayed.
await pressKey('s')
await page.waitForTimeout(1200)
const case2 = report('swapped A/B while diff mode was active')

// Case 3: replace A with a different *size*, which forces a fresh prepare.
await setSlot(0, 1200, 800, 280)
await page.waitForTimeout(1400)
const case3 = report('replaced A at a new size while diff mode was active')

// Case 4: leave diff mode, change the pair, come back.
await pressKey('1')
await page.waitForTimeout(300)
await setSlot(1, 1200, 800, 90)
await pressKey('4')
await page.waitForTimeout(1500)
const case4 = report('changed the pair outside diff mode, then returned')

await browser.close()
const any = case1 || case2 || case3 || case4
console.log(`\n${any ? 'reproduced' : 'not reproduced'}`)
