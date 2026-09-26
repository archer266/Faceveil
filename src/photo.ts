const MAX_PIXELS = 40_000_000
const MOBILE_PIXELS = 16_000_000
const MOBILE_SIDE = 4096
const PREVIEW_SIDE = 1600

type DecodedPhoto = {
  image: CanvasImageSource
  width: number
  height: number
  release: () => void
}

async function decodePhoto(file: File): Promise<DecodedPhoto> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { image: bitmap, width: bitmap.width, height: bitmap.height,
        release: () => bitmap.close() }
    } catch {
      // Some mobile browsers can display a camera photo in <img> but cannot
      // create an ImageBitmap from it.
    }
  }

  const url = URL.createObjectURL(file)
  const image = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('This browser could not open the photo. Try a JPEG or PNG.'))
      image.src = url
    })
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
  return { image, width: image.naturalWidth, height: image.naturalHeight,
    release: () => URL.revokeObjectURL(url) }
}

export async function openPhotoCanvas(file: File, useMobileLimit: boolean) {
  const decoded = await decodePhoto(file)
  try {
    const { width, height } = decoded
    if (!width || !height) throw new Error('This photo has no readable dimensions.')
    if (width * height > MAX_PIXELS) {
      throw new Error('This image is over 40 megapixels. Please resize it before opening.')
    }
    const scale = useMobileLimit
      ? Math.min(1, MOBILE_SIDE / Math.max(width, height), Math.sqrt(MOBILE_PIXELS / (width * height)))
      : 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Your browser could not open a canvas for this photo.')
    context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height)
    return { canvas, reduced: scale < 1 }
  } finally {
    decoded.release()
  }
}

export function makePreviewSource(source: HTMLCanvasElement) {
  if (Math.max(source.width, source.height) <= PREVIEW_SIDE) return source
  const scale = PREVIEW_SIDE / Math.max(source.width, source.height)
  const preview = document.createElement('canvas')
  preview.width = Math.max(1, Math.round(source.width * scale))
  preview.height = Math.max(1, Math.round(source.height * scale))
  const context = preview.getContext('2d')
  if (!context) throw new Error('Your browser could not preview this photo.')
  context.drawImage(source, 0, 0, preview.width, preview.height)
  return preview
}
