import { useState, useEffect } from 'react'

const API_BASE = 'http://localhost:8000'

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
  const [alerts, setAlerts] = useState<AssaultAlert[]>([])
  const [stats, setStats] = useState<DetectionStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedCamera, setSelectedCamera] = useState<string>('')
  const [modelStatus, setModelStatus] = useState<any>(null)
  const [acknowledging, setAcknowledging] = useState<number | null>(null)

  // Load assault data
  const loadAssaultData = async () => {
    setLoading(true)
    try {
      // Fetch alerts
      const params = selectedCamera ? `?camera_id=${selectedCamera}` : ''
      const alertRes = await fetch(`${API_BASE}/api/v1/assault-detection/alerts${params}`)
      if (alertRes.ok) {
        const data = await alertRes.json()
        setAlerts(data.alerts)
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
        setAlerts(prev =>
          prev.map(a => a.id === alertId ? { ...a, acknowledged: true } : a)
        )
      }
    } catch (err) {
      console.error('Failed to acknowledge:', err)
    } finally {
      setAcknowledging(null)
    }
  }

  const getCameraName = (cameraId: string): string => {
    const cam = cameras.find(c => c.camera_id === cameraId)
    return cam?.name || cameraId
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* HEADER */}
      <div>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Assault Detection</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Monitor violent incidents detected by VideoMAE deep learning model (UCF-Crime trained).
        </p>
      </div>

      {/* MODEL STATUS */}
      {modelStatus && (
        <div className={`rounded-lg border p-4 ${
          modelStatus.model_loaded
            ? 'border-emerald-500/20 bg-emerald-50 dark:bg-emerald-950/20'
            : 'border-amber-500/20 bg-amber-50 dark:bg-amber-950/20'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className={`font-semibold text-sm ${
                modelStatus.model_loaded
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}>
                {modelStatus.model_loaded ? '✅ Model Ready' : '⚠️ Model Not Loaded'}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                {modelStatus.model_name} | Device: {modelStatus.device}
              </p>
            </div>
            <span className="text-[11px] bg-slate-200 dark:bg-slate-700 px-2.5 py-1 rounded font-mono">
              Threshold: {modelStatus.confidence_threshold}
            </span>
          </div>
        </div>
      )}

      {/* STATISTICS CARDS */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-1">
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Videos Analyzed
            </div>
            <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">
              {stats.total_videos_analyzed}
            </div>
          </div>

          <div className="rounded-lg border border-rose-500/20 bg-rose-50 dark:bg-rose-950/20 p-4 space-y-1">
            <div className="text-[11px] font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider">
              Assaults Detected
            </div>
            <div className="text-2xl font-bold text-rose-800 dark:text-rose-300">
              {stats.assaults_detected}
            </div>
          </div>

          <div className="rounded-lg border border-orange-500/20 bg-orange-50 dark:bg-orange-950/20 p-4 space-y-1">
            <div className="text-[11px] font-bold text-orange-700 dark:text-orange-400 uppercase tracking-wider">
              High Confidence
            </div>
            <div className="text-2xl font-bold text-orange-800 dark:text-orange-300">
              {stats.high_confidence_assaults}
            </div>
          </div>

          <div className="rounded-lg border border-teal-500/20 bg-teal-50 dark:bg-teal-950/20 p-4 space-y-1">
            <div className="text-[11px] font-bold text-teal-700 dark:text-teal-400 uppercase tracking-wider">
              Avg Confidence
            </div>
            <div className="text-2xl font-bold text-teal-800 dark:text-teal-300">
              {(stats.average_confidence * 100).toFixed(0)}%
            </div>
          </div>
        </div>
      )}

      {/* ASSAULT TYPE BREAKDOWN */}
      {stats && Object.keys(stats.assault_types).length > 0 && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-3">
            Assault Types Detected
          </h3>
          <div className="space-y-2">
            {Object.entries(stats.assault_types).map(([type, count]) => (
              <div key={type} className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-700/50 rounded">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {type}
                </span>
                <span className="text-sm font-bold text-rose-600 dark:text-rose-400">
                  {count} incident{count !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FILTER */}
      <div className="space-y-1">
        <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          Filter by Camera
        </label>
        <select
          value={selectedCamera}
          onChange={(e) => setSelectedCamera(e.target.value)}
          className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-rose-600"
        >
          <option value="">All Cameras</option>
          {cameras.map(cam => (
            <option key={cam.camera_id} value={cam.camera_id}>
              {cam.name}
            </option>
          ))}
        </select>
      </div>

      {/* ALERTS TABLE */}
      <div className="border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden bg-white dark:bg-slate-800">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          Assault Alerts — {loading ? 'Loading...' : `${alerts.length} Alert${alerts.length !== 1 ? 's' : ''}`}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-slate-500 dark:text-slate-400">
            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Loading assault data...
          </div>
        ) : alerts.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400 dark:text-slate-600">
            No assault alerts detected
          </div>
        ) : (
          <table className="w-full divide-y divide-slate-100 dark:divide-slate-800 text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
              <tr>
                <th className="px-4 py-3">Camera</th>
                <th className="px-4 py-3">Video ID</th>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {alerts.map(alert => (
                <tr key={alert.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-300">
                    {getCameraName(alert.camera_id)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                    {alert.video_id.substring(0, 12)}...
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                    {new Date(alert.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    {alert.acknowledged ? (
                      <div className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        Acknowledged
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 border border-rose-500/20 px-2.5 py-1 text-[10px] font-bold text-rose-700 dark:text-rose-400">
                        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                        Unacknowledged
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!alert.acknowledged && (
                      <button
                        onClick={() => handleAcknowledge(alert.id)}
                        disabled={acknowledging === alert.id}
                        className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-[10px] font-bold transition-colors inline-flex items-center gap-1.5"
                      >
                        {acknowledging === alert.id ? (
                          <>
                            <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Acknowledging...
                          </>
                        ) : (
                          <>
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Acknowledge
                          </>
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
