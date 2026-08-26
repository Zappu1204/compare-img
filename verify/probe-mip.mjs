// Is the mip actually being drawn, and where does the frame time really go?
//
// Patches CanvasRenderingContext2D.prototype.drawImage to record the source size
// and per-call cost of every draw the renderer makes. That answers "is the mip
// being used" directly, rather than inferring it from frame times.
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
    name: `m-${w}x${h}.png`,
    mimeType: 'image/png',
    buffer: Buffer.from(bytes),
  })
  await page.waitForTimeout(1200)
}

await setSlot(0, 4000, 3000, 200)
await setSlot(1, 4000, 3000, 40)
// Mip building is async; give it room to finish.
await page.waitForTimeout(3000)
await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('1')
await page.waitForTimeout(600)

const trace = await page.evaluate(async () => {
  const proto = CanvasRenderingContext2D.prototype
  const original = proto.drawImage
  const calls = []
  proto.drawImage = function (...args) {
    const src = args[0]
    const t0 = performance.now()
    const out = original.apply(this, args)
    const ms = performance.now() - t0
    calls.push({
      w: src?.width ?? 0,
      h: src?.height ?? 0,
      // 5-arg form is dx,dy,dw,dh — the layer draws.
      dw: args.length >= 5 ? Math.round(args[3]) : null,
      ms,
    })
    return out
  }

  // Drive a pan so the renderer paints repeatedly.
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
  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  fire('pointerdown', cx, cy)
  for (let i = 0; i < 40; i++) {
    fire('pointermove', cx + Math.sin(i / 5) * 200, cy + Math.cos(i / 7) * 120)
    await new Promise((r) => requestAnimationFrame(r))
  }
  fire('pointerup', cx, cy)
  await new Promise((r) => setTimeout(r, 100))
  proto.drawImage = original

  // Group by source size so the mip level in use is obvious.
  const groups = new Map()
  for (const c of calls) {
    const key = `${c.w}x${c.h} -> ${c.dw}px wide`
    const g = groups.get(key) ?? { key, n: 0, total: 0, max: 0 }
    g.n++
    g.total += c.ms
    g.max = Math.max(g.max, c.ms)
    groups.set(key, g)
  }
  return {
    totalCalls: calls.length,
    groups: [...groups.values()].sort((a, b) => b.total - a.total),
  }
})

console.log(`--- ${trace.totalCalls} drawImage calls during a pan ---`)
for (const g of trace.groups) {
  console.log(
    `  ${g.n.toString().padStart(4)} calls  mean ${(g.total / g.n).toFixed(2)}ms  max ${g.max.toFixed(1)}ms   ${g.key}`,
  )
}
console.log('\nIf a 4000x3000 source still appears, the mip is not being used.')

await browser.close()
