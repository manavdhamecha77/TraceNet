/**
 * Standardized Date/Time formatting utility for TraceNet HCI design system.
 * Converts raw ISO 8601 strings into consistent human-readable forensic timestamps.
 */

export function formatDisplayDate(isoString?: string | null, includeSeconds: boolean = false): string {
  if (!isoString) return '—'
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return '—'

    const day = d.getDate().toString().padStart(2, '0')
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const month = months[d.getMonth()]
    const year = d.getFullYear()

    const hours = d.getHours().toString().padStart(2, '0')
    const mins = d.getMinutes().toString().padStart(2, '0')
    const secs = d.getSeconds().toString().padStart(2, '0')

    const timeStr = includeSeconds ? `${hours}:${mins}:${secs}` : `${hours}:${mins}`
    return `${day} ${month} ${year}, ${timeStr}`
  } catch {
    return '—'
  }
}

export function formatRelativeTime(isoString?: string | null): string {
  if (!isoString) return '—'
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return '—'

    const now = new Date()
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000)

    if (diffSec < 10) return 'Just now'
    if (diffSec < 60) return `${diffSec}s ago`
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
    return `${Math.floor(diffSec / 86400)}d ago`
  } catch {
    return '—'
  }
}
