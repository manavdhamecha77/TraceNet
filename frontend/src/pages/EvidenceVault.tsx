import { useEffect, useRef, useState } from 'react'
import { Archive, Copy, Download, RefreshCw, ShieldCheck, Upload } from 'lucide-react'

import { API_BASE } from '../config/api'
import { formatDisplayDate } from '../utils/dateFormatter'
import { useToast } from '../components/Toast'
import { VerificationPanel, type VerificationResult } from '../components/EvidenceVerification'

interface ExportRecord {
  id: string
  created_at: string | null
  created_by: string
  case_reference: string | null
  query_text: string | null
  item_count: number
  zip_bytes: number
  zip_sha256: string
  last_verified_at: string | null
  last_verification: string | null
  download_url: string
  options: { include_clips?: boolean; blur_non_matched_faces?: boolean }
}

const BADGE: Record<string, string> = {
  VERIFIED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  TAMPERED: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30',
  MISSING: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30',
  UNREGISTERED: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
}

export default function EvidenceVault() {
  const toast = useToast()
  const [exportsList, setExportsList] = useState<ExportRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowResults, setRowResults] = useState<Record<string, VerificationResult>>({})
  const [uploadResult, setUploadResult] = useState<VerificationResult | null>(null)
  const [uploadName, setUploadName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/exports`)
      if (res.ok) setExportsList(await res.json())
    } catch {
      toast.error('Network Error', 'Could not load the evidence vault.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const verifyRow = async (id: string) => {
    setBusyId(id)
    try {
      const res = await fetch(`${API_BASE}/api/v1/exports/${id}/verify`)
      if (!res.ok) throw new Error('Verification request failed')
      const data: VerificationResult = await res.json()
      setRowResults(prev => ({ ...prev, [id]: data }))
      await load()
    } catch (err) {
      toast.error('Verification Error', err instanceof Error ? err.message : 'Could not verify bundle')
    } finally {
      setBusyId(null)
    }
  }

  const verifyUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.warning('ZIP Required', 'Select an evidence bundle (.zip) to verify.')
      return
    }
    setUploading(true)
    setUploadName(file.name)
    setUploadResult(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${API_BASE}/api/v1/exports/verify-upload`, { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(typeof err.detail === 'string' ? err.detail : 'Verification failed')
      }
      setUploadResult(await res.json())
    } catch (err) {
      toast.error('Verification Error', err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied', 'SHA-256 copied to clipboard.')
    } catch {
      toast.warning('Copy Failed', 'Select the hash text and copy it manually.')
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Archive className="h-5 w-5 text-teal-600" /> Evidence Vault</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Every sealed export is recorded here with its SHA-256. Re-verify a stored bundle, or check a copy received from another agency.
        </p>
      </div>

      {/* External bundle verification */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
        <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Verify an evidence bundle</h3>
        <input ref={fileRef} type="file" accept=".zip,application/zip" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) verifyUpload(f) }} />
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) verifyUpload(f) }}
          className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-all ${
            dragging ? 'border-teal-500 bg-teal-50/30 dark:bg-teal-950/30' : 'border-slate-300 dark:border-slate-700 hover:border-teal-600 bg-slate-50/50 dark:bg-slate-900/50'
          }`}
        >
          {uploading ? (
            <div className="flex items-center justify-center gap-2 text-xs text-slate-500"><RefreshCw className="h-4 w-4 animate-spin" /> Hashing {uploadName}…</div>
          ) : (
            <div className="space-y-1">
              <Upload className="h-6 w-6 mx-auto text-teal-600" />
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Drop an evidence bundle (.zip) here, or click to browse</p>
              <p className="text-[10px] text-slate-400">Files are hashed server-side and compared with SHA256SUMS, the manifest and the issuing registry.</p>
            </div>
          )}
        </div>
        {uploadResult && <VerificationPanel result={uploadResult} />}
      </div>

      {/* Registry */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Issued bundles</h3>
          <button onClick={() => { setLoading(true); load() }} className="text-[11px] font-bold text-slate-500 hover:text-teal-700 flex items-center gap-1">
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        {exportsList.length === 0 && !loading && (
          <p className="py-8 text-center text-xs text-slate-400">No evidence exports yet. Run a search and use &ldquo;Export Evidence Bundle&rdquo;.</p>
        )}

        <div className="space-y-3">
          {exportsList.map(rec => (
            <div key={rec.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-xs font-bold text-slate-800 dark:text-slate-100">{rec.id}</div>
                  <div className="text-[10.5px] text-slate-500 dark:text-slate-400">
                    {rec.created_at ? formatDisplayDate(rec.created_at, true) : '—'} · {rec.created_by} · {rec.item_count} item(s)
                    {rec.case_reference && <> · Case <strong>{rec.case_reference}</strong></>}
                  </div>
                  {rec.query_text && <div className="text-[10.5px] italic text-slate-600 dark:text-slate-300 mt-0.5">&ldquo;{rec.query_text}&rdquo;</div>}
                </div>
                {rec.last_verification && (
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${BADGE[rec.last_verification] ?? BADGE.UNREGISTERED}`}>
                    {rec.last_verification}{rec.last_verified_at ? ` · ${formatDisplayDate(rec.last_verified_at, true)}` : ''}
                  </span>
                )}
              </div>

              <div className="flex items-start gap-2">
                <code className="text-[10px] break-all text-slate-600 dark:text-slate-300 flex-1">SHA-256 {rec.zip_sha256}</code>
                <button onClick={() => copy(rec.zip_sha256)} title="Copy hash" className="text-slate-400 hover:text-teal-700 shrink-0"><Copy className="h-3.5 w-3.5" /></button>
              </div>

              <div className="flex gap-2">
                <a href={`${API_BASE}${rec.download_url}`} className="inline-flex items-center gap-1.5 rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <Download className="h-3.5 w-3.5" /> Download
                </a>
                <button
                  onClick={() => verifyRow(rec.id)}
                  disabled={busyId === rec.id}
                  className="inline-flex items-center gap-1.5 rounded bg-teal-700 hover:bg-teal-800 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
                >
                  {busyId === rec.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Re-verify
                </button>
              </div>

              {rowResults[rec.id] && <VerificationPanel result={rowResults[rec.id]} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
