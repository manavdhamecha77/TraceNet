import React, { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ExternalLink, MoreVertical, Trash2, RotateCcw, Download, Eye, Play, RefreshCw } from 'lucide-react'
import { useToast } from '../components/Toast'

import { API_BASE } from '../config/api'
import { formatDisplayDate } from '../utils/dateFormatter'

interface Camera {
  camera_id: string
  name: string
  latitude?: number
  longitude?: number
  corridor_group?: string
  adjacency: string[]
  is_active: boolean
  status: string
  altitude?: number
  model_id?: string | null
  video_count: number
}

interface Video {
  id: string
  camera_id: string
  original_filename: string
  standardized_filename: string
  intake_sha256: string
  transcoded_sha256?: string
  upload_timestamp?: string
  processing_status: string
  progress_percentage?: number
  duration?: number
  start_time?: string
  end_time?: string
  thumbnail_path?: string
  is_bin?: boolean
  is_live_recording?: boolean
}

interface DetectionBox {
  tracker_id: number | null
  class_id: number | null
  class_name: string
  object_type: 'person' | 'vehicle' | 'unknown'
  confidence: number
  bbox: number[]
}

interface TrackletSummary {
  tracklet_id: string
  tracker_id: number
  object_type: 'person' | 'vehicle'
  class_name: string
  camera_id: string
  video_id: string
  frame_start: number
  frame_end: number
  timestamp_start_seconds: number
  timestamp_end_seconds: number
  detection_count: number
  mean_confidence: number
  best_bbox: number[]
  best_crop_path?: string | null
}

interface DetectionRunResponse {
  video_id: string
  camera_id: string
  model_path: string
  video_path: string
  frame_count: number
  fps: number
  frame_detections: Array<{
    frame_index: number
    timestamp_seconds: number
    detections: DetectionBox[]
  }>
  tracklets: TrackletSummary[]
  artifact_path: string
}

function truncateMiddle(str: string, maxLength: number = 28): string {
  if (!str || str.length <= maxLength) return str
  const sep = '...'
  const charsToShow = maxLength - sep.length
  const frontChars = Math.ceil(charsToShow / 2)
  const backChars = Math.floor(charsToShow / 2)
  return str.substring(0, frontChars) + sep + str.substring(str.length - backChars)
}

interface CameraDetailProps {
  onOpenUploadModal: () => void
  onPlayVideo: (video: Video) => void
  onInspectTracklet: (tracklet: TrackletSummary, video: Video) => void
  cameraVideos: Video[]
  setCameraVideos: React.Dispatch<React.SetStateAction<Video[]>>
  selectedCamera: Camera | null
  setSelectedCamera: (camera: Camera | null) => void
  models?: any[]
}

export default function CameraDetail({
  onOpenUploadModal,
  onPlayVideo,
  onInspectTracklet,
  cameraVideos,
  setCameraVideos,
  selectedCamera,
  setSelectedCamera,
  models,
}: CameraDetailProps) {
  const toast = useToast()
  const { camera_id } = useParams<{ camera_id: string }>()
  const [activeTab, setActiveTab] = useState<'original' | 'system' | 'bin'>('system')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncingModel, setSyncingModel] = useState(false)
  const [syncSuccessMsg, setSyncSuccessMsg] = useState('')
  const [detectionLoadingId, setDetectionLoadingId] = useState<string | null>(null)
  const [detectionModal, setDetectionModal] = useState<{
    video: Video
    result: DetectionRunResponse | null
    error: string
    loading: boolean
  } | null>(null)
  
  // Video dropdown and delete confirmation states
  const [activeVideoMenuId, setActiveVideoMenuId] = useState<string | null>(null)
  const [videoMenuPos, setVideoMenuPos] = useState<{ top: number; right: number } | null>(null)
  const [deleteConfirmVideo, setDeleteConfirmVideo] = useState<Video | null>(null)
  const [deleteAgreeCheckbox, setDeleteAgreeCheckbox] = useState(false)
  const [deletingProgress, setDeletingProgress] = useState(false)

  // Tracklet Filters & Sorting
  const [detectionFilterType, setDetectionFilterType] = useState<string>('all')
  const [detectionFilterClass, setDetectionFilterClass] = useState<string>('all')
  const [detectionSortOrder, setDetectionSortOrder] = useState<'desc' | 'asc'>('desc')
  
  // Model selection & Sync dropdown states
  const [tempModel, setTempModel] = useState<any>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (selectedCamera) {
      const assigned = models?.find(m => m.id === selectedCamera.model_id)
      setTempModel(assigned || { id: '', name: 'YOLOv8 Default' })
    }
  }, [selectedCamera, models])

  const pollTimerRef = useRef<any>(null)

  useEffect(() => {
    const handleOutsideClick = () => {
      setActiveVideoMenuId(null)
      setVideoMenuPos(null)
    }
    const handleDropdownOutsideClick = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }
    window.addEventListener('click', handleOutsideClick)
    document.addEventListener('mousedown', handleDropdownOutsideClick)
    return () => {
      window.removeEventListener('click', handleOutsideClick)
      document.removeEventListener('mousedown', handleDropdownOutsideClick)
    }
  }, [])

  // Fetch Camera Details
  const fetchCameraDetails = async () => {
    if (!camera_id) return
    try {
      const res = await fetch(`${API_BASE}/api/v1/cameras/${camera_id}`)
      if (res.status === 200) {
        const data = await res.json()
        setSelectedCamera(data)
      } else {
        setError(`Camera node '${camera_id}' not found.`)
      }
    } catch (err) {
      setError('Connection failure: could not retrieve camera details.')
    }
  }

  // Fetch Videos list
  const fetchVideos = async () => {
    if (!camera_id) return
    try {
      const res = await fetch(`${API_BASE}/api/v1/cameras/${camera_id}/videos`)
      if (res.ok) {
        const data = await res.json()
        setCameraVideos(data)
      }
    } catch (err) {
      console.error('Failed to fetch videos:', err)
    } finally {
      setLoading(false)
    }
  }

  // Load initial data
  useEffect(() => {
    setLoading(true)
    setError('')
    fetchCameraDetails()
    fetchVideos()
    
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
      setSelectedCamera(null)
    }
  }, [camera_id])

  // Polling for processing videos
  useEffect(() => {
    const hasIncomplete = cameraVideos.some(
      (v) => v.processing_status !== 'complete' && v.processing_status !== 'failed'
    )

    if (hasIncomplete && camera_id) {
      pollTimerRef.current = setInterval(() => {
        fetchVideos()
      }, 3000)
    } else {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [cameraVideos.map((v) => `${v.processing_status}:${v.progress_percentage}`).join(','), camera_id])

  const formatDuration = (secs?: number) => {
    if (!secs || secs <= 0) return '--:--'
    const minutes = Math.floor(secs / 60)
    const seconds = Math.floor(secs % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const formatDateTime = (isoStr?: string) => {
    if (!isoStr) return 'N/A'
    return formatDisplayDate(isoStr)
  }

  const getThumbnailUrl = (video: Video) => {
    if (video.thumbnail_path) {
      const relativePath = video.thumbnail_path.replace(/^\.?\/?data\//, '')
      return `${API_BASE}/data/${relativePath}`
    }
    return ''
  }

  const getProcessedAssetUrl = (assetPath?: string | null) => {
    if (!assetPath) return ''
    const normalized = assetPath.replace(/\\/g, '/')
    const backendDataIndex = normalized.indexOf('/backend/data/')
    if (backendDataIndex !== -1) {
      return `${API_BASE}${normalized.slice(backendDataIndex + '/backend'.length)}`
    }
    const dataIndex = normalized.indexOf('/data/')
    if (dataIndex !== -1) {
      return `${API_BASE}${normalized.slice(dataIndex)}`
    }
    return ''
  }

  const handleMoveToBin = async (videoId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/videos/${videoId}/bin`, { method: 'PUT' })
      if (res.ok) {
        setCameraVideos(prev => prev.map(v => v.id === videoId ? { ...v, is_bin: true } : v))
        toast.info('Archived', 'Video moved to archive bin.')
      } else {
        toast.error('Error', 'Failed to move video to bin.')
      }
    } catch (_) {
      toast.error('Network Error', 'Failed to move video to bin.')
    }
  }

  const handleRestoreVideo = async (videoId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/videos/${videoId}/restore`, { method: 'PUT' })
      if (res.ok) {
        setCameraVideos(prev => prev.map(v => v.id === videoId ? { ...v, is_bin: false } : v))
        toast.success('Restored', 'Video restored to operational view.')
      } else {
        toast.error('Error', 'Failed to restore video.')
      }
    } catch (_) {
      toast.error('Network Error', 'Failed to restore video.')
    }
  }

  const handleDeleteVideoPermanently = async (videoId: string) => {
    setDeletingProgress(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/videos/${videoId}/delete`, { method: 'DELETE' })
      if (res.ok) {
        setCameraVideos(prev => prev.filter(v => v.id !== videoId))
        setDeleteConfirmVideo(null)
        setDeleteAgreeCheckbox(false)
        toast.success('Deleted', 'Video asset deleted permanently.')
      } else {
        const errData = await res.json().catch(() => ({}))
        toast.error('Deletion Failed', errData.detail || 'Server error')
      }
    } catch (_) {
      toast.error('Network Error', 'Error deleting video segment.')
    } finally {
      setDeletingProgress(false)
    }
  }

  const downloadSHAReport = async (video: Video) => {
    const reportHeader = `========================================================================\n` +
                         `               TRACENET EVIDENCE CUSTODY COMPLIANCE REPORT              \n` +
                         `========================================================================\n` +
                         `Report Generated At: ${formatDisplayDate(new Date().toISOString())}\n` +
                         `Video Asset UUID   : ${video.id}\n` +
                         `Original Filename  : ${video.original_filename}\n` +
                         `Standardized MP4   : ${video.standardized_filename}\n` +
                         `Intake SHA-256 Hash: ${video.intake_sha256}\n` +
                         `Processed SHA-256  : ${video.transcoded_sha256 || 'Not Transcoded'}\n` +
                         `Current Status     : ${video.processing_status.toUpperCase()}\n` +
                         `========================================================================\n`
    try {
      const msgBuffer = new TextEncoder().encode(reportHeader)
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
      
      const blob = new Blob([reportHeader + `\nVerification SHA-256 compliance hash: ${hashHex}\n`], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `evidence_sha_report_${video.id}.txt`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('Report Exported', 'Evidence compliance report downloaded.')
    } catch (_) {
      toast.error('Hashing Error', 'Forensic hashing failed.')
    }
  }

  const openDetections = async (video: Video) => {
    setDetectionLoadingId(video.id)
    setDetectionModal({ video, result: null, error: '', loading: true })
    try {
      const res = await fetch(`${API_BASE}/api/v1/videos/${video.id}/detections`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Detection results are not available yet.')
      }
      const result = (await res.json()) as DetectionRunResponse
      setDetectionModal({ video, result, error: '', loading: false })
    } catch (err) {
      setDetectionModal({
        video,
        result: null,
        error: err instanceof Error ? err.message : 'Failed to fetch detection results.',
        loading: false,
      })
    } finally {
      setDetectionLoadingId(null)
    }
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 p-6 rounded-md text-center max-w-lg mx-auto mt-12 animate-in fade-in duration-200">
        <svg className="mx-auto h-10 w-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <h3 className="mt-4 text-sm font-semibold text-slate-800 dark:text-slate-200">Camera Profile Error</h3>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{error}</p>
        <Link
          to="/cameras"
          className="mt-6 inline-flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 px-4 py-2 rounded-md text-xs font-semibold transition-colors"
        >
          Return to Camera List
        </Link>
      </div>
    )
  }

  if (loading && !selectedCamera) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <svg className="animate-spin h-8 w-8 text-teal-700 dark:text-teal-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Resolving camera topography...</span>
      </div>
    )
  }

  const assignedModel = models?.find(m => m.id === selectedCamera?.model_id)
  const assignedModelName = assignedModel ? assignedModel.name : (selectedCamera?.model_id || 'YOLOv8 Default')
  const tempModelName = tempModel ? tempModel.name : assignedModelName

  const handleSyncModel = async () => {
    if (!camera_id) return
    const modelNameToSync = tempModelName
    setSyncingModel(true)
    setSyncSuccessMsg('')
    try {
      // 1. If tempModel.id is different from camera's current model_id, update camera first in the database
      const currentCameraModelId = selectedCamera?.model_id || ''
      const targetModelId = tempModel?.id || ''
      if (targetModelId !== currentCameraModelId) {
        const updateRes = await fetch(`${API_BASE}/api/v1/cameras/${camera_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model_id: targetModelId })
        })
        if (!updateRes.ok) {
          toast.error('Sync Error', "Failed to update camera's assigned model before sync.")
          setSyncingModel(false)
          return
        }
        // Refresh the selected camera details so the UI updates
        await fetchCameraDetails()
      }

      // 2. Trigger detection sync
      const res = await fetch(`${API_BASE}/api/v1/cameras/${camera_id}/sync-detection`, { method: 'POST' })
      if (res.ok) {
        toast.success('Sync Initiated', `Detection sync started with model '${modelNameToSync}'.`)
        setSyncSuccessMsg(`Detection sync initiated with model '${modelNameToSync}'. Videos are re-indexing in background.`)
        setTimeout(() => setSyncSuccessMsg(''), 6000)
      } else {
        toast.error('Sync Failed', 'Failed to trigger detection sync.')
      }
    } catch {
      toast.error('Network Error', 'Network error while triggering detection sync.')
    } finally {
      setSyncingModel(false)
    }
  }

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-200">
      
      {/* CAMERA BANNER META */}
      {selectedCamera && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-4 rounded-md shadow-sm">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold text-teal-700 dark:text-teal-400">
                {selectedCamera.camera_id}
              </span>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{selectedCamera.name}</h3>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap gap-4">
              <span>Latitude: <strong className="text-slate-700 dark:text-slate-300">{selectedCamera.latitude ?? 'N/A'}</strong></span>
              <span>Longitude: <strong className="text-slate-700 dark:text-slate-300">{selectedCamera.longitude ?? 'N/A'}</strong></span>
              <span>Corridor: <strong className="text-slate-700 dark:text-slate-300">{selectedCamera.corridor_group ?? 'General'}</strong></span>
              <span>Topology Neighbors: <strong className="text-slate-700 dark:text-slate-300">{selectedCamera.adjacency.length > 0 ? selectedCamera.adjacency.join(', ') : 'None'}</strong></span>
              <span>Model: <strong className="text-teal-700 dark:text-teal-400 font-semibold">{assignedModelName}</strong></span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Split Sync Button */}
            <div className="relative flex items-stretch rounded-md shadow-sm">
              <button
                disabled={syncingModel}
                onClick={handleSyncModel}
                className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 border-r-0 px-3 py-1.5 rounded-l-md text-xs font-bold transition-colors disabled:opacity-50"
                title={`Sync video detections using ${tempModelName}`}
              >
                <RefreshCw className={`h-3.5 w-3.5 text-teal-600 dark:text-teal-400 ${syncingModel ? 'animate-spin' : ''}`} />
                <span>{syncingModel ? 'Syncing...' : `Sync Detections (${tempModelName})`}</span>
              </button>
              
              <button
                disabled={syncingModel}
                onClick={(e) => {
                  e.stopPropagation()
                  setShowDropdown(prev => !prev)
                }}
                className="flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 px-2 py-1.5 rounded-r-md transition-colors disabled:opacity-50 border-l border-slate-300 dark:border-slate-600"
                title="Choose another model"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Models Dropdown */}
              {showDropdown && (() => {
                const defaultModelObj = { id: '', name: 'YOLOv8 Default' }
                const allModelsList = [defaultModelObj, ...(models || [])]
                const filteredModelsList = allModelsList.filter(m => 
                  m.name.toLowerCase().includes(searchQuery.toLowerCase())
                )

                return (
                  <div
                    ref={dropdownRef}
                    className="absolute right-0 mt-9 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md shadow-lg z-50 overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="p-2 border-b border-slate-100 dark:border-slate-805 bg-slate-50 dark:bg-slate-950">
                      <input
                        type="text"
                        placeholder="Search models..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md outline-none text-slate-800 dark:text-slate-100 focus:border-teal-500 transition-colors"
                        autoFocus
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto py-1">
                      {filteredModelsList.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-slate-450 dark:text-slate-500 text-center">
                          No models found
                        </div>
                      ) : (
                        filteredModelsList.map((m) => {
                          const isSelected = tempModel?.id === m.id
                          return (
                            <button
                              key={m.id || 'default'}
                              type="button"
                              onClick={() => {
                                setTempModel(m)
                                setShowDropdown(false)
                              }}
                              className={`w-full text-left px-3.5 py-2 text-xs transition-colors hover:bg-slate-100 dark:hover:bg-slate-850 flex items-center justify-between ${
                                isSelected
                                  ? 'bg-teal-50 dark:bg-teal-950/20 text-teal-700 dark:text-teal-400 font-bold'
                                  : 'text-slate-700 dark:text-slate-200'
                              }`}
                            >
                              <span className="truncate">{m.name}</span>
                              {isSelected && (
                                <svg className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </button>
                          )
                        })
                      )}
                    </div>
                  </div>
                )
              })()}
            </div>
            <button
              onClick={onOpenUploadModal}
              className="flex items-center gap-2 bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-750 text-white px-3.5 py-1.5 rounded-md text-xs font-bold transition-colors shadow-sm"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Upload Video Feed
            </button>
          </div>
        </div>
      )}

      {syncSuccessMsg && (
        <div className="p-3 rounded-md bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300 text-xs font-semibold flex items-center justify-between animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-teal-600 dark:text-teal-400 animate-spin" />
            <span>{syncSuccessMsg}</span>
          </div>
          <button onClick={() => setSyncSuccessMsg('')} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-bold">✕</button>
        </div>
      )}

      {/* DUAL FILTERS & TABS */}
      <div className="border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-transparent px-2 rounded-t-md">
        <div className="flex gap-4">
          {/* System tab first — this is the primary working view */}
          <button
            onClick={() => setActiveTab('system')}
            className={`py-2.5 text-xs font-bold border-b-2 transition-all ${
              activeTab === 'system'
                ? 'border-teal-700 dark:border-teal-400 text-teal-700 dark:text-teal-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
            }`}
          >
            System Preprocessing
          </button>
          {/* Original tab second — read-only audit/backup view */}
          <button
            onClick={() => setActiveTab('original')}
            className={`py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'original'
                ? 'border-teal-700 dark:border-teal-400 text-teal-700 dark:text-teal-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
            }`}
          >
            Original Audit
            <span className="text-[9px] font-bold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider">
              Backup
            </span>
          </button>
          {/* Bin tab third */}
          <button
            onClick={() => setActiveTab('bin')}
            className={`py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'bin'
                ? 'border-rose-700 dark:border-rose-400 text-rose-700 dark:text-rose-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
            }`}
          >
            Bin
            <span className="text-[9px] font-bold bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider">
              Trash
            </span>
          </button>
        </div>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          Showing {cameraVideos.filter(v => activeTab === 'bin' ? v.is_bin : !v.is_bin).length} segments
        </span>
      </div>

      {/* DATA GRID */}
      <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-left">
            <thead className="bg-slate-50 dark:bg-slate-800 text-[11px] text-slate-500 dark:text-slate-400 uppercase font-semibold">
              <tr>
                <th className="px-4 py-3 w-24">Thumbnail</th>
                <th className="px-4 py-3">Filename / Unique Hash</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Timeline Interval</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Pipeline Log</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {cameraVideos.filter(v => activeTab === 'bin' ? v.is_bin : !v.is_bin).length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-400 dark:text-slate-500 font-medium">
                    {activeTab === 'bin' ? 'No video segments in Bin.' : 'No files uploaded. Feed ingestion sandbox is ready.'}
                  </td>
                </tr>
              ) : (
                cameraVideos.filter(v => activeTab === 'bin' ? v.is_bin : !v.is_bin).map((video) => {
                  const thumbUrl = getThumbnailUrl(video)
                  return (
                    <tr
                      key={video.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors odd:bg-white dark:odd:bg-transparent even:bg-slate-50/30 dark:even:bg-slate-800/5"
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="h-10 w-16 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded flex items-center justify-center relative overflow-hidden">
                          {thumbUrl ? (
                            <img src={thumbUrl} alt="Video thumbnail preview" className="h-full w-full object-cover" />
                          ) : (
                            <svg className="h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          )}
                          {!['complete', 'failed', 'preprocessed'].includes(video.processing_status) && (
                            <span className="absolute inset-0 bg-teal-500/10 backdrop-blur-[1px] flex items-center justify-center">
                              <svg className="animate-spin h-4 w-4 text-teal-700 dark:text-teal-400" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <div 
                          className="font-bold text-slate-800 dark:text-slate-100 cursor-help flex items-center"
                          title={activeTab === 'original' ? video.original_filename : video.standardized_filename}
                        >
                          {video.is_live_recording && (
                            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse inline-block mr-1.5 shrink-0" title="Live Stream Recorded Segment" />
                          )}
                          {truncateMiddle(activeTab === 'original' ? video.original_filename : video.standardized_filename)}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5 truncate max-w-[240px]" title={activeTab === 'original' ? video.intake_sha256 : video.transcoded_sha256}>
                          Hash: {activeTab === 'original' ? video.intake_sha256.substring(0, 24) + '...' : video.transcoded_sha256 ? video.transcoded_sha256.substring(0, 24) + '...' : 'pending...'}
                        </div>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap text-slate-700 dark:text-slate-300 font-semibold">
                        {['preprocessed', 'indexing', 'complete'].includes(video.processing_status) ? formatDuration(video.duration) : '--:--'}
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap text-[11px] text-slate-600 dark:text-slate-350">
                        <div>Start: {formatDateTime(video.start_time || video.upload_timestamp)}</div>
                        <div className="mt-0.5 text-slate-500">End: {formatDateTime(video.end_time || video.upload_timestamp)}</div>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            video.processing_status === 'complete' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' :
                            video.processing_status === 'failed' ? 'bg-red-500/10 text-red-700 dark:text-red-400' :
                            ['transcoding', 'indexing'].includes(video.processing_status) ? 'bg-teal-500/10 text-teal-700 dark:text-teal-400 animate-pulse' :
                            video.processing_status === 'preprocessed' ? 'bg-sky-500/10 text-sky-700 dark:text-sky-400' :
                            'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                          }`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${
                              video.processing_status === 'complete' ? 'bg-emerald-500' :
                              video.processing_status === 'failed' ? 'bg-red-500' :
                              ['transcoding', 'indexing'].includes(video.processing_status) ? 'bg-teal-500' :
                              video.processing_status === 'preprocessed' ? 'bg-sky-500' :
                              'bg-amber-500'
                            }`}></span>
                            {video.processing_status.toUpperCase()}
                          </span>

                          {video.processing_status !== 'complete' && video.processing_status !== 'failed' && (
                            <div className="mt-1 w-24">
                              <div className="flex items-center justify-between text-[8px] text-slate-500 dark:text-slate-400 mb-0.5 font-bold">
                                <span>PROGRESS</span>
                                <span>{video.progress_percentage ?? 0}%</span>
                              </div>
                              <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1 overflow-hidden">
                                <div 
                                  className="bg-teal-600 dark:bg-teal-400 h-1 rounded-full transition-all duration-300"
                                  style={{ width: `${video.progress_percentage ?? 0}%` }}
                                ></div>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3 text-[11px] text-slate-500 dark:text-slate-400 max-w-[180px] truncate">
                        {activeTab === 'original' ? (
                          <span>File hash verified. Local object store storage.</span>
                        ) : (
                          <span>Transcoded H.264 720p10. Chrono 4 FPS.</span>
                        )}
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            disabled={video.processing_status !== 'complete' || detectionLoadingId === video.id || activeTab === 'bin'}
                            onClick={() => openDetections(video)}
                            className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-bold transition-all ${
                              video.processing_status === 'complete' && activeTab !== 'bin'
                                ? 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-200 dark:border-slate-700'
                            }`}
                          >
                            {detectionLoadingId === video.id ? (
                              <span className="animate-spin h-3.5 w-3.5 border-2 border-teal-500 border-t-transparent rounded-full" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                            <span>Detections</span>
                          </button>
                          <button
                            disabled={!['preprocessed', 'indexing', 'complete'].includes(video.processing_status)}
                            onClick={() => onPlayVideo(video)}
                            className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-bold transition-all ${
                              ['preprocessed', 'indexing', 'complete'].includes(video.processing_status)
                                ? 'bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700 text-white shadow-sm'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-200 dark:border-slate-700'
                            }`}
                          >
                            <Play className="h-3.5 w-3.5 fill-current" />
                            <span>View</span>
                          </button>
                          
                          {/* 3-dot Options Menu */}
                          <div className="relative">
                            <button
                              title="More options"
                              onClick={(e) => {
                                e.stopPropagation()
                                if (activeVideoMenuId === video.id) {
                                  setActiveVideoMenuId(null)
                                  setVideoMenuPos(null)
                                } else {
                                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                  setVideoMenuPos({
                                    top: rect.bottom + window.scrollY + 6,
                                    right: window.innerWidth - rect.right
                                  })
                                  setActiveVideoMenuId(video.id)
                                }
                              }}
                              className="flex items-center justify-center w-7 h-7 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detectionModal && (
        <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-md shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Detections for {detectionModal.video.original_filename}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {detectionModal.loading
                  ? 'Loading tracklets...'
                  : detectionModal.error
                    ? detectionModal.error
                    : `${detectionModal.result?.tracklets.length ?? 0} tracklets confirmed`}
              </p>
            </div>
            <button
              onClick={() => setDetectionModal(null)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white"
            >
              Close
            </button>
          </div>

          <div className="flex flex-col gap-0">
            {/* Top stats block */}
            <div className="p-4 bg-slate-50/50 dark:bg-slate-900/20 border-b border-slate-200 dark:border-slate-800">
              {detectionModal.loading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-4 justify-center">
                  <svg className="h-5 w-5 animate-spin text-teal-600 dark:text-teal-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Inspecting detections & coordinates...</span>
                </div>
              ) : detectionModal.error ? (
                <div className="rounded border border-amber-250 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300 p-3 text-xs">
                  {detectionModal.error}
                </div>
              ) : detectionModal.result ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900 shadow-xs">
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-extrabold">Frames</div>
                    <div className="text-lg font-black text-slate-800 dark:text-slate-100 mt-0.5">{detectionModal.result.frame_count}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900 shadow-xs">
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-extrabold">Tracklets</div>
                    <div className="text-lg font-black text-slate-800 dark:text-slate-100 mt-0.5">{detectionModal.result.tracklets.length}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900 shadow-xs">
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-extrabold">Processed FPS</div>
                    <div className="text-lg font-black text-slate-800 dark:text-slate-100 mt-0.5">{detectionModal.result.fps.toFixed(1)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900 shadow-xs">
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-extrabold">Object Types</div>
                    <div className="text-sm font-extrabold text-slate-700 dark:text-slate-300 mt-1 capitalize truncate" title={Array.from(new Set(detectionModal.result.tracklets.map((t) => t.object_type))).join(', ')}>
                      {Array.from(new Set(detectionModal.result.tracklets.map((t) => t.object_type))).join(', ') || 'None'}
                    </div>
                  </div>
                  
                  {/* Model Details & Artifact info (takes 2 columns) */}
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900 shadow-xs sm:col-span-2 lg:col-span-2 flex flex-col justify-center gap-1">
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-extrabold">Model & Artifact Files</div>
                    <div className="text-[10px] text-slate-600 dark:text-slate-350 truncate">
                      <span className="font-semibold text-teal-600 dark:text-teal-400">Model:</span> <span className="font-mono">{detectionModal.result.model_path}</span>
                    </div>
                    <div className="text-[10px] text-slate-600 dark:text-slate-350 truncate">
                      <span className="font-semibold text-teal-600 dark:text-teal-400">Index:</span> <span className="font-mono">{detectionModal.result.artifact_path}</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Bottom Gallery Grid */}
            <div className="p-4 space-y-4 bg-slate-50 dark:bg-slate-900/40">
              {detectionModal.result && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-700">
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Tracklet Gallery & Index Scrubber</h4>
                  </div>
                  
                  {/* Dynamic Filters Row */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Object Type Switcher */}
                    <div className="flex rounded bg-slate-200 dark:bg-slate-800 p-0.5 text-[9px] font-semibold">
                      <button
                        onClick={() => setDetectionFilterType('all')}
                        className={`rounded px-1.5 py-0.5 transition-all ${
                          detectionFilterType === 'all'
                            ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                      >
                        All
                      </button>
                      <button
                        onClick={() => setDetectionFilterType('person')}
                        className={`rounded px-1.5 py-0.5 transition-all ${
                          detectionFilterType === 'person'
                            ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                      >
                        People
                      </button>
                      <button
                        onClick={() => setDetectionFilterType('vehicle')}
                        className={`rounded px-1.5 py-0.5 transition-all ${
                          detectionFilterType === 'vehicle'
                            ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                      >
                        Vehicles
                      </button>
                    </div>

                    {/* Class Dropdown */}
                    <select
                      value={detectionFilterClass}
                      onChange={(e) => setDetectionFilterClass(e.target.value)}
                      className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-0.5 text-[9px] font-medium text-slate-600 dark:text-slate-300 outline-none focus:border-teal-500"
                    >
                      <option value="all">All Classes</option>
                      {Array.from(
                        new Set(
                          detectionModal.result.tracklets
                            .map((t) => t.class_name)
                            .filter(Boolean)
                        )
                      ).map((clsName) => (
                        <option key={clsName} value={clsName}>
                          {clsName.charAt(0).toUpperCase() + clsName.slice(1)}
                        </option>
                      ))}
                    </select>

                    {/* Confidence Sorter */}
                    <button
                      onClick={() => setDetectionSortOrder((p) => (p === 'desc' ? 'asc' : 'desc'))}
                      className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-0.5 text-[9px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                      title="Sort by Confidence"
                    >
                      <span>Conf:</span>
                      <span className="font-bold text-teal-600 dark:text-teal-400">
                        {detectionSortOrder === 'desc' ? '▲ High' : '▼ Low'}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* Detections Gallery Grid - FULL WIDTH */}
              <div className="max-h-[500px] overflow-y-auto pr-1">
                {detectionModal.result && detectionModal.result.tracklets.length > 0 ? (
                  (() => {
                    const filtered = detectionModal.result.tracklets
                      .filter((t) => {
                        const typeMatch = detectionFilterType === 'all' || t.object_type === detectionFilterType
                        const classMatch =
                          detectionFilterClass === 'all' || t.class_name.toLowerCase() === detectionFilterClass.toLowerCase()
                        return typeMatch && classMatch
                      })
                      .sort((a, b) => {
                        return detectionSortOrder === 'desc'
                          ? b.mean_confidence - a.mean_confidence
                          : a.mean_confidence - b.mean_confidence
                      })

                    if (filtered.length === 0) {
                      return (
                        <div className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                          No tracklets match the selected filters.
                        </div>
                      )
                    }

                    return (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 py-2">
                        {filtered.map((tracklet) => {
                          const cropUrl = getProcessedAssetUrl(tracklet.best_crop_path)
                          const conf = tracklet.mean_confidence * 100
                          const confColor =
                            conf >= 80
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20'
                              : conf >= 60
                              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20'
                              : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20'

                          return (
                            <div
                              key={tracklet.tracklet_id}
                              onClick={() => onInspectTracklet(tracklet, detectionModal.video)}
                              className="group flex flex-col rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shadow-sm hover:shadow-lg transition-all duration-200 hover:border-teal-400 dark:hover:border-teal-500 hover:-translate-y-0.5 cursor-pointer ring-0 hover:ring-2 hover:ring-teal-400/30 active:scale-[0.98]"
                            >
                              {/* Card Crop Header */}
                              <div className="relative w-full h-24 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 overflow-hidden shrink-0">
                                {cropUrl ? (
                                  <img
                                    src={cropUrl}
                                    alt={tracklet.tracklet_id}
                                    className="w-full h-full object-contain bg-slate-200/50 dark:bg-slate-800/50 transition-transform duration-300 group-hover:scale-102"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-[9px] text-slate-400">
                                    No Crop
                                  </div>
                                )}
                                {/* Confidence Badge overlay */}
                                <div className="absolute top-1.5 right-1.5">
                                  <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[8px] font-bold ${confColor}`}>
                                    {conf.toFixed(0)}%
                                  </span>
                                </div>
                                {/* Tracker ID overlay */}
                                <div className="absolute bottom-1.5 left-1.5">
                                  <span className="inline-flex rounded bg-slate-900/70 backdrop-blur-sm px-1 py-0.5 text-[8px] font-mono text-white">
                                    ID: {tracklet.tracker_id}
                                  </span>
                                </div>
                              </div>

                              {/* Card Info Details */}
                              <div className="p-2 space-y-1 flex-1 flex flex-col justify-between">
                                <div className="space-y-0.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[10px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wide truncate">
                                      {tracklet.class_name}
                                    </span>
                                    <span className="text-[8px] font-semibold text-slate-400 dark:text-slate-500 uppercase shrink-0">
                                      {tracklet.object_type}
                                    </span>
                                  </div>
                                  <div className="text-[9px] text-slate-500 dark:text-slate-400">
                                    Frames:{' '}
                                    <span className="font-mono text-slate-700 dark:text-slate-300">
                                      {tracklet.frame_start} - {tracklet.frame_end}
                                    </span>
                                  </div>
                                </div>

                                <div className="pt-1.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[8px]">
                                   <button
                                     onClick={(e) => {
                                       e.stopPropagation()
                                       onInspectTracklet(tracklet, detectionModal.video)
                                     }}
                                     className="text-teal-500 dark:text-teal-400 font-semibold hover:underline flex items-center gap-0.5"
                                   >
                                     Inspect <ExternalLink className="h-2.5 w-2.5 inline" />
                                   </button>

                                   <button
                                     onClick={async (e) => {
                                       e.stopPropagation()
                                       try {
                                         const res = await fetch(`${API_BASE}/api/v1/multicam/targets/tag`, {
                                           method: 'POST',
                                           headers: { 'Content-Type': 'application/json' },
                                           body: JSON.stringify({
                                             label: `Suspect ${tracklet.class_name || 'Target'} #${tracklet.tracker_id} (${camera_id})`,
                                             origin_camera_id: camera_id || 'CAM_001',
                                             origin_tracklet_id: tracklet.tracklet_id,
                                             priority: 'HIGH'
                                           })
                                         })
                                         if (res.ok) {
                                           const data = await res.json()
                                           toast.success('Hot Target Tagged', data.message || 'Target pinned for multi-camera pursuit.')
                                         }
                                       } catch (err) {
                                         console.error("Failed to tag target:", err)
                                       }
                                     }}
                                     className="flex items-center gap-0.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 px-1 py-0.5 rounded text-[8px] font-bold transition-all"
                                     title="Tag as Hot Target for Multi-Camera Persistent Pursuit"
                                   >
                                     <span>🎯 Tag &amp; Pursue</span>
                                   </button>
                                 </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()
                ) : (
                  <div className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 text-xs text-slate-500 dark:text-slate-400">
                    Open a completed video and click Detections to review tracklets.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIDEO ROW DROPDOWN MENU */}
      {activeVideoMenuId && videoMenuPos && (() => {
        const video = cameraVideos.find(v => v.id === activeVideoMenuId)
        if (!video) return null
        
        return (
          <div
            style={{
              position: 'absolute',
              top: videoMenuPos.top,
              right: videoMenuPos.right,
              zIndex: 200
            }}
            className="w-48 rounded-md bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 shadow-xl py-1"
            onClick={(e) => e.stopPropagation()}
          >
            {activeTab !== 'bin' ? (
              <>
                <Link
                  to={`/cameras/${camera_id}/videos/${video.id}`}
                  onClick={() => { setActiveVideoMenuId(null); setVideoMenuPos(null) }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Open Full Workspace</span>
                </Link>
                <button
                  onClick={() => { onPlayVideo(video); setActiveVideoMenuId(null); setVideoMenuPos(null) }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>View Details</span>
                </button>
                <a
                  href={`${API_BASE}/data/cameras/${camera_id}_${sanitize_filename(selectedCamera?.name || '')}/original_assets/${video.standardized_filename}`}
                  download
                  onClick={() => { setActiveVideoMenuId(null); setVideoMenuPos(null) }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download Video</span>
                </a>
                <button
                  onClick={() => { downloadSHAReport(video); setActiveVideoMenuId(null); setVideoMenuPos(null) }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download SHA Report</span>
                </button>
                <div className="border-t border-slate-100 dark:border-slate-850 my-1" />
                <button
                  onClick={() => { handleMoveToBin(video.id); setActiveVideoMenuId(null); setVideoMenuPos(null) }}
                  className="w-full text-left px-3 py-1.5 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 font-bold"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Move to Bin</span>
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => { handleRestoreVideo(video.id); setActiveVideoMenuId(null); setVideoMenuPos(null) }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Restore</span>
                </button>
                <button
                  onClick={() => { setDeleteConfirmVideo(video); setActiveVideoMenuId(null); setVideoMenuPos(null) }}
                  className="w-full text-left px-3 py-1.5 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 font-bold"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Permanently Delete</span>
                </button>
              </>
            )}
          </div>
        )
      })()}

      {/* PERMANENTLY DELETE CONFIRM MODAL */}
      {deleteConfirmVideo && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-4 backdrop-blur-[3px]">
          <div className="w-full max-w-md rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 mb-4">
              <Trash2 className="h-6 w-6 animate-pulse" />
              <h3 className="text-base font-bold">Critical Forensic Warning</h3>
            </div>
            
            <p className="text-xs text-slate-600 dark:text-slate-350 leading-relaxed mb-4">
              You are about to permanently destroy <strong className="text-slate-800 dark:text-white font-bold">{deleteConfirmVideo.original_filename}</strong>. 
              This action is <span className="underline decoration-rose-500 font-bold decoration-2">completely irreversible</span>.
            </p>
            
            <div className="rounded border border-rose-500/20 bg-rose-500/5 p-3 text-[11px] text-rose-700 dark:text-rose-400 space-y-1 mb-5">
              <span className="font-bold uppercase tracking-wider block text-[10px] mb-1">Impact Summary:</span>
              <p>• The raw original video segment and transcoded H.264 formats will be wiped.</p>
              <p>• All tracking frames and metadata indices will be deleted.</p>
              <p>• All Qdrant vector embeddings will be pruned (rendering search matches impossible).</p>
              <p>• Forensic audit trail files will be purged.</p>
            </div>

            <label className="flex items-start gap-2.5 mb-6 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteAgreeCheckbox}
                onChange={(e) => setDeleteAgreeCheckbox(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500 dark:border-slate-700 dark:bg-slate-800"
              />
              <span className="text-[11px] text-slate-700 dark:text-slate-300 font-semibold select-none leading-tight">
                I agree to permanently delete this video segment and all associated tracklets, embeddings, crops, and logs.
              </span>
            </label>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-850">
              <button
                type="button"
                disabled={deletingProgress}
                onClick={() => { setDeleteConfirmVideo(null); setDeleteAgreeCheckbox(false) }}
                className="px-3.5 py-1.5 rounded border border-slate-200 dark:border-slate-750 bg-transparent text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!deleteAgreeCheckbox || deletingProgress}
                onClick={() => handleDeleteVideoPermanently(deleteConfirmVideo.id)}
                className={`px-4 py-1.5 rounded text-xs font-bold text-white transition-all shadow-sm flex items-center gap-1.5 ${
                  deleteAgreeCheckbox && !deletingProgress
                    ? 'bg-rose-700 hover:bg-rose-800'
                    : 'bg-slate-300 dark:bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
              >
                {deletingProgress ? (
                  <>
                    <span className="animate-spin h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <span>Acknowledge &amp; Destroy</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function sanitize_filename(filename: string): string {
  const parts = filename.split('.')
  if (parts.length > 1) {
    parts.pop()
  }
  const name = parts.join('.')
  const clean_name = name.replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  return clean_name || "video"
}
