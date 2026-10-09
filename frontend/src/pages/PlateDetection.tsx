import { useState, useEffect, useCallback } from 'react'
import {
  ScanLine, Car, ShieldAlert, RefreshCw, Filter,
  Plus, Trash2, Eye, EyeOff, Search as SearchIcon
} from 'lucide-react'
import { useToast } from '../components/Toast'
import { formatDisplayDate } from '../utils/dateFormatter'
import { API_BASE } from '../config/api'
import OcrEngineSelector from '../components/OcrEngineSelector'

interface Camera {
  camera_id: string
  name: string
}

interface Video {
  id: string
  standardized_filename: string
  processing_status: string
}

interface PlateDetectionRow {
  id: string
  video_id: string | null
  camera_id: string
  frame_number: number | null
  timestamp_seconds: number | null
  plate_text: string
  confidence: number
  bbox: number[]
  cutout_path: string | null
  is_watchlisted: boolean
  alert_id: number | null
  created_at: string
}

interface WatchlistEntry {
  id: string
  plate_number: string
  reason: string | null
  priority: string
  status: string
  notes: string | null
  created_at: string
  created_by: string | null
  last_matched_at: string | null
  match_count: number
}

interface Statistics {
  total_detections: number
  unique_plates: number
  watchlist_hits: number
  average_confidence: number
}

interface ModelStatus {
  model_loaded: boolean
  model_path?: string
  vehicle_model_loaded?: boolean
  vehicle_model_path?: string | null
  ocr_model?: string
  device?: string
  confidence_threshold?: number
  error?: string
}

interface PlateDetectionProps {
  cameras?: Camera[]
}

function cutoutUrl(path: string | null): string | null {
  if (!path) return null
  let rel = path.replace(/\\/g, '/')
  const backendDataIndex = rel.indexOf('/backend/data/')
  if (backendDataIndex !== -1) {
    rel = rel.substring(backendDataIndex + 14)
  } else {
    const dataIndex = rel.indexOf('/data/')
    if (dataIndex !== -1) {
      rel = rel.substring(dataIndex + 6)
    } else {
      rel = rel.replace(/^\.?\/?data\//, '')
    }
  }
  return `${API_BASE}/data/${rel}`
}

export default function PlateDetection({ cameras = [] }: PlateDetectionProps) {
  const toast = useToast()
  const [tab, setTab] = useState<'detections' | 'watchlist'>('detections')

  const [stats, setStats] = useState<Statistics | null>(null)
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const [detections, setDetections] = useState<PlateDetectionRow[]>([])
  const [filterCamera, setFilterCamera] = useState<string>('')
  const [filterPlate, setFilterPlate] = useState<string>('')
  const [watchlistOnly, setWatchlistOnly] = useState(false)

  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([])
  const [newPlate, setNewPlate] = useState('')
  const [newReason, setNewReason] = useState('')
  const [newPriority, setNewPriority] = useState('HIGH')
  const [addingEntry, setAddingEntry] = useState(false)

  // Scan panel state
  const [scanCamera, setScanCamera] = useState('')
  const [scanVideos, setScanVideos] = useState<Video[]>([])
  const [scanVideoId, setScanVideoId] = useState('')
  const [scanning, setScanning] = useState(false)

  const loadStats = useCallback(async () => {
    try {
      const params = filterCamera ? `?camera_id=${filterCamera}` : ''
      const res = await fetch(`${API_BASE}/api/v1/anpr/statistics${params}`)
      if (res.ok) setStats(await res.json())
    } catch (err) {
      console.error('Failed to load ANPR statistics:', err)
    }
  }, [filterCamera])

  const loadModelStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/anpr/model/status`)
      if (res.ok) setModelStatus(await res.json())
    } catch (err) {
      console.error('Failed to load ANPR model status:', err)
    }
  }, [])

  const loadDetections = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterCamera) params.set('camera_id', filterCamera)
      if (filterPlate) params.set('plate_text', filterPlate)
      if (watchlistOnly) params.set('watchlist_only', 'true')
      const res = await fetch(`${API_BASE}/api/v1/anpr/detections?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setDetections(data.detections || [])
      }
    } catch (err) {
      console.error('Failed to load plate detections:', err)
    } finally {
      setLoading(false)
    }
  }, [filterCamera, filterPlate, watchlistOnly])

  const loadWatchlist = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/anpr/watchlist?status_filter=`)
      if (res.ok) setWatchlist(await res.json())
    } catch (err) {
      console.error('Failed to load plate watchlist:', err)
    }
  }, [])

  const refreshAll = useCallback(() => {
    loadStats()
    loadModelStatus()
    loadDetections()
    loadWatchlist()
  }, [loadStats, loadModelStatus, loadDetections, loadWatchlist])

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  useEffect(() => {
    if (!scanCamera) {
      setScanVideos([])
      setScanVideoId('')
      return
    }
    fetch(`${API_BASE}/api/v1/cameras/${scanCamera}/videos`)
      .then(r => (r.ok ? r.json() : []))
      .then((vids: Video[]) => setScanVideos(vids.filter(v => v.processing_status === 'complete')))
      .catch(() => setScanVideos([]))
  }, [scanCamera])

  const handleScan = async () => {
    if (!scanCamera || !scanVideoId) return
    setScanning(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/anpr/analyze-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: scanVideoId, camera_id: scanCamera }),
      })
      if (res.ok) {
        const result = await res.json()
        toast.success(
          'Scan Complete',
          `${result.plates_detected} plate(s) found${result.watchlist_hits > 0 ? `, ${result.watchlist_hits} watchlist hit(s)!` : ''}`
        )
        refreshAll()
      } else {
        const err = await res.json()
        toast.error('Scan Failed', err.detail || 'Unable to analyze video.')
      }
    } catch (err) {
      toast.error('Network Error', 'Failed to reach server.')
    } finally {
      setScanning(false)
    }
  }

  const handleAddWatchlist = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPlate.trim()) return
    setAddingEntry(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/anpr/watchlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plate_number: newPlate, reason: newReason || null, priority: newPriority }),
      })
      if (res.ok) {
        toast.success('Added to Watchlist', `${newPlate.toUpperCase()} is now being monitored.`)
        setNewPlate('')
        setNewReason('')
        setNewPriority('HIGH')
        loadWatchlist()
      } else {
        const err = await res.json()
        toast.error('Error', err.detail || 'Failed to add plate to watchlist.')
      }
    } catch (err) {
      toast.error('Network Error', 'Failed to reach server.')
    } finally {
      setAddingEntry(false)
    }
  }

  const handleResolveWatchlist = async (entry: WatchlistEntry) => {
    const nextStatus = entry.status === 'active' ? 'resolved' : 'active'
    try {
      const res = await fetch(`${API_BASE}/api/v1/anpr/watchlist/${entry.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      if (res.ok) {
        toast.success('Updated', `${entry.plate_number} marked as ${nextStatus}.`)
        loadWatchlist()
      }
    } catch (err) {
      toast.error('Network Error', 'Failed to reach server.')
    }
  }

  const handleDeleteWatchlist = async (entry: WatchlistEntry) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/anpr/watchlist/${entry.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Removed', `${entry.plate_number} removed from watchlist.`)
        loadWatchlist()
      }
    } catch (err) {
      toast.error('Network Error', 'Failed to reach server.')
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
            <span>Number Plate Detection</span>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-600 dark:text-cyan-400">
              ANPR PIPELINE
            </span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Fine-tuned YOLO plate detector + PaddleOCR (PP-OCRv5) read vehicle license plates and flag watchlist matches.
          </p>
        </div>

        <button
          onClick={refreshAll}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      <OcrEngineSelector onBackfillFinished={() => refreshAll()} />

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
                <ScanLine className="h-5 w-5" />
              </div>
              <div>
                <h3 className={`font-bold text-xs uppercase tracking-wider ${
                  modelStatus.model_loaded
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}>
                  {modelStatus.model_loaded ? 'Plate Detector Operational' : 'Model Standby (loads on first scan)'}
                </h3>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                  OCR: <span className="font-mono text-slate-300">{modelStatus.ocr_model}</span> | Device: <span className="font-mono text-cyan-400">{modelStatus.device}</span>
                  {' | '}Vehicle Cascade:{' '}
                  <span className={`font-mono ${modelStatus.vehicle_model_path ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {modelStatus.vehicle_model_path ? 'Enabled' : 'Full-frame fallback'}
                  </span>
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
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Sightings</div>
            <div className="text-2xl font-black text-slate-900 dark:text-slate-100 font-mono">{stats.total_detections}</div>
          </div>
          <div className="rounded-md border border-cyan-500/30 bg-cyan-50/50 dark:bg-cyan-950/20 p-4 space-y-1 shadow-xs">
            <div className="text-xs font-bold text-cyan-700 dark:text-cyan-400 uppercase tracking-wider flex items-center justify-between">
              <span>Unique Plates</span>
              <Car className="w-4 h-4 text-cyan-500" />
            </div>
            <div className="text-2xl font-black text-cyan-600 dark:text-cyan-400 font-mono">{stats.unique_plates}</div>
          </div>
          <div className="rounded-md border border-rose-500/30 bg-rose-50/50 dark:bg-rose-950/20 p-4 space-y-1 shadow-xs">
            <div className="text-xs font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider flex items-center justify-between">
              <span>Watchlist Hits</span>
              <ShieldAlert className="w-4 h-4 text-rose-500" />
            </div>
            <div className="text-2xl font-black text-rose-600 dark:text-rose-400 font-mono">{stats.watchlist_hits}</div>
          </div>
          <div className="rounded-md border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 space-y-1 shadow-xs">
            <div className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Avg Confidence</div>
            <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
              {(stats.average_confidence * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      )}

      {/* SCAN PANEL */}
      <div className="flex flex-wrap items-end gap-3 p-3.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Camera Node</label>
          <select
            value={scanCamera}
            onChange={(e) => setScanCamera(e.target.value)}
            className="h-8 px-3 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-semibold min-w-[160px]"
          >
            <option value="">Select Camera</option>
            {cameras.map(cam => (
              <option key={cam.camera_id} value={cam.camera_id}>{cam.name} ({cam.camera_id})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Video</label>
          <select
            value={scanVideoId}
            onChange={(e) => setScanVideoId(e.target.value)}
            disabled={!scanCamera}
            className="h-8 px-3 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-semibold min-w-[220px] disabled:opacity-50"
          >
            <option value="">Select Video</option>
            {scanVideos.map(v => (
              <option key={v.id} value={v.id}>{v.standardized_filename}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleScan}
          disabled={!scanCamera || !scanVideoId || scanning}
          className="h-8 px-4 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 text-xs font-bold flex items-center gap-1.5 transition-colors"
        >
          {scanning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ScanLine className="w-3.5 h-3.5" />}
          {scanning ? 'Scanning...' : 'Scan for Plates'}
        </button>
      </div>

      {/* TABS */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setTab('detections')}
          className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
            tab === 'detections'
              ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          Detections
        </button>
        <button
          onClick={() => setTab('watchlist')}
          className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
            tab === 'watchlist'
              ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          Watchlist ({watchlist.filter(w => w.status === 'active').length})
        </button>
      </div>

      {tab === 'detections' ? (
        <>
          {/* FILTER BAR */}
          <div className="flex flex-wrap items-center gap-3 p-3.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <Filter className="w-4 h-4 text-slate-500" />
            <select
              value={filterCamera}
              onChange={(e) => setFilterCamera(e.target.value)}
              className="h-8 px-3 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-semibold"
            >
              <option value="">All Camera Nodes</option>
              {cameras.map(cam => (
                <option key={cam.camera_id} value={cam.camera_id}>{cam.name} ({cam.camera_id})</option>
              ))}
            </select>
            <div className="relative">
              <SearchIcon className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search plate text..."
                value={filterPlate}
                onChange={(e) => setFilterPlate(e.target.value)}
                className="h-8 pl-8 pr-3 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-mono"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={watchlistOnly}
                onChange={(e) => setWatchlistOnly(e.target.checked)}
                className="rounded"
              />
              Watchlist hits only
            </label>
          </div>

          {/* DETECTIONS TABLE */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden bg-white dark:bg-slate-900 shadow-xs">
            <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span>Plate Sighting Log</span>
              <span className="font-mono text-cyan-400">{detections.length} Records</span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
                <RefreshCw className="h-5 w-5 animate-spin text-cyan-500" />
                <span>Loading Detections...</span>
              </div>
            ) : detections.length === 0 ? (
              <div className="p-16 text-center text-xs text-slate-400">
                No license plates detected matching current filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full divide-y divide-slate-100 dark:divide-slate-800 text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950/60 text-[10px] text-slate-400 uppercase tracking-wider font-bold">
                    <tr>
                      <th className="px-4 py-3">Cutout</th>
                      <th className="px-4 py-3">Plate</th>
                      <th className="px-4 py-3">Camera</th>
                      <th className="px-4 py-3">Timestamp</th>
                      <th className="px-4 py-3">Confidence</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {detections.map(d => {
                      const thumb = cutoutUrl(d.cutout_path)
                      return (
                        <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="px-4 py-3">
                            {thumb ? (
                              <img src={thumb} alt={d.plate_text} className="h-10 w-20 object-cover rounded border border-slate-700" />
                            ) : (
                              <div className="h-10 w-20 rounded border border-slate-800 bg-slate-950 flex items-center justify-center text-slate-600">
                                <Car className="h-4 w-4" />
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono font-bold text-slate-800 dark:text-slate-100">
                            {d.plate_text}
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                            {getCameraName(d.camera_id)}
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-500 dark:text-slate-400">
                            {formatDisplayDate(d.created_at)}
                          </td>
                          <td className="px-4 py-3 font-mono text-cyan-600 dark:text-cyan-400">
                            {(d.confidence * 100).toFixed(1)}%
                          </td>
                          <td className="px-4 py-3">
                            {d.is_watchlisted ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 border border-rose-500/30 px-2.5 py-0.5 text-[10px] font-bold text-rose-700 dark:text-rose-400 animate-pulse">
                                <ShieldAlert className="h-3 w-3" />
                                Watchlist Match
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 border border-slate-500/30 px-2.5 py-0.5 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                Clear
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* ADD TO WATCHLIST */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3">Add Plate to Watchlist</h3>
            <form onSubmit={handleAddWatchlist} className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Plate Number *</label>
                <input
                  type="text"
                  placeholder="e.g. MH12AB1234"
                  value={newPlate}
                  onChange={(e) => setNewPlate(e.target.value)}
                  className="h-8 px-3 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-mono min-w-[160px]"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Reason</label>
                <input
                  type="text"
                  placeholder="e.g. Stolen vehicle"
                  value={newReason}
                  onChange={(e) => setNewReason(e.target.value)}
                  className="h-8 px-3 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 min-w-[200px]"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Priority</label>
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value)}
                  className="h-8 px-3 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-semibold"
                >
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                  <option value="CRITICAL">Critical</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={addingEntry || !newPlate.trim()}
                className="h-8 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add to Watchlist
              </button>
            </form>
          </div>

          {/* WATCHLIST TABLE */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden bg-white dark:bg-slate-900 shadow-xs">
            <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Watchlisted Plates
            </div>
            {watchlist.length === 0 ? (
              <div className="p-16 text-center text-xs text-slate-400">No plates on the watchlist yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full divide-y divide-slate-100 dark:divide-slate-800 text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950/60 text-[10px] text-slate-400 uppercase tracking-wider font-bold">
                    <tr>
                      <th className="px-4 py-3">Plate</th>
                      <th className="px-4 py-3">Reason</th>
                      <th className="px-4 py-3">Priority</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Matches</th>
                      <th className="px-4 py-3">Last Matched</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {watchlist.map(entry => (
                      <tr key={entry.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold text-slate-800 dark:text-slate-100">{entry.plate_number}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{entry.reason || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                            entry.priority === 'CRITICAL'
                              ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                              : entry.priority === 'HIGH'
                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                              : 'bg-slate-500/10 text-slate-400 border-slate-500/30'
                          }`}>
                            {entry.priority}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                            entry.status === 'active'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : 'bg-slate-500/10 text-slate-400 border-slate-500/30'
                          }`}>
                            {entry.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-400">{entry.match_count}</td>
                        <td className="px-4 py-3 font-mono text-slate-500 dark:text-slate-400">
                          {entry.last_matched_at ? formatDisplayDate(entry.last_matched_at) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right space-x-2">
                          <button
                            onClick={() => handleResolveWatchlist(entry)}
                            className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-[10px] font-bold transition-colors inline-flex items-center gap-1"
                          >
                            {entry.status === 'active' ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            {entry.status === 'active' ? 'Resolve' : 'Reactivate'}
                          </button>
                          <button
                            onClick={() => handleDeleteWatchlist(entry)}
                            className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold transition-colors inline-flex items-center gap-1"
                          >
                            <Trash2 className="h-3 w-3" />
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
