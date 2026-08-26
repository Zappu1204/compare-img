// Does the mip change what the user sees?
//
// A mip is a rendering shortcut, so it must be proven not to alter the picture.
// Four properties, each chosen because a real defect would break it:
//
//   1. At 100% and above the ORIGINAL bitmap is drawn, never a mip. Pixel
//      inspection must show real pixels; this is not negotiable.
//   2. A mip IS used at fit scale, so property 1 is not passing merely because
//      mips never activate.
//   3. Tone is preserved: the average brightness of the drawn region matches the
//      source's. Picking the wrong mip level, or losing part of the image, moves
//      this immediately.
//   4. Geometry is preserved: shapes land where they belong, to sub-pixel
//      accuracy, and fine stripes still alternate rather than smearing.
//
// What is deliberately NOT tested: pixel-for-pixel equality against a single
// direct downscale. Tried first, and it is not a valid criterion — a mip chain
// and a one-step downscale use different filter kernels, so on high-frequency
// detail they legitimately disagree while both being correct. That test reported
// a large delta on a 2px checker and said nothing about whether the app is right.
//
// One trap worth recording, because it produced two convincing false failures:
// the drawn-image rect must NOT come from a bounding box over "pixels that are
// not the workspace background". The label pill is drawn on top at x=14, well
// left of the image, so the box began there and reported 1214px wide for an image
// whose true drawn width was ~1004 — inflating every x-fraction by up to 15% and
// corrupting the tone sample region. Derive the rect from the known aspect ratio
// instead; overlays then cannot contaminate it.
import { chromium } from 'playwright'

const BASE = process.argv.includes('--prod')
  ? 'http://localhost:5179/'
  : 'http://localhost:5178/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(BASE, { waitUntil: 'networkidle' })

let failures = 0
const check = (name, pass, detail) => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// A realistic test image: smooth gradient (tone), hard-edged shapes at known
// fractional positions (geometry), and fine stripes (detail retention).
const PATTERN = `(width, height) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const grad = ctx.createLinearGradient(0, 0, width, height)
  grad.addColorStop(0, '#203040')
  grad.addColorStop(1, '#607080')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, width, height)
  // Shapes at exact fractions of the frame, so their expected screen position
  // is known independently of the zoom level.
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(width * 0.10, height * 0.10, width * 0.12, height * 0.12)
  ctx.fillStyle = '#00ff00'
  ctx.fillRect(width * 0.60, height * 0.20, width * 0.12, height * 0.12)
  ctx.fillStyle = '#0000ff'
  ctx.fillRect(width * 0.30, height * 0.70, width * 0.12, height * 0.12)
  // Fine stripes: coarse enough to survive a 3x downscale, so losing them means
  // real detail loss rather than unavoidable aliasing.
  ctx.fillStyle = '#ffffff'
  for (let x = Math.floor(width * 0.78); x < width * 0.95; x += 12) {
    ctx.fillRect(x, height * 0.4, 6, height * 0.2)
  }
  return canvas
}`

const gen = (w, h) =>
  page.evaluate(
    async ([width, height, src]) => {
      // eslint-disable-next-line no-eval
      const draw = eval(src)
      const canvas = draw(width, height)
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'))
      return Array.from(new Uint8Array(await blob.arrayBuffer()))
    },
    [w, h, PATTERN],
  )

async function setSlot(index, w, h) {
  const bytes = await gen(w, h)
  const inputs = await page.locator('aside input[type="file"]').all()
  await inputs[index].setInputFiles({
    name: `qual-${w}x${h}.png`,
    mimeType: 'image/png',
    buffer: Buffer.from(bytes),
  })
  await page.waitForTimeout(1000)
}

const blur = () => page.evaluate(() => document.activeElement?.blur())
const pressKey = async (key) => {
  await blur()
  await page.keyboard.press(key)
}

// One size, named once: the aspect-ratio rect detection and the "is the source
// 3000px wide" assertions below both depend on these, so they must not drift.
const SRC_W = 3000
const SRC_H = 2400

await setSlot(0, SRC_W, SRC_H)
await setSlot(1, SRC_W, SRC_H)
// Mips are built asynchronously once the pair is prepared.
await page.waitForTimeout(3000)
await pressKey('1')
await page.waitForTimeout(500)

// --- property 1: at 1:1 and above, the original bitmap is used ------------
// Records the destination width alongside the source width. Source alone is not
// enough: "some downscaled copy was used" passes even when the copy is far too
// small and is being blown back up, which is a blurry render and a real defect.
const install = () =>
  page.evaluate(() => {
    const proto = CanvasRenderingContext2D.prototype
    if (!proto.__origDraw) proto.__origDraw = proto.drawImage
    window.__draws = []
    proto.drawImage = function (...args) {
      window.__draws.push({
        w: args[0]?.width ?? 0,
        // The 5- and 9-arg forms put destination width at index 3 and 7.
        dw: args.length >= 9 ? args[7] : args.length >= 5 ? args[3] : null,
      })
      return proto.__origDraw.apply(this, args)
    }
  })
const collect = () =>
  page.evaluate(() => {
    const proto = CanvasRenderingContext2D.prototype
    const out = window.__draws
    proto.drawImage = proto.__origDraw
    return out
  })

for (const preset of ['100%', '200%', '400%']) {
  await page.getByTitle(`Zoom to ${preset}`).click()
  await page.waitForTimeout(350)
  await install()
  // Nudge the view so a fresh paint happens with the tracer installed.
  await page.mouse.move(700, 450)
  await page.mouse.down()
  await page.mouse.move(710, 455)
  await page.mouse.up()
  await page.waitForTimeout(300)
  const layerSources = (await collect()).filter((d) => d.w > 100)
  check(
    `at ${preset} the full-resolution bitmap is drawn, not a mip`,
    layerSources.length > 0 && layerSources.every((d) => d.w === SRC_W),
    `source widths seen: ${[...new Set(layerSources.map((d) => d.w))].join(', ') || 'none'}`,
  )
}

// Confirm a mip *is* used when zoomed out, so the checks above are meaningful
// rather than passing because mips are never active at all.
//
// Fade mode is used for the tone/geometry measurements because it draws the whole
// frame with a single overlay pill in the top-left. Split mode would clip each
// layer at the divider, so a shape spanning it would have a skewed centroid for
// reasons unrelated to the mip.
await pressKey('3')
await page.waitForTimeout(300)
await page.getByTitle('Fit to screen').click()
await page.waitForTimeout(500)
await install()
await page.mouse.move(700, 450)
await page.mouse.down()
await page.mouse.move(706, 453)
await page.mouse.up()
await page.waitForTimeout(300)
const fitDraws = (await collect()).filter((d) => d.w > 100 && d.dw !== null)
check(
  'zoomed out to fit, a downscaled copy is used',
  fitDraws.length > 0 && fitDraws.every((d) => d.w < SRC_W),
  `source widths seen: ${[...new Set(fitDraws.map((d) => d.w))].join(', ') || 'none'}`,
)
// The copy must still be at least as large as the rect it fills. A chain that
// picks too small a level is silently blurry: it downscales further than needed
// and the browser then upscales it back. Verified by mutation — selecting a level
// 4x too small kept tone and centroids intact and only showed up here.
const upscaled = fitDraws.filter((d) => d.w < Math.floor(d.dw) - 1)
check(
  'the downscaled copy is not smaller than the rect it fills',
  upscaled.length === 0,
  upscaled.length === 0
    ? fitDraws
        .map((d) => `${d.w}px source -> ${Math.round(d.dw)}px drawn`)
        .filter((s, i, a) => a.indexOf(s) === i)
        .join(', ')
    : `${upscaled.length} draw(s) upscale a mip: ` +
      `${upscaled[0].w}px source stretched to ${Math.round(upscaled[0].dw)}px`,
)

// Re-fit before measuring. The nudge above was only there to force a repaint with
// the tracer installed, but it leaves the transform panned by (6,3) CSS px — and
// the tone/geometry checks below predict the *fit* rect from first principles, so
// a stray pan reads as a real 0.6%/0.4% geometry error. Which it did, until this
// line existed.
await page.getByTitle('Fit to screen').click()
await page.waitForTimeout(400)

// --- properties 2 and 3: tone and geometry -------------------------------
const sourceBytes = await gen(SRC_W, SRC_H)
const quality = await page.evaluate(async ([bytes, srcW, srcH]) => {
  const canvas = document.querySelector('canvas')
  const ctx = canvas.getContext('2d')
  const shown = ctx.getImageData(0, 0, canvas.width, canvas.height)

  // Where the image *should* be drawn, computed independently of the pixels.
  //
  // "Fit" is deterministic: scale = min((vw - 2*pad) / iw, (vh - 2*pad) / ih) with
  // pad = 24, centred in the viewport; the renderer then applies setTransform(dpr)
  // and places the layer at image * scale + t in CSS px. Recomputing that here —
  // rather than reading the app's transform, and rather than detecting content
  // edges — keeps the oracle independent of the thing under test.
  //
  // Content-edge detection is a proven blind spot: a mip built with a 3px source
  // offset shifts the whole layer, a detected rect shifts with it, and every
  // centroid fraction stays identical to the decimal. A bug that moves the
  // measurement's own origin is invisible to that measurement.
  const dpr = canvas.width / canvas.getBoundingClientRect().width
  const vw = canvas.width / dpr
  const vh = canvas.height / dpr
  const pad = 24
  const fitScale = Math.min((vw - pad * 2) / srcW, (vh - pad * 2) / srcH)
  const w = Math.round(srcW * fitScale * dpr)
  const h = Math.round(srcH * fitScale * dpr)
  const minX = Math.round(((vw - srcW * fitScale) / 2) * dpr)
  const minY = Math.round(((vh - srcH * fitScale) / 2) * dpr)
  if (w < 200 || h < 200 || minX < 0 || minY < 0) {
    return { ok: false, reason: `implausible predicted rect ${w}x${h} at ${minX},${minY}` }
  }
  const d = shown.data

  // The prediction is only trustworthy if the image really is where it says. Check
  // the four corners just inside the predicted rect are image, and that the pixels
  // just outside on each side are the workspace background. This is what converts
  // a shifted layer from "silently cancels out" into a hard failure.
  const isBg = (x, y) => {
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return true
    const p = (y * canvas.width + x) * 4
    return Math.abs(d[p] - 18) <= 10 && Math.abs(d[p + 1] - 18) <= 10 && Math.abs(d[p + 2] - 18) <= 10
  }
  const midY2 = minY + Math.floor(h / 2)
  const midX2 = minX + Math.floor(w / 2)
  const edges = {
    insideLeft: !isBg(minX + 2, midY2),
    outsideLeft: isBg(minX - 3, midY2),
    insideRight: !isBg(minX + w - 3, midY2),
    outsideRight: isBg(minX + w + 2, midY2),
    insideTop: !isBg(midX2, minY + 2),
    outsideTop: isBg(midX2, minY - 3),
    insideBottom: !isBg(midX2, minY + h - 3),
    outsideBottom: isBg(midX2, minY + h + 2),
  }

  // Mean brightness of the drawn region. Sample a central box only: the label
  // pill is drawn on top near the corner, and edge rows blend with the workspace
  // background, both of which would pull the mean for reasons unrelated to the
  // mip. The same relative box is measured in the source, so the two are
  // comparing the same content.
  const inset = 0.12
  const boxOf = (x0, y0, bw, bh) => ({
    x: Math.round(x0 + bw * inset),
    y: Math.round(y0 + bh * inset),
    w: Math.round(bw * (1 - inset * 2)),
    h: Math.round(bh * (1 - inset * 2)),
  })
  const liveBox = boxOf(minX, minY, w, h)
  const live = ctx.getImageData(liveBox.x, liveBox.y, liveBox.w, liveBox.h)
  const meanOf = (data) => {
    let s = 0
    let n = 0
    for (let i = 0; i < data.length; i += 4) {
      s += data[i] + data[i + 1] + data[i + 2]
      n += 3
    }
    return s / n
  }
  const liveMean = meanOf(live.data)

  // The same relative region of the source, drawn at the size the app drew it.
  // Comparing against a crop of the *full-resolution* source is not equivalent:
  // any downscale redistributes energy at edges, so a small difference there is
  // expected and says nothing. Rendering the reference at the same size isolates
  // "did the mip path lose or shift anything" from "does downscaling change
  // per-pixel values at all", which it always does.
  const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' })
  const bitmap = await createImageBitmap(blob)
  const ref = document.createElement('canvas')
  ref.width = w
  ref.height = h
  const rctx = ref.getContext('2d')
  rctx.imageSmoothingEnabled = true
  rctx.imageSmoothingQuality = 'high'
  rctx.drawImage(bitmap, 0, 0, w, h)
  const refBox = boxOf(0, 0, w, h)
  const sourceRegion = rctx.getImageData(refBox.x, refBox.y, refBox.w, refBox.h)
  const sourceMean = meanOf(sourceRegion.data)

  // Geometry: where did each coloured square land? Compare the centroid's
  // position as a fraction of the drawn rect against the fraction it occupies in
  // the source.
  //
  // The match must be strict on the *other* two channels, not just loose on all
  // three. A tolerance of 40 on every channel also accepts the blue-grey gradient
  // background, which dragged all three centroids toward the frame centre and
  // read as a 6-15% geometry error that was entirely the probe's own doing.
  const centroid = (channel) => {
    let sxs = 0
    let sys = 0
    let n = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = ((y + minY) * canvas.width + (x + minX)) * 4
        const r = d[p]
        const g = d[p + 1]
        const b = d[p + 2]
        const value = channel === 0 ? r : channel === 1 ? g : b
        const others = channel === 0 ? [g, b] : channel === 1 ? [r, b] : [r, g]
        // Strongly saturated in one channel and dark in both others: only the
        // planted squares qualify.
        if (value > 190 && others[0] < 90 && others[1] < 90) {
          sxs += x
          sys += y
          n++
        }
      }
    }
    return n < 100 ? null : { fx: sxs / n / w, fy: sys / n / h, pixels: n }
  }

  const shapes = [
    { name: 'red', channel: 0, want: [0.16, 0.16] },
    { name: 'green', channel: 1, want: [0.66, 0.26] },
    { name: 'blue', channel: 2, want: [0.36, 0.76] },
  ].map((s) => {
    const c = centroid(s.channel)
    return {
      name: s.name,
      found: Boolean(c),
      dx: c ? Math.abs(c.fx - s.want[0]) : null,
      dy: c ? Math.abs(c.fy - s.want[1]) : null,
      pixels: c?.pixels ?? 0,
    }
  })

  // Detail retention: the stripe band must still read as alternating light and
  // dark, not a flat smear. Count local contrast across a row through it.
  //
  // The bar is derived from the pattern, not guessed. Stripes are laid down every
  // 12 source px across 17% of the width, so the number visible on screen is
  // known, and each surviving stripe must produce two transitions (up and down).
  // A fixed low threshold like ">= 8" is useless here: a 4x-too-small mip still
  // scored 37 and passed, while a correct render scores ~142.
  const rowY = Math.round(minY + h * 0.5)
  const bandX0 = Math.round(minX + w * 0.78)
  const bandX1 = Math.round(minX + w * 0.95)
  const stripes = Math.floor((srcW * 0.95 - Math.floor(srcW * 0.78)) / 12)
  const row = ctx.getImageData(bandX0, rowY, bandX1 - bandX0, 1).data
  let swings = 0
  let prev = null
  for (let i = 0; i < row.length; i += 4) {
    const v = row[i]
    if (prev !== null && Math.abs(v - prev) > 25) swings++
    prev = v
  }

  bitmap.close()
  return {
    ok: true,
    rect: `${w}x${h}`,
    edges,
    liveMean,
    sourceMean,
    shapes,
    swings,
    stripes,
    // Two transitions per stripe, allowing a quarter of them to be lost to
    // legitimate resampling at this scale.
    minSwings: Math.floor(stripes * 2 * 0.75),
  }
}, [sourceBytes, SRC_W, SRC_H])

if (!quality.ok) {
  check('mip preserves tone', false, quality.reason)
  check('mip preserves geometry', false, quality.reason)
  check('mip retains fine detail', false, quality.reason)
} else {
  // Before trusting any measurement inside the rect, prove the rect is right.
  // Every check below samples relative to it, so a wrong rect does not fail —
  // it quietly reports plausible numbers about the wrong pixels.
  const badEdges = Object.entries(quality.edges)
    .filter(([, ok]) => !ok)
    .map(([name]) => name)
  check(
    'the image occupies exactly the rect the transform predicts',
    badEdges.length === 0,
    badEdges.length === 0
      ? `${quality.rect} rect confirmed on all four edges`
      : `mismatched: ${badEdges.join(', ')} — the layer is not where the transform says`,
  )

  const toneDelta = Math.abs(quality.liveMean - quality.sourceMean)
  check(
    'mip preserves overall tone',
    toneDelta < 4,
    `drawn mean ${quality.liveMean.toFixed(1)} vs source mean ${quality.sourceMean.toFixed(1)} ` +
      `(delta ${toneDelta.toFixed(2)} of 255) in a ${quality.rect} rect`,
  )

  const worstShape = quality.shapes.reduce(
    (m, s) => (s.found ? Math.max(m, s.dx, s.dy) : Infinity),
    0,
  )
  check(
    'mip preserves geometry: shapes land where they belong',
    quality.shapes.every((s) => s.found) && worstShape < 0.006,
    quality.shapes
      .map((s) =>
        s.found
          ? `${s.name} off by ${(s.dx * 100).toFixed(2)}%/${(s.dy * 100).toFixed(2)}%`
          : `${s.name} MISSING`,
      )
      .join(', '),
  )

  check(
    'mip retains fine detail (stripes still alternate)',
    quality.swings >= quality.minSwings,
    `${quality.swings} light/dark transitions across the stripe band ` +
      `(at least ${quality.minSwings} expected for ${quality.stripes} visible stripes)`,
  )
}

await page.screenshot({ path: 'verify/shots/mip-quality.png' })
await browser.close()
console.log(`\n${failures === 0 ? 'all mip quality checks passed' : `${failures} check(s) failed`}`)
if (failures) process.exit(1)
