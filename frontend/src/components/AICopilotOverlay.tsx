import React, { useState, useEffect, useRef } from 'react'
import {
  Sparkles,
  X,
  Send,
  Upload,
  Bot,
  User,
  Settings,
  RefreshCw,
  Cpu,
  Play,
  Clock,
  Search as SearchIcon,
  ChevronRight,
} from 'lucide-react'

const API_BASE = 'http://localhost:8000'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  image_b64?: string
  executed_tools?: Array<{ name: string; args: any; result_count?: number }>
  attachments?: any[]
}

interface AICopilotOverlayProps {
  isOpen: boolean
  onClose: () => void
  onPlayVideoAtTime: (
    video: any,
    timestamp: number,
    trackerId?: number | string,
    bestBbox?: number[],
    className?: string
  ) => void
}

export default function AICopilotOverlay({
  isOpen,
  onClose,
  onPlayVideoAtTime,
}: AICopilotOverlayProps) {
  const [messages, setMessages]               = useState<ChatMessage[]>([])
  const [inputPrompt, setInputPrompt]         = useState('')
  const [referenceFile, setReferenceFile]     = useState<File | null>(null)
  const [referencePreview, setReferencePreview] = useState<string | null>(null)
  const [referenceB64, setReferenceB64]       = useState<string | null>(null)
  const [loading, setLoading]                 = useState(false)
  const [errorMsg, setErrorMsg]               = useState('')

  // Settings Modal State
  const [isSettingsOpen, setIsSettingsOpen]   = useState(false)
  const [config, setConfig]                   = useState({
    provider: 'ollama',
    ollama_host: 'http://localhost:11434',
    ollama_model: 'qwen2.5-vl:3b',
    cloud_api_key: '',
    cloud_model: 'gpt-4o-mini',
  })
  const [savingConfig, setSavingConfig]       = useState(false)

  const chatEndRef   = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load config on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/v1/assistant/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setConfig((prev) => ({ ...prev, ...data }))
      })
      .catch(() => {})
  }, [])

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, loading, isOpen])

  // Esc key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (isSettingsOpen) setIsSettingsOpen(false)
        else onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isSettingsOpen, onClose])

  if (!isOpen) return null

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingConfig(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/assistant/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (res.ok) {
        setIsSettingsOpen(false)
      } else {
        alert('Failed to save settings.')
      }
    } catch (_) {
      alert('Network error saving settings.')
    } finally {
      setSavingConfig(false)
    }
  }

  const handleFileSelect = (file: File) => {
    setReferenceFile(file)
    setReferencePreview(URL.createObjectURL(file))
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      const base64Str = result.split(',')[1] || ''
      setReferenceB64(base64Str)
    }
    reader.readAsDataURL(file)
  }

  const handleSendPrompt = async (promptText?: string) => {
    const textToSend = (promptText || inputPrompt).trim()
    if (!textToSend && !referenceB64) return

    const userMsg: ChatMessage = {
      role: 'user',
      content: textToSend || 'Investigate target image:',
      image_b64: referenceB64 || undefined,
    }

    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    setInputPrompt('')
    setReferenceFile(null)
    setReferencePreview(null)
    setReferenceB64(null)
    setLoading(true)
    setErrorMsg('')

    try {
      const payload = {
        messages: updatedMessages.map((m) => ({
          role: m.role,
          content: m.content,
          image_b64: m.image_b64 || null,
        })),
      }

      const res = await fetch(`${API_BASE}/api/v1/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Assistant execution failed')
      }

      const responseData = await res.json()
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: responseData.content || 'Analysis complete.',
          executed_tools: responseData.executed_tools || [],
          attachments: responseData.attachments || [],
        },
      ])
    } catch (err: any) {
      setErrorMsg(err.message || 'Copilot assistant failure.')
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ **Error**: ${err.message || 'Connection failure.'}\n\nPlease check if Ollama is running at \`${config.ollama_host}\` or configure a Cloud API key in Copilot Settings.`,
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  const quickPrompts = [
    'Search for red vehicles across all camera nodes',
    'Show all people near Gate 3 or Railway Station',
    'Check recent loitering and abandoned baggage alerts',
    'List all active smart city camera locations',
  ]

  return (
    <div className="fixed inset-0 z-[150] flex flex-col bg-slate-950/90 backdrop-blur-md text-slate-100 animate-in fade-in duration-200 isolation-isolate">
      
      {/* TOPBAR HEADER */}
      <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-800 bg-slate-900/90 shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-teal-600/20 border border-teal-500/30 flex items-center justify-center text-teal-400 shadow-sm">
            <Sparkles className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-100 tracking-wide">TraceNet AI Copilot</h2>
              <span className="text-[10px] font-mono bg-teal-500/10 text-teal-300 border border-teal-500/30 px-2 py-0.5 rounded font-bold">
                FORENSIC ASSISTANT
              </span>
            </div>
            <p className="text-[10px] text-slate-400">
              Unconstrained natural language agent with tool calling over Qdrant, Cameras, &amp; Alerts.
            </p>
          </div>
        </div>

        {/* Action controls */}
        <div className="flex items-center gap-3">
          {/* Provider badge */}
          <div
            onClick={() => setIsSettingsOpen(true)}
            className="cursor-pointer bg-slate-800 hover:bg-slate-750 border border-slate-700 px-3 py-1.5 rounded-md text-xs flex items-center gap-2 transition-all shadow-sm"
          >
            <Cpu className="h-3.5 w-3.5 text-teal-400" />
            <span className="text-[11px] font-medium text-slate-300">
              Model:{' '}
              <strong className="text-teal-300 font-mono">
                {config.provider === 'ollama' ? config.ollama_model : config.cloud_model}
              </strong>
            </span>
            <Settings className="h-3.5 w-3.5 text-slate-400 hover:text-slate-200 transition-colors" />
          </div>

          <button
            onClick={() => setMessages([])}
            className="text-xs text-slate-400 hover:text-slate-200 bg-slate-800/60 hover:bg-slate-800 px-2.5 py-1.5 rounded transition-all"
            title="Clear Chat History"
          >
            Clear Chat
          </button>

          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* CHAT MESSAGES CONTAINER */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-5xl w-full mx-auto">
        
        {messages.length === 0 && (
          <div className="py-12 text-center space-y-6 max-w-2xl mx-auto">
            <div className="h-16 w-16 rounded-2xl bg-teal-500/10 border border-teal-500/20 text-teal-400 flex items-center justify-center mx-auto shadow-md">
              <Bot className="h-8 w-8" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100">Welcome to TraceNet Global Copilot</h3>
              <p className="text-xs text-slate-400 mt-1">
                Ask any question in natural language or upload a target photo. The AI Copilot autonomously queries video vector indices, camera GIS feeds, and security alerts.
              </p>
            </div>

            {/* Quick Suggestions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-4 text-left">
              {quickPrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendPrompt(prompt)}
                  className="bg-slate-900/80 hover:bg-slate-850 border border-slate-800 hover:border-teal-500/40 p-3 rounded-lg text-xs text-slate-300 hover:text-teal-300 transition-all flex items-center justify-between group shadow-sm"
                >
                  <span className="truncate pr-2">{prompt}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-500 group-hover:text-teal-400 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex gap-3.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="h-8 w-8 rounded-lg bg-teal-600/20 border border-teal-500/30 text-teal-400 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="h-4 w-4" />
              </div>
            )}

            <div
              className={`max-w-3xl space-y-3 ${
                msg.role === 'user'
                  ? 'bg-teal-700 text-white rounded-2xl rounded-tr-xs px-4 py-3 shadow-md'
                  : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-2xl rounded-tl-xs p-5 shadow-md'
              }`}
            >
              {/* Reference image if attached */}
              {msg.image_b64 && (
                <div className="mb-2">
                  <img
                    src={`data:image/jpeg;base64,${msg.image_b64}`}
                    alt="Prompt attachment"
                    className="h-28 w-28 object-cover rounded-md border border-slate-700 shadow-sm"
                  />
                </div>
              )}

              {/* Tool Execution Badges */}
              {msg.executed_tools && msg.executed_tools.length > 0 && (
                <div className="flex flex-wrap gap-2 pb-2 border-b border-slate-800">
                  {msg.executed_tools.map((t, tIdx) => (
                    <span
                      key={tIdx}
                      className="text-[10px] bg-slate-800 border border-slate-700 px-2 py-0.5 rounded text-teal-300 font-mono flex items-center gap-1"
                    >
                      <SearchIcon className="h-2.5 w-2.5 text-teal-400" />
                      Tool: <strong>{t.name}</strong> ({t.result_count} results)
                    </span>
                  ))}
                </div>
              )}

              {/* Message Content */}
              <div className="text-xs leading-relaxed whitespace-pre-wrap font-sans">
                {msg.content}
              </div>

              {/* Embedded Result Attachments (Tracklets) */}
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="pt-3 border-t border-slate-800 space-y-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Matched Forensic Tracklets ({msg.attachments.length})
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {msg.attachments.map((item, aIdx) => {
                      const dwell = Math.max(
                        0.1,
                        (item.timestamp_end_seconds || 0) - (item.timestamp_start_seconds || 0)
                      ).toFixed(1)

                      return (
                        <div
                          key={aIdx}
                          className="bg-slate-950 border border-slate-800 hover:border-teal-500/50 rounded-lg p-3 space-y-2 transition-all group"
                        >
                          <div className="flex gap-2.5">
                            {item.best_crop_path ? (
                              <img
                                src={`${API_BASE}${item.best_crop_path}`}
                                alt="Crop"
                                className="h-14 w-14 object-cover rounded border border-slate-700 shrink-0 bg-slate-900"
                              />
                            ) : (
                              <div className="h-14 w-14 rounded bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-600 shrink-0">
                                <SearchIcon className="h-5 w-5" />
                              </div>
                            )}

                            <div className="min-w-0 flex-1 space-y-0.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold font-mono bg-teal-500/10 text-teal-300 px-1.5 py-0.5 rounded">
                                  {(item.score * 100).toFixed(1)}% match
                                </span>
                                <span className="text-[9px] text-slate-400 font-mono">
                                  {item.camera_id}
                                </span>
                              </div>

                              <p className="text-xs font-semibold text-slate-200 truncate mt-1">
                                {item.class_name || item.object_type}
                              </p>
                              <p className="text-[10px] text-slate-400 truncate">
                                {item.camera_name}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center justify-between pt-1 border-t border-slate-900 text-[10px] text-slate-400">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3 text-slate-500" />
                              {item.timestamp_start_seconds?.toFixed(1)}s (Dwell: {dwell}s)
                            </span>
                            <button
                              onClick={() => {
                                onClose()
                                onPlayVideoAtTime(
                                  {
                                    id: item.video_id,
                                    camera_id: item.camera_id,
                                    standardized_filename: item.video_standardized_filename,
                                    original_filename: item.video_original_filename,
                                  },
                                  item.timestamp_start_seconds,
                                  item.tracker_id,
                                  item.best_bbox,
                                  item.class_name
                                )
                              }}
                              className="text-teal-400 hover:text-teal-300 font-bold flex items-center gap-1 group-hover:underline"
                            >
                              <Play className="h-3 w-3 fill-current" /> Seek Clip
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {msg.role === 'user' && (
              <div className="h-8 w-8 rounded-lg bg-teal-700 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                <User className="h-4 w-4" />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-3.5 items-center text-slate-400 text-xs py-2">
            <div className="h-8 w-8 rounded-lg bg-teal-600/20 border border-teal-500/30 text-teal-400 flex items-center justify-center shrink-0">
              <RefreshCw className="h-4 w-4 animate-spin" />
            </div>
            <span>Copilot is analyzing query and executing system tools...</span>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* INPUT DOCK */}
      <div className="border-t border-slate-800 bg-slate-900/90 p-4 shrink-0">
        <div className="max-w-4xl mx-auto space-y-2">
          
          {errorMsg && (
            <div className="bg-red-950/50 border border-red-800 text-red-300 text-xs px-3 py-1.5 rounded flex items-center justify-between">
              <span>{errorMsg}</span>
              <button onClick={() => setErrorMsg('')} className="text-red-400 hover:text-red-200">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Attached image preview */}
          {referencePreview && (
            <div className="flex items-center gap-3 bg-slate-850 border border-slate-700 p-2 rounded-lg w-fit">
              <img
                src={referencePreview}
                alt="Upload preview"
                className="h-10 w-10 object-cover rounded border border-slate-600"
              />
              <span className="text-xs text-slate-300">{referenceFile?.name}</span>
              <button
                onClick={() => {
                  setReferenceFile(null)
                  setReferencePreview(null)
                  setReferenceB64(null)
                }}
                className="text-red-400 hover:text-red-300 ml-2"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSendPrompt()
            }}
            className="flex gap-2.5 items-center"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFileSelect(f)
              }}
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-10 w-10 rounded-lg bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-300 hover:text-teal-400 flex items-center justify-center transition-colors shrink-0"
              title="Attach target photo for visual search"
            >
              <Upload className="h-4 w-4" />
            </button>

            <input
              type="text"
              placeholder="Ask Copilot (e.g. 'Find red hatchbacks', 'Show loitering alerts')..."
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-500 transition-colors"
            />

            <button
              type="submit"
              disabled={loading || (!inputPrompt.trim() && !referenceB64)}
              className="bg-teal-600 hover:bg-teal-500 text-white h-10 px-5 rounded-lg text-xs font-bold transition-all shadow-md flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {loading ? (
                <RefreshCw className="animate-spin h-4 w-4" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send
            </button>
          </form>
        </div>
      </div>

      {/* SETTINGS MODAL */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full space-y-5 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Settings className="h-4 w-4 text-teal-400" /> Copilot Model Settings
              </h3>
              <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  LLM Provider Type
                </label>
                <select
                  value={config.provider}
                  onChange={(e) => setConfig((prev) => ({ ...prev, provider: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-teal-500"
                >
                  <option value="ollama">Local LLM (Ollama)</option>
                  <option value="cloud">Cloud OpenAI API</option>
                </select>
              </div>

              {config.provider === 'ollama' ? (
                <>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Ollama Host Endpoint
                    </label>
                    <input
                      type="text"
                      value={config.ollama_host}
                      onChange={(e) => setConfig((prev) => ({ ...prev, ollama_host: e.target.value }))}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-slate-200 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Ollama Model Target
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. qwen2.5-vl:3b, qwen2.5-vl:7b, qwen2.5:7b"
                      value={config.ollama_model}
                      onChange={(e) => setConfig((prev) => ({ ...prev, ollama_model: e.target.value }))}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-slate-200 focus:outline-none"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Cloud API Key
                    </label>
                    <input
                      type="password"
                      placeholder="sk-..."
                      value={config.cloud_api_key}
                      onChange={(e) => setConfig((prev) => ({ ...prev, cloud_api_key: e.target.value }))}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-slate-200 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Cloud Model Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. gpt-4o-mini, gpt-4o"
                      value={config.cloud_model}
                      onChange={(e) => setConfig((prev) => ({ ...prev, cloud_model: e.target.value }))}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-slate-200 focus:outline-none"
                    />
                  </div>
                </>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="px-4 py-1.5 rounded text-xs font-bold bg-slate-800 text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingConfig}
                  className="px-4 py-1.5 rounded text-xs font-bold bg-teal-600 hover:bg-teal-500 text-white"
                >
                  {savingConfig ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
