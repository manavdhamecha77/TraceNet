import React from 'react'
import { API_BASE } from '../config/api'
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

  return (
    <div className="w-full rounded-md border border-slate-200 bg-white p-4 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      {/* Top summary stats bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-3 pb-3 border-b border-slate-200 text-xs dark:border-slate-700">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-teal-50 text-teal-800 font-semibold border border-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-800">
            <Navigation className="w-3.5 h-3.5" />
            {steps.length} Camera Hops
          </span>
          <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <MapPin className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
            {(totalDistanceMeters / 1000).toFixed(2)} km Total Trajectory
          </span>
          <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            {Math.floor(totalDurationSeconds / 60)}m {Math.round(totalDurationSeconds % 60)}s Elapsed
          </span>
        </div>
        <span className="text-slate-500 dark:text-slate-400 text-[11px]">
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
              <div className="flex flex-col items-center justify-center shrink-0 px-1 text-slate-500 dark:text-slate-400">
                  <ChevronRight className="w-4 h-4 text-slate-500" />
                  <span className="text-[10px] font-mono text-teal-700 dark:text-teal-300 flex items-center gap-0.5">
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
                    ? 'bg-teal-50 border-teal-500 ring-2 ring-teal-500/20 dark:bg-teal-900/30 dark:border-teal-500 dark:ring-teal-500/30'
                    : 'bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300 dark:bg-slate-800 dark:border-slate-700 dark:hover:bg-slate-700 dark:hover:border-slate-600'
                }`}
              >
                {/* Step badge */}
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      isActive ? 'bg-teal-700 text-white dark:bg-teal-500 dark:text-slate-950' : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                    }`}
                  >
                    Hop #{st.step}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                    <ShieldCheck className="w-3 h-3" />
                    {(st.confidence * 100).toFixed(0)}% Match
                  </span>
                </div>

                {/* Crop & Metadata */}
                <div className="flex gap-3 items-center">
                  <div className="w-14 h-14 rounded border border-slate-200 bg-slate-100 overflow-hidden shrink-0 dark:border-slate-700 dark:bg-slate-900">
                    {st.best_crop_path ? (
                      <img
                        src={cropUrl}
                        alt={st.class_name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-500 dark:text-slate-500 text-xs">
                        No Crop
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                      {st.camera_name}
                    </span>
                    <span className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
                      {st.camera_id} • {st.class_name}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
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
