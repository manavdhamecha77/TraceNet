import { useState, useEffect, useRef, useCallback } from 'react'
import {
  ShieldAlert, CheckCheck, Play,
  RefreshCw, Loader2, SlidersHorizontal,
  UserX, Target, ExternalLink, Save, RotateCcw, Trash2,
  Bike, User, Zap, X, ChevronLeft, ChevronRight, Download, Camera, Eye, Info
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
  onTrackTracklet,
  onViewEvidence
}: {
  alert: AlertEntry;
  onAcknowledge: (id: number) => void;
  onTrackTracklet: (videoId: string, trackletIdStr: string, tag: 'SUSPECT' | 'VICTIM', color: string) => void;
  onViewEvidence: (alert: AlertEntry, theftFrames: any[]) => void;
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
  let theftFrames: any[] = []
  if (alert.analysis_log) {
    try {
      const parsed = JSON.parse(alert.analysis_log)
      if (Array.isArray(parsed)) {
        logs = parsed
      } else if (parsed && typeof parsed === 'object') {
        logs = parsed.log_entries || []
        theftFrames = parsed.theft_frames || []
      }
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
              <TrackletThumb trackletId={suspectTrkId} label="[SUSPECT]" />
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
                [SUSPECT]
              </button>
            )}
          </div>

          <span className="text-slate-300 dark:text-slate-700 font-bold text-xs">⚡</span>

          {/* Victim */}
          <div className="flex flex-col items-center gap-1.5">
            {victimTrkId ? (
              <TrackletThumb trackletId={victimTrkId} label="[VICTIM]" />
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
                [VICTIM]
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
        <div className="shrink-0 flex sm:flex-col items-center gap-2 w-full sm:w-auto">
          {!alert.acknowledged && (
            <button
              onClick={handleAck}
              disabled={acking}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors"
            >
              {acking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
              Acknowledge
            </button>
          )}
          {alert.video_id && (
            <>
              {theftFrames.length > 0 && (
                <button
                  onClick={() => onViewEvidence(alert, theftFrames)}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors shadow-xs"
                  title="View saved evidence frame gallery with interactive object highlights"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Evidence Gallery ({theftFrames.length})
                </button>
              )}

              <Link
                to={`/multicam?tracklet_id=${encodeURIComponent(suspectTrkId || alert.tracklet_id)}`}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-colors shadow-xs"
                title="Pursue suspect vehicle across all city cameras using Multi-Cam Re-ID"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Pursue in City
              </Link>

              <Link
                to={`/cameras/${alert.camera_id}/videos/${alert.video_id}`}
                className="w-full inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition-colors"
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

  // Evidence gallery state
  const [selectedAlert, setSelectedAlert] = useState<AlertEntry | null>(null)
  const [evidenceFrames, setEvidenceFrames] = useState<any[]>([])
  const [isEvidenceOpen, setIsEvidenceOpen] = useState(false)

  const handleOpenEvidence = (alert: AlertEntry, theftFrames: any[]) => {
    setSelectedAlert(alert)
    setEvidenceFrames(theftFrames)
    setIsEvidenceOpen(true)
  }

  // Config state
  const [config, setConfig] = useState({
    proximity_threshold_px: 120,
    fall_aspect_ratio_trigger: 0.85,
    fall_frame_window: 2,
    chase_velocity_multiplier: 3.0,
    chase_vector_cosine_sim: 0.75,
    observation_window_frames: 4,
    enable_kinematics: false,
    detection_threshold_frames: 4,
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
      enable_kinematics: false,
      detection_threshold_frames: 4,
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
      <div className="border-b border-slate-200 dark:border-slate-800 pb-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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

        {/* Subtle camera opt-out / model OFF notification badge */}
        {_cameras.some(c => c.participate_in_alerts === false || (c as any).theft_model_id === 'OFF') && (
          <div className="w-full text-[11px] text-slate-500 dark:text-slate-400 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-md">
            <details className="w-full cursor-pointer select-none">
              <summary className="font-semibold text-amber-700 dark:text-amber-400 outline-none flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5" />
                Note: Outdoor Theft analysis is OFF for opted-out cameras (Click to see)
              </summary>
              <div className="mt-1.5 pl-5 text-[10px] leading-relaxed text-slate-600 dark:text-slate-400 border-l-2 border-amber-500/40">
                {_cameras.filter(c => c.participate_in_alerts === false || (c as any).theft_model_id === 'OFF').map(c => c.name || c.camera_id).join(', ')}
              </div>
            </details>
          </div>
        )}
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
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Enable Kinematic Logic</label>
              <div className="flex items-center gap-2 h-8">
                <input
                  type="checkbox"
                  id="enable_kinematics"
                  checked={config.enable_kinematics}
                  onChange={e => setConfig({ ...config, enable_kinematics: e.target.checked })}
                  className="rounded border-slate-200 dark:border-slate-800 h-4.5 w-4.5 text-rose-600 focus:ring-rose-500 bg-slate-50 dark:bg-slate-950"
                />
                <label htmlFor="enable_kinematics" className="text-xs text-slate-600 dark:text-slate-400 select-none cursor-pointer">
                  Activate Proximity & Fall Rules
                </label>
              </div>
              <p className="text-[10px] text-slate-500">Enable kinematic proximity and fall logic (default is OFF).</p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Model Threshold (Frames)</label>
              <input
                type="number"
                min="1"
                max="100"
                value={config.detection_threshold_frames}
                onChange={e => setConfig({ ...config, detection_threshold_frames: Number(e.target.value) })}
                className="w-full h-8 px-3 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 font-mono"
              />
              <p className="text-[10px] text-slate-500">Continuous frames required to flag model theft detection (default: 4 frames = 1s).</p>
            </div>

            <div className={`space-y-1 transition-opacity duration-200 ${config.enable_kinematics ? '' : 'opacity-40 pointer-events-none'}`}>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Proximity Threshold (px)</label>
              <input
                type="number"
                value={config.proximity_threshold_px}
                onChange={e => setConfig({ ...config, proximity_threshold_px: Number(e.target.value) })}
                className="w-full h-8 px-3 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 font-mono"
              />
              <p className="text-[10px] text-slate-500">Max Euclidean distance between vehicle and person to trigger proximity event.</p>
            </div>

            <div className={`space-y-1 transition-opacity duration-200 ${config.enable_kinematics ? '' : 'opacity-40 pointer-events-none'}`}>
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

            <div className={`space-y-1 transition-opacity duration-200 ${config.enable_kinematics ? '' : 'opacity-40 pointer-events-none'}`}>
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
                onViewEvidence={handleOpenEvidence}
              />
            ))}
          </div>
        </div>
      )}

      {isEvidenceOpen && (
        <EvidenceViewerModal
          alert={selectedAlert}
          theftFrames={evidenceFrames}
          onClose={() => {
            setIsEvidenceOpen(false)
            setSelectedAlert(null)
            setEvidenceFrames([])
          }}
          onPlayVideoAtTime={onPlayVideoAtTime}
        />
      )}
    </div>
  )
}

function EvidenceViewerModal({
  alert,
  theftFrames,
  onClose,
  onPlayVideoAtTime
}: {
  alert: AlertEntry | null
  theftFrames: any[]
  onClose: () => void
  onPlayVideoAtTime?: (
    video: any,
    timestamp: number,
    trackerId?: number | string,
    bestBbox?: number[],
    className?: string,
    tag?: string,
    color?: string
  ) => void
}) {
  const [currentIdx, setCurrentIdx] = useState(0)
  const [highlightBoxes, setHighlightBoxes] = useState(true)
  const [imgDimensions, setImgDimensions] = useState({ width: 0, height: 0 })
  const imgRef = useRef<HTMLImageElement>(null)

  // Keyboard Arrow Navigation (Left/Right)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        setCurrentIdx(prev => (prev + 1) % theftFrames.length)
      } else if (e.key === 'ArrowLeft') {
        setCurrentIdx(prev => (prev - 1 + theftFrames.length) % theftFrames.length)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [theftFrames.length])

  if (!alert || theftFrames.length === 0) return null

  const currentFrame = theftFrames[currentIdx]
  const imageUrl = `${API_BASE}/${currentFrame.image_path}`

  const handleImgLoad = () => {
    if (imgRef.current) {
      setImgDimensions({
        width: imgRef.current.clientWidth,
        height: imgRef.current.clientHeight
      })
    }
  }

  // Update layout dimensions on window resize & image switch
  useEffect(() => {
    const handleResize = () => {
      if (imgRef.current) {
        setImgDimensions({
          width: imgRef.current.clientWidth,
          height: imgRef.current.clientHeight
        })
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [imageUrl])

  // Also trigger dimensions update when currentIdx changes and image loads
  useEffect(() => {
    if (imgRef.current && imgRef.current.complete) {
      handleImgLoad()
    }
  }, [currentIdx])

  const nextFrame = () => {
    setCurrentIdx(prev => (prev + 1) % theftFrames.length)
  }

  const prevFrame = () => {
    setCurrentIdx(prev => (prev - 1 + theftFrames.length) % theftFrames.length)
  }

  const handleDownload = () => {
    const link = document.createElement('a')
    link.href = imageUrl
    link.download = `evidence_frame_${currentFrame.frame_index}.jpg`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-slate-850 flex justify-between items-center bg-slate-950/30">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Camera className="w-4 h-4 text-rose-500" />
              Theft Evidence Gallery — {alert.camera_id}
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
              Video ID: {alert.video_id} · Timestamp: {currentFrame.timestamp_seconds.toFixed(2)}s (Frame #{currentFrame.frame_index})
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col lg:flex-row gap-6 items-center lg:items-start justify-center">
          {/* Image & Overlays */}
          <div className="relative flex-1 bg-black rounded-xl overflow-hidden border border-slate-800 max-w-[640px] w-full flex items-center justify-center min-h-[300px]">
            <img
              ref={imgRef}
              src={imageUrl}
              alt={`Evidence frame ${currentFrame.frame_index}`}
              className="max-h-[50vh] object-contain select-none"
              onLoad={handleImgLoad}
            />

            {/* Bounding Boxes overlay */}
            {highlightBoxes && imgDimensions.width > 0 && currentFrame.detections && (
              <div className="absolute pointer-events-none" style={{
                width: imgDimensions.width,
                height: imgDimensions.height,
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)'
              }}>
                {currentFrame.detections.map((det: any, i: number) => {
                  if (!det.bbox) return null
                  const [x1, y1, x2, y2] = det.bbox // coordinates in pixels relative to 1280x720 video size
                  
                  // Scale coordinates using video aspect ratio of 1280x720
                  const nx1 = x1 / 1280
                  const ny1 = y1 / 720
                  const nx2 = x2 / 1280
                  const ny2 = y2 / 720

                  const left = nx1 * imgDimensions.width
                  const top = ny1 * imgDimensions.height
                  const width = (nx2 - nx1) * imgDimensions.width
                  const height = (ny2 - ny1) * imgDimensions.height

                  const isSuspect = det.class_name === '[SUSPECT]'
                  const isVictim = det.class_name === '[VICTIM]'
                  
                  let borderCol = 'border-sky-500'
                  let bgCol = 'bg-sky-500/10'
                  let textCol = 'text-sky-400'
                  
                  if (isSuspect) {
                    borderCol = 'border-rose-500'
                    bgCol = 'bg-rose-500/10'
                    textCol = 'text-rose-400 animate-pulse'
                  } else if (isVictim) {
                    borderCol = 'border-emerald-500'
                    bgCol = 'bg-emerald-500/10'
                    textCol = 'text-emerald-400'
                  }

                  return (
                    <div
                      key={i}
                      className={`absolute border-2 ${borderCol} ${bgCol} rounded-xs`}
                      style={{ left, top, width, height }}
                    >
                      <span className={`absolute -top-4.5 left-0 px-1 py-0.5 rounded text-[8px] font-bold ${textCol} bg-slate-900 border border-slate-700 leading-none whitespace-nowrap uppercase tracking-wider`}>
                        {det.class_name} {det.tracker_id ? `#${det.tracker_id}` : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Controls Panel */}
          <div className="w-full lg:w-72 bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4 shrink-0">
            <div className="space-y-2">
              <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Highlight Controls</span>
              <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-800 bg-slate-950/40">
                <span className="text-xs text-slate-300 font-semibold">Highlight Detections</span>
                <button
                  type="button"
                  onClick={() => setHighlightBoxes(!highlightBoxes)}
                  className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    highlightBoxes ? 'bg-rose-600' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                      highlightBoxes ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Incident Tracklets</span>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {currentFrame.detections?.map((det: any, i: number) => {
                  const isSuspect = det.class_name === '[SUSPECT]'
                  const isVictim = det.class_name === '[VICTIM]'
                  
                  return (
                    <div key={i} className="flex items-center justify-between p-2 rounded-lg border border-slate-800 bg-slate-950/20 text-xs">
                      <span className="font-semibold text-slate-350">
                        {det.class_name === '[SUSPECT]' ? 'Suspect (Thief)' : det.class_name === '[VICTIM]' ? 'Victim' : det.class_name}
                        {det.tracker_id ? ` #${det.tracker_id}` : ''}
                      </span>
                      {det.tracker_id && (isSuspect || isVictim) && (
                        <Link
                          to={`/multicam?tracklet_id=${encodeURIComponent(`${alert.video_id}_trk_${det.tracker_id}`)}`}
                          onClick={onClose}
                          className="px-1.5 py-0.5 rounded border border-sky-500/30 hover:border-sky-500 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 font-semibold text-[10px] transition-colors"
                        >
                          Re-ID Pursue
                        </Link>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-800 flex flex-col gap-2">
              <button
                onClick={handleDownload}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg border border-slate-700 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Download Frame Image
              </button>
              
              {onPlayVideoAtTime && (
                <button
                  onClick={() => {
                    const mockVideo = { id: alert.video_id, camera_id: alert.camera_id }
                    const suspectDet = currentFrame.detections?.find((d: any) => d.class_name === '[SUSPECT]')
                    const tid = suspectDet?.tracker_id
                    const bbox = suspectDet?.bbox
                    const cname = suspectDet ? 'theif' : undefined // tag matching mapping in App.tsx
                    onPlayVideoAtTime(
                      mockVideo,
                      currentFrame.timestamp_seconds,
                      tid,
                      bbox,
                      cname,
                      'SUSPECT',
                      '#EF4444' // bright red highlight for tracking suspect
                    )
                    onClose()
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg border border-transparent shadow-sm transition-colors animate-pulse"
                >
                  <Play className="w-3.5 h-3.5" />
                  See Original Video
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Thumbnails scrubber footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex items-center gap-4">
          <button
            onClick={prevFrame}
            className="p-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 text-slate-300 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          
          <div className="flex-1 overflow-x-auto flex gap-2 py-1 pr-1 scrollbar-thin">
            {theftFrames.map((frame, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentIdx(idx)}
                className={`relative shrink-0 w-16 h-12 rounded-lg border overflow-hidden transition-all ${
                  idx === currentIdx
                    ? 'border-rose-500 ring-2 ring-rose-500/30'
                    : 'border-slate-850 hover:border-slate-755'
                }`}
              >
                <img
                  src={`${API_BASE}/${frame.image_path}`}
                  alt=""
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[8px] font-mono text-center text-slate-300 py-0.5 leading-none">
                  {frame.timestamp_seconds.toFixed(1)}s
                </span>
              </button>
            ))}
          </div>

          <button
            onClick={nextFrame}
            className="p-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 text-slate-300 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
