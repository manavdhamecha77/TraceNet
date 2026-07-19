import React, { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'

const API_BASE = 'http://localhost:8000'

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
  cameraVideos: Video[]
  setCameraVideos: React.Dispatch<React.SetStateAction<Video[]>>
  selectedCamera: Camera | null
  setSelectedCamera: (camera: Camera | null) => void
}

export default function CameraDetail({
  onOpenUploadModal,
  onPlayVideo,
  cameraVideos,
  setCameraVideos,
  selectedCamera,
  setSelectedCamera,
}: CameraDetailProps) {
  const { camera_id } = useParams<{ camera_id: string }>()
  const [activeTab, setActiveTab] = useState<'original' | 'system'>('system')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detectionLoadingId, setDetectionLoadingId] = useState<string | null>(null)
  const [detectionModal, setDetectionModal] = useState<{
    video: Video
    result: DetectionRunResponse | null
    error: string
    loading: boolean
  } | null>(null)
  
  // Tracklet Filters & Sorting
  const [detectionFilterType, setDetectionFilterType] = useState<string>('all')
  const [detectionFilterClass, setDetectionFilterClass] = useState<string>('all')
  const [detectionSortOrder, setDetectionSortOrder] = useState<'desc' | 'asc'>('desc')
  
  const pollTimerRef = useRef<any>(null)

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
    if (secs === undefined) return '--:--'
    const minutes = Math.floor(secs / 60)
    const seconds = Math.floor(secs % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const formatDateTime = (isoStr?: string) => {
    if (!isoStr) return 'N/A'
    return new Date(isoStr).toLocaleString()
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

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* CAMERA BANNER META */}
      {selectedCamera && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-4 rounded-md shadow-sm">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-850 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold text-teal-700 dark:text-teal-400">
                {selectedCamera.camera_id}
              </span>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{selectedCamera.name}</h3>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap gap-4">
              <span>Latitude: <strong className="text-slate-700 dark:text-slate-350">{selectedCamera.latitude ?? 'N/A'}</strong></span>
              <span>Longitude: <strong className="text-slate-700 dark:text-slate-350">{selectedCamera.longitude ?? 'N/A'}</strong></span>
              <span>Corridor: <strong className="text-slate-700 dark:text-slate-350">{selectedCamera.corridor_group ?? 'General'}</strong></span>
              <span>Topology Neighbors: <strong className="text-slate-700 dark:text-slate-350">{selectedCamera.adjacency.length > 0 ? selectedCamera.adjacency.join(', ') : 'None'}</strong></span>
            </div>
          </div>
          <div>
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
        </div>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          Showing {cameraVideos.length} recorded segments
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
              {cameraVideos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-400 dark:text-slate-500">
                    No files uploaded. Feed ingestion sandbox is ready.
                  </td>
                </tr>
              ) : (
                cameraVideos.map((video) => {
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
                          className="font-bold text-slate-800 dark:text-slate-100 cursor-help"
                          title={activeTab === 'original' ? video.original_filename : video.standardized_filename}
                        >
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
                            disabled={video.processing_status !== 'complete' || detectionLoadingId === video.id}
                            onClick={() => openDetections(video)}
                            className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-bold transition-all ${
                              video.processing_status === 'complete'
                                ? 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-200 dark:border-slate-700'
                            }`}
                          >
                            {detectionLoadingId === video.id ? (
                              <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                            ) : (
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 10l4.55-2.28A1 1 0 0121 8.62v6.76a1 1 0 01-1.45.89L15 14M4 7h8a2 2 0 012 2v6a2 2 0 01-2 2H4V7z" />
                              </svg>
                            )}
                            Detections
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
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            </svg>
                            View
                          </button>
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

          <div className="grid lg:grid-cols-[0.8fr_1.2fr] gap-0">
            <div className="p-4 space-y-3 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-700">
              {detectionModal.loading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Inspecting detections...
                </div>
              ) : detectionModal.error ? (
                <div className="rounded border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300 p-3 text-xs">
                  {detectionModal.error}
                </div>
              ) : detectionModal.result ? (
                <>
                  <div className="grid grid-cols-2 gap-3 text-[11px]">
                    <div className="rounded border border-slate-200 dark:border-slate-700 p-3">
                      <div className="text-slate-400 uppercase tracking-wider font-bold">Frames</div>
                      <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{detectionModal.result.frame_count}</div>
                    </div>
                    <div className="rounded border border-slate-200 dark:border-slate-700 p-3">
                      <div className="text-slate-400 uppercase tracking-wider font-bold">Tracklets</div>
                      <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{detectionModal.result.tracklets.length}</div>
                    </div>
                    <div className="rounded border border-slate-200 dark:border-slate-700 p-3">
                      <div className="text-slate-400 uppercase tracking-wider font-bold">FPS</div>
                      <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{detectionModal.result.fps.toFixed(1)}</div>
                    </div>
                    <div className="rounded border border-slate-200 dark:border-slate-700 p-3">
                      <div className="text-slate-400 uppercase tracking-wider font-bold">Object Types</div>
                      <div className="text-lg font-bold text-slate-800 dark:text-slate-100">
                        {Array.from(new Set(detectionModal.result.tracklets.map((tracklet) => tracklet.object_type))).join(', ') || 'None'}
                      </div>
                    </div>
                  </div>
                  <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3 text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
                    <div className="flex justify-between gap-4">
                      <span>Model:</span>
                      <span className="font-mono text-slate-800 dark:text-slate-100 truncate">{detectionModal.result.model_path}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span>Artifact:</span>
                      <span className="font-mono text-slate-800 dark:text-slate-100 truncate">{detectionModal.result.artifact_path}</span>
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            <div className="p-4 space-y-4 max-h-[480px] overflow-y-auto bg-slate-50 dark:bg-slate-900/40 flex flex-col">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-700">
                <div>
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tracklet Reviewer</h4>
                </div>
                
                {/* Dynamic Filters Row */}
                {detectionModal.result && (
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
                )}
              </div>

              {/* Detections Grid */}
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                            className="group flex flex-col rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shadow-sm hover:shadow-md transition-all duration-200 hover:border-slate-300 dark:hover:border-slate-650 hover:-translate-y-0.5"
                          >
                            {/* Card Crop Header */}
                            <div className="relative w-full h-24 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 overflow-hidden shrink-0">
                              {cropUrl ? (
                                <img
                                  src={cropUrl}
                                  alt={tracklet.tracklet_id}
                                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
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

                              <div className="pt-1.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[8px] text-slate-400">
                                <span>Ref:</span>
                                <span className="font-mono text-slate-500 truncate max-w-[60px]" title={tracklet.tracklet_id}>
                                  {tracklet.tracklet_id.substring(0, 6)}
                                </span>
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
      )}
    </div>
  )
}
