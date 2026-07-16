
export default function Search() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Forensic Search Engine</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Submit natural language queries to search, rank, and explain CCTV tracklets using CLIP semantic embeddings.
        </p>
      </div>

      <div className="bg-white dark:bg-slate-800/55 border border-slate-200 dark:border-slate-700 p-6 rounded-md shadow-sm max-w-xl mx-auto space-y-6 mt-8">
        <div className="text-center space-y-3">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-md bg-teal-500/10 text-teal-700 dark:text-teal-400 border border-teal-500/20">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">CLIP Vector Indexing (Next Step)</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-sm mx-auto">
            Detection and tracking are now in place. Next, CLIP will compile tracklet vectors to enable open-vocabulary queries, e.g., 
            <span className="text-amber-600 dark:text-amber-400 font-semibold font-mono"> "black pickup truck moving east"</span> or 
            <span className="text-amber-600 dark:text-amber-400 font-semibold font-mono"> "person in blue rainjacket"</span>.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              disabled
              placeholder="e.g. Red sedan near CAM_042..."
              className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3 py-2 rounded-md text-xs text-slate-400 cursor-not-allowed"
            />
            <button
              disabled
              className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-400 px-3 rounded-md text-xs font-semibold cursor-not-allowed"
            >
              Search
            </button>
          </div>

          <div className="bg-slate-50 dark:bg-slate-900/60 p-4 border border-slate-150 dark:border-slate-800 rounded-md text-[11px] font-mono space-y-1.5 text-slate-500">
            <div className="flex justify-between">
              <span>[Status] Embedding Encoder:</span>
              <span className="text-slate-400 font-semibold">Pending CLIP integration</span>
            </div>
            <div className="flex justify-between">
              <span>[Index] FAISS Index Size:</span>
              <span className="text-slate-400">0 Vector Tracklets Loaded</span>
            </div>
            <div className="flex justify-between">
              <span>[Storage] Metadata Mapper:</span>
              <span className="text-slate-400">SQLite DB Connected</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
