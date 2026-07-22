import { useState, useEffect, useRef, useCallback } from 'react'
import {
  AlertTriangle, ShieldCheck, Eye, ChevronDown,
  ChevronUp, Play, Clock, Users, Package, CheckCheck,
  RefreshCw, Settings2, Loader2, ToggleLeft, ToggleRight,
  Radio, SlidersHorizontal, UserCheck, UserX, Minus
} from 'lucide-react'

const API_BASE = 'http://localhost:8000'

interface AlertEntry {
  id: number
  alert_type: string
  camera_id: string
  video_id?: string
  tracklet_id: string
  object_tracklet_id?: string
  owner_tracklet_ids: string[]
  visitor_tracklet_ids: string[]
  reid_match_tracklet_id?: string
  abandon_duration_seconds?: number
  analysis_log?: string
  timestamp: string
  acknowledged: boolean
}

interface AnalysisLogEntry {
  video_id: string
  video_name: string
  camera_name: string
  eligible: boolean
  skip_reason?: string
  alerts_created: number
  log_entries: string[]
  status: 'running' | 'complete' | 'skipped' | 'error'
}

interface Camera {
  camera_id: string
  name: string
  participate_in_alerts?: boolean
}

interface AlertsPageProps {
  cameras?: Camera[]
}

const TRACKLET_THUMB = (trackletId: string) =>
  `${API_BASE}/data/processed/detections/${trackletId.split('_trk_')[0]}/crops/${trackletId}.jpg`

function TrackletThumb({ trackletId, label }: { trackletId: string; label: string }) {
  const [err, setErr] = useState(false)
  return (
    <div className="flex flex-col items-center gap-1">
      {!err ? (
        <img
          src={TRACKLET_THUMB(trackletId)}
          alt={label}
          className="w-12 h-12 rounded object-cover border border-slate-700 bg-slate-800"
          onError={() => setErr(true)}
        />
      ) : (
        <div className="w-12 h-12 rounded border border-slate-700 bg-slate-800 flex items-center justify-center">
          <UserX className="w-4 h-4 text-slate-600" />
        </div>
      )}
      <span className="text-[9px] text-slate-500 font-mono leading-none max-w-[52px] truncate">
        {trackletId.split('_trk_')[1] || trackletId.substring(0, 6)}
      </span>
    </div>
  )
}

function AbandonedAlertCard({ alert, onAcknowledge }: { alert: AlertEntry; onAcknowledge: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [acking, setAcking] = useState(false)

  const handleAck = async () => {
    setAcking(true)
    try {
      await fetch(`${API_BASE}/api/v1/alerts/${alert.id}/acknowledge`, { method: 'PUT' })
      onAcknowledge(alert.id)
    } finally {
      setAcking(false)
    }
  }

  const durationStr = alert.abandon_duration_seconds
    ? `${alert.abandon_duration_seconds.toFixed(1)}s`
    : null

  return (
    <div
      className={`rounded-xl border transition-all ${
        alert.acknowledged
          ? 'border-slate-700/50 bg-slate-900/50'
          : 'border-rose-500/30 bg-rose-950/10 shadow-sm shadow-rose-500/5'
      }`}
    >
      {/* Card Header */}
      <div className="p-4 flex items-start gap-3">
        {/* Object thumbnail */}
        <div className="shrink-0">
          {alert.object_tracklet_id ? (
            <TrackletThumb trackletId={alert.object_tracklet_id} label="Object" />
          ) : (
            <div className="w-12 h-12 rounded border border-slate-700 bg-slate-800 flex items-center justify-center">
              <Package className="w-5 h-5 text-slate-500" />
            </div>
          )}
          <div className="text-[8px] text-center text-slate-500 mt-0.5">Object</div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border ${
              alert.acknowledged
                ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-400'
                : 'bg-rose-950/40 border-rose-500/30 text-rose-400'
            }`}>
              {alert.acknowledged ? <CheckCheck className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
              {alert.acknowledged ? 'Acknowledged' : 'Abandoned Object'}
            </span>
            {durationStr && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold bg-amber-950/30 border border-amber-500/30 text-amber-400">
                <Clock className="w-3 h-3" />
                {durationStr} unattended
              </span>
            )}
          </div>

          <div className="mt-1.5 text-xs text-slate-400">
            <span className="font-medium text-slate-300">{alert.camera_id}</span>
            <span className="mx-1.5 text-slate-600">·</span>
            <span>{new Date(alert.timestamp).toLocaleString()}</span>
          </div>

          {/* Owner / Visitor strips */}
          {(alert.owner_tracklet_ids.length > 0 || alert.visitor_tracklet_ids.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-4">
              {alert.owner_tracklet_ids.length > 0 && (
                <div>
                  <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <UserCheck className="w-3 h-3" /> Owner(s)
                  </div>
                  <div className="flex gap-2">
                    {alert.owner_tracklet_ids.slice(0, 4).map(tid => (
                      <TrackletThumb key={tid} trackletId={tid} label="Owner" />
                    ))}
                    {alert.owner_tracklet_ids.length > 4 && (
                      <div className="w-12 h-12 rounded border border-slate-700 bg-slate-800 flex items-center justify-center text-[10px] text-slate-400 font-bold">
                        +{alert.owner_tracklet_ids.length - 4}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {alert.visitor_tracklet_ids.length > 0 && (
                <div>
                  <div className="text-[9px] font-bold text-amber-500/70 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <Eye className="w-3 h-3" /> Persons of Interest
                  </div>
                  <div className="flex gap-2">
                    {alert.visitor_tracklet_ids.slice(0, 4).map(tid => (
                      <TrackletThumb key={tid} trackletId={tid} label="Visitor" />
                    ))}
                    {alert.visitor_tracklet_ids.length > 4 && (
                      <div className="w-12 h-12 rounded border border-amber-500/20 bg-amber-950/20 flex items-center justify-center text-[10px] text-amber-400 font-bold">
                        +{alert.visitor_tracklet_ids.length - 4}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="shrink-0 flex flex-col gap-2">
          {!alert.acknowledged && (
            <button
              onClick={handleAck}
              disabled={acking}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg text-[10px] font-bold transition-colors"
            >
              {acking ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
              Acknowledge
            </button>
          )}
          <button
            onClick={() => setExpanded(p => !p)}
            className="inline-flex items-center gap-1 px-2 py-1.5 border border-slate-700 hover:border-slate-600 text-slate-400 hover:text-slate-300 rounded-lg text-[10px] font-medium transition-colors"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Analysis Log
          </button>
        </div>
      </div>

      {/* Expanded log */}
      {expanded && alert.analysis_log && (
        <div className="border-t border-slate-700/50 px-4 py-3 font-mono text-[10px] text-slate-400 space-y-0.5 bg-slate-900/40 rounded-b-xl max-h-40 overflow-y-auto">
          {(() => {
            try {
              const lines: string[] = JSON.parse(alert.analysis_log)
              return lines.map((line, i) => (
                <div key={i} className={`${
                  line.startsWith('[ABANDONED]') ? 'text-rose-400' :
                  line.startsWith('[UNATTENDED]') ? 'text-amber-400' :
                  line.startsWith('[OWNER') ? 'text-teal-400' :
                  line.startsWith('[VISITOR]') ? 'text-purple-400' :
                  'text-slate-500'
                }`}>{line}</div>
              ))
            } catch {
              return <div>{alert.analysis_log}</div>
            }
          })()}
        </div>
      )}
    </div>
  )
}

function AnalysisLogPanel({ entries }: { entries: AnalysisLogEntry[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  if (entries.length === 0) return null

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/60 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
        <Radio className="w-3.5 h-3.5 text-teal-400" />
        <span className="text-xs font-bold text-slate-300">Analysis Run Log</span>
        <span className="ml-auto text-[10px] text-slate-500">{entries.length} video(s) evaluated</span>
      </div>
      <div className="divide-y divide-slate-800">
        {entries.map((entry) => (
          <div key={entry.video_id} className="px-4 py-3">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                entry.status === 'running' ? 'bg-blue-400 animate-pulse' :
                entry.status === 'complete' ? 'bg-teal-400' :
                entry.status === 'error' ? 'bg-rose-400' :
                'bg-slate-600'
              }`} />
              <span className="text-xs font-medium text-slate-300 truncate">{entry.video_name}</span>
              <span className="text-[10px] text-slate-500 truncate">{entry.camera_name}</span>
              {entry.alerts_created > 0 && (
                <span className="ml-auto shrink-0 text-[10px] font-bold text-rose-400 bg-rose-950/30 border border-rose-500/20 px-2 py-0.5 rounded-full">
                  {entry.alerts_created} alert{entry.alerts_created !== 1 ? 's' : ''}
                </span>
              )}
              {entry.status === 'skipped' && (
                <span className="ml-auto shrink-0 text-[10px] text-slate-500 italic">
                  {entry.skip_reason?.includes('no abandonment') ? 'No object class in model' : 'Skipped'}
                </span>
              )}
              {entry.log_entries.length > 0 && (
                <button
                  onClick={() => setExpanded(expanded === entry.video_id ? null : entry.video_id)}
                  className="shrink-0 text-[10px] text-slate-500 hover:text-slate-300"
                >
                  {expanded === entry.video_id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              )}
            </div>
            {expanded === entry.video_id && (
              <div className="mt-2 ml-4 font-mono text-[9px] text-slate-500 space-y-0.5 max-h-32 overflow-y-auto">
                {entry.log_entries.map((l, i) => (
                  <div key={i} className={`${
                    l.startsWith('[ABANDONED]') ? 'text-rose-400' :
                    l.startsWith('[UNATTENDED]') ? 'text-amber-400' :
                    l.startsWith('[OWNER') ? 'text-teal-400' :
                    l.startsWith('[VISITOR]') ? 'text-purple-400' :
                    l.startsWith('[ERROR]') ? 'text-rose-500' :
                    l.startsWith('[SKIP]') ? 'text-slate-600' :
                    'text-slate-500'
                  }`}>{l}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Alerts({ cameras = [] }: AlertsPageProps) {
  const [alerts, setAlerts] = useState<AlertEntry[]>([])
  const [summary, setSummary] = useState<{ total_alerts: number; unacknowledged_alerts: number; by_type: Record<string, number> } | null>(null)
  const [loading, setLoading] = useState(true)
  const [analysisLog, setAnalysisLog] = useState<AnalysisLogEntry[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [autoEnabled, setAutoEnabled] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [filterAcknowledged, setFilterAcknowledged] = useState<boolean | undefined>(undefined)
  const [filterCamera, setFilterCamera] = useState('')
  const logPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Analysis config state
  const [config, setConfig] = useState({
    abandon_time_sec: 15,
    visitor_dist_px: 150,
    owner_bind_dist_px: 80,
    abandon_dist_px: 200,
    stationary_tolerance_px: 15,
    stationary_time_sec: 2,
    occlusion_grace_frames: 30,
  })

  const loadAlerts = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterCamera) params.append('camera_id', filterCamera)
      if (filterAcknowledged !== undefined) params.append('acknowledged', String(filterAcknowledged))
      params.append('alert_type', 'abandoned_object')
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
  }, [filterCamera, filterAcknowledged])

  useEffect(() => { loadAlerts() }, [loadAlerts])

  const pollLog = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/alerts/analysis-log`)
      if (res.ok) {
        const data = await res.json()
        setAnalysisLog(data.entries || [])
        const anyRunning = (data.entries || []).some((e: AnalysisLogEntry) => e.status === 'running')
        if (!anyRunning) {
          setIsRunning(false)
          if (logPollRef.current) clearInterval(logPollRef.current)
          loadAlerts()
        }
      }
    } catch {}
  }, [loadAlerts])

  const runAnalysis = async () => {
    setIsRunning(true)
    setAnalysisLog([])
    try {
      await fetch(`${API_BASE}/api/v1/alerts/trigger-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      logPollRef.current = setInterval(pollLog, 1500)
    } catch (e) {
      setIsRunning(false)
    }
  }

  const handleAcknowledge = (alertId: number) => {
    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, acknowledged: true } : a))
    setSummary(prev => prev ? { ...prev, unacknowledged_alerts: Math.max(0, prev.unacknowledged_alerts - 1) } : prev)
  }

  const acked = alerts.filter(a => a.acknowledged).length

  return (
    <div className="space-y-5 pb-24">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100">Abandoned Object Alerts</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Post-processing analysis of completed videos for unattended objects.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Auto-analysis toggle */}
          <button
            onClick={() => setAutoEnabled(p => !p)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 hover:border-slate-600 text-xs font-medium transition-colors text-slate-300"
            title={autoEnabled ? 'Auto-analysis ON' : 'Auto-analysis OFF'}
          >
            {autoEnabled
              ? <ToggleRight className="w-4 h-4 text-teal-400" />
              : <ToggleLeft className="w-4 h-4 text-slate-500" />}
            <span className={autoEnabled ? 'text-teal-400' : 'text-slate-500'}>
              {autoEnabled ? 'Auto ON' : 'Auto OFF'}
            </span>
          </button>

          {/* Settings toggle */}
          <button
            onClick={() => setShowSettings(p => !p)}
            className={`p-2 rounded-lg border transition-colors ${
              showSettings ? 'border-teal-500/40 bg-teal-950/30 text-teal-400' : 'border-slate-700 text-slate-400 hover:border-slate-600'
            }`}
            title="Analysis Settings"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>

          {/* Run now */}
          <button
            onClick={runAnalysis}
            disabled={isRunning}
            className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold transition-colors"
          >
            {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {isRunning ? 'Analyzing...' : 'Run Analysis'}
          </button>

          <button
            onClick={loadAlerts}
            className="p-2 rounded-lg border border-slate-700 hover:border-slate-600 text-slate-400 hover:text-slate-300 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Settings2 className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-bold text-slate-300">Analysis Configuration</span>
            <span className="text-[10px] text-slate-500 ml-1">(applied on next run)</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {[
              { key: 'abandon_time_sec', label: 'Abandon Time (sec)', min: 5, max: 120, step: 1 },
              { key: 'visitor_dist_px', label: 'Visitor Radius (px)', min: 60, max: 300, step: 10 },
              { key: 'owner_bind_dist_px', label: 'Owner Bind Dist (px)', min: 30, max: 150, step: 5 },
              { key: 'abandon_dist_px', label: 'Abandon Dist (px)', min: 80, max: 400, step: 10 },
              { key: 'stationary_tolerance_px', label: 'Stationary Tolerance (px)', min: 5, max: 40, step: 1 },
              { key: 'stationary_time_sec', label: 'Stationary Window (sec)', min: 1, max: 10, step: 0.5 },
            ].map(({ key, label, min, max, step }) => (
              <div key={key}>
                <label className="text-[10px] font-semibold text-slate-400 block mb-1">
                  {label}: <span className="text-teal-400">{config[key as keyof typeof config]}</span>
                </label>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={config[key as keyof typeof config]}
                  onChange={e => setConfig(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                  className="w-full accent-teal-500"
                />
                <div className="flex justify-between text-[9px] text-slate-600">
                  <span>{min}</span><span>{max}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Camera participation toggles */}
          {cameras.length > 0 && (
            <div className="pt-3 border-t border-slate-700/60">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Radio className="w-3 h-3" /> Camera Participation
              </div>
              <div className="flex flex-wrap gap-2">
                {cameras.map(cam => (
                  <CameraParticipationToggle key={cam.camera_id} camera={cam} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Alerts</div>
            <div className="text-2xl font-bold text-slate-100 mt-1">{summary.total_alerts}</div>
          </div>
          <div className="rounded-xl border border-rose-500/20 bg-rose-950/10 p-4">
            <div className="text-[10px] font-bold text-rose-400/70 uppercase tracking-wider flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Unacknowledged
            </div>
            <div className="text-2xl font-bold text-rose-300 mt-1">{summary.unacknowledged_alerts}</div>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-4">
            <div className="text-[10px] font-bold text-emerald-400/70 uppercase tracking-wider flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" /> Acknowledged
            </div>
            <div className="text-2xl font-bold text-emerald-300 mt-1">{acked}</div>
          </div>
          <div className="rounded-xl border border-purple-500/20 bg-purple-950/10 p-4">
            <div className="text-[10px] font-bold text-purple-400/70 uppercase tracking-wider flex items-center gap-1">
              <Users className="w-3 h-3" /> Persons of Interest
            </div>
            <div className="text-2xl font-bold text-purple-300 mt-1">
              {alerts.reduce((s, a) => s + (a.visitor_tracklet_ids?.length || 0), 0)}
            </div>
          </div>
        </div>
      )}

      {/* Analysis Log Panel */}
      <AnalysisLogPanel entries={analysisLog} />

      {/* Filters */}
      <div className="flex items-center gap-3">
        <select
          value={filterCamera}
          onChange={e => setFilterCamera(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300 outline-none focus:border-teal-600"
        >
          <option value="">All Cameras</option>
          {cameras.map(c => <option key={c.camera_id} value={c.camera_id}>{c.name}</option>)}
        </select>
        <div className="flex rounded-lg border border-slate-700 bg-slate-900 text-xs overflow-hidden">
          {[['All', undefined], ['Active', false], ['Resolved', true]].map(([label, val]) => (
            <button
              key={String(label)}
              onClick={() => setFilterAcknowledged(val as boolean | undefined)}
              className={`px-3 py-2 font-medium transition-colors ${
                filterAcknowledged === val
                  ? 'bg-teal-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[10px] text-slate-500">
          {loading ? 'Loading...' : `${alerts.length} alert(s)`}
        </span>
      </div>

      {/* Alert Cards */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading alerts...</span>
        </div>
      ) : alerts.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 py-16 text-center">
          <Package className="w-8 h-8 text-slate-700 mx-auto mb-3" />
          <div className="text-sm font-medium text-slate-500">No abandoned object alerts</div>
          <div className="text-xs text-slate-600 mt-1">
            Run analysis on completed videos to detect abandoned objects.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map(alert => (
            <AbandonedAlertCard key={alert.id} alert={alert} onAcknowledge={handleAcknowledge} />
          ))}
        </div>
      )}
    </div>
  )
}

function CameraParticipationToggle({ camera }: { camera: Camera }) {
  const [participating, setParticipating] = useState(camera.participate_in_alerts !== false)
  const [saving, setSaving] = useState(false)

  const toggle = async () => {
    setSaving(true)
    try {
      await fetch(`${API_BASE}/api/v1/cameras/${camera.camera_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participate_in_alerts: !participating }),
      })
      setParticipating(p => !p)
    } finally {
      setSaving(false)
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={saving}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${
        participating
          ? 'border-teal-500/30 bg-teal-950/30 text-teal-400'
          : 'border-slate-700 bg-slate-800/50 text-slate-500'
      }`}
    >
      {saving ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : participating ? (
        <Radio className="w-3 h-3" />
      ) : (
        <Minus className="w-3 h-3" />
      )}
      {camera.name}
    </button>
  )
}
