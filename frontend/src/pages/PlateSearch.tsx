import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Car, EyeOff, Play, RefreshCw, Search as SearchIcon, ShieldAlert } from 'lucide-react'

import { API_BASE } from '../config/api'
import { classColor } from '../utils/colors'
import { formatDisplayDate } from '../utils/dateFormatter'
import OcrEngineSelector from '../components/OcrEngineSelector'

interface Camera {
  camera_id: string
  name: string
}

interface PlateRow {
  id: string
  plate_text: string
  plate_status: string
  ocr_confidence: number | null
  confidence: number
  cutout_url: string | null
  camera_id: string
  video_id: string | null
  timestamp_seconds: number | null
  bbox: number[]
  is_watchlisted: boolean
  tracklet_id: string | null
  ocr_engine: string | null
}

interface VehicleInfo {
  tracklet_id: string
  tracker_id: number
  video_id: string
  camera_id: string
  camera_name: string
  object_type: string
  class_name: string
  timestamp_start_seconds: number
  timestamp_end_seconds: number
  best_crop_path: string
  best_bbox: number[]
  video_standardized_filename: string
  video_thumbnail_path: string
  video_start_time: string | null
}

interface PlateResult {
  distance: number | null
  plate: PlateRow
  vehicle: VehicleInfo | null
}

interface SearchResponse {
  total: number
  counts_by_distance?: Record<string, number>
  results: PlateResult[]
}

type Tab = 'text' | 'blurry' | 'not_detected'
type Mode = 'exact' | 'estimate'

interface PlateSearchProps {
  onPlayVideoAtTime: (video: any, timestamp: number, trackerId?: number | string, bestBbox?: number[], className?: string) => void // eslint-disable-line @typescript-eslint/no-explicit-any
}

const DISTANCE_TITLES: Record<number, string> = {
  0: 'Exact match',
  1: '1 edit away — most likely an OCR slip',
  2: '2 edits away',
  3: '3 edits away',
}

const imageUrl = (url?: string | null) => (url ? (url.startsWith('http') ? url : `${API_BASE}${url}`) : '')

const normalizePlate = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Plate text with characters that differ from the query underlined (only when lengths agree). */
function PlateText({ text, query, highlight }: { text: string; query: string; highlight: boolean }) {
  const q = normalizePlate(query)
  const comparable = highlight && q.length === text.length
  return (
    <span className="rounded border-2 border-slate-800 bg-amber-300 px-2 py-1 font-mono text-sm font-extrabold tracking-widest text-slate-900">
      {text.split('').map((ch, i) =>
        comparable && ch !== q[i] ? (
          <span key={i} className="rounded-sm bg-rose-500 px-px text-white" title={`query has ${q[i]}`}>{ch}</span>
        ) : (
          <span key={i}>{ch}</span>
        )
      )}
    </span>
  )
}

export default function PlateSearch({ onPlayVideoAtTime }: PlateSearchProps) {
  // Deep links: /plates?q=GJ05AB1234&mode=exact&partial=1&tab=blurry
  const [urlParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => {
    const t = urlParams.get('tab')
    return t === 'blurry' || t === 'not_detected' ? t : 'text'
  })
  const [query, setQuery] = useState(() => urlParams.get('q') ?? '')
  const [mode, setMode] = useState<Mode>(() => (urlParams.get('mode') === 'exact' ? 'exact' : 'estimate'))
  const [maxDistance, setMaxDistance] = useState(3)
  const [partial, setPartial] = useState(() => urlParams.get('partial') === '1')
  const [cameraId, setCameraId] = useState('')
  const [cameras, setCameras] = useState<Camera[]>([])
  const [data, setData] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hiddenDistances, setHiddenDistances] = useState<number[]>([])
  const [recent, setRecent] = useState<string[]>([])
  const requestSeq = useRef(0)

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/cameras`).then(r => (r.ok ? r.json() : [])).then(setCameras).catch(() => setCameras([]))
  }, [])

  const loadRecent = useCallback(() => {
    fetch(`${API_BASE}/api/v1/anpr/detections?limit=60`)
      .then(r => (r.ok ? r.json() : { detections: [] }))
      .then(body => {
        const seen = new Set<string>()
        for (const d of body.detections as PlateRow[]) if (d.plate_text) seen.add(d.plate_text)
        setRecent(Array.from(seen).slice(0, 12))
      })
      .catch(() => setRecent([]))
  }, [])

  useEffect(() => { loadRecent() }, [loadRecent])

  const runSearch = useCallback(async () => {
    const seq = ++requestSeq.current
    setError('')

    let url: string
    if (tab === 'text') {
      if (!normalizePlate(query)) {
        setData(null)
        setLoading(false)
        return
      }
      const params = new URLSearchParams({ q: query, mode, max_distance: String(maxDistance), partial: String(partial), limit: '150' })
      if (cameraId) params.set('camera_id', cameraId)
      url = `${API_BASE}/api/v1/anpr/search?${params.toString()}`
    } else {
      const params = new URLSearchParams({ plate_status: tab, limit: '120' })
      if (cameraId) params.set('camera_id', cameraId)
      url = `${API_BASE}/api/v1/anpr/vehicles?${params.toString()}`
    }

    setLoading(true)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Search failed (${res.status})`)
      const body: SearchResponse = await res.json()
      if (seq === requestSeq.current) setData(body)   // ignore answers to superseded keystrokes
    } catch (err) {
      if (seq === requestSeq.current) setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [tab, query, mode, maxDistance, partial, cameraId])

  // Search as the operator types
  useEffect(() => {
    const handle = window.setTimeout(runSearch, 250)
    return () => window.clearTimeout(handle)
  }, [runSearch])

  const grouped = useMemo(() => {
    const groups = new Map<number, PlateResult[]>()
    for (const r of data?.results ?? []) {
      const key = r.distance ?? -1
      groups.set(key, [...(groups.get(key) ?? []), r])
    }
    return Array.from(groups.entries()).sort((a, b) => a[0] - b[0])
  }, [data])

  const toggleDistance = (d: number) =>
    setHiddenDistances(prev => (prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]))

  const seek = (r: PlateResult) => {
    const v = r.vehicle
    const videoId = v?.video_id ?? r.plate.video_id
    if (!videoId) return
    onPlayVideoAtTime(
      {
        id: videoId,
        camera_id: v?.camera_id ?? r.plate.camera_id,
        standardized_filename: v?.video_standardized_filename ?? '',
        thumbnail_path: v?.video_thumbnail_path ?? '',
        processing_status: 'complete',
      },
      v?.timestamp_start_seconds ?? r.plate.timestamp_seconds ?? 0,
      v?.tracker_id ?? v?.tracklet_id,
      v?.best_bbox,
      v?.class_name
    )
  }

  const whenLabel = (v: VehicleInfo | null, fallbackSeconds: number | null) => {
    const seconds = v?.timestamp_start_seconds ?? fallbackSeconds
    if (seconds == null) return '—'
    if (v?.video_start_time) {
      return formatDisplayDate(new Date(Date.parse(v.video_start_time) + seconds * 1000).toISOString(), true)
    }
    return `${seconds.toFixed(1)} s into video`
  }

  const renderCard = (r: PlateResult) => {
    const v = r.vehicle
    const p = r.plate
    const cropSrc = imageUrl(v?.best_crop_path)
    const cutoutSrc = imageUrl(p.cutout_url)
    const readable = p.plate_status === 'read'

    return (
      <div key={p.id} className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition-all hover:border-teal-400 dark:border-slate-700 dark:bg-slate-900">
        <div className="grid grid-cols-2 gap-px bg-slate-200 dark:bg-slate-700">
          <div className="relative flex h-32 items-center justify-center bg-slate-100 dark:bg-slate-800">
            {cropSrc ? <img src={cropSrc} alt="vehicle" className="h-full w-full object-contain" loading="lazy" /> : <Car className="h-8 w-8 text-slate-400 opacity-40" />}
            {v && (
              <span className="absolute bottom-1 left-1 rounded px-1.5 py-0.5 text-[9px] font-bold capitalize text-white" style={{ backgroundColor: classColor(v.class_name) }}>
                {v.class_name} #{v.tracker_id}
              </span>
            )}
          </div>
          <div className="relative flex h-32 items-center justify-center bg-white dark:bg-slate-950">
            {cutoutSrc ? <img src={cutoutSrc} alt="number plate cutout" className="h-full w-full object-contain p-1" loading="lazy" /> : <EyeOff className="h-8 w-8 text-slate-400 opacity-40" />}
            <span className="absolute left-1 top-1 rounded bg-slate-800/80 px-1 text-[8px] font-bold uppercase text-white">Plate</span>
          </div>
        </div>

        <div className="flex flex-1 flex-col justify-between space-y-2 p-3">
          <div className="space-y-1.5">
            {readable ? (
              <div className="flex flex-wrap items-center gap-2">
                <PlateText text={p.plate_text} query={query} highlight={mode === 'estimate' && tab === 'text'} />
                {r.distance != null && r.distance > 0 && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">±{r.distance}</span>
                )}
                {p.is_watchlisted && (
                  <span className="flex items-center gap-1 rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white"><ShieldAlert className="h-3 w-3" />Watchlist</span>
                )}
              </div>
            ) : (
              <div className="text-xs font-semibold italic text-amber-700 dark:text-amber-400">
                {p.plate_status === 'blurry' ? 'Blurry number plate — text not readable' : 'No number plate detected'}
              </div>
            )}

            <div className="space-y-0.5 text-[10.5px] text-slate-600 dark:text-slate-300">
              <div className="flex justify-between gap-2">
                <span className="font-mono font-bold text-teal-700 dark:text-teal-400">{v?.camera_id ?? p.camera_id}</span>
                <span className="truncate text-slate-500">{v?.camera_name}</span>
              </div>
              <div>When: <strong className="text-slate-800 dark:text-slate-100">{whenLabel(v, p.timestamp_seconds)}</strong></div>
              {readable && p.ocr_confidence != null && (
                <div>OCR confidence: <strong className="text-slate-800 dark:text-slate-100">{Math.round(p.ocr_confidence * 100)}%</strong>{p.ocr_engine ? ` · ${p.ocr_engine}` : ''}</div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5 pt-1">
            <button
              onClick={() => seek(r)}
              className="flex items-center justify-center gap-1 rounded border border-teal-200 bg-teal-50 py-1.5 text-[10px] font-bold text-teal-700 transition-all hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-900/30 dark:text-teal-400"
            >
              <Play className="h-3 w-3 fill-current" /> Seek &amp; Stream
            </button>
            {(v?.video_id ?? p.video_id) ? (
              <Link
                to={`/cameras/${v?.camera_id ?? p.camera_id}/videos/${v?.video_id ?? p.video_id}`}
                className="flex items-center justify-center rounded border border-slate-200 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Open video
              </Link>
            ) : <span />}
          </div>
        </div>
      </div>
    )
  }

  const tabButton = (key: Tab, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => { setTab(key); setHiddenDistances([]) }}
      className={`rounded px-3 py-1.5 text-[11px] font-bold transition-all ${
        tab === key ? 'bg-white text-teal-700 shadow-sm dark:bg-slate-700 dark:text-teal-300' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
      }`}
    >
      {label}
    </button>
  )

  const counts = data?.counts_by_distance ?? {}

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
          <Car className="h-5 w-5 text-teal-600" /> Vehicle Plate Search
        </h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Find vehicles by the text recognised on their number plate. Results update as you type; plates are matched exactly as the OCR read them.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.7fr_1.3fr]">
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex w-fit rounded border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800">
            {tabButton('text', 'Search by plate text')}
            {tabButton('blurry', 'Unreadable plates')}
            {tabButton('not_detected', 'No plate found')}
          </div>

          {tab === 'text' ? (
            <>
              <div className="relative">
                <SearchIcon className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Type a number plate, e.g. GJ05AB1234"
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full rounded border border-slate-300 bg-white py-2.5 pl-9 pr-9 font-mono text-base font-bold uppercase tracking-widest text-slate-900 focus:border-teal-700 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                {loading && <RefreshCw className="absolute right-3 top-3.5 h-4 w-4 animate-spin text-slate-400" />}
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex rounded border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800">
                  {(['exact', 'estimate'] as Mode[]).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={`rounded px-3 py-1 text-[11px] font-bold capitalize ${
                        mode === m ? 'bg-white text-teal-700 shadow-sm dark:bg-slate-700 dark:text-teal-300' : 'text-slate-500'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                {mode === 'estimate' && (
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    Up to
                    {[1, 2, 3].map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setMaxDistance(d)}
                        className={`h-6 w-6 rounded border text-[11px] font-bold ${
                          maxDistance === d ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                    edits
                  </div>
                )}

                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={partial} onChange={e => setPartial(e.target.checked)} className="rounded text-teal-700" />
                  Match anywhere in plate
                </label>
              </div>

              {recent.length > 0 && !query && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Recently read</span>
                  {recent.map(text => (
                    <button
                      key={text}
                      type="button"
                      onClick={() => setQuery(text)}
                      className="rounded border border-slate-300 bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-slate-800 hover:bg-amber-200"
                    >
                      {text}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="rounded border border-amber-300/50 bg-amber-50 p-3 text-[11px] leading-snug text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              {tab === 'blurry'
                ? 'A number plate was found on these vehicles but its text could not be read, so text search cannot find them. Inspect the plate cutouts yourself.'
                : 'No number plate was found on these vehicles in any sampled frame (e.g. seen from the side or too small).'}
            </p>
          )}

          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Camera</label>
            <select
              value={cameraId}
              onChange={e => setCameraId(e.target.value)}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-800 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">All cameras</option>
              {cameras.map(c => <option key={c.camera_id} value={c.camera_id}>{c.camera_id} — {c.name}</option>)}
            </select>
          </div>
        </div>

        <OcrEngineSelector onBackfillFinished={() => { loadRecent(); runSearch() }} />
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-center text-xs text-red-800 dark:border-red-950/20 dark:bg-red-950/30 dark:text-red-400">{error}</div>}

      {/* Result summary + distance filters */}
      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-700">
          <p className="text-xs text-slate-500">
            <span className="font-bold text-teal-700 dark:text-teal-400">{data.total}</span> vehicle{data.total === 1 ? '' : 's'}
            {tab === 'text' && <> for &ldquo;<em className="font-mono">{normalizePlate(query)}</em>&rdquo;</>}
          </p>
          {tab === 'text' && mode === 'estimate' && (
            <div className="flex items-center gap-1.5">
              {[0, 1, 2, 3].filter(d => counts[String(d)]).map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDistance(d)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                    hiddenDistances.includes(d) ? 'border-slate-300 text-slate-400 line-through' : 'border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300'
                  }`}
                >
                  {d === 0 ? 'Exact' : `±${d}`} · {counts[String(d)]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Results, grouped by edit distance */}
      <div className="space-y-6">
        {grouped.filter(([d]) => !hiddenDistances.includes(d)).map(([distance, items]) => (
          <section key={distance} className="space-y-3">
            {distance >= 0 && tab === 'text' && mode === 'estimate' && (
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {DISTANCE_TITLES[distance]} <span className="font-mono text-slate-400">({items.length})</span>
              </h3>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{items.map(renderCard)}</div>
          </section>
        ))}

        {data && data.total === 0 && !loading && (
          <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-xs text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500">
            {tab === 'text'
              ? mode === 'exact'
                ? 'No vehicle has exactly this plate. Switch to Estimate to include plates 1–3 characters away, or enable “Match anywhere in plate”.'
                : 'No plate within the selected edit distance. The OCR may have misread it badly — try the Unreadable plates tab.'
              : 'No vehicles in this category.'}
          </div>
        )}

        {tab === 'text' && !normalizePlate(query) && (
          <div className="rounded-md border border-dashed border-slate-300 p-10 text-center text-xs text-slate-400 dark:border-slate-700">
            Start typing a number plate to find the vehicles that carry it.
          </div>
        )}
      </div>
    </div>
  )
}
