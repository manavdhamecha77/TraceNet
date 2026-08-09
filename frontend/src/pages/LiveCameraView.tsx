import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Square, Activity, AlertTriangle, Info } from 'lucide-react'
import ReactECharts from 'echarts-for-react'

const API_BASE = typeof window !== 'undefined' ? `http://${window.location.hostname}:8000` : 'http://localhost:8000'
const WS_BASE = typeof window !== 'undefined' ? `ws://${window.location.hostname}:8000` : 'ws://localhost:8000'

const CLASS_COLORS: Record<string, string> = {
  person: '#22d3ee', vehicle: '#f97316', car: '#f97316',
  theft: '#ef4444', assault: '#dc2626', fight: '#dc2626',
  thief: '#ef4444', victim: '#eab308',
}

function getClassColor(cls: string): string {
  return CLASS_COLORS[cls.toLowerCase()] || `hsl(${[...cls].reduce((h,c)=>((h<<5)-h)+c.charCodeAt(0),0)%360}, 70%, 60%)`
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
  
  const [telemetryHistory, setTelemetryHistory] = useState({
    fps: [] as number[],
    inference: [] as number[],
    latency: [] as number[]
  })
  
  const [alerts, setAlerts] = useState<any[]>([])
  
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const latestDetectionsRef = useRef<any>(null)
  const rafRef = useRef<number>(0)
  const durationTimerRef = useRef<any>(null)

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/cameras`)
      .then(r => r.json())
      .then(data => {
        const cam = data.find((c: any) => c.camera_id === camera_id)
        if (cam) setCamera(cam)
      })
      
    fetch(`${API_BASE}/api/v1/stream/status/${camera_id}`)
      .then(r => r.json())
      .then(data => {
        setStreamStatus(data)
        if (data.is_streaming) {
          const startedAt = new Date(data.started_at).getTime()
          durationTimerRef.current = setInterval(() => {
            setDuration(Math.floor((Date.now() - startedAt) / 1000))
          }, 1000)
        }
      })

    return () => {
      cleanup()
    }
  }, [camera_id])

  useEffect(() => {
    if (camera?.camera_id) {
      initWhep(camera.camera_id)
      initWebSocket()
    }
  }, [camera])

  const cleanup = () => {
    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (durationTimerRef.current) clearInterval(durationTimerRef.current)
    if (videoRef.current) videoRef.current.srcObject = null
  }

  const initWhep = async (streamKey: string) => {
    try {
      const pc = new RTCPeerConnection()
      pcRef.current = pc
      pc.addTransceiver('video', { direction: 'recvonly' })
      
      pc.ontrack = (e) => {
        if (videoRef.current) {
          videoRef.current.srcObject = e.streams[0]
        }
      }
      
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      
      const whepUrl = `http://localhost:8889/${streamKey}/whep`
      const res = await fetch(whepUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer.sdp
      })
      
      if (res.ok) {
        const answerSdp = await res.text()
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
      }
    } catch (err) {
      console.error("WHEP error:", err)
    }
  }

  const initWebSocket = () => {
    const ws = new WebSocket(`${WS_BASE}/ws/stream/${camera_id}`)
    wsRef.current = ws
    
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        latestDetectionsRef.current = data
        
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
    
    ctx.clearRect(0, 0, cWidth, cHeight)
    
    if (!data || !data.detections) return
    
    const vWidth = video.videoWidth || 1280
    const vHeight = video.videoHeight || 720
    const scaleX = cWidth / vWidth
    const scaleY = cHeight / vHeight
    
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
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const createSparklineOption = (data: number[], color: string, _title?: string) => ({
    grid: { left: 0, right: 0, top: 0, bottom: 0 },
    xAxis: { type: 'category', show: false },
    yAxis: { type: 'value', show: false, scale: true },
    series: [{
      data: data,
      type: 'line',
      smooth: true,
      symbol: 'none',
      lineStyle: { color, width: 2 },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [{ offset: 0, color }, { offset: 1, color: 'transparent' }]
        },
        opacity: 0.3
      }
    }],
    tooltip: { show: false }
  })

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
            <h1 className="text-sm font-bold text-slate-800 dark:text-slate-100">{camera?.name || 'Loading...'}</h1>
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
        <button 
          onClick={handleDisconnect}
          className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded text-xs font-bold transition-colors shadow-sm"
        >
          <Square className="w-3.5 h-3.5 fill-current" /> Disconnect Stream
        </button>
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
            {streamStatus?.is_streaming === false && (
              <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-white z-10">
                <AlertTriangle className="w-8 h-8 text-amber-500 mb-2" />
                <div className="font-bold">Stream Offline</div>
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
              <div className="font-mono text-sm font-bold text-slate-800 dark:text-slate-200">{latestDetectionsRef.current?.inference_ms || 0}ms</div>
              <div className="h-6 mt-1">
                <ReactECharts option={createSparklineOption(telemetryHistory.inference, '#0f766e', '')} style={{ height: '100%', width: '100%' }} />
              </div>
            </div>
            <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-md p-2">
              <div className="text-[10px] font-bold text-slate-500 uppercase">Pipeline FPS</div>
              <div className="font-mono text-sm font-bold text-slate-800 dark:text-slate-200">{latestDetectionsRef.current?.fps || 0}</div>
              <div className="h-6 mt-1">
                <ReactECharts option={createSparklineOption(telemetryHistory.fps, '#3b82f6', '')} style={{ height: '100%', width: '100%' }} />
              </div>
            </div>
            <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-md p-2">
              <div className="text-[10px] font-bold text-slate-500 uppercase">E2E Latency</div>
              <div className="font-mono text-sm font-bold text-slate-800 dark:text-slate-200">{latestDetectionsRef.current?.e2e_latency_ms || 0}ms</div>
              <div className="h-6 mt-1">
                <ReactECharts option={createSparklineOption(telemetryHistory.latency, '#f59e0b', '')} style={{ height: '100%', width: '100%' }} />
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
                      <span className="text-[10px] text-slate-500">{a.timestamp.toLocaleTimeString()}</span>
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
                <span className="text-slate-500">Active Model</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">YOLOv8</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 dark:border-slate-800/50 pb-1">
                <span className="text-slate-500">Pose Estimation</span>
                <span className="font-bold text-teal-600 dark:text-teal-400">ON</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 dark:border-slate-800/50 pb-1">
                <span className="text-slate-500">Chunks Recorded</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{streamStatus?.telemetry?.frame_count ? Math.floor(streamStatus.telemetry.frame_count/300) : 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Total Alerts</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{streamStatus?.telemetry?.alert_count || alerts.length}</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
