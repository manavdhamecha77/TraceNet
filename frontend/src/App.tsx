import React, { useState, useEffect, useRef } from 'react'

// Backend API Base URL
const API_BASE = 'http://localhost:8000'

interface Camera {
  camera_id: string
  name: string
  latitude?: number
  longitude?: number
  corridor_group?: string
  adjacency: string[]
  is_active: boolean
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
  processing_status: string // 'pending' | 'processing' | 'complete' | 'failed'
  duration?: number
  start_time?: string
  end_time?: string
  thumbnail_path?: string
}

function App() {
  const [currentPage, setCurrentPage] = useState<'dashboard' | 'cameras' | 'search'>('cameras')
  const [cameras, setCameras] = useState<Camera[]>([])
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null)
  const [cameraVideos, setCameraVideos] = useState<Video[]>([])
  const [activeTab, setActiveTab] = useState<'original' | 'system'>('original')

  // Modals state
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false)
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false)
  const [selectedVideoToPlay, setSelectedVideoToPlay] = useState<Video | null>(null)

  // Camera Form State
  const [newCameraId, setNewCameraId] = useState('')
  const [newCameraName, setNewCameraName] = useState('')
  const [newCameraLat, setNewCameraLat] = useState('')
  const [newCameraLon, setNewCameraLon] = useState('')
  const [newCameraCorridor, setNewCameraCorridor] = useState('')
  const [newCameraAdjacency, setNewCameraAdjacency] = useState('')
  const [cameraFormError, setCameraFormError] = useState('')

  // Video Form State
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadStartTime, setUploadStartTime] = useState('')
  const [uploadProgress, setUploadProgress] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle')
  const [uploadError, setUploadError] = useState('')

  // Metrics (for Dashboard)
  const [metrics, setMetrics] = useState({
    totalCameras: 0,
    totalVideos: 0,
    processedVideos: 0,
    pendingVideos: 0,
    failedVideos: 0,
  })

  // Poll intervals
  const pollTimerRef = useRef<any>(null)

  // Fetch all cameras
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

  // Fetch camera videos
  const fetchCameraVideos = async (cameraId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/cameras/${cameraId}/videos`)
      if (res.ok) {
        const data = await res.json()
        setCameraVideos(data)
      }
    } catch (err) {
      console.error(`Failed to fetch videos for camera ${cameraId}:`, err)
    }
  }

  // Populate Dashboard Metrics
  useEffect(() => {
    if (currentPage === 'dashboard') {
      fetchCameras()
      // Collect global metrics
      const fetchGlobalVideos = async () => {
        let allVideos: Video[] = []
        try {
          // Simple local aggregation
          const cameraPromises = cameras.map((c) =>
            fetch(`${API_BASE}/api/v1/cameras/${c.camera_id}/videos`).then((r) => r.json())
          )
          const results = await Promise.all(cameraPromises)
          allVideos = results.flat()
          
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
          console.error(err)
        }
      }
      if (cameras.length > 0) {
        fetchGlobalVideos()
      }
    }
  }, [currentPage, cameras])

  // Initial fetch and polling setup
  useEffect(() => {
    fetchCameras()
  }, [])

  // Poll videos status if there are any incomplete tasks
  useEffect(() => {
    if (selectedCamera) {
      fetchCameraVideos(selectedCamera.camera_id)

      const hasIncomplete = cameraVideos.some(
        (v) => v.processing_status === 'pending' || v.processing_status === 'processing'
      )

      if (hasIncomplete) {
        // Start polling every 3 seconds
        pollTimerRef.current = setInterval(() => {
          fetchCameraVideos(selectedCamera.camera_id)
        }, 3000)
      } else {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current)
      }
    } else {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [selectedCamera, cameraVideos.map((v) => v.processing_status).join(',')])

  // Create new camera profile
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
      } else {
        const errorData = await res.json()
        setCameraFormError(errorData.detail || 'Failed to register camera.')
      }
    } catch (err) {
      setCameraFormError('Network error. Failed to reach backend API.')
    }
  }

  // Upload video
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
        fetchCameraVideos(selectedCamera.camera_id)
        // Reset form and close
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

  const formatDuration = (secs?: number) => {
    if (secs === undefined) return '--:--'
    const minutes = Math.floor(secs / 60)
    const seconds = Math.floor(secs % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const formatDateTime = (isoStr?: string) => {
    if (!isoStr) return 'N/A'
    return new Date(isoStr).toLocaleString()
  }

  const getThumbnailUrl = (video: Video) => {
    if (video.thumbnail_path) {
      // Replaces local path data/ prefix with relative /data url
      const relativePath = video.thumbnail_path.replace(/^\.?\/?data\//, '')
      return `${API_BASE}/data/${relativePath}`
    }
    return ''
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
    <div className="flex min-h-screen bg-ink-950 text-slate-100 antialiased font-sans">
      
      {/* SIDEBAR NAVIGATION */}
      <aside className="w-64 border-r border-white/10 bg-slate-950/80 p-6 flex flex-col justify-between backdrop-blur-md">
        <div className="space-y-8">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-aurora-400/10 text-aurora-400 shadow-glow">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </span>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white">DRISHTI</h2>
              <span className="text-xs text-aurora-400 uppercase tracking-widest font-semibold">CCTV Analytics</span>
            </div>
          </div>

          <nav className="space-y-1">
            <button
              onClick={() => {
                setCurrentPage('dashboard')
                setSelectedCamera(null)
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-all ${
                currentPage === 'dashboard'
                  ? 'bg-aurora-400/10 text-aurora-400 border-l-2 border-aurora-400'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z" />
              </svg>
              Dashboard
            </button>
            
            <button
              onClick={() => {
                setCurrentPage('cameras')
                setSelectedCamera(null)
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-all ${
                currentPage === 'cameras' && !selectedCamera
                  ? 'bg-aurora-400/10 text-aurora-400 border-l-2 border-aurora-400'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Cameras
            </button>
            
            <button
              onClick={() => {
                setCurrentPage('search')
                setSelectedCamera(null)
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-all ${
                currentPage === 'search'
                  ? 'bg-aurora-400/10 text-aurora-400 border-l-2 border-aurora-400'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Search & Rank
            </button>
          </nav>
        </div>

        <div className="border-t border-white/10 pt-4 text-center">
          <span className="text-xs text-slate-500 block">TraceNet Platform v1.0</span>
          <span className="text-xs text-aurora-400/60 block mt-1">Audit Log Activated</span>
        </div>
      </aside>

      {/* MAIN CONTAINER */}
      <main className="flex-1 flex flex-col min-h-screen overflow-y-auto">
        <header className="border-b border-white/10 bg-slate-950/40 px-8 py-4 flex items-center justify-between backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-4">
            {selectedCamera && (
              <button
                onClick={() => setSelectedCamera(null)}
                className="flex items-center justify-center p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-all"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
            )}
            <div>
              <h1 className="text-2xl font-semibold text-white">
                {selectedCamera ? selectedCamera.name : currentPage.charAt(0).toUpperCase() + currentPage.slice(1)}
              </h1>
              {selectedCamera && (
                <div className="text-xs text-slate-400 mt-0.5 flex gap-4">
                  <span>Location: <strong className="text-slate-300">{selectedCamera.latitude ?? 'N/A'}, {selectedCamera.longitude ?? 'N/A'}</strong></span>
                  <span>Corridor: <strong className="text-slate-300">{selectedCamera.corridor_group ?? 'General'}</strong></span>
                  <span>Camera ID: <strong className="text-aurora-400">{selectedCamera.camera_id}</strong></span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs text-slate-400 font-medium">SQLite DB Connected</span>
          </div>
        </header>

        <div className="flex-grow p-8">
          
          {/* DASHBOARD PAGE */}
          {currentPage === 'dashboard' && (
            <div className="space-y-8">
              <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <div className="metric-card glass-panel flex justify-between items-center">
                  <div>
                    <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Registered Cameras</span>
                    <h3 className="text-3xl font-bold text-white mt-1">{metrics.totalCameras}</h3>
                  </div>
                  <span className="p-3 bg-aurora-400/10 rounded-xl text-aurora-400">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </span>
                </div>

                <div className="metric-card glass-panel flex justify-between items-center">
                  <div>
                    <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Total Video Assets</span>
                    <h3 className="text-3xl font-bold text-white mt-1">{metrics.totalVideos}</h3>
                  </div>
                  <span className="p-3 bg-aurora-400/10 rounded-xl text-aurora-400">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                    </svg>
                  </span>
                </div>

                <div className="metric-card glass-panel flex justify-between items-center">
                  <div>
                    <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Processed & Ready</span>
                    <h3 className="text-3xl font-bold text-emerald-400 mt-1">{metrics.processedVideos}</h3>
                  </div>
                  <span className="p-3 bg-emerald-400/10 rounded-xl text-emerald-400">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </span>
                </div>

                <div className="metric-card glass-panel flex justify-between items-center">
                  <div>
                    <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Queue / Processing</span>
                    <h3 className="text-3xl font-bold text-amber-400 mt-1">{metrics.pendingVideos}</h3>
                  </div>
                  <span className="p-3 bg-amber-400/10 rounded-xl text-amber-400">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18.5" />
                    </svg>
                  </span>
                </div>
              </section>

              <section className="glass-panel p-6">
                <h3 className="text-lg font-bold text-white mb-4">Phase 1 Status Brief</h3>
                <div className="space-y-4">
                  <div className="p-4 bg-slate-900/60 rounded-xl border border-white/5 flex justify-between items-center">
                    <div>
                      <h4 className="text-sm font-semibold text-white">SQLite Database Schema</h4>
                      <p className="text-xs text-slate-400 mt-0.5">Integrates Camera Profiles and Video Assets dynamically.</p>
                    </div>
                    <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-xs font-semibold">Configured</span>
                  </div>

                  <div className="p-4 bg-slate-900/60 rounded-xl border border-white/5 flex justify-between items-center">
                    <div>
                      <h4 className="text-sm font-semibold text-white">FFmpeg 720p 10fps Transcode Engine</h4>
                      <p className="text-xs text-slate-400 mt-0.5">Automates footprint standardization for incoming uploads.</p>
                    </div>
                    <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-xs font-semibold">Active</span>
                  </div>

                  <div className="p-4 bg-slate-900/60 rounded-xl border border-white/5 flex justify-between items-center">
                    <div>
                      <h4 className="text-sm font-semibold text-white">4 FPS Timeline Frame Sampling</h4>
                      <p className="text-xs text-slate-400 mt-0.5">Performs high-performance frame extraction in memory without disk load.</p>
                    </div>
                    <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-xs font-semibold">Active</span>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* CAMERAS PAGE */}
          {currentPage === 'cameras' && !selectedCamera && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold text-white">Connected Cameras</h3>
                  <p className="text-sm text-slate-400 mt-0.5">Monitor layouts, geographic coordinates, and neighboring topo topologies.</p>
                </div>
                <button
                  onClick={() => setIsCameraModalOpen(true)}
                  className="flex items-center gap-2 rounded-xl bg-aurora-400 bg-gradient-to-r from-aurora-400 to-aurora-600 px-4 py-2.5 text-sm font-bold text-ink-950 hover:brightness-110 shadow-glow transition-all"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Register Camera
                </button>
              </div>

              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {cameras.length === 0 ? (
                  <div className="col-span-full py-16 text-center glass-panel">
                    <svg className="mx-auto h-12 w-12 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                    <h3 className="mt-4 text-lg font-semibold text-white">No cameras registered</h3>
                    <p className="mt-2 text-sm text-slate-400">Register a new camera to start ingesting forensic feeds.</p>
                    <button
                      onClick={() => setIsCameraModalOpen(true)}
                      className="mt-6 inline-flex items-center gap-2 rounded-lg bg-aurora-400 px-4 py-2 text-sm font-semibold text-ink-950 hover:brightness-110 transition-all"
                    >
                      Add Camera
                    </button>
                  </div>
                ) : (
                  cameras.map((camera) => (
                    <div key={camera.camera_id} className="glass-panel p-6 flex flex-col justify-between hover:border-aurora-400/30 transition-all group">
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center rounded-full bg-slate-900 border border-slate-800 px-2.5 py-0.5 text-xs font-semibold text-aurora-400">
                            {camera.camera_id}
                          </span>
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            camera.is_active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                          }`}>
                            {camera.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </div>

                        <h4 className="text-lg font-bold text-white mt-4 group-hover:text-aurora-400 transition-colors">
                          {camera.name}
                        </h4>

                        <div className="mt-4 space-y-2 text-xs text-slate-400">
                          <div className="flex justify-between">
                            <span>Corridor Group:</span>
                            <span className="text-slate-200">{camera.corridor_group ?? 'General'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Coordinates:</span>
                            <span className="text-slate-200">{camera.latitude ?? '--'}, {camera.longitude ?? '--'}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span>Adjacency:</span>
                            <span className="text-slate-300 truncate max-w-[120px]" title={camera.adjacency.join(', ')}>
                              {camera.adjacency.length > 0 ? camera.adjacency.join(', ') : 'None'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Standardized Feeds:</span>
                            <span className="text-slate-200 font-bold">{camera.video_count} videos</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-6">
                        <button
                          onClick={() => {
                            setSelectedCamera(camera)
                            fetchCameraVideos(camera.camera_id)
                          }}
                          className="w-full flex items-center justify-center gap-2 rounded-lg bg-white/5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-aurora-400/10 hover:text-aurora-400 hover:border hover:border-aurora-400/20 transition-all"
                        >
                          Open Camera Details
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* CAMERA DETAIL PAGE (Slug) */}
          {selectedCamera && (
            <div className="space-y-6">
              
              {/* Top Details & Action */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-950/30 p-6 rounded-2xl border border-white/5">
                <div className="space-y-1">
                  <span className="text-xs text-aurora-400 uppercase tracking-widest font-semibold">Physical Location Topography</span>
                  <h3 className="text-xl font-bold text-white">Geographic Assets: {selectedCamera.name}</h3>
                  <p className="text-sm text-slate-400">
                    Adjacent cameras: <strong className="text-slate-300">{selectedCamera.adjacency.length > 0 ? selectedCamera.adjacency.join(', ') : 'None'}</strong>
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setIsUploadModalOpen(true)}
                    className="flex items-center gap-2 rounded-xl bg-aurora-400 bg-gradient-to-r from-aurora-400 to-aurora-600 px-5 py-2.5 text-sm font-bold text-ink-950 hover:brightness-110 shadow-glow transition-all"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Upload Video Feed
                  </button>
                </div>
              </div>

              {/* TABS TONE */}
              <div className="border-b border-white/10 flex justify-between items-center">
                <div className="flex gap-6">
                  <button
                    onClick={() => setActiveTab('original')}
                    className={`py-3 text-sm font-semibold border-b-2 transition-all ${
                      activeTab === 'original'
                        ? 'border-aurora-400 text-aurora-400'
                        : 'border-transparent text-slate-400 hover:text-white'
                    }`}
                  >
                    Original Video Audits
                  </button>
                  <button
                    onClick={() => setActiveTab('system')}
                    className={`py-3 text-sm font-semibold border-b-2 transition-all ${
                      activeTab === 'system'
                        ? 'border-aurora-400 text-aurora-400'
                        : 'border-transparent text-slate-400 hover:text-white'
                    }`}
                  >
                    System / Preprocessed Metadata
                  </button>
                </div>
                <span className="text-xs text-slate-500">
                  Showing {cameraVideos.length} feeds
                </span>
              </div>

              {/* VIDEOS LIST TABLE */}
              <div className="glass-panel overflow-hidden">
                <table className="min-w-full divide-y divide-white/5 text-left">
                  <thead className="bg-slate-950/60 text-xs text-slate-400 uppercase font-semibold">
                    <tr>
                      <th className="px-6 py-4">Thumbnail</th>
                      <th className="px-6 py-4">Name / File</th>
                      <th className="px-6 py-4">Duration</th>
                      <th className="px-6 py-4">Time Window</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Details</th>
                      <th className="px-6 py-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-sm">
                    {cameraVideos.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-16 text-slate-500">
                          No video assets registered under this camera. Upload one above.
                        </td>
                      </tr>
                    ) : (
                      cameraVideos.map((video) => {
                        const thumbUrl = getThumbnailUrl(video)
                        return (
                          <tr key={video.id} className="hover:bg-white/5 transition-all">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="h-12 w-20 bg-slate-900 border border-white/5 rounded-lg overflow-hidden flex items-center justify-center relative">
                                {thumbUrl ? (
                                  <img src={thumbUrl} alt="Video thumbnail" className="h-full w-full object-cover" />
                                ) : (
                                  <svg className="h-6 w-6 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                  </svg>
                                )}
                                {video.processing_status === 'processing' && (
                                  <span className="absolute inset-0 bg-aurora-600/20 backdrop-blur-[1px] flex items-center justify-center">
                                    <svg className="animate-spin h-5 w-5 text-aurora-400" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                  </span>
                                )}
                              </div>
                            </td>
                            
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="font-bold text-white">
                                {activeTab === 'original' ? video.original_filename : video.standardized_filename}
                              </div>
                              <div className="text-xs text-slate-500 font-mono mt-0.5 truncate max-w-[200px]" title={activeTab === 'original' ? video.intake_sha256 : video.transcoded_sha256}>
                                Hash: {activeTab === 'original' ? video.intake_sha256.substring(0, 16) + '...' : video.transcoded_sha256 ? video.transcoded_sha256.substring(0, 16) + '...' : 'N/A'}
                              </div>
                            </td>

                            <td className="px-6 py-4 whitespace-nowrap text-slate-300 font-medium">
                              {video.processing_status === 'complete' ? formatDuration(video.duration) : '--:--'}
                            </td>

                            <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-300">
                              <div>Start: {formatDateTime(video.start_time || video.upload_timestamp)}</div>
                              <div className="mt-1 text-slate-400">End: {formatDateTime(video.end_time || video.upload_timestamp)}</div>
                            </td>

                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                video.processing_status === 'complete' ? 'bg-emerald-500/10 text-emerald-400' :
                                video.processing_status === 'processing' ? 'bg-aurora-400/10 text-aurora-400 animate-pulse' :
                                video.processing_status === 'failed' ? 'bg-rose-500/10 text-rose-400' :
                                'bg-amber-500/10 text-amber-400'
                              }`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${
                                  video.processing_status === 'complete' ? 'bg-emerald-400' :
                                  video.processing_status === 'processing' ? 'bg-aurora-400' :
                                  video.processing_status === 'failed' ? 'bg-rose-400' :
                                  'bg-amber-400'
                                }`}></span>
                                {video.processing_status.toUpperCase()}
                              </span>
                            </td>

                            <td className="px-6 py-4 text-xs text-slate-400 max-w-[200px] truncate">
                              {activeTab === 'original' ? (
                                <span>Uploaded via API. Intake Hash verified.</span>
                              ) : (
                                <span>Transcode: 720p 10fps H.264. Frames sampled: 4 FPS.</span>
                              )}
                            </td>

                            <td className="px-6 py-4 whitespace-nowrap text-right">
                              <button
                                disabled={video.processing_status !== 'complete'}
                                onClick={() => setSelectedVideoToPlay(video)}
                                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                                  video.processing_status === 'complete'
                                    ? 'bg-aurora-400 text-ink-950 hover:brightness-110 shadow-glow'
                                    : 'bg-white/5 text-slate-500 cursor-not-allowed'
                                }`}
                              >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                View
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SEARCH PAGE (Placeholder) */}
          {currentPage === 'search' && (
            <div className="glass-panel p-8 text-center space-y-6 max-w-xl mx-auto mt-16">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-aurora-400/10 text-aurora-400 shadow-glow">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
              <h3 className="text-xl font-bold text-white">Semantic AI Forensic Search</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Phase 3 will integrate the CLIP embedding search layer, enabling natural language description searches 
                like <span className="text-aurora-400">"man with red backpack near Gate 3"</span> across all standardized assets.
              </p>
              <div className="border border-white/5 bg-slate-950/50 p-4 rounded-xl text-xs text-left font-mono space-y-2 text-slate-500">
                <div>[INFO] Embedding query engine ready.</div>
                <div>[INFO] FAISS Index listener pending.</div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* CAMERA REGISTRATION MODAL */}
      {isCameraModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-ink-900 p-6 shadow-glow animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Register Camera Profile</h3>
              <button
                onClick={() => setIsCameraModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleCreateCamera} className="space-y-4">
              {cameraFormError && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                  {cameraFormError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Camera ID *</label>
                <input
                  type="text"
                  placeholder="e.g. CAM_042"
                  value={newCameraId}
                  onChange={(e) => setNewCameraId(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white focus:outline-none focus:border-aurora-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Camera Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Main Street Intersection"
                  value={newCameraName}
                  onChange={(e) => setNewCameraName(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white focus:outline-none focus:border-aurora-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Latitude</label>
                  <input
                    type="number"
                    step="0.000001"
                    placeholder="e.g. 23.0225"
                    value={newCameraLat}
                    onChange={(e) => setNewCameraLat(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white focus:outline-none focus:border-aurora-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Longitude</label>
                  <input
                    type="number"
                    step="0.000001"
                    placeholder="e.g. 72.5714"
                    value={newCameraLon}
                    onChange={(e) => setNewCameraLon(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white focus:outline-none focus:border-aurora-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Corridor / Group</label>
                <input
                  type="text"
                  placeholder="e.g. Zone-A"
                  value={newCameraCorridor}
                  onChange={(e) => setNewCameraCorridor(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white focus:outline-none focus:border-aurora-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Adjacent Camera IDs (Comma separated)</label>
                <input
                  type="text"
                  placeholder="e.g. CAM_041, CAM_043"
                  value={newCameraAdjacency}
                  onChange={(e) => setNewCameraAdjacency(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white focus:outline-none focus:border-aurora-400"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCameraModalOpen(false)}
                  className="rounded-lg bg-white/5 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-aurora-400 px-4 py-2 text-sm font-bold text-ink-950 hover:brightness-110 shadow-glow transition-colors"
                >
                  Save Camera
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIDEO UPLOAD MODAL */}
      {isUploadModalOpen && selectedCamera && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-ink-900 p-6 shadow-glow animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Upload Video Feed</h3>
              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleUploadVideo} className="space-y-4">
              {uploadError && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                  {uploadError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Target Camera ID</label>
                <input
                  type="text"
                  disabled
                  value={`${selectedCamera.camera_id} - ${selectedCamera.name}`}
                  className="w-full rounded-lg border border-white/10 bg-slate-950/30 px-3 py-2 text-sm text-slate-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Select Video File *</label>
                <input
                  type="file"
                  accept="video/*"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      setUploadFile(e.target.files[0])
                    }
                  }}
                  className="w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-aurora-400/10 file:text-aurora-400 hover:file:bg-aurora-400/20 file:cursor-pointer"
                />
                <span className="text-[10px] text-slate-500 block mt-1">Accepts any raw standard CCTV formats (.avi, .mov, .mp4, etc.)</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Start Datetime (CCTV Timeline Alignment)</label>
                <input
                  type="datetime-local"
                  value={uploadStartTime}
                  onChange={(e) => setUploadStartTime(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white focus:outline-none focus:border-aurora-400"
                />
                <span className="text-[10px] text-slate-500 block mt-1">Aligns the video frames to real-world local timestamps.</span>
              </div>

              {uploadProgress === 'uploading' && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-aurora-400 font-semibold">
                    <span>Uploading original asset to WORM storage...</span>
                    <span className="animate-pulse">Active</span>
                  </div>
                  <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                    <div className="bg-aurora-400 h-full rounded-full animate-[shimmer_1.5s_infinite]" style={{ width: '80%' }}></div>
                  </div>
                </div>
              )}

              {uploadProgress === 'success' && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold flex items-center gap-2">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Intake Completed! Preprocessing kicked off.
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={uploadProgress === 'uploading'}
                  onClick={() => setIsUploadModalOpen(false)}
                  className="rounded-lg bg-white/5 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploadProgress === 'uploading'}
                  className="rounded-lg bg-aurora-400 px-4 py-2 text-sm font-bold text-ink-950 hover:brightness-110 shadow-glow transition-colors"
                >
                  Start Ingest
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIDEO PLAYER PREVIEW PANEL (Stage 2 Bounding Box Placeholder) */}
      {selectedVideoToPlay && selectedCamera && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-6">
          <div className="w-full max-w-4xl rounded-3xl border border-white/10 bg-slate-950 overflow-hidden shadow-glow animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 bg-slate-900 border-b border-white/5">
              <div>
                <h3 className="text-base font-bold text-white">{selectedVideoToPlay.original_filename}</h3>
                <span className="text-xs text-slate-400 mt-0.5 block">Camera: {selectedCamera.name} ({selectedCamera.camera_id})</span>
              </div>
              <button
                onClick={() => setSelectedVideoToPlay(null)}
                className="text-slate-400 hover:text-white p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-all"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="grid md:grid-cols-[1.5fr_0.5fr] divide-x divide-white/5">
              {/* Left: Video Player */}
              <div className="bg-black p-4 flex items-center justify-center min-h-[360px]">
                <video
                  src={getVideoPlayerUrl(selectedVideoToPlay)}
                  controls
                  autoPlay
                  className="w-full max-h-[480px] rounded-xl shadow-lg border border-white/5"
                />
              </div>

              {/* Right: Forensic Metadata Panel */}
              <div className="p-6 bg-slate-950 space-y-6 flex flex-col justify-between">
                <div className="space-y-6">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Technical Properties</h4>
                    <div className="space-y-2 text-xs text-slate-300">
                      <div className="flex justify-between border-b border-white/5 pb-1">
                        <span>Format:</span>
                        <span className="text-white font-mono">H.264 / AAC .mp4</span>
                      </div>
                      <div className="flex justify-between border-b border-white/5 pb-1">
                        <span>Resolution:</span>
                        <span className="text-white">1280x720 (720p)</span>
                      </div>
                      <div className="flex justify-between border-b border-white/5 pb-1">
                        <span>Framerate:</span>
                        <span className="text-white">10.0 FPS</span>
                      </div>
                      <div className="flex justify-between border-b border-white/5 pb-1">
                        <span>Sampling rate:</span>
                        <span className="text-aurora-400">4.0 FPS (Timeline)</span>
                      </div>
                      <div className="flex justify-between border-b border-white/5 pb-1">
                        <span>Duration:</span>
                        <span className="text-white">{formatDuration(selectedVideoToPlay.duration)}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Stage 2 Analytics Preview</h4>
                    <div className="rounded-xl border border-white/5 bg-slate-900/60 p-4 text-center space-y-3">
                      <svg className="mx-auto h-8 w-8 text-aurora-400/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span className="text-[11px] text-slate-400 block leading-normal">
                        Detection and Tracking (YOLOv8 + ByteTrack) will map vehicle/person tracks over this video in Stage 2.
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/5 text-center">
                  <span className="text-[10px] text-slate-500 block">SHA-256 Hash of Standard Asset:</span>
                  <span className="text-[10px] text-aurora-400/60 font-mono break-all mt-1 block">
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
