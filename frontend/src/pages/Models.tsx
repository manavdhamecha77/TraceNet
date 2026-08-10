import React, { useState } from 'react'

interface MLModel {
  id: string
  name: string
  file_path: string
  model_type: string
  classes: string[]
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

export default function Models({ models, onRefreshModels }: ModelsProps) {
  const toast = useToast()
  // Local state for modals & drawers
  const [isRegisterOpen, setIsRegisterOpen] = useState(false)
  const [activeLogModelId, setActiveLogModelId] = useState<string | null>(null)
  const [modelLogs, setModelLogs] = useState<ServingLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)

  // Form State
  const [name, setName] = useState('')
  const [modelType, setModelType] = useState('') // YOLOv8, YOLOv11, YOLOv12, RT-DETR, GroundingDino
  const [file, setFile] = useState<File | null>(null)
  const [manualClasses, setManualClasses] = useState('')
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState(false)
  const [registeredClasses, setRegisteredClasses] = useState<string[]>([])

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
    formData.append('file', file)
    if (manualClasses.trim()) {
      formData.append('manual_classes', manualClasses.trim())
    }

    // Set upload progress to 0 to show progress bar
    setUploadProgress(0)

    try {
      // Create XMLHttp Request to support upload progress monitoring
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
            // Reset state
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

  // Parse comma separated values to chips preview
  const classChips = manualClasses
    ? manualClasses.split(',').map(s => s.trim()).filter(Boolean)
    : []

  const formatDateTime = (isoStr: string | null) => {
    if (!isoStr) return 'Never used'
    return new Date(isoStr).toLocaleString()
  }

  return (
    <div className="space-y-5">
      
      {/* ── PAGE HEADER ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">AI Model Registry</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Manage weight file libraries, inspect supported classes, and view serving statistics.</p>
        </div>
        <button
          onClick={() => setIsRegisterOpen(true)}
          className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white px-3 py-1.5 rounded text-xs font-bold transition-colors"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Register Model
        </button>
      </div>

      {/* ── MODELS LIST TABLE ── */}
      <section className="border border-slate-200 dark:border-slate-800/80 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-xs">
        <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          Registered Models Directory — {models.length} Model{models.length !== 1 ? 's' : ''} Loaded
        </div>

        <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-left">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
            <tr>
              <th className="px-3 py-2.5">Model Name</th>
              <th className="px-3 py-2.5">Type</th>
              <th className="px-3 py-2.5">Weights File Path</th>
              <th className="px-3 py-2.5">Detectable Classes</th>
              <th className="px-3 py-2.5">Last Used</th>
              <th className="px-3 py-2.5 text-right w-[180px]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            {models.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-16 text-xs text-slate-400 dark:text-slate-600">
                  No custom models registered yet. Use <strong>Register Model</strong> to upload weights.
                </td>
              </tr>
            ) : (
              models.map(model => {
                const isExpanded = activeLogModelId === model.id
                return (
                  <React.Fragment key={model.id}>
                    <tr className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                      {/* Name */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">{model.name}</div>
                      </td>
                      {/* Type */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="inline-flex rounded-full bg-teal-500/10 text-teal-700 dark:text-teal-400 border border-teal-500/20 px-2 py-0.5 text-[10px] font-bold">
                          {model.model_type}
                        </span>
                      </td>
                      {/* File Path */}
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs font-mono text-slate-500 dark:text-slate-450 truncate max-w-[200px]" title={model.file_path}>
                        {model.file_path}
                      </td>
                      {/* Classes */}
                      <td className="px-3 py-2.5 max-w-[250px]">
                        <div className="flex flex-wrap gap-1 max-h-[44px] overflow-y-auto">
                          {model.classes.length > 0 ? (
                            model.classes.map((cls, idx) => (
                              <span key={idx} className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded px-1.5 py-0.5 text-[9px] font-medium border border-slate-200 dark:border-slate-600">
                                {cls}
                              </span>
                            ))
                          ) : (
                            <span className="text-slate-400 dark:text-slate-600 italic text-[10px]">None registered</span>
                          )}
                        </div>
                      </td>
                      {/* Last Used */}
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-slate-600 dark:text-slate-400">
                        {formatDateTime(model.last_used_timestamp)}
                      </td>
                      {/* Actions */}
                      <td className="px-3 py-2.5 whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
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
                            <div className="px-3 py-1.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                              Model serving execution logs
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
                                      <td className="px-3 py-2 whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                                      <td className="px-3 py-2 font-mono text-teal-700 dark:text-teal-400">{log.camera_id}</td>
                                      <td className="px-3 py-2 truncate max-w-[150px] font-mono" title={log.video_id}>{log.video_id.substring(0, 8)}...</td>
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

      {/* ── REGISTER MODEL MODAL ── */}
      {isRegisterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 shadow-lg animate-in fade-in zoom-in-95 duration-100">
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
                  className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-700 dark:focus:border-teal-400"
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
                  className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-700 dark:focus:border-teal-400"
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
