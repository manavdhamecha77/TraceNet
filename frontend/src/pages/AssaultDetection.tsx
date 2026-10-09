import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ShieldAlert, Activity, CheckCircle2, AlertTriangle, Eye, RefreshCw, Filter, ScanSearch } from 'lucide-react'
import { useToast } from '../components/Toast'
import { formatDisplayDate } from '../utils/dateFormatter'

import { API_BASE } from '../config/api'

interface Camera {
  camera_id: string
  name: string
}

interface AssaultAlert {
  id: number
  camera_id: string
  video_id: string
  timestamp: string
  acknowledged: boolean
  confidence?: number
  assault_type?: string
}

interface ScanWindow {
  timestamp_seconds: number
  start_seconds: number
  end_seconds: number
  class: string
  confidence: number
  top_label: string
}

interface ScanResult {
  video_id: string
  has_assault: boolean
  assault_type: string
  confidence: number
  alert_id?: number | null
  peak_timestamp_seconds?: number | null
  windows_analyzed: number
  windows_flagged: number
  windows: ScanWindow[]
}

interface VideoOption {
  id: string
  original_filename?: string
  processing_status?: string
}

interface DetectionStats {
  total_videos_analyzed: number
  assaults_detected: number
  high_confidence_assaults: number
  assault_types: Record<string, number>
  average_confidence: number
}

interface AssaultDetectionProps {
  cameras?: Camera[]
}

export default function AssaultDetection({ cameras = [] }: AssaultDetectionProps) {
  const toast = useToast()
  const [alerts, setAlerts] = useState<AssaultAlert[]>([])
  const [stats, setStats] = useState<DetectionStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedCamera, setSelectedCamera] = useState<string>('')
  const [modelStatus, setModelStatus] = useState<any>(null)
  const [acknowledging, setAcknowledging] = useState<number | null>(null)

  // On-demand VideoMAE scan of one video
  const [scanCamera, setScanCamera] = useState('')
  const [scanVideos, setScanVideos] = useState<VideoOption[]>([])
  const [scanVideoId, setScanVideoId] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)

  useEffect(() => {
    setScanVideos([])
    setScanVideoId('')
    if (!scanCamera) return
    fetch(`${API_BASE}/api/v1/cameras/${scanCamera}/videos`)
      .then(r => (r.ok ? r.json() : []))
      .then((rows: VideoOption[]) => {
        const ready = rows.filter(v => !v.processing_status || ['complete', 'preprocessed', 'indexing'].includes(v.processing_status))
        setScanVideos(ready)
        if (ready.length) setScanVideoId(ready[0].id)
      })
      .catch(() => setScanVideos([]))
  }, [scanCamera])

  const runScan = async () => {
    if (!scanCamera || !scanVideoId) return
    setScanning(true)
    setScanResult(null)
    try {
      const res = await fetch(`${API_BASE}/api/v1/assault-detection/analyze-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: scanVideoId, camera_id: scanCamera }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Scan failed')
      setScanResult(data)
      const gate = Math.round((modelStatus?.confidence_threshold ?? 0.6) * 100)
      if (data.has_assault) {
        toast.error('Violence detected', `${data.assault_type} at ${data.peak_timestamp_seconds?.toFixed(1)} s, alert #${data.alert_id} raised for review.`)
        loadAssaultData()
      } else {
        toast.success('Scan complete', `No violent activity above the ${gate}% gate in ${data.windows_analyzed} windows.`)
      }
    } catch (err: any) {
      toast.error('Scan failed', err.message || 'Could not analyse this video.')
    } finally {
      setScanning(false)
    }
  }

  // Load assault data
  const loadAssaultData = async () => {
    setLoading(true)
    try {
      // Fetch alerts
      const params = selectedCamera ? `?camera_id=${selectedCamera}` : ''
      const alertRes = await fetch(`${API_BASE}/api/v1/assault-detection/alerts${params}`)
      if (alertRes.ok) {
        const data = await alertRes.json()
        setAlerts(data.alerts || [])
      }

      // Fetch statistics
      const statsRes = await fetch(
        `${API_BASE}/api/v1/assault-detection/statistics?days=7${
          selectedCamera ? `&camera_id=${selectedCamera}` : ''
        }`
      )
      if (statsRes.ok) {
        setStats(await statsRes.json())
      }

      // Fetch model status
      const statusRes = await fetch(`${API_BASE}/api/v1/assault-detection/model/status`)
      if (statusRes.ok) {
        setModelStatus(await statusRes.json())
      }
    } catch (err) {
      console.error('Failed to load assault data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAssaultData()
  }, [selectedCamera])

  const handleAcknowledge = async (alertId: number) => {
    setAcknowledging(alertId)
    try {
      const res = await fetch(`${API_BASE}/api/v1/alerts/${alertId}/acknowledge`, {
        method: 'PUT',
      })
      if (res.ok) {
        toast.success('Alert Acknowledged', `Physical Assault Incident #${alertId} updated.`)
        setAlerts(prev =>
          prev.map(a => a.id === alertId ? { ...a, acknowledged: true } : a)
        )
      } else {
        toast.error('Error', 'Failed to acknowledge alert.')
      }
    } catch (err) {
      toast.error('Network Error', 'Failed to reach server.')
    } finally {
      setAcknowledging(null)
    }
  }

  const getCameraName = (cameraId: string): string => {
    const cam = cameras.find(c => c.camera_id === cameraId)
    return cam?.name || cameraId
  }

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-200 text-slate-800 dark:text-slate-100">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span>Physical Assault Analytics</span>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400">
              VideoMAE Neural Pipeline
            </span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Real-time deep learning temporal violence classifier (UCF-Crime trained) detecting violent alterations and physical assault incidents.
          </p>
        </div>

        <button
          onClick={loadAssaultData}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh Pipeline
        </button>
      </div>

      {/* MODEL STATUS */}
      {modelStatus && (
        <div className={`rounded-md border p-4 backdrop-blur-sm ${
          modelStatus.model_loaded
            ? 'border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20'
            : 'border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20'
        }`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${modelStatus.model_loaded ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                <Activity className="h-5 w-5" />
              </div>
              <div>
                <h3 className={`font-bold text-xs uppercase tracking-wider ${
                  modelStatus.model_loaded
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}>
                  {modelStatus.model_loaded ? 'VideoMAE Engine Operational' : 'Model Standby Mode'}
                </h3>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                  Checkpoint: <span className="font-mono text-slate-300">{modelStatus.model_name}</span> | Execution Device: <span className="font-mono text-cyan-400">{modelStatus.device}</span>
                </p>
              </div>
            </div>
            <span className="text-[11px] bg-slate-900 border border-slate-800 px-3 py-1 rounded-lg font-mono text-cyan-400 font-bold">
              Confidence Gate: {modelStatus.confidence_threshold}
            </span>
          </div>
        </div>
      )}

      {/* STATISTICS CARDS */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-1 shadow-xs">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Feeds Evaluated
            </div>
            <div className="text-2xl font-black text-slate-900 dark:text-slate-100 font-mono">
              {stats.total_videos_analyzed}
            </div>
          </div>

          <div className="rounded-md border border-rose-500/30 bg-rose-50/50 dark:bg-rose-950/20 p-4 space-y-1 shadow-xs">
            <div className="text-xs font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider flex items-center justify-between">
              <span>Assaults Detected</span>
              <ShieldAlert className="w-4 h-4 text-rose-500" />
            </div>
            <div className="text-2xl font-black text-rose-600 dark:text-rose-400 font-mono">
              {stats.assaults_detected}
            </div>
          </div>

          <div className="rounded-md border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 p-4 space-y-1 shadow-xs">
            <div className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center justify-between">
              <span>High Confidence</span>
              <AlertTriangle className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-2xl font-black text-amber-600 dark:text-amber-400 font-mono">
              {stats.high_confidence_assaults}
            </div>
          </div>

          <div className="rounded-md border border-cyan-500/30 bg-cyan-50/50 dark:bg-cyan-950/20 p-4 space-y-1 shadow-xs">
            <div className="text-xs font-bold text-cyan-700 dark:text-cyan-400 uppercase tracking-wider">
              Avg Score
            </div>
            <div className="text-2xl font-black text-cyan-600 dark:text-cyan-400 font-mono">
              {(stats.average_confidence * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      )}

      {/* ON-DEMAND SCAN */}
      <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ScanSearch className="w-4 h-4 text-rose-500" aria-hidden />
            Analyze a video
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            VideoMAE classifies every 2-second window into the 14 UCF-Crime classes. Assault, Fighting, Abuse, Robbery and Shooting above the gate raise an alert for officer review.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={scanCamera}
            onChange={e => setScanCamera(e.target.value)}
            className="h-8 px-3 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-semibold min-w-[220px]"
          >
            <option value="">Select camera...</option>
            {cameras.map(cam => (
              <option key={cam.camera_id} value={cam.camera_id}>{cam.name} ({cam.camera_id})</option>
            ))}
          </select>
          <select
            value={scanVideoId}
            onChange={e => setScanVideoId(e.target.value)}
            disabled={!scanVideos.length}
            className="h-8 px-3 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-semibold min-w-[220px] disabled:opacity-50"
          >
            {!scanVideos.length && <option value="">{scanCamera ? 'No processed videos' : 'Select a camera first'}</option>}
            {scanVideos.map(v => (
              <option key={v.id} value={v.id}>{v.original_filename || v.id}</option>
            ))}
          </select>
          <button
            onClick={runScan}
            disabled={scanning || !scanVideoId}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-semibold"
          >
            {scanning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <ScanSearch className="w-3.5 h-3.5" aria-hidden />}
            {scanning ? 'Scanning (about 40 s per 5 min of video)...' : 'Run assault scan'}
          </button>
        </div>

        {scanResult && (
          <div className="space-y-2 pt-1">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-bold border ${
                scanResult.has_assault
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
              }`}>
                {scanResult.has_assault ? <ShieldAlert className="w-3.5 h-3.5" aria-hidden /> : <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />}
                {scanResult.has_assault ? `${scanResult.assault_type} detected` : 'No violent activity'}
              </span>
              <span className="text-slate-600 dark:text-slate-300 font-mono">
                peak {(scanResult.confidence * 100).toFixed(1)}%
                {scanResult.peak_timestamp_seconds != null && ` at ${scanResult.peak_timestamp_seconds.toFixed(1)} s`}
              </span>
              <span className="text-slate-500 dark:text-slate-400 font-mono">
                {scanResult.windows_flagged} / {scanResult.windows_analyzed} windows above the gate
              </span>
              {scanResult.alert_id != null && (
                <Link to={`/frame-inspection/${scanResult.alert_id}`} className="text-cyan-700 dark:text-cyan-400 font-semibold hover:underline">
                  Inspect alert #{scanResult.alert_id}
                </Link>
              )}
            </div>
            {/* Violence score per 2-second window across the video */}
            <div className="flex items-end gap-px h-12 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-1 pt-1" aria-label="Violence score per 2-second window">
              {scanResult.windows.map((w, i) => (
                <div
                  key={i}
                  title={`${w.start_seconds.toFixed(0)}-${w.end_seconds.toFixed(0)} s: ${w.class} ${(w.confidence * 100).toFixed(1)}% (top class: ${w.top_label})`}
                  className={`flex-1 rounded-t-sm ${w.confidence >= (modelStatus?.confidence_threshold ?? 0.6) ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                  style={{ height: `${Math.max(4, w.confidence * 100)}%` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* FILTER BAR */}
      <div className="flex items-center gap-3 p-3.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <Filter className="w-4 h-4 text-slate-500" />
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider shrink-0">
          Filter Node:
        </label>
        <select
          value={selectedCamera}
          onChange={(e) => setSelectedCamera(e.target.value)}
          className="h-8 px-3 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-semibold max-w-xs w-full"
        >
          <option value="">All Camera Nodes</option>
          {cameras.map(cam => (
            <option key={cam.camera_id} value={cam.camera_id}>
              {cam.name} ({cam.camera_id})
            </option>
          ))}
        </select>
      </div>

      {/* ALERTS TABLE */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden bg-white dark:bg-slate-900 shadow-xs">
        <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center justify-between">
          <span>Physical Assault Alert Feed</span>
          <span className="font-mono text-cyan-400">{alerts.length} Incidents Logged</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
            <RefreshCw className="h-5 w-5 animate-spin text-rose-500" />
            <span>Loading Assault Analytics...</span>
          </div>
        ) : alerts.length === 0 ? (
          <div className="p-16 text-center text-xs text-slate-400">
            No physical assault incidents detected matching current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full divide-y divide-slate-100 dark:divide-slate-800 text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950/60 text-[10px] text-slate-400 uppercase tracking-wider font-bold">
                <tr>
                  <th className="px-4 py-3">Camera Node</th>
                  <th className="px-4 py-3">Video Segment</th>
                  <th className="px-4 py-3">Timeline</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {alerts.map(alert => (
                  <tr key={alert.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 font-bold text-slate-800 dark:text-slate-100">
                      {getCameraName(alert.camera_id)}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {alert.video_id.substring(0, 12)}...
                      {alert.assault_type && (
                        <div className="text-[10px] font-sans font-semibold text-rose-700 dark:text-rose-400">
                          {alert.assault_type} {alert.confidence != null && `${(alert.confidence * 100).toFixed(0)}%`}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-400">
                      {formatDisplayDate(alert.timestamp)}
                    </td>
                    <td className="px-4 py-3">
                      {alert.acknowledged ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" />
                          Acknowledged
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 border border-rose-500/30 px-2.5 py-0.5 text-[10px] font-bold text-rose-700 dark:text-rose-400 animate-pulse">
                          <ShieldAlert className="h-3 w-3" />
                          Unacknowledged
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <Link
                        to={`/frame-inspection/${alert.id}`}
                        className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded-lg text-[11px] font-bold transition-all inline-flex items-center gap-1 shadow-md shadow-cyan-500/10"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Inspect Frames
                      </Link>
                      {!alert.acknowledged && (
                        <button
                          onClick={() => handleAcknowledge(alert.id)}
                          disabled={acknowledging === alert.id}
                          className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-lg text-[11px] font-bold transition-all inline-flex items-center gap-1 shadow-md shadow-rose-500/10"
                        >
                          {acknowledging === alert.id ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                          Acknowledge
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
