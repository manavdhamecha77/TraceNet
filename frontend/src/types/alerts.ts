export interface AlertEntry {
  id: number
  alert_type: string
  camera_id: string
  video_id?: string
  tracklet_id: string
  object_tracklet_id?: string
  owner_tracklet_ids: string[]
  visitor_tracklet_ids: string[]
  reid_match_tracklet_id?: string
  abandon_duration_seconds?: number
  analysis_log?: string
  timestamp: string
  acknowledged: boolean
  acknowledged_by?: string
  acknowledged_at?: string
}

export interface AnalysisLogEntry {
  video_id: string
  video_name: string
  camera_name: string
  eligible: boolean
  skip_reason?: string
  alerts_created: number
  log_entries: string[]
  status: 'pending' | 'running' | 'complete' | 'skipped' | 'error'
  progress_percentage?: number
}

export interface Camera {
  camera_id: string
  name: string
  participate_in_alerts?: boolean
}

const API_BASE = typeof window !== 'undefined' ? `http://${window.location.hostname}:8000` : 'http://localhost:8000'

export const TRACKLET_THUMB = (trackletId: string) =>
  `${API_BASE}/data/processed/detections/${trackletId.split('_trk_')[0]}/crops/${trackletId}.jpg`
