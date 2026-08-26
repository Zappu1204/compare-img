// Does wheel zoom keep the point under the cursor fixed?
//
// Tested the way a user would experience it: find a feature, put the cursor on
// it, zoom, and check the feature did not move. No algebra, and no reliance on
// colour sampling at a single pixel (which usually lands on an antialiased edge
// where a correct anchor still changes the blend).
//
// Two things this deliberately avoids:
//   - Features that are planted differences. The mint square is shifted between
//     A and B, so in split mode a centroid spanning the divider averages both
//     copies and drifts as the divider clip changes.
//   - Features that may be clipped. A partly-clipped shape has a meaningless
//     centroid, so the feature must stay well inside the sampled region.
//
// Split mode is the control: it has no pane offset, so it must pass regardless.
// If the control fails, the harness is wrong rather than the app.
import { chromium } from 'playwright'

const BASE = process.argv.includes('--prod')
  ? 'http://localhost:5179/'
  : 'http://localhost:5178/'

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

/**
 * Centroid and bounding box of a solid colour region, in page coordinates,
 * within a horizontal slice of the canvas so one pane can be isolated.
 *
 * `target` is an RGB triple; only near-exact matches count, so antialiased edge
 * pixels cannot pull the centroid.
 */
const findBlob = (target, fromFraction, toFraction, tolerance = 18) =>
  page.evaluate(
    ([rgb, from, to, tol]) => {
      const canvas = document.querySelector('canvas')
      const ctx = canvas.getContext('2d')
      const box = canvas.getBoundingClientRect()
      const dpr = canvas.width / box.width
      const x0 = Math.floor(canvas.width * from)
      const w = Math.floor(canvas.width * (to - from))
      const { data } = ctx.getImageData(x0, 0, w, canvas.height)
      let sx = 0
      let sy = 0
      let n = 0
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < w; x++) {
          const p = (y * w + x) * 4
          if (
            Math.abs(data[p] - rgb[0]) <= tol &&
            Math.abs(data[p + 1] - rgb[1]) <= tol &&
            Math.abs(data[p + 2] - rgb[2]) <= tol
          ) {
            sx += x
            sy += y
            n++
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      if (n < 200) return null
      const toPageX = (cx) => (x0 + cx) / dpr + box.left
      const toPageY = (cy) => cy / dpr + box.top
      return {
        x: toPageX(sx / n),
        y: toPageY(sy / n),
        pixels: n,
        // Margins to the slice edges, so a clipped blob can be rejected.
        marginLeft: minX,
        marginRight: w - maxX,
        marginTop: minY,
        marginBottom: canvas.height - maxY,
        left: toPageX(minX),
        right: toPageX(maxX),
        top: toPageY(minY),
        bottom: toPageY(maxY),
      }
    },
    [target, fromFraction, toFraction, tolerance],
  )

let failures = 0
const check = (name, pass, detail) => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const BLUE = [76, 154, 255] // circle in A
const AMBER = [240, 180, 41] // the same circle, recoloured, in B

/**
 * Put the cursor on a feature, zoom, and require the feature to stay there.
 * `slice` isolates the pane; `colour` picks the copy belonging to that pane's
 * image, so a planted difference can never be averaged with its counterpart.
 */
async function anchorTest(label, modeKey, colour, slice) {
  await pressKey(modeKey)
  await page.waitForTimeout(300)
  await pressKey('0') // start from fit every time
  await page.waitForTimeout(350)

  const before = await findBlob(colour, slice[0], slice[1])
  if (!before) {
    check(`${label}: feature located`, false, 'feature not found in the pane')
    return
  }
  const clipped = Math.min(before.marginLeft, before.marginRight, before.marginTop) < 3
  if (clipped) {
    check(`${label}: feature fully visible before zoom`, false, 'feature is clipped')
    return
  }

  // Anchor on the feature itself: this is the gesture users actually make.
  await page.mouse.move(before.x, before.y)
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120)
  await page.waitForTimeout(450)

  const after = await findBlob(colour, slice[0], slice[1])
  if (!after) {
    check(`${label}: feature still visible after zoom`, false, 'feature left the pane')
    return
  }
  if (Math.min(after.marginLeft, after.marginRight, after.marginTop) < 3) {
    // Grown past the pane edge: the centroid is no longer trustworthy, so this
    // is reported rather than silently passed or failed on bad data.
    check(
      `${label}: feature fully visible after zoom`,
      false,
      'feature grew past the pane edge; pick a smaller zoom step',
    )
    return
  }

  const dx = after.x - before.x
  const dy = after.y - before.y
  const drift = Math.hypot(dx, dy)
  // The feature grew, so its centroid can shift a little from asymmetric
  // antialiasing; a correct anchor keeps it within a few pixels.
  check(
    `${label}: zoom stays anchored at the cursor`,
    drift < 8,
    `feature centre moved ${drift.toFixed(1)}px (dx ${dx.toFixed(1)}, dy ${dy.toFixed(1)}), ` +
      `size ${(before.right - before.left).toFixed(0)}px -> ${(after.right - after.left).toFixed(0)}px`,
  )
}

// Control: split mode has no pane offset. Sample the left of the divider, where
// A is drawn, and look for A's blue circle.
await anchorTest('split (control)', '1', BLUE, [0, 0.45])

// The subject: side-by-side. The left pane draws A, the right draws B with the
// transform shifted by the pane origin — the case that regressed.
await anchorTest('side-by-side, left pane', '2', BLUE, [0, 0.5])
await anchorTest('side-by-side, right pane', '2', AMBER, [0.5, 1])

await page.screenshot({ path: 'verify/shots/probe-zoom-anchor.png' })
await browser.close()

console.log(
  `\n${failures === 0 ? 'all anchor checks passed' : `${failures} anchor check(s) failed`}`,
)
if (failures) process.exit(1)
