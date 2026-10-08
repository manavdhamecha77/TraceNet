import { API_BASE } from '../config/api'

export type PlateStatus = 'read' | 'blurry' | 'not_detected' | 'not_scanned'

export interface PlateInfo {
  status: PlateStatus
  text: string
  ocr_confidence?: number | null
  detector_confidence?: number | null
  cutout_url?: string | null
  engine?: string | null
  is_watchlisted?: boolean
}

interface PlateBadgeProps {
  plate?: PlateInfo | null
  className?: string
  /** Show the cutout thumbnail next to the text (default true) */
  showCutout?: boolean
}

const cutoutSrc = (url?: string | null) => (url ? (url.startsWith('http') ? url : `${API_BASE}${url}`) : '')

/**
 * Number plate of a vehicle result, exactly as recognised (no parsing).
 *  read          -> plate text in a plate-style badge
 *  blurry        -> "Blurry number plate" + the cutout for a human to inspect
 *  not_detected  -> "No number plate detected"
 *  not_scanned   -> footage processed before plate reading existed
 * People (plate == null) render nothing.
 */
export function PlateBadge({ plate, className = '', showCutout = true }: PlateBadgeProps) {
  if (!plate) return null
  const src = cutoutSrc(plate.cutout_url)
  const thumb =
    showCutout && src ? (
      <img src={src} alt="number plate cutout" className="h-6 max-w-[72px] rounded border border-slate-400/60 bg-white object-contain shrink-0" loading="lazy" />
    ) : null

  if (plate.status === 'read') {
    const conf = plate.ocr_confidence != null ? `${Math.round(plate.ocr_confidence * 100)}%` : 'n/a'
    return (
      <div className={`flex items-center gap-1.5 min-w-0 ${className}`} title={`OCR confidence ${conf}${plate.engine ? ` · ${plate.engine}` : ''}`}>
        {thumb}
        <span className="rounded border-2 border-slate-800 bg-amber-300 px-1.5 py-0.5 font-mono text-[11px] font-extrabold leading-none tracking-widest text-slate-900 truncate">
          {plate.text}
        </span>
        {plate.is_watchlisted && (
          <span className="rounded bg-rose-600 px-1 py-0.5 text-[8px] font-bold uppercase text-white shrink-0">Watchlist</span>
        )}
      </div>
    )
  }

  if (plate.status === 'blurry') {
    return (
      <div className={`flex items-center gap-1.5 min-w-0 ${className}`} title="A number plate was found but could not be read">
        {thumb}
        <span className="text-[10px] font-semibold italic text-amber-700 dark:text-amber-400">Blurry number plate</span>
      </div>
    )
  }

  return (
    <div className={`text-[10px] italic text-slate-400 dark:text-slate-500 ${className}`}>
      {plate.status === 'not_detected' ? 'No number plate detected' : 'Number plate not scanned yet'}
    </div>
  )
}

export default PlateBadge
