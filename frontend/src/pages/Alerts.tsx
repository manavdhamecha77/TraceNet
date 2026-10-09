import { useState, useEffect, useRef, useCallback } from 'react'
import {
  AlertTriangle, ShieldCheck, Eye, ChevronDown,
  ChevronUp, Play, Clock, Users, Package, CheckCheck,
  RefreshCw, Settings2, Loader2, ToggleLeft, ToggleRight,
  Radio, SlidersHorizontal, UserCheck, UserX, Minus,
  Database, Save, ExternalLink, Info, ShieldAlert,
  Trash2, RotateCcw, Target, Siren, Car, PhoneCall,
  Activity, X
} from 'lucide-react'
import { Link } from 'react-router-dom'
import type { AlertEntry, AnalysisLogEntry, Camera } from '../types/alerts'
import { formatDisplayDate } from '../utils/dateFormatter'
import { useToast } from '../components/Toast'

import { API_BASE } from '../config/api'
import { alertTypeMeta, assaultVerdict } from '../utils/alertTypes'

const extractTrackerId = (val: any): string => {
  if (val == null) return ''
  const str = String(val).trim()
  if (str.includes('_trk_')) {
    const parts = str.split('_trk_')
    return parts[parts.length - 1]
  }
  return str
}



interface DetectedObject {
  id: string
  video_id: string
  tracker_id: number
  object_type: string
  class_name: string
  camera_id: string
  frame_start: number
  frame_end: number
  timestamp_start_seconds: number
  timestamp_end_seconds: number
  detection_count: number
  mean_confidence: number
  best_crop_path: string
}

interface AlertsPageProps {
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

const CONFIG_METADATA = [
  {
    key: 'abandon_time_sec',
    label: 'Abandon Time (sec)',
    min: 1,
    max: 300,
    step: 1,
    description: 'The consecutive duration an object must remain unattended before escalating to an Abandoned Object Alert.',
    strictness: 'Lower = Sensitive (fast alerts, higher false positives). Higher = Strict (requires long absence, fewer false positives).'
  },
  {
    key: 'visitor_dist_px',
    label: 'Visitor Radius (px)',
    min: 10,
    max: 1000,
    step: 5,
    description: 'Search radius around the unattended object to log other passing persons as Persons of Interest.',
    strictness: 'Higher = Sensitive (logs anyone passing in the general area). Lower = Strict (logs only direct interactions/close bypasses).'
  },
  {
    key: 'owner_bind_dist_px',
    label: 'Owner Bind Dist (px)',
    min: 10,
    max: 1000,
    step: 5,
    description: 'Maximum distance to search for a person to register as the owner when the object is initially placed.',
    strictness: 'Higher = Sensitive (binds owner easily even with box jitter). Lower = Strict (requires owner to stand extremely close, may fail to bind).'
  },
  {
    key: 'abandon_dist_px',
    label: 'Abandon Dist (px)',
    min: 10,
    max: 1000,
    step: 5,
    description: 'Separation distance threshold between the owner and the object to declare the object is unattended.',
    strictness: 'Lower = Sensitive (triggers alert on minor separation). Higher = Strict (permits owner to walk further away before triggering).'
  },
  {
    key: 'stationary_tolerance_px',
    label: 'Stationary Tolerance (px)',
    min: 1,
    max: 100,
    step: 1,
    description: 'Pixel movement window to consider the object static, filtering camera shake and bounding box jitter.',
    strictness: 'Higher = Sensitive (tolerates camera vibration and slight box drift). Lower = Strict (requires absolute static state).'
  },
  {
    key: 'stationary_time_sec',
    label: 'Stationary Window (sec)',
    min: 0.5,
    max: 60,
    step: 0.5,
    description: 'Required time the object must remain still before ownership binding and alert tracking start.',
    strictness: 'Lower = Sensitive (starts evaluating instantly). Higher = Strict (ignores objects placed down momentarily).'
  }
]

function TrackletThumb({
  trackletId,
  label,
  videoId,
  customThumbUrl,
}: {
  trackletId: string
  label: string
  videoId?: string
  customThumbUrl?: string | null
}) {
  const [err, setErr] = useState(false)
  const isObject = label.toLowerCase().includes('object') || label.toLowerCase().includes('luggage') || label.toLowerCase().includes('bag')
  
  // Calculate source thumbnail URL
  let thumbSrc = customThumbUrl
  if (!thumbSrc) {
    if (videoId && !trackletId.includes('/')) {
      thumbSrc = `${API_BASE}/data/processed/detections/${videoId}/crops/${trackletId}.jpg`
    } else {
      thumbSrc = TRACKLET_THUMB(trackletId)
    }
  }

  return (
    <div className="flex flex-col items-center gap-1">
      {!err && thumbSrc ? (
        <img
          src={thumbSrc}
          alt={label}
          className="w-12 h-12 rounded object-cover border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
          onError={() => setErr(true)}
        />
      ) : (
        <div className="w-12 h-12 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
          {isObject ? (
            <Package className="w-5 h-5 text-amber-500/70" />
          ) : (
            <UserX className="w-4 h-4 text-slate-400 dark:text-slate-600" />
          )}
        </div>
      )}
      <span className="text-[9px] text-slate-500 dark:text-slate-400 font-mono leading-none max-w-[52px] truncate">
        {trackletId.includes('_trk_') ? trackletId.split('_trk_')[1] : trackletId.substring(0, 6)}
      </span>
    </div>
  )
}

function AbandonedAlertCard({
  alert,
  onAcknowledge,
  onTrackTracklet
}: {
  alert: AlertEntry;
  onAcknowledge: (id: number) => void;
  onTrackTracklet: (videoId: string, trackletIdStr: string, tag: 'OBJECT' | 'OWNER' | 'LOITERER', color: string) => void;
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

  const durationStr = alert.abandon_duration_seconds
    ? `${alert.abandon_duration_seconds.toFixed(1)}s`
    : null

  const meta = alertTypeMeta(alert.alert_type)
  const isUnattended = alert.alert_type === 'unattended_object'
  const isLoitering = alert.alert_type === 'loitering'
  const isRose = meta.tone === 'rose'  // assault / theft / watchlist shown on the "All" tab
  const verdict = alert.alert_type === 'assault' ? assaultVerdict(alert.analysis_log) : null
  let loiteringEvidence: Record<string, unknown> | null = null
  if (isLoitering && alert.analysis_log) {
    try {
      const parsed = JSON.parse(alert.analysis_log)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) loiteringEvidence = parsed
    } catch { /* The generic analysis log remains available below. */ }
  }

  return (
    <div
      className={`rounded-md border transition-all ${
        alert.acknowledged
          ? 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60'
          : isLoitering
          ? 'border-violet-500/30 bg-violet-50/50 dark:border-violet-500/30 dark:bg-violet-950/20 shadow-sm'
          : isUnattended
          ? 'border-teal-500/30 bg-teal-50/50 dark:border-teal-500/30 dark:bg-teal-950/20 shadow-sm'
          : isRose
          ? 'border-rose-500/30 bg-rose-50/50 dark:border-rose-500/30 dark:bg-rose-950/20 shadow-sm'
          : 'border-amber-500/30 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-950/20 shadow-sm'
      }`}
    >
      {/* Card Header */}
      <div className="p-4 flex items-start gap-4">
        {/* Object thumbnail + Track Object action */}
        <div className="shrink-0 flex flex-col items-center gap-1.5">
          {isLoitering ? (
            <TrackletThumb trackletId={alert.tracklet_id} label="Person" videoId={alert.video_id} />
          ) : meta.hasTracklets && alert.object_tracklet_id ? (
            <TrackletThumb
              trackletId={alert.object_tracklet_id}
              label="Object"
              videoId={alert.video_id}
              customThumbUrl={alert.thumbnail_url ? `${API_BASE}${alert.thumbnail_url}` : null}
            />
          ) : (
            <div className="w-12 h-12 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
              {isRose
                ? <ShieldAlert className="w-5 h-5 text-rose-500" />
                : <Package className="w-5 h-5 text-amber-500/70" />}
            </div>
          )}

          {meta.hasTracklets && alert.video_id && alert.object_tracklet_id && (
            <button
              onClick={() => onTrackTracklet(alert.video_id!, alert.object_tracklet_id!, 'OBJECT', '#FF0033')}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-colors shadow-xs"
              title="Track Object in model view (Bright Red)"
            >
              <Target className="w-3 h-3 text-rose-500" />
              Track Object
            </button>
          )}
          {isLoitering && alert.video_id && (
            <button
              onClick={() => onTrackTracklet(alert.video_id!, alert.tracklet_id, 'LOITERER', '#8B5CF6')}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold bg-violet-500/10 border border-violet-500/30 text-violet-700 dark:text-violet-300 hover:bg-violet-500/20 transition-colors shadow-xs"
              title="Inspect this person's track at the beginning of the dwell window"
            >
              <Target className="w-3 h-3" /> Inspect track
            </button>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold border ${
              alert.acknowledged
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-500/30 dark:text-emerald-400'
                : isLoitering
                ? 'bg-violet-500/10 border-violet-500/20 text-violet-700 dark:bg-violet-950/30 dark:border-violet-500/30 dark:text-violet-300'
                : isUnattended
                ? 'bg-teal-500/10 border-teal-500/20 text-teal-700 dark:bg-teal-950/30 dark:border-teal-500/30 dark:text-teal-400'
                : isRose
                ? 'bg-rose-500/10 border-rose-500/20 text-rose-700 dark:bg-rose-950/30 dark:border-rose-500/30 dark:text-rose-400'
                : 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:bg-amber-950/40 dark:border-amber-500/30 dark:text-amber-400'
            }`}>
              {alert.acknowledged ? (
                <CheckCheck className="w-3 h-3" />
              ) : isLoitering ? (
                <Clock className="w-3 h-3" />
              ) : isUnattended ? (
                <ShieldAlert className="w-3 h-3" />
              ) : (
                <AlertTriangle className="w-3 h-3" />
              )}
              {alert.acknowledged ? 'Acknowledged' : verdict ? `${meta.label} - ${verdict}` : meta.label}
            </span>
            {durationStr && (
              <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold bg-slate-100 border border-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300">
                <Clock className="w-3 h-3" />
                {durationStr} {isLoitering ? 'dwell time' : 'unattended'}
              </span>
            )}
          </div>

          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-700 dark:text-slate-200">{alert.camera_id}</span>
            <span className="mx-1.5 text-slate-300 dark:text-slate-700">·</span>
            <span>{formatDisplayDate(alert.timestamp)}</span>
          </div>

          {isLoitering && loiteringEvidence && (
            <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/70 p-3 dark:border-violet-900/60 dark:bg-violet-950/20">
              <div className="flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-wider text-violet-800 dark:text-violet-300">
                <span>Review evidence · {String(loiteringEvidence.zone_name || 'Configured zone')}</span>
                <span>{Number(loiteringEvidence.inside_observations || 0)} observations</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-violet-200/70 dark:bg-violet-900/70">
                <div className="h-full w-full bg-gradient-to-r from-violet-500 via-violet-600 to-amber-400" />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-violet-700 dark:text-violet-300">
                <span>Entered {Number(loiteringEvidence.observation_start_seconds || 0).toFixed(1)}s</span>
                <span>Triggered {Number(loiteringEvidence.triggered_at_seconds || 0).toFixed(1)}s</span>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-violet-800/80 dark:text-violet-200/80">The person’s bottom-centre track point remained inside this user-defined zone for {Number(loiteringEvidence.dwell_seconds || 0).toFixed(1)}s, meeting the {Number(loiteringEvidence.threshold_seconds || 0).toFixed(1)}s review threshold. This is evidence for human review, not a finding of intent.</p>
            </div>
          )}

          {/* Owner / Visitor strips */}
          {(alert.owner_tracklet_ids.length > 0 || alert.visitor_tracklet_ids.length > 0) && (
            <div className="mt-4 flex flex-wrap gap-6">
              {alert.owner_tracklet_ids.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                    <UserCheck className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" /> Owner(s)
                  </div>
                  <div className="flex gap-3 items-start">
                    {alert.owner_tracklet_ids.slice(0, 4).map(tid => (
                      <div key={tid} className="flex flex-col items-center gap-1">
                        <TrackletThumb trackletId={tid} label="Owner" />
                        {alert.video_id && (
                          <button
                            onClick={() => onTrackTracklet(alert.video_id!, tid, 'OWNER', '#00E676')}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors shadow-xs"
                            title="See and track owner in model view"
                          >
                            <UserCheck className="w-2.5 h-2.5 text-emerald-500" />
                            Track Owner
                          </button>
                        )}
                      </div>
                    ))}
                    {alert.owner_tracklet_ids.length > 4 && (
                      <div className="w-12 h-12 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-center text-[10px] text-slate-500 dark:text-slate-400 font-bold">
                        +{alert.owner_tracklet_ids.length - 4}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {alert.visitor_tracklet_ids.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold text-amber-600/80 dark:text-amber-500/80 uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Eye className="w-3.5 h-3.5 text-amber-600 dark:text-amber-500" /> Persons of Interest
                  </div>
                  <div className="flex gap-2">
                    {alert.visitor_tracklet_ids.slice(0, 4).map(tid => (
                      <TrackletThumb key={tid} trackletId={tid} label="Visitor" />
                    ))}
                    {alert.visitor_tracklet_ids.length > 4 && (
                      <div className="w-12 h-12 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-center text-[10px] text-slate-500 dark:text-slate-400 font-bold">
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
              className="inline-flex items-center justify-center gap-1.5 h-8 px-3 bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700 disabled:opacity-50 text-white rounded text-xs font-medium transition-colors"
            >
              {acking ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
              Acknowledge
            </button>
          )}
          <button
            onClick={() => setExpanded(p => !p)}
            className="inline-flex items-center justify-center gap-1 h-8 px-3 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 rounded text-xs font-medium transition-colors"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            Analysis Log
          </button>
        </div>
      </div>

      {/* Expanded log */}
      {expanded && alert.analysis_log && (
        <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-3 font-mono text-[11px] text-slate-600 dark:text-slate-400 space-y-1 bg-slate-50 dark:bg-slate-900/40 rounded-b max-h-40 overflow-y-auto">
          {(() => {
            try {
              const lines: string[] = JSON.parse(alert.analysis_log)
              return lines.map((line, i) => (
                <div key={i} className={`${
                  line.startsWith('[ABANDONED]') ? 'text-amber-600 dark:text-amber-400 font-semibold' :
                  line.startsWith('[UNATTENDED]') ? 'text-amber-500' :
                  line.startsWith('[OWNER') ? 'text-teal-700 dark:text-teal-400' :
                  line.startsWith('[VISITOR]') ? 'text-purple-600 dark:text-purple-400' :
                  'text-slate-500 dark:text-slate-505'
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

  const total = entries.length
  const completed = entries.filter(e => e.status !== 'pending' && e.status !== 'running').length
  const runningEntry = entries.find(e => e.status === 'running')
  const overallPercentage = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Radio className={`w-3.5 h-3.5 ${runningEntry ? 'text-teal-600 dark:text-teal-400 animate-pulse' : 'text-slate-400 dark:text-slate-500'}`} />
          <span className="text-xs font-bold text-slate-800 dark:text-slate-200">Analysis Run Progress</span>
        </div>
        <div className="flex-1 flex items-center gap-3">
          <div className="flex-1 h-2 rounded bg-slate-200 dark:bg-slate-700 overflow-hidden relative">
            <div
              className="h-full bg-teal-700 dark:bg-teal-500 transition-all duration-500"
              style={{ width: `${overallPercentage}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-slate-500 dark:text-slate-455 shrink-0">
            {completed}/{total} videos ({overallPercentage}%)
          </span>
        </div>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
        {entries.map((entry) => (
          <div key={entry.video_id} className="px-4 py-3 bg-slate-50/30 dark:bg-slate-900/5">
            <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                entry.status === 'pending' ? 'bg-slate-300 dark:bg-slate-700' :
                entry.status === 'running' ? 'bg-blue-500 animate-pulse' :
                entry.status === 'complete' ? 'bg-teal-605 dark:bg-teal-500' :
                entry.status === 'error' ? 'bg-rose-500' :
                'bg-slate-500'
              }`} />
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{entry.video_name}</span>
                <span className="text-[9px] text-slate-450 dark:text-slate-500 truncate leading-none mt-0.5">{entry.camera_name}</span>
              </div>

              {entry.status === 'running' && (
                <div className="flex items-center gap-2 flex-1 max-w-[200px] ml-4">
                  <div className="flex-1 h-1.5 rounded bg-slate-200 dark:bg-slate-700 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${entry.progress_percentage || 0}%` }}
                    />
                  </div>
                  <span className="text-[9px] font-mono text-slate-500">{entry.progress_percentage || 0}%</span>
                </div>
              )}

              {entry.status === 'complete' && (
                <span className={`ml-auto shrink-0 text-[10px] font-bold px-2 py-0.5 rounded border ${
                  entry.alerts_created > 0
                    ? 'text-amber-700 bg-amber-500/10 border-amber-500/20 dark:text-amber-300 dark:bg-amber-950/20'
                    : 'text-slate-550 bg-slate-100 border-slate-200 dark:text-slate-400 dark:bg-slate-800'
                }`}>
                  {entry.alerts_created > 0 ? `${entry.alerts_created} alert(s) detected` : 'No anomalies detected'}
                </span>
              )}

              {entry.status === 'skipped' && (
                <span className="ml-auto shrink-0 text-[10px] text-slate-450 dark:text-slate-500 italic bg-slate-100 dark:bg-slate-800/40 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700/60">
                  {entry.skip_reason?.includes('no abandonment') || entry.skip_reason?.includes('classes')
                    ? 'Model lacks Object class'
                    : 'Skipped'}
                </span>
              )}

              {entry.status === 'pending' && (
                <span className="ml-auto shrink-0 text-[10px] text-slate-400 dark:text-slate-650 italic">
                  Queued...
                </span>
              )}

              {entry.log_entries.length > 0 && (
                <button
                  onClick={() => setExpanded(expanded === entry.video_id ? null : entry.video_id)}
                  className="shrink-0 text-[10px] text-slate-455 dark:text-slate-500 hover:text-slate-855 dark:hover:text-slate-200 ml-auto p-1"
                >
                  {expanded === entry.video_id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
            {expanded === entry.video_id && (
              <div className="mt-2.5 ml-5.5 font-mono text-[10px] text-slate-550 dark:text-slate-400 space-y-1 max-h-32 overflow-y-auto border-l-2 border-slate-200 dark:border-slate-700 pl-3 py-1">
                {entry.log_entries.map((l, i) => (
                  <div key={i} className={`${
                    l.startsWith('[ABANDONED]') ? 'text-amber-705 dark:text-amber-500 font-semibold' :
                    l.startsWith('[UNATTENDED]') ? 'text-amber-505' :
                    l.startsWith('[OWNER') ? 'text-teal-700 dark:text-teal-500' :
                    l.startsWith('[VISITOR]') ? 'text-purple-650 dark:text-purple-500' :
                    l.startsWith('[ERROR]') ? 'text-rose-600 dark:text-rose-500' :
                    l.startsWith('[SKIP]') ? 'text-slate-500' :
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

function DetectedObjectCard({
  obj,
  onTrackTracklet
}: {
  obj: DetectedObject;
  onTrackTracklet: (videoId: string, trackletIdStr: string, tag: 'OBJECT' | 'OWNER' | 'LOITERER', color: string) => void;
}) {
  const [err, setErr] = useState(false)
  const duration = (obj.timestamp_end_seconds - obj.timestamp_start_seconds).toFixed(1)

  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 flex gap-3.5 items-start shadow-sm hover:border-teal-500/40 transition-all">
      <div className="shrink-0 flex flex-col items-center gap-1.5">
        {!err ? (
          <img
            src={`${API_BASE}${obj.best_crop_path}`}
            alt={obj.class_name}
            className="w-14 h-14 rounded object-cover border border-slate-200 dark:border-slate-700"
            onError={() => setErr(true)}
          />
        ) : (
          <div className="w-14 h-14 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
            <Package className="w-6 h-6 text-slate-450 dark:text-slate-655" />
          </div>
        )}
        <button
          onClick={() => onTrackTracklet(obj.video_id, String(obj.tracker_id), 'OBJECT', '#FF0033')}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-colors"
          title="Track Object in model view (Bright Red)"
        >
          <Target className="w-2.5 h-2.5 text-rose-500" />
          Track
        </button>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-slate-800 dark:text-slate-200 capitalize">
            {obj.class_name}
          </span>
          <span className="text-[10px] font-mono text-slate-500 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-750 px-1.5 py-0.5 rounded leading-none">
            ID {obj.tracker_id}
          </span>
        </div>

        <div className="text-[11px] text-slate-500 dark:text-slate-450 mt-1.5 space-y-0.5">
          <div>Camera: <span className="font-semibold text-slate-700 dark:text-slate-300">{obj.camera_id}</span></div>
          <div>Duration: <span className="font-medium text-slate-700 dark:text-slate-350">{duration}s</span> ({obj.frame_start} - {obj.frame_end})</div>
          <div>Conf: <span className="font-medium text-slate-700 dark:text-slate-350">{(obj.mean_confidence * 100).toFixed(0)}%</span></div>
        </div>
      </div>

      <Link
        to={`/cameras/${obj.camera_id}/videos/${obj.video_id}?track_id=${obj.tracker_id}&tag=OBJECT&color=%23FF0033`}
        className="shrink-0 text-slate-400 hover:text-teal-700 dark:hover:text-teal-500 p-1 transition-colors"
        title="View Video Detail with Object Tracking"
      >
        <ExternalLink className="w-4 h-4" />
      </Link>
    </div>
  )
}

function CrashReconstructionModal({
  alert,
  onClose,
  onDispatch,
}: {
  alert: AlertEntry
  onClose: () => void
  onDispatch: (alertId: number) => void
}) {
  let logData: any = {}
  try {
    logData = alert.analysis_log ? JSON.parse(alert.analysis_log) : {}
  } catch (_) {}

  const severity = logData.severity || 'CRITICAL'
  const confidence = logData.confidence ? Math.round(logData.confidence * 100) : 85
  const vehiclesCount = logData.vehicles_involved || 2
  const timestampSec = logData.collision_timestamp_seconds ?? 0

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
              <Siren className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wide">
                  Collision Forensic Reconstruction
                </h3>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  severity === 'CRITICAL'
                    ? 'bg-rose-600 text-white'
                    : severity === 'HIGH'
                    ? 'bg-amber-500 text-black'
                    : 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 border border-yellow-500/30'
                }`}>
                  {severity} IMPACT
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                Camera: {alert.camera_id} · Impact Time: {timestampSec.toFixed(1)}s · Confidence: {confidence}%
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body: 3-Stage Progression */}
        <div className="p-5 overflow-y-auto space-y-5">
          <div>
            <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Activity className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              3-Stage Collision Progression
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Pre-Crash */}
              <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-2.5 flex flex-col">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1.5 px-0.5">
                  <span>1. Pre-Impact</span>
                  <span className="text-[10px] font-mono text-slate-400">T - 1.5s</span>
                </div>
                <div className="aspect-video w-full rounded-lg bg-black overflow-hidden border border-slate-200 dark:border-slate-800 flex items-center justify-center">
                  {logData.pre_crash_url ? (
                    <img src={`${API_BASE}${logData.pre_crash_url}`} alt="Pre-Crash" className="w-full h-full object-cover" />
                  ) : (
                    <Car className="w-8 h-8 text-slate-700" />
                  )}
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2 px-0.5">
                  Approaching vehicle trajectories prior to point of collision.
                </p>
              </div>

              {/* Point of Impact */}
              <div className="rounded-md border border-rose-500/40 bg-rose-500/[0.04] dark:bg-rose-950/20 p-2.5 flex flex-col shadow-sm ring-1 ring-rose-500/30">
                <div className="flex items-center justify-between text-[11px] font-bold text-rose-600 dark:text-rose-400 mb-1.5 px-0.5">
                  <span className="flex items-center gap-1"><Siren className="w-3.5 h-3.5 animate-pulse" /> 2. Impact Instant</span>
                  <span className="text-[10px] font-mono text-rose-600 dark:text-rose-300 font-bold">T = 0.0s</span>
                </div>
                <div className="aspect-video w-full rounded-lg bg-black overflow-hidden border border-rose-500/50 flex items-center justify-center">
                  {logData.evidence_snapshot_url ? (
                    <img src={`${API_BASE}${logData.evidence_snapshot_url}`} alt="Point of Impact" className="w-full h-full object-cover" />
                  ) : (
                    <AlertTriangle className="w-8 h-8 text-rose-500" />
                  )}
                </div>
                <p className="text-[10px] text-rose-700 dark:text-rose-200 mt-2 px-0.5 font-medium">
                  Direct collision contact. Peak deformation and deceleration zone.
                </p>
              </div>

              {/* Post-Crash */}
              <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-2.5 flex flex-col">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1.5 px-0.5">
                  <span>3. Post-Collision Scene</span>
                  <span className="text-[10px] font-mono text-slate-400">T + 2.5s</span>
                </div>
                <div className="aspect-video w-full rounded-lg bg-black overflow-hidden border border-slate-200 dark:border-slate-800 flex items-center justify-center">
                  {logData.post_crash_url ? (
                    <img src={`${API_BASE}${logData.post_crash_url}`} alt="Post-Crash" className="w-full h-full object-cover" />
                  ) : (
                    <Car className="w-8 h-8 text-slate-700" />
                  )}
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2 px-0.5">
                  Final resting positions and subsequent lane blockage.
                </p>
              </div>
            </div>
          </div>

          {/* Incident Telemetry Details */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-100/60 dark:bg-slate-950/40 p-3.5 rounded-md border border-slate-200 dark:border-slate-800">
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-500">Involved Vehicles</div>
              <div className="text-sm font-bold font-mono text-slate-800 dark:text-slate-200 mt-0.5">~{vehiclesCount} Unit(s)</div>
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-500">Peak Confidence</div>
              <div className="text-sm font-bold font-mono text-rose-600 dark:text-rose-400 mt-0.5">{confidence}%</div>
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-500">Dispatch Status</div>
              <div className={`text-sm font-bold mt-0.5 ${logData.dispatch_status === 'dispatched' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {logData.dispatch_status === 'dispatched' ? 'Dispatched' : 'Pending'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-500">Recorded Timestamp</div>
              <div className="text-sm font-bold font-mono text-slate-800 dark:text-slate-200 mt-0.5">{formatDisplayDate(alert.timestamp)}</div>
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-between flex-wrap gap-2">
          {alert.video_id ? (
            <Link
              to={`/cameras/${alert.camera_id}/videos/${alert.video_id}?seek=${Math.max(0, timestampSec - 2)}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Stream Crash Video ({timestampSec.toFixed(1)}s)
            </Link>
          ) : <div />}

          <div className="flex items-center gap-2">
            {logData.dispatch_status !== 'dispatched' && (
              <button
                onClick={() => onDispatch(alert.id)}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-sm transition-colors"
              >
                <PhoneCall className="w-3.5 h-3.5" />
                Dispatch 108/112 EMS & Police
              </button>
            )}
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AccidentAlertCard({
  alert,
  onAcknowledge,
  onOpenReconstruction,
  onDispatch,
}: {
  alert: AlertEntry
  onAcknowledge: (id: number) => void
  onOpenReconstruction: (alert: AlertEntry) => void
  onDispatch: (alertId: number) => void
}) {
  let logData: any = {}
  try {
    logData = alert.analysis_log ? JSON.parse(alert.analysis_log) : {}
  } catch (_) {}

  const severity = logData.severity || 'CRITICAL'
  const confidence = logData.confidence ? Math.round(logData.confidence * 100) : 85
  const vehiclesCount = logData.vehicles_involved || 2
  const timestampSec = logData.collision_timestamp_seconds ?? 0
  const isDispatched = logData.dispatch_status === 'dispatched'

  return (
    <div className={`rounded-md border p-4 transition-all duration-200 relative overflow-hidden ${
      !alert.acknowledged
        ? 'border-rose-500/50 bg-rose-500/[0.04] dark:border-rose-500/40 dark:bg-rose-950/20 shadow-sm ring-1 ring-rose-500/20'
        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 shadow-xs'
    }`}>
      {/* Top emergency pulse stripe if unacknowledged */}
      {!alert.acknowledged && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-500 via-amber-500 to-rose-600 animate-pulse" />
      )}

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold ${
            severity === 'CRITICAL'
              ? 'bg-rose-600 text-white shadow-xs'
              : 'bg-amber-500 text-black'
          }`}>
            <Siren className="w-3.5 h-3.5 animate-pulse" />
            TRAFFIC COLLISION [{severity}]
          </span>

          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
            <Car className="w-3 h-3 text-slate-500" />
            ~{vehiclesCount} Vehicles Involved
          </span>

          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/40">
            {confidence}% Confidence
          </span>

          {isDispatched && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
              <CheckCheck className="w-3 h-3" />
              108/112 Dispatched
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-800 dark:text-slate-200">{alert.camera_id}</span>
          <span>·</span>
          <span>{formatDisplayDate(alert.timestamp)}</span>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 items-start">
        {/* Evidence thumbnail */}
        <div className="shrink-0 w-full md:w-56 aspect-video rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-950 relative group">
          {logData.evidence_snapshot_url ? (
            <img
              src={`${API_BASE}${logData.evidence_snapshot_url}`}
              alt="Crash Snapshot"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-slate-600">
              <Car className="w-8 h-8 mb-1 text-slate-700" />
              <span className="text-[10px]">No Snapshot</span>
            </div>
          )}
          <div className="absolute bottom-1.5 left-1.5 bg-black/75 backdrop-blur-xs px-1.5 py-0.5 rounded text-[9px] font-mono text-rose-300 font-bold border border-rose-500/30">
            Impact: {timestampSec.toFixed(1)}s
          </div>
        </div>

        {/* Narrative / Description */}
        <div className="flex-1 min-w-0 flex flex-col justify-between h-full space-y-3">
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            High-severity collision detected by the YOLO11x accident model on camera <strong className="text-slate-900 dark:text-slate-100">{alert.camera_id}</strong>. Overlapping impact zone confirmed across multiple frames involving approximately {vehiclesCount} vehicle(s). Immediate emergency protocol activation recommended.
          </p>

          {isDispatched && logData.dispatched_by && (
            <div className="text-[11px] text-emerald-700 dark:text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 rounded-md p-2 flex items-center gap-2">
              <CheckCheck className="w-4 h-4 shrink-0" />
              <span>Units dispatched by <strong>{logData.dispatched_by}</strong> at {formatDisplayDate(logData.dispatched_at)} ({logData.emergency_units || 'EMS & Police'}).</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <button
              onClick={() => onOpenReconstruction(alert)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors"
            >
              <Activity className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
              Reconstruct (3-Stage)
            </button>

            {alert.video_id && (
              <Link
                to={`/cameras/${alert.camera_id}/videos/${alert.video_id}?seek=${Math.max(0, timestampSec - 2)}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors"
              >
                <Play className="w-3.5 h-3.5 text-rose-500 fill-current" />
                Seek ({timestampSec.toFixed(1)}s)
              </Link>
            )}

            {!isDispatched && (
              <button
                onClick={() => onDispatch(alert.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-xs transition-colors"
              >
                <PhoneCall className="w-3.5 h-3.5" />
                Dispatch Units
              </button>
            )}

            {!alert.acknowledged ? (
              <button
                onClick={() => onAcknowledge(alert.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white ml-auto transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Acknowledge
              </button>
            ) : (
              <span className="text-[11px] text-slate-500 ml-auto flex items-center gap-1">
                <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                Acknowledged {alert.acknowledged_by ? `by ${alert.acknowledged_by}` : ''}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Alerts({ cameras = [], onPlayVideoAtTime }: AlertsPageProps) {
  const toast = useToast()
  const [alerts, setAlerts] = useState<AlertEntry[]>([])
  const [summary, setSummary] = useState<{ total_alerts: number; unacknowledged_alerts: number; by_type: Record<string, number> } | null>(null)
  const [loading, setLoading] = useState(true)
  const [analysisLog, setAnalysisLog] = useState<AnalysisLogEntry[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [autoEnabled, setAutoEnabled] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [filterAcknowledged, setFilterAcknowledged] = useState<boolean | undefined>(undefined)
  const [filterCamera, setFilterCamera] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'accident' | 'alerts' | 'loitering' | 'unattended' | 'all-objects'>('all')
  const [selectedCrashModal, setSelectedCrashModal] = useState<AlertEntry | null>(null)
  const [allObjects, setAllObjects] = useState<DetectedObject[]>([])
  const [objectsLoading, setObjectsLoading] = useState(false)
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const logPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [confirmClearLogs, setConfirmClearLogs] = useState(false)

  const [config, setConfig] = useState({
    abandon_time_sec: 15,
    visitor_dist_px: 150,
    owner_bind_dist_px: 200,
    abandon_dist_px: 200,
    stationary_tolerance_px: 15,
    stationary_time_sec: 2,
    occlusion_grace_frames: 30,
  })

  // Load persistent configurations from API
  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/alerts/config`)
      if (res.ok) {
        const data = await res.json()
        setConfig(prev => ({ ...prev, ...data }))
      }
    } catch (e) {
      console.error('Failed to load settings:', e)
    }
  }, [])

  const loadAlerts = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterCamera) params.append('camera_id', filterCamera)
      if (filterAcknowledged !== undefined) params.append('acknowledged', String(filterAcknowledged))
      
      if (activeTab === 'accident') {
        params.append('alert_type', 'accident')
      } else if (activeTab === 'alerts') {
        params.append('alert_type', 'abandoned_object')
      } else if (activeTab === 'loitering') {
        params.append('alert_type', 'loitering')
      } else if (activeTab === 'unattended') {
        params.append('alert_type', 'unattended_object')
      }
      // When activeTab === 'all', omit alert_type parameter to query all incident types

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
  }, [filterCamera, filterAcknowledged, activeTab])

  const loadAllDetectedObjects = useCallback(async () => {
    setObjectsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/alerts/all-objects`)
      if (res.ok) {
        setAllObjects(await res.json())
      }
    } catch (e) {
      console.error(e)
    } finally {
      setObjectsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfig()
    loadAlerts()
    loadAllDetectedObjects()
  }, [loadConfig, loadAlerts, loadAllDetectedObjects])

  const pollLog = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/alerts/analysis-log`)
      if (res.ok) {
        const data = await res.json()
        setAnalysisLog(data.entries || [])
        const anyRunning = (data.entries || []).some((e: AnalysisLogEntry) => e.status === 'running' || e.status === 'pending')
        if (!anyRunning) {
          setIsRunning(false)
          if (logPollRef.current) clearInterval(logPollRef.current)
          toast.success('Analysis Completed', 'Object analysis and abandoned object evaluation finished.')
          loadAlerts()
          loadAllDetectedObjects()
        }
      }
    } catch {}
  }, [loadAlerts, loadAllDetectedObjects, toast])

  const runAnalysis = async () => {
    setIsRunning(true)
    setAnalysisLog([])
    toast.info('Analysis Started', 'Evaluating spatial-temporal tracklets across all camera feeds...')
    try {
      // First save configuration to ensure backend gets fresh settings
      await fetch(`${API_BASE}/api/v1/alerts/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      
      await fetch(`${API_BASE}/api/v1/alerts/trigger-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      logPollRef.current = setInterval(pollLog, 1000)
    } catch (e) {
      setIsRunning(false)
      toast.error('Analysis Failed', 'Failed to trigger alert analysis.')
    }
  }

  const saveConfigSettings = async () => {
    setSavingSettings(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/alerts/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (res.ok) {
        setFeedbackMsg('Settings saved successfully.')
        setTimeout(() => setFeedbackMsg(null), 3000)
      } else {
        setFeedbackMsg('Failed to save settings.')
      }
    } catch (e) {
      setFeedbackMsg('Failed to save settings.')
    } finally {
      setSavingSettings(false)
    }
  }

  const resetDefaultSettings = async () => {
    const defaults = {
      abandon_time_sec: 15,
      visitor_dist_px: 150,
      owner_bind_dist_px: 200,
      abandon_dist_px: 200,
      stationary_tolerance_px: 15,
      stationary_time_sec: 2,
      occlusion_grace_frames: 30,
    }
    setConfig(defaults)
    setSavingSettings(true)
    try {
      await fetch(`${API_BASE}/api/v1/alerts/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(defaults),
      })
      setFeedbackMsg('Settings reset to defaults.')
      setTimeout(() => setFeedbackMsg(null), 3000)
    } finally {
      setSavingSettings(false)
    }
  }

  const clearLogsAndAlerts = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/alerts/clear`, { method: 'DELETE' })
      if (res.ok) {
        setAlerts([])
        setAnalysisLog([])
        setAllObjects([])
        setSummary({ total_alerts: 0, unacknowledged_alerts: 0, by_type: {} })
        setConfirmClearLogs(false)
        toast.success('Alerts Cleared', 'All active alert records and evaluation logs cleared.')
      } else {
        toast.error('Clear Failed', 'Could not clear alert logs.')
      }
    } catch (e) {
      toast.error('Error', 'Failed to clear alert logs.')
    }
  }

  const handleTrackTracklet = async (
    videoId: string,
    trackletIdStr: string,
    tag: 'OBJECT' | 'OWNER' | 'LOITERER',
    color: string
  ) => {
    if (!onPlayVideoAtTime) return
    try {
      const [vRes, dRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/videos/${videoId}`),
        fetch(`${API_BASE}/api/v1/videos/${videoId}/detections`),
      ])
      if (!vRes.ok) return
      const vData = await vRes.json()
      const videoAsset = vData.video

      let timestamp = 0
      let bestBbox: number[] | undefined = undefined
      let className = tag === 'OBJECT' ? 'object' : 'person'

      const trkNum = extractTrackerId(trackletIdStr)

      if (dRes.ok) {
        const dData = await dRes.json()
        const tracklets = dData.tracklets || []
        const matched = tracklets.find((t: any) => String(t.tracker_id) === String(trkNum))
        if (matched) {
          timestamp = matched.timestamp_start_seconds ?? 0
          bestBbox = matched.best_bbox
          className = matched.class_name ?? className
        } else {
          // Fallback frame detections
          for (const fd of dData.frame_detections || []) {
            const found = (fd.detections || []).find((d: any) => String(d.tracker_id) === String(trkNum))
            if (found) {
              timestamp = fd.timestamp_seconds ?? 0
              bestBbox = found.bbox
              className = found.class_name ?? className
              break
            }
          }
        }
      }

      onPlayVideoAtTime(videoAsset, timestamp, trkNum, bestBbox, className, tag, color)
    } catch (e) {
      console.error('Failed to launch video tracking:', e)
    }
  }

  const handleAcknowledge = (alertId: number) => {
    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, acknowledged: true } : a))
    setSummary(prev => prev ? { ...prev, unacknowledged_alerts: Math.max(0, prev.unacknowledged_alerts - 1) } : prev)
    toast.success('Alert Acknowledged', `Incident #${alertId} confirmed.`)
    window.dispatchEvent(new CustomEvent('tracenet:alert-ack'))
  }

  const handleDispatch = async (alertId: number) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/accidents/${alertId}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operator_name: 'Traffic Control Operator', emergency_units: '108 Ambulance & 112 Patrol' }),
      })
      if (res.ok) {
        const updated = await res.json()
        setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, ...updated, acknowledged: true } : a))
        setSummary(prev => prev ? { ...prev, unacknowledged_alerts: Math.max(0, prev.unacknowledged_alerts - 1) } : prev)
        toast.success('Emergency Dispatched', `108/112 units dispatched for collision alert #${alertId}.`)
        window.dispatchEvent(new CustomEvent('tracenet:alert-ack'))
        if (selectedCrashModal?.id === alertId) {
          setSelectedCrashModal(null)
        }
      } else {
        toast.error('Dispatch Failed', 'Could not record emergency dispatch.')
      }
    } catch (e) {
      toast.error('Dispatch Error', 'Failed to contact emergency dispatch service.')
    }
  }

  const [confirmClearArtifacts, setConfirmClearArtifacts] = useState(false)

  const clearArtifacts = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/alerts/clear-artifacts`, { method: 'POST' })
      if (!res.ok) throw new Error('Clear failed')
      toast.success('Artifacts Cleared', 'Active alert records and evaluation logs reset.')
      setConfirmClearArtifacts(false)
      loadAlerts()
      setAnalysisLog([])
    } catch (e) {
      toast.error('Clear Failed', 'Failed to clear alert records.')
    }
  }

  const acked = alerts.filter(a => a.acknowledged).length

  return (
    <div className="space-y-5 pb-24 text-slate-800 dark:text-slate-100">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-700/60 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Abandoned Object Alerts</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Post-processing analysis of completed videos for unattended objects.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {/* Auto-analysis toggle */}
          <button
            onClick={() => setAutoEnabled(p => !p)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
            title={autoEnabled ? 'Auto-analysis ON' : 'Auto-analysis OFF'}
          >
            {autoEnabled
              ? <ToggleRight className="w-4.5 h-4.5 text-teal-600 dark:text-teal-400" />
              : <ToggleLeft className="w-4.5 h-4.5 text-slate-400 dark:text-slate-500" />}
            <span>Auto: <span className={autoEnabled ? 'text-teal-600 dark:text-teal-400' : 'text-slate-500'}>{autoEnabled ? 'ON' : 'OFF'}</span></span>
          </button>

          {/* Settings toggle */}
          <button
            onClick={() => setShowSettings(p => !p)}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-semibold transition-colors ${
              showSettings ? 'border-teal-500/40 bg-teal-500/10 text-teal-600 dark:text-teal-400' : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title="Analysis Settings & Configuration"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Configure Thresholds</span>
          </button>

          {/* Clear Logs Button */}
          {confirmClearLogs ? (
            <div className="flex items-center gap-1 bg-rose-950/40 border border-rose-500/40 rounded-lg px-2 py-1 animate-in fade-in">
              <span className="text-[10px] font-bold text-rose-300">Clear all records?</span>
              <button
                onClick={clearLogsAndAlerts}
                className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold transition-colors"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmClearLogs(false)}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-medium transition-colors"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmClearLogs(true)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/40 text-xs font-semibold transition-colors"
              title="Clear Evaluation Logs"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Logs</span>
            </button>
          )}

          {/* Clear Artifacts Button */}
          {confirmClearArtifacts ? (
            <div className="flex items-center gap-1 bg-rose-950/40 border border-rose-500/40 rounded-lg px-2 py-1 animate-in fade-in">
              <span className="text-[10px] font-bold text-rose-300">Clear all records?</span>
              <button
                onClick={clearArtifacts}
                className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold transition-colors"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmClearArtifacts(false)}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-medium transition-colors"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmClearArtifacts(true)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition-colors"
              title="Clear active alert records and reset evaluation logs"
            >
              <RotateCcw className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
              <span>Clear Artifacts</span>
            </button>
          )}

          {/* Run now */}
          <button
            onClick={runAnalysis}
            disabled={isRunning}
            className="inline-flex items-center gap-2 h-8 px-4 bg-teal-600 hover:bg-teal-700 dark:bg-teal-600 dark:hover:bg-teal-500 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold transition-colors shadow-sm"
          >
            {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {isRunning ? 'Analyzing...' : 'Run Analysis'}
          </button>

          <button
            onClick={() => { loadAlerts(); loadAllDetectedObjects(); }}
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4 shadow-sm">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-slate-400 dark:text-slate-500" />
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">Analysis Configuration</span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-1">(saved configuration file)</span>
            </div>
            
            {/* Feedback Message & Actions */}
            <div className="flex items-center gap-2">
              {feedbackMsg && (
                <span className={`text-[11px] font-semibold px-2.5 py-1 rounded flex items-center gap-1 border ${
                  feedbackMsg.includes('successfully') || feedbackMsg.includes('defaults')
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                    : 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400'
                }`}>
                  <CheckCheck className="w-3 h-3" />
                  {feedbackMsg}
                </span>
              )}
              
              <button
                onClick={resetDefaultSettings}
                className="inline-flex items-center gap-1 h-7 px-2.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded text-[11px] font-medium transition-colors"
                title="Reset to Default Settings"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Defaults</span>
              </button>

              <button
                onClick={saveConfigSettings}
                disabled={savingSettings}
                className="inline-flex items-center gap-1.5 h-7 px-3 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white rounded text-[11px] font-bold transition-colors"
              >
                {savingSettings ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save & Apply Settings
              </button>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {CONFIG_METADATA.map(({ key, label, min, max, step, description, strictness }) => (
              <div key={key} className="space-y-1.5 border border-slate-200/80 dark:border-slate-700/60 p-3 rounded bg-slate-50/40 dark:bg-slate-900/20">
                <div className="flex justify-between items-center text-[11px] font-bold text-slate-750 dark:text-slate-305">
                  <span>{label}</span>
                  <input
                    type="number"
                    min={min}
                    max={max}
                    step={step}
                    value={config[key as keyof typeof config]}
                    onChange={e => setConfig(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                    className="h-7 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 text-xs font-mono font-bold text-teal-700 dark:text-teal-400 w-24 text-right outline-none focus:border-teal-600 shadow-inner"
                  />
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-normal">
                  {description}
                </div>
                <div className="text-[9px] text-slate-450 dark:text-slate-500 leading-normal italic bg-white dark:bg-slate-900/50 p-1.5 border border-slate-100 dark:border-slate-800 rounded">
                  <span className="font-semibold not-italic">Calibration:</span> {strictness}
                </div>
              </div>
            ))}
          </div>

          {/* Camera participation toggles */}
          {cameras.length > 0 && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-700/60">
              <div className="text-[10px] font-bold text-slate-550 dark:text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" /> Camera Alert Opt-in
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
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3.5">
          <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Alerts</div>
            <div className="text-2xl font-bold font-mono text-slate-800 dark:text-slate-100 mt-1">{summary.total_alerts}</div>
          </div>
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 dark:border-rose-500/30 dark:bg-rose-950/30 p-4 text-rose-700 dark:text-rose-400 shadow-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
              <Siren className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 animate-pulse" /> Traffic Collisions
            </div>
            <div className="text-2xl font-bold font-mono text-rose-800 dark:text-rose-300 mt-1">{summary.by_type?.accident || 0}</div>
          </div>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 dark:border-amber-500/30 dark:bg-amber-950/30 p-4 text-amber-700 dark:text-amber-400 shadow-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" /> Unacknowledged
            </div>
            <div className="text-2xl font-bold font-mono text-amber-800 dark:text-amber-300 mt-1">{summary.unacknowledged_alerts}</div>
          </div>
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 dark:border-emerald-500/30 dark:bg-emerald-950/30 p-4 text-emerald-700 dark:text-emerald-400 shadow-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> Acknowledged
            </div>
            <div className="text-2xl font-bold font-mono text-emerald-800 dark:text-emerald-300 mt-1">{acked}</div>
          </div>
          <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Users className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" /> Persons of Interest
            </div>
            <div className="text-2xl font-bold font-mono text-slate-800 dark:text-slate-100 mt-1">
              {alerts.reduce((s, a) => s + (a.visitor_tracklet_ids?.length || 0), 0)}
            </div>
          </div>
        </div>
      )}

      {/* Analysis Log Panel */}
      <AnalysisLogPanel entries={analysisLog} />

      {/* Navigation Tabs Header */}
      <div className="flex border-b border-slate-200 dark:border-slate-700/60 gap-4 text-xs font-semibold overflow-x-auto whitespace-nowrap">
        <button
          onClick={() => setActiveTab('all')}
          className={`pb-2.5 px-1 border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === 'all'
              ? 'border-teal-700 dark:border-teal-500 text-teal-700 dark:text-teal-500 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          All Incident Alerts ({summary?.total_alerts ?? alerts.length})
        </button>
        <button
          onClick={() => setActiveTab('accident')}
          className={`pb-2.5 px-1 border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === 'accident'
              ? 'border-rose-600 dark:border-rose-500 text-rose-600 dark:text-rose-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <Siren className="w-4 h-4 text-rose-500" />
          Traffic Collisions ({summary?.by_type?.accident || 0})
        </button>
        <button
          onClick={() => setActiveTab('alerts')}
          className={`pb-2.5 px-1 border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === 'alerts'
              ? 'border-teal-700 dark:border-teal-500 text-teal-700 dark:text-teal-500'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          Flagged Abandonments ({summary?.by_type?.abandoned_object || 0})
        </button>
        <button
          onClick={() => setActiveTab('loitering')}
          className={`pb-2.5 px-1 border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === 'loitering'
              ? 'border-violet-700 dark:border-violet-500 text-violet-700 dark:text-violet-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <Clock className="w-4 h-4 text-violet-500" />
          Loitering Reviews ({summary?.by_type?.loitering || 0})
        </button>
        <button
          onClick={() => setActiveTab('unattended')}
          className={`pb-2.5 px-1 border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === 'unattended'
              ? 'border-teal-700 dark:border-teal-500 text-teal-700 dark:text-teal-500'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <ShieldAlert className="w-4 h-4 text-teal-500" />
          Unattended Objects ({summary?.by_type?.unattended_object || 0})
        </button>
        <button
          onClick={() => setActiveTab('all-objects')}
          className={`pb-2.5 px-1 border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === 'all-objects'
              ? 'border-teal-700 dark:border-teal-500 text-teal-700 dark:text-teal-500'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <Database className="w-4 h-4" />
          All Detected Objects ({allObjects.length})
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab !== 'all-objects' ? (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={filterCamera}
              onChange={e => setFilterCamera(e.target.value)}
              className="h-8 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-850 px-3 text-xs text-slate-700 dark:text-slate-300 outline-none focus:border-teal-600"
            >
              <option value="">All Cameras</option>
              {cameras.map(c => <option key={c.camera_id} value={c.camera_id}>{c.name}</option>)}
            </select>
            <div className="flex rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-850 text-xs overflow-hidden h-8">
              {[['All', undefined], ['Active', false], ['Resolved', true]].map(([label, val]) => (
                <button
                  key={String(label)}
                  onClick={() => setFilterAcknowledged(val as boolean | undefined)}
                  className={`px-3 py-1 font-medium transition-colors ${
                    filterAcknowledged === val
                      ? 'bg-teal-700 text-white dark:bg-teal-600'
                      : 'text-slate-500 hover:text-slate-705 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
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
            <div className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 py-16 text-center">
              <Package className="w-8 h-8 text-slate-350 dark:text-slate-700 mx-auto mb-3" />
              <div className="text-sm font-medium text-slate-500">
                {activeTab === 'accident'
                  ? 'No traffic collision alerts found'
                  : activeTab === 'loitering'
                  ? 'No loitering review alerts found'
                  : activeTab === 'unattended'
                  ? 'No unattended object logs found'
                  : 'No active incident alerts found'}
              </div>
              <div className="text-xs text-slate-400 dark:text-slate-600 mt-1">
                Completed videos will be evaluated using the automated detection models.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map(alert => (
                alert.alert_type === 'accident' ? (
                  <AccidentAlertCard
                    key={alert.id}
                    alert={alert}
                    onAcknowledge={handleAcknowledge}
                    onOpenReconstruction={a => setSelectedCrashModal(a)}
                    onDispatch={handleDispatch}
                  />
                ) : (
                  <AbandonedAlertCard
                    key={alert.id}
                    alert={alert}
                    onAcknowledge={handleAcknowledge}
                    onTrackTracklet={handleTrackTracklet}
                  />
                )
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Info className="w-4 h-4 text-teal-700 dark:text-teal-500 shrink-0" />
            <span>This tab lists all general object tracklets detected across non-binned videos. Use this grid to review potential missed objects that didn't trigger an automated alert.</span>
          </div>

          {objectsLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading detected objects...</span>
            </div>
          ) : allObjects.length === 0 ? (
            <div className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 py-16 text-center">
              <Package className="w-8 h-8 text-slate-350 dark:text-slate-700 mx-auto mb-3" />
              <div className="text-sm font-medium text-slate-500">No object detections indexed</div>
              <div className="text-xs text-slate-400 dark:text-slate-600 mt-1">
                Videos processed with models supporting luggage classes will list detections here.
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {allObjects.map(obj => (
                <DetectedObjectCard
                  key={obj.id}
                  obj={obj}
                  onTrackTracklet={handleTrackTracklet}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Crash Reconstruction Modal */}
      {selectedCrashModal && (
        <CrashReconstructionModal
          alert={selectedCrashModal}
          onClose={() => setSelectedCrashModal(null)}
          onDispatch={handleDispatch}
        />
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
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded border text-[10px] font-semibold transition-all ${
        participating
          ? 'border-teal-500/30 bg-teal-500/5 text-teal-700 dark:border-teal-500/40 dark:bg-teal-950/20 dark:text-teal-400'
          : 'border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-500'
      }`}
    >
      {saving ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : participating ? (
        <Radio className="w-3 h-3 text-teal-700 dark:text-teal-500" />
      ) : (
        <Minus className="w-3 h-3 text-slate-450 dark:text-slate-600" />
      )}
      {camera.name}
    </button>
  )
}
