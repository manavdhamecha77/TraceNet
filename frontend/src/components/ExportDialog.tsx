import { useState } from 'react'
import { X, ShieldCheck, Download, Copy, RefreshCw, FileArchive, EyeOff, Film, Image as ImageIcon } from 'lucide-react'

import { API_BASE } from '../config/api'
import { DEMO_OPERATOR } from '../config/operator'
import { useToast } from './Toast'
import { VerificationPanel, type VerificationResult } from './EvidenceVerification'

export interface ExportCandidate {
  tracklet_id: string
  score: number
}

export interface SealedExport {
  id: string
  created_at: string
  created_by: string
  case_reference: string | null
  item_count: number
  zip_bytes: number
  zip_sha256: string
  manifest_sha256: string
  download_url: string
}

interface ExportDialogProps {
  open: boolean
  onClose: () => void
  candidates: ExportCandidate[]
  query: string
  filters: Record<string, unknown>
  onSealed?: (sealed: SealedExport) => void
}

const formatBytes = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`)

export default function ExportDialog({ open, onClose, candidates, query, filters, onSealed }: ExportDialogProps) {
  const toast = useToast()
  const [caseRef, setCaseRef] = useState('')
  const [notes, setNotes] = useState('')
  const [includeClips, setIncludeClips] = useState(true)
  const [includeAnnotated, setIncludeAnnotated] = useState(true)
  const [blurFaces, setBlurFaces] = useState(false)
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState('')
  const [sealed, setSealed] = useState<SealedExport | null>(null)
  const [verification, setVerification] = useState<VerificationResult | null>(null)
  const [verifying, setVerifying] = useState(false)

  if (!open) return null

  const close = () => {
    if (building) return
    setSealed(null)
    setVerification(null)
    setError('')
    onClose()
  }

  const build = async () => {
    setBuilding(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/v1/exports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: candidates.map(c => ({ tracklet_id: c.tracklet_id, score: Math.max(0, Math.min(1, c.score)) })),
          query,
          filters,
          case_reference: caseRef.trim() || null,
          operator: DEMO_OPERATOR,
          notes: notes.trim() || null,
          include_clips: includeClips,
          include_annotated: includeAnnotated,
          blur_faces: blurFaces,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Export failed')
      setSealed(data)
      onSealed?.(data)
      toast.success('Evidence Sealed', `${data.item_count} result(s) packaged with SHA-256 integrity hashing.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setBuilding(false)
    }
  }

  const verify = async () => {
    if (!sealed) return
    setVerifying(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/exports/${sealed.id}/verify`)
      if (!res.ok) throw new Error('Verification request failed')
      setVerification(await res.json())
    } catch (err) {
      toast.error('Verification Error', err instanceof Error ? err.message : 'Could not verify bundle')
    } finally {
      setVerifying(false)
    }
  }

  const copyHash = async () => {
    if (!sealed) return
    try {
      await navigator.clipboard.writeText(sealed.zip_sha256)
      toast.success('Copied', 'Bundle SHA-256 copied to clipboard.')
    } catch {
      toast.warning('Copy Failed', 'Select the hash text and copy it manually.')
    }
  }

  const checkbox = (checked: boolean, set: (v: boolean) => void, label: string, hint: string, Icon: typeof Film) => (
    <label className="flex items-start gap-2.5 cursor-pointer rounded-lg border border-slate-200 dark:border-slate-700 p-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50">
      <input type="checkbox" checked={checked} onChange={e => set(e.target.checked)} className="mt-0.5 rounded text-teal-700" />
      <span className="space-y-0.5">
        <span className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100"><Icon className="h-3.5 w-3.5 text-teal-600" />{label}</span>
        <span className="block text-[10.5px] text-slate-500 dark:text-slate-400 leading-snug">{hint}</span>
      </span>
    </label>
  )

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={close}>
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
            <FileArchive className="h-4 w-4 text-teal-600" /> Export Forensic Evidence Bundle
          </div>
          <button onClick={close} disabled={building} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!sealed ? (
          <div className="space-y-4 p-5">
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
              Packages <strong className="text-slate-700 dark:text-slate-200">{candidates.length}</strong> result(s) for query
              {' '}&ldquo;<em>{query}</em>&rdquo; into a sealed ZIP: clips, annotated frames, a manifest with per-file SHA-256,
              chain-of-custody events and a printable report.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Case / FIR reference</label>
                <input
                  value={caseRef}
                  onChange={e => setCaseRef(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. FIR-2026-0412"
                  className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-700"
                />
              </div>
              <div>
                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Exporting operator</label>
                <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1.5 text-[11px] font-mono text-slate-600 dark:text-slate-300 truncate">{DEMO_OPERATOR}</div>
              </div>
            </div>

            <div>
              <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                maxLength={2000}
                rows={2}
                className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-800 dark:text-slate-100 focus:outline-none focus:border-teal-700"
              />
            </div>

            <div className="space-y-2">
              {checkbox(includeClips, setIncludeClips, 'Video clips', 'H.264 MP4 cut from the standardized recording around each match (max 30 s each).', Film)}
              {checkbox(includeAnnotated, setIncludeAnnotated, 'Annotated frames', 'Full frame with the matched subject boxed, camera, absolute time and match score burned in.', ImageIcon)}
              {checkbox(blurFaces, setBlurFaces, 'Redact non-matched faces', 'Pixelates every other face in frames and clips (best-effort). The export is cancelled if no face detector is available.', EyeOff)}
            </div>

            {error && <div className="rounded border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30 p-2.5 text-[11px] text-red-700 dark:text-red-400">{error}</div>}

            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-slate-400">{building ? 'Cutting clips and hashing files — this can take a minute…' : 'Candidates only — human review required.'}</span>
              <button
                onClick={build}
                disabled={building || candidates.length === 0}
                className="inline-flex items-center gap-1.5 rounded bg-teal-700 hover:bg-teal-800 px-4 py-2 text-xs font-bold text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {building ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                {building ? 'Building…' : 'Seal & Export'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3.5 space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-400"><ShieldCheck className="h-4 w-4" /> Bundle sealed</div>
              <div className="text-[11px] text-slate-600 dark:text-slate-300 font-mono">{sealed.id} · {sealed.item_count} item(s) · {formatBytes(sealed.zip_bytes)}</div>
              <div className="flex items-start gap-2">
                <div className="text-[10px] font-mono break-all text-slate-600 dark:text-slate-300 flex-1">SHA-256: {sealed.zip_sha256}</div>
                <button onClick={copyHash} title="Copy hash" className="text-slate-500 hover:text-teal-700 shrink-0"><Copy className="h-3.5 w-3.5" /></button>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">Record this hash in the case file. The bundle and manifest hashes are stored in the audit trail.</p>
            </div>

            <div className="flex gap-2">
              <a
                href={`${API_BASE}${sealed.download_url}`}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded bg-teal-700 hover:bg-teal-800 px-3 py-2 text-xs font-bold text-white shadow-sm"
              >
                <Download className="h-3.5 w-3.5" /> Download bundle (.zip)
              </a>
              <button
                onClick={verify}
                disabled={verifying}
                className="inline-flex items-center justify-center gap-1.5 rounded border border-slate-300 dark:border-slate-600 px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                {verifying ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Verify now
              </button>
            </div>

            {verification && <VerificationPanel result={verification} />}

            <div className="flex justify-end">
              <button onClick={close} className="rounded px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
