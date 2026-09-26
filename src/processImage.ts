import { expandedBox, type Region } from './geometry'

export type Effect = 'blur' | 'pixelate' | 'cover'

// Reuse working canvases so processing a long video does not allocate one per face per frame.
let blurCanvas: HTMLCanvasElement | null = null
let pixelCanvas: HTMLCanvasElement | null = null

export function renderImage(
  source: HTMLCanvasElement,
  output: HTMLCanvasElement,
  regions: Region[],
  effect: Effect,
  strength: number,
  padding: number,
) {
  const { width, height } = source
  if (output.width !== width) output.width = width
  if (output.height !== height) output.height = height
  const ctx = output.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable in this browser.')
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(source, 0, 0)

  for (const region of regions) {
    if (!region.enabled) continue
    const box = expandedBox(region, padding, { width, height })
    if (box.width < 1 || box.height < 1) continue

    ctx.save()
    ctx.beginPath()
    ctx.ellipse(
      box.x + box.width / 2,
      box.y + box.height / 2,
      box.width / 2,
      box.height / 2,
      0, 0, Math.PI * 2,
    )
    ctx.clip()

    if (effect === 'cover') {
      ctx.fillStyle = '#1b2230'
      ctx.fillRect(box.x, box.y, box.width, box.height)
    } else if (effect === 'pixelate') {
      const cells = Math.max(3, Math.round(23 - strength * 0.19))
      const tiny = pixelCanvas ?? document.createElement('canvas')
      pixelCanvas = tiny
      tiny.width = cells
      tiny.height = Math.max(1, Math.round(cells * box.height / box.width))
      const tinyCtx = tiny.getContext('2d')
      if (tinyCtx) {
        tinyCtx.drawImage(source, box.x, box.y, box.width, box.height, 0, 0, tiny.width, tiny.height)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(tiny, box.x, box.y, box.width, box.height)
      }
    } else {
      // Sample a larger source area so blur at the oval edge has neighboring pixels.
      const radius = Math.max(12, Math.round(Math.min(box.width, box.height) * (0.13 + strength * 0.0045)))
      const sx = Math.max(0, Math.floor(box.x - radius * 2))
      const sy = Math.max(0, Math.floor(box.y - radius * 2))
      const sw = Math.min(width - sx, Math.ceil(box.width + radius * 4))
      const sh = Math.min(height - sy, Math.ceil(box.height + radius * 4))
      const crop = blurCanvas ?? document.createElement('canvas')
      blurCanvas = crop
      crop.width = sw
      crop.height = sh
      crop.getContext('2d')?.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh)
      ctx.filter = `blur(${radius}px)`
      ctx.drawImage(crop, sx, sy)
      ctx.filter = 'none'
    }
    ctx.restore()
  }
}
