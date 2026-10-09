import React, { useEffect, useState } from 'react'
import { Play, RefreshCw } from 'lucide-react'
import { useToast } from './Toast'
import { API_BASE } from '../config/api'
import { formatDisplayDate } from '../utils/dateFormatter'

// ─── API contracts (mirror backend/app/api/multicam.py LUMPI section) ───────────
interface LumpiExperiment {
  experiment_id: number
  camera_sessions: string[]
  camera_count: number
  label_rows: number
  has_video: boolean
}

interface LumpiStatus {
  status: 'ready' | 'standby'
  dataset_path: string
  is_available: boolean
  dataset_kind: 'lumpi' | 'synthetic' | 'missing' | 'unknown'
  experiments: LumpiExperiment[]
  last_report_generated_at: string | null
  last_report_experiment_id: number | null
}

interface ClassMetrics {
  gt_links: number
  tp: number
  fp: number
  fn: number
  idsw: number
  precision: number
  recall: number
  f1: number
}

interface AuditedExample {
  target_ground_truth_id: number
  object_type: string
  lumpi_class: number
  ground_truth_cams: string[]
  ground_truth_transitions_count: number
  ground_truth_handovers: number
  reconstructed_cams: string[]
  reconstructed_gt_ids: number[]
  candidate_count: number
  status: 'PERFECT_MATCH' | 'PARTIAL_OR_SWITCH'
  tp_links: number
  fp_links: number
  fn_links: number
  mean_transit_error_seconds: number | null
}

interface LumpiReport {
  status: string
  generated_at?: string
  dataset_path: string
  dataset_kind?: string
  evaluation_mode?: 'projection' | 'nearest-camera'
  experiment_id: number
  cameras_evaluated: number
  camera_sessions?: { camera_id: string; device_id: number; fps: number; image_size: [number, number]; sightings: number }[]
  observations_count?: number
  objects_count?: number
  multi_camera_targets_count: number
  total_ground_truth_transitions: number
  total_reconstructed_links: number
  metrics: {
    link_precision: number
    link_recall: number
    link_f1_score: number
    total_true_positives: number
    total_false_positives: number
    total_false_negatives: number
    identity_switches: number
    mean_transit_time_error_seconds: number
    route_continuity_rate: number
  }
  class_breakdown: Record<'person' | 'vehicle', ClassMetrics>
  similarity_profile?: {
    mean_same_object_similarity: number | null
    mean_best_impostor_similarity: number | null
    impostors_above_gate_ratio: number | null
  }
  weights_configuration: Record<string, number>
  tuning_recommendations: string[]
  summary_text: string
  audited_examples: AuditedExample[]
}

interface RunParams {
  experiment_id: number
  min_visual_similarity: number
  visual_weight: number
  temporal_weight: number
  spatial_weight: number
  embedding_noise_sigma: number
  handover_radius_m: number
}

const DEFAULT_PARAMS: RunParams = {
  experiment_id: 1,
  min_visual_similarity: 0.45,
  visual_weight: 0.55,
  temporal_weight: 0.25,
  spatial_weight: 0.2,
  embedding_noise_sigma: 0.05,
  handover_radius_m: 15,
}

const LUMPI_CLASS_LABEL: Record<number, string> = {
  0: 'pedestrian', 1: 'car', 2: 'bicycle', 3: 'motorcycle', 4: 'bus', 5: 'truck', 6: 'van', 7: 'unknown',
}

const pct = (v: number | null | undefined, digits = 1) => (v == null ? '—' : `${(v * 100).toFixed(digits)}%`)
const num = (v: number | null | undefined, digits = 2) => (v == null ? '—' : v.toFixed(digits))

const inputCls =
  'w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs focus:outline-none focus:border-sky-500 disabled:opacity-50'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-slate-500 leading-snug">{hint}</span>}
    </label>
  )
}

function KpiTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const toneCls =
    tone === 'good' ? 'text-emerald-700 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/5'
    : tone === 'warn' ? 'text-amber-700 dark:text-amber-400 border-amber-500/30 bg-amber-500/5'
    : tone === 'bad' ? 'text-rose-700 dark:text-rose-400 border-rose-500/30 bg-rose-500/5'
    : 'text-sky-700 dark:text-sky-300 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900'
  return (
    <div className={`rounded-xl border px-4 py-3 ${toneCls}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}

const toneForRate = (v: number, good: number, warn: number): 'good' | 'warn' | 'bad' => (v >= good ? 'good' : v >= warn ? 'warn' : 'bad')

// ─── Component ─────────────────────────────────────────────────────────────────
export const LumpiBenchmarkPanel: React.FC = () => {
  const toast = useToast()
  const [status, setStatus] = useState<LumpiStatus | null>(null)
  const [report, setReport] = useState<LumpiReport | null>(null)
  const [params, setParams] = useState<RunParams>(DEFAULT_PARAMS)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [running, setRunning] = useState(false)
  const [auditFilter, setAuditFilter] = useState<'all' | 'issues'>('issues')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [sRes, rRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/multicam/evaluation/lumpi/status`),
          fetch(`${API_BASE}/api/v1/multicam/evaluation/lumpi/report`),
        ])
        if (cancelled) return
        if (sRes.ok) {
          const s: LumpiStatus = await sRes.json()
          setStatus(s)
          if (s.experiments?.length && !s.experiments.some((e) => e.experiment_id === DEFAULT_PARAMS.experiment_id)) {
            setParams((p) => ({ ...p, experiment_id: s.experiments[0].experiment_id }))
          }
        }
        if (rRes.ok) {
          const r: LumpiReport = await rRes.json()
          setReport(r)
          if (r.weights_configuration) {
            setParams((p) => ({
              ...p,
              experiment_id: r.experiment_id ?? p.experiment_id,
              min_visual_similarity: r.weights_configuration.min_visual_similarity ?? p.min_visual_similarity,
              visual_weight: r.weights_configuration.visual_weight ?? p.visual_weight,
              temporal_weight: r.weights_configuration.temporal_weight ?? p.temporal_weight,
              spatial_weight: r.weights_configuration.spatial_weight ?? p.spatial_weight,
              embedding_noise_sigma: r.weights_configuration.embedding_noise_sigma ?? p.embedding_noise_sigma,
              handover_radius_m: r.weights_configuration.handover_radius_m ?? p.handover_radius_m,
            }))
          }
        }
      } catch (e) {
        console.error('LUMPI status load failed:', e)
      } finally {
        if (!cancelled) setLoadingStatus(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const setNum = (key: keyof RunParams) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = parseFloat(e.target.value)
    setParams((p) => ({ ...p, [key]: Number.isFinite(v) ? v : p[key] }))
  }

  const weightSum = params.visual_weight + params.temporal_weight + params.spatial_weight
  const weightsValid = weightSum > 0 && params.min_visual_similarity >= 0 && params.min_visual_similarity <= 1

  const runBenchmark = async () => {
    if (!weightsValid) {
      toast.warning('Invalid parameters', 'Weights must sum above zero and the similarity gate must lie in [0, 1].')
      return
    }
    setRunning(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/multicam/evaluation/lumpi/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `Benchmark failed (${res.status})`)
      }
      const r: LumpiReport = await res.json()
      setReport(r)
      setStatus((s) => (s ? { ...s, last_report_generated_at: r.generated_at ?? s.last_report_generated_at, last_report_experiment_id: r.experiment_id } : s))
      toast.success('Benchmark complete', r.summary_text)
    } catch (e: any) {
      toast.error('Benchmark failed', e.message || 'Unknown error')
    } finally {
      setRunning(false)
    }
  }

  const resetDefaults = () => setParams((p) => ({ ...DEFAULT_PARAMS, experiment_id: p.experiment_id }))

  const datasetBadge = (() => {
    const kind = status?.dataset_kind
    if (kind === 'lumpi') return { text: 'REAL LUMPI CALIBRATED DATA', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30' }
    if (kind === 'synthetic') return { text: 'SYNTHETIC SAMPLE SEQUENCE', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30' }
    if (kind === 'missing') return { text: 'DATASET MISSING', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30' }
    return { text: 'UNKNOWN DATASET', cls: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700' }
  })()

  const metrics = report?.metrics
  const audits = report?.audited_examples ?? []
  const visibleAudits = auditFilter === 'issues' ? audits.filter((a) => a.status !== 'PERFECT_MATCH') : audits
  const selectedExperiment = status?.experiments.find((e) => e.experiment_id === params.experiment_id)

  return (
    <div className="h-full w-full overflow-y-auto bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div className="max-w-7xl mx-auto px-6 py-5 space-y-5">

        {/* ── Header / dataset status ── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              LUMPI Multi-Camera Benchmark
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${datasetBadge.cls}`}>
                {loadingStatus ? 'LOADING…' : datasetBadge.text}
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-3xl leading-relaxed">
              Scores TraceNet's cross-camera journey linking against the LUMPI intersection ground truth
              (<a className="text-sky-700 dark:text-sky-400 hover:underline" href="https://github.com/St3ff3nBusch/LUMPI-SDK-Python" target="_blank" rel="noreferrer">LUMPI-SDK-Python</a>, MIT).
              Visual embeddings are synthetic identity vectors with controllable noise, so this benchmark measures the
              spatiotemporal feasibility and DAG linking logic, not the CLIP re-identification model.
            </p>
          </div>
          <div className="text-right text-[11px] text-slate-500 space-y-0.5">
            <div>Dataset: <span className="font-mono text-slate-700 dark:text-slate-300 break-all">{status?.dataset_path ?? '—'}</span></div>
            <div>
              Last report: <span className="text-slate-700 dark:text-slate-300">{status?.last_report_generated_at ? formatDisplayDate(status.last_report_generated_at) : 'none yet'}</span>
              {status?.last_report_experiment_id != null && <span className="text-slate-500"> (exp {status.last_report_experiment_id})</span>}
            </div>
          </div>
        </div>

        {/* ── Controls ── */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <Field label="Experiment" hint={selectedExperiment ? `${selectedExperiment.camera_count} cams · ${selectedExperiment.label_rows} labels${selectedExperiment.has_video ? ' · video' : ''}` : undefined}>
              <select value={params.experiment_id} onChange={setNum('experiment_id')} className={inputCls} disabled={running || !status?.experiments.length}>
                {(status?.experiments ?? [{ experiment_id: params.experiment_id, camera_sessions: [], camera_count: 0, label_rows: 0, has_video: false }]).map((e) => (
                  <option key={e.experiment_id} value={e.experiment_id}>Measurement {e.experiment_id}</option>
                ))}
              </select>
            </Field>
            <Field label="Visual noise σ" hint={`same-object cos ≈ ${(1 / (1 + params.embedding_noise_sigma ** 2)).toFixed(2)}`}>
              <input type="number" step="0.05" min="0" max="3" value={params.embedding_noise_sigma} onChange={setNum('embedding_noise_sigma')} className={inputCls} disabled={running} />
            </Field>
            <Field label="Similarity gate" hint="min cosine to be a candidate">
              <input type="number" step="0.05" min="0" max="1" value={params.min_visual_similarity} onChange={setNum('min_visual_similarity')} className={inputCls} disabled={running} />
            </Field>
            <Field label="Visual weight">
              <input type="number" step="0.05" min="0" max="1" value={params.visual_weight} onChange={setNum('visual_weight')} className={inputCls} disabled={running} />
            </Field>
            <Field label="Temporal weight">
              <input type="number" step="0.05" min="0" max="1" value={params.temporal_weight} onChange={setNum('temporal_weight')} className={inputCls} disabled={running} />
            </Field>
            <Field label="Spatial weight">
              <input type="number" step="0.05" min="0" max="1" value={params.spatial_weight} onChange={setNum('spatial_weight')} className={inputCls} disabled={running} />
            </Field>
            <Field label="Handover radius (m)" hint="max jump for same-time handover">
              <input type="number" step="1" min="0" max="200" value={params.handover_radius_m} onChange={setNum('handover_radius_m')} className={inputCls} disabled={running} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="text-[11px] text-slate-500">
              Weights sum to <span className={`font-mono ${weightsValid ? 'text-slate-700 dark:text-slate-300' : 'text-rose-700 dark:text-rose-400'}`}>{weightSum.toFixed(2)}</span>
              {status?.dataset_kind === 'lumpi' && <span> · sightings attributed by projecting LUMPI 3D labels through each camera's calibration</span>}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={resetDefaults} disabled={running} className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50">
                Reset defaults
              </button>
              <button
                type="button"
                onClick={runBenchmark}
                disabled={running || !status?.is_available}
                className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold transition-all disabled:opacity-50"
              >
                {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                {running ? 'Running…' : 'Run Benchmark'}
              </button>
            </div>
          </div>
        </section>

        {/* ── Results ── */}
        {!report ? (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 py-16 text-center text-xs text-slate-500">
            {loadingStatus ? 'Loading benchmark state…' : 'No evaluation report yet. Choose an experiment and run the benchmark.'}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300">Exp {report.experiment_id}</span>
              <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300">{report.evaluation_mode ?? 'nearest-camera'} attribution</span>
              <span>{report.cameras_evaluated} cameras · {report.observations_count ?? '—'} sightings · {report.objects_count ?? '—'} objects · {report.multi_camera_targets_count} multi-camera targets · {report.total_ground_truth_transitions} ground-truth links</span>
              {report.generated_at && <span className="ml-auto">generated {formatDisplayDate(report.generated_at)}</span>}
            </div>

            {metrics && (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <KpiTile label="Link precision" value={pct(metrics.link_precision)} sub={`${metrics.total_true_positives} TP · ${metrics.total_false_positives} FP`} tone={toneForRate(metrics.link_precision, 0.85, 0.6)} />
                <KpiTile label="Link recall" value={pct(metrics.link_recall)} sub={`${metrics.total_false_negatives} missed links`} tone={toneForRate(metrics.link_recall, 0.75, 0.5)} />
                <KpiTile label="F1 score" value={num(metrics.link_f1_score, 3)} tone={toneForRate(metrics.link_f1_score, 0.8, 0.55)} />
                <KpiTile label="Identity switches" value={String(metrics.identity_switches)} sub="wrong-object links" tone={metrics.identity_switches === 0 ? 'good' : metrics.identity_switches <= 2 ? 'warn' : 'bad'} />
                <KpiTile label="Transit time error" value={`${num(metrics.mean_transit_time_error_seconds)}s`} sub="mean vs ground truth" tone={metrics.mean_transit_time_error_seconds <= 2 ? 'good' : metrics.mean_transit_time_error_seconds <= 5 ? 'warn' : 'bad'} />
                <KpiTile label="Route continuity" value={pct(metrics.route_continuity_rate, 0)} sub="targets fully recovered" tone={toneForRate(metrics.route_continuity_rate, 0.6, 0.3)} />
              </div>
            )}

            <div className="grid lg:grid-cols-3 gap-4">
              {/* Class breakdown */}
              <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Per-class link quality</div>
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                    <tr><th className="text-left px-4 py-2">Class</th><th className="text-right px-2 py-2">GT links</th><th className="text-right px-2 py-2">P</th><th className="text-right px-2 py-2">R</th><th className="text-right px-4 py-2">F1</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {(['person', 'vehicle'] as const).map((k) => {
                      const m = report.class_breakdown?.[k]
                      if (!m) return null
                      return (
                        <tr key={k}>
                          <td className="px-4 py-2 capitalize text-slate-800 dark:text-slate-200">{k}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{m.gt_links}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{m.gt_links ? pct(m.precision, 0) : '—'}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{m.gt_links ? pct(m.recall, 0) : '—'}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{m.gt_links ? num(m.f1, 3) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {report.similarity_profile && (
                  <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Visual separability</div>
                    <div className="flex justify-between"><span>Same-object similarity</span><span className="font-mono text-slate-800 dark:text-slate-200">{num(report.similarity_profile.mean_same_object_similarity, 3)}</span></div>
                    <div className="flex justify-between"><span>Best impostor similarity</span><span className="font-mono text-slate-800 dark:text-slate-200">{num(report.similarity_profile.mean_best_impostor_similarity, 3)}</span></div>
                    <div className="flex justify-between"><span>Impostors above gate</span><span className="font-mono text-slate-800 dark:text-slate-200">{pct(report.similarity_profile.impostors_above_gate_ratio, 0)}</span></div>
                  </div>
                )}
              </section>

              {/* Cameras */}
              <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Camera sessions in this experiment</div>
                {report.camera_sessions?.length ? (
                  <table className="w-full text-xs">
                    <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                      <tr><th className="text-left px-4 py-2">Session</th><th className="text-right px-2 py-2">Device</th><th className="text-right px-2 py-2">FPS</th><th className="text-right px-2 py-2">Frame</th><th className="text-right px-4 py-2">Sightings</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {report.camera_sessions.map((c) => (
                        <tr key={c.camera_id}>
                          <td className="px-4 py-2 font-mono text-sky-700 dark:text-sky-300">{c.camera_id}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{c.device_id}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{c.fps.toFixed(1)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{c.image_size[0]}×{c.image_size[1]}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{c.sightings}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="px-4 py-6 text-xs text-slate-500">Camera details not present in this report (generated by an older version). Re-run the benchmark.</div>
                )}
              </section>

              {/* Recommendations */}
              <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Tuning findings</div>
                <ul className="px-4 py-3 space-y-2 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  {report.tuning_recommendations.map((r, i) => (
                    <li key={i} className="flex gap-2"><span className="text-sky-700 dark:text-sky-400 shrink-0">▸</span><span>{r}</span></li>
                  ))}
                </ul>
                <div className="px-4 pb-3 text-[10px] text-slate-500 leading-relaxed border-t border-slate-200 dark:border-slate-800 pt-2">
                  Human review remains mandatory. These scores describe linking consistency on a benchmark and never assert an identity match on operational footage.
                </div>
              </section>
            </div>

            {/* Audit trail */}
            <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Per-target audit — {visibleAudits.length} of {audits.length} targets
                </div>
                <div className="flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-300 dark:border-slate-700 text-[11px]">
                  <button type="button" onClick={() => setAuditFilter('issues')} className={`px-2.5 py-1 rounded-md font-medium ${auditFilter === 'issues' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}>Issues only</button>
                  <button type="button" onClick={() => setAuditFilter('all')} className={`px-2.5 py-1 rounded-md font-medium ${auditFilter === 'all' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}>All</button>
                </div>
              </div>
              <div className="max-h-[420px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white dark:bg-slate-900 text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="text-left px-4 py-2">Target</th>
                      <th className="text-left px-2 py-2">Class</th>
                      <th className="text-left px-2 py-2">Ground-truth cameras</th>
                      <th className="text-left px-2 py-2">Reconstructed route</th>
                      <th className="text-right px-2 py-2">Cand.</th>
                      <th className="text-right px-2 py-2">TP / FP / FN</th>
                      <th className="text-right px-4 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {visibleAudits.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">{auditFilter === 'issues' ? 'Every multi-camera target was reconstructed perfectly.' : 'No multi-camera targets in this experiment.'}</td></tr>
                    ) : visibleAudits.map((a) => (
                      <tr key={a.target_ground_truth_id} className="hover:bg-slate-100 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2 font-mono text-slate-800 dark:text-slate-200">#{a.target_ground_truth_id}</td>
                        <td className="px-2 py-2 text-slate-700 dark:text-slate-300">{LUMPI_CLASS_LABEL[a.lumpi_class] ?? a.object_type}<span className="text-slate-500"> · {a.object_type}</span></td>
                        <td className="px-2 py-2 font-mono text-slate-700 dark:text-slate-300">{a.ground_truth_cams.join(' → ')}{a.ground_truth_handovers > 0 && <span className="text-slate-500 font-sans"> ({a.ground_truth_handovers} handover{a.ground_truth_handovers !== 1 ? 's' : ''})</span>}</td>
                        <td className="px-2 py-2 font-mono">
                          {a.reconstructed_cams.map((c, i) => {
                            const wrong = a.reconstructed_gt_ids[i] !== a.target_ground_truth_id
                            return (
                              <span key={i}>
                                {i > 0 && <span className="text-slate-400 dark:text-slate-600"> → </span>}
                                <span className={wrong ? 'text-rose-700 dark:text-rose-400' : 'text-slate-700 dark:text-slate-300'} title={wrong ? `object #${a.reconstructed_gt_ids[i]} (identity switch)` : undefined}>{c}{wrong ? '!' : ''}</span>
                              </span>
                            )
                          })}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{a.candidate_count}</td>
                        <td className="px-2 py-2 text-right tabular-nums"><span className="text-emerald-700 dark:text-emerald-400">{a.tp_links}</span><span className="text-slate-400 dark:text-slate-600"> / </span><span className={a.fp_links ? 'text-rose-700 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}>{a.fp_links}</span><span className="text-slate-400 dark:text-slate-600"> / </span><span className={a.fn_links ? 'text-amber-700 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}>{a.fn_links}</span></td>
                        <td className="px-4 py-2 text-right">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${a.status === 'PERFECT_MATCH' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
                            {a.status === 'PERFECT_MATCH' ? 'PERFECT' : a.fp_links > 0 ? 'ID SWITCH' : 'PARTIAL'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

export default LumpiBenchmarkPanel
