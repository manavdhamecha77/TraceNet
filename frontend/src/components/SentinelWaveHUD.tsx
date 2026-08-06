import React from 'react'
import { Radar, Clock, MapPin, XCircle, CheckCircle2, Flame } from 'lucide-react'

export interface SentinelNode {
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

export interface SentinelSession {
  id: string
  target_tracklet_id?: string
  status: string
  origin_camera_id: string
  speed_mode: string
  downstream_nodes: SentinelNode[]
  created_at: string
  matched_camera_id?: string
  matched_tracklet_id?: string
}

interface SentinelWaveHUDProps {
  activeSession: SentinelSession | null
  onTerminateSession: (sessionId: string) => void
}

export const SentinelWaveHUD: React.FC<SentinelWaveHUDProps> = ({
  activeSession,
  onTerminateSession
}) => {
  if (!activeSession) return null

  const isMatched = activeSession.status === 'matched'

  return (
    <div className="absolute top-4 right-4 z-[90] w-96 rounded-2xl bg-slate-900/90 backdrop-blur-xl border border-sky-500/30 p-4 text-white shadow-2xl shadow-sky-950/50">
      {/* HUD Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Radar className="w-5 h-5 text-sky-400 animate-spin" style={{ animationDuration: '4s' }} />
            <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
            </span>
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-sky-300">
              Sentinel Pursuit Wave
            </h3>
            <p className="text-[10px] text-slate-400 font-mono">ID: {activeSession.id.slice(0, 8)}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onTerminateSession(activeSession.id)}
          className="text-slate-400 hover:text-rose-400 transition-colors p-1"
          title="Terminate Sentinel Session"
        >
          <XCircle className="w-5 h-5" />
        </button>
      </div>

      {/* Target Status Card */}
      {isMatched ? (
        <div className="mb-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 flex items-center gap-3">
          <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
          <div>
            <div className="text-xs font-bold text-emerald-300">DOWNSTREAM MATCH CONFIRMED!</div>
            <div className="text-[11px] text-emerald-200/80">
              Target detected at <span className="font-semibold text-white">{activeSession.matched_camera_id}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-3 rounded-xl bg-sky-500/10 border border-sky-500/20 p-2.5 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-slate-300">
            <Flame className="w-4 h-4 text-amber-400" />
            Speed Profile: <strong className="text-sky-300 uppercase">{activeSession.speed_mode}</strong>
          </span>
          <span className="text-[11px] text-slate-400">
            Origin: <strong>{activeSession.origin_camera_id}</strong>
          </span>
        </div>
      )}

      {/* Downstream Sentinel Camera List */}
      <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between">
        <span>Active Downstream Watch Nodes ({activeSession.downstream_nodes?.length || 0})</span>
        <span className="text-[10px] text-sky-400">Realtime Scanning</span>
      </div>

      <div className="max-h-48 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-slate-700">
        {activeSession.downstream_nodes?.map((node) => (
          <div
            key={node.camera_id}
            className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-xs hover:border-slate-600 transition-colors"
          >
            <div className="flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <div>
                <div className="font-semibold text-slate-200">{node.name}</div>
                <div className="text-[10px] text-slate-400">
                  {node.camera_id} • {(node.distance_meters / 1000).toFixed(2)} km away
                </div>
              </div>
            </div>

            <div className="text-right">
              <div className="flex items-center gap-1 text-[11px] font-mono text-amber-300">
                <Clock className="w-3 h-3" />
                {node.eta_min_time} - {node.eta_max_time}
              </div>
              <div className="text-[9px] text-slate-400 font-mono">
                Window: +{Math.round(node.eta_min_seconds)}s .. +{Math.round(node.eta_max_seconds)}s
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
