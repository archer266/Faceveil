import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'
import { normalizeBox, overlapRatio, type Region } from './geometry'
import { newRegionId } from './ids'

export type VideoDetectors = { full: FaceDetector; short: FaceDetector }

let videoDetectorsPromise: Promise<VideoDetectors> | null = null

export function loadVideoDetectors() {
  if (!videoDetectorsPromise) {
    videoDetectorsPromise = (async () => {
      const root = import.meta.env.BASE_URL
      const vision = await FilesetResolver.forVisionTasks(`${root}wasm`)
      const make = (name: string) => FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `${root}models/${name}.tflite`, delegate: 'CPU' },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.5,
        minSuppressionThreshold: 0.3,
      })
      const full = await make('blaze_face_full_range')
      const short = await make('blaze_face_short_range')
      return { full, short }
    })().catch(error => {
      videoDetectorsPromise = null
      throw error
    })
  }
  return videoDetectorsPromise
}

export function detectVideoFaces(detectors: VideoDetectors, frame: HTMLCanvasElement, timestamp: number): Region[] {
  const candidates: Array<Region & { score: number }> = []
  for (const detector of [detectors.full, detectors.short]) {
    const result = detector.detectForVideo(frame, timestamp)
    for (const detection of result.detections) {
      const box = detection.boundingBox
      if (!box) continue
      const bounds = normalizeBox(box.originX, box.originY, box.width, box.height, frame)
      if (bounds.width < 12 || bounds.height < 12) continue
      candidates.push({ ...bounds, id: newRegionId(), source: 'auto', enabled: true,
        score: detection.categories[0]?.score ?? 0 })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  const unique: Region[] = []
  for (const candidate of candidates) {
    if (unique.some(existing => overlapRatio(existing, candidate) > 0.32)) continue
    const { score: _score, ...region } = candidate
    unique.push(region)
  }
  return unique
}
