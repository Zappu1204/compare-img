// Plan verification items 3, 6 and 7, which the behavioural suite does not
// reach: mismatched input dimensions, performance on large images, and whether
// exported PNGs are what the plan promises.
//
// Test images are generated in-page as blobs and injected through the file
// inputs, so no fixture files are needed and the sizes can be exact.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'

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
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
await page.goto(BASE, { waitUntil: 'networkidle' })

const blur = () => page.evaluate(() => document.activeElement?.blur())
const pressKey = async (key) => {
  await blur()
  await page.keyboard.press(key)
}

/**
 * Draw a test pattern at an exact size and hand it to the app as a PNG file.
 * The pattern is deterministic so the same content appears at both sizes, which
 * is what makes a resampled comparison meaningful.
 */
async function loadGenerated(specs) {
  const buffers = await page.evaluate(async (list) => {
    const out = []
    for (const { width, height, hue } of list) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#1e2733'
      ctx.fillRect(0, 0, width, height)
      // Content positioned in fractions of the frame, so both sizes show the
      // same picture and only the resolution differs.
      ctx.fillStyle = `hsl(${hue} 70% 60%)`
      ctx.fillRect(width * 0.1, height * 0.1, width * 0.25, height * 0.25)
      ctx.beginPath()
      ctx.arc(width * 0.7, height * 0.35, Math.min(width, height) * 0.15, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = Math.max(1, width / 400)
      for (let i = 1; i < 5; i++) {
        ctx.beginPath()
        ctx.moveTo(0, (height * i) / 5)
        ctx.lineTo(width, (height * i) / 5)
        ctx.stroke()
      }
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'))
      const bytes = new Uint8Array(await blob.arrayBuffer())
      out.push(Array.from(bytes))
    }
    return out
  }, specs)

  // Scope to the slot panel. Indexing every file input on the page is wrong:
  // the empty-state overlay has one of its own and it precedes these in DOM
  // order, so index 0/1 meant "empty state, then slot A" — both files landed in
  // A and every downstream check silently tested a one-image scene.
  const inputs = await page.locator('aside input[type="file"]').all()
  if (inputs.length !== 2) {
    throw new Error(`expected 2 slot inputs, found ${inputs.length}`)
  }
  for (let i = 0; i < specs.length && i < inputs.length; i++) {
    await inputs[i].setInputFiles({
      name: `test-${specs[i].width}x${specs[i].height}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(buffers[i]),
    })
    await page.waitForTimeout(900)
  }

  // Assert the load actually landed where intended, so a future selector
  // regression fails here loudly instead of quietly weakening every check.
  const loaded = await page.locator('aside dd.font-mono.text-ink').allInnerTexts()
  const want = specs.map((s) => `${s.width}×${s.height}`)
  const got = loaded.filter((t) => /^\d+×\d+$/.test(t))
  if (want.some((w, i) => got[i] !== w)) {
    throw new Error(`slots hold ${got.join(', ') || '(none)'}; expected ${want.join(', ')}`)
  }
}

// --- item 3: mismatched dimensions ----------------------------------------
// 1920x1080 and 1600x900 are both 16:9, so a correct resample lines the content
// up exactly and any seam would be the app's own doing.
await loadGenerated([
  { width: 1920, height: 1080, hue: 210 },
  { width: 1600, height: 900, hue: 150 },
])

const sizes = await page.locator('dd.font-mono').allInnerTexts()
check(
  'both true sizes are reported, not just the normalised one',
  sizes.some((t) => t.includes('1920')) && sizes.some((t) => t.includes('1600')),
  sizes.filter((t) => /\d+×\d+/.test(t)).join(' / '),
)

const resampleNotice = await page
  .getByText(/resampl/i)
  .first()
  .innerText()
  .catch(() => '')
check(
  'the resample is disclosed in the UI',
  /resampl/i.test(resampleNotice),
  resampleNotice.replace(/\s+/g, ' ').slice(0, 90) || 'no notice found',
)

// Alignment: in split mode the shared grid lines must cross the divider without
// a step. Sample a column each side of the divider and compare where the bright
// horizontal lines fall.
await pressKey('1')
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/mismatch-split.png` })
const seam = await page.evaluate(() => {
  const canvas = document.querySelector('canvas')
  const ctx = canvas.getContext('2d')
  const mid = Math.floor(canvas.width / 2)
  const colAt = (x) => {
    const { data } = ctx.getImageData(x, 0, 1, canvas.height)
    const rows = []
    for (let y = 0; y < canvas.height; y++) {
      const p = y * 4
      // The grid lines are white-ish over a dark slate background.
      if (data[p] > 150 && data[p + 1] > 150 && data[p + 2] > 150) rows.push(y)
    }
    return rows
  }
  // Weighted centre of each contiguous run, so a line that resampling spread
  // across an extra row is still located at its true centre rather than snapping
  // to a whole pixel.
  const cluster = (rows) => {
    const out = []
    let run = []
    for (const y of rows) {
      if (run.length === 0 || y === run[run.length - 1] + 1) {
        run.push(y)
      } else {
        out.push(run.reduce((a, b) => a + b, 0) / run.length)
        run = [y]
      }
    }
    if (run.length) out.push(run.reduce((a, b) => a + b, 0) / run.length)
    return out
  }
  // Stay clear of the divider's own glow and the label pills.
  const left = cluster(colAt(mid - 30)).filter((y) => y > 60)
  const right = cluster(colAt(mid + 30)).filter((y) => y > 60)
  if (left.length < 3 || right.length < 3) {
    return { ok: false, left: left.length, right: right.length, maxShift: null }
  }
  // Pair each left line with its nearest right line rather than by index: the
  // two columns need not detect the same *count* (a line can fall off the frame,
  // or the divider glow can merge one), and index-pairing then compares lines
  // that are not counterparts at all — which is what made this report a 3.5px
  // seam that is not visible on screen.
  let maxShift = 0
  let paired = 0
  for (const y of left) {
    let best = Infinity
    for (const z of right) best = Math.min(best, Math.abs(z - y))
    // Beyond half a grid spacing there is no counterpart to compare against.
    if (best > 40) continue
    paired++
    maxShift = Math.max(maxShift, best)
  }
  return { ok: paired >= 3, left: left.length, right: right.length, paired, maxShift }
})
check(
  'resampled pair aligns across the divider with no seam',
  seam.ok && seam.maxShift <= 2,
  seam.maxShift === null
    ? `found ${seam.left} lines left vs ${seam.right} right`
    : `${seam.paired} paired lines (${seam.left} left / ${seam.right} right), ` +
      `worst offset ${seam.maxShift.toFixed(1)} device px`,
)

// --- item 7: export fidelity ----------------------------------------------
// The plan asks that the exported view include the divider and labels, and that
// the diff export be at full base resolution rather than viewport resolution.
const viewDownload = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }),
  page.getByTitle(/Export the current view/).click(),
])
  .then(([d]) => d)
  .catch(() => null)

if (!viewDownload) {
  check('view export downloads', false, 'no download event')
} else {
  const path = `${OUT}/export-view.png`
  await viewDownload.saveAs(path)
  const png = readFileSync(path)
  // PNG IHDR: width and height are big-endian uint32 at offsets 16 and 20.
  const w = png.readUInt32BE(16)
  const h = png.readUInt32BE(20)
  // exportView renders at 2x the viewport.
  check(
    'exported view is the viewport at 2x',
    Math.abs(w - 1440 * 2) <= 4 && h > 1400,
    `${w}x${h}`,
  )

  // The divider is a bright vertical line near the middle; labels are pill
  // shapes in the top corners. Both must survive into the file.
  const analysed = await page.evaluate(async (dataUrl) => {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const midX = Math.floor(img.width / 2)
    // Scan a band around the centre for a full-height bright column.
    let dividerFound = false
    for (let x = midX - 12; x <= midX + 12 && !dividerFound; x++) {
      const { data } = ctx.getImageData(x, 0, 1, img.height)
      let bright = 0
      for (let y = 0; y < img.height; y++) {
        const p = y * 4
        if (data[p] > 200 && data[p + 1] > 200 && data[p + 2] > 200) bright++
      }
      if (bright > img.height * 0.7) dividerFound = true
    }
    // Label text: near-white pixels in the top strip, at both edges.
    const strip = (x0, w) => {
      const { data } = ctx.getImageData(x0, 0, w, 70)
      let n = 0
      for (let p = 0; p < data.length; p += 4) {
        if (data[p] > 225 && data[p + 1] > 225 && data[p + 2] > 225) n++
      }
      return n
    }
    return {
      dividerFound,
      leftLabel: strip(0, 320),
      rightLabel: strip(img.width - 320, 320),
    }
  }, `data:image/png;base64,${png.toString('base64')}`)

  check(
    'exported view includes the divider',
    analysed.dividerFound,
    analysed.dividerFound ? 'full-height divider present' : 'no divider column found',
  )
  check(
    'exported view includes both labels',
    analysed.leftLabel > 40 && analysed.rightLabel > 40,
    `${analysed.leftLabel} px left, ${analysed.rightLabel} px right`,
  )
}

// Diff export must be full base resolution (A is 1920x1080 here), regardless of
// the current zoom.
await pressKey('4')
await page.waitForTimeout(1400)
// Match the export button exactly. A loose /diff/i matches the *mode* button
// too ("Difference (4)"), which comes first in the DOM, so .first() would click
// the mode switch and no download would ever fire.
const diffDownload = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }),
  page.getByTitle(/Export the difference map/).click(),
])
  .then(([d]) => d)
  .catch(() => null)

if (!diffDownload) {
  check('diff export downloads', false, 'no download event')
} else {
  const path = `${OUT}/export-diff.png`
  await diffDownload.saveAs(path)
  const png = readFileSync(path)
  const w = png.readUInt32BE(16)
  const h = png.readUInt32BE(20)
  check(
    'exported diff is full base resolution, not viewport resolution',
    w === 1920 && h === 1080,
    `${w}x${h} (base is 1920x1080, viewport is 1440x~830)`,
  )
}

// --- item 6: performance on large images ----------------------------------
// Two 4000x3000 frames, panned continuously.
//
// What is measured, and why it is not the rAF interval: a rAF callback fires at
// the display cadence, so the interval floor is ~16.7ms even with an empty page.
// Measured here, an idle tab with no images loaded reports a median interval of
// 16.7ms — so an "every interval under 16.7ms" test can never pass and says
// nothing about the app. The meaningful question is how much of each frame the
// app itself consumes, so this times the app's own paint and the per-draw cost
// of the layer bitmaps.
await page.evaluate(() => {
  const clear = [...document.querySelectorAll('button')].filter((b) =>
    /^Clear$/.test(b.textContent ?? ''),
  )
  clear.forEach((b) => b.click())
})
await page.waitForTimeout(400)
await loadGenerated([
  { width: 4000, height: 3000, hue: 200 },
  { width: 4000, height: 3000, hue: 40 },
])
await pressKey('1')
// Downscaled copies are built asynchronously after the pair is prepared.
await page.waitForTimeout(3000)

const perf = await page.evaluate(async () => {
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

  // Time the app's own frame callback, and every drawImage it issues.
  const rawRaf = window.requestAnimationFrame.bind(window)
  const frameCost = []
  window.requestAnimationFrame = (cb) =>
    rawRaf((ts) => {
      const t0 = performance.now()
      cb(ts)
      frameCost.push(performance.now() - t0)
    })

  const proto = CanvasRenderingContext2D.prototype
  const rawDraw = proto.drawImage
  const draws = []
  proto.drawImage = function (...args) {
    const src = args[0]
    const t0 = performance.now()
    const out = rawDraw.apply(this, args)
    draws.push({ ms: performance.now() - t0, w: src?.width ?? 0, h: src?.height ?? 0 })
    return out
  }

  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  fire('pointerdown', cx, cy)
  for (let i = 0; i < 90; i++) {
    fire('pointermove', cx + Math.sin(i / 6) * 220, cy + Math.cos(i / 8) * 140)
    await new Promise((r) => rawRaf(r))
  }
  fire('pointerup', cx, cy)
  await new Promise((r) => setTimeout(r, 80))
  window.requestAnimationFrame = rawRaf
  proto.drawImage = rawDraw

  const pick = (xs, q) => {
    const s = [...xs].sort((a, b) => a - b)
    return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0
  }
  const painted = frameCost.filter((d) => d > 0)
  return {
    frames: painted.length,
    frameMedian: pick(painted, 0.5),
    frameP95: pick(painted, 0.95),
    frameWorst: pick(painted, 1),
    drawCount: draws.length,
    drawWorst: pick(draws.map((d) => d.ms), 1),
    // The largest source actually handed to drawImage. If the full 4000-wide
    // bitmap is still being resampled per frame, this reports it.
    largestSource: draws.reduce((m, d) => Math.max(m, d.w), 0),
  }
})
// The app must leave the frame budget almost entirely free: at 60Hz a frame is
// 16.7ms, and the paint should be a small fraction of it.
check(
  'panning two 4000x3000 images leaves the frame budget free',
  perf.frames > 20 && perf.frameP95 < 8,
  `app paint: median ${perf.frameMedian.toFixed(2)}ms, p95 ${perf.frameP95.toFixed(2)}ms, ` +
    `worst ${perf.frameWorst.toFixed(2)}ms over ${perf.frames} painted frames (budget 16.7ms)`,
)
// A 12MP bitmap resampled per frame costs ~24ms on its own, so this also proves
// the pre-downscaled copies are the ones being drawn.
check(
  'large layers are drawn from downscaled copies, not resampled per frame',
  perf.drawCount > 20 && perf.largestSource < 4000 && perf.drawWorst < 4,
  `${perf.drawCount} draws, largest source ${perf.largestSource}px wide, ` +
    `worst single draw ${perf.drawWorst.toFixed(2)}ms`,
)

// Dragging the threshold must not block the main thread.
await pressKey('4')
await page.waitForTimeout(1600)
const responsive = await page.evaluate(async () => {
  const input = document.querySelector('input[aria-label="Threshold"]')
  if (!input) return null
  const gaps = []
  let last = performance.now()
  let running = true
  const tick = () => {
    const now = performance.now()
    gaps.push(now - last)
    last = now
    if (running) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  // Sweep the slider the way a drag would.
  for (let v = 0; v <= 120; v += 6) {
    input.value = String(v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((r) => requestAnimationFrame(r))
  }
  running = false
  await new Promise((r) => setTimeout(r, 60))
  const steady = gaps.slice(3).sort((a, b) => a - b)
  return {
    p95: steady[Math.floor(steady.length * 0.95)],
    worst: steady[steady.length - 1],
    count: steady.length,
  }
})
check(
  'dragging the diff threshold does not block the UI thread',
  responsive !== null && responsive.p95 < 34,
  responsive
    ? `p95 ${responsive.p95.toFixed(1)}ms, worst ${responsive.worst.toFixed(1)}ms over ${responsive.count} frames`
    : 'threshold slider not found',
)
await page.screenshot({ path: `${OUT}/large-diff.png` })

check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

await browser.close()

const failed = results.filter((r) => !r.pass)
writeFileSync('verify/results-extended.json', JSON.stringify(results, null, 2))
console.log(`\n${results.length - failed.length}/${results.length} extended checks passed`)
if (failed.length) {
  console.log('\nFailures:')
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`)
  process.exit(1)
}
