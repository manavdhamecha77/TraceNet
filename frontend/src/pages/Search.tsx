import React, { useState, useEffect, useRef } from 'react'
import {
  Search as SearchIcon,
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
  X,
  SlidersHorizontal,
  Globe,
} from 'lucide-react'

import { API_BASE } from '../config/api'
import { classColor } from '../utils/colors'
import { formatDisplayDate } from '../utils/dateFormatter'

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

interface AttributeCheck {
  kind: string
  value: string
  region: string | null
  text: string
  verifiable: boolean
  verdict: 'matched' | 'mismatched' | 'unverified'
  detail: string
}

interface ParsedConstraint {
  kind: string
  value: string
  region: string | null
  text: string
  verifiable: boolean
}

type AttributeMode = 'boost' | 'strict' | 'off'

interface QueryParseMeta {
  is_multilingual: boolean
  detected_language: string
  language_code: string
  normalized_query: string
  backend_used: string
}

const COLOR_SWATCHES: { name: string; hex: string }[] = [
  { name: 'black', hex: '#111827' }, { name: 'white', hex: '#f9fafb' }, { name: 'gray', hex: '#9ca3af' },
  { name: 'red', hex: '#dc2626' }, { name: 'orange', hex: '#f97316' }, { name: 'yellow', hex: '#facc15' },
  { name: 'green', hex: '#16a34a' }, { name: 'blue', hex: '#2563eb' }, { name: 'purple', hex: '#9333ea' },
  { name: 'pink', hex: '#ec4899' }, { name: 'brown', hex: '#92400e' },
]

const VERDICT_STYLE: Record<string, string> = {
  matched: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  mismatched: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30 line-through decoration-rose-400/60',
  unverified: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
}

interface SearchExplanation {
  retrieval_method: string
  attribute_mode?: string
  attribute_checks?: AttributeCheck[]
  final_score_percent?: number
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
  plate?: PlateInfo | null
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
import ExportDialog from '../components/ExportDialog'
import { PlateBadge, type PlateInfo } from '../components/PlateBadge'
import { useTranslation } from 'react-i18next'

export default function Search({ onPlayVideoAtTime }: SearchProps) {
  const { t } = useTranslation()
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
  const [exportOpen, setExportOpen]           = useState(false)
  const [filterModalOpen, setFilterModalOpen] = useState(false)

  // Attribute (colour / vehicle type) filtering
  const [attributeMode, setAttributeMode]     = useState<AttributeMode>('boost')
  const [selectedColors, setSelectedColors]   = useState<string[]>([])
  const [parsedConstraints, setParsedConstraints] = useState<ParsedConstraint[]>([])
  const [queryParseMeta, setQueryParseMeta]   = useState<QueryParseMeta | null>(null)
  const [lastSearch, setLastSearch]           = useState<{ query: string; filters: Record<string, unknown>; multilingual?: QueryParseMeta | null }>({ query: '', filters: {}, multilingual: null })

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

  // Live preview of which attributes the system will verify for the typed query
  useEffect(() => {
    const text = query.trim()
    if (text.length < 2) {
      setParsedConstraints([])
      setQueryParseMeta(null)
      return
    }
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/search/parse?q=${encodeURIComponent(text)}`)
        if (res.ok) {
          const data = await res.json()
          setParsedConstraints([...(data.verifiable || []), ...(data.unverifiable || [])])
          if (data.is_multilingual) {
            setQueryParseMeta({
              is_multilingual: true,
              detected_language: data.detected_language || 'Indic',
              language_code: data.language_code || 'hi',
              normalized_query: data.normalized_query || text,
              backend_used: data.backend_used || 'offline_ai',
            })
          } else {
            setQueryParseMeta(null)
          }
        }
      } catch {
        setParsedConstraints([])
        setQueryParseMeta(null)
      }
    }, 300)
    return () => window.clearTimeout(handle)
  }, [query])

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
      top_k: topK,
      colors: selectedColors.length > 0 ? selectedColors : null,
      attribute_mode: attributeMode,
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
      setLastSearch({
        query: payload.query,
        filters: {
          camera_ids: payload.camera_ids, time_start: payload.time_start, time_end: payload.time_end,
          object_type: payload.object_type, colors: payload.colors, attribute_mode: payload.attribute_mode,
        },
        multilingual: queryParseMeta,
      })

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
      setLastSearch({
        query: `[IMAGE SEARCH] ${referenceFile.name}`,
        filters: {
          camera_ids: activeCameraIds.length > 0 ? activeCameraIds : null,
          time_start: timeStart ? new Date(timeStart).toISOString() : null,
          time_end: timeEnd ? new Date(timeEnd).toISOString() : null,
          object_type: objectType,
        },
      })
      
      const logRes = await fetch(`${API_BASE}/api/v1/search/logs`)
      if (logRes.ok) setSearchLogs(await logRes.json())
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : 'Reverse image vector search execution failure.')
    } finally {
      setSearching(false)
    }
  }

  const handleExportResults = () => {
    if (visibleResults.length === 0) return
    setExportOpen(true)
  }

  const toggleColor = (name: string) =>
    setSelectedColors(prev => (prev.includes(name) ? prev.filter(c => c !== name) : [...prev, name]))

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
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Forensic Search &amp; Rank</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Submit natural language queries to search, rank, and explain CCTV tracklets using persistent Qdrant vector indices.
          </p>
        </div>
        {/* Compact 2×2 system status and maintenance actions */}
        <div className="grid w-full grid-cols-2 gap-1.5 lg:w-[390px] lg:shrink-0">
          <div className="min-h-8 min-w-0 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600 flex items-center gap-1.5 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <Cpu className="h-3 w-3 shrink-0 text-slate-400" />
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Index</span><strong className="truncate font-mono font-medium text-slate-800 dark:text-slate-100">Qdrant Local</strong>
          </div>
          <div className="min-h-8 min-w-0 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600 flex items-center gap-1.5 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <Layers className="h-3 w-3 shrink-0 text-slate-400" />
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Detector</span><strong className="truncate font-mono font-medium text-teal-800 dark:text-teal-300">{modelInfo ? modelInfo.model_path.split(/[/\\]/).pop() : 'Loading...'}</strong>
          </div>
          <div className="min-h-8 min-w-0 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600 flex items-center gap-1.5 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <Sparkles className="h-3 w-3 shrink-0 text-slate-400" />
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Encoder</span><strong className="truncate font-mono font-medium text-teal-800 dark:text-teal-300">CLIP ViT-B-32</strong>
          </div>
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
            className="min-h-8 rounded border border-teal-700 bg-teal-700 px-2 py-1 text-[10px] font-semibold text-white hover:bg-teal-800 cursor-pointer transition-colors flex items-center justify-center gap-1.5"
          >
            <RefreshCw className="h-3 w-3" />
            Re-index All Feeds
          </button>
      </div>
      </div>

      {/* SEARCH INTERFACE PANEL */}
      <div className="space-y-4">
        
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
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
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
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <ImageIcon className="h-3.5 w-3.5" /> Photo Re-ID Search
            </button>
          </div>

          <form onSubmit={searchMode === 'text' ? handleSearch : handlePhotoSearch} className="space-y-4">
            <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">
                {searchMode === 'text' ? 'Natural Language Query descriptor' : 'Reference Target Photo (Person or Vehicle)'}
              </label>

              {searchMode === 'text' ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <SearchIcon className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-teal-700 dark:text-teal-400" />
                      <input
                        type="text"
                        required
                        placeholder={t('search.placeholder')}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="h-12 w-full rounded border border-slate-300 bg-white pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 shadow-sm transition focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-teal-400 dark:focus:ring-teal-400/20"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={searching || loadingMetadata}
                      className="h-12 bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700 text-white px-6 rounded text-sm font-semibold transition-all shrink-0 shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {searching ? (
                        <RefreshCw className="animate-spin h-3.5 w-3.5" />
                      ) : (
                        <SearchIcon className="h-3.5 w-3.5" />
                      )}
                      {t('search.button')}
                    </button>
                    {/* Filter icon button */}
                    <button
                      type="button"
                      onClick={() => setFilterModalOpen(true)}
                      title="Filters & Scope"
                      className={`relative h-12 w-12 shrink-0 flex items-center justify-center rounded border transition-all shadow-sm ${
                        (selectedColors.length > 0 || attributeMode !== 'boost' || timeStart || timeEnd || objectType !== 'all' || topK !== 15 || selectedModels.length > 0 || selectedCameras.length > 0)
                          ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300'
                          : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:border-teal-600 hover:text-teal-700 dark:hover:border-teal-500 dark:hover:text-teal-300'
                      }`}
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      {(selectedColors.length > 0 || attributeMode !== 'boost' || timeStart || timeEnd || objectType !== 'all' || topK !== 15 || selectedModels.length > 0 || selectedCameras.length > 0) && (
                        <span className="absolute -top-1.5 -right-1.5 h-4 w-4 flex items-center justify-center rounded-full bg-teal-600 text-white text-[8px] font-bold leading-none">
                          {[selectedColors.length > 0, attributeMode !== 'boost', timeStart, timeEnd, objectType !== 'all', topK !== 15, selectedModels.length > 0, selectedCameras.length > 0].filter(Boolean).length}
                        </span>
                      )}
                    </button>
                  </div>

                  {/* Live Multilingual Translation Banner */}
                  {queryParseMeta?.is_multilingual && queryParseMeta?.normalized_query && (
                    <div className="flex items-center justify-between text-xs bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/60 rounded px-3 py-1.5 text-indigo-900 dark:text-indigo-200 transition-all">
                      <div className="flex items-center gap-2 truncate">
                        <Globe className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                        <span className="font-semibold uppercase tracking-wider text-[10px] bg-indigo-200 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200 px-1.5 py-0.5 rounded">
                          {queryParseMeta.detected_language}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400 text-[11px]">Normalized:</span>
                        <span className="font-mono font-medium truncate text-slate-800 dark:text-slate-100">
                          "{queryParseMeta.normalized_query}"
                        </span>
                      </div>
                      <span className="text-[10px] text-indigo-500 dark:text-indigo-400 hidden sm:inline shrink-0 font-medium ml-2">
                        Offline Multilingual Vector + Attribute Mapping
                      </span>
                    </div>
                  )}

                  {/* Multilingual Quick Suggestion Chips */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium mr-1 flex items-center gap-1">
                      <Globe className="h-3 w-3" /> Quick queries:
                    </span>
                    {[
                      { label: 'लाल शर्ट में आदमी', lang: 'Hindi' },
                      { label: 'સફેદ કાર ગેટ 3 પાસે', lang: 'Gujarati' },
                      { label: 'kaala backpack leke ladka', lang: 'Hinglish' },
                      { label: 'laal jacket valo maanas', lang: 'Gujlish' },
                    ].map((chip) => (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => setQuery(chip.label)}
                        className="text-[11px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-teal-50 dark:hover:bg-teal-950/50 hover:text-teal-700 dark:hover:text-teal-300 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition"
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
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
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{((referenceFile?.size || 0) / 1024).toFixed(1)} KB</p>
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
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2">Supports JPEG, PNG, WebP, BMP (Max 10 MB)</p>
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

          </form>
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
                {lastSearch.multilingual?.is_multilingual && (
                  <span
                    className="text-[9px] bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 px-2 py-0.5 rounded font-bold flex items-center gap-1"
                    title={`Original: "${lastSearch.query}" → Normalized: "${lastSearch.multilingual.normalized_query}"`}
                  >
                    <Globe className="h-3 w-3" />
                    MULTILINGUAL: {lastSearch.multilingual.detected_language?.toUpperCase()} → EN
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Found {visibleResults.length} matching candidate tracklets</p>
            </div>
            
            <div className="flex items-center gap-3">
              {exportHash && (
                <span className="text-[9px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3" />
                  Sealed SHA-256: {exportHash.substring(0, 16)}...
                </span>
              )}
              <button
                onClick={handleExportResults}
                className="bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-250 dark:border-slate-650 text-slate-700 dark:text-slate-300 px-3.5 py-1.5 rounded text-[11px] font-bold transition-all inline-flex items-center gap-1.5 shadow-sm"
              >
                <Download className="h-3.5 w-3.5" />
                Export Evidence Bundle
              </button>
            </div>
          </div>
        )}

        {/* SCORE INTERPRETATION GUIDANCE BAR */}
        {visibleResults.length > 0 && (
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200 font-semibold">
              <span>Match Score Guidance:</span>
            </div>
            <div className="flex items-center gap-4 text-[11px] font-mono">
              <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                &gt;80% High Match (Reliable Target)
              </span>
              <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-bold">
                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                50–80% Moderate Match
              </span>
              <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                <span className="w-2 h-2 rounded-full bg-slate-400 dark:bg-slate-500"></span>
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

                    <PlateBadge plate={result.plate} />

                    {result.caption && (
                      <div className="text-[9.5px] italic text-teal-700 dark:text-teal-300 bg-teal-500/10 border border-teal-500/20 px-1.5 py-0.5 rounded leading-tight line-clamp-2" title={`BLIP Auto-Caption: ${result.caption}`}>
                        "{result.caption}"
                      </div>
                    )}

                    {(result.explanation?.attribute_checks?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {result.explanation!.attribute_checks!.map((check, checkIdx) => (
                          <span
                            key={`${check.text}-${checkIdx}`}
                            title={check.detail}
                            className={`rounded border px-1 py-0.5 text-[9px] font-semibold ${VERDICT_STYLE[check.verdict]}`}
                          >
                            {check.verdict === 'matched' ? '✓' : check.verdict === 'mismatched' ? '✗' : '?'} {check.text}
                          </span>
                        ))}
                      </div>
                    )}

                    <details className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 text-[9.5px]">
                      <summary className="cursor-pointer select-none px-2 py-1.5 font-bold text-teal-700 dark:text-teal-400 flex items-center gap-1">
                        <Sparkles className="h-3 w-3" /> Why this matched
                      </summary>
                      <div className="border-t border-slate-200 dark:border-slate-700 px-2 py-2 space-y-1.5 text-slate-600 dark:text-slate-300">
                        {(result.explanation?.evidence || []).map((evidence, evidenceIdx) => (
                          <div key={`${evidence.label}-${evidenceIdx}`} className="flex gap-1.5">
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
                      className="flex items-center justify-center gap-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30 py-1.5 rounded text-[10px] font-bold transition-all"
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
                  <td colSpan={5} className="py-6 text-center text-slate-400 dark:text-slate-500">No search logs indexed. Audit trail is empty.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── FILTER MODAL ──────────────────────────────────────── */}
      {filterModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setFilterModalOpen(false)}
          />

          {/* Panel */}
          <div className="relative z-10 w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
            
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Search Filters &amp; Scope</h3>
              </div>
              <button
                onClick={() => setFilterModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                aria-label="Close filters"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

              {/* Colour attributes */}
              {searchMode === 'text' && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Colour Attribute Filter</h4>
                    <select
                      value={attributeMode}
                      onChange={(e) => setAttributeMode(e.target.value as AttributeMode)}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-600"
                    >
                      <option value="boost">Boost — re-rank by verified attributes</option>
                      <option value="strict">Strict — hide contradicted results</option>
                      <option value="off">Off — visual similarity only</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {COLOR_SWATCHES.map(sw => {
                      const active = selectedColors.includes(sw.name)
                      return (
                        <button
                          key={sw.name}
                          type="button"
                          onClick={() => toggleColor(sw.name)}
                          aria-pressed={active}
                          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold capitalize transition-all ${
                            active
                              ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 ring-1 ring-teal-500'
                              : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-teal-500 hover:text-slate-700 dark:hover:text-slate-200'
                          }`}
                        >
                          <span className="h-3 w-3 rounded-full border border-slate-300/60 dark:border-slate-600/60 shrink-0" style={{ backgroundColor: sw.hex }} />
                          {sw.name}
                        </button>
                      )
                    })}
                  </div>
                  {parsedConstraints.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] pt-1">
                      <span className="text-slate-400 dark:text-slate-500 font-semibold shrink-0">Detected in query:</span>
                      {parsedConstraints.map((c, i) => (
                        <span
                          key={`${c.kind}-${c.value}-${c.region}-${i}`}
                          className={`rounded border px-1.5 py-0.5 font-semibold ${
                            c.verifiable
                              ? 'border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300'
                              : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                          }`}
                          title={c.verifiable ? 'Will be verified against each candidate' : 'Cannot be verified automatically — review manually'}
                        >
                          {c.text}{c.region && c.region !== 'any' && c.region !== 'body' ? ` · ${c.region}` : ''}{c.verifiable ? '' : ' (unverifiable)'}
                        </span>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* Timeframe */}
              <section className="space-y-3">
                <h4 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('search.timeframe')}</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-medium text-slate-600 dark:text-slate-400 mb-1">Start</label>
                    <input
                      type="datetime-local"
                      value={timeStart}
                      onChange={(e) => setTimeStart(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-[11px] text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-600 dark:text-slate-400 mb-1">End</label>
                    <input
                      type="datetime-local"
                      value={timeEnd}
                      onChange={(e) => setTimeEnd(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-[11px] text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-600"
                    />
                  </div>
                </div>
              </section>

              {/* Category + Top K */}
              <section className="space-y-3">
                <h4 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('search.category')} &amp; Scope</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-medium text-slate-600 dark:text-slate-400 mb-1">{t('search.category')}</label>
                    <select
                      value={objectType}
                      onChange={(e) => setObjectType(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-[11px] text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-600"
                    >
                      <option value="all">{t('search.all')}</option>
                      <option value="person">{t('search.person')}</option>
                      <option value="vehicle">{t('search.vehicle')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-600 dark:text-slate-400 mb-1">{t('search.topK')}</label>
                    <input
                      type="number"
                      min="1"
                      max="50"
                      value={topK}
                      onChange={(e) => setTopK(parseInt(e.target.value) || 15)}
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-[11px] text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-600"
                    />
                  </div>
                </div>
              </section>

              {/* Model filter */}
              <section className="space-y-3">
                <div>
                  <h4 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Model Filter</h4>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">De-selecting a model hides its predictions and locks its cameras.</p>
                </div>
                <div className="space-y-2">
                  {models.length === 0 ? (
                    <p className="text-xs text-slate-400 dark:text-slate-500 py-1">No uploaded models found.</p>
                  ) : (
                    models.map((m) => (
                      <label key={m.id} className="flex items-center gap-3 cursor-pointer p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <input
                          type="checkbox"
                          checked={selectedModels.includes(m.id)}
                          onChange={() => handleModelToggle(m.id)}
                          className="rounded text-amber-600 border-slate-300 dark:border-slate-600 focus:ring-amber-500 shrink-0"
                        />
                        <span className="font-mono bg-amber-500/10 px-1.5 py-0.5 rounded text-[10px] text-amber-700 dark:text-amber-400 font-bold shrink-0">{m.model_type}</span>
                        <span className="text-xs text-slate-700 dark:text-slate-300 min-w-0 truncate">{m.name}</span>
                      </label>
                    ))
                  )}
                </div>
              </section>

              {/* Camera scope */}
              <section className="space-y-3">
                <div>
                  <h4 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Camera Scope</h4>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Restrict search to specific camera nodes. Cameras locked by model filter are disabled.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {cameras.length === 0 ? (
                    <p className="text-xs text-slate-400 dark:text-slate-500 col-span-2 py-1">No cameras configured.</p>
                  ) : (
                    cameras.map((c) => {
                      const disabled = isCameraDisabled(c)
                      return (
                        <label
                          key={c.camera_id}
                          className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                            disabled
                              ? 'border-slate-100 dark:border-slate-800 opacity-40 cursor-not-allowed'
                              : 'border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer'
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={selectedCameras.includes(c.camera_id)}
                            onChange={() => handleCameraToggle(c.camera_id)}
                            className="rounded text-teal-700 border-slate-300 dark:border-slate-600 focus:ring-teal-500 disabled:opacity-50 shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="font-mono text-[10px] text-teal-700 dark:text-teal-400 font-bold truncate">{c.camera_id}</p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{c.name}</p>
                          </div>
                        </label>
                      )
                    })
                  )}
                </div>
              </section>

            </div>

            {/* Footer */}
            <div className="shrink-0 px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3 bg-slate-50/80 dark:bg-slate-900/80">
              <button
                type="button"
                onClick={() => {
                  setSelectedColors([])
                  setAttributeMode('boost')
                  setTimeStart('')
                  setTimeEnd('')
                  setObjectType('all')
                  setTopK(15)
                  setSelectedModels([])
                  setSelectedCameras([])
                }}
                className="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              >
                Reset all
              </button>
              <button
                type="button"
                onClick={() => setFilterModalOpen(false)}
                className="px-5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700 text-white text-xs font-bold transition-colors shadow-sm"
              >
                Apply &amp; Search
              </button>
            </div>
          </div>
        </div>
      )}

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        candidates={visibleResults.map(r => ({ tracklet_id: r.tracklet_id, score: r.score }))}
        query={lastSearch.query || query}
        filters={lastSearch.filters}
        onSealed={(sealed) => setExportHash(sealed.zip_sha256)}
      />

    </div>
  </div>
  )
}