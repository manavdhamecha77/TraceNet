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

const API_BASE = 'http://localhost:8000'

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

  const handleToggleStatus = async (targetId: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'active' ? 'resolved' : 'active'
    try {
      const res = await fetch(`${API_BASE}/api/v1/multicam/targets/${targetId}/status?status=${nextStatus}`, {
        method: 'PUT'
      })
      if (res.ok) {
        fetchHotTargets()
      }
    } catch (err) {
      console.error('Failed to update target status:', err)
    }
  }

  const handleDeleteTarget = async (targetId: string) => {
    if (!window.confirm('Are you sure you want to delete this tagged hot target permanently?')) return
    try {
      const res = await fetch(`${API_BASE}/api/v1/multicam/targets/${targetId}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        fetchHotTargets()
      }
    } catch (err) {
      console.error('Failed to delete target:', err)
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400">
              <Target className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-100 tracking-tight flex items-center gap-2">
                Hot Targets &amp; Persistent Pursuit Control Center
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  LIVE PURSUIT
                </span>
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Centralized dashboard to tag, monitor, track, and manage suspicious vehicles and fleeing suspects across smart city camera nodes.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/multicam"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-bold transition-colors shadow-sm"
          >
            <Map className="h-4 w-4" />
            <span>Open Spatial Journey Map</span>
          </Link>
          <button
            onClick={() => {
              fetchHotTargets()
              fetchReappearanceAlerts()
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-semibold transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh Feed</span>
          </button>
        </div>
      </div>

      {/* KPI METRIC CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Active Pursuits</span>
            <Radio className="h-4 w-4 text-rose-400 animate-pulse" />
          </div>
          <div className="text-2xl font-black text-rose-400 font-mono">{activeCount}</div>
          <div className="text-[10px] text-slate-500">Targets under live multi-camera watch</div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Critical Priority</span>
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-400 font-mono">{criticalCount}</div>
          <div className="text-[10px] text-slate-500">High-risk fleeing targets</div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Reappearance Alerts</span>
            <ShieldAlert className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-black text-cyan-400 font-mono">{alerts.length}</div>
          <div className="text-[10px] text-slate-500">Cross-camera re-detections</div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Resolved / Closed</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400 font-mono">{resolvedCount}</div>
          <div className="text-[10px] text-slate-500">Archived target pursuits</div>
        </div>
      </div>

      {/* MAIN TWO-COLUMN PURSUIT & TRACKING WORKSPACE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN (5/12): TARGET LIST & ALERTS */}
        <div className="lg:col-span-5 space-y-6">
          {/* REAL-TIME SUSPECT REAPPEARANCE ALERT WINDOW */}
          {alerts.length > 0 && (
            <div className="bg-rose-950/30 border border-rose-500/40 rounded-xl p-4 space-y-3 animate-in slide-in-from-top-2 duration-300">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-rose-300 font-bold text-xs">
                  <ShieldAlert className="h-4 w-4 animate-bounce text-rose-400" />
                  <span>🎯 REAPPEARANCE ALERT FEED</span>
                  <span className="bg-rose-500/20 text-rose-300 text-[10px] px-2 py-0.5 rounded-full border border-rose-500/40 font-mono">
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
                        ? 'bg-slate-900/50 border-slate-800 text-slate-400 opacity-60'
                        : 'bg-slate-900 border-rose-500/40 text-slate-200 shadow-md ring-1 ring-rose-500/20'
                    }`}
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-rose-400 text-xs truncate">
                          {alertItem.target_label || 'Tagged Suspect'}
                        </span>
                        <span className="font-mono text-[9px] bg-slate-800 text-slate-300 px-1 py-0.2 rounded">
                          {alertItem.camera_id}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-1 font-mono">
                        <Clock className="h-3 w-3 text-slate-500" />
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
                          className="px-2 py-1 rounded bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 text-[10px] font-bold border border-teal-500/30 transition-colors flex items-center gap-1"
                        >
                          <Play className="h-3 w-3 fill-current" />
                          <span>Stream</span>
                        </button>
                      )}

                      {!alertItem.acknowledged && (
                        <button
                          onClick={() => handleAcknowledgeAlert(alertItem.id)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold border border-slate-700 transition-colors flex items-center gap-1"
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
          <div className="flex flex-col gap-2 bg-slate-900/60 border border-slate-800 p-3 rounded-xl">
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 w-full">
              <button
                onClick={() => setStatusFilter('active')}
                className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all ${
                  statusFilter === 'active'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Active ({activeCount})
              </button>
              <button
                onClick={() => setStatusFilter('resolved')}
                className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all ${
                  statusFilter === 'resolved'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Resolved ({resolvedCount})
              </button>
              <button
                onClick={() => setStatusFilter('all')}
                className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all ${
                  statusFilter === 'all'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All ({targets.length})
              </button>
            </div>

            <div className="relative w-full">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search suspect label or camera..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-rose-500/50"
              />
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN (7/12): LIVE EMBEDDED JOURNEY MAP SCRUBBER */}
        <div className="lg:col-span-7 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>🎯 Live Spatial Journey Map</span>
                {selectedJourneyTarget ? (
                  <span className="font-mono text-xs text-rose-400 font-bold bg-rose-500/20 px-2 py-0.5 rounded border border-rose-500/30">
                    {selectedJourneyTarget.label}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-500 font-mono">Select a target on left to inspect DAG</span>
                )}
              </h3>
              <p className="text-[11px] text-slate-400">
                Multi-camera spatial-temporal trajectory map &amp; velocity vectors across city nodes.
              </p>
            </div>
          </div>

          {loadingJourney ? (
            <div className="py-24 text-center text-xs text-slate-500 animate-pulse">
              Calculating multi-camera spatial graph trajectory...
            </div>
          ) : journeyData ? (
            <JourneyMapScrubber
              steps={journeyData.trajectory || []}
              activeStep={activeJourneyStep}
              onSelectStep={(s) => setActiveJourneyStep(s)}
              totalDistanceMeters={journeyData.total_distance_meters || 0}
              totalDurationSeconds={journeyData.total_duration_seconds || 0}
            />
          ) : (
            <div className="py-20 text-center space-y-2">
              <Navigation className="h-8 w-8 text-slate-700 mx-auto" />
              <p className="text-xs text-slate-500">
                Click <span className="text-rose-400 font-semibold font-mono">View Journey Map</span> on any suspect card on the left to illuminate their spatial trajectory.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* TARGET CARDS GRID */}
      {loading ? (
        <div className="py-20 text-center text-xs text-slate-500 animate-pulse">
          Loading active hot targets &amp; pursuit profiles...
        </div>
      ) : filteredTargets.length === 0 ? (
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-12 text-center space-y-3">
          <Target className="h-10 w-10 text-slate-600 mx-auto" />
          <h3 className="text-sm font-bold text-slate-300">No Tagged Targets Found</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
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
                className={`bg-slate-900 border rounded-xl overflow-hidden flex flex-col justify-between transition-all ${
                  isActive
                    ? 'border-slate-800 hover:border-rose-500/40'
                    : 'border-slate-800/60 opacity-75 bg-slate-900/40'
                }`}
              >
                <div className="p-4 space-y-3">
                  {/* Top Bar */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[9px] font-bold px-2 py-0.5 rounded font-mono uppercase ${
                            isCritical
                              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                              : isHigh
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {target.priority}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500 uppercase">{target.object_type}</span>
                      </div>
                      <h3 className="text-sm font-bold text-slate-100 mt-1 truncate" title={target.label}>
                        {target.label}
                      </h3>
                    </div>

                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize shrink-0 ${
                        isActive
                          ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30 animate-pulse'
                          : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      }`}
                    >
                      {target.status}
                    </span>
                  </div>

                  {/* Metadata Property Table */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-800/80 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Origin Node:</span>
                      <span className="font-mono text-teal-400 font-bold bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                        {target.origin_camera_id}
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Last Seen Node:</span>
                      <span className="font-mono text-cyan-400 font-bold bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                        {target.last_seen_camera_id || target.origin_camera_id}
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Cross-Cam Matches:</span>
                      <span className="font-mono text-slate-200 font-bold">{target.matches_count} detections</span>
                    </div>

                    <div className="flex justify-between items-center text-[10px] text-slate-500">
                      <span>Tagged At:</span>
                      <span>{target.created_at ? new Date(target.created_at).toLocaleString() : '--'}</span>
                    </div>
                  </div>
                </div>

                {/* Bottom Action Footer */}
                <div className="p-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-2">
                  <button
                    onClick={() => handleOpenJourneyMap(target)}
                    className="flex-1 py-1.5 px-3 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                  >
                    <Navigation className="h-3.5 w-3.5" />
                    <span>View Journey Map</span>
                  </button>

                  <button
                    onClick={() => handleToggleStatus(target.id, target.status)}
                    className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-emerald-400 transition-colors"
                    title={target.status === 'active' ? 'Mark as Resolved' : 'Reactivate Pursuit'}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                  </button>

                  <button
                    onClick={() => handleDeleteTarget(target.id)}
                    className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-rose-400 transition-colors"
                    title="Delete Target Profile"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* JOURNEY MAP MODAL SCRUBBER */}
      {selectedJourneyTarget && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <span>🎯 Suspect Pursuit Trajectory Map</span>
                  <span className="font-mono text-xs text-rose-400 font-bold bg-rose-500/20 px-2 py-0.5 rounded border border-rose-500/30">
                    {selectedJourneyTarget.label}
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Reconstructed spatial-temporal DAG journey map across smart city camera nodes.
                </p>
              </div>

              <button
                onClick={() => setSelectedJourneyTarget(null)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Close
              </button>
            </div>

            {loadingJourney ? (
              <div className="py-20 text-center text-xs text-slate-500 animate-pulse">
                Calculating multi-camera graph trajectory &amp; spatial deltas...
              </div>
            ) : journeyData ? (
              <JourneyMapScrubber
                steps={journeyData.trajectory || []}
                activeStep={activeJourneyStep}
                onSelectStep={(s) => setActiveJourneyStep(s)}
                totalDistanceMeters={journeyData.total_distance_meters || 0}
                totalDurationSeconds={journeyData.total_duration_seconds || 0}
              />
            ) : (
              <div className="py-10 text-center text-xs text-rose-400">
                Failed to reconstruct journey map for this target.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
