import { useState, useEffect, useRef, useCallback } from 'react'
import {
  ShieldAlert, CheckCheck, Play,
  RefreshCw, Loader2, SlidersHorizontal,
  UserX, Target, ExternalLink, Save, RotateCcw, Trash2,
  Bike, User, Zap
} from 'lucide-react'
import { Link } from 'react-router-dom'

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
  status: 'pending' | 'running' | 'complete' | 'skipped' | 'error'
  progress_percentage?: number
}

interface Camera {
  camera_id: string
  name: string
  participate_in_alerts?: boolean
}

interface TheftAlertsProps {
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
          className="w-12 h-12 rounded-lg object-cover border border-slate-200 dark:border-slate-750 bg-slate-50 dark:bg-slate-900 shadow-xs"
          onError={() => setErr(true)}
        />
      ) : (
        <div className="w-12 h-12 rounded-lg border border-slate-200 dark:border-slate-750 bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
          <UserX className="w-4 h-4 text-slate-400 dark:text-slate-600" />
        </div>
      )}
      <span className="text-[9px] text-slate-500 dark:text-slate-400 font-mono leading-none max-w-[56px] truncate">
        {trackletId.split('_trk_')[1] || trackletId.substring(0, 6)}
      </span>
    </div>
  )
}

function ChainSnatchingCard({
  alert,
  onAcknowledge,
  onTrackTracklet
}: {
  alert: AlertEntry;
  onAcknowledge: (id: number) => void;
  onTrackTracklet: (videoId: string, trackletIdStr: string, tag: 'SUSPECT' | 'VICTIM', color: string) => void;
}) {
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

  let logs: string[] = []
  if (alert.analysis_log) {
    try {
      logs = JSON.parse(alert.analysis_log)
    } catch {
      logs = [alert.analysis_log]
    }
  }

  const victimTrkId = alert.owner_tracklet_ids?.[0] || alert.tracklet_id
  const suspectTrkId = alert.object_tracklet_id || alert.visitor_tracklet_ids?.[0]

  return (
    <div
      className={`rounded-xl border transition-all ${
        alert.acknowledged
          ? 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60'
          : 'border-rose-500/40 bg-rose-50/60 dark:border-rose-500/30 dark:bg-rose-950/20 shadow-sm'
      }`}
    >
      <div className="p-4 flex items-start gap-4 flex-wrap sm:flex-nowrap">
        {/* Tracklets thumbnails */}
        <div className="shrink-0 flex items-center gap-3">
          {/* Suspect Vehicle */}
          <div className="flex flex-col items-center gap-1.5">
            {suspectTrkId ? (
              <TrackletThumb trackletId={suspectTrkId} label="Suspect Vehicle" />
            ) : (
              <div className="w-12 h-12 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
                <Bike className="w-5 h-5 text-rose-500" />
              </div>
            )}
            {alert.video_id && suspectTrkId && (
              <button
                onClick={() => onTrackTracklet(alert.video_id!, suspectTrkId, 'SUSPECT', '#FF0033')}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-colors"
                title="Track Suspect Vehicle (Bright Red)"
              >
                <Target className="w-2.5 h-2.5 text-rose-500" />
                Suspect
              </button>
            )}
          </div>

          <span className="text-slate-300 dark:text-slate-700 font-bold text-xs">⚡</span>

          {/* Victim */}
          <div className="flex flex-col items-center gap-1.5">
            {victimTrkId ? (
              <TrackletThumb trackletId={victimTrkId} label="Victim" />
            ) : (
              <div className="w-12 h-12 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
                <User className="w-5 h-5 text-emerald-500" />
              </div>
            )}
            {alert.video_id && victimTrkId && (
              <button
                onClick={() => onTrackTracklet(alert.video_id!, victimTrkId, 'VICTIM', '#00E676')}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                title="Track Victim (Emerald Green)"
              >
                <Target className="w-2.5 h-2.5 text-emerald-500" />
                Victim
              </button>
            )}
          </div>
        </div>

        {/* Anomaly Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold border ${
              alert.acknowledged
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-500/30 dark:text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:bg-rose-950/40 dark:border-rose-500/30 dark:text-rose-400'
            }`}>
              {alert.acknowledged ? <CheckCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
              {alert.acknowledged ? 'Acknowledged' : 'Chain Snatching & Violent Theft'}
            </span>

            <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400">
              <Zap className="w-3 h-3 text-rose-500" /> Proximity & Fall Event
            </span>
          </div>

          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <span className="font-semibold text-slate-700 dark:text-slate-200">{alert.camera_id}</span>
            <span>·</span>
            <span>{new Date(alert.timestamp).toLocaleString()}</span>
          </div>

          {/* Telemetry snippet */}
          {logs.length > 0 && (
            <div className="mt-2.5">
              <button
                onClick={() => setExpanded(p => !p)}
                className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1"
              >
                <span>{expanded ? 'Hide Telemetry Details' : 'Show Kinematic Evidence Telemetry'}</span>
              </button>
              {expanded && (
                <div className="mt-2 p-2.5 rounded-lg bg-slate-900 text-slate-200 text-[10px] font-mono space-y-1 overflow-x-auto border border-slate-800">
                  {logs.map((log, i) => (
                    <div key={i} className="leading-relaxed">
                      {log}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Actions */}
        <div className="shrink-0 flex sm:flex-col items-center gap-2">
          {!alert.acknowledged && (
            <button
              onClick={handleAck}
              disabled={acking}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors"
            >
              {acking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
              Acknowledge
            </button>
          )}
          {alert.video_id && (
            <>
              <Link
                to={`/multicam?tracklet_id=${encodeURIComponent(suspectTrkId || alert.tracklet_id)}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-colors shadow-xs"
                title="Pursue suspect vehicle across all city cameras using Multi-Cam Re-ID"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Pursue in City (Multi-Cam)
              </Link>

              <Link
                to={`/cameras/${alert.camera_id}/videos/${alert.video_id}`}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View Video
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function TheftAlerts({ cameras: _cameras = [], onPlayVideoAtTime }: TheftAlertsProps) {
  const [alerts, setAlerts] = useState<AlertEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [csAnalysisLog, setCsAnalysisLog] = useState<AnalysisLogEntry[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null)
  const logPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Config state
  const [config, setConfig] = useState({
    proximity_threshold_px: 120,
    fall_aspect_ratio_trigger: 0.85,
    fall_frame_window: 2,
    chase_velocity_multiplier: 3.0,
    chase_vector_cosine_sim: 0.75,
    observation_window_frames: 4,
  })

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/alerts/chain-snatching-config`)
      if (res.ok) {
        const data = await res.json()
        setConfig(prev => ({ ...prev, ...data }))
      }
    } catch (e) {
      console.error('Failed to load chain snatching settings:', e)
    }
  }, [])

  const loadAlerts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/alerts?alert_type=chain_snatching`)
      if (res.ok) {
        setAlerts(await res.json())
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfig()
    loadAlerts()
  }, [loadConfig, loadAlerts])

  const pollLog = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/alerts/chain-snatching-analysis-log`)
      if (res.ok) {
        const data = await res.json()
        setCsAnalysisLog(data.entries || [])
        const anyRunning = (data.entries || []).some((e: AnalysisLogEntry) => e.status === 'running' || e.status === 'pending')
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
    setCsAnalysisLog([])
    try {
      await fetch(`${API_BASE}/api/v1/alerts/chain-snatching-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })

      const res = await fetch(`${API_BASE}/api/v1/alerts/trigger-chain-snatching-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (res.ok) {
        logPollRef.current = setInterval(pollLog, 800)
      } else {
        setIsRunning(false)
      }
    } catch {
      setIsRunning(false)
    }
  }

  const handleSaveSettings = async () => {
    setSavingSettings(true)
    setFeedbackMsg(null)
    try {
      const res = await fetch(`${API_BASE}/api/v1/alerts/chain-snatching-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (res.ok) {
        setFeedbackMsg('Chain Snatching settings saved & applied successfully!')
        setTimeout(() => setFeedbackMsg(null), 3000)
      }
    } catch {
      setFeedbackMsg('Failed to save settings.')
    } finally {
      setSavingSettings(false)
    }
  }

  const handleResetDefaults = () => {
    setConfig({
      proximity_threshold_px: 120,
      fall_aspect_ratio_trigger: 0.85,
      fall_frame_window: 2,
      chase_velocity_multiplier: 3.0,
      chase_vector_cosine_sim: 0.75,
      observation_window_frames: 4,
    })
    setFeedbackMsg('Reset to default parameters.')
    setTimeout(() => setFeedbackMsg(null), 3000)
  }

  const clearLogs = async () => {
    try {
      await fetch(`${API_BASE}/api/v1/alerts/clear-logs`, { method: 'POST' })
      setCsAnalysisLog([])
    } catch {
      setCsAnalysisLog([])
    }
  }

  const clearArtifacts = async () => {
    if (!window.confirm('Are you sure you want to clear all active alert records and reset evaluation logs?')) return
    try {
      await fetch(`${API_BASE}/api/v1/alerts/clear-artifacts`, { method: 'POST' })
      loadAlerts()
      setCsAnalysisLog([])
    } catch (e) {
      console.error('Failed to clear artifacts:', e)
    }
  }

  const handleTrackTracklet = async (
    videoId: string,
    trackletIdStr: string,
    tag: 'SUSPECT' | 'VICTIM',
    color: string
  ) => {
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
      let className: string = tag === 'SUSPECT' ? 'vehicle' : 'person'

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

  const handleAcknowledge = (alertId: number) => {
    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, acknowledged: true } : a))
  }

  const unacked = alerts.filter(a => !a.acknowledged).length

  return (
    <div className="space-y-6 pb-24 text-slate-800 dark:text-slate-100">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Outdoor Theft Analytics</h2>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400">
              4 FPS Spatiotemporal Engine
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Detects vehicle-pedestrian proximity spikes, victim fall impact anomalies, and pursuit acceleration vectors.
          </p>
        </div>

        {/* Subtle camera opt-out / model OFF notification badge */}
        {_cameras.some(c => c.participate_in_alerts === false || (c as any).theft_model_id === 'OFF') && (
          <div className="w-full text-[11px] text-slate-500 dark:text-slate-400 bg-amber-500/10 border border-amber-500/20 p-2 rounded-md flex items-center gap-1.5">
            <span className="font-bold text-amber-600 dark:text-amber-400">Note:</span>
            <span>Outdoor Theft analysis is OFF for opted-out cameras: ({_cameras.filter(c => c.participate_in_alerts === false || (c as any).theft_model_id === 'OFF').map(c => c.name || c.camera_id).join(', ')}).</span>
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowSettings(p => !p)}
            className={`flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-semibold transition-colors ${
              showSettings
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Config</span>
          </button>

          <button
            onClick={clearLogs}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/40 text-xs font-semibold transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Logs</span>
          </button>

          <button
            onClick={clearArtifacts}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition-colors"
            title="Clear active alert records and reset evaluation logs"
          >
            <RotateCcw className="w-3.5 h-3.5 text-rose-500" />
            <span>Clear Artifacts</span>
          </button>

          <button
            onClick={runAnalysis}
            disabled={isRunning}
            className="inline-flex items-center gap-2 h-8 px-4 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white rounded-lg text-xs font-bold transition-colors shadow-xs"
          >
            {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {isRunning ? 'Analyzing...' : 'Run Theft Analysis'}
          </button>

          <button
            onClick={loadAlerts}
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Settings Drawer */}
      {showSettings && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-rose-500" />
              Kinematic Parameter Configuration
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={handleResetDefaults}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                <RotateCcw className="w-3 h-3" /> Reset Defaults
              </button>
              <button
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg transition-colors"
              >
                {savingSettings ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save & Apply
              </button>
            </div>
          </div>

          {feedbackMsg && (
            <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-500/30 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              {feedbackMsg}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Proximity Threshold (px)</label>
              <input
                type="number"
                value={config.proximity_threshold_px}
                onChange={e => setConfig({ ...config, proximity_threshold_px: Number(e.target.value) })}
                className="w-full h-8 px-3 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 font-mono"
              />
              <p className="text-[10px] text-slate-500">Max Euclidean distance between vehicle and person to trigger proximity event.</p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Fall Aspect Ratio Trigger (H/W)</label>
              <input
                type="number"
                step="0.05"
                value={config.fall_aspect_ratio_trigger}
                onChange={e => setConfig({ ...config, fall_aspect_ratio_trigger: Number(e.target.value) })}
                className="w-full h-8 px-3 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 font-mono"
              />
              <p className="text-[10px] text-slate-500">Aspect ratio threshold (&lt; 0.85) indicating person transition from standing to fallen.</p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Chase Velocity Multiplier (x)</label>
              <input
                type="number"
                step="0.5"
                value={config.chase_velocity_multiplier}
                onChange={e => setConfig({ ...config, chase_velocity_multiplier: Number(e.target.value) })}
                className="w-full h-8 px-3 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 font-mono"
              />
              <p className="text-[10px] text-slate-500">Speed acceleration factor relative to baseline walking speed.</p>
            </div>
          </div>
        </div>
      )}

      {/* Analysis Run Progress Section */}
      {csAnalysisLog.length > 0 && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-50/40 dark:bg-rose-950/10 p-4 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400 flex items-center gap-2">
            <Loader2 className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
            Theft Analysis Execution Progress
          </h3>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {csAnalysisLog.map(entry => (
              <div key={entry.video_id} className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 dark:text-slate-200">{entry.video_name}</span>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                    entry.status === 'complete' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                    entry.status === 'running' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 animate-pulse' :
                    'bg-slate-100 dark:bg-slate-800 text-slate-500'
                  }`}>
                    {entry.status}
                  </span>
                </div>
                {entry.status === 'running' && (
                  <div className="w-full bg-slate-200 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-rose-500 h-full transition-all duration-300" style={{ width: `${entry.progress_percentage || 0}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alerts Grid */}
      {loading ? (
        <div className="py-12 flex justify-center items-center text-slate-400 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-rose-500" />
          <span>Loading Theft Alerts...</span>
        </div>
      ) : alerts.length === 0 ? (
        <div className="py-16 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
          <ShieldAlert className="w-8 h-8 text-slate-400 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">No Outdoor Theft Anomaly Detected</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Click 'Run Theft Analysis' to evaluate ingested videos against the spatiotemporal proximity and fall engine.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Showing {alerts.length} incident(s) ({unacked} unacknowledged)</span>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {alerts.map(alert => (
              <ChainSnatchingCard
                key={alert.id}
                alert={alert}
                onAcknowledge={handleAcknowledge}
                onTrackTracklet={handleTrackTracklet}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
