import { useState, useEffect, useCallback } from 'react'
import {
  AlertTriangle, ShieldAlert, Package, CheckCheck,
  RefreshCw, Filter, ChevronRight,
  ShieldCheck, Loader2, ArrowUpRight, CheckSquare, Square
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { formatDisplayDate } from '../utils/dateFormatter'
import type { AlertEntry, Camera } from '../types/alerts'
import { TRACKLET_THUMB } from '../types/alerts'

const API_BASE = 'http://localhost:8000'

interface AlertsDashboardProps {
  cameras?: Camera[]
  onPlayVideoAtTime?: (
    video: any,
    timestamp: number,
    trackerId?: number | string,
    bestBbox?: number[],
    className?: string,
    tag?: string,
    color?: string
  ) => void
}

function TrackletThumb({ trackletId, label }: { trackletId: string; label: string }) {
  const [err, setErr] = useState(false)
  return (
    <div className="flex flex-col items-center gap-1">
      {!err ? (
        <img
          src={TRACKLET_THUMB(trackletId)}
          alt={label}
          className="w-11 h-11 rounded object-cover border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
          onError={() => setErr(true)}
        />
      ) : (
        <div className="w-11 h-11 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
          <Package className="w-4 h-4 text-slate-400 dark:text-slate-600" />
        </div>
      )}
      <span className="text-[9px] text-slate-500 dark:text-slate-400 font-mono leading-none max-w-[50px] truncate">
        {trackletId.split('_trk_')[1] || trackletId.substring(0, 6)}
      </span>
    </div>
  )
}

export default function AlertsDashboard({ cameras = [], onPlayVideoAtTime }: AlertsDashboardProps) {
  const toast = useToast()
  const [alerts, setAlerts] = useState<AlertEntry[]>([])
  const [summary, setSummary] = useState<{ total_alerts: number; unacknowledged_alerts: number; by_type: Record<string, number> } | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState<string>('all')
  const [filterCamera, setFilterCamera] = useState<string>('')
  const [filterAck, setFilterAck] = useState<string>('all')
  const [selectedAlertIds, setSelectedAlertIds] = useState<number[]>([])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterCamera) params.append('camera_id', filterCamera)
      if (filterAck === 'unack') params.append('acknowledged', 'false')
      if (filterAck === 'ack') params.append('acknowledged', 'true')
      if (filterType !== 'all') params.append('alert_type', filterType)

      const [aRes, sRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/alerts?${params}`),
        fetch(`${API_BASE}/api/v1/alerts/summary`),
      ])

      if (aRes.ok) setAlerts(await aRes.json())
      if (sRes.ok) setSummary(await sRes.json())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [filterCamera, filterAck, filterType])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleAcknowledge = async (alertId: number) => {
    try {
      await fetch(`${API_BASE}/api/v1/alerts/${alertId}/acknowledge`, { method: 'PUT' })
      toast.success('Alert Acknowledged', `Security Incident #${alertId} updated.`)
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, acknowledged: true, acknowledged_by: 'Operator (Badge #4082)', acknowledged_at: new Date().toISOString() } : a))
      setSummary(prev => prev ? { ...prev, unacknowledged_alerts: Math.max(0, prev.unacknowledged_alerts - 1) } : prev)
    } catch (e) {
      toast.error('Error', 'Failed to acknowledge alert.')
    }
  }

  const handleBulkAcknowledge = async () => {
    if (selectedAlertIds.length === 0) return
    try {
      await Promise.all(
        selectedAlertIds.map((id) =>
          fetch(`${API_BASE}/api/v1/alerts/${id}/acknowledge`, { method: 'PUT' })
        )
      )
      toast.success('Bulk Acknowledged', `Successfully acknowledged ${selectedAlertIds.length} security alerts.`)
      setSelectedAlertIds([])
      loadData()
    } catch (e) {
      toast.error('Bulk Error', 'Failed to acknowledge selected alerts.')
    }
  }

  const toggleSelectAlert = (id: number) => {
    setSelectedAlertIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
  }

  const toggleSelectAllUnack = () => {
    const unackIds = alerts.filter(a => !a.acknowledged).map(a => a.id)
    if (unackIds.every(id => selectedAlertIds.includes(id))) {
      setSelectedAlertIds(prev => prev.filter(id => !unackIds.includes(id)))
    } else {
      setSelectedAlertIds(prev => Array.from(new Set([...prev, ...unackIds])))
    }
  }

  const handleTrack = async (videoId: string, trackletIdStr: string, tag: string, color: string) => {
    if (!onPlayVideoAtTime) return
    const trkNum = trackletIdStr.includes('_trk_') ? trackletIdStr.split('_trk_')[1] : trackletIdStr

    try {
      const [vRes, dRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/videos/${videoId}`),
        fetch(`${API_BASE}/data/processed/detections/${videoId}/detections.json`),
      ])

      if (!vRes.ok) return
      const videoData = await vRes.json()
      const videoAsset = videoData.video || videoData

      let timestamp = 0
      let bestBbox: number[] | undefined = undefined
      let className = 'object'

      if (dRes.ok) {
        const dData = await dRes.json()
        const tracklets = dData.tracklets || []
        const matched = tracklets.find((t: any) => String(t.tracker_id) === String(trkNum))
        if (matched) {
          timestamp = matched.timestamp_start_seconds ?? 0
          bestBbox = matched.best_bbox
          className = matched.class_name ?? className
        }
      }

      onPlayVideoAtTime(videoAsset, timestamp, trkNum, bestBbox, className, tag, color)
    } catch (e) {
      console.error('Failed to launch video tracking:', e)
    }
  }

  const totalCount = summary?.total_alerts || alerts.length
  const unackCount = summary?.unacknowledged_alerts || alerts.filter(a => !a.acknowledged).length
  const abandonedCount = summary?.by_type?.['abandoned_object'] || 0
  const unattendedCount = summary?.by_type?.['unattended_object'] || 0
  const theftCount = summary?.by_type?.['chain_snatching'] || 0

  return (
    <div className="space-y-6 pb-24 text-slate-800 dark:text-slate-100">
      {/* Overview Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span>Aggregated Security Alerts</span>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-600 dark:text-cyan-400">
              Overview Dashboard
            </span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Unified real-time feed of all security alerts across cameras. Click a dedicated page to run analysis or configure parameters.
          </p>
        </div>

        <button
          onClick={loadData}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh Feed
        </button>
      </div>

      {/* Aggregated Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Alerts</div>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 mt-1">{totalCount}</div>
          <div className="text-[11px] text-slate-500 mt-1">All logged incidents</div>
        </div>

        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-50/50 dark:bg-rose-950/20 shadow-xs">
          <div className="text-xs font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider flex items-center justify-between">
            <span>Unacknowledged</span>
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-extrabold text-rose-600 dark:text-rose-400 mt-1">{unackCount}</div>
          <div className="text-[11px] text-rose-600/80 dark:text-rose-400/80 mt-1">Requires security review</div>
        </div>

        <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 shadow-xs">
          <div className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center justify-between">
            <span>Abandoned / Unattended</span>
            <Package className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-extrabold text-amber-600 dark:text-amber-400 mt-1">{abandonedCount + unattendedCount}</div>
          <div className="text-[11px] text-amber-600/80 dark:text-amber-400/80 mt-1">Luggage & static items</div>
        </div>

        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-50/50 dark:bg-rose-950/20 shadow-xs">
          <div className="text-xs font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider flex items-center justify-between">
            <span>Outdoor Theft</span>
            <ShieldAlert className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-extrabold text-rose-600 dark:text-rose-400 mt-1">{theftCount}</div>
          <div className="text-[11px] text-rose-600/80 dark:text-rose-400/80 mt-1">Chain snatching & violent theft</div>
        </div>
      </div>

      {/* Dedicated Execution Banners */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Link
          to="/alerts/abandoned"
          className="p-4 rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-50/80 to-white dark:from-amber-950/20 dark:to-slate-900 hover:border-amber-500/60 transition-all group flex items-center justify-between"
        >
          <div className="space-y-1">
            <div className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
              <Package className="w-4 h-4" /> Dedicated Page: Abandoned Objects
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Run post-processing timeline analysis, edit stationarity thresholds, and inspect unattended luggage.
            </p>
          </div>
          <div className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold shrink-0 group-hover:bg-amber-600 transition-colors ml-4">
            <span>Open Page</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </div>
        </Link>

        <Link
          to="/alerts/theft"
          className="p-4 rounded-xl border border-rose-500/30 bg-gradient-to-br from-rose-50/80 to-white dark:from-rose-950/20 dark:to-slate-900 hover:border-rose-500/60 transition-all group flex items-center justify-between"
        >
          <div className="space-y-1">
            <div className="text-xs font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4" /> Dedicated Page: Outdoor Theft Analytics
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Run 4 FPS kinematic proximity & fall analysis, calibrate speed vectors, and inspect snatch incidents.
            </p>
          </div>
          <div className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold shrink-0 group-hover:bg-rose-700 transition-colors ml-4">
            <span>Open Page</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </div>
        </Link>

        <Link
          to="/assault-detection"
          className="p-4 rounded-xl border border-violet-500/30 bg-gradient-to-br from-violet-50/80 to-white dark:from-violet-950/20 dark:to-slate-900 hover:border-violet-500/60 transition-all group flex items-center justify-between"
        >
          <div className="space-y-1">
            <div className="text-xs font-bold text-violet-600 dark:text-violet-400 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" /> Dedicated Page: Assault Detection
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Run frame-level inspection, view confidence spikes, and review detected physical assaults.
            </p>
          </div>
          <div className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-bold shrink-0 group-hover:bg-violet-700 transition-colors ml-4">
            <span>Open Page</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </div>
        </Link>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
            <Filter className="w-3.5 h-3.5" /> Filter:
          </div>

          {/* Anomaly Type */}
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="h-8 px-2.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-semibold"
          >
            <option value="all">All Anomaly Types</option>
            <option value="abandoned_object">Abandoned Objects</option>
            <option value="unattended_object">Unattended Luggage</option>
            <option value="chain_snatching">Outdoor Theft & Snatching</option>
          </select>

          {/* Acknowledged Status */}
          <select
            value={filterAck}
            onChange={e => setFilterAck(e.target.value)}
            className="h-8 px-2.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-semibold"
          >
            <option value="all">All Review Statuses</option>
            <option value="unack">Unacknowledged Only</option>
            <option value="ack">Acknowledged Only</option>
          </select>

          {/* Camera Filter */}
          {cameras.length > 0 && (
            <select
              value={filterCamera}
              onChange={e => setFilterCamera(e.target.value)}
              className="h-8 px-2.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-semibold"
            >
              <option value="">All Camera Nodes</option>
              {cameras.map((c: Camera) => (
                <option key={c.camera_id} value={c.camera_id}>{c.name} ({c.camera_id})</option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-2">
          {selectedAlertIds.length > 0 && (
            <button
              onClick={handleBulkAcknowledge}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors flex items-center gap-1 shadow-md animate-in fade-in"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Acknowledge Selected ({selectedAlertIds.length})
            </button>
          )}
          <button
            onClick={toggleSelectAllUnack}
            className="px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition-colors flex items-center gap-1.5"
          >
            <CheckSquare className="w-3.5 h-3.5 text-cyan-400" />
            Select Unacknowledged
          </button>
        </div>
      </div>

      {/* Feed Grid */}
      {loading ? (
        <div className="py-12 flex justify-center items-center text-slate-400 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-cyan-500" />
          <span>Loading Aggregated Alerts Feed...</span>
        </div>
      ) : alerts.length === 0 ? (
        <div className="py-16 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
          <ShieldCheck className="w-8 h-8 text-slate-400 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">No Alerts Found</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            No logged incidents match the selected filter criteria.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {alerts.map(alert => {
            const isTheft = alert.alert_type === 'chain_snatching'
            const isUnattended = alert.alert_type === 'unattended_object'
            const objId = alert.object_tracklet_id
            const ownerId = alert.owner_tracklet_ids?.[0] || alert.tracklet_id
            const isSelected = selectedAlertIds.includes(alert.id)

            return (
              <div
                key={alert.id}
                className={`p-4 rounded-xl border transition-all ${
                  alert.acknowledged
                    ? 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60'
                    : isTheft
                    ? 'border-rose-500/40 bg-rose-50/50 dark:border-rose-500/30 dark:bg-rose-950/20'
                    : isUnattended
                    ? 'border-teal-500/30 bg-teal-50/50 dark:border-teal-500/30 dark:bg-teal-950/20'
                    : 'border-amber-500/30 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-950/20'
                } ${isSelected ? 'ring-2 ring-cyan-500/50' : ''}`}
              >
                <div className="flex items-start justify-between gap-4 flex-wrap sm:flex-nowrap">
                  <div className="flex items-start gap-3 min-w-0">
                    {/* Checkbox for bulk selection */}
                    <button
                      onClick={() => toggleSelectAlert(alert.id)}
                      className="mt-1 text-slate-500 hover:text-cyan-400 transition-colors"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-cyan-400" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-600" />
                      )}
                    </button>
                    <div className="shrink-0">
                      {objId ? (
                        <TrackletThumb trackletId={objId} label="Object" />
                      ) : (
                        <div className="w-11 h-11 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
                          {isTheft ? <ShieldAlert className="w-5 h-5 text-rose-500" /> : <Package className="w-5 h-5 text-amber-500" />}
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1 rounded px-2.5 py-0.5 text-xs font-bold border ${
                          alert.acknowledged
                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-500/30 dark:text-emerald-400'
                            : isTheft
                            ? 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:bg-rose-950/40 dark:border-rose-500/30 dark:text-rose-400'
                            : isUnattended
                            ? 'bg-teal-500/10 border-teal-500/20 text-teal-700 dark:bg-teal-950/30 dark:border-teal-500/30 dark:text-teal-400'
                            : 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:bg-amber-950/40 dark:border-amber-500/30 dark:text-amber-400'
                        }`}>
                          {alert.acknowledged ? <CheckCheck className="w-3.5 h-3.5" /> : isTheft ? <ShieldAlert className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                          {alert.acknowledged ? 'Acknowledged' : isTheft ? 'Outdoor Theft & Snatching' : isUnattended ? 'Unattended Luggage' : 'Abandoned Object'}
                        </span>

                        <span className="text-xs text-slate-500 font-mono">
                          {alert.camera_id} · {formatDisplayDate(alert.timestamp)}
                        </span>

                        {alert.acknowledged && alert.acknowledged_by && (
                          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5 rounded">
                            Verified by: {alert.acknowledged_by} {alert.acknowledged_at ? `at ${formatDisplayDate(alert.acknowledged_at, true)}` : ''}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        {alert.video_id && objId && (
                          <button
                            onClick={() => handleTrack(alert.video_id!, objId, isTheft ? 'SUSPECT' : 'OBJECT', '#FF0033')}
                            className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-colors"
                          >
                            Track {isTheft ? 'Vehicle' : 'Object'}
                          </button>
                        )}
                        {alert.video_id && ownerId && (
                          <button
                            onClick={() => handleTrack(alert.video_id!, ownerId, isTheft ? 'VICTIM' : 'OWNER', '#00E676')}
                            className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                          >
                            Track {isTheft ? 'Victim' : 'Owner'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {!alert.acknowledged && (
                      <button
                        onClick={() => handleAcknowledge(alert.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors"
                      >
                        <CheckCheck className="w-3.5 h-3.5" />
                        Ack
                      </button>
                    )}

                    <Link
                      to={isTheft ? '/alerts/theft' : '/alerts/abandoned'}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition-colors"
                    >
                      <span>Dedicated Page</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
