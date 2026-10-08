import { useCallback, useEffect, useRef, useState } from 'react'
import { Cpu, RefreshCw, ScanLine, Zap } from 'lucide-react'

import { API_BASE } from '../config/api'
import { useToast } from './Toast'

interface OcrEngine {
  key: string
  label: string
  description: string
  lightweight: boolean
  available: boolean
  unavailable_reason: string | null
  loaded: boolean
  active: boolean
}

interface BackfillStatus {
  running: boolean
  force?: boolean
  engine?: string
  videos_total?: number
  videos_done?: number
  current_video?: string | null
  read?: number
  blurry?: number
  not_detected?: number
  vehicles?: number
  errors?: { video_id: string | null; error: string }[]
  finished_at?: string | null
}

interface OcrEngineSelectorProps {
  /** Called after a backfill finishes so the page can refresh its data */
  onBackfillFinished?: () => void
}

/**
 * Switch the global plate OCR engine (PaddleOCR <-> lightweight) and (re)read plates of existing footage.
 * The engine is a backend-wide setting: it applies to every plate read from now on, including new uploads.
 */
export default function OcrEngineSelector({ onBackfillFinished }: OcrEngineSelectorProps) {
  const toast = useToast()
  const [engines, setEngines] = useState<OcrEngine[]>([])
  const [switching, setSwitching] = useState<string | null>(null)
  const [backfill, setBackfill] = useState<BackfillStatus>({ running: false })
  const wasRunning = useRef(false)

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/anpr/ocr/config`)
      if (res.ok) setEngines((await res.json()).engines)
    } catch {
      /* backend offline: leave the panel empty */
    }
  }, [])

  const loadBackfill = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/anpr/backfill/status`)
      if (res.ok) setBackfill(await res.json())
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    loadConfig()
    loadBackfill()
  }, [loadConfig, loadBackfill])

  // Poll while a backfill runs; report once when it finishes
  useEffect(() => {
    if (backfill.running) {
      wasRunning.current = true
      const handle = window.setInterval(loadBackfill, 2000)
      return () => window.clearInterval(handle)
    }
    if (wasRunning.current) {
      wasRunning.current = false
      const errors = backfill.errors?.length ?? 0
      if (errors > 0) toast.warning('Plate Scan Finished With Errors', `${errors} video(s) failed. Check the backend log.`)
      else toast.success('Plate Scan Complete', `${backfill.read ?? 0} read, ${backfill.blurry ?? 0} blurry, ${backfill.not_detected ?? 0} without a plate.`)
      onBackfillFinished?.()
    }
  }, [backfill, loadBackfill, onBackfillFinished, toast])

  const active = engines.find(e => e.active)

  const switchTo = async (engine: OcrEngine) => {
    if (engine.active || !engine.available || switching) return
    setSwitching(engine.key)
    try {
      const res = await fetch(`${API_BASE}/api/v1/anpr/ocr/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: engine.key }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Switch failed')
      setEngines(data.engines)
      toast.success('OCR Engine Switched', `Plates are now read with ${engine.label}. Existing vehicles keep their old readings until re-read.`)
    } catch (err) {
      toast.error('Could Not Switch OCR Engine', err instanceof Error ? err.message : 'Switch failed')
      loadConfig()
    } finally {
      setSwitching(null)
    }
  }

  const startBackfill = async (force: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/anpr/backfill?force=${force}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Could not start scan')
      setBackfill(data)
      toast.info(force ? 'Re-reading All Plates' : 'Scanning Existing Footage', `Using ${active?.label ?? 'the active OCR engine'}.`)
    } catch (err) {
      toast.error('Plate Scan Not Started', err instanceof Error ? err.message : 'Could not start scan')
    }
  }

  const progress = backfill.videos_total ? Math.round(((backfill.videos_done ?? 0) / backfill.videos_total) * 100) : 0

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-3">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        <Cpu className="h-3.5 w-3.5" /> Plate OCR engine
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {engines.map(engine => (
          <button
            key={engine.key}
            type="button"
            onClick={() => switchTo(engine)}
            disabled={!engine.available || switching !== null}
            aria-pressed={engine.active}
            className={`rounded-lg border p-2.5 text-left transition-all disabled:cursor-not-allowed ${
              engine.active
                ? 'border-teal-600 bg-teal-50 ring-1 ring-teal-500 dark:bg-teal-950/30'
                : 'border-slate-200 hover:border-teal-500 dark:border-slate-700'
            } ${!engine.available ? 'opacity-50' : ''}`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
              {engine.lightweight ? <Zap className="h-3.5 w-3.5 text-amber-500" /> : <ScanLine className="h-3.5 w-3.5 text-teal-600" />}
              <span className="truncate">{engine.label}</span>
              {switching === engine.key && <RefreshCw className="h-3 w-3 animate-spin" />}
              {engine.active && <span className="ml-auto rounded bg-teal-600 px-1.5 py-0.5 text-[8px] uppercase text-white">Active</span>}
            </div>
            <p className="mt-1 text-[10.5px] leading-snug text-slate-500 dark:text-slate-400">
              {engine.available ? engine.description : `Unavailable: ${engine.unavailable_reason}`}
            </p>
          </button>
        ))}
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => startBackfill(false)}
            disabled={backfill.running}
            className="rounded border border-slate-300 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Scan existing footage
          </button>
          <button
            type="button"
            onClick={() => startBackfill(true)}
            disabled={backfill.running}
            className="rounded bg-teal-700 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-teal-800 disabled:opacity-50"
            title="Re-read every vehicle with the active engine"
          >
            Re-read all vehicles{active ? ` with ${active.lightweight ? 'lightweight OCR' : 'PaddleOCR'}` : ''}
          </button>
          {backfill.running && (
            <span className="flex items-center gap-1 text-[10.5px] text-slate-500">
              <RefreshCw className="h-3 w-3 animate-spin" /> Video {(backfill.videos_done ?? 0) + 1} of {backfill.videos_total ?? '?'}…
            </span>
          )}
        </div>

        {backfill.running && (
          <div className="h-1.5 w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
            <div className="h-full bg-teal-600 transition-all" style={{ width: `${Math.max(progress, 4)}%` }} />
          </div>
        )}

        {!backfill.running && backfill.finished_at && (
          <p className="text-[10.5px] text-slate-500 dark:text-slate-400">
            Last scan ({backfill.engine}): {backfill.vehicles ?? 0} vehicles — {backfill.read ?? 0} read, {backfill.blurry ?? 0} blurry, {backfill.not_detected ?? 0} no plate
            {(backfill.errors?.length ?? 0) > 0 && <span className="text-rose-600"> · {backfill.errors!.length} error(s)</span>}
          </p>
        )}
      </div>
    </div>
  )
}
