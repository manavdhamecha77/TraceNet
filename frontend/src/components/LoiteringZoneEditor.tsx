import { useCallback, useEffect, useState } from 'react'
import { Loader2, MapPinned, Trash2, X } from 'lucide-react'

import { API_BASE } from '../config/api'
type Point = { x: number; y: number }
interface ZoneState { name: string; polygon_points: Point[]; threshold_seconds: number; grace_seconds: number; preview_ready: boolean; preview_url: string | null }
interface Props { videoId: string; onClose: () => void }

export default function LoiteringZoneEditor({ videoId, onClose }: Props) {
  const [zone, setZone] = useState<ZoneState | null>(null)
  const [points, setPoints] = useState<Point[]>([])
  const [name, setName] = useState('Loitering zone')
  const [threshold, setThreshold] = useState(60)
  const [grace, setGrace] = useState(3)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const loadZone = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/videos/${videoId}/loitering-zone`)
      if (!response.ok) throw new Error((await response.json()).detail || 'Could not load loitering setup.')
      const data: ZoneState = await response.json()
      setZone(data); setName(data.name || 'Loitering zone'); setThreshold(data.threshold_seconds); setGrace(data.grace_seconds); setPoints(data.polygon_points || [])
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load loitering setup.') }
  }, [videoId])
  useEffect(() => {
    loadZone()
    const timer = window.setInterval(() => { if (!zone?.preview_ready) loadZone() }, 3000)
    return () => window.clearInterval(timer)
  }, [loadZone, zone?.preview_ready])
  const addPoint = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!zone?.preview_ready || saving) return
    const bounds = event.currentTarget.getBoundingClientRect()
    setSaved(false)
    setPoints((current) => [...current, { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) }])
  }
  const saveZone = async () => {
    if (points.length < 3) { setError('Draw at least three points to create a zone.'); return }
    setSaving(true); setError('')
    try {
      const response = await fetch(`${API_BASE}/api/v1/videos/${videoId}/loitering-zone`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, polygon_points: points, threshold_seconds: threshold, grace_seconds: grace }) })
      if (!response.ok) throw new Error((await response.json()).detail || 'Could not save zone.')
      setSaved(true); await loadZone()
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save zone.') } finally { setSaving(false) }
  }
  const polygon = points.map((point) => `${point.x * 1000},${point.y * 562.5}`).join(' ')
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
    <div className="w-full max-w-4xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between border-b border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-700 dark:bg-slate-800"><div><h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100"><MapPinned className="h-4 w-4 text-teal-600" /> Define loitering zone</h3><p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">Click the standardized preview to draw a polygon. Dwell time uses the bottom-centre of each tracked person.</p></div><button onClick={onClose} className="text-slate-400 hover:text-slate-800 dark:hover:text-white" aria-label="Close loitering zone editor"><X className="h-5 w-5" /></button></div>
      <div className="grid gap-5 p-5 md:grid-cols-[1fr_220px]"><div>{!zone?.preview_ready ? <div className="flex aspect-video flex-col items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-center dark:border-slate-700 dark:bg-slate-800"><Loader2 className="h-6 w-6 animate-spin text-teal-600" /><p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">Preparing standardized preview…</p><p className="mt-1 text-[11px] text-slate-500">This editor will unlock as soon as preprocessing saves a frame.</p></div> : <div onClick={addPoint} className="relative aspect-video cursor-crosshair overflow-hidden rounded border border-slate-300 bg-black dark:border-slate-700"><img src={`${API_BASE}${zone.preview_url}`} alt="Standardized CCTV frame for zone selection" className="h-full w-full select-none object-fill" draggable={false} /><svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1000 562.5" preserveAspectRatio="none">{points.length >= 2 && <polyline points={polygon} fill="rgba(13, 148, 136, 0.22)" stroke="#0f766e" strokeWidth="4" />}{points.map((point, index) => <circle key={`${point.x}-${point.y}-${index}`} cx={point.x * 1000} cy={point.y * 562.5} r="8" fill="#14b8a6" stroke="white" strokeWidth="3" />)}</svg></div>}{zone?.preview_ready && <p className="mt-2 text-[10px] text-slate-500">{points.length} point{points.length === 1 ? '' : 's'} plotted. Use Reset to redraw the region.</p>}</div>
      <div className="space-y-3">{error && <div className="rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>}<label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Zone label<input value={name} onChange={(event) => { setName(event.target.value); setSaved(false) }} maxLength={100} className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs font-normal text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" /></label><label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Dwell threshold (seconds)<input type="number" min="5" max="86400" value={threshold} onChange={(event) => { setThreshold(Number(event.target.value)); setSaved(false) }} className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs font-normal text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" /></label><label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Tracking grace (seconds)<input type="number" min="0" max="30" value={grace} onChange={(event) => { setGrace(Number(event.target.value)); setSaved(false) }} className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs font-normal text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" /></label><button type="button" onClick={() => { setPoints([]); setSaved(false); setError('') }} disabled={!points.length || saving} className="flex w-full items-center justify-center gap-1.5 rounded border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><Trash2 className="h-3.5 w-3.5" /> Reset polygon</button><button type="button" onClick={saveZone} disabled={!zone?.preview_ready || points.length < 3 || saving} className="w-full rounded bg-teal-700 px-3 py-2 text-xs font-bold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-teal-600">{saving ? 'Saving…' : saved ? 'Zone saved' : 'Save zone & run analysis'}</button><p className="text-[10px] leading-relaxed text-slate-500">A saved zone enables review; it does not infer intent or identify a person.</p></div></div>
    </div>
  </div>
}
