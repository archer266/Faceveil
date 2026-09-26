import type { ImageSize, Region } from './geometry'

// SVG viewBox coordinates are image pixels. Expand hit targets to a finger-sized area.
export function hitRegion(
  regions: Region[],
  selectedId: string | null,
  point: { x: number; y: number },
  size: ImageSize,
  element: SVGSVGElement,
): { region: Region; kind: 'move' | 'resize' } | null {
  const bounds = element.getBoundingClientRect()
  const radiusX = 24 * size.width / Math.max(bounds.width, 1)
  const radiusY = 24 * size.height / Math.max(bounds.height, 1)
  const selected = regions.find(region => region.id === selectedId)
  if (selected && Math.abs(point.x - selected.x - selected.width) <= radiusX &&
      Math.abs(point.y - selected.y - selected.height) <= radiusY) {
    return { region: selected, kind: 'resize' }
  }
  for (const region of [...regions].reverse()) {
    if (point.x >= region.x - radiusX * .3 && point.x <= region.x + region.width + radiusX * .3 &&
        point.y >= region.y - radiusY * .3 && point.y <= region.y + region.height + radiusY * .3) {
      return { region, kind: 'move' }
    }
  }
  return null
}
