import { Link } from 'react-router-dom'

export default function Landing() {
  return (
    <div className="max-w-4xl mx-auto space-y-12 py-10 animate-in fade-in duration-300">
      
      {/* Hero section */}
      <section className="text-center space-y-6">
        <span className="inline-flex items-center rounded-full border border-teal-500/30 bg-teal-500/10 px-3.5 py-1 text-xs font-bold uppercase tracking-[0.2em] text-teal-700 dark:text-teal-400">
          TraceNet Foundation
        </span>
        <div className="space-y-4">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-850 dark:text-white sm:text-5xl">
            Project DRISHTI
          </h1>
          <p className="max-w-xl mx-auto text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            High-performance CCTV feed analytics and forensic search engine built for smart city surveillance pipelines.
            Standardize, audit, and extract evidence with timeline-aligned integrity.
          </p>
        </div>

        <div className="flex justify-center gap-4 pt-2">
          <Link
            to="/dashboard"
            className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-750 text-white px-5 py-2.5 rounded-md text-xs font-bold transition-all shadow-sm"
          >
            Launch Dashboard
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </Link>
          <Link
            to="/cameras"
            className="flex items-center gap-1.5 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 px-5 py-2.5 rounded-md text-xs font-bold transition-all shadow-sm"
          >
            Manage Camera Grid
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </section>

      {/* Feature grid */}
      <section className="grid gap-6 sm:grid-cols-2">
        <div className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-5 rounded-md shadow-sm space-y-2">
          <span className="p-2 bg-teal-500/10 text-teal-700 dark:text-teal-400 rounded-md inline-block">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </span>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Standardized Ingestion</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
            Ingests standard surveillance formats (.avi, .mov, .mp4) and transcodes them using H.264 codecs down to 720p 10 FPS to optimize computation.
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-5 rounded-md shadow-sm space-y-2">
          <span className="p-2 bg-teal-500/10 text-teal-700 dark:text-teal-400 rounded-md inline-block">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18.5" />
            </svg>
          </span>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Timeline Sampling</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
            Performs OpenCV-based timeline sampling at exactly 4 FPS in-memory. Eliminates disk write IO and storage exhaustion issues.
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-5 rounded-md shadow-sm space-y-2">
          <span className="p-2 bg-teal-500/10 text-teal-700 dark:text-teal-400 rounded-md inline-block">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </span>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Evidentiary Chain-of-Custody</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
            Validates uploads using SHA-256 integrity checks. Generates verifiable `manifest_hash.json` files for forensic auditing.
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-5 rounded-md shadow-sm space-y-2">
          <span className="p-2 bg-teal-500/10 text-teal-700 dark:text-teal-400 rounded-md inline-block">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
          </span>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Interactive Topography Grid</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
            Plots registered cameras on an OpenStreetMap Leaflet map layer to trace corridors, coordinates, and device states dynamically.
          </p>
        </div>
      </section>

      {/* Developer audit log quote footer */}
      <section className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 p-4 rounded-md text-center">
        <span className="text-[10px] font-mono text-slate-400 block uppercase tracking-widest font-semibold">Forensic Logging Protocol</span>
        <span className="text-[10px] text-slate-500 font-mono block mt-1">
          [System Audit initialized] Verifiable SQLite engine active. Target database: <strong>drishti.db</strong>
        </span>
      </section>
    </div>
  )
}
