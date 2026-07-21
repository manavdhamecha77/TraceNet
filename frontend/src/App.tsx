import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Cameras from './pages/Cameras'
import CameraDetail from './pages/CameraDetail'
import Search from './pages/Search'
import Landing from './pages/Landing'
import Models from './pages/Models'
import EmbeddingModels from './pages/EmbeddingModels'
import VideoDetail from './pages/VideoDetail'
import Alerts from './pages/Alerts'
import {
  ExternalLink,
  Download,
  Crosshair,
  X,
  Eye,
  RefreshCw,
} from 'lucide-react'

const API_BASE = 'http://localhost:8000'

interface Camera {
  camera_id: string
  name: string
  latitude?: number
  longitude?: number
  corridor_group?: string
  adjacency: string[]
  is_active: boolean
  status: string
  altitude?: number
  model_id?: string | null
  video_count: number
}

interface Video {
  id: string
  camera_id: string
  original_filename: string
  standardized_filename: string
  intake_sha256: string
  transcoded_sha256?: string
  upload_timestamp?: string
  processing_status: string
  progress_percentage?: number
  duration?: number
  start_time?: string
  end_time?: string
  thumbnail_path?: string
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

function App() {
  const location = useLocation()

  // Theme & Layout state
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('drishti-theme')
    if (saved === 'light' || saved === 'dark') return saved
    return 'light' // default light per specification
  })
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)

  // Data state
  const [cameras, setCameras] = useState<Camera[]>([])
  const [models, setModels] = useState<any[]>([])
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null)
  const [cameraVideos, setCameraVideos] = useState<Video[]>([])

  // Global modals state
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false)
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false)
  const [selectedVideoToPlay, setSelectedVideoToPlay] = useState<Video | null>(null)

  // Annotated player state
  const [playerView, setPlayerView] = useState<'clean' | 'annotated'>('clean')
  const [playerDetections, setPlayerDetections] = useState<any | null>(null)
  const [playerDetectionsLoading, setPlayerDetectionsLoading] = useState(false)
  const [playerClassFilter, setPlayerClassFilter] = useState<string>('all')
  const [seekedTrackerId, setSeekedTrackerId] = useState<string | null>(null)
  const [seekedBbox, setSeekedBbox] = useState<number[] | null>(null)
  const [seekedTrackletClass, setSeekedTrackletClass] = useState<string | null>(null)
  const [showMotionPaths, setShowMotionPaths] = useState<boolean>(true)
  const [exportState, setExportState] = useState<'idle' | 'rendering' | 'ready' | 'error'>('idle')
  const [exportUrl, setExportUrl] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Tracklet inspect modal (opened from detection card grid)
  const [inspectTracklet, setInspectTracklet] = useState<{ tracklet: any; video: Video } | null>(null)

  // Camera Form State
  const [newCameraId, setNewCameraId] = useState('')
  const [newCameraName, setNewCameraName] = useState('')
  const [newCameraLat, setNewCameraLat] = useState('')
  const [newCameraLon, setNewCameraLon] = useState('')
  const [newCameraAltitude, setNewCameraAltitude] = useState('')
  const [newCameraCorridor, setNewCameraCorridor] = useState('')
  const [newCameraAdjacency, setNewCameraAdjacency] = useState('')
  const [newCameraStatus, setNewCameraStatus] = useState('active')
  const [newCameraModelId, setNewCameraModelId] = useState('')
  const [cameraFormError, setCameraFormError] = useState('')

  // Video Form State
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadStartTime, setUploadStartTime] = useState('')
  const [uploadProgress, setUploadProgress] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle')
  const [uploadError, setUploadError] = useState('')
  const [uploadDragActive, setUploadDragActive] = useState(false)

  // Dashboard metrics state
  const [metrics, setMetrics] = useState({
    totalCameras: 0,
    totalVideos: 0,
    processedVideos: 0,
    pendingVideos: 0,
    failedVideos: 0,
  })

  // Theme effect
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('drishti-theme', theme)
  }, [theme])

  // Fetch cameras
  const fetchCameras = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/cameras`)
      if (res.ok) {
        const data = await res.json()
        setCameras(data)
      }
    } catch (err) {
      console.error('Failed to fetch cameras:', err)
    }
  }

  // Fetch models
  const fetchModels = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/models`)
      if (res.ok) {
        const data = await res.json()
        setModels(data)
      }
    } catch (err) {
      console.error('Failed to fetch models:', err)
    }
  }

  // Fetch cameras and models on mount, location change, and periodically every 5 seconds
  useEffect(() => {
    fetchCameras()
    fetchModels()
    const timer = setInterval(() => {
      fetchCameras()
      fetchModels()
    }, 5000)
    return () => clearInterval(timer)
  }, [location.pathname])

  // Fetch aggregated dashboard metrics from backend
  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/metrics/dashboard`)
        if (res.ok) {
          const data = await res.json()
          setMetrics({
            totalCameras: data.total_cameras,
            totalVideos: data.total_videos,
            processedVideos: data.processed_videos,
            pendingVideos: data.pending_videos + data.processing_videos,
            failedVideos: data.failed_videos,
          })
        }
      } catch (err) {
        console.error('Failed to fetch dashboard metrics:', err)
      }
    }
    fetchMetrics()
  }, [location.pathname])

  // Register camera submit
  const handleCreateCamera = async (e: React.FormEvent) => {
    e.preventDefault()
    setCameraFormError('')

    if (!newCameraId || !newCameraName) {
      setCameraFormError('Camera ID and Camera Name are required.')
      return
    }

    const adjacencyList = newCameraAdjacency
      ? newCameraAdjacency.split(',').map((s) => s.trim()).filter((s) => s)
      : []

    const payload = {
      camera_id: newCameraId.trim(),
      name: newCameraName.trim(),
      latitude: newCameraLat ? parseFloat(newCameraLat) : null,
      longitude: newCameraLon ? parseFloat(newCameraLon) : null,
      corridor_group: newCameraCorridor.trim() || null,
      adjacency: adjacencyList,
      status: newCameraStatus,
      altitude: newCameraAltitude ? parseFloat(newCameraAltitude) : null,
      model_id: newCameraModelId || null,
    }

    try {
      const res = await fetch(`${API_BASE}/api/v1/create-new-camera`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.status === 201) {
        setIsCameraModalOpen(false)
        fetchCameras()
        // Reset form
        setNewCameraId('')
        setNewCameraName('')
        setNewCameraLat('')
        setNewCameraLon('')
        setNewCameraCorridor('')
        setNewCameraAdjacency('')
        setNewCameraStatus('active')
        setNewCameraAltitude('')
        setNewCameraModelId('')
      } else {
        const errorData = await res.json()
        setCameraFormError(errorData.detail || 'Failed to register camera.')
      }
    } catch (err) {
      setCameraFormError('Network error. Failed to reach backend API.')
    }
  }

  // Upload video submit
  const handleUploadVideo = async (e: React.FormEvent) => {
    e.preventDefault()
    setUploadError('')

    if (!uploadFile) {
      setUploadError('Please select a video file.')
      return
    }

    const maxSize = 2 * 1024 * 1024 * 1024
    if (uploadFile.size > maxSize) {
      setUploadError(`File size exceeds 2GB limit. Current: ${(uploadFile.size / 1024 / 1024 / 1024).toFixed(2)}GB`)
      return
    }

    if (!selectedCamera) return

    setUploadProgress('uploading')

    const formData = new FormData()
    formData.append('file', uploadFile)
    formData.append('camera_id', selectedCamera.camera_id)
    if (uploadStartTime) {
      formData.append('start_time', new Date(uploadStartTime).toISOString())
    }

    try {
      const res = await fetch(`${API_BASE}/api/v1/ingest`, {
        method: 'POST',
        body: formData,
      })

      if (res.status === 202) {
        setUploadProgress('success')
        // Refresh videos lists
        const response = await fetch(`${API_BASE}/api/v1/cameras/${selectedCamera.camera_id}/videos`)
        if (response.ok) {
          const data = await response.json()
          setCameraVideos(data)
        }
        
        setTimeout(() => {
          setIsUploadModalOpen(false)
          setUploadFile(null)
          setUploadStartTime('')
          setUploadProgress('idle')
        }, 1500)
      } else {
        const errorData = await res.json()
        setUploadProgress('error')
        setUploadError(errorData.detail || 'Upload rejected.')
      }
    } catch (err) {
      setUploadProgress('error')
      setUploadError('Network error. Failed to send upload.')
    }
  }

  const handlePlayVideoAtTime = (
    video: Video,
    timestamp: number,
    trackerId?: number | string,
    bestBbox?: number[],
    className?: string
  ) => {
    fetch(`${API_BASE}/api/v1/videos/${video.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.video) {
          setSelectedVideoToPlay(data.video)
        } else {
          setSelectedVideoToPlay(video)
        }
      })
      .catch(() => setSelectedVideoToPlay(video))

    const cam = cameras.find((c) => c.camera_id === video.camera_id)
    if (cam) {
      setSelectedCamera(cam)
    } else {
      setSelectedCamera({
        camera_id: video.camera_id,
        name: `Camera ${video.camera_id}`,
        status: 'active',
        is_active: true,
      } as any)
    }
    setPlayerView('annotated')

    if (trackerId != null) {
      const tid = extractTrackerId(trackerId)
      setSeekedTrackerId(tid)
      setSeekedBbox(bestBbox ?? null)
      setSeekedTrackletClass(className ?? null)
    } else {
      setSeekedTrackerId(null)
      setSeekedBbox(null)
      setSeekedTrackletClass(null)
    }

    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.currentTime = timestamp
        videoRef.current.pause()
      }
    }, 400)
  }

  // Helper formats
  const formatDuration = (secs?: number) => {
    if (secs === undefined) return '--:--'
    const minutes = Math.floor(secs / 60)
    const seconds = Math.floor(secs % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  // Breadcrumbs generator
  const getBreadcrumbs = () => {
    const paths = location.pathname.split('/').filter((p) => p)
    const crumbs = [{ label: 'DRISHTI', link: '/' }]

    if (paths.length > 0) {
      if (paths[0] === 'cameras') {
        crumbs.push({ label: 'Cameras', link: '/cameras' })
        if (paths[1]) {
          const camLabel = selectedCamera ? selectedCamera.name : paths[1]
          crumbs.push({ label: camLabel, link: `/cameras/${paths[1]}` })
          // /cameras/:id/videos/:vid_id
          if (paths[2] === 'videos' && paths[3]) {
            crumbs.push({ label: 'Video Investigation', link: `/cameras/${paths[1]}/videos/${paths[3]}` })
          }
        }
      } else if (paths[0] === 'search') {
        crumbs.push({ label: 'Search', link: '/search' })
      } else if (paths[0] === 'alerts') {
        crumbs.push({ label: 'Alerts', link: '/alerts' })
      } else if (paths[0] === 'dashboard') {
        crumbs.push({ label: 'Dashboard', link: '/dashboard' })
      } else if (paths[0] === 'models') {
        crumbs.push({ label: 'Model Registry', link: '/models' })
      }
    } else {
      crumbs.push({ label: 'Home', link: '/' })
    }

    return crumbs
  }

  const getVideoPlayerUrl = (video: Video) => {
    if (video.thumbnail_path && video.standardized_filename) {
      const pathParts = video.thumbnail_path.split(/[\/\\]/)
      const camerasIndex = pathParts.indexOf('cameras')
      if (camerasIndex !== -1 && pathParts.length > camerasIndex + 1) {
        const cameraFolder = pathParts[camerasIndex + 1]
        return `${API_BASE}/data/cameras/${cameraFolder}/original_assets/${video.standardized_filename}`
      }
    }
    return ''
  }

  // ─── Roboflow-style diverse 20-color palette ────────────────────────────────
  // Named classes get a stable, visually distinct color.
  // Any unknown class gets a deterministic color via djb2 hash over the name.
  const NAMED_CLASS_COLORS: Record<string, string> = {
    person:       '#FF3838', // vivid red
    car:          '#FF9D97', // salmon pink
    truck:        '#FF701F', // deep orange
    bus:          '#FFB21D', // amber gold
    motorcycle:   '#CFD231', // acid lime
    bicycle:      '#48F90A', // neon green
    van:          '#92CC17', // olive green
    // extended palette slots for other possible YOLO classes
    cat:          '#3DDB86',
    dog:          '#1A9334',
    bird:         '#00D4BB',
    horse:        '#2C99A8',
    cow:          '#00C2FF',
    sheep:        '#344593',
    airplane:     '#6473FF',
    boat:         '#0018EC',
    train:        '#8438FF',
    traffic_light:'#520085',
    stop_sign:    '#CB38FF',
    fire_hydrant: '#FF95C8',
  }
  // Fallback palette — cycles through 12 distinct vivid hues for any unknown class
  const FALLBACK_PALETTE = [
    '#E6194B','#3CB44B','#4363D8','#F58231','#911EB4',
    '#42D4F4','#F032E6','#BFEF45','#FABED4','#469990',
    '#DCBEFF','#9A6324',
  ]
  const classColor = (cn: string): string => {
    const key = cn.toLowerCase()
    if (NAMED_CLASS_COLORS[key]) return NAMED_CLASS_COLORS[key]
    // djb2 hash for consistent color per unknown class name
    let hash = 5381
    for (let i = 0; i < key.length; i++) hash = ((hash << 5) + hash) + key.charCodeAt(i)
    return FALLBACK_PALETTE[Math.abs(hash) % FALLBACK_PALETTE.length]
  }

  // Load detections.json for a video when switching to annotated view
  const loadPlayerDetections = async (video: Video) => {
    setPlayerDetectionsLoading(true)
    setPlayerDetections(null)
    try {
      const res = await fetch(`${API_BASE}/api/v1/videos/${video.id}/detections`)
      if (res.ok) setPlayerDetections(await res.json())
    } catch (_) {}
    setPlayerDetectionsLoading(false)
  }

  // Canvas bounding box draw — called on every timeupdate with precision aspect ratio scaling
  const drawBoundingBoxes = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !playerDetections) return

    const fps = playerDetections.fps || 10
    const frameIndex = Math.round(video.currentTime * fps)
    const frameData = (playerDetections.frame_detections ?? []).find(
      (fd: any) => fd.frame_index === frameIndex
    )

    const cWidth = video.clientWidth
    const cHeight = video.clientHeight
    if (canvas.width !== cWidth || canvas.height !== cHeight) {
      canvas.width = cWidth
      canvas.height = cHeight
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, cWidth, cHeight)

    const vWidth = video.videoWidth || 1280
    const vHeight = video.videoHeight || 720
    const videoAspect = vWidth / vHeight
    const containerAspect = cWidth / cHeight

    let renderW = 0
    let renderH = 0
    let offsetX = 0
    let offsetY = 0

    if (containerAspect > videoAspect) {
      renderH = cHeight
      renderW = renderH * videoAspect
      offsetX = (cWidth - renderW) / 2
      offsetY = 0
    } else {
      renderW = cWidth
      renderH = renderW / videoAspect
      offsetX = 0
      offsetY = (cHeight - renderH) / 2
    }

    const scaleX = renderW / 1280
    const scaleY = renderH / 720

    const toCanvasX = (x: number) => offsetX + (x * scaleX)
    const toCanvasY = (y: number) => offsetY + (y * scaleY)

    // 1. Draw Motion Trajectories
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
        const targetId = extractTrackerId(seekedTrackerId)
        const currentId = extractTrackerId(tid)
        const isSeeked = targetId !== null && currentId !== null && targetId === currentId

        const sampleDet = frameData?.detections.find((d: any) => extractTrackerId(d.tracker_id) === currentId)
        const color = isSeeked ? '#00FF41' : (sampleDet ? classColor(sampleDet.class_name) : '#14B8A6')

        ctx.save()
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y)
        }

        ctx.strokeStyle = color
        ctx.lineWidth = isSeeked ? 3.5 : 2
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
      const targetId = extractTrackerId(seekedTrackerId)

      for (const det of frameData.detections ?? []) {
        const cn = det.class_name ?? 'unknown'
        if (playerClassFilter !== 'all' && cn.toLowerCase() !== playerClassFilter) continue

        const detId = extractTrackerId(det.tracker_id)
        const isSeeked = targetId !== null && detId !== null && targetId === detId

        const [x1, y1, x2, y2] = det.bbox ?? [0, 0, 0, 0]
        const cx1 = toCanvasX(x1)
        const cy1 = toCanvasY(y1)
        const cx2 = toCanvasX(x2)
        const cy2 = toCanvasY(y2)
        const cw = cx2 - cx1
        const ch = cy2 - cy1

        const color = classColor(cn)
        const conf = ((det.confidence ?? 0) * 100).toFixed(0)
        const tid = det.tracker_id != null ? ` #${det.tracker_id}` : ''
        const label = `${cn}${tid} ${conf}%`

        if (isSeeked) {
          ctx.strokeStyle = '#00FF41'
          ctx.lineWidth = 3
          ctx.strokeRect(cx1, cy1, cw, ch)

          ctx.save()
          ctx.strokeStyle = 'rgba(0,255,65,0.45)'
          ctx.lineWidth = 6
          ctx.strokeRect(cx1 - 1, cy1 - 1, cw + 2, ch + 2)
          ctx.restore()

          ctx.font = 'bold 11px monospace'
          const tw = ctx.measureText(label).width
          ctx.fillStyle = '#00FF41'
          ctx.fillRect(cx1, cy1 - 18, tw + 8, 18)
          ctx.fillStyle = '#000'
          ctx.fillText(label, cx1 + 4, cy1 - 4)
        } else {
          ctx.strokeStyle = color
          ctx.lineWidth = 1.5
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

    // 3. Static Fallback Box if video is paused outside detections range
    if (seekedBbox && seekedTrackerId) {
      const targetId = extractTrackerId(seekedTrackerId)
      const hasSeekedInFrame = frameData?.detections.some((d: any) => {
        const detId = extractTrackerId(d.tracker_id)
        return targetId !== null && detId !== null && targetId === detId
      })
      if (!hasSeekedInFrame && video.paused) {
        const [bx1, by1, bx2, by2] = seekedBbox
        const cx1 = toCanvasX(bx1)
        const cy1 = toCanvasY(by1)
        const cw = toCanvasX(bx2) - cx1
        const ch = toCanvasY(by2) - cy1

        ctx.save()
        ctx.strokeStyle = '#00FF41'
        ctx.lineWidth = 3
        ctx.strokeRect(cx1, cy1, cw, ch)

        ctx.strokeStyle = 'rgba(0,255,65,0.45)'
        ctx.lineWidth = 6
        ctx.strokeRect(cx1 - 1, cy1 - 1, cw + 2, ch + 2)

        const displayClass = seekedTrackletClass || 'object'
        const label = `${displayClass} #${seekedTrackerId}`
        ctx.font = 'bold 11px monospace'
        const tw = ctx.measureText(label).width
        ctx.fillStyle = '#00FF41'
        ctx.fillRect(cx1, cy1 - 18, tw + 8, 18)
        ctx.fillStyle = '#000'
        ctx.fillText(label, cx1 + 4, cy1 - 4)
        ctx.restore()
      }
    }
  }, [playerDetections, playerClassFilter, showMotionPaths, seekedTrackerId, seekedBbox, seekedTrackletClass])

  // Sync canvas on timeupdate
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.addEventListener('timeupdate', drawBoundingBoxes)
    video.addEventListener('seeked', drawBoundingBoxes)
    return () => {
      video.removeEventListener('timeupdate', drawBoundingBoxes)
      video.removeEventListener('seeked', drawBoundingBoxes)
    }
  }, [drawBoundingBoxes])

  // Clear canvas when switching back to clean view
  useEffect(() => {
    if (playerView === 'clean') {
      const canvas = canvasRef.current
      if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    } else if (selectedVideoToPlay) {
      loadPlayerDetections(selectedVideoToPlay)
    }
  }, [playerView, selectedVideoToPlay])

  // Reset player state when closing
  const closePlayer = () => {
    setSelectedVideoToPlay(null)
    setPlayerView('clean')
    setPlayerDetections(null)
    setPlayerClassFilter('all')
    setExportState('idle')
    setExportUrl(null)
  }

  // Export annotated video
  const handleExportAnnotated = async () => {
    if (!selectedVideoToPlay) return
    setExportState('rendering')
    setExportUrl(null)
    try {
      const res = await fetch(`${API_BASE}/api/v1/videos/${selectedVideoToPlay.id}/export-annotated`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter_class: playerClassFilter === 'all' ? null : playerClassFilter, force: false }),
      })
      if (!res.ok) throw new Error('Export failed')
      const data = await res.json()
      setExportUrl(`${API_BASE}${data.output_url}`)
      setExportState('ready')
    } catch (_) {
      setExportState('error')
    }
  }

  // Unique class names in loaded detections (for filter dropdown)
  const playerClasses: string[] = playerDetections
    ? Array.from(new Set(
        (playerDetections.frame_detections ?? []).flatMap((fd: any) =>
          (fd.detections ?? []).map((d: any) => d.class_name as string)
        )
      ))
    : []

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 antialiased font-sans transition-colors duration-150">
      
      {/* COLLAPSIBLE SIDEBAR */}
      <aside
        className={`border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex flex-col justify-between transition-all duration-200 z-20 ${
          isSidebarCollapsed ? 'w-16' : 'w-60'
        }`}
      >
        <div className="space-y-6">
          {/* Logo & Collapse toggle header */}
          <div className="h-12 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-4">
            {!isSidebarCollapsed && (
              <div className="flex items-center gap-2">
                <span className="text-teal-700 dark:text-teal-400 font-bold tracking-wider text-sm">DRISHTI</span>
                <span className="text-[9px] bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-1 rounded font-bold text-slate-500">MVP</span>
              </div>
            )}
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="text-slate-500 hover:text-slate-800 dark:hover:text-white p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700/50 mx-auto"
            >
              <svg className={`h-4 w-4 transition-transform duration-200 ${isSidebarCollapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="px-2 space-y-1">
            <Link
              to="/dashboard"
              className={`flex items-center gap-3 rounded px-3 py-2 text-xs font-semibold tracking-wide transition-all ${
                location.pathname === '/dashboard'
                  ? 'bg-teal-500/10 text-teal-700 dark:text-teal-400 font-bold border-l-2 border-teal-700 dark:border-teal-400'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z" />
              </svg>
              {!isSidebarCollapsed && <span>Dashboard</span>}
            </Link>

            <Link
              to="/cameras"
              className={`flex items-center gap-3 rounded px-3 py-2 text-xs font-semibold tracking-wide transition-all ${
                location.pathname.startsWith('/cameras')
                  ? 'bg-teal-500/10 text-teal-700 dark:text-teal-400 font-bold border-l-2 border-teal-700 dark:border-teal-400'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              {!isSidebarCollapsed && <span>Cameras</span>}
            </Link>

            <Link
              to="/models"
              className={`flex items-center gap-3 rounded px-3 py-2 text-xs font-semibold tracking-wide transition-all ${
                location.pathname.startsWith('/models')
                  ? 'bg-teal-500/10 text-teal-700 dark:text-teal-400 font-bold border-l-2 border-teal-700 dark:border-teal-400'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
              {!isSidebarCollapsed && <span>ML Models</span>}
            </Link>

            <Link
<<<<<<< HEAD
              to="/embedding-models"
              className={`flex items-center gap-3 rounded px-3 py-2 text-xs font-semibold tracking-wide transition-all ${
                location.pathname.startsWith('/embedding-models')
=======
              to="/alerts"
              className={`flex items-center gap-3 rounded px-3 py-2 text-xs font-semibold tracking-wide transition-all ${
                location.pathname === '/alerts'
>>>>>>> c9c9126 (feat: implement Stage 7 alerts UI dashboard with acknowledge functionality)
                  ? 'bg-teal-500/10 text-teal-700 dark:text-teal-400 font-bold border-l-2 border-teal-700 dark:border-teal-400'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
<<<<<<< HEAD
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L5.595 15.12a2 2 0 00-1.802.738l-1.42 1.704a2 2 0 00.384 2.87l1.785 1.19a2 2 0 002.502-.276l1.325-1.326a2 2 0 012.383-.343l.534.267a6 6 0 004.8 0l.535-.267a2 2 0 012.383.343l1.325 1.326a2 2 0 002.502.276l1.785-1.19a2 2 0 00.384-2.87l-1.42-1.704z" />
              </svg>
              {!isSidebarCollapsed && <span>Embedding Models</span>}
=======
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {!isSidebarCollapsed && <span>Alerts</span>}
>>>>>>> c9c9126 (feat: implement Stage 7 alerts UI dashboard with acknowledge functionality)
            </Link>

            <Link
              to="/search"
              className={`flex items-center gap-3 rounded px-3 py-2 text-xs font-semibold tracking-wide transition-all ${
                location.pathname === '/search'
                  ? 'bg-teal-500/10 text-teal-700 dark:text-teal-400 font-bold border-l-2 border-teal-700 dark:border-teal-400'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {!isSidebarCollapsed && <span>Search & Rank</span>}
            </Link>
          </nav>
        </div>

        {/* Theme toggle SUN/MOON pinned at the bottom */}
        <div className="border-t border-slate-200 dark:border-slate-700 p-3">
          <button
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            className="w-full flex items-center justify-center gap-3 rounded px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-150 dark:hover:bg-slate-700/50 transition-all"
            title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
          >
            {theme === 'light' ? (
              <>
                <svg className="h-4 w-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M16.243 17.657l.707-.707M6.343 6.364l.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
                </svg>
                {!isSidebarCollapsed && <span>Light Mode</span>}
              </>
            ) : (
              <>
                <svg className="h-4 w-4 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
                {!isSidebarCollapsed && <span>Dark Mode</span>}
              </>
            )}
          </button>
        </div>
      </aside>

      {/* CORE WORKSPACE FRAME */}
      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        
        {/* COMPACT APP BAR (44px-48px height) */}
        <header className="h-12 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-6 flex items-center justify-between z-10 transition-colors duration-150">
          
          {/* Breadcrumbs */}
          <nav className="flex items-center space-x-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            {getBreadcrumbs().map((crumb, idx, arr) => (
              <Fragment key={crumb.link}>
                {idx > 0 && <span className="text-slate-350 dark:text-slate-600">/</span>}
                {idx === arr.length - 1 ? (
                  <span className="text-slate-800 dark:text-slate-200 font-bold">{crumb.label}</span>
                ) : (
                  <Link to={crumb.link} className="hover:text-teal-700 dark:hover:text-teal-400 transition-colors">
                    {crumb.label}
                  </Link>
                )}
              </Fragment>
            ))}
          </nav>

          {/* System status & action */}
          <div className="flex items-center gap-4">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-850 px-2 py-0.5 rounded flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${metrics.pendingVideos > 0 ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`}></span>
              {metrics.pendingVideos > 0 ? `Transcoding: ${metrics.pendingVideos} Jobs` : 'Pipeline Idle'}
            </span>

            <button
              onClick={() => alert('Evidence archive exported with verification hash.')}
              className="bg-transparent hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-250 dark:border-slate-600 text-slate-700 dark:text-slate-300 px-3 py-1 rounded text-xs font-bold transition-colors"
            >
              Export Evidence
            </button>
            <div className="h-6 w-6 rounded-full bg-teal-700 dark:bg-teal-650 flex items-center justify-center text-white text-[10px] font-bold">
              JD
            </div>
          </div>
        </header>

        {/* WORKSPACE CONTENT AREA */}
        <div className="flex-grow p-6 overflow-y-auto bg-slate-50 dark:bg-slate-900 transition-colors duration-150">
          
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/dashboard" element={<Dashboard metrics={metrics} />} />
            <Route
              path="/cameras"
              element={
                <Cameras
                  cameras={cameras}
                  models={models}
                  onOpenRegisterModal={() => setIsCameraModalOpen(true)}
                  onRefreshCameras={fetchCameras}
                />
              }
            />
              <Route
              path="/cameras/:camera_id"
              element={
                <CameraDetail
                  onOpenUploadModal={() => setIsUploadModalOpen(true)}
                  onPlayVideo={(video) => setSelectedVideoToPlay(video)}
                  onInspectTracklet={(tracklet, video) => setInspectTracklet({ tracklet, video })}
                  cameraVideos={cameraVideos}
                  setCameraVideos={setCameraVideos}
                  selectedCamera={selectedCamera}
                  setSelectedCamera={setSelectedCamera}
                />
              }
            />
            <Route path="/models" element={<Models models={models} onRefreshModels={fetchModels} />} />
<<<<<<< HEAD
            <Route path="/embedding-models" element={<EmbeddingModels />} />
=======
            <Route path="/alerts" element={<Alerts cameras={cameras} />} />
>>>>>>> c9c9126 (feat: implement Stage 7 alerts UI dashboard with acknowledge functionality)
            <Route path="/search" element={<Search onPlayVideoAtTime={handlePlayVideoAtTime} />} />
            <Route path="/cameras/:camera_id/videos/:video_id" element={<VideoDetail />} />
          </Routes>

        </div>
      </div>

      {/* REGISTER CAMERA MODAL */}
      {isCameraModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-sm rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 shadow-lg animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-sm font-bold text-slate-850 dark:text-slate-100">Register Camera Node</h3>
              <button
                onClick={() => setIsCameraModalOpen(false)}
                className="text-slate-400 hover:text-slate-800 dark:hover:text-white"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleCreateCamera} className="space-y-3.5">
              {cameraFormError && (
                <div className="p-2.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400 text-xs">
                  {cameraFormError}
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Camera ID *</label>
                <input
                  type="text"
                  placeholder="e.g. CAM_042"
                  value={newCameraId}
                  onChange={(e) => setNewCameraId(e.target.value)}
                  className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-700 dark:focus:border-teal-400"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Camera Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Main Street Junction"
                  value={newCameraName}
                  onChange={(e) => setNewCameraName(e.target.value)}
                  className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-700 dark:focus:border-teal-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Latitude</label>
                  <input
                    type="number"
                    step="0.000001"
                    placeholder="e.g. 23.0225"
                    value={newCameraLat}
                    onChange={(e) => setNewCameraLat(e.target.value)}
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-700 dark:focus:border-teal-400"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Longitude</label>
                  <input
                    type="number"
                    step="0.000001"
                    placeholder="e.g. 72.5714"
                    value={newCameraLon}
                    onChange={(e) => setNewCameraLon(e.target.value)}
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-700 dark:focus:border-teal-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Corridor Group</label>
                  <input
                    type="text"
                    placeholder="e.g. Zone-A"
                    value={newCameraCorridor}
                    onChange={(e) => setNewCameraCorridor(e.target.value)}
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-700 dark:focus:border-teal-400"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Altitude (optional)</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="e.g. 45.2 (meters)"
                    value={newCameraAltitude}
                    onChange={(e) => setNewCameraAltitude(e.target.value)}
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-700 dark:focus:border-teal-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Adjacent Camera Connections</label>
                <input
                  type="text"
                  placeholder="e.g. CAM_041, CAM_043"
                  value={newCameraAdjacency}
                  onChange={(e) => setNewCameraAdjacency(e.target.value)}
                  className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-700 dark:focus:border-teal-400"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Status *</label>
                <select
                  value={newCameraStatus}
                  onChange={(e) => setNewCameraStatus(e.target.value)}
                  className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-850 dark:text-slate-100 focus:outline-none focus:border-teal-700 dark:focus:border-teal-400"
                >
                  <option value="active">Active</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="not-working">Not Working</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Assigned ML Model *</label>
                <select
                  value={newCameraModelId}
                  onChange={(e) => setNewCameraModelId(e.target.value)}
                  className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-850 dark:text-slate-100 focus:outline-none focus:border-teal-700 dark:focus:border-teal-400"
                  required
                >
                  <option value="">-- Select Model --</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.model_type})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setIsCameraModalOpen(false)}
                  className="rounded border border-slate-200 dark:border-slate-650 bg-transparent px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-teal-700 dark:bg-teal-600 hover:brightness-110 text-white px-3.5 py-1.5 text-xs font-bold transition-all shadow-sm"
                >
                  Register Node
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* UPLOAD VIDEO MODAL */}
      {isUploadModalOpen && selectedCamera && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-sm rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 shadow-lg animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-sm font-bold text-slate-850 dark:text-slate-100">Ingest CCTV Stream</h3>
              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="text-slate-400 hover:text-slate-800 dark:hover:text-white"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleUploadVideo} className="space-y-3.5">
              {uploadError && (
                <div className="p-2.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400 text-xs">
                  {uploadError}
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Target Device Node</label>
                <input
                  type="text"
                  disabled
                  value={`${selectedCamera.camera_id} (${selectedCamera.name})`}
                  className="w-full rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Select Feed File *</label>
                <div
                  onDragEnter={(e) => { e.preventDefault(); setUploadDragActive(true) }}
                  onDragLeave={(e) => { e.preventDefault(); setUploadDragActive(false) }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    setUploadDragActive(false)
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      setUploadFile(e.dataTransfer.files[0])
                    }
                  }}
                  className={`relative w-full rounded border-2 border-dashed px-4 py-6 text-center transition-colors ${
                    uploadDragActive
                      ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/20'
                      : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900'
                  }`}
                >
                  <svg className="mx-auto h-8 w-8 text-slate-400 dark:text-slate-600 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                  </svg>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        setUploadFile(e.target.files[0])
                      }
                    }}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {uploadFile ? uploadFile.name : 'Drag files here or click to select'}
                  </p>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 block mt-1">Accepts standard forensic formats (.avi, .mov, .mp4, etc.)</span>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Timeline Timestamp Alignment</label>
                <input
                  type="datetime-local"
                  value={uploadStartTime}
                  onChange={(e) => setUploadStartTime(e.target.value)}
                  className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-700 dark:focus:border-teal-400"
                />
              </div>

              {uploadProgress === 'uploading' && (
                <div className="space-y-2">
                  <div className="flex justify-between text-[11px] text-teal-700 dark:text-teal-400 font-semibold">
                    <span>Sending stream buffer...</span>
                    <span className="animate-pulse">Active</span>
                  </div>
                  <div className="space-y-1">
                    <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                      <div className="bg-gradient-to-r from-teal-600 to-teal-400 h-full rounded-full animate-[shimmer_1.5s_infinite]" style={{ width: '85%' }}></div>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      File: {uploadFile?.name} · Size: {uploadFile ? (uploadFile.size / 1024 / 1024).toFixed(1) : 0} MB
                    </p>
                  </div>
                </div>
              )}

              {uploadProgress === 'success' && (
                <div className="p-2.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-semibold flex items-center gap-1.5">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  Intake completed. Transcode dispatched.
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  disabled={uploadProgress === 'uploading'}
                  onClick={() => setIsUploadModalOpen(false)}
                  className="rounded border border-slate-200 dark:border-slate-650 bg-transparent px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploadProgress === 'uploading'}
                  className="rounded bg-teal-700 dark:bg-teal-600 hover:brightness-110 text-white px-3.5 py-1.5 text-xs font-bold transition-all shadow-sm"
                >
                  Start Ingest
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIDEO PLAYER PREVIEW WINDOW — Clean / Annotated tabs */}
      {selectedVideoToPlay && selectedCamera && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-[3px]">
          <div className="w-full max-w-5xl rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-100 flex flex-col max-h-[92vh]">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shrink-0">
              <div className="min-w-0">
                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{selectedVideoToPlay.original_filename}</h3>
                <span className="text-[10px] text-slate-400 block mt-0.5">Device: {selectedCamera.name} · {selectedCamera.camera_id}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-4">
                <Link
                  to={`/cameras/${selectedCamera.camera_id}/videos/${selectedVideoToPlay.id}`}
                  onClick={() => setSelectedVideoToPlay(null)}
                  className="px-3 py-1.5 rounded-md bg-teal-50 dark:bg-teal-950/40 hover:bg-teal-100 dark:hover:bg-teal-900/60 border border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300 text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Open Full Workspace</span>
                </Link>
                {/* View tab switcher */}
                <div className="flex rounded-md bg-slate-200 dark:bg-slate-700 p-0.5 text-[10px] font-bold gap-0.5">
                  <button
                    onClick={() => setPlayerView('clean')}
                    className={`rounded px-3 py-1 transition-all ${
                      playerView === 'clean'
                        ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                  >
                    Clean
                  </button>
                  <button
                    onClick={() => setPlayerView('annotated')}
                    className={`rounded px-3 py-1 transition-all flex items-center gap-1.5 ${
                      playerView === 'annotated'
                        ? 'bg-teal-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Annotated
                  </button>
                </div>
                <button
                  onClick={closePlayer}
                  className="text-slate-400 hover:text-slate-800 dark:hover:text-white p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-700 flex-1 min-h-0">

              {/* Video + Canvas column */}
              <div className="relative flex-1 bg-slate-950 flex items-center justify-center min-h-[280px]">
                <video
                  ref={videoRef}
                  src={getVideoPlayerUrl(selectedVideoToPlay)}
                  controls
                  autoPlay
                  className="w-full max-h-[460px] object-contain"
                />
                {/* Canvas overlay — always rendered, cleared when in clean view */}
                <canvas
                  ref={canvasRef}
                  className={`absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-200 ${
                    playerView === 'annotated' && playerDetections ? 'opacity-100' : 'opacity-0'
                  }`}
                  style={{ objectFit: 'contain' }}
                />
                {/* Loading overlay for annotated */}
                {playerView === 'annotated' && playerDetectionsLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <div className="flex flex-col items-center gap-2">
                      <RefreshCw className="h-6 w-6 animate-spin text-teal-400" />
                      <span className="text-[11px] text-slate-300">Loading detections...</span>
                    </div>
                  </div>
                )}
                {playerView === 'annotated' && !playerDetectionsLoading && !playerDetections && (
                  <div className="absolute bottom-4 left-4 right-4">
                    <div className="rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 text-[10px] p-2.5 text-center">
                      No detection data available. Run Detections first.
                    </div>
                  </div>
                )}
              </div>

              {/* Right panel */}
              <div className="w-full md:w-64 shrink-0 bg-white dark:bg-slate-900 flex flex-col divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto">

                {/* Annotated controls */}
                {playerView === 'annotated' && playerDetections && (
                  <div className="p-4 space-y-3">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Annotation Controls</h4>

                    {/* Class filter */}
                    <div>
                      <label className="text-[9px] font-semibold text-slate-400 uppercase block mb-1">Filter Class</label>
                      <select
                        value={playerClassFilter}
                        onChange={(e) => setPlayerClassFilter(e.target.value)}
                        className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] text-slate-700 dark:text-slate-200 focus:outline-none focus:border-teal-500"
                      >
                        <option value="all">All Classes</option>
                        {playerClasses.map((cn) => (
                          <option key={cn} value={cn.toLowerCase()}>{cn.charAt(0).toUpperCase() + cn.slice(1)}</option>
                        ))}
                      </select>
                    </div>

                    {/* Motion Path Trajectories toggle */}
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">Motion Trajectories</span>
                      <button
                        onClick={() => setShowMotionPaths(!showMotionPaths)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                          showMotionPaths
                            ? 'bg-teal-500/20 text-teal-700 dark:text-teal-400 border border-teal-500/30'
                            : 'bg-slate-100 dark:bg-slate-700 text-slate-400'
                        }`}
                      >
                        {showMotionPaths ? 'ON' : 'OFF'}
                      </button>
                    </div>

                    {/* Color legend */}
                    <div>
                      <label className="text-[9px] font-semibold text-slate-400 uppercase block mb-1.5">Class Legend</label>
                      <div className="space-y-1">
                        {playerClasses.map((cn) => (
                          <div key={cn} className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-sm shrink-0" style={{ backgroundColor: classColor(cn) }} />
                            <span className="text-[10px] text-slate-600 dark:text-slate-300 capitalize">{cn}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Active Tracked Object Highlight indicator */}
                    {seekedTrackerId && (
                      <div className="flex items-center gap-2 p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-md">
                        <Crosshair className="h-4 w-4 text-[#00FF41] animate-pulse shrink-0" />
                        <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-bold flex-1">
                          Track #{seekedTrackerId} active
                        </span>
                        <button
                          onClick={() => { setSeekedTrackerId(null); setSeekedBbox(null); setSeekedTrackletClass(null) }}
                          className="text-[10px] font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white underline flex items-center gap-1"
                        >
                          <X className="h-3 w-3" /> Clear
                        </button>
                      </div>
                    )}

                    {/* Export */}
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                      <label className="text-[9px] font-semibold text-slate-400 uppercase block mb-1.5">Export Annotated Video</label>
                      <p className="text-[9px] text-slate-400 dark:text-slate-500 mb-2 leading-relaxed">
                        Renders bounding boxes onto the video on the server. May take a moment.
                      </p>
                      {exportState === 'idle' && (
                        <button
                          onClick={handleExportAnnotated}
                          className="w-full rounded bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700 text-white py-1.5 text-[10px] font-bold transition-colors flex items-center justify-center gap-1.5"
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span>Generate &amp; Download</span>
                        </button>
                      )}
                      {exportState === 'rendering' && (
                        <div className="flex items-center gap-2 text-[10px] text-teal-600 dark:text-teal-400 font-semibold">
                          <RefreshCw className="h-3 w-3 animate-spin" />
                          Rendering on server...
                        </div>
                      )}
                      {exportState === 'ready' && exportUrl && (
                        <button
                          onClick={async () => {
                            try {
                              const res = await fetch(exportUrl)
                              const blob = await res.blob()
                              const objectUrl = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = objectUrl
                              const filename = exportUrl.split('/').pop() ?? 'annotated.mp4'
                              a.download = filename
                              document.body.appendChild(a)
                              a.click()
                              document.body.removeChild(a)
                              setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
                            } catch (_) {
                              alert('Download failed. Check backend connectivity.')
                            }
                          }}
                          className="w-full text-center rounded bg-emerald-600 hover:bg-emerald-700 text-white py-1.5 text-[10px] font-bold transition-colors flex items-center justify-center gap-1.5"
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span>Download Annotated MP4</span>
                        </button>
                      )}
                      {exportState === 'error' && (
                        <p className="text-[10px] text-rose-500 font-semibold">Export failed. Check backend logs.</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Forensic metadata (always shown) */}
                <div className="p-4 space-y-3 flex-1">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Footprint Properties</h4>
                  <div className="space-y-1.5 text-[11px] text-slate-600 dark:text-slate-350">
                    {[
                      ['Format', 'H.264 MP4'],
                      ['Resolution', '1280×720 (720p)'],
                      ['Framerate', '10.0 FPS (CFR)'],
                      ['Sampler', '4.0 FPS Timeline'],
                      ['Duration', formatDuration(selectedVideoToPlay.duration)],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-0.5">
                        <span>{k}:</span>
                        <span className="text-slate-800 dark:text-slate-100 font-medium">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* SHA-256 */}
                <div className="p-4 shrink-0 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[9px] text-slate-400 block font-semibold uppercase tracking-wider">Verification SHA-256</span>
                  <span className="text-[10px] text-teal-700 dark:text-teal-400 font-mono break-all mt-1 block bg-slate-50 dark:bg-slate-950 p-2 rounded border border-slate-200 dark:border-slate-800">
                    {selectedVideoToPlay.transcoded_sha256 || selectedVideoToPlay.intake_sha256 || 'SHA-256 Verified'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TRACKLET INSPECT MODAL — crop + seek-to-frame context */}
      {inspectTracklet && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 p-4 backdrop-blur-[4px]">
          <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <div className={`h-2 w-2 rounded-full ${
                  inspectTracklet.tracklet.object_type === 'person' ? 'bg-amber-400' : 'bg-blue-400'
                }`} />
                <div>
                  <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 capitalize">
                    {inspectTracklet.tracklet.class_name} — Track #{inspectTracklet.tracklet.tracker_id}
                  </h3>
                  <span className="text-[10px] text-slate-400">
                    Frames {inspectTracklet.tracklet.frame_start}–{inspectTracklet.tracklet.frame_end} ·{' '}
                    {inspectTracklet.tracklet.timestamp_start_seconds?.toFixed(2)}s – {inspectTracklet.tracklet.timestamp_end_seconds?.toFixed(2)}s
                  </span>
                </div>
              </div>
              <button
                onClick={() => setInspectTracklet(null)}
                className="text-slate-400 hover:text-slate-800 dark:hover:text-white p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-700">

              {/* Best Crop */}
              <div className="bg-slate-950 flex items-center justify-center min-h-[240px] relative">
                {inspectTracklet.tracklet.best_crop_path ? (
                  <img
                    src={(() => {
                      const p = (inspectTracklet.tracklet.best_crop_path as string).replace(/\\/g, '/')
                      const di = p.indexOf('/data/')
                      return di !== -1 ? `${API_BASE}${p.slice(di)}` : ''
                    })()}
                    alt="Best crop"
                    className="max-w-full max-h-[320px] object-contain rounded"
                  />
                ) : (
                  <div className="text-slate-500 text-xs text-center p-8">
                    <svg className="mx-auto h-8 w-8 mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" />
                    </svg>
                    No crop saved
                  </div>
                )}
                {/* Confidence badge */}
                <div className="absolute top-3 right-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    (inspectTracklet.tracklet.mean_confidence * 100) >= 80
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : (inspectTracklet.tracklet.mean_confidence * 100) >= 60
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  }`}>
                    {(inspectTracklet.tracklet.mean_confidence * 100).toFixed(0)}% conf
                  </span>
                </div>
              </div>

              {/* Details + Actions */}
              <div className="p-5 space-y-4 flex flex-col justify-between">
                <div className="space-y-4">
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Tracklet Info</h4>
                    <div className="space-y-1.5 text-[11px]">
                      {[
                        ['Type', inspectTracklet.tracklet.object_type],
                        ['Class', inspectTracklet.tracklet.class_name],
                        ['Tracker ID', `#${inspectTracklet.tracklet.tracker_id}`],
                        ['Detections', inspectTracklet.tracklet.detection_count],
                        ['Confidence', `${(inspectTracklet.tracklet.mean_confidence * 100).toFixed(1)}%`],
                        ['Frame Range', `${inspectTracklet.tracklet.frame_start} – ${inspectTracklet.tracklet.frame_end}`],
                        ['Time Range', `${inspectTracklet.tracklet.timestamp_start_seconds?.toFixed(2)}s – ${inspectTracklet.tracklet.timestamp_end_seconds?.toFixed(2)}s`],
                      ].map(([k, v]) => (
                        <div key={String(k)} className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-0.5">
                          <span className="text-slate-500 dark:text-slate-400">{k}</span>
                          <span className="font-semibold text-slate-800 dark:text-slate-100 capitalize">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="text-[9px] font-mono text-slate-400 break-all">
                    ID: {inspectTracklet.tracklet.tracklet_id}
                  </div>
                </div>

                {/* Seek to frame in video */}
                <button
                  onClick={() => {
                    setInspectTracklet(null)
                    setSelectedVideoToPlay(inspectTracklet.video)
                    setPlayerView('annotated')
                    // Seek after a short delay to let the video element mount
                    setTimeout(() => {
                      if (videoRef.current) {
                        videoRef.current.currentTime = inspectTracklet.tracklet.timestamp_start_seconds ?? 0
                      }
                    }, 400)
                  }}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700 text-white py-2.5 text-xs font-bold transition-colors shadow-sm"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  </svg>
                  Seek to Frame {inspectTracklet.tracklet.frame_start} in Annotated View
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
