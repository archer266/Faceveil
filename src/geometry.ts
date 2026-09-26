export type Region = {
  id: string
  x: number
  y: number
  width: number
  height: number
  source: 'auto' | 'manual'
  enabled: boolean
}

export type ImageSize = { width: number; height: number }

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function normalizeBox(x: number, y: number, width: number, height: number, size: ImageSize) {
  const left = clamp(Math.min(x, x + width), 0, size.width)
  const top = clamp(Math.min(y, y + height), 0, size.height)
  const right = clamp(Math.max(x, x + width), 0, size.width)
  const bottom = clamp(Math.max(y, y + height), 0, size.height)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function expandedBox(region: Region, padding: number, size: ImageSize) {
  const amount = padding / 100
  return normalizeBox(
    region.x - region.width * amount,
    region.y - region.height * amount,
    region.width * (1 + 2 * amount),
    region.height * (1 + 2 * amount),
    size,
  )
}

export function overlapRatio(a: Region, b: Region) {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = a.width * a.height + b.width * b.height - intersection
  return union ? intersection / union : 0
}
