import React from 'react'
import { MapPin, Navigation, Clock, ShieldCheck, ChevronRight, Zap } from 'lucide-react'

export interface JourneyStep {
  step: number
  tracklet_id: string
  camera_id: string
  camera_name: string
  latitude?: number
  longitude?: number
  object_type: string
  class_name: string
  timestamp_start_seconds: number
  timestamp_end_seconds: number
  abs_timestamp: number
  confidence: number
  best_crop_path: string
  caption?: string
  speed_to_here_kmh: number
  dist_from_prev_m: number
}

interface JourneyMapScrubberProps {
  steps: JourneyStep[]
  activeStep: number
  onSelectStep: (stepNumber: number) => void
  totalDistanceMeters: number
  totalDurationSeconds: number
}

export const JourneyMapScrubber: React.FC<JourneyMapScrubberProps> = ({
  steps,
  activeStep,
  onSelectStep,
  totalDistanceMeters,
  totalDurationSeconds
}) => {
  if (!steps || steps.length === 0) return null

  const API_BASE = 'http://localhost:8000'

  return (
    <div className="w-full bg-slate-900/90 backdrop-blur-md border-t border-slate-800 p-4 text-white shadow-2xl">
      {/* Top summary stats bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-3 pb-3 border-b border-slate-800 text-xs">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-400 font-semibold border border-emerald-500/20">
            <Navigation className="w-3.5 h-3.5" />
            {steps.length} Camera Hops
          </span>
          <span className="flex items-center gap-1.5 text-slate-300">
            <MapPin className="w-3.5 h-3.5 text-sky-400" />
            {(totalDistanceMeters / 1000).toFixed(2)} km Total Trajectory
          </span>
          <span className="flex items-center gap-1.5 text-slate-300">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            {Math.floor(totalDurationSeconds / 60)}m {Math.round(totalDurationSeconds % 60)}s Elapsed
          </span>
        </div>
        <span className="text-slate-400 text-[11px]">
          Click any step to scrub location & focus map view
        </span>
      </div>

      {/* Step Horizontal Scrubber */}
      <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-700">
        {steps.map((st, idx) => {
          const isActive = st.step === activeStep
          const cropUrl = st.best_crop_path.startsWith('http')
            ? st.best_crop_path
            : `${API_BASE}${st.best_crop_path}`

          return (
            <React.Fragment key={st.tracklet_id}>
              {idx > 0 && (
                <div className="flex flex-col items-center justify-center shrink-0 px-1 text-slate-600">
                  <ChevronRight className="w-4 h-4 text-slate-500" />
                  <span className="text-[10px] font-mono text-cyan-400 flex items-center gap-0.5">
                    <Zap className="w-2.5 h-2.5" />
                    {st.speed_to_here_kmh} km/h
                  </span>
                </div>
              )}

              <button
                type="button"
                onClick={() => onSelectStep(st.step)}
                className={`group relative flex flex-col w-56 shrink-0 rounded-xl p-3 text-left transition-all border ${
                  isActive
                    ? 'bg-sky-950/80 border-sky-500 ring-2 ring-sky-500/40 shadow-lg shadow-sky-500/10'
                    : 'bg-slate-800/60 border-slate-700/60 hover:bg-slate-800 hover:border-slate-600'
                }`}
              >
                {/* Step badge */}
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      isActive ? 'bg-sky-500 text-slate-950' : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    Hop #{st.step}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                    <ShieldCheck className="w-3 h-3" />
                    {(st.confidence * 100).toFixed(0)}% Match
                  </span>
                </div>

                {/* Crop & Metadata */}
                <div className="flex gap-3 items-center">
                  <div className="w-14 h-14 rounded-lg bg-slate-950 border border-slate-700 overflow-hidden shrink-0">
                    {st.best_crop_path ? (
                      <img
                        src={cropUrl}
                        alt={st.class_name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-600 text-xs">
                        No Crop
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-semibold text-slate-100 truncate">
                      {st.camera_name}
                    </span>
                    <span className="text-[11px] text-slate-400 truncate">
                      {st.camera_id} • {st.class_name}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono mt-0.5">
                      Offset: {Math.floor(st.timestamp_start_seconds)}s
                    </span>
                  </div>
                </div>
              </button>
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}
