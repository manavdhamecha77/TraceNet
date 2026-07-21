import { useState, useEffect } from 'react'

const API_BASE = 'http://localhost:8000'

interface Alert {
  id: number
  alert_type: string
  camera_id: string
  tracklet_id: string
  timestamp: string
  acknowledged: boolean
}

interface AlertSummary {
  total_alerts: number
  unacknowledged_alerts: number
  by_type: Record<string, number>
}

interface AlertsPageProps {
  cameras: Array<{ camera_id: string; name: string }>
}

export default function Alerts({ cameras = [] }: AlertsPageProps) {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [summary, setSummary] = useState<AlertSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedCamera, setSelectedCamera] = useState<string>('')
  const [selectedType, setSelectedType] = useState<string>('')
  const [acknowledging, setAcknowledging] = useState<number | null>(null)

  // Load alerts and summary
  const loadAlerts = async () => {
    setLoading(true)
    setError('')
    try {
      // Fetch alerts with filters
      const params = new URLSearchParams()
      if (selectedCamera) params.append('camera_id', selectedCamera)
      if (selectedType) params.append('alert_type', selectedType)

      const alertRes = await fetch(`${API_BASE}/api/v1/alerts?${params.toString()}`)
      if (alertRes.ok) {
        setAlerts(await alertRes.json())
      }

      // Fetch summary
      const summaryRes = await fetch(`${API_BASE}/api/v1/alerts/summary`)
      if (summaryRes.ok) {
        setSummary(await summaryRes.json())
      }
    } catch (err) {
      setError('Failed to load alerts')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAlerts()
  }, [selectedCamera, selectedType])

  const handleAcknowledge = async (alertId: number) => {
    setAcknowledging(alertId)
    try {
      const res = await fetch(`${API_BASE}/api/v1/alerts/${alertId}/acknowledge`, {
        method: 'PUT',
      })
      if (res.ok) {
        // Update local state
        setAlerts(prev =>
          prev.map(a => a.id === alertId ? { ...a, acknowledged: true } : a)
        )
        // Reload summary
        const summaryRes = await fetch(`${API_BASE}/api/v1/alerts/summary`)
        if (summaryRes.ok) {
          setSummary(await summaryRes.json())
        }
      }
    } catch (err) {
      console.error('Failed to acknowledge alert:', err)
    } finally {
      setAcknowledging(null)
    }
  }

  const getCameraName = (cameraId: string): string => {
    const cam = cameras.find(c => c.camera_id === cameraId)
    return cam?.name || cameraId
  }

  const getAlertColor = (type: string) => {
    const colorMap: Record<string, string> = {
      'loitering': 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400',
      'abandoned_object': 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400',
    }
    return colorMap[type.toLowerCase()] || 'bg-slate-500/10 border-slate-500/30 text-slate-700 dark:text-slate-400'
  }

  const getAlertIcon = (type: string) => {
    if (type.toLowerCase() === 'loitering') {
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    }
    if (type.toLowerCase() === 'abandoned_object') {
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 010 9m13-3H7" />
        </svg>
      )
    }
    return (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  }

  const alertTypes = summary ? Object.keys(summary.by_type) : []

  return (
    <div className="space-y-6 animate-in fade-in duration-200">

      {/* HEADER */}
      <div>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Alert Dashboard</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Monitor loitering, abandoned objects, and other detections across your camera network.
        </p>
      </div>

      {/* SUMMARY CARDS */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-1">
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Alerts</div>
            <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{summary.total_alerts}</div>
          </div>

          <div className="rounded-lg border border-amber-500/20 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-1">
            <div className="text-[11px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">Unacknowledged</div>
            <div className="text-2xl font-bold text-amber-800 dark:text-amber-300">{summary.unacknowledged_alerts}</div>
          </div>

          {alertTypes.map(type => (
            <div key={type} className={`rounded-lg border p-4 space-y-1 ${getAlertColor(type).split(' ')[0]} ${getAlertColor(type).split(' ')[1]}`}>
              <div className={`text-[11px] font-bold uppercase tracking-wider flex items-center gap-1 ${getAlertColor(type).split(' ')[2]}`}>
                {getAlertIcon(type)}
                {type.replace(/_/g, ' ')}
              </div>
              <div className={`text-2xl font-bold ${getAlertColor(type).split(' ')[2]}`}>{summary.by_type[type]}</div>
            </div>
          ))}
        </div>
      )}

      {/* FILTERS */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="flex-1 space-y-1">
          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Filter by Camera</label>
          <select
            value={selectedCamera}
            onChange={(e) => setSelectedCamera(e.target.value)}
            className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-600"
          >
            <option value="">All Cameras</option>
            {cameras.map(cam => (
              <option key={cam.camera_id} value={cam.camera_id}>{cam.name}</option>
            ))}
          </select>
        </div>

        <div className="flex-1 space-y-1">
          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Filter by Type</label>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-600"
          >
            <option value="">All Types</option>
            {alertTypes.map(type => (
              <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        <button
          onClick={loadAlerts}
          className="mt-auto px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded text-xs font-bold transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* ALERTS TABLE */}
      <div className="border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden bg-white dark:bg-slate-800">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          Alerts — {loading ? 'Loading...' : `${alerts.length} Alert${alerts.length !== 1 ? 's' : ''}`}
        </div>

        {error && (
          <div className="p-4 text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 border-b border-rose-500/20">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-slate-500 dark:text-slate-400">
            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Loading alerts...
          </div>
        ) : alerts.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400 dark:text-slate-600">
            No alerts to display
          </div>
        ) : (
          <table className="w-full divide-y divide-slate-100 dark:divide-slate-800 text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
              <tr>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Camera</th>
                <th className="px-4 py-3">Tracklet ID</th>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {alerts.map(alert => (
                <tr key={alert.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3">
                    <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${getAlertColor(alert.alert_type)}`}>
                      {getAlertIcon(alert.alert_type)}
                      {alert.alert_type.replace(/_/g, ' ')}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-300">
                    {getCameraName(alert.camera_id)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                    {alert.tracklet_id.substring(0, 12)}...
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
                      <div className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.5H7a1 1 0 100 2h3.5V14a1 1 0 102 0v-3.5H13a1 1 0 100-2h-3.5V7z" clipRule="evenodd" />
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
                        className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-[10px] font-bold transition-colors inline-flex items-center gap-1.5"
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
