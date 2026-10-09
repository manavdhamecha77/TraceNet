// One place for how each alert type is named, coloured and where it is reviewed.
// Pages must not fall back to "Abandoned Object" for types they do not know.

export type AlertTone = 'amber' | 'teal' | 'violet' | 'rose'

export interface AlertTypeMeta {
  label: string
  tone: AlertTone
  /** Page where this alert type is reviewed in detail */
  reviewPath: (alertId: number) => string
  /** Alert rows carry real tracklet ids (object / owner / visitor) that can be tracked */
  hasTracklets: boolean
}

const META: Record<string, AlertTypeMeta> = {
  abandoned_object: { label: 'Abandoned Object', tone: 'amber', reviewPath: () => '/alerts/abandoned', hasTracklets: true },
  unattended_object: { label: 'Unattended Luggage', tone: 'teal', reviewPath: () => '/alerts/abandoned', hasTracklets: true },
  loitering: { label: 'Loitering review', tone: 'violet', reviewPath: () => '/alerts/abandoned', hasTracklets: true },
  chain_snatching: { label: 'Outdoor Theft & Snatching', tone: 'rose', reviewPath: () => '/alerts/theft', hasTracklets: true },
  accident: { label: 'Traffic Collision', tone: 'rose', reviewPath: () => '/alerts/abandoned', hasTracklets: false },
  assault: { label: 'Physical Assault', tone: 'rose', reviewPath: id => `/frame-inspection/${id}`, hasTracklets: false },
  anpr_watchlist: { label: 'Watchlisted Plate', tone: 'rose', reviewPath: () => '/alerts/plates', hasTracklets: false },
}

export function alertTypeMeta(alertType: string | null | undefined): AlertTypeMeta {
  const key = alertType || 'unknown'
  return META[key] ?? {
    label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    tone: 'amber',
    reviewPath: () => '/alerts',
    hasTracklets: false,
  }
}

/** Assault alerts store the VideoMAE verdict in analysis_log; returns e.g. "Abuse 97%" */
export function assaultVerdict(analysisLog: string | null | undefined): string | null {
  if (!analysisLog) return null
  try {
    const d = JSON.parse(analysisLog)
    if (d && typeof d === 'object' && !Array.isArray(d) && d.assault_type) {
      const conf = typeof d.confidence === 'number' ? ` ${Math.round(d.confidence * 100)}%` : ''
      const at = typeof d.peak_timestamp_seconds === 'number' ? ` at ${d.peak_timestamp_seconds.toFixed(1)} s` : ''
      return `${d.assault_type}${conf}${at}`
    }
  } catch { /* not JSON */ }
  return null
}
