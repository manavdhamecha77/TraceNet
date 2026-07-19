import React, { useState, useEffect } from 'react'

const API_BASE = 'http://localhost:8000'

interface Camera {
  camera_id: string
  name: string
}

interface SearchResult {
  score: number
  tracklet_id: string
  video_id: string
  camera_id: string
  camera_name: string
  object_type: string
  class_name: string
  frame_start: number
  frame_end: number
  timestamp_start_seconds: number
  timestamp_end_seconds: number
  best_crop_path: string
  mean_confidence: number
  best_bbox: number[]
  video_original_filename: string
  video_start_time: string
  video_standardized_filename: string
}

interface SearchLog {
  id: number
  query_text: string
  user_id: string
  timestamp: string
  results_count: number
  camera_filter: string[]
  time_filter_start: string
  time_filter_end: string
}

interface SearchProps {
  onPlayVideoAtTime: (video: any, timestamp: number) => void
}

export default function Search({ onPlayVideoAtTime }: SearchProps) {
  // Filters & State
  const [query, setQuery] = useState('')
  const [selectedCameras, setSelectedCameras] = useState<string[]>([])
  const [timeStart, setTimeStart] = useState('')
  const [timeEnd, setTimeEnd] = useState('')
  const [objectType, setObjectType] = useState<string>('all')
  const [topK, setTopK] = useState(15)

  // DB Metadata
  const [cameras, setCameras] = useState<Camera[]>([])
  const [searchLogs, setSearchLogs] = useState<SearchLog[]>([])
  const [results, setResults] = useState<SearchResult[]>([])
  const [modelInfo, setModelInfo] = useState<any>(null)
  
  // UI Status
  const [searching, setSearching] = useState(false)
  const [loadingMetadata, setLoadingMetadata] = useState(true)
  const [searchError, setSearchError] = useState('')
  const [exportHash, setExportHash] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  // Roboflow-style diverse colors
  const NAMED_CLASS_COLORS: Record<string, string> = {
    person:       '#FF3838', // red
    car:          '#FF9D97', // salmon pink
    truck:        '#FF701F', // deep orange
    bus:          '#FFB21D', // amber gold
    motorcycle:   '#CFD231', // acid lime
    bicycle:      '#48F90A', // neon green
    van:          '#92CC17', // olive green
  }
  const FALLBACK_PALETTE = [
    '#E6194B','#3CB44B','#4363D8','#F58231','#911EB4',
    '#42D4F4','#F032E6','#BFEF45','#FABED4','#469990',
  ]
  const classColor = (cn: string): string => {
    const key = cn.toLowerCase()
    if (NAMED_CLASS_COLORS[key]) return NAMED_CLASS_COLORS[key]
    let hash = 5381
    for (let i = 0; i < key.length; i++) hash = ((hash << 5) + hash) + key.charCodeAt(i)
    return FALLBACK_PALETTE[Math.abs(hash) % FALLBACK_PALETTE.length]
  }

  // Load cameras, logs, model info
  const loadMetadata = async () => {
    try {
      // 1. Fetch Cameras
      const camRes = await fetch(`${API_BASE}/api/v1/cameras`)
      if (camRes.ok) setCameras(await camRes.json())

      // 2. Fetch Search logs
      const logRes = await fetch(`${API_BASE}/api/v1/search/logs`)
      if (logRes.ok) setSearchLogs(await logRes.json())

      // 3. Fetch model details
      const modelRes = await fetch(`${API_BASE}/api/v1/detection/model`)
      if (modelRes.ok) setModelInfo(await modelRes.json())
    } catch (err) {
      console.error('Metadata retrieval failure:', err)
    } finally {
      setLoadingMetadata(false)
    }
  }

  useEffect(() => {
    loadMetadata()
  }, [])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return

    setSearching(true)
    setSearchError('')
    setResults([])
    setExportHash(null)

    const payload = {
      query: query.trim(),
      camera_ids: selectedCameras.length > 0 ? selectedCameras : null,
      time_start: timeStart ? new Date(timeStart).toISOString() : null,
      time_end: timeEnd ? new Date(timeEnd).toISOString() : null,
      object_type: objectType,
      top_k: topK
    }

    try {
      const res = await fetch(`${API_BASE}/api/v1/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.detail || 'Failed execution')
      }

      const data = await res.json()
      setResults(data)
      
      // Reload logs to show the new query
      const logRes = await fetch(`${API_BASE}/api/v1/search/logs`)
      if (logRes.ok) setSearchLogs(await logRes.json())
    } catch (err: any) {
      setSearchError(err.message || 'Vector search execution failure.')
    } finally {
      setSearching(false)
    }
  }

  // Export search results with SHA-256 verification code (evidentiary integrity)
  const handleExportResults = async () => {
    if (results.length === 0) return
    setIsExporting(true)
    
    // Create text report content
    const reportHeader = `TRACENET EVIDENCE RECORD - SEARCH LOG REPORT\n` +
      `Generated: ${new Date().toISOString()}\n` +
      `Query descriptor: "${query}"\n` +
      `Matched tracklet counts: ${results.length}\n` +
      `========================================================================\n\n`
      
    const reportBody = results.map((r, i) => (
      `Result #${i+1} [Similarity Score: ${(r.score * 100).toFixed(1)}%]\n` +
      `- Tracklet ID: ${r.tracklet_id}\n` +
      `- Camera node: ${r.camera_id} (${r.camera_name})\n` +
      `- Classification: ${r.class_name} (${r.object_type})\n` +
      `- Absolute timeline: ${new Date(r.video_start_time).toLocaleString()}\n` +
      `- Timestamp start relative: ${r.timestamp_start_seconds.toFixed(2)}s\n` +
      `- Frame start relative: ${r.frame_start}\n` +
      `- Standardized file alignment: ${r.video_standardized_filename}\n` +
      `------------------------------------------------------------------------\n`
    )).join('\n')

    const reportContent = reportHeader + reportBody

    // Calculate SHA-256 hash using native Web Crypto API
    try {
      const msgBuffer = new TextEncoder().encode(reportContent)
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
      
      setExportHash(hashHex)

      // Download as text file
      const blob = new Blob([reportContent + `\nVerification SHA-256 Hash: ${hashHex}\n`], { type: 'text/plain' })
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `evidence_log_${Date.now()}.txt`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objectUrl)
    } catch (_) {
      alert('Integrity hashing failed.')
    } finally {
      setIsExporting(false)
    }
  }

  const handleCameraToggle = (camId: string) => {
    setSelectedCameras(prev =>
      prev.includes(camId) ? prev.filter(c => c !== camId) : [...prev, camId]
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* HEADER ROW */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Forensic Search & Rank</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Submit natural language queries to search, rank, and explain CCTV tracklets using Qdrant persistent vector indices.
          </p>
        </div>
        
        {/* Model status badges */}
        <div className="flex flex-wrap gap-2.5">
          <span className="text-[10px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded text-slate-500 font-semibold">
            INDEX: <strong className="text-slate-750 dark:text-slate-200 font-mono">Qdrant Local persistence</strong>
          </span>
          <span className="text-[10px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded text-slate-500 font-semibold">
            DETECTOR: <strong className="text-teal-700 dark:text-teal-400 font-mono">{modelInfo ? modelInfo.model_path.split(/[/\\]/).pop() : 'Loading...'}</strong>
          </span>
          <span className="text-[10px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded text-slate-500 font-semibold">
            ENCODER: <strong className="text-teal-700 dark:text-teal-400 font-mono">CLIP ViT-B-32</strong>
          </span>
          <button
            onClick={async () => {
              if (!window.confirm('Re-index all completed videos into Qdrant?')) return
              try {
                const res = await fetch(`${API_BASE}/api/v1/reindex-all`, { method: 'POST' })
                if (res.ok) {
                  const data = await res.json()
                  alert(`Successfully re-indexed ${data.indexed_videos} videos (${data.total_tracklets} tracklets)!`)
                  loadMetadata()
                } else {
                  alert('Re-indexing failed.')
                }
              } catch (_) {
                alert('Network error during re-indexing.')
              }
            }}
            className="text-[10px] bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-400 border border-amber-500/30 px-2.5 py-1 rounded font-bold cursor-pointer transition-all flex items-center gap-1"
          >
            <svg className="h-3 w-3 animate-spin-hover" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.228 9H18.91" />
            </svg>
            ⚙️ RE-INDEX ALL FEEDS
          </button>
        </div>
      </div>

      {/* SEARCH INTERFACE PANEL */}
      <div className="grid lg:grid-cols-[1.8fr_1.2fr] gap-6">
        
        {/* Search query box */}
        <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-md p-5 shadow-sm space-y-4">
          <form onSubmit={handleSearch} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Natural Language Query descriptor</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  placeholder="e.g. Red SUV moving quickly, man in yellow raincoat, police patrol vehicle..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="flex-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-700 dark:focus:border-teal-400"
                />
                <button
                  type="submit"
                  disabled={searching || loadingMetadata}
                  className="bg-teal-700 hover:bg-teal-800 dark:bg-teal-650 dark:hover:bg-teal-700 text-white px-5 rounded text-xs font-bold transition-all shrink-0 shadow-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {searching ? (
                    <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  )}
                  Forensic Search
                </button>
              </div>
            </div>

            {/* Filter sections */}
            <div className="grid md:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
              
              {/* Timeline boundary */}
              <div className="space-y-2">
                <div>
                  <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Timeframe start boundary</label>
                  <input
                    type="datetime-local"
                    value={timeStart}
                    onChange={(e) => setTimeStart(e.target.value)}
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-700"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Timeframe end boundary</label>
                  <input
                    type="datetime-local"
                    value={timeEnd}
                    onChange={(e) => setTimeEnd(e.target.value)}
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-700"
                  />
                </div>
              </div>

              {/* Object category and scope limits */}
              <div className="space-y-2">
                <div>
                  <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Classification Category</label>
                  <select
                    value={objectType}
                    onChange={(e) => setObjectType(e.target.value)}
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-850 dark:text-slate-100 focus:outline-none focus:border-teal-700"
                  >
                    <option value="all">All (People & Vehicles)</option>
                    <option value="person">People Only</option>
                    <option value="vehicle">Vehicles Only</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Result limits (top K)</label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={topK}
                    onChange={(e) => setTopK(parseInt(e.target.value) || 15)}
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-800 dark:text-slate-100 focus:outline-none"
                  />
                </div>
              </div>

            </div>
          </form>
        </div>

        {/* Camera node scopes */}
        <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-md p-5 shadow-sm flex flex-col justify-between max-h-[290px] overflow-hidden">
          <div className="space-y-2 flex-1 min-h-0 flex flex-col">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">Scope Camera nodes</label>
            <p className="text-[10px] text-slate-400 shrink-0">Filter search target to specific topography nodes. If none selected, indexes are scanned citywide.</p>
            <div className="overflow-y-auto mt-2 space-y-1.5 pr-2 flex-1 min-h-0">
              {cameras.map((c) => (
                <label key={c.camera_id} className="flex items-center gap-2 cursor-pointer text-xs text-slate-650 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={selectedCameras.includes(c.camera_id)}
                    onChange={() => handleCameraToggle(c.camera_id)}
                    className="rounded text-teal-700 border-slate-350 dark:border-slate-700 focus:ring-teal-500"
                  />
                  <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-[10px] text-teal-650 dark:text-teal-400 font-bold shrink-0">{c.camera_id}</span>
                  <span className="truncate">{c.name}</span>
                </label>
              ))}
              {cameras.length === 0 && (
                <span className="text-xs text-slate-400 block py-4">No cameras configured. Register cameras first.</span>
              )}
            </div>
          </div>
        </div>

      </div>

      {searchError && (
        <div className="rounded border border-red-200 bg-red-50 text-red-800 dark:border-red-950/20 dark:bg-red-950/30 dark:text-red-400 p-3.5 text-xs text-center">
          {searchError}
        </div>
      )}

      {/* SEARCH RESULTS PANEL */}
      <div className="space-y-4">
        
        {/* Results title & actions bar */}
        {results.length > 0 && (
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Search Results</h3>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Found {results.length} matching candidate tracklets</p>
            </div>
            
            <div className="flex items-center gap-3">
              {exportHash && (
                <span className="text-[9px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                  Integrity code: {exportHash.substring(0, 16)}...
                </span>
              )}
              <button
                onClick={handleExportResults}
                disabled={isExporting}
                className="bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-250 dark:border-slate-650 text-slate-700 dark:text-slate-300 px-3.5 py-1.5 rounded text-[11px] font-bold transition-all inline-flex items-center gap-1.5 shadow-sm"
              >
                {isExporting ? 'Exporting...' : 'Export Results Set'}
              </button>
            </div>
          </div>
        )}

        {/* Detections grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {results.map((result) => {
            const cropUrl = result.best_crop_path ? `${API_BASE}${result.best_crop_path}` : ''
            const scorePercent = (result.score * 100).toFixed(1)
            const scoreColor =
              result.score >= 0.85
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20'
                : result.score >= 0.70
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20'
                : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20'

            return (
              <div
                key={result.tracklet_id}
                className="group flex flex-col rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shadow-sm hover:shadow-lg transition-all duration-200 hover:border-teal-400 dark:hover:border-teal-500 hover:-translate-y-0.5"
              >
                {/* Crop display */}
                <div className="relative w-full h-28 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 overflow-hidden shrink-0 flex items-center justify-center">
                  {cropUrl ? (
                    <img
                      src={cropUrl}
                      alt={result.tracklet_id}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <span className="text-[10px] text-slate-400">No Crop Saved</span>
                  )}
                  
                  {/* Score badge overlay */}
                  <div className="absolute top-2 right-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold ${scoreColor}`}>
                      {scorePercent}% Match
                    </span>
                  </div>

                  {/* Class badge */}
                  <div className="absolute bottom-2 left-2 flex gap-1">
                    <span
                      className="inline-flex rounded px-1.5 py-0.5 text-[9px] font-mono text-white text-shadow-sm capitalize font-bold"
                      style={{ backgroundColor: classColor(result.class_name) }}
                    >
                      {result.class_name}
                    </span>
                  </div>
                </div>

                {/* Details */}
                <div className="p-3 space-y-2 flex-1 flex flex-col justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono bg-slate-50 dark:bg-slate-800 px-1 py-0.5 rounded text-teal-700 dark:text-teal-400 font-bold shrink-0">
                        {result.camera_id}
                      </span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium truncate max-w-[120px]" title={result.camera_name}>
                        {result.camera_name}
                      </span>
                    </div>

                    <div className="text-[10px] text-slate-600 dark:text-slate-350 space-y-0.5">
                      <div>Timeline: <strong className="text-slate-800 dark:text-slate-100">{new Date(result.video_start_time).toLocaleString()}</strong></div>
                      <div>Relative Start: <strong className="text-slate-800 dark:text-slate-100">{result.timestamp_start_seconds.toFixed(2)}s</strong> (Frame {result.frame_start})</div>
                      <div>Mean Conf: <strong className="text-slate-850 dark:text-slate-200">{(result.mean_confidence * 100).toFixed(0)}%</strong></div>
                    </div>
                  </div>

                  {/* Dynamic player action trigger */}
                  <button
                    onClick={() => {
                      const mockVideoObj = {
                        id: result.video_id,
                        camera_id: result.camera_id,
                        standardized_filename: result.video_standardized_filename,
                        thumbnail_path: `cameras/${result.camera_id}/inference/thumbnail.jpg`, // standard location helper
                        processing_status: 'complete'
                      }
                      onPlayVideoAtTime(mockVideoObj, result.timestamp_start_seconds)
                    }}
                    className="w-full flex items-center justify-center gap-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 py-1.5 rounded text-[10px] font-bold transition-all mt-2 border border-slate-250 dark:border-slate-750"
                  >
                    <svg className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    </svg>
                    Seek & Stream annotated
                  </button>

                </div>
              </div>
            )
          })}

          {results.length === 0 && !searching && query.trim() && (
            <div className="col-span-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-400 dark:text-slate-500">
              No matching tracklets found in indices. Try refining the query descriptor or shifting search parameters.
            </div>
          )}
        </div>

      </div>

      {/* AUDIT LOG TRAIL SECTION */}
      <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-md p-5 shadow-sm space-y-4">
        <div>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Evidentiary Search Audit Logs</h3>
          <p className="text-[10px] text-slate-400 mt-0.5">Logs of recent transactions forSmart City surveillance compliance audits.</p>
        </div>
        
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-[11px] text-slate-500">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 pb-2 text-[10px] text-slate-400 font-bold uppercase">
                <th className="py-2">Timestamp</th>
                <th className="py-2">Query string</th>
                <th className="py-2">Camera filters</th>
                <th className="py-2">Result count</th>
                <th className="py-2">User ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {searchLogs.slice(0, 10).map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/10">
                  <td className="py-2.5 whitespace-nowrap text-slate-400">{new Date(log.timestamp).toLocaleString()}</td>
                  <td className="py-2.5 font-bold text-slate-750 dark:text-slate-250 italic">"{log.query_text}"</td>
                  <td className="py-2.5 font-mono text-[10px]">
                    {log.camera_filter && log.camera_filter.length > 0 ? log.camera_filter.join(', ') : 'Citywide'}
                  </td>
                  <td className="py-2.5 font-bold text-teal-600 dark:text-teal-400">{log.results_count ?? 0} matches</td>
                  <td className="py-2.5 font-mono text-slate-400">{log.user_id}</td>
                </tr>
              ))}
              {searchLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-400">No search logs indexed. Audit trail is empty.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
