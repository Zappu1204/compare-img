// Verification harness: drives the real app in Chromium and checks behaviour,
// not just that it compiled.
//   node verify/run.mjs              -> against the dev server (port 5178)
//   node verify/run.mjs --prod       -> against `vite preview` (port 5179)
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

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

// The app deliberately ignores shortcuts while an input has focus, so any test
// step that types into a slider must drop focus before using the keyboard.
const blur = () => page.evaluate(() => document.activeElement?.blur())
const pressKey = async (key) => {
  await blur()
  await page.keyboard.press(key)
}
/** Assert which mode is actually active, so a check cannot pass in the wrong one. */
const activeMode = () =>
  page.evaluate(() => {
    const pressed = document.querySelector('header button[aria-pressed="true"]')
    return pressed?.getAttribute('title') ?? 'unknown'
  })

const consoleErrors = []
const pageErrors = []
const requests = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => pageErrors.push(e.message))
page.on('request', (r) =>
  requests.push({ url: r.url(), method: r.method(), hasBody: Boolean(r.postData()) }),
)

await page.goto(BASE, { waitUntil: 'networkidle' })

// --- load the sample pair --------------------------------------------------
await page.getByRole('button', { name: 'Try a sample pair' }).click()
await page.waitForTimeout(900)

const loadedBoth = await page.getByText('A · Before').isVisible()
check('sample pair loads', loadedBoth)

// The samples are 800x500 SVGs; confirm the decode path reported that size,
// which also exercises the SVG rasterisation branch.
const sizeText = await page.locator('dd.font-mono').first().innerText()
check('SVG decoded at declared size', sizeText.includes('1600'), `reported ${sizeText}`)

// Mark where the network stood once everything was loaded, so the privacy
// check below only counts requests caused by user actions.
const requestsAfterLoad = requests.length

// --- walk all six modes ---------------------------------------------------
const modes = ['split', 'sidebyside', 'fade', 'diff', 'flicker', 'spyglass']
for (let i = 0; i < modes.length; i++) {
  await pressKey(String(i + 1))
  await page.waitForTimeout(i === 3 ? 1100 : 350) // diff needs a worker round-trip
  const shot = `${OUT}/${i + 1}-${modes[i]}.png`
  await page.screenshot({ path: shot })

  // A mode is "rendering" if the canvas has non-background pixels.
  const painted = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    if (!canvas) return { ok: false, reason: 'no canvas' }
    const ctx = canvas.getContext('2d')
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let nonBg = 0
    // #121212 is the workspace background.
    for (let p = 0; p < data.length; p += 4 * 97) {
      if (Math.abs(data[p] - 18) > 6 || Math.abs(data[p + 1] - 18) > 6) nonBg++
    }
    return { ok: nonBg > 50, nonBg }
  })
  check(`mode ${i + 1} (${modes[i]}) paints`, painted.ok, `${painted.nonBg} sampled px`)
}

// --- diff correctness -----------------------------------------------------
await pressKey('4')
await page.waitForTimeout(1200)
const readout = await page.locator('text=/px differ/').first().innerText().catch(() => '')
const ratio = Number(/([\d.]+)%/.exec(readout)?.[1] ?? NaN)
// The two sample SVGs differ in four small regions out of an 800x500 frame,
// so a few percent is right; 0% would mean the diff never ran and a large
// number would mean it is flagging identical background.
check(
  'diff finds the known differences',
  ratio > 0.2 && ratio < 12,
  `${ratio}% of pixels differ`,
)

// Raising the threshold to maximum must reduce (not increase) the hit count.
const before = ratio
await page.locator('input[aria-label="Threshold"]').fill('128')
await page.waitForTimeout(900)
const afterText = await page.locator('text=/px differ|identical/').first().innerText()
const after = Number(/([\d.]+)%/.exec(afterText)?.[1] ?? 0)
check('threshold reduces matches', after <= before, `${before}% -> ${after}%`)
await page.locator('input[aria-label="Threshold"]').fill('8')
await page.waitForTimeout(600)

// --- synchronised zoom in side-by-side ------------------------------------
await pressKey('2')
await page.waitForTimeout(300)
// Confirm we really switched: the previous step typed into a slider, and a
// focused input suppresses shortcuts by design.
const modeNow = await activeMode()
check('mode switch works after using a slider', /Side by side/.test(modeNow), modeNow)

await page.mouse.move(720, 450)
for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -120)
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/7-sidebyside-zoomed.png` })

const zoomed = await page.evaluate(() => {
  // With a shared transform, the same image row must appear at the same
  // vertical position in both panes. Compare the two panes' centre rows: the
  // images differ in only four small regions, so a synced pair matches almost
  // everywhere, while a desynced pair (different pan or zoom) would not.
  const canvas = document.querySelector('canvas')
  const ctx = canvas.getContext('2d')
  const half = Math.floor(canvas.width / 2)
  const y = Math.floor(canvas.height / 2)
  const width = half - 24
  const left = ctx.getImageData(12, y, width, 1).data
  const right = ctx.getImageData(half + 12, y, width, 1).data
  let diff = 0
  let opaque = 0
  for (let p = 0; p < width * 4; p += 4) {
    // Ignore the empty gutter either side of the image.
    if (left[p + 3] < 200 && right[p + 3] < 200) continue
    opaque++
    if (Math.abs(left[p] - right[p]) > 24) diff++
  }
  return { mismatchRatio: opaque ? diff / opaque : 1, opaque }
})
check(
  'side-by-side panes stay in sync',
  zoomed.opaque > 100 && zoomed.mismatchRatio < 0.35,
  `${(zoomed.mismatchRatio * 100).toFixed(1)}% of ${zoomed.opaque} sampled px differ`,
)

const scaleText = await page.locator('span.tabular-nums').last().innerText()
check('wheel zoom changed the scale', !scaleText.startsWith('100'), `now ${scaleText}`)

// Zooming must keep the point under the cursor fixed *in each pane*. The second
// pane draws the shared transform shifted by its own origin, so an un-shifted
// anchor pins the wrong image coordinate and content slides away — invisible to
// a check that only asks whether the panes agree with each other.
await pressKey('0')
await page.waitForTimeout(350)
const anchorDrift = await page.evaluate(async () => {
  const canvas = document.querySelector('canvas')
  const ctx = canvas.getContext('2d')
  const box = canvas.getBoundingClientRect()
  const dpr = canvas.width / box.width
  // B's amber circle: only in the right pane, and not a shape whose position
  // differs between the images, so its centroid is unambiguous.
  const findAmber = () => {
    const x0 = Math.floor(canvas.width / 2)
    const w = canvas.width - x0
    const { data } = ctx.getImageData(x0, 0, w, canvas.height)
    let sx = 0
    let sy = 0
    let n = 0
    let minX = Infinity
    let minY = Infinity
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4
        if (
          Math.abs(data[p] - 240) <= 18 &&
          Math.abs(data[p + 1] - 180) <= 18 &&
          Math.abs(data[p + 2] - 41) <= 18
        ) {
          sx += x
          sy += y
          n++
          if (x < minX) minX = x
          if (y < minY) minY = y
        }
      }
    }
    if (n < 200) return null
    return {
      x: (x0 + sx / n) / dpr + box.left,
      y: sy / n / dpr + box.top,
      clipped: minX < 3 || minY < 3,
    }
  }
  const before = findAmber()
  if (!before || before.clipped) return { ok: false, reason: 'feature not cleanly visible' }
  return { ok: true, before }
})
if (!anchorDrift.ok) {
  check('zoom stays anchored at the cursor in the second pane', false, anchorDrift.reason)
} else {
  const { before } = anchorDrift
  await page.mouse.move(before.x, before.y)
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120)
  await page.waitForTimeout(450)
  const moved = await page.evaluate(
    ([bx, by]) => {
      const canvas = document.querySelector('canvas')
      const ctx = canvas.getContext('2d')
      const box = canvas.getBoundingClientRect()
      const dpr = canvas.width / box.width
      const x0 = Math.floor(canvas.width / 2)
      const w = canvas.width - x0
      const { data } = ctx.getImageData(x0, 0, w, canvas.height)
      let sx = 0
      let sy = 0
      let n = 0
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < w; x++) {
          const p = (y * w + x) * 4
          if (
            Math.abs(data[p] - 240) <= 18 &&
            Math.abs(data[p + 1] - 180) <= 18 &&
            Math.abs(data[p + 2] - 41) <= 18
          ) {
            sx += x
            sy += y
            n++
          }
        }
      }
      if (n < 200) return null
      const cx = (x0 + sx / n) / dpr + box.left
      const cy = sy / n / dpr + box.top
      return Math.hypot(cx - bx, cy - by)
    },
    [before.x, before.y],
  )
  check(
    'zoom stays anchored at the cursor in the second pane',
    moved !== null && moved < 8,
    moved === null ? 'feature left the pane entirely' : `feature centre moved ${moved.toFixed(1)}px`,
  )
}

// 0 resets the view back to fit.
await pressKey('0')
await page.waitForTimeout(300)

// --- fade extremes --------------------------------------------------------
await pressKey('3')
await page.waitForTimeout(250)
const sampleAt = () =>
  page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const ctx = canvas.getContext('2d')
    // The sample circle sits around 19% across, 40% down.
    const d = ctx.getImageData(
      Math.round(canvas.width * 0.19),
      Math.round(canvas.height * 0.42),
      1,
      1,
    ).data
    return [d[0], d[1], d[2]]
  })

await page.locator('input[aria-label="Opacity of B"]').fill('0')
await page.waitForTimeout(300)
const atZero = await sampleAt()
await page.locator('input[aria-label="Opacity of B"]').fill('100')
await page.waitForTimeout(300)
const atFull = await sampleAt()
// The circle is blue in A and amber in B, so the two extremes must differ.
check(
  'fade extremes show pure A and pure B',
  Math.abs(atZero[2] - atFull[2]) > 40 || Math.abs(atZero[0] - atFull[0]) > 40,
  `A=rgb(${atZero}) B=rgb(${atFull})`,
)

// --- channel isolation ----------------------------------------------------
await page.getByRole('button', { name: 'Isolate the G channel as brightness' }).click()
await page.waitForTimeout(600)
const grayish = await page.evaluate(() => {
  const canvas = document.querySelector('canvas')
  const ctx = canvas.getContext('2d')
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let coloured = 0
  let checked = 0
  for (let p = 0; p < data.length; p += 4 * 89) {
    const [r, g, b, a] = [data[p], data[p + 1], data[p + 2], data[p + 3]]
    if (a < 200) continue
    checked++
    if (Math.abs(r - g) > 10 || Math.abs(g - b) > 10) coloured++
  }
  return { ratio: checked ? coloured / checked : 1, checked }
})
// An isolated channel is rendered as brightness, so almost nothing should
// retain colour. Overlay labels are the only expected exception.
check(
  'channel isolation removes colour',
  grayish.ratio < 0.08,
  `${(grayish.ratio * 100).toFixed(1)}% of pixels still coloured`,
)
await page.getByRole('button', { name: 'All channels' }).click()
await page.waitForTimeout(400)

// --- swap -----------------------------------------------------------------
const beforeSwap = await page.locator('dd').first().innerText()
await pressKey('s')
await page.waitForTimeout(700)
const afterSwap = await page.locator('dd').first().innerText()
check('swap exchanges A and B', beforeSwap !== afterSwap, `${beforeSwap} -> ${afterSwap}`)

// --- export ---------------------------------------------------------------
await pressKey('1')
await page.waitForTimeout(300)
const download = await Promise.all([
  page.waitForEvent('download', { timeout: 8000 }),
  page.getByTitle(/Export the current view/).click(),
])
  .then(([d]) => d)
  .catch(() => null)
check('export produces a PNG download', Boolean(download), download?.suggestedFilename() ?? 'no download event')

// --- shortcuts overlay ----------------------------------------------------
await pressKey('?')
await page.waitForTimeout(250)
const helpOpen = await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).isVisible()
check('shortcuts overlay opens', helpOpen)
await pressKey('Escape')
await page.waitForTimeout(200)

// --- privacy: nothing leaves the machine ----------------------------------
// The claim being tested is "no image data is uploaded", so classify rather
// than merely count. Cross-origin traffic and any request carrying a body are
// violations; same-origin GETs are the app fetching its own code (in dev, Vite's
// client and the worker module), which is why this suite is also run against the
// production build where those disappear.
const userRequests = requests.slice(requestsAfterLoad).filter((r) => !r.url.startsWith('data:'))
const crossOrigin = userRequests.filter((r) => !r.url.startsWith(BASE))
const withBody = userRequests.filter((r) => r.method !== 'GET' || r.hasBody)

check(
  'no cross-origin requests',
  crossOrigin.length === 0,
  crossOrigin.length ? crossOrigin.map((r) => r.url).join(', ') : 'clean',
)
check(
  'no request carries a body (nothing uploaded)',
  withBody.length === 0,
  withBody.length ? withBody.map((r) => `${r.method} ${r.url}`).join(', ') : 'clean',
)
if (IS_PROD) {
  // The worker chunk is fetched lazily, the first time difference mode is used,
  // so a request for it is expected. What must never appear is a request for
  // anything that is not app code.
  const notAppCode = userRequests.filter((r) => !/\.(js|css|mjs|svg|html|ico|woff2?)($|\?)/.test(r.url))
  check(
    'production build requests only its own code',
    notAppCode.length === 0,
    notAppCode.length
      ? notAppCode.map((r) => r.url).join(', ')
      : `${userRequests.length} asset GET(s): ${userRequests.map((r) => r.url.replace(BASE, '')).join(', ')}`,
  )
} else {
  console.log(
    `NOTE  ${userRequests.length} same-origin dev-server GET(s) ignored: ${userRequests
      .map((r) => r.url.replace(BASE, ''))
      .join(', ')}`,
  )
}

// --- no runtime errors ----------------------------------------------------
check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

await page.screenshot({ path: `${OUT}/final.png` })
await browser.close()

const failed = results.filter((r) => !r.pass)
writeFileSync('verify/results.json', JSON.stringify(results, null, 2))
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('\nFailures:')
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`)
  process.exit(1)
}
