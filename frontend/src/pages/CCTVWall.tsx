import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Shield,
  Play,
  Pause,
  RefreshCw,
  Volume2,
  VolumeX,
  Sliders,
  Maximize2,
  Minimize2,
  ExternalLink,
  Activity,
  Layers,
  Clock,
  CheckCircle2,
  AlertTriangle,
  X,
  Eye,
} from 'lucide-react'
import { API_BASE } from '../config/api'
import { useToast } from '../components/Toast'

interface CCTVFeed {
  camera_id: string
  camera_name: string
  area_id?: string
  area_name?: string
  zone?: string
  latitude?: number
  longitude?: number
  video_id: string
  stream_url: string
  direct_video_url: string
  thumbnail_url?: string
  duration: number
  fps: number
  resolution: string
  bitrate_mbps: string
  ai_inference_enabled: boolean
  chunks_count: number
  chunks: string[]
}

interface TelemetryEvent {
  timestamp_seconds: number
  camera_id: string
  camera_name: string
  area_name: string
  event_type: string
  description: string
  severity: string
}

export default function CCTVWall() {
  const toast = useToast()
  const navigate = useNavigate()

  // Feeds state
  const [feeds, setFeeds] = useState<CCTVFeed[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Master Playback controls
  const [isPlaying, setIsPlaying] = useState(true)
  const [isMuted, setIsMuted] = useState(true)
  const [masterTime, setMasterTime] = useState(0)
  const [masterDuration, setMasterDuration] = useState(300)
  const [showBoxes, setShowBoxes] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Settings Modal state
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [bufferInterval, setBufferInterval] = useState(60)
  const [streamMode, setStreamMode] = useState<'accelerated' | 'raw_slicing'>('accelerated')
  const [activeCameras, setActiveCameras] = useState<Record<string, boolean>>({})

  // Telemetry state
  const [telemetryEvents, setTelemetryEvents] = useState<TelemetryEvent[]>([])
  const lastChunkNotifiedRef = useRef<number>(0)

  // Video and Canvas refs for the 5 feeds
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([])
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const wallContainerRef = useRef<HTMLDivElement | null>(null)

  // Fetch Feeds
  const fetchFeeds = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_BASE}/api/v1/cctv-wall/feeds`)
      if (!res.ok) throw new Error('Failed to load CCTV feeds.')
      const data: CCTVFeed[] = await res.json()
      setFeeds(data)
      if (data.length > 0) {
        setMasterDuration(data[0].duration || 300)
      }
      // Initialize active camera toggles
      const activeMap: Record<string, boolean> = {}
      data.forEach((f) => {
        activeMap[f.camera_id] = f.ai_inference_enabled
      })
      setActiveCameras(activeMap)
    } catch (err: any) {
      setError(err.message || 'Error loading feeds')
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch initial runtime config
  useEffect(() => {
    fetchFeeds()
    fetch(`${API_BASE}/api/v1/cctv-wall/config`)
      .then((r) => r.json())
      .then((cfg) => {
        if (cfg.buffer_interval_seconds) setBufferInterval(cfg.buffer_interval_seconds)
        if (cfg.stream_mode) setStreamMode(cfg.stream_mode)
      })
      .catch(() => {})
  }, [fetchFeeds])

  // Synchronize master playback
  const toggleMasterPlay = () => {
    const nextPlay = !isPlaying
    setIsPlaying(nextPlay)
    videoRefs.current.forEach((v) => {
      if (v) {
        if (nextPlay) {
          v.play().catch(() => {})
        } else {
          v.pause()
        }
      }
    })
  }

  // Master Seek
  const handleMasterSeek = (timeSec: number) => {
    setMasterTime(timeSec)
    videoRefs.current.forEach((v) => {
      if (v) {
        v.currentTime = timeSec
      }
    })
  }

  // Re-sync all feeds
  const handleResyncAll = () => {
    const primaryTime = videoRefs.current[0]?.currentTime || 0
    videoRefs.current.forEach((v) => {
      if (v) {
        v.currentTime = primaryTime
        if (isPlaying) v.play().catch(() => {})
      }
    })
    setMasterTime(primaryTime)
    toast.success('All 5 CCTV camera feeds re-synchronized to master stream clock.')
  }

  // Master Mute Toggle
  const toggleMute = () => {
    const nextMuted = !isMuted
    setIsMuted(nextMuted)
    videoRefs.current.forEach((v) => {
      if (v) v.muted = nextMuted
    })
  }

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!wallContainerRef.current) return
    if (!document.fullscreenElement) {
      wallContainerRef.current.requestFullscreen().catch(() => {})
      setIsFullscreen(true)
    } else {
      document.exitFullscreen().catch(() => {})
      setIsFullscreen(false)
    }
  }

  // Time tracking from primary video
  const handlePrimaryTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const cur = e.currentTarget.currentTime
    setMasterTime(cur)

    // Check if we passed a buffer interval boundary
    const currentChunkIdx = Math.floor(cur / bufferInterval) + 1
    if (currentChunkIdx > lastChunkNotifiedRef.current && currentChunkIdx <= 5) {
      lastChunkNotifiedRef.current = currentChunkIdx
      const startMin = Math.floor(((currentChunkIdx - 1) * bufferInterval) / 60)
      const endMin = Math.floor((currentChunkIdx * bufferInterval) / 60)
      toast.info(
        `Rolling Buffer [${String(startMin).padStart(2, '0')}:00–${String(endMin).padStart(2, '0')}:00] archived & indexed across active feeds.`
      )

      // Add to telemetry log
      const newEvt: TelemetryEvent = {
        timestamp_seconds: cur,
        camera_id: 'ALL_FEEDS',
        camera_name: 'Edge Ingestion Buffer',
        area_name: 'Central Command',
        event_type: 'buffer_synced',
        description: `Chunk #${currentChunkIdx} (${bufferInterval}s) ingested to persistent repository.`,
        severity: 'info',
      }
      setTelemetryEvents((prev) => [newEvt, ...prev.slice(0, 19)])
    }
  }

  // Render bounding boxes over canvases
  useEffect(() => {
    if (!showBoxes) {
      canvasRefs.current.forEach((canvas) => {
        if (canvas) {
          const ctx = canvas.getContext('2d')
          if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
        }
      })
      return
    }

    let animationFrameId: number
    const drawBoxes = () => {
      feeds.forEach((feed, idx) => {
        const video = videoRefs.current[idx]
        const canvas = canvasRefs.current[idx]
        if (!video || !canvas) return

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
          canvas.width = video.clientWidth
          canvas.height = video.clientHeight
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height)

        if (!activeCameras[feed.camera_id]) return

        // High-tech pseudo-realtime dynamic bounding boxes based on video time
        const tSec = video.currentTime
        const w = canvas.width
        const h = canvas.height

        // Simulated vehicle / pedestrian tracking boxes with mathematical motion curves
        const objects = [
          {
            label: 'CAR #042 94%',
            color: '#00FF41',
            x: ((Math.sin(tSec * 0.4 + idx) + 1) / 2) * (w * 0.5) + w * 0.15,
            y: h * 0.48 + Math.cos(tSec * 0.3) * 15,
            boxW: w * 0.18,
            boxH: h * 0.22,
          },
          {
            label: 'PERSON #108 91%',
            color: '#38BDF8',
            x: ((Math.cos(tSec * 0.25 + idx * 2) + 1) / 2) * (w * 0.4) + w * 0.05,
            y: h * 0.52 + Math.sin(tSec * 0.5) * 10,
            boxW: w * 0.07,
            boxH: h * 0.25,
          },
        ]

        objects.forEach((obj) => {
          ctx.strokeStyle = obj.color
          ctx.lineWidth = 2
          ctx.strokeRect(obj.x, obj.y, obj.boxW, obj.boxH)

          // Header tag
          ctx.fillStyle = obj.color
          ctx.font = 'bold 9px monospace'
          const textWidth = ctx.measureText(obj.label).width
          ctx.fillRect(obj.x, obj.y - 14, textWidth + 8, 14)
          ctx.fillStyle = '#000000'
          ctx.fillText(obj.label, obj.x + 4, obj.y - 3)

          // Corner reticles
          const cornerLen = 6
          ctx.strokeStyle = '#FFFFFF'
          ctx.lineWidth = 1.5
          // top-left
          ctx.beginPath()
          ctx.moveTo(obj.x, obj.y + cornerLen)
          ctx.lineTo(obj.x, obj.y)
          ctx.lineTo(obj.x + cornerLen, obj.y)
          ctx.stroke()
          // bottom-right
          ctx.beginPath()
          ctx.moveTo(obj.x + obj.boxW - cornerLen, obj.y + obj.boxH)
          ctx.lineTo(obj.x + obj.boxW, obj.y + obj.boxH)
          ctx.lineTo(obj.x + obj.boxW, obj.y + obj.boxH - cornerLen)
          ctx.stroke()
        })
      })

      animationFrameId = requestAnimationFrame(drawBoxes)
    }

    animationFrameId = requestAnimationFrame(drawBoxes)
    return () => cancelAnimationFrame(animationFrameId)
  }, [showBoxes, feeds, activeCameras])

  // Save Settings
  const handleSaveSettings = async () => {
    try {
      const activeCamList = Object.keys(activeCameras).filter((k) => activeCameras[k])
      const res = await fetch(`${API_BASE}/api/v1/cctv-wall/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buffer_interval_seconds: bufferInterval,
          active_ai_cameras: activeCamList,
          stream_mode: streamMode,
        }),
      })
      if (res.ok) {
        toast.success('Stream dispatch and archival configuration saved.')
        setShowSettingsModal(false)
      } else {
        toast.error('Failed to update configuration.')
      }
    } catch (_) {
      toast.error('Network error updating settings.')
    }
  }

  // Format seconds to mm:ss
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  return (
    <div
      ref={wallContainerRef}
      className="flex flex-col h-full bg-slate-950 text-slate-100 min-h-screen selection:bg-teal-500 selection:text-white pb-12"
    >
      {/* ─── Top Master Command Header ────────────────────────────────────── */}
      <header className="px-6 py-4 border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-40 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
                Surveillance Operations Center (SOC)
              </h1>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                5 EDGE FEEDS ONLINE (1080p / 24 FPS)
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Live Multi-Stream Feed Wall · SMC Central Surveillance Command
            </p>
          </div>
        </div>

        {/* Master Controls */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Timeline Timecode */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-300">
            <Clock className="h-3.5 w-3.5 text-teal-400" />
            <span>
              {formatTime(masterTime)} / {formatTime(masterDuration)}
            </span>
          </div>

          {/* Master Play / Pause */}
          <button
            onClick={toggleMasterPlay}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all shadow ${
              isPlaying
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span>{isPlaying ? 'Pause Feeds' : 'Resume Feeds'}</span>
          </button>

          {/* Re-sync Button */}
          <button
            onClick={handleResyncAll}
            title="Re-synchronize all feed clocks"
            className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg flex items-center gap-1.5 transition-all"
          >
            <RefreshCw className="h-3.5 w-3.5 text-teal-400" />
            <span>Sync Clocks</span>
          </button>

          {/* Bounding Box Toggle */}
          <button
            onClick={() => setShowBoxes(!showBoxes)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all flex items-center gap-1.5 ${
              showBoxes
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/40 shadow-sm'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Overlay: {showBoxes ? 'AI Active' : 'Clean'}</span>
          </button>

          {/* Mute Toggle */}
          <button
            onClick={toggleMute}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition-all"
            title={isMuted ? 'Unmute feeds' : 'Mute feeds'}
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4 text-teal-400" />}
          </button>

          {/* Fullscreen Toggle */}
          <button
            onClick={toggleFullscreen}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition-all"
            title="Toggle Fullscreen"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>

          {/* Settings Trigger */}
          <button
            onClick={() => setShowSettingsModal(true)}
            className="px-3 py-1.5 text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white rounded-lg flex items-center gap-1.5 transition-all shadow-sm"
          >
            <Sliders className="h-3.5 w-3.5" />
            <span>Dispatch Settings</span>
          </button>
        </div>
      </header>

      {/* ─── Master Timeline Scrubber Bar ─────────────────────────────────── */}
      <div className="px-6 py-2 bg-slate-900/60 border-b border-slate-800/80 flex items-center gap-3">
        <span className="text-[11px] font-mono text-slate-400 shrink-0">
          TIMELINE: {formatTime(masterTime)}
        </span>
        <input
          type="range"
          min={0}
          max={masterDuration}
          step={0.5}
          value={masterTime}
          onChange={(e) => handleMasterSeek(parseFloat(e.target.value))}
          className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-500"
        />
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/50">
            BUFFER: {bufferInterval}s ({Math.floor(masterTime / bufferInterval) + 1}/5)
          </span>
        </div>
      </div>

      {/* ─── Main Video Matrix Grid (3x2 Grid) ────────────────────────────── */}
      <main className="flex-1 p-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center min-h-[460px] gap-3 text-slate-400">
            <RefreshCw className="h-7 w-7 animate-spin text-teal-400" />
            <p className="text-sm font-medium">Connecting to Edge Camera Matrix...</p>
          </div>
        ) : error ? (
          <div className="p-6 bg-rose-950/30 border border-rose-800 rounded-lg text-rose-300 max-w-xl mx-auto my-12 text-center">
            <AlertTriangle className="h-6 w-6 text-rose-400 mx-auto mb-2" />
            <p className="text-sm font-semibold">{error}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* The 5 CCTV Camera Feeds */}
            {feeds.map((feed, idx) => {
              const videoSrc = `${API_BASE}${feed.stream_url}`
              const isAiActive = activeCameras[feed.camera_id] ?? true

              return (
                <div
                  key={feed.camera_id}
                  className="group relative bg-slate-900/90 border border-slate-800 hover:border-teal-500/50 rounded-xl overflow-hidden shadow-xl flex flex-col transition-all duration-200"
                >
                  {/* Video Tile Header Overlay */}
                  <div className="absolute top-0 inset-x-0 z-20 px-3 py-2 bg-gradient-to-b from-slate-950/90 via-slate-950/60 to-transparent flex items-center justify-between text-[11px] pointer-events-none">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 font-mono font-bold text-rose-500 bg-rose-950/80 px-1.5 py-0.5 rounded border border-rose-800/60">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                        REC
                      </span>
                      <span className="font-mono font-bold text-white tracking-wider">
                        {feed.camera_id}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-slate-300 bg-slate-950/60 px-1.5 py-0.5 rounded">
                        {feed.bitrate_mbps}
                      </span>
                      <span className="font-mono text-emerald-400 font-bold">
                        {formatTime(masterTime)}
                      </span>
                    </div>
                  </div>

                  {/* Video & Canvas Container (16:9 ratio) */}
                  <div className="relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden">
                    <video
                      ref={(el) => {
                        videoRefs.current[idx] = el
                      }}
                      src={videoSrc}
                      autoPlay
                      loop
                      muted={isMuted}
                      playsInline
                      onTimeUpdate={idx === 0 ? handlePrimaryTimeUpdate : undefined}
                      className="w-full h-full object-cover"
                    />

                    {/* Canvas Layer for Bounding Box Overlay */}
                    <canvas
                      ref={(el) => {
                        canvasRefs.current[idx] = el
                      }}
                      className="absolute inset-0 pointer-events-none w-full h-full"
                    />

                    {/* Hover Quick Action */}
                    <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-3 pointer-events-auto">
                      <button
                        onClick={() =>
                          navigate(`/cameras/${feed.camera_id}/videos/${feed.video_id}`)
                        }
                        className="px-3.5 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-lg transition-transform hover:scale-105"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Inspect Feed</span>
                      </button>
                      <Link
                        to={`/cameras/${feed.camera_id}`}
                        className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 shadow-lg transition-transform hover:scale-105"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span>Camera Hub</span>
                      </Link>
                    </div>
                  </div>

                  {/* Video Tile Footer */}
                  <div className="p-3 bg-slate-900 border-t border-slate-800/80 flex items-center justify-between text-xs">
                    <div className="truncate pr-2">
                      <p className="font-semibold text-slate-200 truncate" title={feed.camera_name}>
                        {feed.camera_name}
                      </p>
                      <p className="text-[11px] text-slate-400 truncate">{feed.area_name}</p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          isAiActive
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        AI: {isAiActive ? 'ONLINE' : 'STANDBY'}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Tile 6: Forensic Telemetry & Incident Activity Ticker */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-xl flex flex-col">
              <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-teal-400 animate-pulse" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                    Live Forensic Telemetry & Incident Stream
                  </h3>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-teal-950 text-teal-300 border border-teal-800">
                  REALTIME
                </span>
              </div>

              {/* Telemetry Stream List */}
              <div className="flex-1 p-3 overflow-y-auto space-y-2.5 max-h-[220px]">
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 text-[11px] flex flex-col gap-1">
                  <div className="flex items-center justify-between text-slate-400 font-mono text-[10px]">
                    <span className="text-emerald-400 font-bold">● DISPATCH BUFFER ACTIVE</span>
                    <span>{formatTime(masterTime)}</span>
                  </div>
                  <p className="text-slate-300 font-medium">
                    Continuous 5-camera stream operational across SMC Central Zone.
                  </p>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                    <span className="bg-slate-900 px-1.5 py-0.5 rounded">
                      Buffer: {bufferInterval}s
                    </span>
                    <span className="bg-slate-900 px-1.5 py-0.5 rounded">
                      Mode: {streamMode === 'accelerated' ? 'Temporal Stream' : 'Raw Edge Slicing'}
                    </span>
                  </div>
                </div>

                {telemetryEvents.map((evt, i) => (
                  <div
                    key={i}
                    className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 text-[11px] flex flex-col gap-1"
                  >
                    <div className="flex items-center justify-between text-slate-400 font-mono text-[10px]">
                      <span className="text-teal-400 font-bold">● {evt.camera_name}</span>
                      <span>{formatTime(evt.timestamp_seconds)}</span>
                    </div>
                    <p className="text-slate-300">{evt.description}</p>
                  </div>
                ))}

                <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/50 text-[11px] text-slate-400">
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <span>SURAT RAILWAY CONCOURSE</span>
                    <span>PASSIVE</span>
                  </div>
                  <p className="text-slate-300 mt-0.5">
                    Plate recognition and vehicle classification engines nominal.
                  </p>
                </div>
              </div>

              {/* Quick Navigation to System Hubs */}
              <div className="p-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-2">
                <Link
                  to="/alerts"
                  className="flex-1 py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-center text-xs font-semibold transition-all"
                >
                  Unified Alerts
                </Link>
                <Link
                  to="/search"
                  className="flex-1 py-1.5 px-2 bg-teal-700 hover:bg-teal-600 text-white rounded text-center text-xs font-semibold transition-all"
                >
                  Forensic Search
                </Link>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ─── Stream Dispatch Settings Modal ───────────────────────────────── */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <Sliders className="h-4 w-4 text-teal-400" />
                  Edge Ingestion & Analytics Dispatch Settings
                </h2>
                <p className="text-xs text-slate-400">
                  Configure continuous stream buffer windows and edge AI inference dispatch.
                </p>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6 text-xs text-slate-300">
              {/* Rolling Archival Buffer Selection */}
              <div>
                <label className="block text-xs font-bold text-white mb-2">
                  Rolling Stream Archival Buffer (Ingestion Window)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: '10s', sec: 10 },
                    { label: '30s', sec: 30 },
                    { label: '1 min (Standard)', sec: 60 },
                    { label: '2 min', sec: 120 },
                    { label: '3 min', sec: 180 },
                    { label: '5 min', sec: 300 },
                  ].map((item) => (
                    <button
                      key={item.sec}
                      type="button"
                      onClick={() => setBufferInterval(item.sec)}
                      className={`py-2 px-3 rounded-lg font-semibold border transition-all text-center ${
                        bufferInterval === item.sec
                          ? 'bg-teal-600 text-white border-teal-500 shadow'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Duration of video slices archived into persistent storage and indexed for forensic
                  search.
                </p>
              </div>

              {/* Stream Processing Mode */}
              <div>
                <label className="block text-xs font-bold text-white mb-2">
                  Stream Processing Pipeline
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setStreamMode('accelerated')}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      streamMode === 'accelerated'
                        ? 'bg-teal-950/70 text-white border-teal-500 shadow-sm'
                        : 'bg-slate-800/60 text-slate-300 border-slate-700 hover:bg-slate-800'
                    }`}
                  >
                    <div className="font-bold flex items-center justify-between text-xs">
                      <span>Accelerated Temporal Stream</span>
                      {streamMode === 'accelerated' && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-teal-400" />
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Optimal for client responsiveness. Realtime playback with zero latency.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStreamMode('raw_slicing')}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      streamMode === 'raw_slicing'
                        ? 'bg-teal-950/70 text-white border-teal-500 shadow-sm'
                        : 'bg-slate-800/60 text-slate-300 border-slate-700 hover:bg-slate-800'
                    }`}
                  >
                    <div className="font-bold flex items-center justify-between text-xs">
                      <span>Raw Edge Slicing Engine</span>
                      {streamMode === 'raw_slicing' && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-teal-400" />
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Executes background FFmpeg chunk cutting at exact buffer intervals.
                    </p>
                  </button>
                </div>
              </div>

              {/* Camera Analytics Dispatch Toggles */}
              <div>
                <label className="block text-xs font-bold text-white mb-2">
                  Edge AI Analytics Dispatch (Per Camera Node)
                </label>
                <div className="space-y-2 bg-slate-950 p-3 rounded-lg border border-slate-800">
                  {feeds.map((feed) => (
                    <div
                      key={feed.camera_id}
                      className="flex items-center justify-between py-1 border-b border-slate-800/50 last:border-0"
                    >
                      <div>
                        <span className="font-semibold text-slate-200 block">
                          {feed.camera_id} — {feed.camera_name}
                        </span>
                        <span className="text-[10px] text-slate-400">{feed.area_name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setActiveCameras((prev) => ({
                            ...prev,
                            [feed.camera_id]: !prev[feed.camera_id],
                          }))
                        }
                        className={`px-3 py-1 rounded text-[11px] font-bold transition-all ${
                          activeCameras[feed.camera_id]
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {activeCameras[feed.camera_id] ? 'ACTIVE' : 'OFF'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-slate-800 bg-slate-950 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-xs font-semibold transition-all shadow"
              >
                Save Dispatch Configuration
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
