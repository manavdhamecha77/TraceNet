import { useEffect, useState } from 'react'
import { Globe } from 'lucide-react'
import { API_BASE } from '../config/api'

/**
 * Shared multilingual query feedback used by every page that sends free text to the forensic
 * search engines (tracklet search, video-scoped search, face search). It asks the backend how the
 * typed query will be interpreted (`/api/v1/search/parse`) and, when the query is Hindi, Gujarati,
 * Hinglish or Gujlish, shows the detected language and the normalised English query the engine
 * actually runs. English queries render nothing.
 */
export interface QueryParseMeta {
  is_multilingual: boolean
  detected_language: string
  language_code: string
  normalized_query: string
  backend_used?: string
}

/** Debounced lookup of how the backend will normalise a query. Returns null for English / empty text. */
export function useQueryParseMeta(query: string, delayMs = 300): QueryParseMeta | null {
  const [meta, setMeta] = useState<QueryParseMeta | null>(null)

  useEffect(() => {
    const text = query.trim()
    if (text.length < 2) {
      setMeta(null)
      return
    }
    let cancelled = false
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/search/parse?q=${encodeURIComponent(text)}`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (cancelled) return
        if (data.is_multilingual) {
          setMeta({
            is_multilingual: true,
            detected_language: data.detected_language || 'Indic',
            language_code: data.language_code || 'hi',
            normalized_query: data.normalized_query || text,
            backend_used: data.backend_used || 'offline_ai',
          })
        } else {
          setMeta(null)
        }
      } catch {
        if (!cancelled) setMeta(null)
      }
    }, delayMs)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [query, delayMs])

  return meta
}

interface HintProps {
  query: string
  /** Called whenever the interpretation changes, so a page can attach the meta to its results. */
  onMeta?: (meta: QueryParseMeta | null) => void
  className?: string
}

/** Live banner under a search box: "HINDI · Normalized: "man in the red shirt"". */
export function MultilingualQueryHint({ query, onMeta, className = '' }: HintProps) {
  const meta = useQueryParseMeta(query)

  useEffect(() => { onMeta?.(meta) }, [meta, onMeta])

  if (!meta?.is_multilingual || !meta.normalized_query) return null
  return (
    <div className={`flex items-center justify-between text-xs bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/60 rounded px-3 py-1.5 text-indigo-900 dark:text-indigo-200 transition-all ${className}`}>
      <div className="flex items-center gap-2 truncate">
        <Globe className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
        <span className="font-semibold uppercase tracking-wider text-[10px] bg-indigo-200 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200 px-1.5 py-0.5 rounded">
          {meta.detected_language}
        </span>
        <span className="text-slate-500 dark:text-slate-400 text-[11px]">Normalized:</span>
        <span className="font-mono font-medium truncate text-slate-800 dark:text-slate-100">"{meta.normalized_query}"</span>
      </div>
      <span className="text-[10px] text-indigo-500 dark:text-indigo-400 hidden sm:inline shrink-0 font-medium ml-2">
        {meta.backend_used === 'openrouter' ? 'Cloud translation' : 'Offline multilingual vector + attribute mapping'}
      </span>
    </div>
  )
}

/** Small results-header badge: "MULTILINGUAL: HINDI → EN". */
export function MultilingualBadge({ meta, originalQuery }: { meta: QueryParseMeta | null | undefined; originalQuery?: string }) {
  if (!meta?.is_multilingual) return null
  return (
    <span
      className="text-[9px] bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 px-2 py-0.5 rounded font-bold inline-flex items-center gap-1"
      title={originalQuery ? `Original: "${originalQuery}" → Normalized: "${meta.normalized_query}"` : `Normalized: "${meta.normalized_query}"`}
    >
      <Globe className="h-3 w-3" />
      MULTILINGUAL: {meta.detected_language?.toUpperCase()} → EN
    </span>
  )
}

export default MultilingualQueryHint
