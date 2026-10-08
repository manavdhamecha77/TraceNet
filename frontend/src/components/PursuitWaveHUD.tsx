import React from 'react'
import { Radar, Clock, MapPin, XCircle, CheckCircle2, Flame } from 'lucide-react'

export interface PursuitNode {
  camera_id: string
  name: string
  latitude?: number
  longitude?: number
  distance_meters: number
  is_direct_neighbor: boolean
  eta_min_seconds: number
  eta_max_seconds: number
  eta_min_time: string
  eta_max_time: string
  status: 'watching' | 'matched' | 'passed'
}

export interface PursuitSession {
  id: string
  target_tracklet_id?: string
  status: string
  origin_camera_id: string
  speed_mode: string
  downstream_nodes: PursuitNode[]
  created_at: string
  matched_camera_id?: string
  matched_tracklet_id?: string
}

interface PursuitWaveHUDProps {
  activeSession: PursuitSession | null
  onTerminateSession: (sessionId: string) => void
}

export const PursuitWaveHUD: React.FC<PursuitWaveHUDProps> = ({
  activeSession,
  onTerminateSession
}) => {
  if (!activeSession) return null

  const isMatched = activeSession.status === 'matched'

  return (
    <div className="absolute top-4 right-4 z-[90] w-96 max-w-[calc(100vw-2rem)] rounded-md bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl border border-slate-200 dark:border-slate-700 p-4 text-slate-800 dark:text-slate-100 shadow-lg">
      {/* HUD Header */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Radar className="w-5 h-5 text-teal-700 dark:text-teal-300 animate-spin" style={{ animationDuration: '4s' }} />
            <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-600"></span>
            </span>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-teal-800 dark:text-teal-300">
              Pursuit Wave
            </h3>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">ID: {activeSession.id.slice(0, 8)}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onTerminateSession(activeSession.id)}
          className="text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-300 transition-colors p-1"
          title="Terminate Pursuit Session"
        >
          <XCircle className="w-5 h-5" />
        </button>
      </div>

      {/* Target Status Card */}
      {isMatched ? (
        <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 p-3 flex items-center gap-3 dark:border-emerald-800 dark:bg-emerald-950/30">
          <CheckCircle2 className="w-6 h-6 text-emerald-700 dark:text-emerald-300 shrink-0" />
          <div>
            <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">Downstream match confirmed</div>
            <div className="text-[11px] text-emerald-700 dark:text-emerald-200">
              Target detected at <span className="font-semibold text-slate-900 dark:text-white">{activeSession.matched_camera_id}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-3 rounded border border-teal-200 bg-teal-50 p-2.5 flex items-center justify-between text-xs dark:border-teal-800 dark:bg-teal-950/30">
          <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
            <Flame className="w-4 h-4 text-amber-400" />
            Speed Profile: <strong className="text-teal-800 dark:text-teal-300 uppercase">{activeSession.speed_mode}</strong>
          </span>
          <span className="text-[11px] text-slate-600 dark:text-slate-300">
            Origin: <strong className="text-slate-800 dark:text-slate-100">{activeSession.origin_camera_id}</strong>
          </span>
        </div>
      )}

      {/* Downstream Pursuit Camera List */}
      <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-2 flex items-center justify-between">
        <span>Active Downstream Watch Nodes ({activeSession.downstream_nodes?.length || 0})</span>
        <span className="text-[10px] text-teal-800 dark:text-teal-300">Realtime scanning</span>
      </div>

      <div className="max-h-48 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-slate-700">
        {activeSession.downstream_nodes?.map((node) => (
          <div
            key={node.camera_id}
            className="flex items-center justify-between p-2.5 rounded border border-slate-200 bg-white text-xs hover:border-teal-400 transition-colors dark:border-slate-700 dark:bg-slate-900 dark:hover:border-teal-600"
          >
            <div className="flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5 text-teal-700 dark:text-teal-300 shrink-0" />
              <div>
                <div className="font-semibold text-slate-800 dark:text-slate-100">{node.name}</div>
                <div className="text-[10px] text-slate-600 dark:text-slate-400">
                  {node.camera_id} • {(node.distance_meters / 1000).toFixed(2)} km away
                </div>
              </div>
            </div>

            <div className="text-right">
              <div className="flex items-center gap-1 text-[11px] font-mono text-slate-700 dark:text-slate-300">
                <Clock className="w-3 h-3" />
                {node.eta_min_time} - {node.eta_max_time}
              </div>
              <div className="text-[9px] text-slate-500 dark:text-slate-400 font-mono">
                Window: +{Math.round(node.eta_min_seconds)}s .. +{Math.round(node.eta_max_seconds)}s
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
