import { Link } from 'react-router-dom'

const features = [
  {
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
    title: 'Standardized Ingestion',
    desc: 'Ingests .avi, .mov, .mp4 surveillance formats and transcodes to H.264 at 720p 10 FPS for optimized processing.',
    accent: 'text-teal-700 dark:text-cyan-400',
    bg: 'bg-teal-500/10 dark:bg-cyan-500/10',
  },
  {
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18.5" />
      </svg>
    ),
    title: 'Timeline Sampling',
    desc: 'OpenCV-based timeline sampling at exactly 4 FPS in-memory. Zero disk I/O overhead during extraction.',
    accent: 'text-violet-700 dark:text-violet-400',
    bg: 'bg-violet-500/10',
  },
  {
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
    title: 'Evidentiary Chain-of-Custody',
    desc: 'Validates uploads with SHA-256 integrity checks. Generates verifiable manifest hashes for forensic audit trails.',
    accent: 'text-emerald-700 dark:text-emerald-400',
    bg: 'bg-emerald-500/10',
  },
  {
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
      </svg>
    ),
    title: 'Interactive Topography Grid',
    desc: 'Plots all registered camera nodes on a live OpenStreetMap layer. Visualize corridors, coordinates, and status in real time.',
    accent: 'text-amber-700 dark:text-amber-400',
    bg: 'bg-amber-500/10',
  },
  {
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
    title: 'Natural Language Search',
    desc: 'CLIP-powered semantic search across all tracklets. Find targets by description: "man in red jacket near Gate 3 after 5 PM".',
    accent: 'text-sky-700 dark:text-sky-400',
    bg: 'bg-sky-500/10',
  },
  {
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    title: 'AI Forensic Copilot',
    desc: 'Agentic LLM assistant with tool-calling access to your camera grid, alerts, and tracklet database. Ctrl+K to open.',
    accent: 'text-teal-700 dark:text-teal-400',
    bg: 'bg-teal-500/10',
  },
]

export default function Landing() {
  return (
    <div className="max-w-5xl mx-auto space-y-16 py-12 animate-fade-in">

      {/* ── Hero ────────────────────────────────────────────────── */}
      <section className="text-center space-y-8">

        {/* Brand badge */}
        <div className="inline-flex items-center gap-2 rounded-full border border-teal-500/30 dark:border-cyan-500/25 bg-teal-500/10 dark:bg-cyan-500/8 px-4 py-1.5 shadow-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-teal-600 dark:bg-cyan-400 animate-pulse" />
          <span className="font-mono text-[11px] font-bold tracking-widest text-teal-800 dark:text-cyan-400 uppercase">
            TraceNet · Smart City Intelligence
          </span>
        </div>

        <div className="space-y-5">
          <h1 className="text-display text-slate-900 dark:text-slate-100">
            Project{' '}
            <span className="text-teal-700 dark:text-cyan-400">DRISHTI</span>
          </h1>
          <p className="max-w-2xl mx-auto text-sm leading-relaxed text-slate-600 dark:text-slate-400" style={{ maxWidth: '60ch' }}>
            High-performance CCTV feed analytics and forensic search engine built for smart city surveillance pipelines. 
            Standardize, audit, and extract evidence with timeline-aligned chain-of-custody integrity.
          </p>
        </div>

        {/* CTA row */}
        <div className="flex justify-center gap-4 pt-2 flex-wrap">
          <Link to="/dashboard" className="btn-primary bg-teal-600 hover:bg-teal-500 text-white font-bold px-5 py-2.5 rounded-xl shadow-xs transition-colors">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Launch Dashboard
          </Link>
          <Link to="/cameras" className="btn-ghost bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-teal-500/50 px-4 py-2.5 rounded-xl shadow-xs transition-colors">
            Manage Camera Grid
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
          <Link to="/search" className="btn-ghost bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-teal-500/50 px-4 py-2.5 rounded-xl shadow-xs transition-colors">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            Search Footage
          </Link>
        </div>
      </section>

      {/* ── Feature grid ────────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f, i) => (
          <div
            key={f.title}
            className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-xl animate-fade-up animate-stagger-${Math.min(i + 1, 4)} p-5 space-y-3 group hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-200 shadow-xs`}
          >
            <span className={`inline-flex p-2.5 rounded-xl ${f.bg} ${f.accent}`}>
              {f.icon}
            </span>
            <div className="space-y-1.5">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{f.title}</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{f.desc}</p>
            </div>
          </div>
        ))}
      </section>

      {/* ── Forensic audit footer ────────────────────────────────── */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-xl p-4 flex items-center gap-3 shadow-xs">
        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
        <p className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
          <span className="text-slate-700 dark:text-slate-300 font-semibold">[System Audit initialized]</span>{' '}
          Verifiable SQLite engine active. Target database:{' '}
          <span className="text-teal-700 dark:text-cyan-400 font-bold">drishti.db</span>
        </p>
      </section>
    </div>
  )
}
