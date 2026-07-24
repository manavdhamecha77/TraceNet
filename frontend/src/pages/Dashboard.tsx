
interface DashboardProps {
  metrics: {
    totalCameras: number
    totalVideos: number
    processedVideos: number
    pendingVideos: number
    failedVideos: number
  }
}

const pipelineStages = [
  {
    name: 'Ingestion API & Sandbox',
    desc: 'Accepts diverse file inputs (.mov, .avi, .mp4) and logs real-world alignment times.',
    status: 'Online',
    statusClass: 'pill-online',
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
      </svg>
    ),
  },
  {
    name: 'FFmpeg Resolution & Framerate Transcoder',
    desc: 'Forces 720p resolution and down-scales framerate to 10 FPS for optimal indexing.',
    status: 'Ready',
    statusClass: 'pill-online',
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    name: 'OpenCV Timeline-Proportional Frame Sampler',
    desc: 'Pulls exactly 4 frames per second in-memory. Zero frame-image disk write overhead.',
    status: 'Ready',
    statusClass: 'pill-online',
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    name: 'YOLOv8 & ByteTrack Detection Engine',
    desc: 'Detects person/vehicle objects, assigns track IDs, and writes tracklet summaries for review.',
    status: 'Active',
    statusClass: 'pill-online',
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
      </svg>
    ),
  },
]

export default function Dashboard({ metrics }: DashboardProps) {
  const metricCards = [
    {
      label: 'Camera Nodes',
      value: metrics.totalCameras,
      valueColor: 'text-cyan-300',
      iconBg: 'bg-cyan-500/10 text-cyan-400',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      ),
      delay: 'animate-stagger-1',
    },
    {
      label: 'Video Feeds',
      value: metrics.totalVideos,
      valueColor: 'text-slate-100',
      iconBg: 'bg-slate-700/50 text-slate-400',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
        </svg>
      ),
      delay: 'animate-stagger-2',
    },
    {
      label: 'Standardized',
      value: metrics.processedVideos,
      valueColor: 'text-emerald-400',
      iconBg: 'bg-emerald-500/10 text-emerald-400',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      delay: 'animate-stagger-3',
    },
    {
      label: 'Queue / Processing',
      value: metrics.pendingVideos,
      valueColor: metrics.pendingVideos > 0 ? 'text-amber-400' : 'text-slate-500',
      iconBg: metrics.pendingVideos > 0 ? 'bg-amber-500/10 text-amber-400' : 'bg-slate-800 text-slate-600',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18.5" />
        </svg>
      ),
      delay: 'animate-stagger-4',
    },
  ]

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Page header */}
      <div className="space-y-1">
        <h2 className="text-title text-slate-100">System Dashboard</h2>
        <p className="text-sm text-slate-500 max-w-xl leading-relaxed">
          Overview of registered forensic devices, ingestion queue status, and pipeline execution logs.
        </p>
      </div>

      {/* METRIC GRID */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricCards.map((card) => (
          <div
            key={card.label}
            className={`surface animate-fade-up ${card.delay} p-5 flex items-center justify-between group hover:border-slate-700 transition-colors duration-200`}
          >
            <div className="space-y-1">
              <span className="text-label">{card.label}</span>
              <p className={`text-3xl font-bold font-mono tracking-tight ${card.valueColor}`}>
                {card.value}
              </p>
            </div>
            <span className={`p-3 rounded-xl ${card.iconBg} transition-colors`}>
              {card.icon}
            </span>
          </div>
        ))}
      </section>

      {/* PIPELINE STATUS */}
      <section className="surface p-6 space-y-1">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-bold text-slate-100">Forensic Preprocessing Pipeline</h3>
          <span className="pill-online">All Systems Operational</span>
        </div>

        <div className="space-y-2">
          {pipelineStages.map((stage, i) => (
            <div
              key={stage.name}
              className={`surface-2 p-4 flex items-center justify-between gap-4 animate-fade-up animate-stagger-${i + 1} group hover:border-slate-600 transition-colors duration-200`}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 p-2 rounded-lg bg-slate-800 text-slate-400 shrink-0 group-hover:text-cyan-400 transition-colors">
                  {stage.icon}
                </span>
                <div className="space-y-0.5">
                  <h4 className="text-xs font-bold text-slate-200">{stage.name}</h4>
                  <p className="text-caption max-w-md">{stage.desc}</p>
                </div>
              </div>
              <span className={`${stage.statusClass} shrink-0`}>{stage.status}</span>
            </div>
          ))}
        </div>
      </section>

      {/* FORENSIC AUDIT FOOTER */}
      <section className="surface-2 p-4 flex items-center gap-3">
        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
        <p className="font-mono text-[11px] text-slate-500">
          <span className="text-slate-400 font-semibold">[Audit Engine Active]</span>{' '}
          Verifiable SQLite engine running. Target database:{' '}
          <span className="text-cyan-400 font-bold">drishti.db</span>
        </p>
      </section>
    </div>
  )
}
