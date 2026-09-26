import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent } from 'react'
import {
  ArrowDownToLine, Check, CircleHelp, Eye, EyeOff, ImagePlus, LockKeyhole,
  MousePointer2, Plus, RefreshCw, ScanFace, ShieldCheck, SlidersHorizontal,
  Trash2, Upload, X,
} from 'lucide-react'
import { detectFaces } from './faceDetection'
import { clamp, normalizeBox, type ImageSize, type Region } from './geometry'
import { renderImage, type Effect } from './processImage'
import VideoEditor from './VideoEditor'

type ImageInfo = ImageSize & { name: string; bytes: number }
type Interaction =
  | { kind: 'draw'; id: string; startX: number; startY: number }
  | { kind: 'move' | 'resize'; id: string; startX: number; startY: number; original: Region }

const MAX_BYTES = 40 * 1024 * 1024
const MAX_PIXELS = 40_000_000
const MAX_VIDEO_BYTES = 500 * 1024 * 1024

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const sourceRef = useRef<HTMLCanvasElement | null>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const exportRef = useRef<HTMLCanvasElement | null>(null)
  const generationRef = useRef(0)
  const interactionRef = useRef<Interaction | null>(null)
  const [image, setImage] = useState<ImageInfo | null>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoRevision, setVideoRevision] = useState(0)
  const [regions, setRegions] = useState<Region[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [effect, setEffect] = useState<Effect>('blur')
  const [strength, setStrength] = useState(82)
  const [padding, setPadding] = useState(24)
  const [showOriginal, setShowOriginal] = useState(false)
  const [addMode, setAddMode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draggingFile, setDraggingFile] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const activeCount = regions.filter(region => region.enabled).length

  useEffect(() => {
    const source = sourceRef.current
    const preview = previewRef.current
    if (!source || !preview || !image) return
    if (showOriginal) {
      preview.width = source.width
      preview.height = source.height
      preview.getContext('2d')?.drawImage(source, 0, 0)
    } else {
      renderImage(source, preview, regions, effect, strength, padding)
    }
  }, [image, regions, effect, strength, padding, showOriginal])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId &&
          !(event.target instanceof HTMLInputElement)) {
        setRegions(current => current.filter(region => region.id !== selectedId))
        setSelectedId(null)
      }
      if (event.key === 'Escape') {
        setAddMode(false)
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId])

  async function scan(source: HTMLCanvasElement, generation: number) {
    setBusy(true)
    setMessage('Finding faces in your photo…')
    setError('')
    try {
      const found = await detectFaces(source)
      if (generation !== generationRef.current) return
      setRegions(found)
      setSelectedId(null)
      setMessage(found.length
        ? `${found.length} ${found.length === 1 ? 'face' : 'faces'} detected. Check every face before downloading.`
        : 'No faces detected. Use Add face area to mark faces yourself.')
    } catch (caught) {
      if (generation !== generationRef.current) return
      console.error('Face detection failed', caught)
      setError('Automatic detection could not start. Check that the model files are present, then try Scan again. You can still add face areas manually.')
      setMessage('')
    } finally {
      if (generation === generationRef.current) setBusy(false)
    }
  }

  async function openFile(file?: File) {
    if (!file) return
    setDraggingFile(false)
    const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name)
    if (isVideo) {
      if (file.size > MAX_VIDEO_BYTES) {
        setError('This video is over 500 MB. Please choose a smaller clip.')
        return
      }
      generationRef.current++
      sourceRef.current = null
      exportRef.current = null
      setImage(null)
      setBusy(false)
      setError('')
      setMessage('')
      setVideoRevision(value => value + 1)
      setVideoFile(file)
      return
    }
    if (!file.type.startsWith('image/')) {
      setError('Choose a photo or video in a format your browser supports.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('This photo is over 40 MB. Please choose a smaller image.')
      return
    }
    const generation = ++generationRef.current
    setBusy(true)
    setError('')
    setMessage('Opening your photo…')
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      if (bitmap.width * bitmap.height > MAX_PIXELS) {
        bitmap.close()
        throw new Error('This image is over 40 megapixels. Please resize it before opening.')
      }
      if (generation !== generationRef.current) {
        bitmap.close()
        return
      }
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Your browser could not open a canvas for this photo.')
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      sourceRef.current = canvas
      setVideoFile(null)
      setImage({ name: file.name, bytes: file.size, width: canvas.width, height: canvas.height })
      setRegions([])
      setSelectedId(null)
      setShowOriginal(false)
      setAddMode(false)
      await scan(canvas, generation)
    } catch (caught) {
      if (generation !== generationRef.current) return
      setBusy(false)
      setMessage('')
      setError(caught instanceof Error ? caught.message : 'This image could not be opened.')
    }
  }

  function onInput(event: ChangeEvent<HTMLInputElement>) {
    void openFile(event.target.files?.[0])
    event.target.value = ''
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setDraggingFile(false)
    void openFile(event.dataTransfer.files[0])
  }

  function onDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setDraggingFile(true)
  }

  function point(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width * image!.width, 0, image!.width),
      y: clamp((event.clientY - bounds.top) / bounds.height * image!.height, 0, image!.height),
    }
  }

  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!image || busy) return
    const position = point(event)
    const target = event.target as Element
    const id = target.getAttribute('data-region-id')
    const handle = target.getAttribute('data-handle')
    const region = regions.find(item => item.id === id)
    if (region) {
      setSelectedId(region.id)
      interactionRef.current = {
        kind: handle ? 'resize' : 'move', id: region.id,
        startX: position.x, startY: position.y, original: region,
      }
    } else if (addMode) {
      const newId = crypto.randomUUID()
      interactionRef.current = { kind: 'draw', id: newId, startX: position.x, startY: position.y }
      setRegions(current => [...current, {
        id: newId, x: position.x, y: position.y, width: 1, height: 1,
        source: 'manual', enabled: true,
      }])
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
    if (!action || !image) return
    const position = point(event)
    setRegions(current => current.map(region => {
      if (region.id !== action.id) return region
      if (action.kind === 'draw') {
        return { ...region, ...normalizeBox(action.startX, action.startY,
          position.x - action.startX, position.y - action.startY, image) }
      }
      if (action.kind === 'move') {
        return { ...region,
          x: clamp(action.original.x + position.x - action.startX, 0, image.width - region.width),
          y: clamp(action.original.y + position.y - action.startY, 0, image.height - region.height),
        }
      }
      return { ...region,
        width: clamp(action.original.width + position.x - action.startX, 12, image.width - region.x),
        height: clamp(action.original.height + position.y - action.startY, 12, image.height - region.y),
      }
    }))
  }

  function pointerUp(event: PointerEvent<SVGSVGElement>) {
    const action = interactionRef.current
    if (!action) return
    interactionRef.current = null
    if (action.kind === 'draw') {
      const added = regions.find(region => region.id === action.id)
      if (!added || added.width < 12 || added.height < 12) {
        setRegions(current => current.filter(region => region.id !== action.id))
        setSelectedId(null)
      } else {
        setMessage('Face area added. Drag it to move, or use the corner handle to resize.')
        setAddMode(false)
      }
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function download() {
    if (!sourceRef.current || !image || busy) return
    try {
      const output = exportRef.current ?? document.createElement('canvas')
      exportRef.current = output
      renderImage(sourceRef.current, output, regions, effect, strength, padding)
      output.toBlob(blob => {
        if (!blob) {
          setError('Could not create the download. Try a smaller photo.')
          return
        }
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `${image.name.replace(/\.[^.]+$/, '')}-faces-hidden.png`
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      }, 'image/png')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the download.')
    }
  }

  function closeImage() {
    generationRef.current++
    sourceRef.current = null
    exportRef.current = null
    setImage(null)
    setRegions([])
    setBusy(false)
    setError('')
    setMessage('')
    setSelectedId(null)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#top" aria-label="Faceveil home" onClick={event => { if (image || videoFile) event.preventDefault() }}>
            <span className="brand-symbol"><ScanFace size={21} strokeWidth={2.15} /></span>
            <span>faceveil<span className="brand-dot">.</span></span>
          </a>
          <div className="topbar-right">
            <span className="local-pill"><span className="pulse-dot" /> On-device processing</span>
            <button className="topbar-about" onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}>
              How it works
            </button>
          </div>
        </div>
      </header>

      <main id="top">
        <div className="hero wrap">
          <div className="eyebrow"><span className="eyebrow-line" /> PRIVATE PHOTO &amp; VIDEO EDITING</div>
          <h1>Put privacy <em>in the picture.</em></h1>
          <p>Find and blur faces in photos and videos. Your files stay on your device, and you stay in control of the final edit.</p>
          <div className="hero-benefits">
            <span><Check size={15} /> Automatic face detection</span>
            <span><Check size={15} /> Fine-tune every area</span>
            <span><Check size={15} /> Edited downloads</span>
          </div>
        </div>

        <input ref={inputRef} type="file" accept="image/*,video/*,.mov" hidden onChange={onInput} aria-label="Choose photo or video" />

        {videoFile ? <>
          <VideoEditor key={videoRevision} file={videoFile} onReplace={() => inputRef.current?.click()}
            onClose={() => { setVideoFile(null); setError('') }} />
          {error && <div className="wrap alert alert-error" role="alert">{error}</div>}
        </> : !image ? (
          <section className={`upload-area wrap ${draggingFile ? 'dragging' : ''}`} onDragOver={onDragOver}
            onDragLeave={() => setDraggingFile(false)} onDrop={onDrop}>
            <div className="upload-pattern" aria-hidden="true" />
            <div className="upload-icon"><ImagePlus size={30} strokeWidth={1.8} /></div>
            <h2>Drop a photo or video here</h2>
            <p>Or choose one from your device. We’ll look for faces automatically.</p>
            <button className="button button-primary upload-button" onClick={() => inputRef.current?.click()}>
              <Upload size={18} /> Choose a file
            </button>
            <span className="file-note">Photos up to 40 MB · videos up to 500 MB · MP4 or WebM works best</span>
            {busy && <div className="upload-status" role="status">{message}</div>}
            {error && <div className="alert alert-error upload-alert" role="alert">{error}</div>}
          </section>
        ) : (
          <section className="editor wrap" aria-label="Face blur editor">
            <div className="editor-topline">
              <div className="file-heading">
                <span className="file-icon"><ImagePlus size={19} /></span>
                <div><strong title={image.name}>{image.name}</strong><span>{image.width} × {image.height} px <span className="dot-separator">·</span> {formatBytes(image.bytes)}</span></div>
              </div>
              <div className="editor-top-actions">
                <button className="button button-quiet" onClick={() => inputRef.current?.click()}><ImagePlus size={16} /> Replace photo</button>
                <button className="icon-button" aria-label="Close photo" title="Close photo" onClick={closeImage}><X size={19} /></button>
              </div>
            </div>

            <div className="editor-grid">
              <div className="canvas-panel">
                <div className="panel-toolbar">
                  <div className="preview-heading"><span className="preview-dot" /> Preview <span className="panel-hint">Review every face</span></div>
                  <button className="button button-compare" onClick={() => setShowOriginal(value => !value)}>
                    {showOriginal ? <EyeOff size={16} /> : <Eye size={16} />}
                    {showOriginal ? 'Show edited' : 'Show original'}
                  </button>
                </div>
                <div className={`canvas-workspace ${addMode ? 'adding' : ''}`}>
                  <div className="image-frame" style={{
                    aspectRatio: `${image.width} / ${image.height}`,
                    width: `min(100%, ${Math.round(650 * image.width / image.height)}px)`,
                  }}>
                    <canvas ref={previewRef} className="preview-canvas" aria-label="Photo preview" />
                    <svg className="region-overlay" viewBox={`0 0 ${image.width} ${image.height}`}
                      preserveAspectRatio="none" onPointerDown={pointerDown} onPointerMove={pointerMove}
                      onPointerUp={pointerUp} onPointerCancel={pointerUp} aria-label="Face areas">
                      {regions.map((region, index) => {
                        const selected = selectedId === region.id
                        const visible = Math.max(12, Math.min(region.width, region.height))
                        const handleSize = Math.max(7, visible * 0.055)
                        return <g key={region.id} className={region.enabled ? 'region enabled' : 'region disabled'}>
                          <ellipse data-region-id={region.id} cx={region.x + region.width / 2} cy={region.y + region.height / 2}
                            rx={region.width / 2} ry={region.height / 2} className={selected ? 'region-shape selected' : 'region-shape'}
                            strokeWidth={Math.max(2, Math.min(image.width, image.height) * 0.002)} />
                          <text x={region.x + region.width / 2} y={Math.max(16, region.y - 8)} className="region-number"
                            fontSize={Math.max(15, Math.min(image.width, image.height) * 0.018)} textAnchor="middle">{index + 1}</text>
                          {selected && <circle data-region-id={region.id} data-handle="resize"
                            cx={region.x + region.width} cy={region.y + region.height} r={handleSize}
                            className="resize-handle" />}
                        </g>
                      })}
                    </svg>
                    {showOriginal && <span className="canvas-badge">Original</span>}
                    {busy && <div className="canvas-loading" role="status"><span className="spinner" />Finding faces…</div>}
                  </div>
                </div>
                <div className="canvas-footer">
                  <span><MousePointer2 size={15} /> {addMode ? 'Click and drag over a face to add an area' : 'Click an area to select it, then drag to move'}</span>
                  <span>{image.width} × {image.height}</span>
                </div>
              </div>

              <aside className="tools-panel" aria-label="Editing tools">
                <div className="tool-section face-section">
                  <div className="section-title"><span><ScanFace size={18} /> Face areas</span><span className="count-pill">{activeCount}</span></div>
                  <p className="section-copy">Detected faces are selected for editing. Check the photo for any we missed.</p>
                  {regions.length > 0 ? <div className="region-list">
                    {regions.map((region, index) => <div key={region.id} className={`region-row ${selectedId === region.id ? 'active' : ''}`}>
                      <button className="region-select" onClick={() => setSelectedId(region.id)} aria-label={`Select face area ${index + 1}`}>
                        <span className="region-index">{String(index + 1).padStart(2, '0')}</span>
                        <span><strong>Face area {index + 1}</strong><small>{region.source === 'auto' ? 'Auto-detected' : 'Added by you'}</small></span>
                      </button>
                      <button className="mini-button" aria-label={`${region.enabled ? 'Disable' : 'Enable'} face area ${index + 1}`}
                        title={region.enabled ? 'Disable blur' : 'Enable blur'}
                        onClick={() => setRegions(current => current.map(item => item.id === region.id ? { ...item, enabled: !item.enabled } : item))}>
                        {region.enabled ? <Eye size={16} /> : <EyeOff size={16} />}
                      </button>
                      <button className="mini-button" aria-label={`Remove face area ${index + 1}`} title="Remove area"
                        onClick={() => { setRegions(current => current.filter(item => item.id !== region.id)); if (selectedId === region.id) setSelectedId(null) }}>
                        <Trash2 size={15} />
                      </button>
                    </div>)}
                  </div> : <div className="empty-regions">{busy ? 'Scanning your photo…' : 'No face areas yet. Add one to get started.'}</div>}
                  <div className="area-actions">
                    <button className={`button button-outline ${addMode ? 'mode-active' : ''}`} disabled={busy}
                      onClick={() => { setAddMode(value => !value); setSelectedId(null) }}>
                      <Plus size={17} /> {addMode ? 'Cancel adding' : 'Add face area'}
                    </button>
                    <button className="button button-icon-text" disabled={busy} onClick={() => { if (sourceRef.current) void scan(sourceRef.current, generationRef.current) }}
                      title="Replace areas with a fresh automatic scan"><RefreshCw size={15} /> Scan again</button>
                  </div>
                </div>

                <div className="tool-section settings-section">
                  <div className="section-title"><span><SlidersHorizontal size={18} /> Appearance</span></div>
                  <label className="field-label">Effect</label>
                  <div className="segmented" role="group" aria-label="Redaction effect">
                    {(['blur', 'pixelate', 'cover'] as const).map(option => <button key={option}
                      aria-pressed={effect === option} className={effect === option ? 'chosen' : ''}
                      onClick={() => setEffect(option)}>{option === 'blur' ? 'Blur' : option === 'pixelate' ? 'Pixelate' : 'Cover'}</button>)}
                  </div>
                  {effect !== 'cover' && <div className="range-field">
                    <div className="range-label"><label htmlFor="strength">Strength</label><span>{strength}%</span></div>
                    <input id="strength" type="range" min="10" max="100" value={strength} onChange={event => setStrength(Number(event.target.value))} />
                    <div className="range-ends"><span>Subtle</span><span>Strong</span></div>
                  </div>}
                  <div className="range-field">
                    <div className="range-label"><label htmlFor="padding">Area padding</label><span>{padding}%</span></div>
                    <input id="padding" type="range" min="0" max="60" value={padding} onChange={event => setPadding(Number(event.target.value))} />
                    <div className="range-ends"><span>Tight</span><span>Wide</span></div>
                  </div>
                  <p className="settings-tip"><CircleHelp size={15} /> Widen the area to hide more of the face and hairline.</p>
                </div>

                <div className="download-section">
                  <div className="download-heading"><ShieldCheck size={19} /><span>Ready when you are</span></div>
                  <p>Look over the photo once more. Automatic detection can miss faces.</p>
                  <button className="button button-primary download-button" disabled={busy || activeCount === 0} onClick={download}>
                    <ArrowDownToLine size={19} /> Download edited photo
                  </button>
                  <span className="download-note">Full resolution PNG · saved to your device</span>
                </div>
              </aside>
            </div>
            {message && <div className="alert alert-info" role="status"><Check size={16} />{message}</div>}
            {error && <div className="alert alert-error" role="alert">{error}</div>}
          </section>
        )}

        <section className="info-section wrap" id="how-it-works">
          <div className="info-heading"><span className="eyebrow">SIMPLE BY DESIGN</span><h2>Privacy, with the final say in your hands.</h2></div>
          <div className="info-cards">
            <article><span className="info-icon"><Upload size={20} /></span><span className="card-number">01</span><h3>Choose a file</h3><p>Open a photo or video from your computer. It is processed in your browser.</p></article>
            <article><span className="info-icon"><ScanFace size={20} /></span><span className="card-number">02</span><h3>Check the faces</h3><p>Detection marks faces. Add areas manually if anything is missed.</p></article>
            <article><span className="info-icon"><LockKeyhole size={20} /></span><span className="card-number">03</span><h3>Save with confidence</h3><p>Choose blur, pixelation, or a solid cover, then download the result.</p></article>
          </div>
        </section>
      </main>
      <footer className="footer"><div className="wrap"><span className="footer-brand">faceveil<span>.</span></span><span>Made for moments worth sharing thoughtfully.</span><span>Files are processed locally in your browser.</span></div></footer>
    </div>
  )
}
