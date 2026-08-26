// Checks for the three defects found by reading screenshots, which the
// paint-sampling suite could not catch: it proves pixels appear, not that they
// appear anywhere a user can see them, nor that a colour scale is readable.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const IS_PROD = process.argv.includes('--prod')
const BASE = IS_PROD ? 'http://localhost:5179/' : 'http://localhost:5178/'
const OUT = IS_PROD ? 'verify/shots-prod' : 'verify/shots'
mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Try a sample pair' }).click()
await page.waitForTimeout(900)

const blur = () => page.evaluate(() => document.activeElement?.blur())
const pressKey = async (key) => {
  await blur()
  await page.keyboard.press(key)
}

/** Where the floating panel column starts, in CSS px. */
const panelLeft = () =>
  page.evaluate(() => {
    const aside = document.querySelector('aside')
    return aside ? aside.getBoundingClientRect().left : Number.POSITIVE_INFINITY
  })

/**
 * Find label pills by scanning for the near-black rounded background the label
 * helper paints, and report the right-most extent of any pill in the top strip.
 */
const topStripPills = () =>
  page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const ctx = canvas.getContext('2d')
    const dpr = canvas.width / canvas.getBoundingClientRect().width
    // The label band sits at y=22 CSS px, height 22 -> sample its middle row.
    const y = Math.round(22 * dpr)
    const row = ctx.getImageData(0, y, canvas.width, 1).data
    let rightMost = -1
    for (let x = 0; x < canvas.width; x++) {
      const p = x * 4
      // Pill background is black at 62% over the image; the text is #ededed.
      // Either way the pill area contains near-white text pixels.
      if (row[p] > 225 && row[p + 1] > 225 && row[p + 2] > 225) rightMost = x
    }
    return { rightMost: rightMost < 0 ? -1 : rightMost / dpr, dpr }
  })

// --- 1. split labels must both be visible, not under the panel -------------
await pressKey('1')
await page.waitForTimeout(400)
const left = await panelLeft()
const pills = await topStripPills()
check(
  'split "After" label is left of the floating panel',
  pills.rightMost > 0 && pills.rightMost < left - 4,
  `label reaches x=${pills.rightMost.toFixed(0)}, panel starts at x=${left.toFixed(0)}`,
)
await page.screenshot({ path: `${OUT}/fix-1-split-labels.png` })

// --- 2. heatmap must use the ramp, not saturate to one colour --------------
await pressKey('4')
await page.waitForTimeout(1300)
const ramp = await page.evaluate(() => {
  const canvas = document.querySelector('canvas')
  const ctx = canvas.getContext('2d')
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  // The heat ramp sweeps hue monotonically from ~240deg (blue, smallest
  // difference) to ~8deg (red, largest), so bucketing by hue measures how much
  // of the ramp is actually in use without hard-coding each band's RGB.
  const hueOf = (r, g, b) => {
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max === min) return -1
    const d = max - min
    let h
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    return h < 0 ? h + 360 : h
  }
  const BANDS = 5
  const LOW = 8
  const HIGH = 240
  const buckets = new Array(BANDS).fill(0)
  let changed = 0
  let minHue = 360
  for (let p = 0; p < data.length; p += 4) {
    const [r, g, b, a] = [data[p], data[p + 1], data[p + 2], data[p + 3]]
    if (a < 200) continue
    if (r < 24 && g < 24 && b < 24) continue // unchanged pixels are black
    const hue = hueOf(r, g, b)
    if (hue < 0 || hue > 300) continue // greys and magentas are not on the ramp
    changed++
    if (hue < minHue) minHue = hue
    // Band 0 is the top of the ramp (red), band 4 the bottom (blue).
    const t = (Math.min(HIGH, Math.max(LOW, hue)) - LOW) / (HIGH - LOW)
    buckets[Math.min(BANDS - 1, Math.floor(t * BANDS))]++
  }
  return { buckets, changed, minHue }
})
const used = ramp.buckets.filter((n) => n > ramp.changed * 0.01)
check(
  'heatmap spans the colour ramp instead of saturating',
  used.length >= 3,
  `${used.length}/5 hue bands in use: [${ramp.buckets.join(', ')}] of ${ramp.changed} px`,
)
// The sample pair's largest difference is a blue circle recoloured to amber, a
// delta of 214 rather than a full 255, so the top of the ramp is approached but
// not reached. Asserting the ramp gets into its warm end is the honest check;
// demanding pure red would only pass for a black-to-white change.
check(
  'strongest difference sits at the warm end of the ramp',
  ramp.minHue < 60,
  `hottest pixel at hue ${ramp.minHue.toFixed(0)}deg (red 8, yellow 60)`,
)
await page.screenshot({ path: `${OUT}/fix-2-diff-ramp.png` })

// Amplify must brighten faint differences without collapsing the ramp: the
// mean position on the ramp should rise, and the ramp should still be a spread
// of hues rather than one saturated colour.
const rampState = () =>
  page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const ctx = canvas.getContext('2d')
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const hueOf = (r, g, b) => {
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      if (max === min) return -1
      const d = max - min
      let h
      if (max === r) h = ((g - b) / d) % 6
      else if (max === g) h = (b - r) / d + 2
      else h = (r - g) / d + 4
      h *= 60
      return h < 0 ? h + 360 : h
    }
    let sum = 0
    let changed = 0
    const seen = new Set()
    for (let p = 0; p < data.length; p += 4) {
      const [r, g, b, a] = [data[p], data[p + 1], data[p + 2], data[p + 3]]
      if (a < 200 || (r < 24 && g < 24 && b < 24)) continue
      const hue = hueOf(r, g, b)
      if (hue < 0 || hue > 300) continue
      changed++
      // Lower hue = hotter = larger difference, so invert for "ramp height".
      sum += 240 - Math.min(240, hue)
      seen.add(Math.floor(hue / 24))
    }
    return { height: changed ? sum / changed : 0, bands: seen.size, changed }
  })

const atLinear = await rampState()
await page.locator('input[aria-label="Amplify"]').fill('3')
await page.waitForTimeout(1000)
const atGain = await rampState()
check(
  'amplify lifts faint differences up the ramp',
  atGain.height > atLinear.height + 2,
  `mean ramp height ${atLinear.height.toFixed(1)} -> ${atGain.height.toFixed(1)}`,
)
check(
  'amplify does not collapse the ramp to one colour',
  atGain.bands >= 3,
  `${atGain.bands} distinct hue bands still present`,
)
await page.locator('input[aria-label="Amplify"]').fill('1')
await page.waitForTimeout(600)

// A colour scale needs a key.
const legend = await page.evaluate(() => {
  const el = [...document.querySelectorAll('div')].find((d) =>
    d.style.background.includes('linear-gradient'),
  )
  return Boolean(el)
})
check('heatmap has a legend explaining the colours', legend)

// --- 3. spyglass label must describe the base image -----------------------
await pressKey('6')
await page.waitForTimeout(300)
await page.mouse.move(600, 450)
await page.waitForTimeout(300)
await page.screenshot({ path: `${OUT}/fix-3-spyglass.png` })
const spyglassLabels = await page.evaluate(
  ([cursorX, cursorY]) => {
    // Read the two label positions by looking for text pixels in the top-left
    // strip and just below the lens. Page coordinates must be converted to
    // canvas-local ones: the canvas starts below the toolbar, so using page Y
    // directly would sample the wrong rows entirely.
    const canvas = document.querySelector('canvas')
    const ctx = canvas.getContext('2d')
    const box = canvas.getBoundingClientRect()
    const dpr = canvas.width / box.width
    const hasTextNear = (cx, cy, w, h) => {
      const x = Math.max(0, Math.round((cx - w / 2) * dpr))
      const y = Math.max(0, Math.round((cy - h / 2) * dpr))
      const width = Math.min(canvas.width - x, Math.round(w * dpr))
      const height = Math.min(canvas.height - y, Math.round(h * dpr))
      if (width <= 0 || height <= 0) return 0
      const d = ctx.getImageData(x, y, width, height).data
      let bright = 0
      for (let p = 0; p < d.length; p += 4) {
        if (d[p] > 225 && d[p + 1] > 225 && d[p + 2] > 225) bright++
      }
      return bright
    }
    // Lens centre in canvas-local space, and the label 18px below its rim.
    const localX = cursorX - box.left
    const localY = cursorY - box.top
    const radius = 130
    return {
      corner: hasTextNear(60, 22, 110, 24),
      underLens: hasTextNear(localX, localY + radius + 18, 200, 26),
    }
  },
  [600, 450],
)
check(
  'spyglass labels both the base image and the lens',
  spyglassLabels.corner > 20 && spyglassLabels.underLens > 20,
  `corner ${spyglassLabels.corner} px, under-lens ${spyglassLabels.underLens} px`,
)

// --- flicker indicator must also clear the panel --------------------------
await pressKey('5')
await page.waitForTimeout(300)
const dot = await page.evaluate(() => {
  const canvas = document.querySelector('canvas')
  const ctx = canvas.getContext('2d')
  const dpr = canvas.width / canvas.getBoundingClientRect().width
  const y = Math.round(22 * dpr)
  const row = ctx.getImageData(0, y, canvas.width, 1).data
  let rightMost = -1
  for (let x = 0; x < canvas.width; x++) {
    const p = x * 4
    // The marker is either #4c9aff or a light grey; both are far from the
    // sample images' palette at this row, so take any bright non-image pixel.
    if (row[p + 3] > 200 && (row[p] > 200 || (row[p + 2] > 200 && row[p] < 140))) {
      rightMost = x
    }
  }
  return rightMost < 0 ? -1 : rightMost / dpr
})
const panelStart = await panelLeft()
check(
  'flicker indicator is left of the floating panel',
  dot > 0 && dot < panelStart - 2,
  `marker reaches x=${dot.toFixed(0)}, panel starts at x=${panelStart.toFixed(0)}`,
)

await browser.close()

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} visual checks passed`)
if (failed.length) {
  console.log('\nFailures:')
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`)
  process.exit(1)
}
