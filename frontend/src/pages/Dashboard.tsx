import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

interface DashboardProps {
  metrics: {
    totalCameras: number
    totalVideos: number
    processedVideos: number
    pendingVideos: number
    failedVideos: number
  }
}

const pipelineStages = [
  { name: 'Ingestion API & Sandbox', desc: 'Accepts video files and records their source and alignment metadata.', status: 'Online', icon: '↓' },
  { name: 'FFmpeg Transcoder', desc: 'Standardizes video to 720p H.264 at 10 FPS for indexing.', status: 'Ready', icon: '▶' },
  { name: 'OpenCV Frame Sampler', desc: 'Samples the standardized timeline at four frames per second.', status: 'Ready', icon: '▥' },
  { name: 'Detection & Tracking', desc: 'Detects people and vehicles, assigns track IDs, and prepares tracklets for review.', status: 'Active', icon: '⌗' },
]

export default function Dashboard({ metrics }: DashboardProps) {
  const { t } = useTranslation()
  const [assistantPrompt, setAssistantPrompt] = useState('')
  const metricCards = [
    { label: t('dashboard.cameraNodes'), value: metrics.totalCameras, detail: t('dashboard.cameraNodesDetail') },
    { label: t('dashboard.videoFeeds'), value: metrics.totalVideos, detail: t('dashboard.videoFeedsDetail') },
    { label: t('dashboard.standardized'), value: metrics.processedVideos, detail: t('dashboard.standardizedDetail') },
    { label: t('dashboard.inQueue'), value: metrics.pendingVideos, detail: metrics.failedVideos ? `${metrics.failedVideos} failed` : t('dashboard.inQueueDetail'), warning: metrics.pendingVideos > 0 },
  ]
  const prompts = [
    { text: 'Show me everyone near Gate 3 between 5 PM and 7 PM', tag: 'Search' },
    { text: 'Track a person in a red jacket across cameras', tag: 'Multi-camera' },
    { text: 'List unacknowledged theft and assault alerts', tag: 'Alerts' },
  ]
  const openAssistant = (prompt = '') => {
    window.dispatchEvent(new CustomEvent('tracenet:open-copilot', { detail: { prompt } }))
    setAssistantPrompt('')
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-5 pb-10 text-slate-800 dark:text-slate-100">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{t('dashboard.category')}</p>
          <h1 className="text-xl font-semibold tracking-tight text-slate-800 dark:text-slate-100">{t('dashboard.title')}</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t('dashboard.subtitle')}</p>
        </div>
        <Link to="/cameras" className="inline-flex h-9 items-center gap-2 rounded border border-teal-700 bg-teal-700 px-3 text-sm font-medium text-white hover:bg-teal-800">
          {t('dashboard.viewCameraRegistry')} <span aria-hidden="true">→</span>
        </Link>
      </div>

      <section aria-label="System metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map((card) => (
          <div key={card.label} className="rounded border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{card.label}</p>
                <p className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${card.warning ? 'text-amber-700 dark:text-amber-400' : 'text-slate-800 dark:text-slate-100'}`}>{card.value}</p>
              </div>
              <span className={`mt-1 h-2 w-2 rounded-full ${card.warning ? 'bg-amber-500' : 'bg-teal-700'}`} />
            </div>
            <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">{card.detail}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col justify-between gap-3 rounded border border-teal-200 bg-teal-50/60 p-4 dark:border-teal-900 dark:bg-teal-950/30 sm:flex-row sm:items-center">
        <div className="flex items-start gap-3">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-teal-700" />
          <div>
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('dashboard.liveCameraTools')}</h2>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{t('dashboard.liveCameraToolsDesc')}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/cameras/CAM_001/live" className="inline-flex h-8 items-center rounded border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">Watch CAM_001</Link>
          <Link to="/cameras" className="inline-flex h-8 items-center rounded border border-teal-700 bg-teal-700 px-3 text-xs font-medium text-white hover:bg-teal-800">{t('dashboard.broadcastFeed')}</Link>
        </div>
      </section>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
        <section className="rounded border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div>
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('dashboard.pipeline')}</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('dashboard.pipelineDesc')}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />{t('dashboard.operational')}</span>
          </div>
          <div className="divide-y divide-slate-100 px-4 dark:divide-slate-700">
            {pipelineStages.map((stage, index) => (
              <div key={stage.name} className="flex items-center gap-3 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-50 font-mono text-sm text-teal-700 dark:border-slate-600 dark:bg-slate-900 dark:text-teal-300">{stage.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="text-sm font-medium text-slate-800 dark:text-slate-100">{stage.name}</h3>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">{t('dashboard.stage')} {index + 1}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{stage.desc}</p>
                </div>
                <span className="shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-300">{stage.status}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="space-y-4">
          <section className="overflow-hidden rounded border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <div>
                <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">AI operational assistant</h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Search footage and review operations.</p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"><span className="h-1.5 w-1.5 rounded-full bg-teal-600" />Ready</span>
            </div>
            <div className="space-y-3 p-4">
              <div className="rounded border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                <p className="text-xs leading-5 text-slate-700 dark:text-slate-200">Ask about cameras, footage, or alerts. The assistant can search records and explain its findings.</p>
                <form onSubmit={(event) => { event.preventDefault(); if (assistantPrompt.trim()) openAssistant(assistantPrompt.trim()) }} className="mt-3 flex gap-2">
                  <input value={assistantPrompt} onChange={(event) => setAssistantPrompt(event.target.value)} aria-label="Ask the operational assistant" placeholder="Ask a question…" className="h-9 min-w-0 flex-1 rounded border border-slate-300 bg-white px-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500" />
                  <button type="submit" disabled={!assistantPrompt.trim()} className="h-9 shrink-0 rounded bg-teal-700 px-3 text-xs font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50">Ask</button>
                </form>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Try asking</p>
                  <button onClick={() => openAssistant()} className="text-[11px] font-medium text-teal-700 hover:underline dark:text-teal-300">Open chat</button>
                </div>
                {prompts.map((prompt) => (
                  <button key={prompt.text} onClick={() => openAssistant(prompt.text)} className="flex w-full items-start justify-between gap-2 rounded border border-slate-200 px-3 py-2 text-left hover:border-teal-300 hover:bg-teal-50/50 dark:border-slate-600 dark:hover:bg-slate-700">
                    <span className="text-xs leading-5 text-slate-700 dark:text-slate-200">{prompt.text}</span><span className="shrink-0 pt-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">{prompt.tag}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-600" />
              <h2 className="text-xs font-semibold text-slate-700 dark:text-slate-200">Audit logging active</h2>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">Search activity is recorded in the local audit database.</p>
            <p className="mt-2 border-t border-slate-100 pt-2 font-mono text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">Target database: <span className="font-semibold text-teal-700 dark:text-teal-300">drishti.db</span></p>
          </section>
        </div>
      </div>
    </div>
  )
}
