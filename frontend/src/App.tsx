import { useState, useEffect, Fragment } from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Cameras from './pages/Cameras'
import CameraDetail from './pages/CameraDetail'
import Search from './pages/Search'
import Landing from './pages/Landing'

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
  duration?: number
  start_time?: string
  end_time?: string
  thumbnail_path?: string
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
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null)
  const [cameraVideos, setCameraVideos] = useState<Video[]>([])

  // Global modals state
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false)
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false)
  const [selectedVideoToPlay, setSelectedVideoToPlay] = useState<Video | null>(null)

  // Camera Form State
  const [newCameraId, setNewCameraId] = useState('')
  const [newCameraName, setNewCameraName] = useState('')
  const [newCameraLat, setNewCameraLat] = useState('')
  const [newCameraLon, setNewCameraLon] = useState('')
  const [newCameraAltitude, setNewCameraAltitude] = useState('')
  const [newCameraCorridor, setNewCameraCorridor] = useState('')
  const [newCameraAdjacency, setNewCameraAdjacency] = useState('')
  const [newCameraStatus, setNewCameraStatus] = useState('active')
  const [cameraFormError, setCameraFormError] = useState('')

  // Video Form State
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadStartTime, setUploadStartTime] = useState('')
  const [uploadProgress, setUploadProgress] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle')
  const [uploadError, setUploadError] = useState('')

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

  useEffect(() => {
    fetchCameras()
  }, [])

  // Aggregate global metrics for dashboard
  useEffect(() => {
    const fetchGlobalVideos = async () => {
      if (cameras.length === 0) return
      try {
        const cameraPromises = cameras.map((c) =>
          fetch(`${API_BASE}/api/v1/cameras/${c.camera_id}/videos`).then((r) => r.json())
        )
        const results = await Promise.all(cameraPromises)
        const allVideos: Video[] = results.flat()

        const complete = allVideos.filter((v) => v.processing_status === 'complete').length
        const pending = allVideos.filter((v) => v.processing_status === 'pending').length
        const processing = allVideos.filter((v) => v.processing_status === 'processing').length
        const failed = allVideos.filter((v) => v.processing_status === 'failed').length

        setMetrics({
          totalCameras: cameras.length,
          totalVideos: allVideos.length,
          processedVideos: complete,
          pendingVideos: pending + processing,
          failedVideos: failed,
        })
      } catch (err) {
        console.error('Failed to aggregate dashboard metrics:', err)
      }
    }
    fetchGlobalVideos()
  }, [cameras, location.pathname])

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
          crumbs.push({ label: selectedCamera ? selectedCamera.name : paths[1], link: `/cameras/${paths[1]}` })
        }
      } else if (paths[0] === 'search') {
        crumbs.push({ label: 'Search', link: '/search' })
      } else if (paths[0] === 'dashboard') {
        crumbs.push({ label: 'Dashboard', link: '/dashboard' })
      }
    } else {
      crumbs.push({ label: 'Home', link: '/' })
    }

    return crumbs
  }

  const getVideoPlayerUrl = (video: Video) => {
    if (video.thumbnail_path && video.standardized_filename) {
      const pathParts = video.thumbnail_path.split(/[/\\]/)
      const camerasIndex = pathParts.indexOf('cameras')
      if (camerasIndex !== -1 && pathParts.length > camerasIndex + 1) {
        const cameraFolder = pathParts[camerasIndex + 1]
        return `${API_BASE}/data/cameras/${cameraFolder}/original_assets/${video.standardized_filename}`
      }
    }
    return ''
  }

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
                  onOpenRegisterModal={() => setIsCameraModalOpen(true)}
                />
              }
            />
            <Route
              path="/cameras/:camera_id"
              element={
                <CameraDetail
                  onOpenUploadModal={() => setIsUploadModalOpen(true)}
                  onPlayVideo={(video) => setSelectedVideoToPlay(video)}
                  cameraVideos={cameraVideos}
                  setCameraVideos={setCameraVideos}
                  selectedCamera={selectedCamera}
                  setSelectedCamera={setSelectedCamera}
                />
              }
            />
            <Route path="/search" element={<Search />} />
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
                  className="rounded bg-teal-705 dark:bg-teal-600 hover:brightness-110 text-white px-3.5 py-1.5 text-xs font-bold transition-all shadow-sm"
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
                <input
                  type="file"
                  accept="video/*"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      setUploadFile(e.target.files[0])
                    }
                  }}
                  className="w-full text-xs text-slate-500 file:mr-3 file:py-1 file:px-2.5 file:rounded file:border file:border-slate-200 dark:file:border-slate-700 file:text-[11px] file:font-semibold file:bg-slate-50 dark:file:bg-slate-900 file:text-slate-600 dark:file:text-slate-400 hover:file:bg-slate-100 dark:hover:file:bg-slate-750 hover:file:cursor-pointer"
                />
                <span className="text-[10px] text-slate-400 dark:text-slate-500 block mt-1">Accepts standard forensic formats (.avi, .mov, .mp4, etc.)</span>
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
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-teal-700 dark:text-teal-400 font-semibold">
                    <span>Sending stream buffer...</span>
                    <span className="animate-pulse">Active</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-900 rounded-full h-1 overflow-hidden">
                    <div className="bg-teal-700 dark:bg-teal-500 h-full rounded-full animate-[shimmer_1.5s_infinite]" style={{ width: '85%' }}></div>
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
                  className="rounded bg-teal-705 dark:bg-teal-600 hover:brightness-110 text-white px-3.5 py-1.5 text-xs font-bold transition-all shadow-sm"
                >
                  Start Ingest
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIDEO PLAYER PREVIEW WINDOW */}
      {selectedVideoToPlay && selectedCamera && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6 backdrop-blur-[2px]">
          <div className="w-full max-w-4xl rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-750 overflow-hidden shadow-lg animate-in fade-in zoom-in-95 duration-100">
            
            <div className="flex items-center justify-between px-5 py-3 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
              <div>
                <h3 className="text-xs font-bold text-slate-850 dark:text-slate-100">{selectedVideoToPlay.original_filename}</h3>
                <span className="text-[10px] text-slate-400 block mt-0.5">Device: {selectedCamera.name} ({selectedCamera.camera_id})</span>
              </div>
              <button
                onClick={() => setSelectedVideoToPlay(null)}
                className="text-slate-400 hover:text-slate-800 dark:hover:text-white p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="grid md:grid-cols-[1.6fr_0.4fr] divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-700">
              
              {/* Media viewer */}
              <div className="bg-slate-950 p-4 flex items-center justify-center min-h-[300px]">
                <video
                  src={getVideoPlayerUrl(selectedVideoToPlay)}
                  controls
                  autoPlay
                  className="w-full max-h-[400px] rounded border border-slate-800 shadow"
                />
              </div>

              {/* Forensic side panel */}
              <div className="p-4 bg-white dark:bg-slate-900 space-y-5 flex flex-col justify-between">
                <div className="space-y-4">
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Footprint properties</h4>
                    <div className="space-y-1.5 text-[11px] text-slate-600 dark:text-slate-350">
                      <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-0.5">
                        <span>Format:</span>
                        <span className="text-slate-850 dark:text-slate-100 font-mono">H.264 MP4</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-0.5">
                        <span>Resolution:</span>
                        <span className="text-slate-850 dark:text-slate-100">1280x720 (720p)</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-0.5">
                        <span>Framerate:</span>
                        <span className="text-slate-850 dark:text-slate-100">10.0 FPS</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-0.5">
                        <span>Sampler:</span>
                        <span className="text-teal-700 dark:text-teal-400 font-semibold">4.0 FPS (Timeline)</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-0.5">
                        <span>Duration:</span>
                        <span className="text-slate-850 dark:text-slate-100">{formatDuration(selectedVideoToPlay.duration)}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Stage 2 Tracklets Preview</h4>
                    <div className="rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3 text-center space-y-2">
                      <svg className="mx-auto h-6 w-6 text-teal-700/40 dark:text-teal-400/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 block leading-normal">
                        YOLOv8 & ByteTrack analysis overlays will load tracklet annotations here in Stage 2.
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-150 dark:border-slate-800">
                  <span className="text-[9px] text-slate-400 block font-semibold">Verification SHA-256 Hash:</span>
                  <span className="text-[9px] text-teal-700 dark:text-teal-450 font-mono break-all mt-0.5 block">
                    {selectedVideoToPlay.transcoded_sha256 ?? 'Calculating...'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
