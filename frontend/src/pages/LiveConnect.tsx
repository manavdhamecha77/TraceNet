import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Video, Copy, Play, Square, Settings, RefreshCw } from 'lucide-react'
import { useToast } from '../components/Toast'
import { API_BASE } from '../config/api'

interface Camera {
  camera_id: string
  name: string
  status: string
}

export default function LiveConnect() {
  const toast = useToast()
  
  // Step 1 State
  const [cameras, setCameras] = useState<Camera[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState('CAM_001')
  const [enablePose, setEnablePose] = useState(false)
  const [maxChunkDuration, setMaxChunkDuration] = useState(300)
  const [inferenceFps, setInferenceFps] = useState(4)
  const [autoImport, setAutoImport] = useState(false)
  
  const [loadingToken, setLoadingToken] = useState(false)
  const [streamInfo, setStreamInfo] = useState<{ token: string; whip_url: string; whep_url: string; stream_key: string; session_id: string } | null>(null)
  
  // Step 2 State
  const [isStreaming, setIsStreaming] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'live' | 'disconnected'>('idle')
  const [streamDuration, setStreamDuration] = useState(0)
  const [bytesSent, setBytesSent] = useState(0)
  
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const durationTimerRef = useRef<any>(null)
  const statsTimerRef = useRef<any>(null)

  const fetchCameras = () => {
    fetch(`${API_BASE}/api/v1/cameras`)
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setCameras(data)
          setSelectedCameraId(prev => prev || data[0].camera_id)
        }
      })
      .catch(err => console.error('Failed to fetch cameras:', err))
  }

  useEffect(() => {
    fetchCameras()
    return () => {
      cleanupStream()
    }
  }, [])

  const cleanupStream = () => {
    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop())
      localStreamRef.current = null
    }
    if (durationTimerRef.current) clearInterval(durationTimerRef.current)
    if (statsTimerRef.current) clearInterval(statsTimerRef.current)
    if (localVideoRef.current) localVideoRef.current.srcObject = null
  }

  const handleGenerateToken = async () => {
    if (!selectedCameraId) {
      toast.warning('Select Camera', 'Please select a camera node to broadcast stream to.')
      return
    }
    setLoadingToken(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/stream/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          camera_id: selectedCameraId,
          config: {
            enable_pose: enablePose,
            max_chunk_duration_sec: maxChunkDuration,
            auto_import_chunks: autoImport,
            target_fps: inferenceFps
          }
        })
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setStreamInfo(data)
      toast.success('Token Generated', `WHIP Stream token ready for ${selectedCameraId}.`)
    } catch (err: any) {
      toast.error('Token Error', err.message || 'Failed to generate token.')
    } finally {
      setLoadingToken(false)
    }
  }

  const handleStartStreaming = async () => {
    if (!streamInfo) return
    setIsStreaming(true)
    setConnectionStatus('connecting')
    setStreamDuration(0)
    setBytesSent(0)
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: 1280, height: 720 }, 
        audio: false 
      })
      localStreamRef.current = stream
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
        localVideoRef.current.play()
      }

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      })
      pcRef.current = pc
      
      stream.getTracks().forEach(track => pc.addTrack(track, stream))
      
      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'connected') {
          setConnectionStatus('live')
          durationTimerRef.current = setInterval(() => {
            setStreamDuration(prev => prev + 1)
          }, 1000)
          
          statsTimerRef.current = setInterval(async () => {
            const stats = await pc.getStats()
            stats.forEach(report => {
              if (report.type === 'outbound-rtp' && report.kind === 'video') {
                setBytesSent(report.bytesSent || 0)
              }
            })
          }, 2000)
        } else if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
          setConnectionStatus('disconnected')
          clearInterval(durationTimerRef.current)
          clearInterval(statsTimerRef.current)
        }
      }

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      
      const whipUrl = streamInfo.whip_url
        .replace('localhost', window.location.hostname)
        .replace('127.0.0.1', window.location.hostname)
      const whipRes = await fetch(whipUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp',
          'Authorization': `Bearer ${streamInfo.token}`
        },
        body: offer.sdp
      })
      
      if (!whipRes.ok) throw new Error('WHIP endpoint rejected the stream')
      
      const answerSdp = await whipRes.text()
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
      
    } catch (err: any) {
      console.error(err)
      toast.error('Streaming Failed', err.message || 'WebRTC broadcast connection failed.')
      handleEndStream()
    }
  }

  const handleEndStream = async () => {
    cleanupStream()
    setIsStreaming(false)
    setConnectionStatus('disconnected')
    if (streamInfo) {
      try {
        await fetch(`${API_BASE}/api/v1/stream/stop/${selectedCameraId}`, { method: 'POST' })
      } catch (err) {
        console.error(err)
      }
    }
    setStreamInfo(null)
  }

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16 animate-in fade-in duration-200">
      
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Video className="w-5 h-5 text-teal-600" />
            Connect Live Camera Feed
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Broadcast this device's camera as a live feed into the DRISHTI pipeline via WebRTC.
          </p>
        </div>
      </div>

      {!isStreaming ? (
        <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-md shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
              <Settings className="w-4 h-4 text-slate-400" />
              Stream Configuration
            </h3>
          </div>
          
          <div className="p-5 space-y-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                  Target Camera Node
                </label>
                <button 
                  type="button" 
                  onClick={fetchCameras}
                  className="text-xs text-teal-600 hover:text-teal-700 font-medium flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
              </div>
              <select 
                value={selectedCameraId}
                onChange={e => setSelectedCameraId(e.target.value)}
                className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-base md:text-sm text-slate-800 dark:text-slate-100 focus:border-teal-500 outline-none cursor-pointer"
              >
                {cameras.length > 0 ? (
                  cameras.map(c => (
                    <option key={c.camera_id} value={c.camera_id}>
                      {c.name} ({c.camera_id})
                    </option>
                  ))
                ) : (
                  <>
                    <option value="CAM_001">CAM_001 (Camera 01)</option>
                    <option value="CAM_002">CAM_002 (Camera 02)</option>
                    <option value="CAM_003">CAM_003 (Camera 03)</option>
                  </>
                )}
              </select>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-2">
                    Inference FPS: {inferenceFps}
                  </label>
                  <input 
                    type="range" min="1" max="15" 
                    value={inferenceFps} onChange={e => setInferenceFps(Number(e.target.value))}
                    className="w-full accent-teal-600"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                    <span>1 FPS</span><span>15 FPS</span>
                  </div>
                </div>
                
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-2">
                    Max Chunk Duration: {formatTime(maxChunkDuration)}
                  </label>
                  <input 
                    type="range" min="60" max="600" step="10"
                    value={maxChunkDuration} onChange={e => setMaxChunkDuration(Number(e.target.value))}
                    className="w-full accent-teal-600"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                    <span>1 min</span><span>10 mins</span>
                  </div>
                </div>
              </div>
              
              <div className="space-y-4 pt-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={enablePose} onChange={e => setEnablePose(e.target.checked)} className="w-4 h-4 accent-teal-600 rounded" />
                  <div>
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Enable Pose Estimation</div>
                    <div className="text-xs text-slate-500">Run YOLO11n-Pose on the live feed</div>
                  </div>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={autoImport} onChange={e => setAutoImport(e.target.checked)} className="w-4 h-4 accent-teal-600 rounded" />
                  <div>
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Auto-Import Chunks</div>
                    <div className="text-xs text-slate-500">Automatically save and index recorded chunks</div>
                  </div>
                </label>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
              {!streamInfo ? (
                <button
                  onClick={handleGenerateToken}
                  disabled={loadingToken || !selectedCameraId}
                  className="w-full flex items-center justify-center gap-2 bg-teal-700 hover:bg-teal-800 text-white font-bold py-2.5 rounded text-sm transition-colors disabled:opacity-50"
                >
                  {loadingToken ? 'Generating...' : 'Generate Stream Token'}
                </button>
              ) : (
                <div className="space-y-4 animate-in slide-in-from-bottom-2">
                  <div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded">
                    <div className="text-xs font-bold text-slate-500 uppercase mb-2 flex items-center justify-between">
                      <span>Stream Credentials</span>
                      <button onClick={() => navigator.clipboard.writeText(streamInfo.token)} className="text-teal-600 hover:text-teal-700 flex items-center gap-1">
                        <Copy className="w-3 h-3" /> Copy
                      </button>
                    </div>
                    <div className="font-mono text-[11px] text-slate-600 dark:text-slate-400 break-all bg-white dark:bg-slate-950 p-2 border border-slate-200 dark:border-slate-800 rounded">
                      {streamInfo.token}
                    </div>
                    <div className="mt-3 text-xs text-slate-500">
                      <strong>WHIP URL:</strong> {streamInfo.whip_url}
                    </div>
                  </div>
                  
                  <button
                    onClick={handleStartStreaming}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded text-sm transition-colors shadow-sm"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    Start Streaming Now
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid md:grid-cols-[1fr_300px] gap-6">
          <div className="bg-black rounded-lg overflow-hidden border border-slate-800 relative aspect-video flex items-center justify-center shadow-xl">
            <video 
              ref={localVideoRef} 
              autoPlay 
              playsInline 
              muted 
              className="absolute inset-0 w-full h-full object-contain"
            />
            {connectionStatus === 'connecting' && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <div className="text-amber-500 font-bold flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                  Connecting WebRTC...
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase">Status</span>
                {connectionStatus === 'live' ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-600 dark:text-rose-400">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                    LIVE
                  </span>
                ) : (
                  <span className="text-xs font-bold text-slate-400 uppercase">{connectionStatus}</span>
                )}
              </div>
              
              <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-3">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs text-slate-500">Duration</span>
                  <span className="font-mono text-sm font-bold text-slate-800 dark:text-slate-200">{formatTime(streamDuration)}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-xs text-slate-500">Data Sent</span>
                  <span className="font-mono text-sm font-bold text-slate-800 dark:text-slate-200">{formatBytes(bytesSent)}</span>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  onClick={handleEndStream}
                  className="w-full flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 text-white font-bold py-2 rounded text-sm transition-colors"
                >
                  <Square className="w-4 h-4 fill-current" />
                  End Stream
                </button>
              </div>
            </div>

            {connectionStatus === 'live' && (
              <Link 
                to={`/cameras/${selectedCameraId}/live`}
                className="block w-full text-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold py-2 rounded border border-slate-200 dark:border-slate-700 text-sm transition-colors"
              >
                View Annotated Feed &rarr;
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
