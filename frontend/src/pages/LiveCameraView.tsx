import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Square, Activity, Info, QrCode, Copy, Check, RefreshCw, ExternalLink, Film } from 'lucide-react'

import { API_BASE } from '../config/api'
import { formatDisplayDate } from '../utils/dateFormatter'
import { classColor } from '../utils/colors'

const WS_BASE = typeof window !== 'undefined' ? `ws://${window.location.hostname}:8000/api/v1/stream` : 'ws://localhost:8000/api/v1/stream'

function getClassColor(cls: string): string {
  return classColor(cls)
}

const SKELETON_CONNECTIONS = [
  [0, 1], [0, 2], [1, 3], [2, 4],  // head
  [5, 6], [5, 7], [6, 8], [7, 9], [8, 10],  // arms  
  [5, 11], [6, 12], [11, 12],  // torso
  [11, 13], [12, 14], [13, 15], [14, 16]  // legs
]

export default function LiveCameraView() {
  const { camera_id } = useParams()
  const navigate = useNavigate()
  
  const [camera, setCamera] = useState<any>(null)
  const [streamStatus, setStreamStatus] = useState<any>(null)
  const [viewTab, setViewTab] = useState<'annotated' | 'raw'>('annotated')
  const [duration, setDuration] = useState(0)
  // Tracks whether the <video> element is actually producing frames.
  // We gate the "Stream Offline" overlay on this independently of the API
  // so a transient/stale backend status doesn't cause a false offline flash.
  const [videoPlaying, setVideoPlaying] = useState(false)
  
  const [latestDetections, setLatestDetections] = useState<any>(null)
  const [telemetryHistory, setTelemetryHistory] = useState({
    fps: [] as number[],
    inference: [] as number[],
    latency: [] as number[]
  })
  
  const [alerts, setAlerts] = useState<any[]>([])
  
  // Customizable Chunk Duration & Pipeline Logs State
  const [chunkDurationSec, setChunkDurationSec] = useState<number>(30) // default 30s for demo
  const [autoImport, setAutoImport] = useState<boolean>(true) // check recorded chunks into the archive + full pipeline
  const [cameraAppUrl, setCameraAppUrl] = useState<string>(`${window.location.protocol}//${window.location.hostname}:8000/camera-app`)
  const [cameraAppSecure, setCameraAppSecure] = useState<boolean>(false)
  const whepRetryRef = useRef<any>(null)
  const [pipelineLogs, setPipelineLogs] = useState<any[]>([])

  // Pair Code State
  const [pairCode, setPairCode] = useState<string | null>(null)
  const [pairLoading, setPairLoading] = useState(false)
  const [pairSecondsLeft, setPairSecondsLeft] = useState(0)
  const [copiedCode, setCopiedCode] = useState(false)
  const pairCountdownRef = useRef<any>(null)
  
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const latestDetectionsRef = useRef<any>(null)
  const rafRef = useRef<number>(0)
  const durationTimerRef = useRef<any>(null)
  const statusPollRef = useRef<any>(null)
  const streamStartedAtRef = useRef<number | null>(null)
  const isMounted = useRef(true)

  useEffect(() => {
    // React StrictMode mounts, unmounts and re-mounts in development. cleanup() flips this to false on
    // the unmount, so it must be re-armed here or the WebRTC player silently never starts (boxes without video).
    isMounted.current = true
    fetch(`${API_BASE}/api/v1/cameras`)
      .then(r => r.json())
      .then(data => {
        const cam = data.find((c: any) => c.camera_id === camera_id)
        if (cam) setCamera(cam)
      })
      .catch(() => {})

    const parseIsoUtc = (str?: string) => {
      if (!str) return Date.now()
      const s = str.endsWith('Z') || str.includes('+') ? str : str + 'Z'
      const t = new Date(s).getTime()
      return isNaN(t) ? Date.now() : t
    }

    const pollStatus = () => {
      fetch(`${API_BASE}/api/v1/stream/status/${camera_id}`)
        .then(r => r.json())
        .then(data => {
          setStreamStatus(data)
          const isLive = data.is_streaming === true || data.status === 'streaming'
          if (isLive && streamStartedAtRef.current === null) {
            streamStartedAtRef.current = data.started_at
              ? parseIsoUtc(data.started_at)
              : Date.now()
            if (durationTimerRef.current) clearInterval(durationTimerRef.current)
            durationTimerRef.current = setInterval(() => {
              const elapsed = Math.max(0, Math.floor((Date.now() - streamStartedAtRef.current!) / 1000))
              setDuration(elapsed)
            }, 1000)
          }
        })
        .catch(() => {})
    }

    pollStatus()
    statusPollRef.current = setInterval(pollStatus, 5000)

    // Where a phone should open the edge camera app (HTTPS LAN URL when the backend runs via serve.py)
    fetch(`${API_BASE}/api/v1/stream/access-urls`)
      .then(r => r.json())
      .then(d => { if (d?.recommended) { setCameraAppUrl(d.recommended); setCameraAppSecure(!!d.https_available) } })
      .catch(() => {})

    // Generate initial pair code for camera
    generatePairCode()

    return () => {
      if (statusPollRef.current) clearInterval(statusPollRef.current)
      if (pairCountdownRef.current) clearInterval(pairCountdownRef.current)
      cleanup()
    }
  }, [camera_id])

  useEffect(() => {
    if (camera?.camera_id) {
      startWhep(camera.camera_id)
      initWebSocket(camera.camera_id)
    }
  }, [camera])

  // Keep trying to attach to the WebRTC feed: the phone may start publishing after this page opened,
  // and MediaMTX may restart. Stops retrying once the component unmounts.
  const scheduleWhepRetry = (streamKey: string, delayMs = 4000) => {
    if (!isMounted.current) return
    if (whepRetryRef.current) clearTimeout(whepRetryRef.current)
    whepRetryRef.current = setTimeout(() => startWhep(streamKey), delayMs)
  }

  const startWhep = (streamKey: string) => {
    if (!isMounted.current) return
    if (pcRef.current && (pcRef.current.connectionState === 'connected' || pcRef.current.connectionState === 'connecting')) return
    if (pcRef.current) { try { pcRef.current.close() } catch { /* ignore */ } pcRef.current = null }
    initWhep(streamKey)
  }

  // Video element event listeners — track real playback state
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onPlaying = () => {
      setVideoPlaying(true)
      // Fallback: start duration timer if the status poll hasn't kicked it off yet
      if (streamStartedAtRef.current === null) {
        streamStartedAtRef.current = Date.now()
        if (durationTimerRef.current) clearInterval(durationTimerRef.current)
        durationTimerRef.current = setInterval(() => {
          setDuration(Math.max(0, Math.floor((Date.now() - streamStartedAtRef.current!) / 1000)))
        }, 1000)
      }
    }
    const onWaiting = () => setVideoPlaying(false)
    const onStalled = () => setVideoPlaying(false)
    const onEnded  = () => setVideoPlaying(false)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('stalled', onStalled)
    video.addEventListener('ended',   onEnded)
    return () => {
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('stalled', onStalled)
      video.removeEventListener('ended',   onEnded)
    }
  }, [])

  const cleanup = () => {
    isMounted.current = false
    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    if (whepRetryRef.current) clearTimeout(whepRetryRef.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (durationTimerRef.current) clearInterval(durationTimerRef.current)
    if (pairCountdownRef.current) clearInterval(pairCountdownRef.current)
    if (videoRef.current) videoRef.current.srcObject = null
    streamStartedAtRef.current = null
  }

  const generatePairCode = async () => {
    if (!camera_id) return
    setPairLoading(true)
    if (pairCountdownRef.current) clearInterval(pairCountdownRef.current)
    try {
      const res = await fetch(`${API_BASE}/api/v1/stream/pair/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          camera_id,
          config: {
            max_chunk_duration_sec: chunkDurationSec,
            auto_import_chunks: autoImport,
            live_detector: 'vehicle',
            live_alert_rules: false
          }
        })
      })
      if (!res.ok) throw new Error('Failed to generate pair code')
      const data = await res.json()
      setPairCode(data.code)
      const expiresAt = new Date(data.expires_at)
      const calcSecs = () => Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
      setPairSecondsLeft(calcSecs())
      pairCountdownRef.current = setInterval(() => {
        const s = calcSecs()
        setPairSecondsLeft(s)
        if (s <= 0) clearInterval(pairCountdownRef.current)
      }, 1000)
    } catch (err) {
      console.error('Failed to generate pair code:', err)
    } finally {
      setPairLoading(false)
    }
  }

  const copyPairCode = () => {
    if (!pairCode) return
    navigator.clipboard.writeText(pairCode)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
  }

  const initWhep = async (streamKey: string) => {
    try {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      })
      pcRef.current = pc
      pc.addTransceiver('video', { direction: 'recvonly' })
      
      pc.ontrack = (e) => {
        if (videoRef.current) {
          videoRef.current.srcObject = e.streams[0]
          // Force play — some browsers suppress autoPlay on programmatic MediaStream assignment
          videoRef.current.play().catch(() => {})
        }
      }

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
          setVideoPlaying(false)
          if (pcRef.current === pc) { pcRef.current = null; scheduleWhepRetry(streamKey) }
        }
      }
      
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      
      // Signalling is proxied through the backend (same origin as the API; HTTPS-safe for phones)
      const whepUrl = `${API_BASE}/api/v1/stream/whep/${streamKey}`
      const res = await fetch(whepUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer.sdp
      })
      
      // Superseded by a newer attempt (e.g. React StrictMode re-running the effect) or closed meanwhile: stop quietly
      if (pcRef.current !== pc || pc.signalingState === 'closed') return
      if (res.ok) {
        const answerSdp = await res.text()
        if (pcRef.current !== pc || (pc.connectionState as string) === 'closed') return
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
      } else {
        // 404 = nobody is publishing yet; try again shortly
        pc.close(); if (pcRef.current === pc) pcRef.current = null
        scheduleWhepRetry(streamKey)
      }
    } catch (err) {
      console.error("WHEP error:", err)
      scheduleWhepRetry(streamKey, 5000)
    }
  }

  const initWebSocket = (camId: string) => {
    const url = `${WS_BASE}/ws/stream/${camId}`
    console.log('[WebSocket] Connecting to:', url)
    const ws = new WebSocket(url)
    wsRef.current = ws
    
    ws.onopen = () => console.log('[WebSocket] Connected for', camId)
    ws.onerror = (err) => console.error('[WebSocket] Error:', err)
    
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)

        if (data.type === 'pipeline_log' && data.log) {
          setPipelineLogs(prev => [data.log, ...prev].slice(0, 50))
          return
        }

        latestDetectionsRef.current = data
        setLatestDetections(data)
        
        setTelemetryHistory(prev => {
          const keep = 60
          return {
            fps: [...prev.fps, data.fps || 0].slice(-keep),
            inference: [...prev.inference, data.inference_ms || 0].slice(-keep),
            latency: [...prev.latency, data.e2e_latency_ms || 0].slice(-keep)
          }
        })
        
        if (data.alerts && data.alerts.length > 0) {
          setAlerts(prev => {
            const newAlerts = data.alerts.map((a: any) => ({ ...a, id: Math.random().toString(), timestamp: new Date() }))
            return [...newAlerts, ...prev].slice(0, 50)
          })
        }
      } catch (err) {}
    }
    
    ws.onclose = () => {
      // Only reconnect if this WS is still the current one (not superseded by
      // a newer call to initWebSocket) and the component hasn't unmounted.
      setTimeout(() => {
        if (isMounted.current && wsRef.current === ws) {
          initWebSocket(camId)
        }
      }, 2000)
    }
    
    startRenderLoop()
  }

  const startRenderLoop = () => {
    const render = () => {
      drawCanvas()
      rafRef.current = requestAnimationFrame(render)
    }
    rafRef.current = requestAnimationFrame(render)
  }

  const drawCanvas = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const data = latestDetectionsRef.current
    
    if (!video || !canvas || viewTab !== 'annotated') return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    const cWidth = video.clientWidth
    const cHeight = video.clientHeight
    if (canvas.width !== cWidth || canvas.height !== cHeight) {
      canvas.width = cWidth
      canvas.height = cHeight
    }
    
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cWidth, cHeight)
    if (!data || !data.detections) return
    const vWidth = video.videoWidth || 1280
    const vHeight = video.videoHeight || 720
    // The <video> is object-contain: map boxes into the letterboxed content area, not the whole element
    const s = Math.min(cWidth / vWidth, cHeight / vHeight)
    const scaleX = s
    const scaleY = s
    ctx.translate((cWidth - vWidth * s) / 2, (cHeight - vHeight * s) / 2)
    
    data.detections.forEach((det: any) => {
      const color = getClassColor(det.class || det.class_name || 'unknown')
      const [x1, y1, x2, y2] = det.bbox
      
      const cx1 = x1 * scaleX
      const cy1 = y1 * scaleY
      const cw = (x2 - x1) * scaleX
      const ch = (y2 - y1) * scaleY
      
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.strokeRect(cx1, cy1, cw, ch)
      
      const label = `${det.class || det.class_name} ${det.tracker_id ? '#' + det.tracker_id : ''} ${Math.round((det.confidence || 0) * 100)}%`
      ctx.font = 'bold 12px monospace'
      const tw = ctx.measureText(label).width
      ctx.fillStyle = color
      ctx.fillRect(cx1, cy1 - 18, tw + 8, 18)
      ctx.fillStyle = '#000'
      ctx.fillText(label, cx1 + 4, cy1 - 5)
      
      if (det.keypoints) {
        ctx.fillStyle = color
        det.keypoints.forEach((kp: number[]) => {
          if (kp[2] > 0.3) {
            ctx.beginPath()
            ctx.arc(kp[0] * scaleX, kp[1] * scaleY, 3, 0, 2 * Math.PI)
            ctx.fill()
          }
        })
        
        ctx.lineWidth = 2
        SKELETON_CONNECTIONS.forEach(([i, j]) => {
          const kp1 = det.keypoints[i]
          const kp2 = det.keypoints[j]
          if (kp1 && kp2 && kp1[2] > 0.3 && kp2[2] > 0.3) {
            ctx.beginPath()
            ctx.moveTo(kp1[0] * scaleX, kp1[1] * scaleY)
            ctx.lineTo(kp2[0] * scaleX, kp2[1] * scaleY)
            ctx.stroke()
          }
        })
      }
    })
  }, [viewTab])

  const handleDisconnect = async () => {
    if (confirm('End this live stream?')) {
      try {
        await fetch(`${API_BASE}/api/v1/stream/stop/${camera_id}`, { method: 'POST' })
        navigate('/cameras')
      } catch (err) {
        console.error(err)
      }
    }
  }

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00'
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = Math.floor(secs % 60)
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    }
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  // Pure SVG sparkline — renders reliably at any height with no init overhead
  const Sparkline = ({ data, color }: { data: number[], color: string }) => {
    if (data.length < 2) {
      return <svg width="100%" height="100%" style={{ display: 'block' }}>
        <line x1="0" y1="50%" x2="100%" y2="50%" stroke={color} strokeWidth="1.5" strokeOpacity="0.3" />
      </svg>
    }
    const W = 200, H = 32
    const min = Math.min(...data)
    const max = Math.max(...data)
    const range = max - min || 1
    const pts = data.map((v, i) => {
      const x = (i / (data.length - 1)) * W
      const y = H - ((v - min) / range) * (H - 4) - 2
      return `${x},${y}`
    })
    const polyline = pts.join(' ')
    // Area fill polygon: close path along bottom
    const area = `${pts[0].split(',')[0]},${H} ` + polyline + ` ${pts[pts.length-1].split(',')[0]},${H}`
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none" style={{ display: 'block' }}>
        <defs>
          <linearGradient id={`sg-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#sg-${color.replace('#','')})`} />
        <polyline points={polyline} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-60px)] animate-in fade-in">
      {/* Top Bar */}
      <div className="flex items-center justify-between bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 p-3 rounded-md shadow-sm shrink-0 mb-4">
        <div className="flex items-center gap-4">
          <Link to="/cameras" className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1 text-sm font-medium">
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
          <div className="h-6 w-px bg-slate-200 dark:bg-slate-700"></div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">{camera?.name || 'Loading...'}</h1>
            <span className="text-[10px] font-mono text-slate-500 bg-slate-100 dark:bg-slate-900 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-800">
              {camera?.camera_id}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 px-2 py-0.5 rounded-full ml-2">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse"></span>
              LIVE
            </span>
            <span className="font-mono text-sm font-bold text-slate-600 dark:text-slate-400 ml-4">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* Pairing Code Quick Badge */}
        <div className="flex items-center gap-2 bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800/60 px-3 py-1 rounded-md">
          <QrCode className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
          <div className="flex flex-col">
            <span className="text-[9px] font-bold text-teal-700 dark:text-teal-400 uppercase tracking-wider">Pair Code</span>
            <span className="font-mono text-xs font-black text-slate-900 dark:text-slate-100">{pairCode || '---'}</span>
          </div>
          <button
            onClick={copyPairCode}
            className="p-1 text-slate-500 hover:text-teal-600 dark:hover:text-teal-300 transition-colors ml-1"
            title="Copy Pair Code"
          >
            {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={generatePairCode}
            disabled={pairLoading}
            className="p-1 text-slate-500 hover:text-teal-600 dark:hover:text-teal-300 transition-colors"
            title="Generate New Pair Code"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${pairLoading ? 'animate-spin' : ''}`} />
          </button>
          <button 
            onClick={handleDisconnect}
            className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded text-xs font-bold transition-colors shadow-sm ml-2"
          >
            <Square className="w-3.5 h-3.5 fill-current" /> Disconnect
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 grid md:grid-cols-[1fr_350px] gap-4 min-h-0">
        
        {/* Left Col - Video */}
        <div className="flex flex-col bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden shadow-sm">
          <div className="flex bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
            <button
              onClick={() => setViewTab('annotated')}
              className={`flex-1 py-2 text-xs font-bold transition-colors ${viewTab === 'annotated' ? 'text-teal-700 dark:text-teal-400 border-b-2 border-teal-600 dark:border-teal-400 bg-white dark:bg-slate-850' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            >
              Annotated Overlay
            </button>
            <button
              onClick={() => setViewTab('raw')}
              className={`flex-1 py-2 text-xs font-bold transition-colors ${viewTab === 'raw' ? 'text-teal-700 dark:text-teal-400 border-b-2 border-teal-600 dark:border-teal-400 bg-white dark:bg-slate-850' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            >
              Raw WHEP Feed
            </button>
          </div>
          
          <div className="flex-1 relative bg-black flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-contain"
            />
            {viewTab === 'annotated' && (
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none"
              />
            )}
            {/* Only show the Offline overlay when:
                1. We have a confirmed API response (streamStatus !== null)
                2. The backend says the stream is stopped
                3. The <video> element itself isn't producing any frames
                This prevents false flashes when the status fetch races with MediaMTX
                or when the backend in-memory dict is reset while the camera keeps streaming. */}
            {streamStatus !== null && streamStatus.is_streaming === false && !videoPlaying && (
              <div className="absolute inset-0 bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center text-slate-900 dark:text-slate-100 z-10 p-6">
                <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 p-6 rounded-md text-center max-w-md shadow-sm flex flex-col items-center">
                  <div className="w-12 h-12 rounded-full bg-teal-50 dark:bg-teal-500/15 text-teal-700 dark:text-teal-400 flex items-center justify-center mb-3 border border-teal-200 dark:border-teal-500/30">
                    <QrCode className="w-6 h-6" />
                  </div>
                  <h3 className="font-semibold text-lg text-slate-900 dark:text-slate-100">Stream Offline</h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 mb-4 leading-relaxed">
                    Connect your mobile or edge camera at <a href={cameraAppUrl} target="_blank" rel="noreferrer" className="text-teal-700 dark:text-teal-400 underline font-mono">{cameraAppUrl.replace(/^https?:\/\//, '')}</a> using this active pair code:
                  </p>
                  
                  <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-950 px-5 py-3 rounded-md border border-teal-300 dark:border-teal-500/40 mb-4">
                    <span className="font-mono text-2xl tracking-widest font-bold text-teal-700 dark:text-teal-400">
                      {pairCode || '------'}
                    </span>
                    <button
                      onClick={copyPairCode}
                      className="p-2 rounded bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
                      title="Copy Code"
                    >
                      {copiedCode ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>

                  {pairSecondsLeft > 0 && (
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 mb-4 font-mono">
                      Code valid for {Math.floor(pairSecondsLeft / 60)}m {pairSecondsLeft % 60}s
                    </div>
                  )}

                  <label className="flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-300 mb-3 cursor-pointer select-none">
                    <input type="checkbox" checked={autoImport} onChange={e => { setAutoImport(e.target.checked) }} className="accent-teal-600" />
                    Check {chunkDurationSec}s chunks into this camera's archive and run the full pipeline
                  </label>
                  {!cameraAppSecure && (
                    <div className="text-[10px] text-amber-700 dark:text-amber-300/90 mb-3 max-w-xs leading-relaxed">
                      Phones need HTTPS for camera access. Start the backend with <span className="font-mono">python serve.py</span> to get an https:// link here.
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap justify-center">
                    <button
                      onClick={generatePairCode}
                      disabled={pairLoading}
                      className="text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded transition-colors"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${pairLoading ? 'animate-spin' : ''}`} />
                      New Code
                    </button>
                    <a
                      href={cameraAppUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-white flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 px-3 py-1.5 rounded transition-colors"
                    >
                      Open Mobile App <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Col - Telemetry */}
        <div className="flex flex-col gap-4 min-h-0">
          
          {/* Telemetry Cards */}
          <div className="grid grid-cols-3 gap-2 shrink-0">
            <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-md p-2">
              <div className="text-[10px] font-bold text-slate-500 uppercase">Inference</div>
              <div className="font-mono text-sm font-bold text-slate-800 dark:text-slate-200">
                {latestDetections?.inference_ms ? latestDetections.inference_ms.toFixed(1) : 0}ms
              </div>
              <div className="h-8 mt-1">
                <Sparkline data={telemetryHistory.inference} color="#0f766e" />
              </div>
            </div>
            <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-md p-2">
              <div className="text-[10px] font-bold text-slate-500 uppercase">Pipeline FPS</div>
              <div className="font-mono text-sm font-bold text-slate-800 dark:text-slate-200">
                {latestDetections?.fps ? latestDetections.fps.toFixed(1) : 0}
              </div>
              <div className="h-8 mt-1">
                <Sparkline data={telemetryHistory.fps} color="#3b82f6" />
              </div>
            </div>
            <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-md p-2">
              <div className="text-[10px] font-bold text-slate-500 uppercase">E2E Latency</div>
              <div className="font-mono text-sm font-bold text-slate-800 dark:text-slate-200">
                {latestDetections?.e2e_latency_ms ? latestDetections.e2e_latency_ms.toFixed(1) : 0}ms
              </div>
              <div className="h-8 mt-1">
                <Sparkline data={telemetryHistory.latency} color="#f59e0b" />
              </div>
            </div>
          </div>

          {/* Alert Feed */}
          <div className="flex-1 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-md flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900 shrink-0">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" /> Live Alerts
              </span>
              <span className="text-[10px] font-mono bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-400">{alerts.length} events</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {alerts.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-400 italic">No alerts triggered yet</div>
              ) : (
                alerts.map(a => (
                  <div key={a.id} className={`p-2 rounded border text-xs ${a.severity === 'HIGH' ? 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900' : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900'}`}>
                    <div className="flex justify-between font-bold mb-1">
                      <span className={a.severity === 'HIGH' ? 'text-rose-700 dark:text-rose-400' : 'text-amber-700 dark:text-amber-400'}>
                        {a.type}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">{formatDisplayDate(a.timestamp)}</span>
                    </div>
                    <div className="text-slate-700 dark:text-slate-300">{a.description}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Info Panel */}
          <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-md p-3 shrink-0">
            <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mb-2">
              <Info className="w-3.5 h-3.5" /> Session Details
            </h3>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between border-b border-slate-100 dark:border-slate-800/50 pb-1">
                <span className="text-slate-500">Session ID</span>
                <span className="font-mono text-slate-800 dark:text-slate-200">{streamStatus?.session_id ? streamStatus.session_id.substring(0,8) : '---'}</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 dark:border-slate-800/50 pb-1">
                <span className="text-slate-500">Live detector</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 font-mono text-[11px]">
                  {latestDetections?.model || (streamStatus?.config?.live_detector === 'camera' ? 'camera model' : 'vehicle_detector.pt')}
                </span>
              </div>
              <div className="flex justify-between border-b border-slate-100 dark:border-slate-800/50 pb-1">
                <span className="text-slate-500">Live scope</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 text-right">
                  detection + tracking only
                  <span className="block text-[10px] font-normal text-slate-500">analytics run at chunk check-in</span>
                </span>
              </div>
              <div className="flex justify-between border-b border-slate-100 dark:border-slate-800/50 pb-1">
                <span className="text-slate-500">Pose Estimation</span>
                <span className={`font-bold ${streamStatus?.config?.enable_pose ? 'text-teal-600 dark:text-teal-400' : 'text-slate-400'}`}>{streamStatus?.config?.enable_pose ? 'ON' : 'OFF'}</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 dark:border-slate-800/50 pb-1">
                <span className="text-slate-500">Archive chunks</span>
                <span className={`font-bold ${streamStatus?.config?.auto_import_chunks ? 'text-teal-600 dark:text-teal-400' : 'text-slate-400'}`}>{streamStatus?.config?.auto_import_chunks ? 'ON · full pipeline' : 'OFF'}</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 dark:border-slate-800/50 pb-1 items-center">
                <span className="text-slate-500">Chunk Length</span>
                <select
                  value={chunkDurationSec}
                  disabled={videoPlaying || streamStatus?.is_streaming === true}
                  onChange={(e) => setChunkDurationSec(Number(e.target.value))}
                  title={videoPlaying || streamStatus?.is_streaming ? "Chunk length cannot be changed while live stream is active" : "Select chunk length for stream recording"}
                  className="font-mono text-xs font-bold text-teal-600 dark:text-teal-400 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-1.5 py-0.5 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value={15}>15 sec (Test)</option>
                  <option value={30}>30 sec (Demo Default)</option>
                  <option value={60}>1 min (60s)</option>
                  <option value={120}>2 min (120s)</option>
                  <option value={300}>5 min (300s)</option>
                  <option value={900}>15 min (900s)</option>
                  <option value={1800}>30 min (1800s)</option>
                </select>
              </div>
              <div className="flex justify-between border-b border-slate-100 dark:border-slate-800/50 pb-1">
                <span className="text-slate-500">Chunks Recorded</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{streamStatus?.chunks_recorded ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Total Alerts</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{streamStatus?.telemetry?.alert_count || alerts.length}</span>
              </div>
            </div>

            {/* Camera Pair Code Widget in Session Details */}
            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded p-2.5 mt-3">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                  <QrCode className="w-3 h-3 text-teal-600 dark:text-teal-400" /> Camera Pair Code
                </span>
                <button
                  onClick={generatePairCode}
                  disabled={pairLoading}
                  className="text-[10px] text-teal-600 dark:text-teal-400 font-bold hover:underline flex items-center gap-0.5"
                >
                  <RefreshCw className={`w-2.5 h-2.5 ${pairLoading ? 'animate-spin' : ''}`} /> New Code
                </button>
              </div>
              <div className="flex items-center justify-between bg-white dark:bg-slate-950 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800">
                <span className="font-mono text-sm font-black tracking-wider text-teal-600 dark:text-teal-400">
                  {pairCode || '---'}
                </span>
                <button
                  onClick={copyPairCode}
                  className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:text-teal-600 flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800"
                >
                  {copiedCode ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  {copiedCode ? 'Copied' : 'Copy'}
                </button>
              </div>
              {pairSecondsLeft > 0 && (
                <div className="text-[9px] text-slate-400 mt-1 text-right font-mono">
                  Expires in {Math.floor(pairSecondsLeft / 60)}m {pairSecondsLeft % 60}s
                </div>
              )}
            </div>
          </div>

          {/* Recording Pipeline Logs Panel */}
          <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-md flex flex-col h-44 shrink-0 overflow-hidden">
            <div className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900 shrink-0">
              <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" /> Live Pipeline Logs
              </span>
              <span className="text-[9px] font-mono bg-teal-500/10 text-teal-700 dark:text-teal-400 px-1.5 py-0.5 rounded border border-teal-500/20 font-bold">
                {pipelineLogs.length} events
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 text-[11px] font-mono flex flex-col-reverse">
              {pipelineLogs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 italic space-y-1">
                  <span className="text-[10px]">Waiting for video chunk pre-processing…</span>
                  <span className="text-[9px] text-slate-500 font-sans">Chunk length set to {chunkDurationSec < 60 ? `${chunkDurationSec}s` : `${Math.floor(chunkDurationSec / 60)} min`}</span>
                </div>
              ) : (
                pipelineLogs.map((log, idx) => (
                  <div key={idx} className="p-1.5 rounded bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 flex items-start gap-2 animate-in fade-in duration-150">
                    <span className="text-[9px] text-slate-400 shrink-0 mt-0.5">{log.timestamp}</span>
                    <span className={`text-[9px] font-bold px-1 rounded uppercase shrink-0 ${
                      log.stage === 'recorded' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' :
                      log.stage === 'preprocessing' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 animate-pulse' :
                      log.stage === 'preprocessed' ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400' :
                      log.stage === 'indexing' ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 animate-pulse' :
                      log.stage === 'db_saved' ? 'bg-teal-500/10 text-teal-600 dark:text-teal-400' :
                      log.stage === 'complete' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-black' :
                      'bg-slate-500/10 text-slate-600 dark:text-slate-400'
                    }`}>
                      {log.stage}
                    </span>
                    {log.progress !== undefined && log.progress > 0 && (
                      <span className="text-[9px] font-bold text-teal-600 dark:text-teal-400 shrink-0">
                        {log.progress}%
                      </span>
                    )}
                    <span className="text-slate-700 dark:text-slate-300 flex-1 leading-snug">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
