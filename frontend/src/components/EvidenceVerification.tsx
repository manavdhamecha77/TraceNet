import { ShieldCheck, ShieldAlert, ShieldQuestion, FileWarning } from 'lucide-react'

export interface VerificationResult {
  status: 'VERIFIED' | 'UNREGISTERED' | 'TAMPERED' | 'INVALID' | 'MISSING' | 'CONSISTENT'
  zip_sha256?: string | null
  checked_files?: number
  mismatches?: { path: string; expected: string; actual: string }[]
  missing?: string[]
  unlisted?: string[]
  problems?: string[]
  manifest?: { export_id?: string; created_by?: string; created_at_utc?: string; case_reference?: string | null } | null
  registry?: {
    found: boolean
    export_id?: string
    issued_at?: string
    issued_to?: string
    zip_hash_matches?: boolean
    manifest_hash_matches?: boolean
  }
}

const STATUS_STYLE: Record<string, { box: string; title: string; text: string; Icon: typeof ShieldCheck }> = {
  VERIFIED: {
    box: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    title: 'Integrity verified',
    text: 'Every file matches its recorded SHA-256 and the bundle is identical to what this system issued.',
    Icon: ShieldCheck,
  },
  UNREGISTERED: {
    box: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    title: 'Internally consistent, but not issued by this system',
    text: 'The files match their own hashes, yet this installation has no record of issuing the bundle. Treat its origin as unconfirmed.',
    Icon: ShieldQuestion,
  },
  TAMPERED: {
    box: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400',
    title: 'Tampering detected',
    text: 'At least one file does not match its recorded hash. Do not rely on this bundle as evidence.',
    Icon: ShieldAlert,
  },
  INVALID: {
    box: 'border-slate-400/30 bg-slate-500/10 text-slate-600 dark:text-slate-300',
    title: 'Not a TraceNet evidence bundle',
    text: 'The archive has no manifest or hash list.',
    Icon: FileWarning,
  },
  MISSING: {
    box: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400',
    title: 'Bundle file missing from disk',
    text: 'The sealed archive can no longer be found on the server.',
    Icon: FileWarning,
  },
}

export function VerificationPanel({ result }: { result: VerificationResult }) {
  const style = STATUS_STYLE[result.status] ?? STATUS_STYLE.INVALID
  const { Icon } = style
  return (
    <div className={`rounded-lg border p-3.5 space-y-2 text-xs ${style.box}`}>
      <div className="flex items-center gap-2 font-bold text-sm">
        <Icon className="h-4 w-4 shrink-0" />
        {style.title}
      </div>
      <p className="text-[11px] leading-snug opacity-90">{style.text}</p>

      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10.5px] font-mono opacity-90">
        {result.manifest?.export_id && <span>Export: {result.manifest.export_id}</span>}
        {result.checked_files !== undefined && <span>Files checked: {result.checked_files}</span>}
        {result.registry?.found && <span>Issued to: {result.registry.issued_to}</span>}
        {result.registry?.found && (
          <span>Archive bytes: {result.registry.zip_hash_matches ? 'identical' : 'differ from issued copy'}</span>
        )}
      </div>
      {result.zip_sha256 && <div className="text-[10px] font-mono break-all opacity-80">SHA-256: {result.zip_sha256}</div>}

      {(result.mismatches?.length ?? 0) > 0 && (
        <ul className="list-disc pl-4 text-[10.5px] font-mono">
          {result.mismatches!.map(m => <li key={m.path}>Modified: {m.path}</li>)}
        </ul>
      )}
      {(result.missing?.length ?? 0) > 0 && (
        <ul className="list-disc pl-4 text-[10.5px] font-mono">
          {result.missing!.map(p => <li key={p}>Missing: {p}</li>)}
        </ul>
      )}
      {(result.unlisted?.length ?? 0) > 0 && (
        <ul className="list-disc pl-4 text-[10.5px] font-mono">
          {result.unlisted!.map(p => <li key={p}>Unlisted extra file: {p}</li>)}
        </ul>
      )}
      {(result.problems?.length ?? 0) > 0 && (
        <ul className="list-disc pl-4 text-[10.5px]">
          {result.problems!.map(p => <li key={p}>{p}</li>)}
        </ul>
      )}
    </div>
  )
}
