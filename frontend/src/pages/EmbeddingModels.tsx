import { useState, useEffect } from 'react'

const API_BASE = 'http://localhost:8000'

interface EmbeddingModel {
  id: string
  name: string
  architecture: string
  pretrained: string
  dimension: number
  framework: string
  description: string
  category: string
  is_active: boolean
}

export default function EmbeddingModels() {
  const [models, setModels] = useState<EmbeddingModel[]>([])
  const [activeModel, setActiveModel] = useState<EmbeddingModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [activatingId, setActivatingId] = useState<string | null>(null)
  const [reindexing, setReindexing] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')

  const fetchEmbeddingModels = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/v1/embedding-models`)
      if (!res.ok) throw new Error('Failed to load embedding models registry.')
      const json = await res.json()
      setModels(json.models || [])
      setActiveModel(json.active_model || null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error fetching embedding models.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchEmbeddingModels()
  }, [])

  const handleSelectModel = async (modelId: string) => {
    setActivatingId(modelId)
    setStatusMessage('')
    try {
      const res = await fetch(`${API_BASE}/api/v1/embedding-models/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: modelId }),
      })
      if (!res.ok) throw new Error('Failed to switch active embedding model.')
      const json = await res.json()
      setActiveModel(json.active_model)
      setStatusMessage(`Activated model: ${json.active_model.name}. Re-indexing recommended.`)
      await fetchEmbeddingModels()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to select embedding model.')
    } finally {
      setActivatingId(null)
    }
  }

  const handleReindexAll = async () => {
    if (!window.confirm('Re-indexing will re-generate Qdrant vector embeddings for all ingested tracklets using the active model. Continue?')) {
      return
    }
    setReindexing(true)
    setStatusMessage('')
    try {
      const res = await fetch(`${API_BASE}/api/v1/embedding-models/reindex`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Re-indexing failed.')
      const json = await res.json()
      setStatusMessage(json.message || `Successfully re-indexed ${json.reindexed_count} video tracklets.`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Re-indexing failed.')
    } finally {
      setReindexing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] gap-2 text-sm text-slate-500">
        <svg className="animate-spin h-5 w-5 text-teal-600" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading Embedding Models Registry...
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-200 text-sm font-sans">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">Semantic Embedding Models Registry</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Configure contrastive visual-text encoders powering TraceNet NL CLIP search &amp; vector indexing
          </p>
        </div>

        <button
          onClick={handleReindexAll}
          disabled={reindexing}
          className="bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white font-bold text-xs px-4 py-2 rounded-md transition-all shadow-sm flex items-center gap-2 self-start sm:self-auto"
        >
          {reindexing ? (
            <>
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Re-indexing Vector DB...
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Re-index All Tracklets
            </>
          )}
        </button>
      </div>

      {/* Status / Error Alerts */}
      {statusMessage && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-xs font-semibold rounded-md flex items-center justify-between">
          <span>{statusMessage}</span>
          <button onClick={() => setStatusMessage('')} className="text-emerald-800 dark:text-emerald-300 font-bold ml-2">✕</button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-400 text-xs font-semibold rounded-md flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-rose-800 dark:text-rose-300 font-bold ml-2">✕</button>
        </div>
      )}

      {/* Active Model Banner */}
      {activeModel && (
        <div className="bg-white dark:bg-slate-900 border-2 border-teal-600 dark:border-teal-500 rounded-xl p-5 shadow-xs space-y-3 relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-teal-600 text-white text-[10px] font-bold px-3 py-1 rounded-bl uppercase tracking-wider">
            Active Embedding Engine
          </div>

          <div className="flex items-center gap-3">
            <div className="h-3 w-3 rounded-full bg-teal-500 animate-pulse shrink-0" />
            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">{activeModel.name}</h2>
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {activeModel.description}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
            <div className="bg-slate-50 dark:bg-slate-900 p-2.5 rounded border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Architecture</span>
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{activeModel.architecture}</span>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900 p-2.5 rounded border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Vector Dimension</span>
              <span className="font-mono font-bold text-teal-700 dark:text-teal-400">{activeModel.dimension}-dim</span>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900 p-2.5 rounded border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Pretrained Weights</span>
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{activeModel.pretrained}</span>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900 p-2.5 rounded border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Framework</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">{activeModel.framework}</span>
            </div>
          </div>
        </div>
      )}

      {/* Grid of Models */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Available Embedding Models ({models.length})</h3>

        <div className="grid md:grid-cols-2 gap-4">
          {models.map((m) => {
            const isActive = m.is_active || (activeModel?.id === m.id)
            const isActivating = activatingId === m.id

            return (
              <div
                key={m.id}
                className={`bg-white dark:bg-slate-900 border rounded-xl p-4 flex flex-col justify-between space-y-4 transition-all shadow-xs ${
                  isActive
                    ? 'border-teal-500 ring-1 ring-teal-500/30 shadow-sm'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/30 px-1.5 py-0.5 rounded border border-teal-200 dark:border-teal-800">
                        {m.category}
                      </span>
                      <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-1">{m.name}</h4>
                    </div>

                    <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 shrink-0">
                      {m.dimension}d
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {m.description}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 pt-1">
                    <span>Arch: <strong>{m.architecture}</strong></span>
                    <span>Weights: <strong>{m.pretrained}</strong></span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">{m.framework}</span>

                  {isActive ? (
                    <span className="text-xs font-bold text-teal-700 dark:text-teal-400 flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-teal-500 inline-block" />
                      Active Model
                    </span>
                  ) : (
                    <button
                      onClick={() => handleSelectModel(m.id)}
                      disabled={isActivating || reindexing}
                      className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-teal-700 hover:text-white dark:hover:bg-teal-600 text-slate-700 dark:text-slate-200 text-xs font-bold rounded transition-all border border-slate-200 dark:border-slate-600 disabled:opacity-50"
                    >
                      {isActivating ? 'Activating...' : 'Activate Model'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

    </div>
  )
}
