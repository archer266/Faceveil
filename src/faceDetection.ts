import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'
import { normalizeBox, overlapRatio, type Region } from './geometry'
import { newRegionId } from './ids'

let detectorsPromise: Promise<FaceDetector[]> | null = null

async function loadDetectors() {
  const root = import.meta.env.BASE_URL
  const vision = await FilesetResolver.forVisionTasks(`${root}wasm`)
  const modelNames = ['blaze_face_full_range', 'blaze_face_short_range']
  const detectors: FaceDetector[] = []
  for (const name of modelNames) {
    detectors.push(await FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: `${root}models/${name}.tflite`, delegate: 'CPU' },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.5,
      minSuppressionThreshold: 0.3,
    }))
  }
  return detectors
}

function getDetectors() {
  if (!detectorsPromise) {
    detectorsPromise = loadDetectors().catch(error => {
      detectorsPromise = null
      throw error
    })
  }
  return detectorsPromise
}

export async function detectFaces(source: HTMLCanvasElement): Promise<Region[]> {
  const detectors = await getDetectors()
  const maxSide = 1600
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(source.width * scale))
  canvas.height = Math.max(1, Math.round(source.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable in this browser.')
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)

  const candidates: Array<Region & { score: number }> = []
  function scan(detector: FaceDetector, x: number, y: number, width: number, height: number) {
    const input = document.createElement('canvas')
    input.width = width
    input.height = height
    input.getContext('2d')?.drawImage(canvas, x, y, width, height, 0, 0, width, height)
    const result = detector.detect(input)
    for (const detection of result.detections) {
      const box = detection.boundingBox
      if (!box) continue
      const scaled = normalizeBox(
        (x + box.originX) / scale,
        (y + box.originY) / scale,
        box.width / scale,
        box.height / scale,
        source,
      )
      if (scaled.width < 12 || scaled.height < 12) continue
      candidates.push({ ...scaled, id: newRegionId(), source: 'auto', enabled: true,
        score: detection.categories[0]?.score ?? 0 })
    }
  }

  // A full-frame pass handles portraits; overlapping tiles help retain small faces in group shots.
  scan(detectors[0], 0, 0, canvas.width, canvas.height)
  scan(detectors[1], 0, 0, canvas.width, canvas.height)
  if (Math.max(canvas.width, canvas.height) > 700) {
    const tileWidth = Math.ceil(canvas.width * 0.57)
    const tileHeight = Math.ceil(canvas.height * 0.57)
    for (const startX of [0, canvas.width - tileWidth]) {
      for (const startY of [0, canvas.height - tileHeight]) {
        scan(detectors[0], startX, startY, tileWidth, tileHeight)
      }
    }
  }

  // Keep the highest confidence box for each face instead of showing duplicate regions.
  candidates.sort((a, b) => b.score - a.score)
  const unique: Region[] = []
  for (const candidate of candidates) {
    if (!unique.some(existing => overlapRatio(existing, candidate) > 0.32)) {
      const { score: _score, ...region } = candidate
      unique.push(region)
    }
  }
  return unique.sort((a, b) => a.y - b.y || a.x - b.x)
}
