import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import {
  Play,
  Maximize2,
  Minimize2,
  Download,
  Search,
  Filter,
  X,
  FileText,
  Clock,
  Activity,
  Layers,
  Sparkles,
  RefreshCw,
  Eye,
  Crosshair,
} from 'lucide-react'

const API_BASE = 'http://localhost:8000'

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface Detection {
  class_name: string
  confidence: number
  bbox: [number, number, number, number]
  tracker_id?: number
}

interface FrameDetection {
  frame_index: number
  detections: Detection[]
}

interface DetectionData {
  fps: number
  frame_detections: FrameDetection[]
}

interface TrackletItem {
  id: string
  tracker_id: number
  object_type: string
  class_name: string
  timestamp_start_seconds: number
  timestamp_end_seconds: number
  frame_start: number
  frame_end: number
  mean_confidence: number
  best_bbox: number[]
  best_crop_path?: string
  score?: number
  tracklet_id?: string
}

// ─── Color palette (matches App.tsx modal exactly) ───────────────────────────

const NAMED_CLASS_COLORS: Record<string, string> = {
  person:        '#FF3838',
  car:           '#FF9D97',
  truck:         '#FF701F',
  bus:           '#FFB21D',
  motorcycle:    '#CFD231',
  bicycle:       '#48F90A',
  van:           '#92CC17',
  cat:           '#3DDB86',
  dog:           '#1A9334',
  bird:          '#00D4BB',
  horse:         '#2C99A8',
  cow:           '#00C2FF',
  sheep:         '#344593',
  airplane:      '#6473FF',
  boat:          '#0018EC',
  train:         '#8438FF',
  traffic_light: '#520085',
  stop_sign:     '#CB38FF',
  fire_hydrant:  '#FF95C8',
}

const FALLBACK_PALETTE = [
  '#E6194B', '#3CB44B', '#4363D8', '#F58231', '#911EB4',
  '#42D4F4', '#F032E6', '#BFEF45', '#FABED4', '#469990',
  '#DCBEFF', '#9A6324',
]

const classColor = (cn: string): string => {
  const key = cn.toLowerCase()
  if (NAMED_CLASS_COLORS[key]) return NAMED_CLASS_COLORS[key]
  let hash = 5381
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) + hash) + key.charCodeAt(i)
  return FALLBACK_PALETTE[Math.abs(hash) % FALLBACK_PALETTE.length]
}

const extractTrackerId = (val: any): string | null => {
  if (val == null) return null
  if (typeof val === 'number') return String(val)
  const str = String(val).trim()
  if (!str) return null
  if (/^\d+$/.test(str)) return str
  if (str.includes('_trk_')) {
    const parts = str.split('_trk_')
    const last = parts[parts.length - 1]
    if (/^\d+$/.test(last)) return last
  }
  return str
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function VideoDetail() {
  const { camera_id, video_id } = useParams<{ camera_id: string; video_id: string }>()

  // Data
  const [data, setData]       = useState<any>(null)  // eslint-disable-line @typescript-eslint/no-explicit-any
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  // Player
  const [playerView, setPlayerView]           = useState<'clean' | 'annotated'>('annotated')
  const [playerDetections, setPlayerDetections] = useState<DetectionData | null>(null)
  const [playerDetectionsLoading, setPlayerDetectionsLoading] = useState(false)
  const [playerClassFilter, setPlayerClassFilter] = useState<string>('all')
  const [showMotionPaths, setShowMotionPaths]     = useState<boolean>(true)
  const [isFullscreen, setIsFullscreen]           = useState<boolean>(false)

  // Seek highlight: track which tracklet is "focused" for dynamic green box & trajectory
  const [seekedTrackletId, setSeekedTrackletId] = useState<string | null>(null)
  const [seekedBbox, setSeekedBbox]             = useState<number[] | null>(null)
  const [seekedTrackletClass, setSeekedTrackletClass] = useState<string | null>(null)

  // Seek toast
  const [seekToast, setSeekToast]   = useState<string | null>(null)
  const seekToastTimerRef           = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Refs
  const videoRef           = useRef<HTMLVideoElement>(null)
  const canvasRef          = useRef<HTMLCanvasElement>(null)
  const playerSectionRef   = useRef<HTMLDivElement>(null)
  const playerContainerRef = useRef<HTMLDivElement>(null)

  // Export
  const [exportState, setExportState] = useState<'idle' | 'rendering' | 'ready' | 'error'>('idle')
  const [exportUrl, setExportUrl]     = useState<string | null>(null)

  // Local search
  const [localQuery, setLocalQuery]         = useState('')
  const [topK, setTopK]                     = useState(25)
  const [localResults, setLocalResults]     = useState<TrackletItem[]>([])
  const [searching, setSearching]           = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'person' | 'vehicle'>('all')

  // Chart
  const [chartMode, setChartMode] = useState<'instantaneous' | 'cumulative'>('instantaneous')

  // ─── Data fetching ──────────────────────────────────────────────────────────

  const fetchVideoDetails = useCallback(async () => {
    if (!video_id) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/v1/videos/${video_id}`)
      if (!res.ok) throw new Error('Video asset not found.')
      setData(await res.json())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load video details.')
    } finally {
      setLoading(false)
    }
  }, [video_id])

  useEffect(() => { fetchVideoDetails() }, [fetchVideoDetails])

  // ─── Detection loading ──────────────────────────────────────────────────────

  const loadPlayerDetections = useCallback(async () => {
    if (!video_id) return
    setPlayerDetectionsLoading(true)
    setPlayerDetections(null)
    try {
      const res = await fetch(`${API_BASE}/api/v1/videos/${video_id}/detections`)
      if (res.ok) setPlayerDetections(await res.json())
    } catch (_) { /* silent */ }
    setPlayerDetectionsLoading(false)
  }, [video_id])

  useEffect(() => {
    if (playerView === 'annotated') {
      loadPlayerDetections()
    } else {
      const canvas = canvasRef.current
      if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [playerView, loadPlayerDetections])

  // ─── Precision Canvas Alignment & Draw ──────────────────────────────────────

  const drawBoundingBoxes = useCallback(() => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !playerDetections) return

    const fps        = playerDetections.fps || 10
    const frameIndex = Math.round(video.currentTime * fps)
    const frameData  = (playerDetections.frame_detections ?? []).find(fd => fd.frame_index === frameIndex)

    // Canvas physical size matches video element client dimensions
    const cWidth  = video.clientWidth
    const cHeight = video.clientHeight
    if (canvas.width !== cWidth || canvas.height !== cHeight) {
      canvas.width  = cWidth
      canvas.height = cHeight
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, cWidth, cHeight)

    // Source native video dimensions
    const vWidth  = video.videoWidth  || 1280
    const vHeight = video.videoHeight || 720

    // Exact Aspect Ratio Sub-rectangle Calculation (Letterbox / Pillarbox compensation)
    const videoAspect     = vWidth / vHeight
    const containerAspect = cWidth / cHeight

    let renderW = 0
    let renderH = 0
    let offsetX = 0
    let offsetY = 0

    if (containerAspect > videoAspect) {
      // Pillarboxed (black bars left & right)
      renderH = cHeight
      renderW = renderH * videoAspect
      offsetX = (cWidth - renderW) / 2
      offsetY = 0
    } else {
      // Letterboxed (black bars top & bottom)
      renderW = cWidth
      renderH = renderW / videoAspect
      offsetX = 0
      offsetY = (cHeight - renderH) / 2
    }

    const scaleX = renderW / 1280
    const scaleY = renderH / 720

    // Map source coordinate (x,y) in 1280x720 space to canvas pixel coordinate
    const toCanvasX = (x: number) => offsetX + (x * scaleX)
    const toCanvasY = (y: number) => offsetY + (y * scaleY)

    // 1. Draw Motion Trajectories (Centroid Paths) up to current frameIndex
    if (showMotionPaths && playerDetections.frame_detections) {
      const trajectories: Record<number, Array<{ x: number; y: number; frame: number }>> = {}

      for (const fd of playerDetections.frame_detections) {
        if (fd.frame_index > frameIndex) break
        for (const det of fd.detections) {
          if (det.tracker_id == null) continue
          const cn = det.class_name ?? 'unknown'
          if (playerClassFilter !== 'all' && cn.toLowerCase() !== playerClassFilter) continue

          const [x1, y1, x2, y2] = det.bbox
          const cx = toCanvasX((x1 + x2) / 2)
          const cy = toCanvasY((y1 + y2) / 2)

          if (!trajectories[det.tracker_id]) trajectories[det.tracker_id] = []
          trajectories[det.tracker_id].push({ x: cx, y: cy, frame: fd.frame_index })
        }
      }

      for (const [tidStr, points] of Object.entries(trajectories)) {
        if (points.length < 2) continue
        const tid = Number(tidStr)
        const targetId = extractTrackerId(seekedTrackletId)
        const currentId = extractTrackerId(tid)
        const isSeeked = targetId !== null && currentId !== null && targetId === currentId

        const sampleDet = frameData?.detections.find(d => extractTrackerId(d.tracker_id) === currentId)
        const color = isSeeked ? '#00FF41' : (sampleDet ? classColor(sampleDet.class_name) : '#14B8A6')

        ctx.save()
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y)
        }

        ctx.strokeStyle = color
        ctx.lineWidth   = isSeeked ? 3.5 : 2
        ctx.setLineDash(isSeeked ? [] : [4, 4])
        ctx.globalAlpha = isSeeked ? 0.95 : 0.65
        ctx.stroke()

        const head = points[points.length - 1]
        ctx.fillStyle = color
        ctx.globalAlpha = 0.95
        ctx.beginPath()
        ctx.arc(head.x, head.y, isSeeked ? 5 : 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }

    // 2. Draw Bounding Boxes for Current Frame
    if (frameData) {
      const targetId = extractTrackerId(seekedTrackletId)

      for (const det of frameData.detections ?? []) {
        const cn = det.class_name ?? 'unknown'
        if (playerClassFilter !== 'all' && cn.toLowerCase() !== playerClassFilter) continue

        const detId = extractTrackerId(det.tracker_id)
        const isSeeked = targetId !== null && detId !== null && targetId === detId

        const [x1, y1, x2, y2] = det.bbox
        const cx1 = toCanvasX(x1)
        const cy1 = toCanvasY(y1)
        const cx2 = toCanvasX(x2)
        const cy2 = toCanvasY(y2)
        const cw  = cx2 - cx1
        const ch  = cy2 - cy1

        const color = classColor(cn)
        const conf  = ((det.confidence ?? 0) * 100).toFixed(0)
        const tid   = det.tracker_id != null ? ` #${det.tracker_id}` : ''
        const label = `${cn}${tid} ${conf}%`

        if (isSeeked) {
          // Thinner bright green highlight for seeked tracklet (DYNAMIC as video plays!)
          ctx.strokeStyle = '#00FF41'
          ctx.lineWidth   = 3
          ctx.strokeRect(cx1, cy1, cw, ch)

          // Outer glowing aura
          ctx.save()
          ctx.strokeStyle = 'rgba(0,255,65,0.45)'
          ctx.lineWidth   = 6
          ctx.strokeRect(cx1 - 1, cy1 - 1, cw + 2, ch + 2)
          ctx.restore()

          // Label background
          ctx.font = 'bold 11px monospace'
          const tw = ctx.measureText(label).width
          ctx.fillStyle = '#00FF41'
          ctx.fillRect(cx1, cy1 - 18, tw + 8, 18)
          ctx.fillStyle = '#000'
          ctx.fillText(label, cx1 + 4, cy1 - 4)
        } else {
          ctx.strokeStyle = color
          ctx.lineWidth   = 1.5
          ctx.strokeRect(cx1, cy1, cw, ch)

          ctx.font = 'bold 10px monospace'
          const tw = ctx.measureText(label).width
          ctx.fillStyle = color
          ctx.fillRect(cx1, cy1 - 15, tw + 6, 15)
          ctx.fillStyle = '#000'
          ctx.fillText(label, cx1 + 3, cy1 - 3)
        }
      }
    }

    // Static fallback box if video is paused outside detections range
    if (seekedBbox && seekedTrackletId) {
      const targetId = extractTrackerId(seekedTrackletId)
      const hasSeekedInFrame = frameData?.detections.some(
        d => {
          const detId = extractTrackerId(d.tracker_id)
          return targetId !== null && detId !== null && targetId === detId
        }
      )
      if (!hasSeekedInFrame && video.paused) {
        const [bx1, by1, bx2, by2] = seekedBbox
        const cx1 = toCanvasX(bx1)
        const cy1 = toCanvasY(by1)
        const cw  = toCanvasX(bx2) - cx1
        const ch  = toCanvasY(by2) - cy1

        ctx.save()
        // Thinner bright green highlight for fallback box (same as active)
        ctx.strokeStyle = '#00FF41'
        ctx.lineWidth   = 3
        ctx.strokeRect(cx1, cy1, cw, ch)

        // Outer glowing aura
        ctx.strokeStyle = 'rgba(0,255,65,0.45)'
        ctx.lineWidth   = 6
        ctx.strokeRect(cx1 - 1, cy1 - 1, cw + 2, ch + 2)

        // Label background
        const displayClass = seekedTrackletClass || 'object'
        const label = `${displayClass} #${seekedTrackletId}`
        ctx.font = 'bold 11px monospace'
        const tw = ctx.measureText(label).width
        ctx.fillStyle = '#00FF41'
        ctx.fillRect(cx1, cy1 - 18, tw + 8, 18)
        ctx.fillStyle = '#000'
        ctx.fillText(label, cx1 + 4, cy1 - 4)
        ctx.restore()
      }
    }
  }, [playerDetections, playerClassFilter, showMotionPaths, seekedTrackletId, seekedBbox, seekedTrackletClass])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.addEventListener('timeupdate', drawBoundingBoxes)
    video.addEventListener('seeked',     drawBoundingBoxes)
    window.addEventListener('resize',    drawBoundingBoxes)
    return () => {
      video.removeEventListener('timeupdate', drawBoundingBoxes)
      video.removeEventListener('seeked',     drawBoundingBoxes)
      window.removeEventListener('resize',    drawBoundingBoxes)
    }
  }, [drawBoundingBoxes])

  // Fullscreen change listener
  useEffect(() => {
    const handleFSChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
      setTimeout(drawBoundingBoxes, 100)
    }
    document.addEventListener('fullscreenchange', handleFSChange)
    return () => document.removeEventListener('fullscreenchange', handleFSChange)
  }, [drawBoundingBoxes])

  // ─── Fullscreen Toggle Handler ──────────────────────────────────────────────

  const toggleFullscreen = () => {
    if (!playerContainerRef.current) return
    if (!document.fullscreenElement) {
      playerContainerRef.current.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }

  // ─── Seek + Scroll + Toast ──────────────────────────────────────────────────

  const showSeekToast = (msg: string) => {
    setSeekToast(msg)
    if (seekToastTimerRef.current) clearTimeout(seekToastTimerRef.current)
    seekToastTimerRef.current = setTimeout(() => setSeekToast(null), 2800)
  }

  const seekAndPause = (seconds: number, tracklet?: TrackletItem) => {
    if (playerView !== 'annotated') setPlayerView('annotated')

    if (tracklet) {
      const rawTid = tracklet.tracker_id != null ? tracklet.tracker_id : (tracklet.tracklet_id || tracklet.id)
      const tid = extractTrackerId(rawTid)
      setSeekedTrackletId(tid)
      setSeekedBbox(tracklet.best_bbox ?? null)
      setSeekedTrackletClass(tracklet.class_name || tracklet.object_type || null)
    }

    const doSeek = () => {
      if (videoRef.current) {
        videoRef.current.currentTime = seconds
        videoRef.current.pause()
      }
    }

    if (playerSectionRef.current) {
      playerSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setTimeout(doSeek, 350)
    } else {
      doSeek()
    }

    showSeekToast(`Paused at ${seconds.toFixed(2)}s — Object Highlighted`)
  }

  // ─── Export annotated video ─────────────────────────────────────────────────

  const handleExportAnnotated = async () => {
    if (!video_id) return
    setExportState('rendering')
    setExportUrl(null)
    try {
      const res = await fetch(`${API_BASE}/api/v1/videos/${video_id}/export-annotated`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter_class: playerClassFilter === 'all' ? null : playerClassFilter, force: false }),
      })
      if (!res.ok) throw new Error('Export failed')
      const json = await res.json()
      setExportUrl(`${API_BASE}${json.output_url}`)
      setExportState('ready')
    } catch (_) {
      setExportState('error')
    }
  }

  // ─── SHA Report download ────────────────────────────────────────────────────

  const handleDownloadSHAReport = async () => {
    if (!data) return
    const video    = data.video || {}
    const tracklets: TrackletItem[] = data.tracklets || []

    const header =
      `TRACENET — SINGLE-VIDEO EVIDENCE AUDIT RECORD\n` +
      `Generated:        ${new Date().toISOString()}\n` +
      `Camera Node:      ${video.camera_id}\n` +
      `Video Asset ID:   ${video.id}\n` +
      `Original File:    ${video.original_filename}\n` +
      `Intake SHA-256:   ${video.intake_sha256}\n` +
      `Transcoded SHA:   ${video.transcoded_sha256 || 'N/A'}\n` +
      `Tracklets Count:  ${tracklets.length}\n` +
      `${'='.repeat(72)}\n\n`

    const body = tracklets.map((t: TrackletItem, i: number) => {
      const dwell = Math.max(0.1, (t.timestamp_end_seconds || 0) - (t.timestamp_start_seconds || 0)).toFixed(1)
      return (
        `Tracklet #${i + 1}  [ID: ${t.id}]\n` +
        `  Class:      ${t.class_name} (${t.object_type})\n` +
        `  Tracker ID: #${t.tracker_id}\n` +
        `  Frames:     ${t.frame_start} – ${t.frame_end}\n` +
        `  Time:       ${t.timestamp_start_seconds.toFixed(2)}s – ${t.timestamp_end_seconds.toFixed(2)}s (Dwell: ${dwell}s)\n` +
        `  Confidence: ${(t.mean_confidence * 100).toFixed(1)}%\n` +
        `${'-'.repeat(72)}\n`
      )
    }).join('\n')

    const content = header + body
    const msgBuf  = new TextEncoder().encode(content)
    const hashBuf = await crypto.subtle.digest('SHA-256', msgBuf)
    const hash    = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')

    const full = content + `\nVerification SHA-256: ${hash}\n`
    const blob = new Blob([full], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `evidence_${video.id}_${Date.now()}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  // ─── Download blob helper ────────────────────────────────────────────────────

  const downloadBlob = async (url: string, filename: string) => {
    try {
      const res  = await fetch(url)
      const blob = await res.blob()
      const obj  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = obj
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(obj), 10000)
    } catch (err) {
      console.error('Download failed', err)
    }
  }

  // ─── Local CLIP search ──────────────────────────────────────────────────────

  const handleLocalSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!localQuery.trim() || !video_id) return
    setSearching(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/search`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query:       localQuery.trim(),
          video_id:    video_id,
          object_type: selectedCategory,
          top_k:       topK,
        }),
      })
      if (res.ok) setLocalResults(await res.json())
    } catch (err) {
      console.error('Local video search failed:', err)
    } finally {
      setSearching(false)
    }
  }

  // ─── Video URL ──────────────────────────────────────────────────────────────

  const getVideoPlayerUrl = (videoObj: any, cameraObj: any): string => {  // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!videoObj) return ''
    if (videoObj.thumbnail_path && videoObj.standardized_filename) {
      const parts = videoObj.thumbnail_path.split(/[/\\]/)
      const ci    = parts.indexOf('cameras')
      if (ci !== -1 && parts.length > ci + 1)
        return `${API_BASE}/data/cameras/${parts[ci + 1]}/original_assets/${videoObj.standardized_filename}`
    }
    const cam = cameraObj?.camera_id || camera_id
    return videoObj.standardized_filename
      ? `${API_BASE}/data/cameras/${cam}/original_assets/${videoObj.standardized_filename}`
      : ''
  }

  // ─── Loading / error states ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] gap-3 text-sm text-slate-500">
        <RefreshCw className="animate-spin h-5 w-5 text-teal-600" />
        <span>Loading video workspace...</span>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-6 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
        {error || 'Failed to load video workspace.'}
      </div>
    )
  }

  if (data?.video?.is_bin) {
    return (
      <div className="p-8 max-w-lg mx-auto mt-12 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 rounded-md text-center shadow-lg">
        <div className="flex justify-center mb-4">
          <div className="p-3 bg-rose-500/10 rounded-full animate-bounce">
            <svg className="h-8 w-8 text-rose-600 dark:text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
        </div>
        <h3 className="text-base font-bold text-rose-800 dark:text-rose-400 mb-2">Access Restricted</h3>
        <p className="text-xs text-rose-600 dark:text-rose-350 leading-relaxed mb-6">
          This video segment has been moved to the Bin. Workspace investigation features, local search, and tracking analytics are disabled until this segment is restored from the camera control center.
        </p>
        <button
          onClick={() => window.history.back()}
          className="px-4 py-2 bg-rose-700 hover:bg-rose-800 text-white rounded text-xs font-bold transition-all shadow"
        >
          Go Back
        </button>
      </div>
    )
  }

  // ─── Derived values ─────────────────────────────────────────────────────────

  const video    = data.video    || {}
  const camera   = data.camera   || {}
  const tracklets: TrackletItem[] = data.tracklets || []
  const videoUrl = getVideoPlayerUrl(video, camera)

  const playerClasses: string[] = playerDetections
    ? Array.from(new Set(
        (playerDetections.frame_detections ?? []).flatMap(fd =>
          fd.detections.map(d => d.class_name)
        )
      ))
    : []

  const displayTracklets = localResults.length > 0
    ? localResults
    : tracklets.filter(t => selectedCategory === 'all' || t.object_type === selectedCategory)

  // ─── ECharts analytics data ─────────────────────────────────────────────────

  let chartDuration = video.duration || 0
  if (!chartDuration && playerDetections && playerDetections.frame_detections.length > 0) {
    const maxFrame = Math.max(...playerDetections.frame_detections.map(fd => fd.frame_index))
    chartDuration  = maxFrame / (playerDetections.fps || 10)
  }

  const buildChartOption = () => {
    if (!playerDetections || chartDuration <= 0) return null

    const fps        = playerDetections.fps || 10
    const buckets    = Math.ceil(chartDuration)
    const xAxisData  = Array.from({ length: buckets }, (_, i) => `${i}s`)

    const series = playerClasses.map(cls => {
      const counts = new Array(buckets).fill(0)
      for (const fd of playerDetections.frame_detections) {
        const sec = Math.floor(fd.frame_index / fps)
        if (sec >= 0 && sec < buckets) {
          counts[sec] += fd.detections.filter(d => d.class_name === cls).length
        }
      }
      if (chartMode === 'cumulative') {
        for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1]
      }
      return {
        name:   cls,
        type:   'line',
        smooth: true,
        symbol: 'none',
        lineStyle:  { width: 2, color: classColor(cls) },
        areaStyle:  { color: classColor(cls), opacity: 0.06 },
        itemStyle:  { color: classColor(cls) },
        data:   counts,
      }
    }).filter(s => (s.data as number[]).some(v => v > 0))

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger:    'axis',
        axisPointer: { type: 'cross', lineStyle: { color: '#888' } },
        formatter: (params: any[]) => {  // eslint-disable-line @typescript-eslint/no-explicit-any
          const t = params[0]?.axisValue ?? ''
          const rows = params
            .filter((p: any) => p.value > 0)  // eslint-disable-line @typescript-eslint/no-explicit-any
            .map((p: any) =>  // eslint-disable-line @typescript-eslint/no-explicit-any
              `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:5px"></span>${p.seriesName}: <b>${p.value}</b>`
            ).join('<br/>')
          return `<div style="font-size:11px"><b>${t}</b><br/>${rows || 'No detections'}</div>`
        },
      },
      legend: {
        bottom: 0,
        textStyle: { fontSize: 11, color: '#6B7280' },
        icon: 'circle',
      },
      grid: { top: 10, bottom: 40, left: 40, right: 16, containLabel: false },
      xAxis: {
        type:       'category',
        data:       xAxisData,
        axisLabel:  { fontSize: 10, color: '#9CA3AF', interval: Math.max(0, Math.floor(buckets / 10) - 1) },
        axisLine:   { lineStyle: { color: '#E5E7EB' } },
        splitLine:  { show: false },
      },
      yAxis: {
        type:       'value',
        minInterval: 1,
        axisLabel:  { fontSize: 10, color: '#9CA3AF' },
        splitLine:  { lineStyle: { color: '#F3F4F6', type: 'dashed' } },
        axisLine:   { show: false },
      },
      series,
    }
  }

  const chartOption = buildChartOption()

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 animate-in fade-in duration-200 text-sm font-sans relative">

      {/* ── SEEK TOAST NOTIFICATION ───────────────────────────────────────────── */}
      {seekToast && (
        <div className="fixed top-4 right-6 z-[200] bg-slate-900 text-white text-xs font-bold px-4 py-2.5 rounded-md shadow-xl border border-teal-500/40 flex items-center gap-2 animate-in slide-in-from-top-2 duration-150">
          <Activity className="h-4 w-4 text-teal-400 animate-pulse shrink-0" />
          <span>{seekToast}</span>
        </div>
      )}

      {/* ── 1. HEADER & METADATA BANNER ───────────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md p-2 px-3 flex flex-wrap items-center justify-between gap-3 text-xs shadow-sm">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="font-extrabold text-slate-800 dark:text-slate-100 text-sm">
            {camera.name || camera_id}
          </span>
          <span className="text-[10px] text-slate-500 font-mono bg-slate-100 dark:bg-slate-900 px-1.5 py-0.5 rounded">
            ID: {camera.camera_id || camera_id}
          </span>
          <span className="text-slate-300 dark:text-slate-600">|</span>
          <span className="font-mono text-slate-400 truncate max-w-[200px]" title={video.original_filename}>
            {video.original_filename}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600 dark:text-slate-300">
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            Duration: <strong className="font-mono">{video.duration ? `${video.duration.toFixed(1)}s` : '--'}</strong>
          </span>
          <span className="text-slate-300 dark:text-slate-600">|</span>
          <span className="flex items-center gap-1">
            <Layers className="h-3.5 w-3.5 text-slate-400" />
            Tracklets: <strong className="font-mono text-teal-700 dark:text-teal-400">{tracklets.length}</strong>
          </span>
          <span className="text-slate-300 dark:text-slate-600">|</span>
          <span className="flex items-center gap-1">
            Status:
            <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 rounded font-bold uppercase tracking-wide text-[10px]">{video.processing_status}</span>
          </span>
          <span className="text-slate-300 dark:text-slate-600">|</span>
          <span
            className="font-mono truncate max-w-[150px] cursor-help flex items-center gap-1 text-slate-400"
            title={`Intake SHA-256: ${video.intake_sha256}`}
          >
            <FileText className="h-3.5 w-3.5 text-slate-400" />
            SHA: {video.intake_sha256 ? video.intake_sha256.substring(0, 8) + '...' : '--'}
          </span>
        </div>
      </div>

      {/* ── 3. MAIN GRID: Player + Controls ───────────────────────────────────── */}
      <div ref={playerSectionRef} className="grid lg:grid-cols-[2fr_1fr] gap-4">

        {/* ── LEFT: Video Player ──────────────────────────────────────────────── */}
        <div className="space-y-0">
          {/* Player toolbar */}
          <div className="flex justify-between items-center bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 border-b-0 px-3 py-2 rounded-t-md">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Forensic Stream</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={toggleFullscreen}
                className="px-2.5 py-1 rounded bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-xs font-bold text-slate-700 dark:text-slate-200 transition-colors flex items-center gap-1.5"
                title="Fullscreen mode with overlay bounding boxes"
              >
                {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                <span>{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
              </button>

              <div className="flex items-center bg-slate-200 dark:bg-slate-700 p-0.5 rounded-md">
                <button
                  onClick={() => setPlayerView('clean')}
                  className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                    playerView === 'clean'
                      ? 'bg-white dark:bg-slate-600 text-teal-700 dark:text-teal-400 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >
                  Clean
                </button>
                <button
                  onClick={() => setPlayerView('annotated')}
                  className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                    playerView === 'annotated'
                      ? 'bg-teal-700 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >
                  Annotated
                </button>
              </div>
            </div>
          </div>

          {/* Video + Canvas Wrapper (Ref used for Fullscreen container) */}
          <div
            ref={playerContainerRef}
            className="relative bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-b-md overflow-hidden flex items-center justify-center min-h-[380px]"
          >
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              className="w-full h-auto max-h-[560px] object-contain"
            />
            <canvas
              ref={canvasRef}
              className={`absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-200 ${
                playerView === 'annotated' ? 'opacity-100' : 'opacity-0'
              }`}
            />
            {playerView === 'annotated' && playerDetectionsLoading && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <div className="flex items-center gap-2 text-white text-xs font-bold">
                  <RefreshCw className="animate-spin h-4 w-4 text-teal-400" />
                  <span>Loading detections...</span>
                </div>
              </div>
            )}
            {playerView === 'annotated' && !playerDetectionsLoading && !playerDetections && (
              <div className="absolute bottom-4 left-4 right-4">
                <div className="rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs p-2.5 text-center">
                  No detection data available. Run Detections first.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Annotation Controls + Forensic Metadata ─────────────────── */}
        <div className="space-y-3">

          {/* Annotation Controls card */}
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 rounded-md space-y-3">
            <div className="flex items-center gap-1.5 text-slate-400">
              <Filter className="h-3.5 w-3.5" />
              <h3 className="text-[10px] font-bold uppercase tracking-wider">Annotation Controls</h3>
            </div>

            {/* Class filter */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-600 dark:text-slate-300">Filter Class</label>
              <select
                value={playerClassFilter}
                onChange={(e) => setPlayerClassFilter(e.target.value)}
                className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-xs focus:outline-none focus:border-teal-700"
              >
                <option value="all">All Classes</option>
                {playerClasses.map(c => (
                  <option key={c} value={c.toLowerCase()}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>

            {/* Motion Trajectory Paths toggle */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Motion Path Trajectories</span>
              <button
                onClick={() => setShowMotionPaths(!showMotionPaths)}
                className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${
                  showMotionPaths
                    ? 'bg-teal-500/20 text-teal-700 dark:text-teal-400 border border-teal-500/30'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-400'
                }`}
              >
                {showMotionPaths ? 'ON' : 'OFF'}
              </button>
            </div>

            {/* Color legend */}
            {playerClasses.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1.5 pt-1">
                {playerClasses.map(c => (
                  <div key={c} className="flex items-center gap-1.5 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: classColor(c) }} />
                    <span className="text-slate-600 dark:text-slate-300 capitalize">{c}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Seek highlight clear */}
            {seekedTrackletId && (
              <div className="flex items-center gap-2 p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-md">
                <Crosshair className="h-4 w-4 text-[#00FF41] animate-pulse shrink-0" />
                <span className="text-xs text-emerald-700 dark:text-emerald-400 font-bold flex-1">
                  Track #{seekedTrackletId} dynamically tracked
                </span>
                <button
                  onClick={() => { setSeekedTrackletId(null); setSeekedBbox(null); setSeekedTrackletClass(null) }}
                  className="text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white underline flex items-center gap-1"
                >
                  <X className="h-3 w-3" /> Clear Special BBox
                </button>
              </div>
            )}

            {/* Export annotated video */}
            <div className="pt-1 border-t border-slate-100 dark:border-slate-700 space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Export Annotated Video</label>
              {exportState === 'idle' && (
                <button
                  onClick={handleExportAnnotated}
                  disabled={playerDetectionsLoading}
                  className="w-full py-1.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-bold text-xs rounded transition-colors flex items-center justify-center gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" /> Generate &amp; Download
                </button>
              )}
              {exportState === 'rendering' && (
                <div className="flex items-center gap-2 text-xs text-teal-600 font-semibold">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Rendering on server...</span>
                </div>
              )}
              {exportState === 'ready' && exportUrl && (
                <button
                  onClick={() => downloadBlob(exportUrl, exportUrl.split('/').pop() ?? 'annotated.mp4')}
                  className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded transition-colors flex items-center justify-center gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" /> Download Annotated MP4
                </button>
              )}
              {exportState === 'error' && (
                <p className="text-xs text-rose-500 font-semibold">Export failed. Check backend logs.</p>
              )}
            </div>
          </div>

          {/* Forensic Metadata card */}
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 rounded-md space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Footprint Properties</h3>

            <div className="text-xs space-y-1.5 text-slate-600 dark:text-slate-300">
              {[
                ['Format',      'H.264 MP4'],
                ['Resolution',  '1280×720 (720p)'],
                ['Framerate',   '10.0 FPS (CFR)'],
                ['Sampler',     '4.0 FPS Timeline'],
                ['Duration',    video.duration ? `${video.duration.toFixed(1)}s` : '--'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-slate-100 dark:border-slate-700 pb-0.5">
                  <span>{k}:</span>
                  <strong className="font-mono">{v}</strong>
                </div>
              ))}
            </div>

            {/* SHA display */}
            <div className="pt-1 border-t border-slate-100 dark:border-slate-700">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                Verification SHA-256
              </label>
              <div className="text-[10px] font-mono break-all text-teal-700 dark:text-teal-400 bg-slate-50 dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-700">
                {video.intake_sha256 || 'Calculating...'}
              </div>
            </div>

            {/* Action buttons */}
            <div className="space-y-1.5 pt-1">
              <button
                onClick={handleDownloadSHAReport}
                className="w-full py-1.5 bg-slate-700 hover:bg-slate-800 text-white font-bold text-xs rounded transition-colors flex items-center justify-center gap-1.5"
              >
                <FileText className="h-3.5 w-3.5" /> Download SHA-256 Report
              </button>
              <button
                onClick={() => downloadBlob(videoUrl, video.original_filename)}
                className="w-full py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold text-xs rounded transition-colors border border-slate-200 dark:border-slate-600 flex items-center justify-center gap-1.5"
              >
                <Download className="h-3.5 w-3.5" /> Download Original Video
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* ── 4. DETECTION ANALYTICS CHART (ECharts) ──────────────────────────── */}
      {chartOption && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 rounded-md">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Detection Analytics Timeline</h3>
              <p className="text-xs text-slate-400 mt-0.5">Detection count per second — click chart to seek video</p>
            </div>
            <div className="flex items-center bg-slate-100 dark:bg-slate-900 p-0.5 rounded border border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setChartMode('instantaneous')}
                className={`px-3 py-1 text-xs font-bold rounded transition-all ${
                  chartMode === 'instantaneous'
                    ? 'bg-white dark:bg-slate-700 text-teal-700 dark:text-teal-400 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                Instantaneous
              </button>
              <button
                onClick={() => setChartMode('cumulative')}
                className={`px-3 py-1 text-xs font-bold rounded transition-all ${
                  chartMode === 'cumulative'
                    ? 'bg-white dark:bg-slate-700 text-teal-700 dark:text-teal-400 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                Cumulative
              </button>
            </div>
          </div>

          <ReactECharts
            option={chartOption}
            style={{ height: 220 }}
            onEvents={{
              click: (params: any) => {  // eslint-disable-line @typescript-eslint/no-explicit-any
                if (params.dataIndex !== undefined) {
                  seekAndPause(params.dataIndex)
                }
              },
            }}
          />
        </div>
      )}

      {/* ── 5. CLIP SEARCH + TRACKLET GRID ──────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 rounded-md space-y-3">

        {/* Header row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Local CLIP Video Search</h3>
          </div>

          {/* Category filter chips */}
          <div className="flex items-center gap-1.5">
            {(['all', 'person', 'vehicle'] as const).map(cat => (
              <button
                key={cat}
                onClick={() => { setSelectedCategory(cat); setLocalResults([]) }}
                className={`px-2.5 py-1 text-xs font-bold rounded capitalize border transition-colors ${
                  selectedCategory === cat
                    ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-800'
                    : 'bg-slate-50 dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Search form */}
        <form onSubmit={handleLocalSearch} className="flex gap-2 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              required
              placeholder="e.g. red car, person in black hoodie..."
              value={localQuery}
              onChange={(e) => setLocalQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm focus:outline-none focus:border-teal-700 transition-colors"
            />
          </div>

          {/* Top-K control */}
          <div className="flex items-center gap-1 shrink-0">
            <label className="text-xs text-slate-500 font-bold whitespace-nowrap">Top-K</label>
            <input
              type="number"
              min={1}
              max={100}
              value={topK}
              onChange={(e) => setTopK(Math.max(1, Math.min(100, Number(e.target.value))))}
              className="w-14 px-2 py-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-center focus:outline-none focus:border-teal-700"
            />
          </div>

          <button
            type="submit"
            disabled={searching}
            className="px-4 py-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white font-bold text-xs rounded transition-colors shrink-0 flex items-center gap-1.5"
          >
            {searching ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            <span>{searching ? 'Searching...' : 'Search'}</span>
          </button>

          {localResults.length > 0 && (
            <button
              type="button"
              onClick={() => { setLocalResults([]); setLocalQuery('') }}
              className="px-3 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 font-bold text-xs rounded transition-colors border border-slate-200 dark:border-slate-600 shrink-0 flex items-center gap-1"
            >
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </form>

        {/* Results count */}
        {localResults.length > 0 && (
          <p className="text-xs text-slate-500">
            <span className="font-bold text-teal-700 dark:text-teal-400">{localResults.length}</span> results for &ldquo;<em>{localQuery}</em>&rdquo;
          </p>
        )}

        {/* Tracklet Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {displayTracklets.map((item) => {
            const tid     = item.tracklet_id || item.id
            const trackerId = item.tracker_id
            const cp      = item.best_crop_path
            const cropUrl = cp
              ? (cp.startsWith('http') ? cp : `${API_BASE}${cp.startsWith('/data/') ? cp : '/' + cp}`)
              : ''
            const itemTid = extractTrackerId(item.tracker_id || item.tracklet_id || item.id)
            const targetTid = extractTrackerId(seekedTrackletId)
            const isHighlighted = targetTid !== null && itemTid !== null && targetTid === itemTid
            const dwellSec = Math.max(0.1, (item.timestamp_end_seconds || 0) - (item.timestamp_start_seconds || 0)).toFixed(1)

            return (
              <div
                key={tid}
                className={`flex flex-col rounded-md overflow-hidden border transition-all ${
                  isHighlighted
                    ? 'border-[#00FF41] ring-2 ring-[#00FF41]/50 bg-emerald-500/5 shadow-md'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-400 dark:hover:border-slate-600'
                }`}
              >
                {/* Fixed-size image box: aspect-square, object-contain, grey bg */}
                <div className="relative aspect-square bg-slate-200 dark:bg-slate-800 flex items-center justify-center overflow-hidden">
                  {cropUrl ? (
                    <img
                      src={cropUrl}
                      alt={item.class_name}
                      className="w-full h-full object-contain"
                      loading="lazy"
                    />
                  ) : (
                    <FileText className="h-8 w-8 text-slate-400 opacity-40" />
                  )}

                  {/* Class badge */}
                  <div className="absolute bottom-1 left-1">
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white shadow-sm capitalize"
                      style={{ backgroundColor: classColor(item.class_name) }}
                    >
                      {item.class_name} #{trackerId}
                    </span>
                  </div>

                  {/* Score badge (search results only) */}
                  {item.score !== undefined && (
                    <div className="absolute top-1 right-1">
                      <span className="bg-emerald-600/90 text-white px-1.5 py-0.5 rounded text-[10px] font-bold shadow-sm">
                        {(item.score * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}

                  {/* Highlighted marker badge */}
                  {isHighlighted && (
                    <div className="absolute top-1 left-1 flex items-center gap-1 bg-[#00FF41] text-black px-1.5 py-0.5 rounded text-[9px] font-bold">
                      <Crosshair className="h-3 w-3 animate-spin" />
                      <span>TRACKING</span>
                    </div>
                  )}
                </div>

                {/* Footer metadata */}
                <div className="p-2 space-y-1.5">
                  <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                    <span>Start: {item.timestamp_start_seconds.toFixed(1)}s</span>
                    <span className="font-bold text-teal-700 dark:text-teal-400">Dwell: {dwellSec}s</span>
                  </div>

                  <button
                    onClick={() => seekAndPause(item.timestamp_start_seconds, item)}
                    className={`w-full py-1.5 font-bold text-xs rounded transition-all flex items-center justify-center gap-1.5 ${
                      isHighlighted
                        ? 'bg-[#00FF41] text-black shadow-sm font-extrabold'
                        : 'bg-teal-50 dark:bg-teal-900/30 hover:bg-teal-100 dark:hover:bg-teal-900/50 text-teal-700 dark:text-teal-400 border border-teal-200 dark:border-teal-800'
                    }`}
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    <span>Seek &amp; Highlight</span>
                  </button>
                </div>
              </div>
            )
          })}

          {displayTracklets.length === 0 && (
            <div className="col-span-full py-10 text-center text-slate-400 text-xs">
              {localResults.length === 0 && localQuery
                ? 'No matches found. Try a different query.'
                : 'No tracklets found for this filter.'}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
