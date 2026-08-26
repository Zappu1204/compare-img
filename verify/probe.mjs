// Focused probe: measure where the same feature lands in each side-by-side
// pane, and check that zooming at the cursor keeps the pointed-at content put.
import { chromium } from 'playwright'

const BASE = process.argv.includes('--prod')
  ? 'http://localhost:5179/'
  : 'http://localhost:5178/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Try a sample pair' }).click()
await page.waitForTimeout(900)
await page.keyboard.press('2')
await page.waitForTimeout(400)

// Locate the green square (#4ec9a0) in each pane, in pane-local coordinates.
const findSquare = () =>
  page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const ctx = canvas.getContext('2d')
    const dpr = canvas.width / canvas.getBoundingClientRect().width
    const half = canvas.width / 2
    const scan = (x0, x1) => {
      const w = Math.floor(x1 - x0)
      const img = ctx.getImageData(Math.floor(x0), 0, w, canvas.height)
      const d = img.data
      let minX = Infinity, minY = Infinity
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < w; x++) {
          const p = (y * w + x) * 4
          // The mint square: high green, mid red, mid blue.
          if (d[p] > 60 && d[p] < 110 && d[p + 1] > 180 && d[p + 2] > 130 && d[p + 2] < 190) {
            if (x < minX) minX = x
            if (y < minY) minY = y
          }
        }
      }
      return minX === Infinity ? null : { x: minX / dpr, y: minY / dpr }
    }
    return { left: scan(0, half), right: scan(half, canvas.width), dpr }
  })

const found = await findSquare()
const scale = await page
  .locator('span.tabular-nums')
  .last()
  .innerText()
  .then((t) => Number.parseFloat(t) / 100)

if (!found.left || !found.right) {
  console.log('FAIL  could not locate the marker square', JSON.stringify(found))
} else {
  // The square is planted 14 and 9 user units right/down in the after SVG. The
  // sample SVGs declare an 800x500 viewBox but are rasterised at 1600 wide, so
  // one user unit is two raster pixels — the expected offset in the buffer the
  // renderer actually draws is 28 and 18.
  const RASTER = 1600 / 800
  const dx = (found.right.x - found.left.x) / scale
  const dy = (found.right.y - found.left.y) / scale
  const expectX = 14 * RASTER
  const expectY = 9 * RASTER
  console.log(
    `measured offset: ${dx.toFixed(1)}px x, ${dy.toFixed(1)}px y ` +
      `(expected ${expectX}, ${expectY} at scale ${scale.toFixed(3)})`,
  )
  const ok = Math.abs(dx - expectX) < 3 && Math.abs(dy - expectY) < 3
  console.log(`${ok ? 'PASS' : 'FAIL'}  panes agree to within the planted offset`)
}

// The zoom-anchor property is tested in probe-zoom.mjs, which measures whether
// a feature moves rather than sampling one pixel's colour. Sampling colour at
// the anchor was tried here first and abandoned: the probe almost always lands
// on an antialiased edge, where a sub-pixel shift changes the blend completely
// even when the anchor is exactly right, so it reported failures that were not
// real. Measuring the feature is the check that actually distinguishes the two.

await page.screenshot({ path: 'verify/shots/probe-sidebyside.png' })
await browser.close()
