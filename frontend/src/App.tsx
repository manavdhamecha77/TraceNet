import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import { Routes, Route, Link, useLocation, Navigate, useNavigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Cameras from './pages/Cameras'
import CameraDetail from './pages/CameraDetail'
import Search from './pages/Search'
import Models from './pages/Models'
import EmbeddingModels from './pages/EmbeddingModels'
import VideoDetail from './pages/VideoDetail'
import Alerts from './pages/Alerts'
import AssaultDetection from './pages/AssaultDetection'
import FrameInspection from './pages/FrameInspection'
import FineTuning from './pages/FineTuning'
import TheftAlerts from './pages/TheftAlerts'
import AlertsDashboard from './pages/AlertsDashboard'
import HotTargets from './pages/HotTargets'
import { MultiCameraTracking } from './pages/MultiCameraTracking'
import GlobalSearchBar from './components/GlobalSearchBar'
import AICopilotOverlay from './components/AICopilotOverlay'
import LoiteringZoneEditor from './components/LoiteringZoneEditor'
import { ErrorBoundary } from './components/ErrorBoundary'
import { classColor } from './utils/colors'
import LiveCameraView from './pages/LiveCameraView'
import { useToast } from './components/Toast'
import {
  ExternalLink,
  Download,
  Crosshair,
  X,
  Eye,
  RefreshCw,
  Sun,
  Moon,
  Video,
} from 'lucide-react'

const API_BASE = typeof window !== 'undefined' ? `http://${window.location.hostname}:8000` : 'http://localhost:8000'

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

interface SystemJob {
  id: string
  name: string
  job_type: 'reindex' | 'vectordb' | 'upload' | 'model_run' | 'alerts' | 'other'
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  payload: any
  created_at: string
  updated_at: string
}

function App() {
  const toast = useToast()
  const location = useLocation()
  const navigate = useNavigate()

  // Theme & Layout state
  // @ts-ignore
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)

  // Pipeline jobs state
  const [systemJobs, setSystemJobs] = useState<SystemJob[]>([])
  const [isJobsModalOpen, setIsJobsModalOpen] = useState(false)
  const [lastActiveCount, setLastActiveCount] = useState(0)
  const [hasActiveTransition, setHasActiveTransition] = useState(false)

  // Data state
  const [cameras, setCameras] = useState<Camera[]>([])
  const [models, setModels] = useState<any[]>([])
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null)
  const [cameraVideos, setCameraVideos] = useState<Video[]>([])

  // Global modals state
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false)
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false)
  const [isCopilotOpen, setIsCopilotOpen] = useState(false)
  const [selectedVideoToPlay, setSelectedVideoToPlay] = useState<Video | null>(null)

  // Annotated player state
  const [playerView, setPlayerView] = useState<'clean' | 'annotated'>('clean')
  const [playerDetections, setPlayerDetections] = useState<any | null>(null)
  const [playerDetectionsLoading, setPlayerDetectionsLoading] = useState(false)
  const [playerClassFilter, setPlayerClassFilter] = useState<string>('all')
  const [seekedTrackerId, setSeekedTrackerId] = useState<string | null>(null)
  const [seekedBbox, setSeekedBbox] = useState<number[] | null>(null)
  const [seekedTrackletClass, setSeekedTrackletClass] = useState<string | null>(null)
  const [seekedTag, setSeekedTag] = useState<string | null>(null)
  const [seekedColor, setSeekedColor] = useState<string | null>(null)
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
  const [enableLoitering, setEnableLoitering] = useState(false)
  const [loiteringThreshold, setLoiteringThreshold] = useState(60)
  const [loiteringEditorVideoId, setLoiteringEditorVideoId] = useState<string | null>(null)

// Alerts persistent toggle state

  // Dashboard metrics state
  const [metrics, setMetrics] = useState({
    totalCameras: 0,
    totalVideos: 0,
    processedVideos: 0,
    pendingVideos: 0,
    failedVideos: 0,
  })

  // Theme effect — light/dark mode support
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

  // Fetch cameras and models on mount and periodically every 5 seconds (Fixes Issue #5)
  useEffect(() => {
    fetchCameras()
    fetchModels()
    const timer = setInterval(() => {
      fetchCameras()
      fetchModels()
    }, 5000)
    return () => clearInterval(timer)
  }, [])

  // Fetch aggregated dashboard metrics from backend (Fixes Issue #6)
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
    const metricsTimer = setInterval(fetchMetrics, 10000)
    return () => clearInterval(metricsTimer)
  }, [])

  const [unackAlertCount, setUnackAlertCount] = useState<number>(0)
  const [copilotInitialPrompt, setCopilotInitialPrompt] = useState<string>('')
  const [isAdminMode, setIsAdminMode] = useState<boolean>(false)

  useEffect(() => {
    const handleCustomCopilotOpen = (e: any) => {
      if (e.detail && e.detail.prompt) {
        setCopilotInitialPrompt(e.detail.prompt)
      } else {
        setCopilotInitialPrompt('')
      }
      setIsCopilotOpen(true)
    }
    const handleKeyNav = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key === '1') navigate('/dashboard')
        else if (e.key === '2') navigate('/cameras')
        else if (e.key === '3') navigate('/search')
        else if (e.key === '4') navigate('/targets')
        else if (e.key === '5') navigate('/alerts')
      }
    }
    window.addEventListener('tracenet:open-copilot', handleCustomCopilotOpen as EventListener)
    window.addEventListener('keydown', handleKeyNav)
    return () => {
      window.removeEventListener('tracenet:open-copilot', handleCustomCopilotOpen as EventListener)
      window.removeEventListener('keydown', handleKeyNav)
    }
  }, [navigate])

  // Fetch unacknowledged alert count for sidebar badge (Fixes Issue #21 with instant custom event listener)
  const fetchUnackCount = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/alerts/summary`)
      if (res.ok) {
        const data = await res.json()
        setUnackAlertCount(data.unacknowledged_alerts || 0)
      }
    } catch (_) {}
  }, [])

  useEffect(() => {
    fetchUnackCount()
    const alertTimer = setInterval(fetchUnackCount, 10000)
    window.addEventListener('tracenet:alert-ack', fetchUnackCount)
    return () => {
      clearInterval(alertTimer)
      window.removeEventListener('tracenet:alert-ack', fetchUnackCount)
    }
  }, [fetchUnackCount])

  // Fix Issue #1: Use ref for lastActiveCount comparison to avoid resetting 3s interval on every state update
  const lastActiveCountRef = useRef(lastActiveCount)
  useEffect(() => {
    lastActiveCountRef.current = lastActiveCount
  }, [lastActiveCount])

  const fetchSystemJobs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/jobs`)
      if (res.ok) {
        const data = await res.json()
        setSystemJobs(data)
        const activeCount = data.filter((j: any) => j.status === 'running' || j.status === 'pending').length
        
        if (activeCount !== lastActiveCountRef.current) {
          setHasActiveTransition(true)
          setLastActiveCount(activeCount)
          setTimeout(() => setHasActiveTransition(false), 1000)
        }
      }
    } catch (err) {
      console.error('Failed to fetch system jobs:', err)
    }
  }, [])

  useEffect(() => {
    fetchSystemJobs()
    const timer = setInterval(fetchSystemJobs, 3000)
    return () => clearInterval(timer)
  }, [fetchSystemJobs])

  // Keyboard navigation shortcuts: Alt+1 (Overview), Alt+2 (GIS Cameras), Alt+3 (Search), Alt+4 (Pursuit), Alt+5 (Alerts)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key === '1') { e.preventDefault(); navigate('/dashboard') }
        else if (e.key === '2') { e.preventDefault(); navigate('/cameras') }
        else if (e.key === '3') { e.preventDefault(); navigate('/search') }
        else if (e.key === '4') { e.preventDefault(); navigate('/targets') }
        else if (e.key === '5') { e.preventDefault(); navigate('/alerts') }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigate])

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

    if (!selectedCamera) {
      setUploadError('Please select a target camera node for this video feed.')
      return
    }

    setUploadProgress('uploading')

    const formData = new FormData()
    formData.append('file', uploadFile)
    formData.append('camera_id', selectedCamera.camera_id)
    formData.append('enable_loitering', String(enableLoitering))
    if (enableLoitering) formData.append('loitering_threshold_seconds', String(loiteringThreshold))
    if (uploadStartTime) {
      formData.append('start_time', new Date(uploadStartTime).toISOString())
    }

    try {
      const res = await fetch(`${API_BASE}/api/v1/ingest`, {
        method: 'POST',
        body: formData,
      })

      if (res.status === 202) {
        const result = await res.json()
        setUploadProgress('success')
        if (result.loitering_zone_id) setLoiteringEditorVideoId(result.asset_id)
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
          setEnableLoitering(false)
          setLoiteringThreshold(60)
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
    className?: string,
    tag?: string,
    color?: string
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
      setSeekedTag(tag ?? null)
      setSeekedColor(color ?? null)
    } else {
      setSeekedTrackerId(null)
      setSeekedBbox(null)
      setSeekedTrackletClass(null)
      setSeekedTag(null)
      setSeekedColor(null)
    }

    if (videoRef.current) {
      const vid = videoRef.current
      const doSeek = () => {
        vid.currentTime = timestamp
        vid.pause()
      }
      if (vid.readyState >= 1) {
        doSeek()
      } else {
        vid.addEventListener('loadedmetadata', doSeek, { once: true })
      }
    }
  }

  // Helper formats
  const formatDuration = (secs?: number) => {
    if (!secs || secs <= 0) return '--:--'
    const minutes = Math.floor(secs / 60)
    const seconds = Math.floor(secs % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  // Breadcrumbs generator (Fixes Issue #7 and #16)
  const getBreadcrumbs = () => {
    const paths = location.pathname.split('/').filter((p) => p)
    const crumbs = [{ label: 'DRISHTI', link: '/' }]

    if (paths.length > 0) {
      if (paths[0] === 'cameras') {
        crumbs.push({ label: 'Cameras', link: '/cameras' })
        if (paths[1]) {
          const camLabel = selectedCamera ? selectedCamera.name : paths[1]
          crumbs.push({ label: camLabel, link: `/cameras/${paths[1]}` })
          if (paths[2] === 'videos' && paths[3]) {
            crumbs.push({ label: 'Video Investigation', link: `/cameras/${paths[1]}/videos/${paths[3]}` })
          }
        }
      } else if (paths[0] === 'search') {
        crumbs.push({ label: 'Search', link: '/search' })
      } else if (paths[0] === 'alerts') {
        crumbs.push({ label: 'Unified Alert Center', link: '/alerts' })
        if (paths[1] === 'abandoned') {
          crumbs.push({ label: 'Abandoned Objects', link: '/alerts/abandoned' })
        } else if (paths[1] === 'theft') {
          crumbs.push({ label: 'Outdoor Theft', link: '/alerts/theft' })
        } else if (paths[1] === 'assault') {
          crumbs.push({ label: 'Assault Detection', link: '/alerts/assault' })
        }
      } else if (paths[0] === 'theft-alerts') {
        crumbs.push({ label: 'Outdoor Theft', link: '/alerts/theft' })
      } else if (paths[0] === 'assault-detection' || paths[0] === 'assault-alerts') {
        crumbs.push({ label: 'Assault Detection', link: '/alerts/assault' })
      } else if (paths[0] === 'targets' || paths[0] === 'hot-targets') {
        crumbs.push({ label: 'Pursuit & Hot Targets', link: '/targets' })
      } else if (paths[0] === 'multicam') {
        crumbs.push({ label: 'Pursuit & Hot Targets', link: '/targets' })
        crumbs.push({ label: 'Multi-Camera Sentinel Wave', link: '/multicam' })
      } else if (paths[0] === 'dashboard') {
        crumbs.push({ label: 'Dashboard', link: '/dashboard' })
      } else if (paths[0] === 'models') {
        crumbs.push({ label: 'YOLO Detector Models', link: '/models' })
      } else if (paths[0] === 'embedding-models') {
        crumbs.push({ label: 'Embedding Config', link: '/embedding-models' })
      } else if (paths[0] === 'finetuning') {
        crumbs.push({ label: 'YOLO Retraining', link: '/finetuning' })
      } else if (paths[0] === 'frame-inspection') {
        crumbs.push({ label: 'Unified Alert Center', link: '/alerts' })
        crumbs.push({ label: `Frame Inspection #${paths[1] || ''}`, link: `/frame-inspection/${paths[1] || ''}` })
      }
    }

    return crumbs
  }

  const getVideoPlayerUrl = (video: Video) => {
    if (!video) return ''
    if (video.id) {
      return `${API_BASE}/api/v1/videos/${video.id}/stream`
    }
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
        const activeColor = isSeeked ? (seekedColor || '#00FF41') : color
        const tagPrefix = (isSeeked && seekedTag) ? `[${seekedTag}] ` : ''
        const label = `${tagPrefix}${cn}${tid} ${conf}%`

        if (isSeeked) {
          ctx.strokeStyle = activeColor
          ctx.lineWidth = 3.5
          ctx.strokeRect(cx1, cy1, cw, ch)

          ctx.save()
          ctx.strokeStyle = `${activeColor}77`
          ctx.lineWidth = 6
          ctx.strokeRect(cx1 - 1, cy1 - 1, cw + 2, ch + 2)
          ctx.restore()

          ctx.font = 'bold 11px monospace'
          const tw = ctx.measureText(label).width
          ctx.fillStyle = activeColor
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

        const activeColor = seekedColor || '#00FF41'
        const tagPrefix = seekedTag ? `[${seekedTag}] ` : ''

        ctx.save()
        ctx.strokeStyle = activeColor
        ctx.lineWidth = 3.5
        ctx.strokeRect(cx1, cy1, cw, ch)

        ctx.strokeStyle = `${activeColor}77`
        ctx.lineWidth = 6
        ctx.strokeRect(cx1 - 1, cy1 - 1, cw + 2, ch + 2)

        const displayClass = seekedTrackletClass || 'object'
        const label = `${tagPrefix}${displayClass} #${seekedTrackerId}`
        ctx.font = 'bold 11px monospace'
        const tw = ctx.measureText(label).width
        ctx.fillStyle = activeColor
        ctx.fillRect(cx1, cy1 - 18, tw + 8, 18)
        ctx.fillStyle = '#000'
        ctx.fillText(label, cx1 + 4, cy1 - 4)
        ctx.restore()
      }
    }
  }, [playerDetections, playerClassFilter, showMotionPaths, seekedTrackerId, seekedBbox, seekedTrackletClass, seekedTag, seekedColor])

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

  // Keyboard controls for video modal (Space = Play/Pause, Arrows = Seek)
  useEffect(() => {
    if (!selectedVideoToPlay) return
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT') return
      const video = videoRef.current
      if (!video) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (video.paused) video.play(); else video.pause();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        video.currentTime = Math.max(0, video.currentTime - 5)
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        video.currentTime = Math.min(video.duration || 0, video.currentTime + 5)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedVideoToPlay])

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

  // Nav link helper
  const navLinkClass = (active: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-semibold transition-all duration-150 ${
      active
        ? 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-300 font-bold'
        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-200'
    }`

  return (
    <div className="flex min-h-screen bg-slate-100 dark:bg-[#0B1324] text-slate-800 dark:text-slate-100 antialiased transition-colors duration-150">
      {/* ── SIDEBAR ─────────────────────────────────────────── */}
      <aside
        className="sticky top-0 h-screen flex flex-col justify-between border-r border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#0F172A] z-20 transition-all duration-200 shrink-0"
        style={{ width: isSidebarCollapsed ? 56 : 220 }}
      >
        <div className="flex flex-col gap-6">

          {/* Brand logo + collapse toggle */}
          <div
            className="h-11 border-b border-slate-200 dark:border-slate-800 flex items-center px-3 gap-3"
            style={{ justifyContent: isSidebarCollapsed ? 'center' : 'space-between' }}
          >
            {!isSidebarCollapsed && (
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-cyan-600 dark:text-cyan-400 text-lg leading-none">◉</span>
                <span
                  className="font-mono font-bold tracking-widest text-xs text-cyan-700 dark:text-cyan-400 truncate"
                  style={{ fontFamily: '"IBM Plex Mono", monospace' }}
                >
                  DRISHTI
                </span>
              </div>
            )}
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
              title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <svg
                className={`h-3.5 w-3.5 transition-transform duration-200 ${isSidebarCollapsed ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </div>

          {/* Operational Police Officer Surfaces */}
          <nav className="px-2 space-y-1">
            <Link
              to="/dashboard"
              className={navLinkClass(location.pathname === '/dashboard')}
              title={isSidebarCollapsed ? 'Situation Overview' : undefined}
            >
              <svg className="h-4 w-4 shrink-0 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z" />
              </svg>
              {!isSidebarCollapsed && <span>Situation Overview</span>}
            </Link>

              <Link
                to="/cameras"
                className={navLinkClass(location.pathname.startsWith('/cameras') && !location.pathname.includes('/live'))}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {!isSidebarCollapsed && <span>Cameras</span>}
              </Link>



            <Link
              to="/multicam"
              className={navLinkClass(location.pathname === '/multicam')}
              title={isSidebarCollapsed ? 'Multi-Cam Intelligence' : undefined}
            >
              <svg className="h-4 w-4 shrink-0 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              {!isSidebarCollapsed && <span>Multi-Cam Intelligence</span>}
            </Link>

            <Link
              to="/search"
              className={navLinkClass(location.pathname === '/search')}
              title={isSidebarCollapsed ? 'Search & Investigate' : undefined}
            >
              <svg className="h-4 w-4 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {!isSidebarCollapsed && <span>Search &amp; Investigate</span>}
            </Link>

            <Link
              to="/targets"
              className={navLinkClass(location.pathname.startsWith('/targets') || location.pathname.startsWith('/hot-targets') || location.pathname === '/multicam')}
              title={isSidebarCollapsed ? 'Pursuit & Tracking' : undefined}
            >
              <svg className="h-4 w-4 shrink-0 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
              {!isSidebarCollapsed && <span>Pursuit &amp; Tracking</span>}
            </Link>

            <Link
              to="/alerts"
              className={navLinkClass(location.pathname.startsWith('/alerts') || location.pathname === '/theft-alerts' || location.pathname === '/assault-detection')}
              title={isSidebarCollapsed ? 'Unified Alert Center' : undefined}
            >
              <svg className="h-4 w-4 shrink-0 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {!isSidebarCollapsed && <span className="flex-1">Unified Alert Center</span>}
              {unackAlertCount > 0 && (
                <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold rounded-full bg-rose-500 text-white shadow-xs animate-pulse">
                  {unackAlertCount}
                </span>
              )}
            </Link>
          </nav>

          {/* Technical Admin Section (Gated for Police Officers) */}
          <div className="pt-4 px-2 border-t border-slate-800 space-y-1">
            <div className="flex items-center justify-between px-2.5 py-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                {!isSidebarCollapsed ? '⚙️ System Admin' : '⚙️'}
              </span>
              {!isSidebarCollapsed && (
                <button
                  onClick={() => setIsAdminMode(!isAdminMode)}
                  className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border transition-colors ${
                    isAdminMode
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {isAdminMode ? 'UNLOCKED' : 'LOCKED'}
                </button>
              )}
            </div>

            {isAdminMode ? (
              <div className="space-y-0.5 animate-in fade-in">
                <Link
                  to="/models"
                  className={navLinkClass(location.pathname.startsWith('/models'))}
                  title={isSidebarCollapsed ? 'YOLO Detector Models' : undefined}
                >
                  <svg className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                  </svg>
                  {!isSidebarCollapsed && <span className="text-xs text-slate-400">Detector Models</span>}
                </Link>

                <Link
                  to="/embedding-models"
                  className={navLinkClass(location.pathname.startsWith('/embedding-models'))}
                  title={isSidebarCollapsed ? 'CLIP Embeddings' : undefined}
                >
                  <svg className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L5.595 15.12a2 2 0 00-1.802.738l-1.42 1.704a2 2 0 00.384 2.87l1.785 1.19a2 2 0 002.502-.276l1.325-1.326a2 2 0 012.383-.343l.534.267a6 6 0 004.8 0l.535-.267a2 2 0 012.383.343l1.325 1.326a2 2 0 002.502.276l1.785-1.19a2 2 0 00.384-2.87l-1.42-1.704z" />
                  </svg>
                  {!isSidebarCollapsed && <span className="text-xs text-slate-400">Embedding Config</span>}
                </Link>

                <Link
                  to="/finetuning"
                  className={navLinkClass(location.pathname === '/finetuning')}
                  title={isSidebarCollapsed ? 'YOLO Retraining' : undefined}
                >
                  <svg className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {!isSidebarCollapsed && <span className="text-xs text-slate-400">YOLO Fine-Tuning</span>}
                </Link>
              </div>
            ) : (
              !isSidebarCollapsed && (
                <button
                  onClick={() => setIsAdminMode(true)}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800/80 text-[11px] text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-2"
                >
                  <span className="text-[10px]">🔒</span>
                  <span>Click to Unlock ML Controls</span>
                </button>
              )
            )}
          </div>
        </div>

        {/* Sidebar footer — operator identity + Theme toggle */}
        <div className="border-t border-slate-200 dark:border-slate-800 p-3 space-y-2">
          {/* Theme Toggle Button */}
          <button
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${
              isSidebarCollapsed ? 'justify-center' : ''
            } bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-250 dark:border-slate-700/60`}
            title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
          >
            {theme === 'light' ? (
              <>
                <Moon className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                {!isSidebarCollapsed && <span>Dark Mode</span>}
              </>
            ) : (
              <>
                <Sun className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                {!isSidebarCollapsed && <span>Light Mode</span>}
              </>
            )}
          </button>

          <div
            className={`flex items-center gap-3 rounded-lg p-2 ${
              isSidebarCollapsed ? 'justify-center' : ''
            }`}
          >
            <div
              className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20"
            >
              JD
            </div>
            {!isSidebarCollapsed && (
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-300 truncate">J. Doe</p>
                <p className="text-[10px] text-slate-500 dark:text-slate-600 truncate font-mono">Forensic Operator</p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ── MAIN WORKSPACE ───────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">

        {/* TOPBAR */}
        <header
          className="h-11 border-b border-slate-200 dark:border-slate-800/80 px-5 flex items-center justify-between z-10 shrink-0 bg-slate-50/90 dark:bg-[#0F172A]/90 backdrop-blur-md transition-colors"
        >
          {/* Breadcrumbs */}
          <nav className="flex items-center gap-1.5 text-xs font-medium">
            {getBreadcrumbs().map((crumb, idx, arr) => (
              <Fragment key={`${crumb.link}-${idx}`}>
                {idx > 0 && <span className="text-slate-400 dark:text-slate-700">/</span>}
                {idx === arr.length - 1 ? (
                  <span className="text-slate-800 dark:text-slate-200 font-semibold">{crumb.label}</span>
                ) : (
                  <Link to={crumb.link} className="text-slate-500 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">
                    {crumb.label}
                  </Link>
                )}
              </Fragment>
            ))}
          </nav>

          {/* AI Copilot global search bar */}
          <GlobalSearchBar onOpenCopilot={() => setIsCopilotOpen(true)} />

          {/* Pipeline status pill & theme toggle */}
          <div className="flex items-center gap-2.5">
            {/* Clickable Pipeline Status Pill */}
            {(() => {
              const activeJobs = systemJobs.filter(j => j.status === 'running' || j.status === 'pending');
              const isPipelineActive = activeJobs.length > 0;
              return (
                <span
                  onClick={() => setIsJobsModalOpen(true)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1.5 border cursor-pointer select-none transition-all duration-300 hover:scale-105 active:scale-95 ${
                    isPipelineActive
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400 font-bold shadow-sm shadow-amber-500/10 animate-pulse'
                      : 'bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                  } ${hasActiveTransition ? 'ring-2 ring-teal-500 dark:ring-teal-400 scale-110' : ''}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full transition-all duration-300 ${
                      isPipelineActive ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'
                    }`}
                  />
                  {isPipelineActive 
                    ? `Active: ${activeJobs[0].name.substring(0, 18)}${activeJobs[0].name.length > 18 ? '...' : ''}`
                    : 'Pipeline Idle'}
                </span>
              );
            })()}

            <button
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
              title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
            >
              {theme === 'light' ? <Moon className="h-4 w-4 text-indigo-600" /> : <Sun className="h-4 w-4 text-amber-400" />}
            </button>
          </div>
        </header>

        {/* WORKSPACE CONTENT */}
        <div
          className="flex-grow p-6 pb-24 overflow-y-auto bg-slate-50 dark:bg-brand-bg transition-colors duration-150"
        >
          
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
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
                    models={models}
                  />
                }
              />
              <Route path="/models" element={<Models models={models} onRefreshModels={fetchModels} />} />
              <Route path="/embedding-models" element={<EmbeddingModels />} />
              <Route path="/alerts" element={<AlertsDashboard cameras={cameras} onPlayVideoAtTime={handlePlayVideoAtTime} />} />
              <Route path="/alerts/abandoned" element={<Alerts cameras={cameras} onPlayVideoAtTime={handlePlayVideoAtTime} />} />
              <Route path="/alerts/theft" element={<TheftAlerts cameras={cameras} onPlayVideoAtTime={handlePlayVideoAtTime} />} />
              <Route path="/theft-alerts" element={<TheftAlerts cameras={cameras} onPlayVideoAtTime={handlePlayVideoAtTime} />} />
              <Route path="/alerts/assault" element={<AssaultDetection cameras={cameras} />} />
              <Route path="/assault-alerts" element={<AssaultDetection cameras={cameras} />} />
              <Route path="/assault-detection" element={<AssaultDetection cameras={cameras} />} />
              <Route path="/frame-inspection/:alertId" element={<FrameInspection />} />
              <Route path="/finetuning" element={<FineTuning />} />
              <Route path="/search" element={<Search onPlayVideoAtTime={handlePlayVideoAtTime} />} />
              <Route path="/multicam" element={<MultiCameraTracking />} />
              <Route path="/targets" element={<HotTargets onPlayVideoAtTime={handlePlayVideoAtTime} />} />
              <Route path="/cameras/:camera_id/videos/:video_id" element={<VideoDetail />} />
              <Route path="/cameras/:camera_id/live" element={<LiveCameraView />} />
            </Routes>
          </ErrorBoundary>

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

              <div className="rounded border border-teal-200 bg-teal-50/60 p-3 dark:border-teal-900/60 dark:bg-teal-950/20">
                <label className="flex cursor-pointer items-start gap-2 text-xs font-semibold text-teal-800 dark:text-teal-300">
                  <input type="checkbox" checked={enableLoitering} onChange={(event) => setEnableLoitering(event.target.checked)} className="mt-0.5 rounded border-teal-400 text-teal-700 focus:ring-teal-600" />
                  <span>Configure loitering detection for this video<span className="mt-0.5 block text-[10px] font-normal text-teal-700/80 dark:text-teal-400">After preprocessing, draw a review zone on a standardized frame.</span></span>
                </label>
                {enableLoitering && <label className="mt-2 block text-[10px] font-bold uppercase tracking-wider text-teal-800 dark:text-teal-300">Dwell threshold (seconds)
                  <input type="number" min="5" max="86400" value={loiteringThreshold} onChange={(event) => setLoiteringThreshold(Number(event.target.value))} className="mt-1 w-full rounded border border-teal-200 bg-white px-2 py-1.5 text-xs font-normal text-slate-800 dark:border-teal-800 dark:bg-slate-900 dark:text-slate-100" />
                </label>}
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
      {loiteringEditorVideoId && <LoiteringZoneEditor videoId={loiteringEditorVideoId} onClose={() => setLoiteringEditorVideoId(null)} />}

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
                              toast.error('Download Error', 'Download failed. Check backend connectivity.')
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

      {/* Global Full-Screen AI Copilot Assistant Overlay */}
      <AICopilotOverlay
        isOpen={isCopilotOpen}
        onClose={() => {
          setIsCopilotOpen(false)
          setCopilotInitialPrompt('')
        }}
        initialPrompt={copilotInitialPrompt}
        onPlayVideoAtTime={handlePlayVideoAtTime}
      />

      {/* ── SYSTEM PIPELINE BACKGROUND JOBS MONITOR MODAL ── */}
      {isJobsModalOpen && (
        <div 
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          onClick={() => setIsJobsModalOpen(false)}
        >
          <div 
            className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl space-y-4 cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-150 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${systemJobs.some(j => j.status === 'running' || j.status === 'pending') ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
                  System Pipeline Monitor
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Real-time video indexing, upload preprocessing, and ML model sync tasks.
                </p>
              </div>
              <button
                onClick={() => setIsJobsModalOpen(false)}
                className="text-slate-400 hover:text-slate-850 dark:hover:text-white"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="max-h-[300px] overflow-y-auto space-y-3 pr-1">
              {systemJobs.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-450 dark:text-slate-550 italic">
                  Pipeline is idle, nothing in the queue.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {/* Current Active Jobs */}
                  {systemJobs.filter(j => j.status === 'running' || j.status === 'pending').length > 0 && (
                    <div className="space-y-2">
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400">Currently Active</span>
                      {systemJobs.filter(j => j.status === 'running' || j.status === 'pending').map((job) => {
                        return (
                          <div 
                            key={job.id}
                            onClick={() => {
                              setIsJobsModalOpen(false);
                              if (job.job_type === 'upload' && job.payload?.camera_id) {
                                navigate(`/cameras/${job.payload.camera_id}`);
                              } else if (job.job_type === 'model_run') {
                                navigate('/models');
                              } else if (job.job_type === 'alerts') {
                                navigate('/alerts');
                              } else if (job.payload?.camera_id) {
                                navigate(`/cameras/${job.payload.camera_id}`);
                              } else {
                                navigate('/cameras');
                              }
                            }}
                            className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 dark:hover:bg-amber-500/15 cursor-pointer transition-colors duration-150 space-y-1.5"
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-slate-800 dark:text-slate-200">{job.name}</span>
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wider bg-amber-500/20 text-amber-700 dark:text-amber-300">
                                {job.status}
                              </span>
                            </div>
                            <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded overflow-hidden">
                              <div 
                                className="bg-amber-500 h-full rounded transition-all duration-300"
                                style={{ width: `${job.progress}%` }}
                              />
                            </div>
                            <div className="flex justify-between text-[9px] font-mono text-slate-400">
                              <span>Progress: {job.progress.toFixed(0)}%</span>
                              <span>Started: {new Date(job.created_at).toLocaleTimeString()}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Recently Completed Jobs */}
                  {systemJobs.filter(j => j.status !== 'running' && j.status !== 'pending').length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-850">
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-455">Recent Activities</span>
                      <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                        {systemJobs.filter(j => j.status !== 'running' && j.status !== 'pending').slice(0, 10).map((job) => {
                          const isSuccess = job.status === 'completed';
                          return (
                            <div 
                              key={job.id}
                              onClick={() => {
                                setIsJobsModalOpen(false);
                                if (job.job_type === 'upload' && job.payload?.camera_id) {
                                  navigate(`/cameras/${job.payload.camera_id}`);
                                } else if (job.job_type === 'model_run') {
                                  navigate('/models');
                                } else if (job.job_type === 'alerts') {
                                  navigate('/alerts');
                                } else {
                                  navigate('/cameras');
                                }
                              }}
                              className="p-2 rounded bg-slate-55/60 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/50 dark:border-slate-800 cursor-pointer transition-colors duration-150 flex items-center justify-between text-xs"
                            >
                              <div className="flex flex-col min-w-0">
                                <span className="font-semibold text-slate-750 dark:text-slate-300 truncate">{job.name}</span>
                                <span className="text-[9px] font-mono text-slate-400">Finished: {new Date(job.updated_at).toLocaleTimeString()}</span>
                              </div>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                isSuccess 
                                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' 
                                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                              }`}>
                                {job.status}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-slate-100 dark:border-slate-850 text-[10px] text-slate-400">
              <span>* Click on any task above to view status instantly.</span>
              {systemJobs.filter(j => j.status === 'completed' || j.status === 'failed').length > 0 && (
                <button
                  onClick={async () => {
                    await fetch(`${API_BASE}/api/v1/jobs/clear`, { method: 'POST' });
                    fetchSystemJobs();
                  }}
                  className="text-rose-650 dark:text-rose-400 hover:underline font-bold"
                >
                  Clear Logs
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
