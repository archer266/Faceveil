import { overlapRatio, type Region } from './geometry'

export type FaceTrack = { region: Region; lastSeen: number }

// Hold a face box briefly when the detector misses an individual frame.
export function updateTracks(previous: FaceTrack[], detections: Region[], time: number, holdSeconds = 0.55) {
  const available = previous.filter(track => time >= track.lastSeen && time - track.lastSeen <= holdSeconds)
  const matched = new Set<string>()
  const next: FaceTrack[] = []

  for (const detected of detections) {
    let best: FaceTrack | null = null
    let bestOverlap = 0.16
    for (const track of available) {
      if (matched.has(track.region.id)) continue
      const overlap = overlapRatio(track.region, detected)
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        best = track
      }
    }
    if (best) {
      matched.add(best.region.id)
      next.push({ region: { ...detected, id: best.region.id }, lastSeen: time })
    } else {
      next.push({ region: detected, lastSeen: time })
    }
  }
  for (const track of available) {
    if (!matched.has(track.region.id)) next.push(track)
  }
  return next
}
