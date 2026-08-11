import React, { useState, useEffect, useRef } from 'react'
import {
  Search as SearchIcon,
  Filter,
  Download,
  Clock,
  Layers,
  RefreshCw,
  Play,
  FileText,
  ShieldCheck,
  Cpu,
  Sparkles,
  Image as ImageIcon,
  Type,
  Upload,
} from 'lucide-react'

const API_BASE = 'http://localhost:8000'

interface Camera {
  camera_id: string
  name: string
  model_id?: string | null
}

interface MLModel {
  id: string
  name: string
  model_type: string
}

interface ExplanationEvidence {
  label: string
  detail: string
  value_percent: number | null
}

interface SearchExplanation {
  retrieval_method: string
  evidence: ExplanationEvidence[]
  matched_query_terms: string[]
  unknown_or_unverified_terms: string[]
  applied_filters: string[]
  limitation: string
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
  video_thumbnail_path?: string | null
  tracker_id?: number
  caption?: string
  attributes?: Record<string, unknown>
  explanation?: SearchExplanation
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
  onPlayVideoAtTime: (
    video: any,
    timestamp: number,
    trackerId?: number | string,
    bestBbox?: number[],
    className?: string
  ) => void  // eslint-disable-line @typescript-eslint/no-explicit-any
}

import { useToast } from '../components/Toast'
import { formatDisplayDate } from '../utils/dateFormatter'

export default function Search({ onPlayVideoAtTime }: SearchProps) {
  const toast = useToast()
  // Filters & State
  const [query, setQuery]                     = useState('')
  const [selectedCameras, setSelectedCameras] = useState<string[]>([])
  const [selectedModels, setSelectedModels]   = useState<string[]>([])
  const [timeStart, setTimeStart]             = useState('')
  const [timeEnd, setTimeEnd]                 = useState('')
  const [objectType, setObjectType]           = useState<string>('all')
  const [topK, setTopK]                       = useState(15)

  // DB Metadata
  const [cameras, setCameras]                 = useState<Camera[]>([])
  const [models, setModels]                   = useState<MLModel[]>([])
  const [searchLogs, setSearchLogs]           = useState<SearchLog[]>([])
  const [results, setResults]                 = useState<SearchResult[]>([])
  const [modelInfo, setModelInfo]             = useState<any>(null)  // eslint-disable-line @typescript-eslint/no-explicit-any
  
  // UI Status
  const [searching, setSearching]             = useState(false)
  const [loadingMetadata, setLoadingMetadata] = useState(true)
  const [searchError, setSearchError]         = useState('')
  const [exportHash, setExportHash]           = useState<string | null>(null)
  const [isExporting, setIsExporting]         = useState(false)

  const NAMED_CLASS_COLORS: Record<string, string> = {
    person:      '#FF3838',
    car:         '#FF9D97',
    truck:       '#FF701F',
    bus:         '#FFB21D',
    motorcycle:  '#CFD231',
    bicycle:     '#48F90A',
    van:         '#92CC17',
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

  const loadMetadata = async () => {
    try {
      const camRes = await fetch(`${API_BASE}/api/v1/cameras`)
      if (camRes.ok) setCameras(await camRes.json())

      const modelsRes = await fetch(`${API_BASE}/api/v1/models`)
      if (modelsRes.ok) setModels(await modelsRes.json())

      const logRes = await fetch(`${API_BASE}/api/v1/search/logs`)
      if (logRes.ok) setSearchLogs(await logRes.json())

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

  const isCameraDisabled = (cam: Camera): boolean => {
    if (selectedModels.length === 0) return false
    return !cam.model_id || !selectedModels.includes(cam.model_id)
  }

  useEffect(() => {
    setSelectedCameras(prev => prev.filter(camId => {
      const cam = cameras.find(c => c.camera_id === camId)
      return cam ? !isCameraDisabled(cam) : true
    }))
  }, [selectedModels, cameras])

  // Reverse Photo Search state
  type SearchMode = 'text' | 'photo'
  const [searchMode, setSearchMode]             = useState<SearchMode>('text')
  const [referenceFile, setReferenceFile]       = useState<File | null>(null)
  const [referencePreview, setReferencePreview] = useState<string | null>(null)
  const [isDragging, setIsDragging]             = useState(false)
  const [lastSearchWasImage, setLastSearchWasImage] = useState(false)
  const fileInputRef                             = useRef<HTMLInputElement>(null)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) {
      toast.warning('Empty Search Query', 'Please enter a natural-language description (e.g. "person in red jacket") or upload a photo.')
      return
    }

    setSearching(true)
    setSearchError('')
    setResults([])
    setExportHash(null)
    setLastSearchWasImage(false)

    const activeCameraIds = selectedCameras.length > 0 
      ? selectedCameras 
      : cameras.filter(c => !isCameraDisabled(c)).map(c => c.camera_id)

    const payload = {
      query: query.trim(),
      camera_ids: activeCameraIds.length > 0 ? activeCameraIds : null,
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
      
      const logRes = await fetch(`${API_BASE}/api/v1/search/logs`)
      if (logRes.ok) setSearchLogs(await logRes.json())
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : 'Vector search execution failure.')
    } finally {
      setSearching(false)
    }
  }

  const handlePhotoSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!referenceFile) {
      toast.warning('No Photo Selected', 'Please upload or drag & drop a reference suspect photo before running reverse image search.')
      return
    }

    setSearching(true)
    setSearchError('')
    setResults([])
    setExportHash(null)

    const activeCameraIds = selectedCameras.length > 0 
      ? selectedCameras 
      : cameras.filter(c => !isCameraDisabled(c)).map(c => c.camera_id)

    const formData = new FormData()
    formData.append('file', referenceFile)
    if (activeCameraIds.length > 0) {
      formData.append('camera_ids', activeCameraIds.join(','))
    }
    if (timeStart) formData.append('time_start', new Date(timeStart).toISOString())
    if (timeEnd) formData.append('time_end', new Date(timeEnd).toISOString())
    formData.append('object_type', objectType)
    formData.append('top_k', String(topK))

    try {
      const res = await fetch(`${API_BASE}/api/v1/search/image`, {
        method: 'POST',
        body: formData
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.detail || 'Reverse image search execution failure')
      }

      const data = await res.json()
      setResults(data)
      setLastSearchWasImage(true)
      
      const logRes = await fetch(`${API_BASE}/api/v1/search/logs`)
      if (logRes.ok) setSearchLogs(await logRes.json())
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : 'Reverse image vector search execution failure.')
    } finally {
      setSearching(false)
    }
  }

  const handleExportResults = async () => {
    if (results.length === 0) return
    setIsExporting(true)
    
    const reportHeader = `TRACENET EVIDENCE RECORD - SEARCH LOG REPORT\n` +
      `Generated: ${new Date().toISOString()}\n` +
      `Query descriptor: "${query}"\n` +
      `Matched tracklet counts: ${results.length}\n` +
      `========================================================================\n\n`
      
    const reportBody = results.map((r, i) => {
      const dwell = Math.max(0.1, (r.timestamp_end_seconds || 0) - (r.timestamp_start_seconds || 0)).toFixed(1)
      return (
        `Result #${i+1} [Similarity Score: ${(r.score * 100).toFixed(1)}%]\n` +
        `- Tracklet ID: ${r.tracklet_id}\n` +
        `- Camera node: ${r.camera_id} (${r.camera_name})\n` +
        `- Classification: ${r.class_name} (${r.object_type})\n` +
        `- Absolute timeline: ${new Date(r.video_start_time).toLocaleString()}\n` +
        `- Relative start: ${r.timestamp_start_seconds.toFixed(2)}s (Dwell: ${dwell}s)\n` +
        `- Frame start relative: ${r.frame_start}\n` +
        `- Standardized file alignment: ${r.video_standardized_filename}\n` +
        `------------------------------------------------------------------------\n`
      )
    }).join('\n')

    const reportContent = reportHeader + reportBody

    try {
      const msgBuffer = new TextEncoder().encode(reportContent)
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
      
      setExportHash(hashHex)

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
      toast.error('Export Error', 'Integrity hashing failed.')
    } finally {
      setIsExporting(false)
    }
  }

  const handleCameraToggle = (camId: string) => {
    setSelectedCameras(prev =>
      prev.includes(camId) ? prev.filter(c => c !== camId) : [...prev, camId]
    )
  }

  const handleModelToggle = (modelId: string) => {
    setSelectedModels(prev =>
      prev.includes(modelId) ? prev.filter(m => m !== modelId) : [...prev, modelId]
    )
  }

  const visibleResults = results.filter(r => {
    const cam = cameras.find(c => c.camera_id === r.camera_id)
    if (!cam) return true
    return !isCameraDisabled(cam)
  })

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* HEADER ROW */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Forensic Search &amp; Rank</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Submit natural language queries to search, rank, and explain CCTV tracklets using persistent Qdrant vector indices.
          </p>
        </div>
        
        {/* Model status badges */}
        <div className="flex flex-wrap gap-2.5">
          <span className="text-[10px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded text-slate-500 font-semibold flex items-center gap-1">
            <Cpu className="h-3 w-3 text-slate-400" />
            INDEX: <strong className="text-slate-750 dark:text-slate-200 font-mono">Qdrant Local</strong>
          </span>
          <span className="text-[10px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded text-slate-500 font-semibold flex items-center gap-1">
            <Layers className="h-3 w-3 text-slate-400" />
            DETECTOR: <strong className="text-teal-700 dark:text-teal-400 font-mono">{modelInfo ? modelInfo.model_path.split(/[/\\]/).pop() : 'Loading...'}</strong>
          </span>
          <span className="text-[10px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded text-slate-500 font-semibold flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-slate-400" />
            ENCODER: <strong className="text-teal-700 dark:text-teal-400 font-mono">CLIP ViT-B-32</strong>
          </span>
          <button
            onClick={async () => {
              try {
                toast.info('Re-indexing Started', 'Re-indexing all completed videos into Qdrant index...')
                const res = await fetch(`${API_BASE}/api/v1/reindex-all`, { method: 'POST' })
                if (res.ok) {
                  const data = await res.json()
                  toast.success('Re-index Complete', `Successfully indexed ${data.indexed_videos} videos (${data.total_tracklets} tracklets).`)
                  loadMetadata()
                } else {
                  toast.error('Re-index Failed', 'Backend returned an error during vector re-indexing.')
                }
              } catch (_) {
                toast.error('Network Error', 'Failed to reach backend during re-indexing.')
              }
            }}
            className="text-[10px] bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-400 border border-amber-500/30 px-2.5 py-1 rounded font-bold cursor-pointer transition-all flex items-center gap-1.5"
          >
            <RefreshCw className="h-3 w-3" />
            Re-index All Feeds
          </button>
        </div>
      </div>

      {/* SEARCH INTERFACE PANEL */}
      <div className="grid lg:grid-cols-[1.8fr_1.2fr] gap-6">
        
        {/* Search query box */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
          
          {/* Mode Toggle */}
          <div className="flex bg-slate-100 dark:bg-slate-800 rounded p-1 w-fit border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setSearchMode('text')}
              className={`px-3 py-1 text-[11px] font-bold rounded transition-all flex items-center gap-1.5 ${
                searchMode === 'text'
                  ? 'bg-white dark:bg-slate-700 text-teal-700 dark:text-teal-300 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <Type className="h-3.5 w-3.5" /> Text Description Query
            </button>
            <button
              type="button"
              onClick={() => setSearchMode('photo')}
              className={`px-3 py-1 text-[11px] font-bold rounded transition-all flex items-center gap-1.5 ${
                searchMode === 'photo'
                  ? 'bg-white dark:bg-slate-700 text-teal-700 dark:text-teal-300 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <ImageIcon className="h-3.5 w-3.5" /> Photo Re-ID Search
            </button>
          </div>

          <form onSubmit={searchMode === 'text' ? handleSearch : handlePhotoSearch} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                {searchMode === 'text' ? 'Natural Language Query descriptor' : 'Reference Target Photo (Person or Vehicle)'}
              </label>

              {searchMode === 'text' ? (
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <SearchIcon className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      required
                      placeholder="e.g. Red SUV moving quickly, man in yellow raincoat, police patrol vehicle..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      className="w-full pl-9 pr-3.5 py-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-700 dark:focus:border-teal-400"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={searching || loadingMetadata}
                    className="bg-teal-700 hover:bg-teal-800 dark:bg-teal-650 dark:hover:bg-teal-700 text-white px-5 rounded text-xs font-bold transition-all shrink-0 shadow-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {searching ? (
                      <RefreshCw className="animate-spin h-3.5 w-3.5" />
                    ) : (
                      <SearchIcon className="h-3.5 w-3.5" />
                    )}
                    Forensic Search
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <input 
                    ref={fileInputRef}
                    type="file" 
                    accept="image/jpeg,image/png,image/webp,image/bmp" 
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) {
                        setReferenceFile(f)
                        setReferencePreview(URL.createObjectURL(f))
                      }
                    }} 
                  />

                  <div
                    onClick={() => {
                      if (!referencePreview) fileInputRef.current?.click()
                    }}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault(); setIsDragging(false)
                      const f = e.dataTransfer.files[0]
                      if (f && f.type.startsWith('image/')) {
                        setReferenceFile(f)
                        setReferencePreview(URL.createObjectURL(f))
                      }
                    }}
                    className={`border-2 border-dashed rounded-lg p-6 text-center transition-all ${
                      referencePreview 
                        ? 'border-teal-600 bg-teal-50/10 dark:bg-teal-950/10' 
                        : 'cursor-pointer border-slate-300 hover:border-teal-600 dark:border-slate-700 dark:hover:border-teal-500 bg-slate-50/50 hover:bg-teal-50/30 dark:bg-slate-900/50'
                    } ${isDragging ? 'border-teal-500 bg-teal-50/30 dark:bg-teal-950/30 ring-2 ring-teal-400' : ''}`}
                  >
                    {referencePreview ? (
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <img 
                            src={referencePreview} 
                            alt="Reference target" 
                            className="h-16 w-16 object-cover rounded border border-slate-300 dark:border-slate-700 shadow-sm shrink-0"
                          />
                          <div className="text-left">
                            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[220px]">{referenceFile?.name}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">{((referenceFile?.size || 0) / 1024).toFixed(1)} KB</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
                            className="text-[11px] font-bold text-teal-700 hover:text-teal-800 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 px-3 py-1.5 rounded border border-teal-200 dark:border-teal-900/40 flex items-center gap-1"
                          >
                            <Upload className="h-3 w-3" /> Change Photo
                          </button>
                          <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setReferenceFile(null); setReferencePreview(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                            className="text-[11px] font-bold text-red-600 hover:text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-3 py-1.5 rounded border border-red-200 dark:border-red-900/40"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="py-2 space-y-3">
                        <div className="h-12 w-12 rounded-full bg-teal-100 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 flex items-center justify-center mx-auto shadow-sm">
                          <Upload className="h-6 w-6" />
                        </div>
                        <div>
                          <p className="text-xs text-slate-700 dark:text-slate-200 font-bold mb-1">
                            Click here to upload a reference target photo
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            or drag and drop an image file directly into this box
                          </p>
                          <p className="text-[10px] text-slate-400 mt-2">Supports JPEG, PNG, WebP, BMP (Max 10 MB)</p>
                        </div>
                        <div>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
                            className="bg-teal-700 hover:bg-teal-800 dark:bg-teal-650 dark:hover:bg-teal-700 text-white px-4 py-1.5 rounded text-xs font-bold transition-all shadow-sm inline-flex items-center gap-1.5"
                          >
                            <Upload className="h-3.5 w-3.5" />
                            Browse Computer Files
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={searching || !referenceFile || loadingMetadata}
                      className="bg-teal-700 hover:bg-teal-800 dark:bg-teal-650 dark:hover:bg-teal-700 text-white px-6 py-2 rounded text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {searching ? (
                        <RefreshCw className="animate-spin h-3.5 w-3.5" />
                      ) : (
                        <ImageIcon className="h-3.5 w-3.5" />
                      )}
                      Perform Re-ID Image Search
                    </button>
                  </div>
                </div>
              )}
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
                    <option value="all">All (People &amp; Vehicles)</option>
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

        {/* Sidebar Filters: Models & Cameras */}
        <div className="space-y-4 flex flex-col">
          
          {/* Model Registry Filter */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm flex flex-col justify-between max-h-[170px] overflow-hidden">
            <div className="space-y-2 flex-1 min-h-0 flex flex-col">
              <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider shrink-0 flex items-center gap-1">
                <Filter className="h-3 w-3" /> Model Filter (drift guard)
              </label>
              <p className="text-[9px] text-slate-500 dark:text-slate-400 shrink-0">Select model source. De-selecting a model hides its predictions and locks corresponding cameras.</p>
              <div className="overflow-y-auto mt-2 space-y-1.5 pr-2 flex-1 min-h-0">
                {models.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100">
                    <input
                      type="checkbox"
                      checked={selectedModels.includes(m.id)}
                      onChange={() => handleModelToggle(m.id)}
                      className="rounded text-amber-600 border-slate-300 dark:border-slate-700 focus:ring-amber-500"
                    />
                    <span className="font-mono bg-amber-500/10 px-1.5 py-0.5 rounded text-[10px] text-amber-700 dark:text-amber-400 font-bold shrink-0">{m.model_type}</span>
                    <span className="truncate">{m.name}</span>
                  </label>
                ))}
                {models.length === 0 && (
                  <span className="text-xs text-slate-400 block py-1">No uploaded models found.</span>
                )}
              </div>
            </div>
          </div>

          {/* Camera node scopes */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm flex flex-col justify-between max-h-[220px] overflow-hidden">
            <div className="space-y-2 flex-1 min-h-0 flex flex-col">
              <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider shrink-0">Scope Camera nodes</label>
              <p className="text-[9px] text-slate-500 dark:text-slate-400 shrink-0">Filter targets. Cameras connected to deselected models are disabled.</p>
              <div className="overflow-y-auto mt-2 space-y-1.5 pr-2 flex-1 min-h-0">
                {cameras.map((c) => {
                  const disabled = isCameraDisabled(c)
                  return (
                    <label 
                      key={c.camera_id} 
                      className={`flex items-center gap-2 text-xs transition-opacity ${
                        disabled ? 'opacity-35 cursor-not-allowed text-slate-400' : 'cursor-pointer text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={selectedCameras.includes(c.camera_id)}
                        onChange={() => handleCameraToggle(c.camera_id)}
                        className="rounded text-teal-700 border-slate-300 dark:border-slate-700 focus:ring-teal-500 disabled:bg-slate-200"
                      />
                      <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[10px] text-teal-700 dark:text-teal-400 font-bold shrink-0">{c.camera_id}</span>
                      <span className="truncate">{c.name}</span>
                    </label>
                  )
                })}
                {cameras.length === 0 && (
                  <span className="text-xs text-slate-400 block py-4">No cameras configured.</span>
                )}
              </div>
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
        {visibleResults.length > 0 && (
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Search Results</h3>
                {lastSearchWasImage && (
                  <span className="text-[9px] bg-violet-100 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 border border-violet-250 dark:border-violet-800 px-2 py-0.5 rounded font-bold flex items-center gap-1">
                    <ImageIcon className="h-3 w-3" /> PHOTO RE-ID SEARCH
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Found {visibleResults.length} matching candidate tracklets</p>
            </div>
            
            <div className="flex items-center gap-3">
              {exportHash && (
                <span className="text-[9px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3" />
                  Integrity code: {exportHash.substring(0, 16)}...
                </span>
              )}
              <button
                onClick={handleExportResults}
                disabled={isExporting}
                className="bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-250 dark:border-slate-650 text-slate-700 dark:text-slate-300 px-3.5 py-1.5 rounded text-[11px] font-bold transition-all inline-flex items-center gap-1.5 shadow-sm"
              >
                <Download className="h-3.5 w-3.5" />
                {isExporting ? 'Exporting...' : 'Export Results Set'}
              </button>
            </div>
          </div>
        )}

        {/* SCORE INTERPRETATION GUIDANCE BAR */}
        {visibleResults.length > 0 && (
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-300 font-semibold">
              <span>Match Score Guidance:</span>
            </div>
            <div className="flex items-center gap-4 text-[11px] font-mono">
              <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                &gt;80% High Match (Reliable Target)
              </span>
              <span className="flex items-center gap-1.5 text-amber-400 font-bold">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                50–80% Moderate Match
              </span>
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                &lt;50% Tenuous Candidate
              </span>
            </div>
          </div>
        )}

        {/* Detections grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {visibleResults.map((result) => {
            const cropUrl = result.best_crop_path ? `${API_BASE}${result.best_crop_path}` : ''
            const scorePercent = (result.score * 100).toFixed(1)
            const scoreColor =
              result.score >= 0.85
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20'
                : result.score >= 0.70
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20'
                : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20'

            const dwellSec = Math.max(0.1, (result.timestamp_end_seconds || 0) - (result.timestamp_start_seconds || 0)).toFixed(1)

            return (
              <div
                key={result.tracklet_id}
                className="group flex flex-col rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shadow-sm hover:shadow-lg transition-all duration-200 hover:border-teal-400 dark:hover:border-teal-500 hover:-translate-y-0.5"
              >
                {/* Crop display */}
                <div className="relative w-full h-28 bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 overflow-hidden shrink-0 flex items-center justify-center">
                  {cropUrl ? (
                    <img
                      src={cropUrl}
                      alt={result.tracklet_id}
                      className="w-full h-full object-contain bg-slate-200/50 dark:bg-slate-800/50 transition-transform duration-300 group-hover:scale-102"
                    />
                  ) : (
                    <FileText className="h-8 w-8 text-slate-400 opacity-40" />
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
                      {result.class_name} #{result.tracker_id || ''}
                    </span>
                  </div>
                </div>

                {/* Details */}
                <div className="p-3 space-y-2 flex-1 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono bg-slate-50 dark:bg-slate-800 px-1 py-0.5 rounded text-teal-700 dark:text-teal-400 font-bold shrink-0">
                        {result.camera_id}
                      </span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium truncate max-w-[120px]" title={result.camera_name}>
                        {result.camera_name}
                      </span>
                    </div>

                    <div className="text-[10px] text-slate-650 dark:text-slate-350 space-y-0.5 font-sans">
                      <div>Timeline: <strong className="text-slate-800 dark:text-slate-100">{formatDisplayDate(result.video_start_time)}</strong></div>
                      <div className="flex justify-between items-center">
                        <span>Start: <strong className="text-slate-800 dark:text-slate-100">{result.timestamp_start_seconds.toFixed(2)}s</strong></span>
                        <span className="font-bold text-teal-700 dark:text-teal-400 flex items-center gap-0.5">
                          <Clock className="h-3 w-3" /> Dwell: {dwellSec}s
                        </span>
                      </div>
                      <div>Mean Conf: <strong className="text-slate-850 dark:text-slate-200">{(result.mean_confidence * 100).toFixed(0)}%</strong></div>
                    </div>

                    {result.caption && (
                      <div className="text-[9.5px] italic text-teal-700 dark:text-teal-300 bg-teal-500/10 border border-teal-500/20 px-1.5 py-0.5 rounded leading-tight line-clamp-2" title={`BLIP Auto-Caption: ${result.caption}`}>
                        "{result.caption}"
                      </div>
                    )}

                    <details className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 text-[9.5px]">
                      <summary className="cursor-pointer select-none px-2 py-1.5 font-bold text-teal-700 dark:text-teal-400 flex items-center gap-1">
                        <Sparkles className="h-3 w-3" /> Why this matched
                      </summary>
                      <div className="border-t border-slate-200 dark:border-slate-700 px-2 py-2 space-y-1.5 text-slate-600 dark:text-slate-300">
                        {(result.explanation?.evidence || []).map((evidence) => (
                          <div key={evidence.label} className="flex gap-1.5">
                            <span className="font-semibold shrink-0">{evidence.label}:</span>
                            <span>
                              {evidence.detail}
                              {evidence.value_percent !== null && ` (${evidence.value_percent}%)`}
                            </span>
                          </div>
                        ))}
                        {(result.explanation?.matched_query_terms?.length ?? 0) > 0 && (
                          <div><span className="font-semibold">Caption/class overlap:</span> {result.explanation?.matched_query_terms.join(', ')}</div>
                        )}
                        {(result.explanation?.unknown_or_unverified_terms?.length ?? 0) > 0 && (
                          <div className="text-amber-700 dark:text-amber-400"><span className="font-semibold">Unverified:</span> {result.explanation?.unknown_or_unverified_terms.join(', ')} — not confirmed by the caption.</div>
                        )}
                        {(result.explanation?.applied_filters?.length ?? 0) > 0 && (
                          <div><span className="font-semibold">Filters:</span> {result.explanation?.applied_filters.join(' · ')}</div>
                        )}
                        <p className="text-slate-450 dark:text-slate-500 leading-tight">{result.explanation?.limitation || 'Similarity ranking supports human review; it is not an identity determination.'}</p>
                      </div>
                    </details>
                  </div>

                  {/* Dynamic player & Hot-Target action triggers */}
                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                    <button
                      onClick={() => {
                        const mockVideoObj = {
                          id: result.video_id,
                          camera_id: result.camera_id,
                          standardized_filename: result.video_standardized_filename,
                          thumbnail_path: result.video_thumbnail_path || '',
                          processing_status: 'complete'
                        }
                        onPlayVideoAtTime(
                          mockVideoObj,
                          result.timestamp_start_seconds,
                          result.tracker_id || result.tracklet_id,
                          result.best_bbox,
                          result.class_name
                        )
                      }}
                      className="flex items-center justify-center gap-1 bg-teal-50 dark:bg-teal-900/30 hover:bg-teal-100 dark:hover:bg-teal-900/50 text-teal-700 dark:text-teal-400 py-1.5 rounded text-[10px] font-bold transition-all border border-teal-200 dark:border-teal-800"
                    >
                      <Play className="h-3 w-3 fill-current" />
                      <span>Seek &amp; Stream</span>
                    </button>

                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch(`${API_BASE}/api/v1/multicam/targets/tag`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              label: `${result.class_name || 'Suspect'} #${result.tracker_id || 'Target'} (${result.camera_id})`,
                              origin_camera_id: result.camera_id,
                              origin_tracklet_id: result.tracklet_id,
                              priority: 'HIGH'
                            })
                          });
                          if (res.ok) {
                            const data = await res.json();
                            if (data.status === 'already_tagged') {
                              toast.info('Already Tagged', data.message || 'Target is already registered.');
                            } else {
                              toast.success('Hot Target Tagged', data.message || 'Target pinned for multi-camera pursuit.');
                            }
                          }
                        } catch (err) {
                          console.error('Failed to tag hot target:', err);
                        }
                      }}
                      className="flex items-center justify-center gap-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 py-1.5 rounded text-[10px] font-bold transition-all"
                      title="Tag as Hot Target for Multi-Camera Persistent Pursuit"
                    >
                      <span>🎯 Tag Target</span>
                    </button>
                  </div>

                </div>
              </div>
            )
          })}

          {visibleResults.length === 0 && !searching && query.trim() && (
            <div className="col-span-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-400 dark:text-slate-500">
              No matching tracklets found in indices. Try refining the query descriptor or shifting search parameters.
            </div>
          )}
        </div>

      </div>

      {/* AUDIT LOG TRAIL SECTION */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
        <div>
          <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Evidentiary Search Audit Logs</h3>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Logs of recent transactions for Smart City surveillance compliance audits.</p>
        </div>
        
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-[11px] text-slate-600 dark:text-slate-300">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 pb-2 text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase">
                <th className="py-2.5">Timestamp</th>
                <th className="py-2.5">Query string</th>
                <th className="py-2.5">Camera filters</th>
                <th className="py-2.5">Result count</th>
                <th className="py-2.5">User ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {searchLogs.slice(0, 10).map((log) => (
                <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="py-2.5 whitespace-nowrap text-slate-500 dark:text-slate-400">{formatDisplayDate(log.timestamp, true)}</td>
                  <td className="py-2.5 font-bold text-slate-800 dark:text-slate-100 italic">&ldquo;{log.query_text}&rdquo;</td>
                  <td className="py-2.5 font-mono text-[10px]">
                    {log.camera_filter && log.camera_filter.length > 0 ? log.camera_filter.join(', ') : 'Citywide'}
                  </td>
                  <td className="py-2.5 font-bold text-teal-700 dark:text-teal-400">{log.results_count ?? 0} matches</td>
                  <td className="py-2.5 font-mono text-slate-500 dark:text-slate-400">{log.user_id}</td>
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
