
interface DashboardProps {
  metrics: {
    totalCameras: number
    totalVideos: number
    processedVideos: number
    pendingVideos: number
    failedVideos: number
  }
}

export default function Dashboard({ metrics }: DashboardProps) {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">System Dashboard</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Overview of registered forensic devices, ingestion queue status, and pipeline execution logs.
        </p>
      </div>

      {/* METRIC GRID */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-750 p-4 rounded-md shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">Registered Cameras</span>
            <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1">{metrics.totalCameras}</h3>
          </div>
          <span className="p-2.5 bg-teal-500/10 text-teal-700 dark:text-teal-400 rounded-md">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </span>
        </div>

        <div className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-750 p-4 rounded-md shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">Total Video Feeds</span>
            <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1">{metrics.totalVideos}</h3>
          </div>
          <span className="p-2.5 bg-teal-500/10 text-teal-700 dark:text-teal-400 rounded-md">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
            </svg>
          </span>
        </div>

        <div className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-750 p-4 rounded-md shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">Standardized (Processed)</span>
            <h3 className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{metrics.processedVideos}</h3>
          </div>
          <span className="p-2.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-md">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </span>
        </div>

        <div className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-750 p-4 rounded-md shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">Queue / Processing</span>
            <h3 className="text-2xl font-bold text-amber-600 dark:text-amber-500 mt-1">{metrics.pendingVideos}</h3>
          </div>
          <span className="p-2.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-md">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18.5" />
            </svg>
          </span>
        </div>
      </section>

      {/* PIPELINE BRIEF SUMMARY */}
      <section className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-6 rounded-md shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-4">Forensic Preprocessing Pipeline Status</h3>
        <div className="space-y-4">
          <div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-md flex justify-between items-center">
            <div className="space-y-0.5">
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">Ingestion API & Sandbox</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Accepts diverse file inputs (.mov, .avi, .mp4) and logs real-world alignment times.</p>
            </div>
            <span className="px-2.5 py-0.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-full text-[10px] font-bold">Online</span>
          </div>

          <div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-md flex justify-between items-center">
            <div className="space-y-0.5">
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">FFmpeg Resolution & Framerate Transcoder</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Forces 720p resolution and down-scales framerate to 10 FPS for optimal indexing.</p>
            </div>
            <span className="px-2.5 py-0.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-full text-[10px] font-bold">Ready</span>
          </div>

          <div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-md flex justify-between items-center">
            <div className="space-y-0.5">
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">OpenCV Timeline-Proportional Frame Sampler</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Pulls exactly 4 frames per second in-memory. Zero frame-image disk write overhead.</p>
            </div>
            <span className="px-2.5 py-0.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-full text-[10px] font-bold">Ready</span>
          </div>

          <div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-md flex justify-between items-center opacity-60">
            <div className="space-y-0.5">
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">YOLOv8 & ByteTrack Detection (Stage 2)</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Identifies and labels person/vehicle coordinates and tracks consistency.</p>
            </div>
            <span className="px-2.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-450 rounded-full text-[10px] font-bold">Locked for Stage 2</span>
          </div>
        </div>
      </section>
    </div>
  )
}
