import { useState, useEffect } from 'react'
import {
  Target,
  ShieldAlert,
  CheckCircle2,
  Clock,
  Navigation,
  Play,
  Trash2,
  RefreshCw,
  Search,
  AlertTriangle,
  Radio,
  Check,
  Map
} from 'lucide-react'
import { JourneyMapScrubber } from '../components/JourneyMapScrubber'
import { Link } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { API_BASE } from '../config/api'
import { formatDisplayDate } from '../utils/dateFormatter'

interface HotTarget {
  id: string
  label: string
  object_type: string
  origin_tracklet_id?: string
  origin_camera_id: string
  status: string // 'active' | 'resolved'
  priority: string // 'NORMAL' | 'HIGH' | 'CRITICAL'
  created_at: string
  last_seen_camera_id?: string
  last_seen_timestamp?: string
  matches_count: number
}

interface ReappearanceAlert {
  id: number
  alert_type: string
  camera_id: string
  video_id?: string
  tracklet_id: string
  object_tracklet_id?: string // hot_target_id
  timestamp: string
  acknowledged: boolean
  analysis_log?: string
  target_label?: string
  priority?: string
  best_crop_path?: string
}

interface HotTargetsProps {
  onPlayVideoAtTime: (
    video: any,
    timestamp: number,
    trackerId?: number | string,
    bestBbox?: number[],
    className?: string
  ) => void
}

export default function HotTargets({ onPlayVideoAtTime }: HotTargetsProps) {
  const toast = useToast()
  const [targets, setTargets] = useState<HotTarget[]>([])
  const [alerts, setAlerts] = useState<ReappearanceAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'active' | 'resolved' | 'all'>('active')
  const [searchQuery, setSearchQuery] = useState('')

  // Journey Map Modal state
  const [selectedJourneyTarget, setSelectedJourneyTarget] = useState<HotTarget | null>(null)
  const [journeyData, setJourneyData] = useState<any | null>(null)
  const [loadingJourney, setLoadingJourney] = useState(false)
  const [activeJourneyStep, setActiveJourneyStep] = useState(1)

  useEffect(() => {
    fetchHotTargets()
    fetchReappearanceAlerts()
    const timer = setInterval(() => {
      fetchHotTargets()
      fetchReappearanceAlerts()
    }, 5000)
    return () => clearInterval(timer)
  }, [statusFilter])

  const fetchHotTargets = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/multicam/targets?status=${statusFilter}`)
      if (res.ok) {
        const data = await res.json()
        setTargets(data.targets || [])
      }
    } catch (err) {
      console.error('Failed to fetch hot targets:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchReappearanceAlerts = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/multicam/targets/alerts`)
      if (res.ok) {
        const data = await res.json()
        setAlerts(data.alerts || [])
      }
    } catch (err) {
      console.error('Failed to fetch target alerts:', err)
    }
  }

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const handleToggleStatus = async (targetId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'resolved' : 'active'
    try {
      const res = await fetch(`${API_BASE}/api/v1/multicam/targets/${targetId}/status?status=${newStatus}`, {
        method: 'PUT'
      })
      if (res.ok) {
        toast.success('Status Updated', `Hot target marked as ${newStatus}.`)
        fetchHotTargets()
      }
    } catch (err) {
      toast.error('Error', 'Failed to update target status.')
    }
  }

  const handleDeleteTarget = async (targetId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/multicam/targets/${targetId}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        toast.success('Target Deleted', 'Hot target profile deleted permanently.')
        setConfirmDeleteId(null)
        fetchHotTargets()
      }
    } catch (err) {
      toast.error('Error', 'Failed to delete target profile.')
    }
  }

  const handleAcknowledgeAlert = async (alertId: number) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/multicam/targets/alerts/${alertId}/acknowledge`, {
        method: 'POST'
      })
      if (res.ok) {
        fetchReappearanceAlerts()
      }
    } catch (err) {
      console.error('Failed to acknowledge alert:', err)
    }
  }

  const handleOpenJourneyMap = async (target: HotTarget) => {
    setSelectedJourneyTarget(target)
    setLoadingJourney(true)
    setJourneyData(null)
    try {
      const res = await fetch(`${API_BASE}/api/v1/multicam/targets/${target.id}/journey`)
      if (res.ok) {
        const data = await res.json()
        setJourneyData(data)
      }
    } catch (err) {
      console.error('Failed to fetch target journey map:', err)
    } finally {
      setLoadingJourney(false)
    }
  }

  const filteredTargets = targets.filter((t) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      t.label.toLowerCase().includes(q) ||
      t.origin_camera_id.toLowerCase().includes(q) ||
      (t.last_seen_camera_id && t.last_seen_camera_id.toLowerCase().includes(q))
    )
  })

  const activeCount = targets.filter((t) => t.status === 'active').length
  const resolvedCount = targets.filter((t) => t.status === 'resolved').length
  const criticalCount = targets.filter((t) => t.priority === 'CRITICAL' && t.status === 'active').length

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-200">
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-700 pb-4">
        <div>
          <div>
              <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100 tracking-tight flex flex-wrap items-center gap-2">
                Hot Targets &amp; Persistent Pursuit Control Center
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                </span>
              </h1>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                Centralized dashboard to tag, monitor, track, and manage suspicious vehicles and fleeing suspects across smart city camera nodes.
              </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/multicam"
            className="flex items-center gap-1.5 px-3 py-2 rounded bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700 text-white text-xs font-semibold transition-colors"
          >
            <Map className="h-4 w-4" />
            <span>Open Spatial Journey Map</span>
          </Link>
          <button
            onClick={() => {
              fetchHotTargets()
              fetchReappearanceAlerts()
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh Feed</span>
          </button>
        </div>
      </div>

      {/* KPI METRIC CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 rounded-md space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
            <span>Active Pursuits</span>
            <Radio className="h-4 w-4 text-teal-700 dark:text-teal-300" />
          </div>
          <div className="text-2xl font-semibold text-slate-800 dark:text-slate-100 font-mono">{activeCount}</div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400">Targets under live multi-camera watch</div>
        </div>

        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 rounded-md space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
            <span>Critical Priority</span>
            <AlertTriangle className="h-4 w-4 text-teal-700 dark:text-teal-300" />
          </div>
          <div className="text-2xl font-semibold text-slate-800 dark:text-slate-100 font-mono">{criticalCount}</div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400">High-priority active targets</div>
        </div>

        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 rounded-md space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
            <span>Reappearance Alerts</span>
            <ShieldAlert className="h-4 w-4 text-teal-700 dark:text-teal-300" />
          </div>
          <div className="text-2xl font-semibold text-slate-800 dark:text-slate-100 font-mono">{alerts.length}</div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400">Cross-camera re-detections</div>
        </div>

        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 rounded-md space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
            <span>Resolved / Closed</span>
            <CheckCircle2 className="h-4 w-4 text-teal-700 dark:text-teal-300" />
          </div>
          <div className="text-2xl font-semibold text-slate-800 dark:text-slate-100 font-mono">{resolvedCount}</div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400">Archived target pursuits</div>
        </div>
      </div>

      {/* ALERTS, FILTERS, JOURNEY MAP */}
      <div className="space-y-4">
          {/* REAL-TIME SUSPECT REAPPEARANCE ALERT WINDOW */}
          {alerts.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 dark:bg-rose-950/30 dark:border-rose-800 rounded-md p-4 space-y-3 animate-in slide-in-from-top-2 duration-300">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-rose-800 dark:text-rose-300 font-semibold text-xs">
                  <ShieldAlert className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                  <span>🎯 REAPPEARANCE ALERT FEED</span>
                  <span className="bg-rose-100 dark:bg-rose-500/20 text-rose-800 dark:text-rose-300 text-[10px] px-2 py-0.5 rounded border border-rose-200 dark:border-rose-500/40 font-mono">
                    {alerts.filter((a) => !a.acknowledged).length} NEW
                  </span>
                </div>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {alerts.map((alertItem) => (
                  <div
                    key={alertItem.id}
                    className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 transition-all ${
                      alertItem.acknowledged
                        ? 'bg-white/70 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 opacity-75'
                        : 'bg-white dark:bg-slate-800 border-rose-300 dark:border-rose-700 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-rose-700 dark:text-rose-300 text-xs truncate">
                          {alertItem.target_label || 'Tagged Suspect'}
                        </span>
                        <span className="font-mono text-[9px] bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-1 py-0.5 rounded">
                          {alertItem.camera_id}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-600 dark:text-slate-400 flex items-center gap-1 font-mono">
                        <Clock className="h-3 w-3 text-slate-500 dark:text-slate-400" />
                        <span>{new Date(alertItem.timestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {alertItem.video_id && (
                        <button
                          onClick={() => {
                            onPlayVideoAtTime(
                              { id: alertItem.video_id, camera_id: alertItem.camera_id },
                              0,
                              alertItem.tracklet_id
                            )
                          }}
                          className="px-2 py-1 rounded bg-teal-50 hover:bg-teal-100 dark:bg-teal-900/30 dark:hover:bg-teal-900/50 text-teal-800 dark:text-teal-300 text-[10px] font-semibold border border-teal-200 dark:border-teal-800 transition-colors flex items-center gap-1"
                        >
                          <Play className="h-3 w-3 fill-current" />
                          <span>Stream</span>
                        </button>
                      )}

                      {!alertItem.acknowledged && (
                        <button
                          onClick={() => handleAcknowledgeAlert(alertItem.id)}
                          className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-[10px] font-semibold border border-slate-200 dark:border-slate-600 transition-colors flex items-center gap-1"
                        >
                          <Check className="h-3 w-3 text-emerald-400" />
                          <span>Ack</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* FILTER & SEARCH CONTROL BAR */}
          <div className="flex flex-col sm:flex-row gap-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 rounded-md">
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-900 p-1 rounded border border-slate-200 dark:border-slate-700 sm:w-[360px] sm:shrink-0">
              <button
                onClick={() => setStatusFilter('active')}
                className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all ${
                  statusFilter === 'active'
                    ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                Active ({activeCount})
              </button>
              <button
                onClick={() => setStatusFilter('resolved')}
                className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all ${
                  statusFilter === 'resolved'
                    ? 'bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-800'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                Resolved ({resolvedCount})
              </button>
              <button
                onClick={() => setStatusFilter('all')}
                className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all ${
                  statusFilter === 'all'
                    ? 'bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-800'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                All ({targets.length})
              </button>
            </div>

            <div className="relative w-full">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
              <input
                type="text"
                placeholder="Search suspect label or camera..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded pl-8 pr-3 py-2 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-teal-700 dark:focus:border-teal-400"
              />
            </div>
          </div>
      {/* TARGET CARDS GRID */}
      {loading ? (
        <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400 animate-pulse">
          Loading active hot targets &amp; pursuit profiles...
        </div>
      ) : filteredTargets.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md p-10 text-center space-y-3">
          <Target className="h-8 w-8 text-slate-400 dark:text-slate-500 mx-auto" />
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">No tagged targets found</h3>
          <p className="text-xs text-slate-600 dark:text-slate-300 max-w-md mx-auto">
            You can tag any suspicious person or vehicle from the Search page, Camera Details, or Video Detail screen to begin multi-camera persistent pursuit.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTargets.map((target) => {
            const isCritical = target.priority === 'CRITICAL'
            const isHigh = target.priority === 'HIGH'
            const isActive = target.status === 'active'

            return (
              <div
                key={target.id}
                className={`bg-white dark:bg-slate-800 border rounded-md overflow-hidden flex flex-col justify-between transition-colors ${
                  isActive
                    ? 'border-slate-200 dark:border-slate-700 hover:border-teal-400 dark:hover:border-teal-500'
                    : 'border-slate-200 dark:border-slate-700 opacity-75 bg-slate-50 dark:bg-slate-800/60'
                }`}
              >
                <div className="p-4 space-y-3">
                  {/* Top Bar */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[9px] font-bold px-2 py-0.5 rounded font-mono uppercase ${
                            isCritical || isHigh
                              ? 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600'
                              : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600'
                          }`}
                        >
                          {target.priority}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase">{target.object_type}</span>
                      </div>
                      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mt-1 truncate" title={target.label}>
                        {target.label}
                      </h3>
                    </div>

                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize shrink-0 ${
                        isActive
                          ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-800'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600'
                      }`}
                    >
                      {target.status}
                    </span>
                  </div>

                  {/* Metadata Property Table */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-700 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600 dark:text-slate-300">Origin node</span>
                      <span className="font-mono text-teal-800 dark:text-teal-300 font-semibold bg-teal-50 dark:bg-slate-900 px-1.5 py-0.5 rounded border border-teal-200 dark:border-slate-700">
                        {target.origin_camera_id}
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-slate-600 dark:text-slate-300">Last seen node</span>
                      <span className="font-mono text-teal-800 dark:text-teal-300 font-semibold bg-teal-50 dark:bg-slate-900 px-1.5 py-0.5 rounded border border-teal-200 dark:border-slate-700">
                        {target.last_seen_camera_id || target.origin_camera_id}
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-slate-600 dark:text-slate-300">Cross-camera matches</span>
                      <span className="font-mono text-slate-800 dark:text-slate-100 font-semibold">{target.matches_count} detections</span>
                    </div>

                    <div className="flex justify-between items-center text-[10px] text-slate-500 dark:text-slate-400">
                      <span>Tagged at</span>
                      <span>{target.created_at ? formatDisplayDate(target.created_at) : '--'}</span>
                    </div>
                  </div>
                </div>

                {/* Bottom Action Footer */}
                {confirmDeleteId === target.id ? (
                  <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border-t border-rose-200 dark:border-rose-800 flex items-center justify-between gap-2 animate-in fade-in">
                    <span className="text-[11px] font-semibold text-rose-800 dark:text-rose-300">Permanently delete target profile?</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleDeleteTarget(target.id)}
                        className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold transition-colors"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2.5 py-1 rounded bg-white hover:bg-slate-100 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-[11px] font-medium border border-slate-200 dark:border-slate-600 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
                    <button
                      onClick={() => handleOpenJourneyMap(target)}
                      className="flex-1 py-1.5 px-3 rounded bg-teal-50 hover:bg-teal-100 dark:bg-teal-900/30 dark:hover:bg-teal-900/50 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-800 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Navigation className="h-3.5 w-3.5" />
                      <span>View Journey Map</span>
                    </button>

                    <button
                      onClick={() => handleToggleStatus(target.id, target.status)}
                      className="p-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
                      title={target.status === 'active' ? 'Mark as Resolved' : 'Reactivate Pursuit'}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </button>

                    <button
                      onClick={() => setConfirmDeleteId(target.id)}
                      className="p-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-rose-700 dark:hover:text-rose-300 transition-colors"
                      title="Delete Target Profile"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* JOURNEY MAP SCRUBBER */}
      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md p-4 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex flex-wrap items-center gap-2">
              <span>Live spatial journey map</span>
              {selectedJourneyTarget ? (
                <span className="font-mono text-xs text-rose-800 dark:text-rose-300 font-semibold bg-rose-50 dark:bg-rose-500/20 px-2 py-0.5 rounded border border-rose-200 dark:border-rose-500/30">
                  {selectedJourneyTarget.label}
                </span>
              ) : (
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Select a target card to inspect its journey</span>
              )}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300">Multi-camera trajectory across connected camera nodes.</p>
          </div>
        </div>

        {loadingJourney ? (
          <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400 animate-pulse">Calculating camera journey...</div>
        ) : journeyData ? (
          <JourneyMapScrubber
            steps={journeyData.journey_steps || journeyData.trajectory || []}
            activeStep={activeJourneyStep}
            onSelectStep={(s) => setActiveJourneyStep(s)}
            totalDistanceMeters={journeyData.total_distance_meters || 0}
            totalDurationSeconds={journeyData.total_duration_seconds || 0}
            rejectedCameras={journeyData.rejected_cameras || []}
            limitation={journeyData.limitation}
          />
        ) : (
          <div className="py-8 text-center">
            <Navigation className="h-7 w-7 text-slate-400 dark:text-slate-500 mx-auto" />
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">Choose <span className="font-semibold text-teal-800 dark:text-teal-300">View Journey Map</span> on a target card to inspect its route.</p>
          </div>
        )}
      </section>

      </div>

      {/* JOURNEY MAP MODAL SCRUBBER */}
      {selectedJourneyTarget && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md w-full max-w-4xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex flex-wrap items-center gap-2">
                  <span>🎯 Suspect Pursuit Trajectory Map</span>
                  <span className="font-mono text-xs text-rose-800 dark:text-rose-300 font-semibold bg-rose-50 dark:bg-rose-500/20 px-2 py-0.5 rounded border border-rose-200 dark:border-rose-500/30">
                    {selectedJourneyTarget.label}
                  </span>
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                  Reconstructed spatial-temporal DAG journey map across smart city camera nodes.
                </p>
              </div>

              <button
                onClick={() => setSelectedJourneyTarget(null)}
                className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white hover:bg-slate-100 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold"
              >
                Close
              </button>
            </div>

            {loadingJourney ? (
              <div className="py-16 text-center text-xs text-slate-500 dark:text-slate-400 animate-pulse">
                Calculating multi-camera graph trajectory &amp; spatial deltas...
              </div>
            ) : journeyData ? (
              <JourneyMapScrubber
                steps={journeyData.journey_steps || journeyData.trajectory || []}
                activeStep={activeJourneyStep}
                onSelectStep={(s) => setActiveJourneyStep(s)}
                totalDistanceMeters={journeyData.total_distance_meters || 0}
                totalDurationSeconds={journeyData.total_duration_seconds || 0}
                rejectedCameras={journeyData.rejected_cameras || []}
                limitation={journeyData.limitation}
              />
            ) : (
              <div className="py-10 text-center text-xs text-rose-700 dark:text-rose-300">
                Failed to reconstruct journey map for this target.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
