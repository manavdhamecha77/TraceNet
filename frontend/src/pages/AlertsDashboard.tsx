import { useState, useEffect, useCallback } from 'react'
import {
  AlertTriangle, ShieldAlert, Package, CheckCheck,
  RefreshCw, Filter, ChevronRight,
  ShieldCheck, ArrowUpRight, CheckSquare, Square, Car
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader, StatusBadge, Button, StatTile, CardSkeleton, TableSkeleton } from '../components/ui'
import { useToast } from '../components/Toast'
import { formatDisplayDate } from '../utils/dateFormatter'
import type { AlertEntry, Camera } from '../types/alerts'
import { TRACKLET_THUMB } from '../types/alerts'
import { API_BASE } from '../config/api'
import { DEMO_OPERATOR } from '../config/operator'

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
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, acknowledged: true, acknowledged_by: DEMO_OPERATOR, acknowledged_at: new Date().toISOString() } : a))
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
      <PageHeader
        title="Aggregated Security Alerts"
        badges={<StatusBadge tone="brand" dot={false}>Overview dashboard</StatusBadge>}
        subtitle="Unified real-time feed of all security alerts across cameras. Open a dedicated page to run analysis or configure parameters."
        actions={<Button icon={RefreshCw} onClick={loadData}>Refresh feed</Button>}
        className="border-b border-slate-200 pb-4 dark:border-slate-700"
      />

      {/* Aggregated Stat Cards */}
      {loading && !summary ? (
        <CardSkeleton count={4} />
      ) : (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <StatTile label="Total alerts" value={totalCount} detail="All logged incidents" tone="neutral" />
          <StatTile label="Unacknowledged" value={unackCount} detail="Requires security review" tone={unackCount > 0 ? 'warning' : 'neutral'} icon={AlertTriangle} />
          <StatTile label="Abandoned / unattended" value={abandonedCount + unattendedCount} detail="Luggage and static items" tone="neutral" icon={Package} to="/alerts/abandoned" />
          <StatTile label="Outdoor theft" value={theftCount} detail="Chain snatching and violent theft" tone={theftCount > 0 ? 'danger' : 'neutral'} icon={ShieldAlert} to="/alerts/theft" />
        </div>
      )}

      {/* Dedicated Execution Banners */}
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-3">
        <Link
          to="/alerts/abandoned"
          className="p-4 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-amber-400 dark:hover:border-amber-600 transition-colors group flex flex-col items-start"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300"><Package className="w-4 h-4" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Dedicated analysis</p>
              <h3 className="mt-0.5 text-sm font-semibold leading-5 text-slate-800 dark:text-slate-100">Abandoned objects</h3>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-300">Run timeline analysis, adjust stationarity thresholds, and review unattended luggage.</p>
          <div className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-semibold text-teal-800 group-hover:text-teal-900 dark:text-teal-300 dark:group-hover:text-teal-200">
            Open analysis <ArrowUpRight className="w-3.5 h-3.5" />
          </div>
        </Link>

        <Link
          to="/alerts/theft"
          className="p-4 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-rose-400 dark:hover:border-rose-700 transition-colors group flex flex-col items-start"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300"><ShieldAlert className="w-4 h-4" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Dedicated analysis</p>
              <h3 className="mt-0.5 text-sm font-semibold leading-5 text-slate-800 dark:text-slate-100">Outdoor theft analytics</h3>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-300">Review 4 FPS proximity and fall analysis, calibrate speed vectors, and inspect snatch incidents.</p>
          <div className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-semibold text-teal-800 group-hover:text-teal-900 dark:text-teal-300 dark:group-hover:text-teal-200">
            Open analysis <ArrowUpRight className="w-3.5 h-3.5" />
          </div>
        </Link>

        <Link
          to="/assault-detection"
          className="p-4 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-violet-400 dark:hover:border-violet-700 transition-colors group flex flex-col items-start"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-300"><ShieldCheck className="w-4 h-4" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Dedicated analysis</p>
              <h3 className="mt-0.5 text-sm font-semibold leading-5 text-slate-800 dark:text-slate-100">Assault detection</h3>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-300">Inspect frame-level detections, review confidence spikes, and examine assault events.</p>
          <div className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-semibold text-teal-800 group-hover:text-teal-900 dark:text-teal-300 dark:group-hover:text-teal-200">
            Open analysis <ArrowUpRight className="w-3.5 h-3.5" />
          </div>
        </Link>

        <Link
          to="/alerts/plates"
          className="p-4 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-teal-400 dark:hover:border-teal-600 transition-colors group flex flex-col items-start"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/50 dark:text-teal-300"><Car className="w-4 h-4" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Dedicated analysis</p>
              <h3 className="mt-0.5 text-sm font-semibold leading-5 text-slate-800 dark:text-slate-100">Number plate detection</h3>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-300">Scan video for plates, review OCR sightings, and manage the plate watchlist.</p>
          <div className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-semibold text-teal-800 group-hover:text-teal-900 dark:text-teal-300 dark:group-hover:text-teal-200">
            Open analysis <ArrowUpRight className="w-3.5 h-3.5" />
          </div>
        </Link>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
            <Filter className="w-3.5 h-3.5" /> Filter:
          </div>

          {/* Anomaly Type */}
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="h-8 px-2.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-medium"
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
            className="h-8 px-2.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-medium"
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
              className="h-8 px-2.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-medium"
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
              className="px-3 py-1.5 rounded bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700 text-white text-xs font-semibold transition-colors flex items-center gap-1 animate-in fade-in"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Acknowledge Selected ({selectedAlertIds.length})
            </button>
          )}
          <button
            onClick={toggleSelectAllUnack}
            className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5"
          >
            <CheckSquare className="w-3.5 h-3.5 text-teal-700 dark:text-teal-300" />
            Select Unacknowledged
          </button>
        </div>
      </div>

      {/* Feed Grid */}
      {loading ? (
        <div className="rounded border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <TableSkeleton rows={5} columns={6} label="Loading alerts" />
        </div>
      ) : alerts.length === 0 ? (
        <div className="py-12 text-center border border-dashed border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800">
          <ShieldCheck className="w-8 h-8 text-slate-400 mx-auto mb-2" />
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">No alerts found</h3>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 max-w-sm mx-auto">
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
                className={`p-4 rounded-md border transition-all ${
                  alert.acknowledged
                    ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
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
                      className="mt-1 text-slate-500 hover:text-teal-700 dark:hover:text-teal-300 transition-colors"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-teal-700 dark:text-teal-300" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-500 dark:text-slate-400" />
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

                        <span className="text-xs text-slate-600 dark:text-slate-300 font-mono">
                          {alert.camera_id} · {formatDisplayDate(alert.timestamp)}
                        </span>

                        {alert.acknowledged && alert.acknowledged_by && (
                          <span className="text-[10px] font-mono text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-500/30 px-2 py-0.5 rounded">
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
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700 text-white text-xs font-semibold rounded transition-colors"
                      >
                        <CheckCheck className="w-3.5 h-3.5" />
                        Ack
                      </button>
                    )}

                    <Link
                      to={isTheft ? '/alerts/theft' : '/alerts/abandoned'}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold transition-colors"
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
