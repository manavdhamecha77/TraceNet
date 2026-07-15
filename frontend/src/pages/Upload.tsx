import { Link } from 'react-router-dom'

export default function Upload() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Upload CCTV Video</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Ingest raw recorded camera feeds to standard forensic formats.
        </p>
      </div>

      <div className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-6 rounded-md shadow-sm max-w-md mx-auto text-center space-y-4 mt-12">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-md bg-teal-500/10 text-teal-700 dark:text-teal-400 border border-teal-500/20">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </span>
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">Camera Node Association Required</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          CCTV video feeds must be mapped directly to physical coordinates and device identifiers for chain-of-custody tracking. 
          Please select a camera from the node list to ingest new footage.
        </p>
        <Link
          to="/cameras"
          className="inline-flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700 text-white px-4 py-2 rounded-md text-xs font-bold transition-colors shadow-sm"
        >
          View Camera List
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </div>
  )
}
