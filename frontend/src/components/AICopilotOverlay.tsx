import React, { useState, useEffect, useRef } from 'react'
import {
  Sparkles,
  X,
  Send,
  Upload,
  Bot,
  User,
  RefreshCw,
  Play,
  Clock,
  Search as SearchIcon,
  ChevronRight,
  Plus,
  Trash2,
  MessageSquare,
  History,
  Sliders,
  Check,
} from 'lucide-react'

const API_BASE = 'http://localhost:8000'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  image_b64?: string
  executed_tools?: Array<{ name: string; args: any; result_count?: number }>
  attachments?: any[]
}

interface ChatSessionItem {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
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

const PROVIDER_PRESETS = [
  { name: 'Groq Cloud', base_url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { name: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-3.5-sonnet' },
  { name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: 'OpenAI', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: 'LM Studio / Local OpenAI', base_url: 'http://localhost:1234/v1', model: 'local-model' },
  { name: 'Ollama v1 API', base_url: 'http://localhost:11434/v1', model: 'qwen2.5:3b' },
]

export default function AICopilotOverlay({
  isOpen,
  onClose,
  onPlayVideoAtTime,
}: AICopilotOverlayProps) {
  // Session & Chat State
  const [sessions, setSessions]               = useState<ChatSessionItem[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeSessionTitle, setActiveSessionTitle] = useState<string>('New Conversation')
  const [isSidebarOpen, setIsSidebarOpen]     = useState(true)

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
    ollama_model: 'qwen2.5:3b',
    cloud_api_key: '',
    cloud_model: 'gpt-4o-mini',
    cloud_base_url: 'https://api.openai.com/v1',
  })
  const [savingConfig, setSavingConfig]       = useState(false)

  const chatEndRef   = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load config & sessions on open
  useEffect(() => {
    if (isOpen) {
      loadConfig()
      loadSessions()
    }
  }, [isOpen])

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

  const loadConfig = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/assistant/config`)
      if (r.ok) {
        const data = await r.json()
        setConfig((prev) => ({ ...prev, ...data }))
      }
    } catch (e) {
      // Ignore fallback
    }
  }

  const loadSessions = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/assistant/sessions`)
      if (r.ok) {
        const data: ChatSessionItem[] = await r.json()
        setSessions(data)
        if (data.length > 0 && !activeSessionId) {
          // Load most recent session automatically
          loadSingleSession(data[0].id)
        }
      }
    } catch (e) {
      // Ignore
    }
  }

  const loadSingleSession = async (sessionId: string) => {
    try {
      setLoading(true)
      const r = await fetch(`${API_BASE}/api/v1/assistant/sessions/${sessionId}`)
      if (r.ok) {
        const data = await r.json()
        setActiveSessionId(data.id)
        setActiveSessionTitle(data.title)
        setMessages(data.messages || [])
      }
    } catch (e) {
      setErrorMsg('Failed to load session history.')
    } finally {
      setLoading(false)
    }
  }

  const handleStartNewSession = async () => {
    try {
      setLoading(true)
      const r = await fetch(`${API_BASE}/api/v1/assistant/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Conversation' }),
      })
      if (r.ok) {
        const newSess = await r.json()
        setActiveSessionId(newSess.id)
        setActiveSessionTitle(newSess.title)
        setMessages([])
        setSessions((prev) => [newSess, ...prev])
      }
    } catch (e) {
      setErrorMsg('Failed to start new session.')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    if (!window.confirm('Delete this conversation history permanently?')) return

    try {
      const r = await fetch(`${API_BASE}/api/v1/assistant/sessions/${sessionId}`, {
        method: 'DELETE',
      })
      if (r.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId))
        if (activeSessionId === sessionId) {
          setActiveSessionId(null)
          setMessages([])
          setActiveSessionTitle('New Conversation')
        }
      }
    } catch (e) {
      setErrorMsg('Failed to delete session.')
    }
  }

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingConfig(true)
    setErrorMsg('')
    try {
      const res = await fetch(`${API_BASE}/api/v1/assistant/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (res.ok) {
        setIsSettingsOpen(false)
      } else {
        const err = await res.json()
        setErrorMsg(err.detail || 'Failed to save config.')
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Config save connection error.')
    } finally {
      setSavingConfig(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setReferenceFile(file)
    const reader = new FileReader()
    reader.onload = (event) => {
      const b64 = (event.target?.result as string).split(',')[1]
      setReferencePreview(event.target?.result as string)
      setReferenceB64(b64)
    }
    reader.readAsDataURL(file)
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputPrompt.trim() && !referenceB64) return

    const userContent = inputPrompt.trim() || 'Attached target photo for visual search.'
    const userMsg: ChatMessage = {
      role: 'user',
      content: userContent,
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
        session_id: activeSessionId,
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
      if (responseData.session_id) {
        setActiveSessionId(responseData.session_id)
        if (responseData.session_title) setActiveSessionTitle(responseData.session_title)
        loadSessions() // Refresh session list ordering
      }

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
          content: `⚠️ **Error**: ${err.message || 'Connection failure.'}\n\nPlease check your Copilot Settings or local LLM setup.`,
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[150] flex bg-slate-950/90 backdrop-blur-md text-slate-100 animate-in fade-in duration-200 isolation-isolate">
      
      {/* SESSIONS COLLAPSIBLE SIDEBAR */}
      <div
        className={`${
          isSidebarOpen ? 'w-72' : 'w-12'
        } shrink-0 border-r border-slate-800 bg-slate-900/95 flex flex-col transition-all duration-200 ease-in-out z-10`}
      >
        {/* Sidebar Header */}
        <div className="h-14 px-3 flex items-center justify-between border-b border-slate-800">
          {isSidebarOpen ? (
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-teal-400" />
              <span className="text-xs font-bold tracking-wide text-slate-200">Conversations</span>
            </div>
          ) : (
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white mx-auto"
              title="Expand Sessions Sidebar"
            >
              <History className="h-4 w-4" />
            </button>
          )}

          {isSidebarOpen && (
            <div className="flex items-center gap-1">
              <button
                onClick={handleStartNewSession}
                className="p-1.5 rounded-lg bg-teal-600/20 text-teal-400 hover:bg-teal-600/30 text-xs font-semibold flex items-center gap-1 transition-colors"
                title="New Chat Session"
              >
                <Plus className="h-3.5 w-3.5" /> New
              </button>
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                title="Collapse Sidebar"
              >
                <ChevronRight className="h-4 w-4 rotate-180" />
              </button>
            </div>
          )}
        </div>

        {/* Sessions List */}
        {isSidebarOpen && (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <button
              onClick={handleStartNewSession}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-dashed border-teal-500/40 bg-teal-500/10 hover:bg-teal-500/20 text-teal-300 text-xs font-semibold transition-all mb-3"
            >
              <Plus className="h-4 w-4 text-teal-400 shrink-0" />
              <span>Start New Conversation</span>
            </button>

            {sessions.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500">No past conversations</div>
            ) : (
              sessions.map((sess) => {
                const isActive = activeSessionId === sess.id
                return (
                  <div
                    key={sess.id}
                    onClick={() => loadSingleSession(sess.id)}
                    className={`group relative flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer text-xs transition-all ${
                      isActive
                        ? 'bg-teal-600/20 border border-teal-500/30 text-white font-semibold'
                        : 'hover:bg-slate-800/80 text-slate-400 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 overflow-hidden pr-6">
                      <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-teal-400' : 'text-slate-500'}`} />
                      <span className="truncate">{sess.title || 'New Conversation'}</span>
                    </div>

                    {/* Delete action button */}
                    <button
                      onClick={(e) => handleDeleteSession(e, sess.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 text-slate-500 transition-opacity"
                      title="Delete Conversation"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* MAIN CHAT AREA */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* TOPBAR HEADER */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-800 bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3">
            {!isSidebarOpen && (
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white mr-1"
                title="Show Sessions Sidebar"
              >
                <History className="h-4 w-4" />
              </button>
            )}
            <div className="h-9 w-9 rounded-lg bg-teal-600/20 border border-teal-500/30 flex items-center justify-center text-teal-400 shadow-sm">
              <Sparkles className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-100 tracking-wide truncate max-w-md">
                  {activeSessionTitle}
                </h2>
                <span className="text-[10px] font-mono bg-teal-500/10 text-teal-300 border border-teal-500/30 px-2 py-0.5 rounded font-bold shrink-0">
                  {config.provider === 'ollama' ? 'LOCAL OLLAMA' : 'UNIVERSAL API'}
                </span>
              </div>
              <p className="text-[10px] text-slate-400">
                Agentic tool calling over Qdrant, Cameras, Security Alerts &amp; Evidentiary Logs.
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            >
              <Sliders className="h-3.5 w-3.5 text-teal-400" />
              <span>Provider &amp; Model Settings</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-100 transition-colors"
              title="Close Copilot (Esc)"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* CHAT MESSAGES AREA */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-4xl mx-auto w-full">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4 my-auto">
              <div className="h-16 w-16 rounded-2xl bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-teal-400 shadow-inner">
                <Bot className="h-8 w-8" />
              </div>
              <div className="max-w-md space-y-1">
                <h3 className="text-base font-bold text-slate-200">How can I assist your forensic investigation?</h3>
                <p className="text-xs text-slate-400">
                  Ask natural language questions about registered cameras, loitering/abandonment alerts, or search target tracklets across all video feeds.
                </p>
              </div>

              {/* Sample Prompts */}
              <div className="grid grid-cols-2 gap-3 w-full max-w-xl text-left pt-2">
                {[
                  'List all active smart city camera nodes',
                  'Find any vehicles or buses across active cameras',
                  'Check for recent security loitering alerts',
                  'Show camera details for CAM_001',
                ].map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setInputPrompt(prompt)
                    }}
                    className="p-3 rounded-xl border border-slate-800 bg-slate-900/60 hover:bg-slate-850 hover:border-slate-700 text-xs text-slate-300 hover:text-white transition-all flex items-start justify-between group"
                  >
                    <span>{prompt}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-500 group-hover:text-teal-400 shrink-0 mt-0.5" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, index) => (
              <div
                key={index}
                className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="h-8 w-8 rounded-lg bg-teal-600/20 border border-teal-500/30 text-teal-400 flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                    <Bot className="h-4 w-4" />
                  </div>
                )}

                <div className={`space-y-3 max-w-2xl ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  {/* User attached image thumbnail if any */}
                  {msg.image_b64 && (
                    <div className="rounded-lg overflow-hidden border border-slate-700 max-w-xs shadow-md">
                      <img
                        src={`data:image/jpeg;base64,${msg.image_b64}`}
                        alt="User target reference"
                        className="w-full h-auto object-cover max-h-48"
                      />
                    </div>
                  )}

                  {/* Executed Tools Badges */}
                  {msg.executed_tools && msg.executed_tools.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {msg.executed_tools.map((t, tidx) => (
                        <span
                          key={tidx}
                          className="inline-flex items-center gap-1.5 text-[10px] font-mono bg-slate-900 border border-slate-750 text-teal-300 px-2.5 py-1 rounded-md"
                        >
                          <SearchIcon className="h-3 w-3 text-teal-400" />
                          <span>Tool: {t.name}</span>
                          {t.result_count !== undefined && (
                            <span className="bg-teal-500/20 text-teal-200 px-1 rounded">
                              {t.result_count} matches
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Text Message Bubble */}
                  <div
                    className={`rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-teal-700 text-white font-medium rounded-tr-none'
                        : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none shadow-sm'
                    }`}
                  >
                    <div className="whitespace-pre-wrap font-sans">{msg.content}</div>
                  </div>

                  {/* Attachments / Tracklet Cards Grid */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="pt-2 space-y-2">
                      <div className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                        <Play className="h-3 w-3 text-teal-400" />
                        <span>Matching Candidate Clips ({msg.attachments.length})</span>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        {msg.attachments.map((item, aIdx) => {
                          const cropUrl = item.best_crop_path
                            ? `${API_BASE}${item.best_crop_path}`
                            : item.thumbnail_path
                            ? `${API_BASE}/${item.thumbnail_path}`
                            : ''

                          return (
                            <div
                              key={aIdx}
                              className="bg-slate-900 border border-slate-800 hover:border-teal-500/40 rounded-xl p-2.5 transition-all group flex flex-col justify-between"
                            >
                              <div className="flex gap-3 items-center">
                                {cropUrl ? (
                                  <img
                                    src={cropUrl}
                                    alt="Tracklet crop"
                                    className="h-14 w-14 object-cover rounded-lg border border-slate-700 shrink-0"
                                  />
                                ) : (
                                  <div className="h-14 w-14 bg-slate-800 rounded-lg flex items-center justify-center text-slate-500 text-[10px]">
                                    No Image
                                  </div>
                                )}

                                <div className="min-w-0 flex-1 space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-slate-100 truncate">
                                      {item.class_name || item.object_type} #{item.tracker_id}
                                    </span>
                                    {item.score !== undefined && (
                                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                        {(item.score * 100).toFixed(1)}%
                                      </span>
                                    )}
                                  </div>

                                  <div className="text-[10px] text-slate-400 flex items-center gap-1 truncate">
                                    <Clock className="h-3 w-3 text-slate-500" />
                                    <span>{item.camera_name || item.camera_id}</span>
                                  </div>

                                  <div className="text-[10px] text-slate-400 font-mono">
                                    {item.timestamp_start_seconds !== undefined
                                      ? `${item.timestamp_start_seconds.toFixed(1)}s`
                                      : '0.0s'}
                                  </div>
                                </div>
                              </div>

                              <div className="mt-2.5 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px]">
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
            ))
          )}

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
                  className="text-slate-400 hover:text-red-400"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            <form onSubmit={handleSendMessage} className="flex gap-2">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept="image/*"
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-teal-300 flex items-center justify-center transition-colors"
                title="Attach target photo for visual search"
              >
                <Upload className="h-4 w-4" />
              </button>

              <input
                type="text"
                value={inputPrompt}
                onChange={(e) => setInputPrompt(e.target.value)}
                placeholder="Ask Copilot anything... (e.g. 'man in red jacket near CAM_001')"
                className="flex-1 bg-slate-900 border border-slate-750 focus:border-teal-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-colors"
              />

              <button
                type="submit"
                disabled={loading || (!inputPrompt.trim() && !referenceB64)}
                className="px-5 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Send</span>
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* UNIVERSAL API & MODEL SETTINGS MODAL */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-850">
              <div className="flex items-center gap-2">
                <Sliders className="h-5 w-5 text-teal-400" />
                <h3 className="text-sm font-bold text-slate-100">LLM Provider &amp; Model Configuration</h3>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="p-6 space-y-5 text-xs">
              {/* Provider Radio Selector */}
              <div className="space-y-2">
                <label className="font-semibold text-slate-300">Execution Provider</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setConfig((prev) => ({ ...prev, provider: 'ollama' }))}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      config.provider === 'ollama'
                        ? 'border-teal-500 bg-teal-500/10 text-teal-300 font-bold'
                        : 'border-slate-800 bg-slate-850 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>Local Ollama</span>
                      {config.provider === 'ollama' && <Check className="h-4 w-4 text-teal-400" />}
                    </div>
                    <p className="text-[10px] font-normal text-slate-400 mt-1">100% Offline Local Model</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setConfig((prev) => ({ ...prev, provider: 'cloud' }))}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      config.provider === 'cloud'
                        ? 'border-teal-500 bg-teal-500/10 text-teal-300 font-bold'
                        : 'border-slate-800 bg-slate-850 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>Universal Cloud / API</span>
                      {config.provider === 'cloud' && <Check className="h-4 w-4 text-teal-400" />}
                    </div>
                    <p className="text-[10px] font-normal text-slate-400 mt-1">Groq, OpenRouter, DeepSeek, OpenAI</p>
                  </button>
                </div>
              </div>

              {/* Local Ollama Fields */}
              {config.provider === 'ollama' ? (
                <div className="space-y-4 border-t border-slate-800 pt-4">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-300">Ollama Host Address</label>
                    <input
                      type="text"
                      value={config.ollama_host}
                      onChange={(e) => setConfig((prev) => ({ ...prev, ollama_host: e.target.value }))}
                      placeholder="http://localhost:11434"
                      className="w-full bg-slate-950 border border-slate-750 focus:border-teal-500 rounded-lg px-3 py-2 text-slate-200 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-slate-300">Ollama Model Name</label>
                    <input
                      type="text"
                      value={config.ollama_model}
                      onChange={(e) => setConfig((prev) => ({ ...prev, ollama_model: e.target.value }))}
                      placeholder="qwen2.5:3b"
                      className="w-full bg-slate-950 border border-slate-750 focus:border-teal-500 rounded-lg px-3 py-2 text-slate-200 focus:outline-none font-mono"
                    />
                    <p className="text-[10px] text-slate-500">Examples: `qwen2.5:3b`, `qwen2.5-vl:7b`, `llama3.2-vision`</p>
                  </div>
                </div>
              ) : (
                /* Universal Cloud / Custom API Fields */
                <div className="space-y-4 border-t border-slate-800 pt-4">
                  {/* Preset Buttons */}
                  <div className="space-y-1.5">
                    <label className="font-semibold text-slate-300">Quick Provider Presets</label>
                    <div className="flex flex-wrap gap-1.5">
                      {PROVIDER_PRESETS.map((p, pidx) => (
                        <button
                          key={pidx}
                          type="button"
                          onClick={() => {
                            setConfig((prev) => ({
                              ...prev,
                              cloud_base_url: p.base_url,
                              cloud_model: p.model,
                            }))
                          }}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-300 hover:text-teal-300 transition-colors"
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-slate-300">Base URL (OpenAI Compatible Endpoint)</label>
                    <input
                      type="text"
                      value={config.cloud_base_url}
                      onChange={(e) => setConfig((prev) => ({ ...prev, cloud_base_url: e.target.value }))}
                      placeholder="https://api.openai.com/v1"
                      className="w-full bg-slate-950 border border-slate-750 focus:border-teal-500 rounded-lg px-3 py-2 text-slate-200 focus:outline-none font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-slate-300">API Key (Optional for Local Proxies)</label>
                    <input
                      type="password"
                      value={config.cloud_api_key}
                      onChange={(e) => setConfig((prev) => ({ ...prev, cloud_api_key: e.target.value }))}
                      placeholder="sk-..."
                      className="w-full bg-slate-950 border border-slate-750 focus:border-teal-500 rounded-lg px-3 py-2 text-slate-200 focus:outline-none font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-slate-300">Model Name</label>
                    <input
                      type="text"
                      value={config.cloud_model}
                      onChange={(e) => setConfig((prev) => ({ ...prev, cloud_model: e.target.value }))}
                      placeholder="gpt-4o-mini"
                      className="w-full bg-slate-950 border border-slate-750 focus:border-teal-500 rounded-lg px-3 py-2 text-slate-200 focus:outline-none font-mono"
                    />
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingConfig}
                  className="px-5 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-bold transition-colors shadow-sm"
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
