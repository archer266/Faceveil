import { useEffect, useRef, useState, type PointerEvent } from 'react'
import {
  ArrowDownToLine, Check, CircleHelp, Eye, EyeOff, ImagePlus, MousePointer2,
  Pause, Play, Plus, ScanFace, ShieldCheck, SlidersHorizontal, Trash2,
  Volume2, VolumeX, X,
} from 'lucide-react'
import { clamp, normalizeBox, type Region } from './geometry'
import { renderImage, type Effect } from './processImage'
import { detectVideoFaces, loadVideoDetectors, type VideoDetectors } from './videoDetection'
import { updateTracks, type FaceTrack } from './videoTracking'
import { canShareFile, downloadFile, isTouchDevice, shareFile } from './mobileMedia'
import { hitRegion } from './touchRegions'

type Props = { file: File; onReplace: () => void; onClose: () => void }
type VideoInfo = { width: number; height: number; duration: number }
type AudioGraph = {
  context: AudioContext
  previewGain: GainNode
  destination: MediaStreamAudioDestinationNode
}
type Recording = {
  recorder: MediaRecorder
  stream: MediaStream
  chunks: Blob[]
  mimeType: string
  save: boolean
}
type Interaction =
  | { kind: 'draw'; id: string; x: number; y: number }
  | { kind: 'move' | 'resize'; id: string; x: number; y: number; original: Region }

const MAX_SIDE = 1280
const MAX_HEIGHT = 720

function timeLabel(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00'
  const value = Math.floor(seconds)
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}

function recordingType() {
  if (typeof MediaRecorder === 'undefined') return ''
  return [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
  ].find(type => MediaRecorder.isTypeSupported(type)) ?? ''
}

export default function VideoEditor({ file, onReplace, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const sourceRef = useRef<HTMLCanvasElement | null>(null)
  const detectorsRef = useRef<VideoDetectors | null>(null)
  const tracksRef = useRef<FaceTrack[]>([])
  const facesRef = useRef<Region[]>([])
  const timestampRef = useRef(0)
  const lastUiRef = useRef(0)
  const lastFrameAtRef = useRef(0)
  const lastMediaTimeRef = useRef(-1)
  const loopRef = useRef<{ kind: 'video' | 'animation'; id: number } | null>(null)
  const watchdogRef = useRef<number | null>(null)
  const drawingRef = useRef<() => void>(() => {})
  const interactionRef = useRef<Interaction | null>(null)
  const audioRef = useRef<AudioGraph | null>(null)
  const recordingRef = useRef<Recording | null>(null)
  const aliveRef = useRef(true)
  const loadingStartedRef = useRef(false)
  const settingsRef = useRef({ effect: 'blur' as Effect, strength: 82, padding: 24, showOriginal: false })
  const fixedRef = useRef<Region[]>([])

  const [url, setUrl] = useState('')
  const [info, setInfo] = useState<VideoInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [fixedRegions, setFixedRegions] = useState<Region[]>([])
  const [displayFaces, setDisplayFaces] = useState<Region[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [effect, setEffect] = useState<Effect>('blur')
  const [strength, setStrength] = useState(82)
  const [padding, setPadding] = useState(24)
  const [showOriginal, setShowOriginal] = useState(false)
  const [addMode, setAddMode] = useState(false)
  const [muted, setMuted] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [time, setTime] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [readyFile, setReadyFile] = useState<File | null>(null)
  const [readyUrl, setReadyUrl] = useState('')
  const [readyToExport, setReadyToExport] = useState(false)

  settingsRef.current = { effect, strength, padding, showOriginal }
  fixedRef.current = fixedRegions

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  useEffect(() => {
    if (!readyFile) { setReadyUrl(''); return }
    const objectUrl = URL.createObjectURL(readyFile)
    setReadyUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [readyFile])

  useEffect(() => { setReadyFile(null) }, [fixedRegions, effect, strength, padding])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      cancelLoop()
      if (recordingRef.current) {
        recordingRef.current.save = false
        if (recordingRef.current.recorder.state !== 'inactive') recordingRef.current.recorder.stop()
        recordingRef.current.stream.getVideoTracks().forEach(track => track.stop())
      }
      videoRef.current?.pause()
      void audioRef.current?.context.close()
    }
  }, [])

  useEffect(() => {
    if (!exporting) drawingRef.current()
  }, [fixedRegions, effect, strength, padding, showOriginal, exporting])

  useEffect(() => {
    if (audioRef.current) audioRef.current.previewGain.gain.value = muted || exporting ? 0 : 1
  }, [muted, exporting])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId &&
          !(event.target instanceof HTMLInputElement)) {
        setFixedRegions(current => current.filter(region => region.id !== selectedId))
        setSelectedId(null)
      }
      if (event.key === 'Escape') { setAddMode(false); setSelectedId(null) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId])

  function cancelLoop() {
    const video = videoRef.current
    const loop = loopRef.current
    if (loop) {
      if (loop.kind === 'video') video?.cancelVideoFrameCallback(loop.id)
      else cancelAnimationFrame(loop.id)
      loopRef.current = null
    }
    if (watchdogRef.current !== null) {
      window.clearInterval(watchdogRef.current)
      watchdogRef.current = null
    }
  }

  function frameLoop() {
    const video = videoRef.current
    if (!video || video.paused || video.ended || loopRef.current) return
    if (watchdogRef.current === null) {
      watchdogRef.current = window.setInterval(() => {
        if (video.paused || video.ended) return
        if (performance.now() - lastFrameAtRef.current > 180) drawFrame(true, video.currentTime)
      }, 45)
    }
    if (typeof video.requestVideoFrameCallback === 'function') {
      const id = video.requestVideoFrameCallback((_now, metadata) => {
        loopRef.current = null
        drawFrame(true, metadata.mediaTime)
        frameLoop()
      })
      loopRef.current = { kind: 'video', id }
    } else {
      const id = requestAnimationFrame(() => {
        loopRef.current = null
        drawFrame(true, video.currentTime)
        frameLoop()
      })
      loopRef.current = { kind: 'animation', id }
    }
  }

  function drawFrame(detect = false, mediaTime?: number) {
    const video = videoRef.current
    const source = sourceRef.current
    const output = previewRef.current
    if (!video || !source || !output || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    const context = source.getContext('2d')
    if (!context) return
    const frameTime = mediaTime ?? video.currentTime
    if (detect && Math.abs(frameTime - lastMediaTimeRef.current) < 0.005) return
    try {
      context.drawImage(video, 0, 0, source.width, source.height)
      if (detect && detectorsRef.current) {
        lastMediaTimeRef.current = frameTime
        lastFrameAtRef.current = performance.now()
        // MediaPipe VIDEO timestamps must advance even after a user seeks backward.
        const timestamp = Math.max(performance.now(), timestampRef.current + 1)
        timestampRef.current = timestamp
        const found = detectVideoFaces(detectorsRef.current, source, timestamp)
        tracksRef.current = updateTracks(tracksRef.current, found, frameTime)
        facesRef.current = tracksRef.current.map(track => track.region)
      }
      const options = settingsRef.current
      if (options.showOriginal && !recordingRef.current) {
        output.getContext('2d')?.drawImage(source, 0, 0)
      } else {
        renderImage(source, output, [...facesRef.current, ...fixedRef.current],
          options.effect, options.strength, options.padding)
      }
      if (detect && (performance.now() - lastUiRef.current > 90 || video.paused)) {
        setDisplayFaces(facesRef.current)
        setTime(video.currentTime)
        lastUiRef.current = performance.now()
      }
    } catch (caught) {
      cancelRecording(false)
      video.pause()
      setError(caught instanceof Error ? caught.message : 'Could not process this video frame.')
    }
  }
  drawingRef.current = () => drawFrame(false)

  function onMetadata() {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) {
      setError('This video could not be decoded by your browser. Try an MP4 or WebM file.')
      setLoading(false)
      return
    }
    const scale = Math.min(1, MAX_SIDE / video.videoWidth, MAX_HEIGHT / video.videoHeight)
    const width = Math.max(1, Math.round(video.videoWidth * scale))
    const height = Math.max(1, Math.round(video.videoHeight * scale))
    const source = document.createElement('canvas')
    source.width = width
    source.height = height
    sourceRef.current = source
    if (previewRef.current) { previewRef.current.width = width; previewRef.current.height = height }
    setInfo({ width, height, duration: video.duration })
  }

  async function onDataReady() {
    if (loadingStartedRef.current) return
    loadingStartedRef.current = true
    try {
      const detectors = await loadVideoDetectors()
      if (!aliveRef.current) return
      detectorsRef.current = detectors
      setLoading(false)
      drawFrame(true)
      setMessage('Play and scrub through the clip to check the automatic face areas.')
    } catch (caught) {
      if (!aliveRef.current) return
      console.error('Video detector failed', caught)
      setError('Face detection could not start. Check the bundled model files and reload the app.')
      setLoading(false)
      drawFrame(false)
    }
  }

  function onSeeked() {
    tracksRef.current = []
    facesRef.current = []
    lastMediaTimeRef.current = -1
    if (detectorsRef.current) drawFrame(true)
    else drawFrame(false)
    setTime(videoRef.current?.currentTime ?? 0)
  }

  function onEnded() {
    cancelLoop()
    drawFrame(true, videoRef.current?.duration)
    setPlaying(false)
    setTime(info?.duration ?? 0)
    cancelRecording(true)
  }

  function onPause() {
    cancelLoop()
    setPlaying(false)
    const video = videoRef.current
    if (recordingRef.current?.save && video && !video.ended && video.duration - video.currentTime > 0.12) {
      setError('Export was interrupted. Please keep this tab open and try again.')
      cancelRecording(false)
    }
  }

  function ensureAudio() {
    if (audioRef.current) return audioRef.current
    const video = videoRef.current
    if (!video) throw new Error('The video is not ready.')
    const context = new AudioContext()
    const source = context.createMediaElementSource(video)
    const previewGain = context.createGain()
    const destination = context.createMediaStreamDestination()
    source.connect(previewGain)
    previewGain.connect(context.destination)
    source.connect(destination)
    previewGain.gain.value = muted ? 0 : 1
    audioRef.current = { context, previewGain, destination }
    return audioRef.current
  }

  async function togglePlay() {
    const video = videoRef.current
    if (!video || loading || exporting || !detectorsRef.current) return
    if (!video.paused) { video.pause(); return }
    try {
      await ensureAudio().context.resume()
      await video.play()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not play this video.')
    }
  }

  function seek(value: number) {
    const video = videoRef.current
    if (!video || exporting) return
    tracksRef.current = []
    facesRef.current = []
    lastMediaTimeRef.current = -1
    video.currentTime = value
    setReadyToExport(false)
    setTime(value)
  }

  function cancelRecording(save: boolean) {
    const active = recordingRef.current
    if (!active) return
    active.save = save
    if (active.recorder.state !== 'inactive') active.recorder.stop()
  }

  async function exportVideo() {
    const video = videoRef.current
    const canvas = previewRef.current
    if (!video || !canvas || !info || loading || exporting || !detectorsRef.current) return
    const mimeType = recordingType()
    if (!mimeType || typeof canvas.captureStream !== 'function') {
      setError('This browser cannot export video. Try the latest Chrome or Edge.')
      return
    }
    setError('')
    setReadyFile(null)
    if (video.currentTime > 0.01) {
      video.pause()
      cancelLoop()
      video.currentTime = 0
      setReadyToExport(true)
      setMessage('Video rewound. Tap Start export to record the edited clip.')
      return
    }
    setMessage('Preparing your video…')
    try {
      settingsRef.current.showOriginal = false
      setShowOriginal(false)
      video.pause()
      cancelLoop()
      const audio = ensureAudio()
      // Start audio and playback from the export button's user gesture on Android.
      const resumeAudio = audio.context.resume()
      audio.previewGain.gain.value = 0
      tracksRef.current = []
      facesRef.current = []
      lastMediaTimeRef.current = -1
      drawFrame(true, 0)

      const canvasStream = canvas.captureStream(30)
      if (!canvasStream.getVideoTracks().length) throw new Error('This browser could not capture the edited video canvas.')
      const stream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audio.destination.stream.getAudioTracks(),
      ])
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3_500_000 })
      const active: Recording = { recorder, stream, chunks: [], mimeType, save: true }
      recordingRef.current = active
      recorder.ondataavailable = event => { if (event.data.size) active.chunks.push(event.data) }
      recorder.onerror = () => {
        active.save = false
        setError('The video recorder stopped unexpectedly. Try a shorter clip or another browser.')
        cancelRecording(false)
      }
      recorder.onstop = () => {
        active.stream.getVideoTracks().forEach(track => track.stop())
        if (recordingRef.current === active) recordingRef.current = null
        if (!aliveRef.current) return
        setExporting(false)
        audio.previewGain.gain.value = muted ? 0 : 1
        if (!active.save) return
        if (!active.chunks.length) {
          setError('The browser did not produce any video data. Try a shorter clip or another browser.')
          return
        }
        const type = recorder.mimeType || active.mimeType
        const extension = type.startsWith('video/mp4') ? 'mp4' : 'webm'
        const edited = new File(active.chunks, `${file.name.replace(/\.[^.]+$/, '')}-faces-hidden.${extension}`, { type })
        setReadyFile(edited)
        if (!isTouchDevice()) downloadFile(edited)
        setMessage(`Edited video ready as ${extension.toUpperCase()}. Review it before saving or sharing.`)
      }
      recorder.start(1000)
      setExporting(true)
      setReadyToExport(false)
      setMessage('Exporting in real time. Keep Faceveil open until the clip finishes.')
      // Do not await resumeAudio before play: mobile playback may require this same tap.
      const playVideo = video.play()
      await Promise.all([resumeAudio, playVideo])
    } catch (caught) {
      const active = recordingRef.current
      cancelRecording(false)
      if (active?.recorder.state === 'inactive') {
        active.stream.getVideoTracks().forEach(track => track.stop())
        recordingRef.current = null
      }
      video.pause()
      if (audioRef.current) audioRef.current.previewGain.gain.value = muted ? 0 : 1
      setExporting(false)
      setError(caught instanceof Error ? caught.message : 'Could not export this video.')
    }
  }

  function point(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: clamp((event.clientX - bounds.left) / bounds.width * info!.width, 0, info!.width),
      y: clamp((event.clientY - bounds.top) / bounds.height * info!.height, 0, info!.height) }
  }

  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!info || loading || exporting) return
    const position = point(event)
    const target = event.target as Element
    const hit = hitRegion(fixedRegions, selectedId, position, info, event.currentTarget)
    const region = fixedRegions.find(item => item.id === target.getAttribute('data-fixed-id')) ?? hit?.region
    if (region) {
      videoRef.current?.pause()
      setSelectedId(region.id)
      interactionRef.current = { kind: target.hasAttribute('data-handle') || (hit?.region.id === region.id && hit.kind === 'resize') ? 'resize' : 'move', id: region.id,
        x: position.x, y: position.y, original: region }
    } else if (addMode) {
      videoRef.current?.pause()
      const newId = crypto.randomUUID()
      interactionRef.current = { kind: 'draw', id: newId, x: position.x, y: position.y }
      setFixedRegions(current => [...current, { id: newId, x: position.x, y: position.y,
        width: 1, height: 1, source: 'manual', enabled: true }])
      setSelectedId(newId)
    } else {
      setSelectedId(null)
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const action = interactionRef.current
    if (!action || !info) return
    const position = point(event)
    setFixedRegions(current => current.map(region => {
      if (region.id !== action.id) return region
      if (action.kind === 'draw') return { ...region, ...normalizeBox(action.x, action.y,
        position.x - action.x, position.y - action.y, info) }
      if (action.kind === 'move') return { ...region,
        x: clamp(action.original.x + position.x - action.x, 0, info.width - region.width),
        y: clamp(action.original.y + position.y - action.y, 0, info.height - region.height) }
      return { ...region,
        width: clamp(action.original.width + position.x - action.x, 12, info.width - region.x),
        height: clamp(action.original.height + position.y - action.y, 12, info.height - region.y) }
    }))
  }

  function pointerUp(event: PointerEvent<SVGSVGElement>) {
    const action = interactionRef.current
    if (!action) return
    interactionRef.current = null
    if (action.kind === 'draw') {
      const added = fixedRegions.find(region => region.id === action.id)
      if (!added || added.width < 12 || added.height < 12) {
        setFixedRegions(current => current.filter(region => region.id !== action.id))
        setSelectedId(null)
      } else {
        setAddMode(false)
        setMessage('Fixed area added. It stays in the same place throughout the video.')
      }
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const fixedCount = fixedRegions.filter(region => region.enabled).length
  const percent = info?.duration ? Math.min(100, Math.round(time / info.duration * 100)) : 0

  return <section className="editor wrap" aria-label="Video face blur editor">
    <div className="editor-topline">
      <div className="file-heading"><span className="file-icon"><ImagePlus size={19} /></span>
        <div><strong title={file.name}>{file.name}</strong><span>{info ? `${info.width} × ${info.height} px · ${timeLabel(info.duration)}` : 'Loading video'} · {(file.size / 1024 / 1024).toFixed(1)} MB</span></div>
      </div>
      <div className="editor-top-actions">
        <button className="button button-quiet" disabled={exporting} onClick={onReplace}><ImagePlus size={16} /> Replace video</button>
        <button className="icon-button" disabled={exporting} aria-label="Close video" title="Close video" onClick={onClose}><X size={19} /></button>
      </div>
    </div>

    <div className="editor-grid">
      <div className="canvas-panel">
        <div className="panel-toolbar">
          <div className="preview-heading"><span className="preview-dot" /> Video preview <span className="panel-hint">Automatic face tracking</span></div>
          <button className="button button-compare" disabled={exporting || loading} onClick={() => setShowOriginal(value => !value)}>
            {showOriginal ? <EyeOff size={16} /> : <Eye size={16} />}{showOriginal ? 'Show edited' : 'Show original'}
          </button>
        </div>
        <div className={`canvas-workspace video-workspace ${addMode ? 'adding' : ''}`}>
          <div className="image-frame" style={info ? { aspectRatio: `${info.width} / ${info.height}`,
            width: `min(100%, ${Math.round(650 * info.width / info.height)}px)` } : { aspectRatio: '16 / 9', width: '100%' }}>
            <video ref={videoRef} src={url || undefined} className="source-video" preload="auto" playsInline
              onLoadedMetadata={onMetadata} onLoadedData={() => { void onDataReady() }}
              onPlay={() => { setPlaying(true); frameLoop() }} onPause={onPause} onEnded={onEnded}
              onSeeked={onSeeked} onError={() => { setLoading(false); setError('This device could not play the video. Try an MP4 or WebM file.') }} />
            <canvas ref={previewRef} className="preview-canvas" aria-label="Edited video preview" />
            {info && <svg className="region-overlay" viewBox={`0 0 ${info.width} ${info.height}`} preserveAspectRatio="none"
              onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} aria-label="Video face areas">
              {displayFaces.map(face => <ellipse key={face.id} cx={face.x + face.width / 2} cy={face.y + face.height / 2}
                rx={face.width / 2} ry={face.height / 2} className="region-shape video-auto-region"
                strokeWidth={Math.max(2, Math.min(info.width, info.height) * 0.002)} />)}
              {fixedRegions.map((region, index) => <g key={region.id} className={region.enabled ? 'region enabled' : 'region disabled'}>
                <ellipse data-fixed-id={region.id} cx={region.x + region.width / 2} cy={region.y + region.height / 2}
                  rx={region.width / 2} ry={region.height / 2} className={selectedId === region.id ? 'region-shape selected' : 'region-shape fixed-region'}
                  strokeWidth={Math.max(2, Math.min(info.width, info.height) * 0.002)} />
                <text x={region.x + region.width / 2} y={Math.max(16, region.y - 8)} className="region-number"
                  fontSize={Math.max(15, Math.min(info.width, info.height) * 0.018)} textAnchor="middle">F{index + 1}</text>
                {selectedId === region.id && <circle data-fixed-id={region.id} data-handle="resize"
                  cx={region.x + region.width} cy={region.y + region.height} r={Math.max(16, Math.min(region.width, region.height) * .06)}
                  className="resize-handle" />}
              </g>)}
            </svg>}
            {showOriginal && !exporting && <span className="canvas-badge">Original</span>}
            {loading && <div className="canvas-loading" role="status"><span className="spinner" />Loading face detector…</div>}
            {exporting && <span className="video-export-badge">Exporting · {percent}%</span>}
          </div>
        </div>
        <div className="video-controls">
          <button className="video-play" onClick={() => { void togglePlay() }} disabled={loading || exporting || !info}
            aria-label={playing ? 'Pause video' : 'Play video'}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
          <span className="video-time">{timeLabel(time)}</span>
          <input type="range" className="video-scrubber" aria-label="Video position" min="0" max={info?.duration || 1}
            step="0.01" value={Math.min(time, info?.duration || 1)} disabled={!info || exporting} onChange={event => seek(Number(event.target.value))} />
          <span className="video-time">{timeLabel(info?.duration ?? 0)}</span>
          <button className="video-volume" aria-label={muted ? 'Unmute preview' : 'Mute preview'} onClick={() => setMuted(value => !value)}>
            {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
        </div>
        <div className="canvas-footer"><span><MousePointer2 size={15} /> {addMode ? 'Drag over a spot to add a fixed area' : 'Green outlines track faces; fixed areas stay in place'}</span><span>{info ? `${info.width} × ${info.height}` : ''}</span></div>
      </div>

      <aside className="tools-panel" aria-label="Video editing tools">
        <div className="tool-section face-section">
          <div className="section-title"><span><ScanFace size={18} /> Face areas</span><span className="count-pill">{displayFaces.length} tracked</span></div>
          <p className="section-copy">Faces are detected as the video plays. Scrub through the clip and check for missed frames.</p>
          <div className="video-stat"><span className="video-stat-dot" /> {displayFaces.length} {displayFaces.length === 1 ? 'face' : 'faces'} in this frame</div>
          <div className="fixed-heading">Fixed areas <span>{fixedCount}</span></div>
          {fixedRegions.length ? <div className="region-list">
            {fixedRegions.map((region, index) => <div key={region.id} className={`region-row ${selectedId === region.id ? 'active' : ''}`}>
              <button className="region-select" onClick={() => { videoRef.current?.pause(); setSelectedId(region.id) }}>
                <span className="region-index">F{index + 1}</span><span><strong>Fixed area {index + 1}</strong><small>All frames</small></span>
              </button>
              <button className="mini-button" disabled={exporting} aria-label={`${region.enabled ? 'Disable' : 'Enable'} fixed area ${index + 1}`}
                onClick={() => setFixedRegions(current => current.map(item => item.id === region.id ? { ...item, enabled: !item.enabled } : item))}>
                {region.enabled ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
              <button className="mini-button" disabled={exporting} aria-label={`Remove fixed area ${index + 1}`}
                onClick={() => { setFixedRegions(current => current.filter(item => item.id !== region.id)); if (selectedId === region.id) setSelectedId(null) }}>
                <Trash2 size={15} />
              </button>
            </div>)}
          </div> : <div className="empty-regions">Add a fixed area for a face or screen region that stays in one place.</div>}
          <button className={`button button-outline fixed-add ${addMode ? 'mode-active' : ''}`} disabled={loading || exporting}
            onClick={() => { videoRef.current?.pause(); setAddMode(value => !value); setSelectedId(null) }}>
            <Plus size={17} />{addMode ? 'Cancel adding' : 'Add fixed area'}
          </button>
        </div>

        <div className="tool-section settings-section">
          <div className="section-title"><span><SlidersHorizontal size={18} /> Appearance</span></div>
          <label className="field-label">Effect</label>
          <div className="segmented" role="group" aria-label="Video redaction effect">
            {(['blur', 'pixelate', 'cover'] as const).map(option => <button key={option} disabled={exporting}
              aria-pressed={effect === option} className={effect === option ? 'chosen' : ''}
              onClick={() => setEffect(option)}>{option === 'blur' ? 'Blur' : option === 'pixelate' ? 'Pixelate' : 'Cover'}</button>)}
          </div>
          {effect !== 'cover' && <div className="range-field"><div className="range-label"><label htmlFor="video-strength">Strength</label><span>{strength}%</span></div>
            <input id="video-strength" type="range" min="10" max="100" value={strength} disabled={exporting}
              onChange={event => setStrength(Number(event.target.value))} /><div className="range-ends"><span>Subtle</span><span>Strong</span></div></div>}
          <div className="range-field"><div className="range-label"><label htmlFor="video-padding">Area padding</label><span>{padding}%</span></div>
            <input id="video-padding" type="range" min="0" max="60" value={padding} disabled={exporting}
              onChange={event => setPadding(Number(event.target.value))} /><div className="range-ends"><span>Tight</span><span>Wide</span></div></div>
          <p className="settings-tip"><CircleHelp size={15} /> Fixed areas do not follow a moving face. Automatic areas update each frame.</p>
        </div>

        <div className="download-section">
          <div className="download-heading"><ShieldCheck size={19} /><span>Export your video</span></div>
          <p>Video exports at up to 720p, with the original audio. Processing takes about as long as the video.</p>
          <button className="button button-primary download-button" disabled={loading || exporting || !info || !!error && !detectorsRef.current}
            onClick={() => { void exportVideo() }}><ArrowDownToLine size={19} /> {exporting ? `Exporting ${percent}%` : readyToExport ? 'Start export' : 'Create edited video'}</button>
          <span className="download-note">WebM or MP4 · format depends on your browser</span>
          {exporting && <button className="video-cancel" onClick={() => { cancelRecording(false); videoRef.current?.pause(); setMessage('Export canceled.') }}>Cancel export</button>}
        </div>
      </aside>
    </div>
    {readyFile && readyUrl && <section className="export-review" aria-label="Review edited video">
      <h2>Review the finished clip</h2>
      <video src={readyUrl} controls playsInline preload="metadata" aria-label="Finished video" />
      <div className="mobile-save-actions">
        <button className="button button-primary" onClick={() => downloadFile(readyFile)}>Save file</button>
        {canShareFile(readyFile) && <button className="button button-outline" onClick={() => { void shareFile(readyFile).catch(caught => setError(caught instanceof Error ? caught.message : 'Could not share this video.')) }}>Share</button>}
      </div>
    </section>}
    {message && <div className="alert alert-info" role="status"><Check size={16} />{message}</div>}
    {error && <div className="alert alert-error" role="alert">{error}</div>}
    <div className="video-review-note">Review the entire exported video before sharing. Detection may miss a face in some frames, especially if it turns away or is partly hidden.</div>
  </section>
}
