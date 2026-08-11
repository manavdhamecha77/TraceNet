import React, { useState } from 'react'
import { formatDisplayDate } from '../utils/dateFormatter'

interface MLModel {
  id: string
  name: string
  file_path: string
  model_type: string
  classes: string[]
  category?: string
  is_default?: boolean
  last_used_timestamp: string | null
  created_at: string
}

interface ServingLog {
  id: number
  model_id: string
  video_id: string
  camera_id: string
  timestamp: string
  frames_processed: number
  inference_duration_seconds: number
  objects_detected_count: number
}

interface ModelsProps {
  models: MLModel[]
  onRefreshModels: () => void
}

import { useToast } from '../components/Toast'

const API_BASE = 'http://localhost:8000'

const CATEGORY_LABELS: Record<string, { label: string; color: string; border: string; bg: string }> = {
  general: { label: 'General', color: 'text-teal-700 dark:text-teal-300', border: 'border-teal-500/30', bg: 'bg-teal-500/10' },
  theft: { label: 'Outdoor Theft', color: 'text-rose-700 dark:text-rose-300', border: 'border-rose-500/30', bg: 'bg-rose-500/10' },
  abandoned: { label: 'Abandoned Objects', color: 'text-amber-700 dark:text-amber-300', border: 'border-amber-500/30', bg: 'bg-amber-500/10' },
  assault: { label: 'Assault Detection', color: 'text-purple-700 dark:text-purple-300', border: 'border-purple-500/30', bg: 'bg-purple-500/10' },
}

export default function Models({ models, onRefreshModels }: ModelsProps) {
  const toast = useToast()
  // Local state for modals & drawers
  const [isRegisterOpen, setIsRegisterOpen] = useState(false)
  const [activeLogModelId, setActiveLogModelId] = useState<string | null>(null)
  const [modelLogs, setModelLogs] = useState<ServingLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [editingCategoryModelId, setEditingCategoryModelId] = useState<string | null>(null)
  const [selectedClassesModel, setSelectedClassesModel] = useState<MLModel | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Filters & Search State
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [archFilter, setArchFilter] = useState('all')
  const [classFilter, setClassFilter] = useState('')
  const [onlyDefaults, setOnlyDefaults] = useState(false)

  // Form State
  const [name, setName] = useState('')
  const [modelType, setModelType] = useState('')
  const [category, setCategory] = useState('general')
  const [isDefault, setIsDefault] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [manualClasses, setManualClasses] = useState('')
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState(false)
  const [registeredClasses, setRegisteredClasses] = useState<string[]>([])

  // Category update handler
  const handleUpdateCategory = async (modelId: string, newCategory: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/models/${modelId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: newCategory }),
      })
      if (res.ok) {
        onRefreshModels()
      }
    } catch (err) {
      console.error('Failed to update model category:', err)
    } finally {
      setEditingCategoryModelId(null)
    }
  }

  // Set default model handler
  const handleSetDefault = async (modelId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/models/${modelId}/set-default`, { method: 'PUT' })
      if (res.ok) {
        onRefreshModels()
      }
    } catch (err) {
      console.error('Failed to set default model:', err)
    }
  }

  // Copy helper
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // Fetch model serving logs
  const fetchLogs = async (modelId: string) => {
    setLogsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/models/${modelId}/logs`)
      if (res.ok) {
        const data = await res.json()
        setModelLogs(data)
      }
    } catch (err) {
      console.error('Failed to fetch model execution logs:', err)
    } finally {
      setLogsLoading(false)
    }
  }

  const toggleLogs = (modelId: string) => {
    if (activeLogModelId === modelId) {
      setActiveLogModelId(null)
      setModelLogs([])
    } else {
      setActiveLogModelId(modelId)
      fetchLogs(modelId)
    }
  }

  // Handle model registration submit
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    setFormSuccess(false)

    if (!name.trim()) {
      setFormError('Model name is required.')
      return
    }
    if (!modelType) {
      setFormError('Please select a model type.')
      return
    }
    if (!file) {
      setFormError('Please select a weights file (.pt).')
      return
    }

    const formData = new FormData()
    formData.append('name', name.trim())
    formData.append('model_type', modelType)
    formData.append('category', category)
    formData.append('is_default', isDefault ? 'true' : 'false')
    formData.append('file', file)
    if (manualClasses.trim()) {
      formData.append('manual_classes', manualClasses.trim())
    }

    setUploadProgress(0)

    try {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${API_BASE}/api/v1/models`)

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const pct = Math.round((event.loaded / event.total) * 100)
          setUploadProgress(pct)
        }
      }

      xhr.onload = async () => {
        if (xhr.status === 201) {
          let classesList: string[] = []
          try {
            const respJson = JSON.parse(xhr.responseText)
            classesList = respJson.classes || []
            setRegisteredClasses(classesList)
          } catch (e) {
            console.error('Failed to parse response classes:', e)
          }
          setFormSuccess(true)
          setUploadProgress(100)
          onRefreshModels()
          setTimeout(() => {
            setIsRegisterOpen(false)
            setName('')
            setModelType('')
            setFile(null)
            setManualClasses('')
            setUploadProgress(null)
            setFormSuccess(false)
            setRegisteredClasses([])
          }, classesList.length > 0 ? 3500 : 1500)
        } else {
          try {
            const errJson = JSON.parse(xhr.responseText)
            setFormError(errJson.detail || 'Failed to register model.')
          } catch {
            setFormError('An error occurred during registration.')
          }
          setUploadProgress(null)
        }
      }

      xhr.onerror = () => {
        setFormError('Network connection failed.')
        setUploadProgress(null)
      }

      xhr.send(formData)
    } catch (err) {
      setFormError('Failed to initiate request.')
      setUploadProgress(null)
    }
  }

  const handleDeleteModel = async (modelId: string) => {
    const model = models.find(m => m.id === modelId)
    if (!model) return

    if (!window.confirm(`Are you sure you want to delete model "${model.name}"? This operation cannot be undone.`)) {
      return
    }

    try {
      const res = await fetch(`${API_BASE}/api/v1/models/${modelId}`, {
        method: 'DELETE',
      })

      if (res.status === 204) {
        toast.success('Model Deleted', 'Detector model weights unlinked successfully.')
        onRefreshModels()
        if (activeLogModelId === modelId) {
          setActiveLogModelId(null)
        }
      } else {
        const errorData = await res.json()
        toast.error('Delete Failed', errorData.detail || 'Failed to delete model.')
      }
    } catch (err) {
      toast.error('Network Error', 'Failed to delete model.')
    }
  }

  // Filtered Models Computation
  const filteredModels = models.filter(m => {
    // 1. Search Query (Name, ID, Path)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      const matchName = m.name.toLowerCase().includes(q)
      const matchId = m.id.toLowerCase().includes(q)
      const matchPath = m.file_path.toLowerCase().includes(q)
      if (!matchName && !matchId && !matchPath) return false
    }
    // 2. Category Filter
    if (categoryFilter !== 'all') {
      const cat = m.category || 'general'
      if (cat !== categoryFilter) return false
    }
    // 3. Architecture Filter
    if (archFilter !== 'all') {
      if (m.model_type !== archFilter) return false
    }
    // 4. Detectable Class Keyword Filter
    if (classFilter.trim()) {
      const cq = classFilter.toLowerCase()
      const matchClass = m.classes.some(c => c.toLowerCase().includes(cq))
      if (!matchClass) return false
    }
    // 5. Defaults Only Filter
    if (onlyDefaults && !m.is_default) {
      return false
    }
    return true
  })

  // Parse manual upload class chips
  const classChips = manualClasses
    ? manualClasses.split(',').map(s => s.trim()).filter(Boolean)
    : []

  const formatDateTime = (isoStr: string | null) => {
    if (!isoStr) return 'Never used'
    return formatDisplayDate(isoStr)
  }

  return (
    <div className="space-y-6 text-slate-800 dark:text-slate-100">
      
      {/* ── PAGE HEADER ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">AI Model Registry</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Manage weight libraries, assign specialized engine roles, inspect detectable classes, and analyze execution metrics.
          </p>
        </div>
        <button
          onClick={() => setIsRegisterOpen(true)}
          className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white px-3.5 py-2 rounded-lg text-xs font-bold transition-all shadow-sm shrink-0"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Register Model
        </button>
      </div>

      {/* ── SEARCH & FILTER CONTROLS BAR ── */}
      <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <svg className="w-4 h-4 text-teal-600 dark:text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Search &amp; Filter Model Nodes
          </span>
          {(searchQuery || categoryFilter !== 'all' || archFilter !== 'all' || classFilter || onlyDefaults) && (
            <button
              onClick={() => {
                setSearchQuery('')
                setCategoryFilter('all')
                setArchFilter('all')
                setClassFilter('')
                setOnlyDefaults(false)
              }}
              className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline"
            >
              Reset Filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
          {/* 1. Name / Text Search */}
          <div>
            <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Search Name / ID</label>
            <input
              type="text"
              placeholder="Search model name..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full h-8 px-2.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-600"
            />
          </div>

          {/* 2. Category Filter */}
          <div>
            <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Alert Role / Engine</label>
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="w-full h-8 px-2.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-600"
            >
              <option value="all">All Roles &amp; Engines</option>
              <option value="general">General Object Detector</option>
              <option value="theft">Outdoor Theft Detector</option>
              <option value="abandoned">Abandoned Object Detector</option>
              <option value="assault">Assault Detector</option>
            </select>
          </div>

          {/* 3. Architecture Filter */}
          <div>
            <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Architecture</label>
            <select
              value={archFilter}
              onChange={e => setArchFilter(e.target.value)}
              className="w-full h-8 px-2.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-600"
            >
              <option value="all">All Architectures</option>
              <option value="YOLOv8">YOLOv8</option>
              <option value="YOLOv11">YOLOv11</option>
              <option value="YOLOv12">YOLOv12</option>
              <option value="RT-DETR">RT-DETR</option>
              <option value="GroundingDino">GroundingDino</option>
            </select>
          </div>

          {/* 4. Detectable Class Keyword Filter */}
          <div>
            <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Filter Class Keyword</label>
            <input
              type="text"
              placeholder="e.g. person, suitcase"
              value={classFilter}
              onChange={e => setClassFilter(e.target.value)}
              className="w-full h-8 px-2.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-600"
            />
          </div>

          {/* 5. See All Defaults Toggle */}
          <div className="flex items-end">
            <button
              onClick={() => setOnlyDefaults(p => !p)}
              className={`w-full h-8 px-3 rounded-md border text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                onlyDefaults
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                  : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <span>{onlyDefaults ? '★ Showing Defaults Only' : 'See All Defaults'}</span>
            </button>
          </div>
        </div>
      </section>

      {/* ── MODELS LIST TABLE ── */}
      <section className="border border-slate-200 dark:border-slate-800/80 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-xs">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center justify-between">
          <span>Registered Models Directory — Showing {filteredModels.length} of {models.length} Models</span>
        </div>

        <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-left">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
            <tr>
              <th className="px-3.5 py-3">Model Name</th>
              <th className="px-3.5 py-3">Engine Category / Role</th>
              <th className="px-3.5 py-3">Architecture</th>
              <th className="px-3.5 py-3">Detectable Classes</th>
              <th className="px-3.5 py-3">Last Served</th>
              <th className="px-3.5 py-3 text-right w-[240px]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            {filteredModels.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-16 text-xs text-slate-400 dark:text-slate-600">
                  No model nodes match your search criteria. Try clearing search filters or registering a model.
                </td>
              </tr>
            ) : (
              filteredModels.map(model => {
                const isExpanded = activeLogModelId === model.id
                const catInfo = CATEGORY_LABELS[model.category || 'general'] || CATEGORY_LABELS['general']
                const isEditingCat = editingCategoryModelId === model.id

                return (
                  <React.Fragment key={model.id}>
                    <tr className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                      
                      {/* 1. Model Name */}
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-100">{model.name}</span>
                            {model.is_default && (
                              <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                                ★ DEFAULT
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate max-w-[200px]" title={model.file_path}>
                            weights: {model.file_path.split(/[\/\\]/).pop()}
                          </span>
                        </div>
                      </td>

                      {/* 2. Engine Category (Click to edit) */}
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        {isEditingCat ? (
                          <select
                            autoFocus
                            defaultValue={model.category || 'general'}
                            onChange={(e) => handleUpdateCategory(model.id, e.target.value)}
                            onBlur={() => setEditingCategoryModelId(null)}
                            className="text-xs px-2 py-1 rounded border border-teal-500 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none"
                          >
                            <option value="general">General</option>
                            <option value="theft">Outdoor Theft</option>
                            <option value="abandoned">Abandoned Objects</option>
                            <option value="assault">Assault Detection</option>
                          </select>
                        ) : (
                          <button
                            onClick={() => setEditingCategoryModelId(model.id)}
                            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider border transition-transform hover:scale-105 ${catInfo.bg} ${catInfo.color} ${catInfo.border}`}
                            title="Click to change engine role"
                          >
                            <span>{catInfo.label}</span>
                            <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        )}
                      </td>

                      {/* 3. Architecture */}
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        <span className="inline-flex rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 px-2.5 py-0.5 text-[10px] font-bold">
                          {model.model_type}
                        </span>
                      </td>

                      {/* 4. Detectable Classes (Clipped with See More modal link) */}
                      <td className="px-3.5 py-3 max-w-[240px]">
                        {model.classes.length > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <div className="flex flex-wrap gap-1">
                              {model.classes.slice(0, 3).map((cls, idx) => (
                                <span key={idx} className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded px-1.5 py-0.5 text-[9px] font-medium border border-slate-200 dark:border-slate-700">
                                  {cls}
                                </span>
                              ))}
                            </div>
                            {model.classes.length > 3 && (
                              <button
                                onClick={() => setSelectedClassesModel(model)}
                                className="text-[10px] font-bold text-teal-600 dark:text-teal-400 hover:underline shrink-0"
                              >
                                +{model.classes.length - 3} more...
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-600 italic text-[10px]">None registered</span>
                        )}
                      </td>

                      {/* 5. Last Used (Formatted datetime + truncated path with hover tooltip and click-to-copy) */}
                      <td className="px-3.5 py-3 whitespace-nowrap text-xs">
                        <div className="flex flex-col">
                          <span className="text-slate-700 dark:text-slate-300 font-medium">
                            {formatDateTime(model.last_used_timestamp)}
                          </span>
                          {model.last_used_timestamp && (
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span
                                onClick={() => handleCopy(`Model ${model.name} (${model.id}) last dispatched`, model.id)}
                                title={`Last served on node target. Click to copy details.`}
                                className="text-[10px] font-mono text-teal-600 dark:text-teal-400 hover:underline cursor-pointer truncate max-w-[140px]"
                              >
                                Dispatched
                              </span>
                              {copiedId === model.id && (
                                <span className="text-[9px] font-bold text-emerald-500 animate-in fade-in">
                                  Copied!
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* 6. Actions */}
                      <td className="px-3.5 py-3 whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <button
                            onClick={() => handleSetDefault(model.id)}
                            className={`inline-flex items-center gap-1 border px-2 py-1 rounded text-[10px] font-bold transition-all ${
                              model.is_default
                                ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                                : 'bg-transparent border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                            }`}
                            title="Set as Default System Model for its category"
                          >
                            {model.is_default ? '★ Default' : 'Set Default'}
                          </button>

                          <button
                            onClick={() => toggleLogs(model.id)}
                            className={`inline-flex items-center gap-1 border px-2 py-1 rounded text-[10px] font-bold transition-all ${
                              isExpanded 
                                ? 'bg-slate-200 dark:bg-slate-700 border-slate-350 dark:border-slate-600 text-slate-800 dark:text-white' 
                                : 'bg-transparent border-slate-250 dark:border-slate-600 text-slate-700 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-750'
                            }`}
                          >
                            Logs
                            <svg className={`h-3 w-3 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          
                          <button
                            onClick={() => handleDeleteModel(model.id)}
                            className="bg-transparent hover:bg-rose-500/10 border border-rose-500/20 hover:border-rose-500/30 text-rose-600 dark:text-rose-400 px-2 py-1 rounded text-[10px] font-bold transition-all"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* EXPANDABLE LOGS DRAWER */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} className="bg-slate-50/50 dark:bg-slate-900/30 px-6 py-4">
                          <div className="border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden bg-white dark:bg-slate-900/60 shadow-inner">
                            <div className="px-3.5 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center justify-between">
                              <span>Model serving execution logs</span>
                              <span className="font-mono text-[9px] text-slate-400">Uploaded at: {model.file_path}</span>
                            </div>
                            {logsLoading ? (
                              <div className="flex items-center gap-2 p-5 text-xs text-slate-450 dark:text-slate-550">
                                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                Loading execution history...
                              </div>
                            ) : modelLogs.length === 0 ? (
                              <div className="p-5 text-xs text-slate-400 dark:text-slate-650 italic">
                                This model has not been dispatched for any camera ingestions yet.
                              </div>
                            ) : (
                              <table className="min-w-full text-left text-xs divide-y divide-slate-100 dark:divide-slate-800">
                                <thead className="bg-slate-50/80 dark:bg-slate-800/40 text-[9px] text-slate-500 uppercase tracking-wider font-bold">
                                  <tr>
                                    <th className="px-3 py-2">Timestamp</th>
                                    <th className="px-3 py-2">Camera Node</th>
                                    <th className="px-3 py-2">Video Ingested</th>
                                    <th className="px-3 py-2 text-center">Frames Served</th>
                                    <th className="px-3 py-2 text-center">Objects Tracked</th>
                                    <th className="px-3 py-2 text-right">Inference Speed</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium text-slate-600 dark:text-slate-350">
                                  {modelLogs.map((log) => (
                                    <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/20">
                                      <td className="px-3 py-2 whitespace-nowrap">{formatDisplayDate(log.timestamp)}</td>
                                      <td className="px-3 py-2 font-mono text-teal-700 dark:text-teal-400">{log.camera_id}</td>
                                      <td
                                        className="px-3 py-2 truncate max-w-[150px] font-mono text-teal-600 dark:text-teal-400 cursor-pointer hover:underline"
                                        title={`Click to copy Video ID: ${log.video_id}`}
                                        onClick={() => handleCopy(log.video_id, `log-${log.id}`)}
                                      >
                                        {log.video_id.substring(0, 12)}...
                                        {copiedId === `log-${log.id}` && <span className="ml-1 text-[9px] text-emerald-500 font-bold">Copied!</span>}
                                      </td>
                                      <td className="px-3 py-2 text-center">{log.frames_processed}</td>
                                      <td className="px-3 py-2 text-center font-bold text-slate-800 dark:text-slate-100">{log.objects_detected_count}</td>
                                      <td className="px-3 py-2 text-right font-mono text-emerald-700 dark:text-emerald-400">
                                        {log.inference_duration_seconds.toFixed(2)}s ({(log.frames_processed / (log.inference_duration_seconds || 1)).toFixed(1)} fps)
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </section>

      {/* ── DETECTABLE CLASSES FULL DETAILS MODAL ── */}
      {selectedClassesModel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Supported Classes: {selectedClassesModel.name}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Total {selectedClassesModel.classes.length} detectable object classes registered in weight file.</p>
              </div>
              <button
                onClick={() => setSelectedClassesModel(null)}
                className="text-slate-400 hover:text-slate-800 dark:hover:text-white"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="max-h-[350px] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {selectedClassesModel.classes.map((cls, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200">
                    <span className="w-5 h-5 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center text-[10px] font-bold">
                      {idx + 1}
                    </span>
                    <span className="truncate">{cls}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setSelectedClassesModel(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── REGISTER MODEL MODAL ── */}
      {isRegisterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 shadow-lg animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-sm font-bold text-slate-850 dark:text-slate-100">Register ML Model Node</h3>
              <button
                onClick={() => setIsRegisterOpen(false)}
                className="text-slate-400 hover:text-slate-800 dark:hover:text-white"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleRegisterSubmit} className="space-y-4">
              {formError && (
                <div className="p-2.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400 text-xs">
                  {formError}
                </div>
              )}
              {formSuccess && (
                <div className="p-3 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs space-y-1.5 animate-in fade-in duration-200">
                  <div className="font-semibold flex items-center gap-1.5">
                    <svg className="h-4 w-4 text-emerald-650" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    Model uploaded and registered successfully.
                  </div>
                  {registeredClasses.length > 0 && (
                    <div className="pt-1.5 border-t border-emerald-500/20">
                      <span className="font-bold block text-[9px] uppercase tracking-wider text-slate-500 mb-1">Auto-extracted classes:</span>
                      <div className="flex flex-wrap gap-1">
                        {registeredClasses.map((cls, i) => (
                          <span key={i} className="bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 rounded px-1.5 py-0.5 text-[9px] font-bold border border-emerald-500/30">
                            {cls}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 1. MODEL TYPE */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Model Architecture *</label>
                <select
                  value={modelType}
                  onChange={(e) => setModelType(e.target.value)}
                  className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-850 dark:text-slate-100 focus:outline-none focus:border-teal-700 dark:focus:border-teal-400"
                  required
                >
                  <option value="">-- Select Architecture Type --</option>
                  <option value="YOLOv8">YOLO v8 (Object Detection)</option>
                  <option value="YOLOv11">YOLO v11 (Latest Real-time)</option>
                  <option value="YOLOv12">YOLO v12 (Experimental)</option>
                  <option value="RT-DETR">RT-DETR (Real-time Transformer)</option>
                  <option value="GroundingDino">Grounding DINO v2 (Open-vocab)</option>
                </select>
              </div>

              {/* ALERT CATEGORY ROLE */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Target Engine / Role</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-850 dark:text-slate-100 focus:outline-none focus:border-teal-700 dark:focus:border-teal-400"
                >
                  <option value="general">General / Primary Object Detector</option>
                  <option value="theft">Outdoor Theft Detector</option>
                  <option value="abandoned">Abandoned Object Detector</option>
                  <option value="assault">Assault Detector</option>
                </select>
              </div>

              {/* DEFAULT SYSTEM MODEL CHECKBOX */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="isDefaultModel"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="rounded text-teal-600 focus:ring-teal-500 h-4 w-4"
                />
                <label htmlFor="isDefaultModel" className="text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                  Set as Default System Model for this category
                </label>
              </div>

              {/* 2. FILE UPLOAD (Only enabled if type selected) */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Weights File (.pt) *</label>
                <input
                  type="file"
                  accept=".pt"
                  disabled={!modelType}
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-550 dark:text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-[11px] file:font-bold file:bg-slate-100 dark:file:bg-slate-700 file:text-slate-700 dark:file:text-slate-300 hover:file:bg-slate-200 dark:hover:file:bg-slate-650 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  required
                />
                {!modelType && (
                  <span className="text-[9px] text-amber-600 dark:text-amber-500 mt-1 block">Please select the model type first to enable uploads.</span>
                )}
              </div>

              {/* 3. MODEL NAME */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Friendly Display Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Surveillance Person Detector"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-850 dark:text-slate-100 focus:outline-none focus:border-teal-700 dark:focus:border-teal-400"
                  required
                />
              </div>

              {/* 4. MANUAL CLASSES PREVIEW (fallback for non-YOLO) */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Detectable Classes {modelType.toLowerCase().startsWith('yolo') ? '(YOLO Auto-extracted, fallback below)' : '(Manual Entry)'}
                </label>
                <input
                  type="text"
                  placeholder="e.g. person, car, truck, bus (comma separated)"
                  value={manualClasses}
                  onChange={(e) => setManualClasses(e.target.value)}
                  className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-850 dark:text-slate-100 focus:outline-none focus:border-teal-700 dark:focus:border-teal-400"
                />
                {classChips.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2 p-2 border border-slate-150 dark:border-slate-700 rounded bg-slate-50 dark:bg-slate-900/60 max-h-[80px] overflow-y-auto">
                    {classChips.map((chip, idx) => (
                      <span key={idx} className="bg-teal-500/10 text-teal-700 dark:text-teal-400 border border-teal-500/20 rounded-full px-2.5 py-0.5 text-[9px] font-bold">
                        {chip}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* 5. UPLOAD PROGRESS BAR */}
              {uploadProgress !== null && (
                <div className="space-y-1 pt-1">
                  <div className="flex justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400">
                    <span>
                      {uploadProgress < 100 
                        ? 'Uploading Weights File...' 
                        : 'Weights uploaded. Extracting ML classes (this may take a few seconds)...'}
                    </span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded overflow-hidden">
                    <div 
                      className="bg-teal-600 h-full rounded transition-all duration-150"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* FOOTER ACTIONS */}
              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  disabled={uploadProgress !== null}
                  onClick={() => setIsRegisterOpen(false)}
                  className="rounded border border-slate-200 dark:border-slate-650 bg-transparent px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploadProgress !== null}
                  className="rounded bg-teal-700 dark:bg-teal-600 hover:brightness-110 text-white px-3.5 py-1.5 text-xs font-bold transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {uploadProgress !== null ? (
                    <>
                      <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      {uploadProgress < 100 ? `Uploading (${uploadProgress}%)` : 'Extracting...'}
                    </>
                  ) : (
                    'Upload & Register'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
