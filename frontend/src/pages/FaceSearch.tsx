import { useState, useEffect } from 'react'
import { Search, Eye, Upload, Image as ImageIcon, Camera as CameraIcon, Crosshair, Tag, ChevronDown, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'

const API_BASE = typeof window !== 'undefined' ? `http://${window.location.hostname}:8000` : 'http://localhost:8000'

interface Camera {
  camera_id: string
  name: string
}

interface FaceResult {
  face_tracklet_id: string
  video_id: string
  camera_id: string
  camera_name?: string
  timestamp_start_seconds: number
  timestamp_end_seconds: number
  frame_start: number
  best_crop_path: string
  score: number
  label?: string
}

export default function FaceSearch() {
  const [activeTab, setActiveTab] = useState<'text' | 'image' | 'label'>('text')
  const [textQuery, setTextQuery] = useState('')
  const [labelQuery, setLabelQuery] = useState('')
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [results, setResults] = useState<FaceResult[]>([])
  const [searching, setSearching] = useState(false)
  const [cameras, setCameras] = useState<Camera[]>([])
  const [selectedCameras, setSelectedCameras] = useState<string[]>([])
  const [topK, setTopK] = useState(15)
  const [modelConfig, setModelConfig] = useState<any>({ active_model: '', active_embedding_backend: 'clip', available_models: [] })
  const [switchingModel, setSwitchingModel] = useState(false)
  const [uploadingModel, setUploadingModel] = useState(false)
  const [labelingId, setLabelingId] = useState<string | null>(null)
  const [labelInput, setLabelInput] = useState('')
  const [isConfigOpen, setIsConfigOpen] = useState(false)

  useEffect(() => {
    fetchCameras()
    fetchModelConfig()
  }, [])

  const fetchCameras = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/cameras`)
      if (res.ok) setCameras(await res.json())
    } catch (e) {
      console.error(e)
    }
  }

  const fetchModelConfig = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/face-models/config`)
      if (res.ok) setModelConfig(await res.json())
    } catch (e) {
      console.error(e)
    }
  }

  const switchModelBackend = async (type: 'model' | 'backend', val: string) => {
    setSwitchingModel(true)
    try {
      const payload = type === 'model' 
        ? { active_model: val }
        : { active_embedding_backend: val }
      
      const res = await fetch(`${API_BASE}/api/v1/face-models/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (res.ok) {
        await fetchModelConfig()
      }
    } catch (e) {
      console.error(e)
    }
    setSwitchingModel(false)
  }

  const handleModelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return
    setUploadingModel(true)
    const formData = new FormData()
    formData.append('file', e.target.files[0])
    try {
      const res = await fetch(`${API_BASE}/api/v1/face-models/upload`, {
        method: 'POST',
        body: formData
      })
      if (res.ok) {
        await fetchModelConfig()
      }
    } catch (err) {
      console.error(err)
    }
    setUploadingModel(false)
  }

  const handleSearch = async () => {
    setSearching(true)
    setResults([])
    try {
      let url = ''
      let options: RequestInit = {}
      
      if (activeTab === 'text') {
        url = `${API_BASE}/api/v1/face-search/text`
        options = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: textQuery, top_k: topK, camera_ids: selectedCameras.length ? selectedCameras : undefined })
        }
      } else if (activeTab === 'image' && uploadedFile) {
        url = `${API_BASE}/api/v1/face-search/image`
        const formData = new FormData()
        formData.append('file', uploadedFile)
        formData.append('top_k', String(topK))
        if (selectedCameras.length) {
          selectedCameras.forEach(c => formData.append('camera_ids', c))
        }
        options = {
          method: 'POST',
          body: formData
        }
      } else if (activeTab === 'label') {
        url = `${API_BASE}/api/v1/face-search/by-label`
        options = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: labelQuery, top_k: topK })
        }
      } else {
        setSearching(false)
        return
      }

      const res = await fetch(url, options)
      if (res.ok) {
        setResults(await res.json())
      }
    } catch (err) {
      console.error(err)
    }
    setSearching(false)
  }

  const handleLabelFace = async (id: string) => {
    if (!labelInput.trim()) return
    try {
      const res = await fetch(`${API_BASE}/api/v1/face-tracklets/${id}/label`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: labelInput.trim() })
      })
      if (res.ok) {
        setResults(prev => prev.map(r => r.face_tracklet_id === id ? { ...r, label: labelInput.trim() } : r))
        setLabelingId(null)
        setLabelInput('')
      }
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Eye className="h-7 w-7 text-emerald-500" />
            Facial Intelligence &amp; Search
          </h1>
          <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mt-1">
            Cross-camera face tracking, suspect search, and identity tagging
          </p>
        </div>
      </div>

      {/* Model Config Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden shadow-sm">
        <button 
          onClick={() => setIsConfigOpen(!isConfigOpen)}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <div className="flex items-center gap-2 font-bold text-slate-700 dark:text-slate-200">
            <Crosshair className="h-4 w-4 text-emerald-500" />
            Model Configuration
          </div>
          <ChevronDown className={`h-4 w-4 transition-transform ${isConfigOpen ? 'rotate-180' : ''}`} />
        </button>
        
        {isConfigOpen && (
          <div className="p-4 space-y-4 text-sm">
            <div className="flex items-center gap-4">
              <div className="font-bold text-slate-600 dark:text-slate-400 w-32">Active Model:</div>
              <select 
                value={modelConfig.active_model}
                onChange={(e) => switchModelBackend('model', e.target.value)}
                disabled={switchingModel}
                className="px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 min-w-[200px]"
              >
                {modelConfig.available_models?.map((m: string) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              {switchingModel && <RefreshCw className="h-4 w-4 animate-spin text-emerald-500" />}
            </div>

            <div className="flex items-center gap-4">
              <div className="font-bold text-slate-600 dark:text-slate-400 w-32">Embedding Backend:</div>
              <div className="flex gap-2">
                <button
                  onClick={() => switchModelBackend('backend', 'clip')}
                  disabled={switchingModel}
                  className={`px-3 py-1 rounded font-bold transition-colors ${
                    modelConfig.active_embedding_backend === 'clip' 
                      ? 'bg-emerald-600 text-white' 
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >
                  CLIP
                </button>
                <button
                  onClick={() => switchModelBackend('backend', 'facenet')}
                  disabled={switchingModel}
                  className={`px-3 py-1 rounded font-bold transition-colors ${
                    modelConfig.active_embedding_backend === 'facenet' 
                      ? 'bg-emerald-600 text-white' 
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >
                  FaceNet
                </button>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="font-bold text-slate-600 dark:text-slate-400 w-32">Upload Model:</div>
              <label className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded cursor-pointer transition-colors text-slate-700 dark:text-slate-300 font-bold border border-slate-200 dark:border-slate-700">
                <Upload className="h-4 w-4" />
                <span>Choose .pt File</span>
                <input type="file" accept=".pt" className="hidden" onChange={handleModelUpload} disabled={uploadingModel} />
              </label>
              {uploadingModel && <span className="text-xs text-emerald-500 animate-pulse font-bold">Uploading...</span>}
            </div>
          </div>
        )}
      </div>

      {/* Main Search Interface */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden shadow-sm">
        {/* Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-800">
          <button
            onClick={() => setActiveTab('text')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-bold transition-colors ${
              activeTab === 'text' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-b-2 border-emerald-500' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/50'
            }`}
          >
            <Search className="h-4 w-4" />
            Text Search
          </button>
          <button
            onClick={() => setActiveTab('image')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-bold transition-colors ${
              activeTab === 'image' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-b-2 border-emerald-500' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/50'
            }`}
          >
            <ImageIcon className="h-4 w-4" />
            Image Upload
          </button>
          <button
            onClick={() => setActiveTab('label')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-bold transition-colors ${
              activeTab === 'label' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-b-2 border-emerald-500' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/50'
            }`}
          >
            <Tag className="h-4 w-4" />
            Label Search
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-4 space-y-4">
          {activeTab === 'text' && (
            <input
              type="text"
              value={textQuery}
              onChange={e => setTextQuery(e.target.value)}
              placeholder="Describe the face (e.g., man with glasses and beard)..."
              className="w-full px-4 py-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:border-emerald-500 focus:outline-none"
            />
          )}

          {activeTab === 'image' && (
            <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded bg-slate-50 dark:bg-slate-950">
              {previewUrl ? (
                <div className="relative">
                  <img src={previewUrl} alt="Preview" className="max-h-48 rounded" />
                  <button onClick={() => { setUploadedFile(null); setPreviewUrl(null) }} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow">
                    <Crosshair className="h-3 w-3 rotate-45" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center gap-2 cursor-pointer text-slate-500 hover:text-emerald-500 transition-colors">
                  <Upload className="h-8 w-8" />
                  <span className="font-bold">Click to upload face image</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      if (e.target.files?.length) {
                        setUploadedFile(e.target.files[0])
                        setPreviewUrl(URL.createObjectURL(e.target.files[0]))
                      }
                    }}
                  />
                </label>
              )}
            </div>
          )}

          {activeTab === 'label' && (
            <input
              type="text"
              value={labelQuery}
              onChange={e => setLabelQuery(e.target.value)}
              placeholder="Search by existing label/name..."
              className="w-full px-4 py-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:border-emerald-500 focus:outline-none"
            />
          )}

          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-bold text-slate-500 mb-1">Filter by Cameras (Optional)</label>
              <div className="flex flex-wrap gap-2">
                {cameras.map(c => (
                  <button
                    key={c.camera_id}
                    onClick={() => setSelectedCameras(prev => prev.includes(c.camera_id) ? prev.filter(id => id !== c.camera_id) : [...prev, c.camera_id])}
                    className={`px-2 py-1 text-xs font-bold rounded border ${
                      selectedCameras.includes(c.camera_id)
                        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-500'
                        : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
            
            {(activeTab === 'text' || activeTab === 'image') && (
              <div className="w-24">
                <label className="block text-xs font-bold text-slate-500 mb-1">Top-K</label>
                <input
                  type="number"
                  value={topK}
                  onChange={e => setTopK(Number(e.target.value))}
                  min={1}
                  max={100}
                  className="w-full px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            )}

            <button
              onClick={handleSearch}
              disabled={searching || (activeTab === 'text' && !textQuery) || (activeTab === 'image' && !uploadedFile) || (activeTab === 'label' && !labelQuery)}
              className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded flex items-center gap-2 transition-colors"
            >
              {searching ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {results.map((r, idx) => (
            <div key={r.face_tracklet_id + idx} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden flex flex-col group shadow-sm">
              <div className="relative aspect-square bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-2">
                <img
                  src={r.best_crop_path.startsWith('http') ? r.best_crop_path : `${API_BASE}${r.best_crop_path.startsWith('/data/') ? r.best_crop_path : '/' + r.best_crop_path}`}
                  alt="Face crop"
                  className="w-full h-full object-contain rounded"
                />
                {(activeTab === 'text' || activeTab === 'image') && r.score && (
                  <div className="absolute top-2 right-2 bg-emerald-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded shadow">
                    {(r.score * 100).toFixed(0)}%
                  </div>
                )}
                {r.label && (
                  <div className="absolute bottom-2 left-2 bg-emerald-600/90 text-white text-xs font-bold px-2 py-0.5 rounded backdrop-blur-sm border border-emerald-500/50 shadow flex items-center gap-1">
                    <Tag className="h-3 w-3" />
                    {r.label}
                  </div>
                )}
              </div>
              <div className="p-3 space-y-3 flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 font-bold mb-1">
                    <CameraIcon className="h-3.5 w-3.5" />
                    <span className="truncate">{r.camera_name || r.camera_id}</span>
                  </div>
                  <div className="text-xs text-slate-400 font-mono">
                    {new Date(r.timestamp_start_seconds * 1000).toISOString().substr(11, 8)}
                  </div>
                </div>

                <div className="flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  {labelingId === r.face_tracklet_id ? (
                    <div className="flex gap-1 w-full">
                      <input
                        autoFocus
                        type="text"
                        value={labelInput}
                        onChange={e => setLabelInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleLabelFace(r.face_tracklet_id)}
                        className="w-full text-xs px-2 py-1 border border-emerald-500 rounded bg-emerald-50 dark:bg-emerald-900/20 text-slate-800 dark:text-slate-200 outline-none"
                        placeholder="Name..."
                      />
                      <button onClick={() => handleLabelFace(r.face_tracklet_id)} className="bg-emerald-500 text-white px-2 py-1 rounded text-xs font-bold">
                        OK
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => { setLabelingId(r.face_tracklet_id); setLabelInput(r.label || '') }} className="flex-1 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded text-[11px] font-bold transition-colors">
                      Tag Face
                    </button>
                  )}
                  <Link
                    to={`/cameras/${r.camera_id}/videos/${r.video_id}?seek=${r.timestamp_start_seconds}&mode=faces`}
                    className="flex-1 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 rounded text-[11px] font-bold text-center transition-colors border border-emerald-200 dark:border-emerald-800"
                  >
                    Seek Video
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
