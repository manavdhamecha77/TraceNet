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
  Sliders,
  Check,
  PanelLeftClose,
  PanelLeft,
  Square,
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
  initialPrompt?: string
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
  { name: 'LM Studio / Local', base_url: 'http://localhost:1234/v1', model: 'local-model' },
  { name: 'Ollama v1 API', base_url: 'http://localhost:11434/v1', model: 'qwen2.5:3b' },
]

const CLOUD_MODEL_OPTIONS = [
  { label: 'GPT-4o Mini (Fast)', value: 'gpt-4o-mini' },
  { label: 'GPT-4o (Multimodal High Precision)', value: 'gpt-4o' },
  { label: 'Llama 3.3 70B (Groq Fast)', value: 'llama-3.3-70b-versatile' },
  { label: 'Llama 3.1 8B (Groq Instant)', value: 'llama-3.1-8b-instant' },
  { label: 'Claude 3.5 Sonnet (OpenRouter)', value: 'anthropic/claude-3.5-sonnet' },
  { label: 'DeepSeek Chat V3', value: 'deepseek-chat' },
  { label: 'DeepSeek Reasoner R1', value: 'deepseek-reasoner' },
  { label: 'Local Model (Ollama / LMStudio)', value: 'local-model' },
  { label: '+ Enter Custom Model Name...', value: '__custom__' },
]

const Markdown: React.FC<{ content: string }> = ({ content }) => {
  if (!content) return null

  // Split content by code blocks to avoid formatting markdown inside code blocks
  const parts = content.split(/(```[\s\S]*?```)/g)

  const formatInlineCodeOnly = (text: string): React.ReactNode[] => {
    const codeParts = text.split(/(`.*?`)/g)
    return codeParts.map((part, i) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code key={`c-${i}`} className="px-1.5 py-0.5 rounded bg-slate-950 text-teal-300 font-mono text-[11px] border border-slate-800">
            {part.slice(1, -1)}
          </code>
        )
      }
      return part
    })
  }

  const formatInline = (text: string): React.ReactNode[] => {
    const boldParts = text.split(/(\*\*.*?\*\*)/g)
    return boldParts.flatMap((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        const innerText = part.slice(2, -2)
        return (
          <strong key={`b-${i}`} className="font-bold text-teal-400">
            {formatInlineCodeOnly(innerText)}
          </strong>
        )
      }
      return formatInlineCodeOnly(part)
    })
  }

  return (
    <div className="space-y-2">
      {parts.map((part, partIdx) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const lines = part.slice(3, -3).trim().split('\n')
          const firstLine = lines[0].trim()
          const hasLang = /^[a-zA-Z0-9_-]+$/.test(firstLine)
          const lang = hasLang ? firstLine : ''
          const codeLines = hasLang ? lines.slice(1) : lines
          const codeText = codeLines.join('\n')

          return (
            <pre key={partIdx} className="my-2 p-3 rounded-xl bg-slate-950 border border-slate-800 overflow-x-auto font-mono text-[11px] text-teal-200 leading-relaxed shadow-inner">
              {lang && (
                <div className="text-[10px] text-slate-500 font-sans font-bold uppercase mb-1.5 tracking-wider border-b border-slate-800 pb-1">
                  {lang}
                </div>
              )}
              <code>{codeText}</code>
            </pre>
          )
        }

        const lines = part.split('\n')
        const renderedElements: React.ReactNode[] = []
        let listItems: React.ReactNode[] = []
        let inList = false
        let listType: 'ul' | 'ol' = 'ul'
        let tableRows: string[] = []
        let inTable = false

        const flushList = (key: string | number) => {
          if (listItems.length > 0) {
            if (listType === 'ul') {
              renderedElements.push(
                <ul key={`ul-${key}`} className="list-disc pl-5 my-1.5 space-y-1 text-slate-300">
                  {listItems}
                </ul>
              )
            } else {
              renderedElements.push(
                <ol key={`ol-${key}`} className="list-decimal pl-5 my-1.5 space-y-1 text-slate-300">
                  {listItems}
                </ol>
              )
            }
            listItems = []
          }
          inList = false
        }

        const flushTable = (key: string | number) => {
          if (tableRows.length > 0) {
            const headerRow = tableRows[0]
            const dataRows = tableRows.slice(1)

            // Check if second row is separator
            let separatorIndex = -1
            if (dataRows.length > 0 && /^[\s|:-]+$/.test(dataRows[0].trim())) {
              separatorIndex = 0
            }

            const headers = headerRow.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
            const rowsData = dataRows
              .filter((_, idx) => idx !== separatorIndex)
              .map(row => row.replace(/^\||\|$/g, '').split('|').map(c => c.trim()))

            renderedElements.push(
              <div key={`table-wrapper-${key}`} className="overflow-x-auto my-3 rounded-xl border border-slate-800 shadow-sm max-w-full">
                <table className="min-w-full divide-y divide-slate-800 text-[11px] font-sans text-slate-300 bg-slate-950/40">
                  <thead className="bg-slate-900 text-slate-200">
                    <tr>
                      {headers.map((h, hIdx) => (
                        <th key={hIdx} className="px-3 py-2 text-left font-bold border-r border-slate-800 last:border-r-0 whitespace-nowrap">
                          {formatInline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {rowsData.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-slate-900/40 transition-colors odd:bg-slate-900/10">
                        {row.map((cell, cIdx) => (
                          <td key={cIdx} className="px-3 py-1.5 border-r border-slate-800 last:border-r-0 break-words max-w-[250px]">
                            {formatInline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
            tableRows = []
          }
          inTable = false
        }

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          const trimmed = line.trim()
          const isTableLine = trimmed.startsWith('|') && trimmed.endsWith('|')

          if (isTableLine) {
            flushList(i)
            inTable = true
            tableRows.push(line)
            continue
          } else if (inTable) {
            flushTable(i)
          }

          // Horizontal Rule
          if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
            flushList(i)
            renderedElements.push(<hr key={i} className="border-slate-800 my-3" />)
            continue
          }

          // Headers
          const headerMatch = line.match(/^(#{1,6})\s+(.*)$/)
          if (headerMatch) {
            flushList(i)
            const level = headerMatch[1].length
            const text = headerMatch[2]
            const inlineFormatted = formatInline(text)

            if (level === 1) {
              renderedElements.push(
                <h1 key={i} className="text-sm font-extrabold text-slate-100 mt-3 mb-1.5 tracking-tight border-b border-slate-800 pb-1">
                  {inlineFormatted}
                </h1>
              )
            } else if (level === 2) {
              renderedElements.push(
                <h2 key={i} className="text-xs font-bold text-slate-100 mt-2.5 mb-1">
                  {inlineFormatted}
                </h2>
              )
            } else {
              renderedElements.push(
                <h3 key={i} className="text-xs font-semibold text-slate-200 mt-2 mb-0.5">
                  {inlineFormatted}
                </h3>
              )
            }
            continue
          }

          // Unordered lists
          const ulMatch = line.match(/^([*\-+]|\u2022)\s+(.*)$/)
          if (ulMatch) {
            if (inList && listType !== 'ul') {
              flushList(i)
            }
            inList = true
            listType = 'ul'
            listItems.push(
              <li key={`li-${i}`} className="leading-relaxed">
                {formatInline(ulMatch[2])}
              </li>
            )
            continue
          }

          // Ordered lists
          const olMatch = line.match(/^(\d+)\.\s+(.*)$/)
          if (olMatch) {
            if (inList && listType !== 'ol') {
              flushList(i)
            }
            inList = true
            listType = 'ol'
            listItems.push(
              <li key={`li-${i}`} className="leading-relaxed">
                {formatInline(olMatch[2])}
              </li>
            )
            continue
          }

          // Empty line
          if (trimmed === '') {
            flushList(i)
            continue
          }

          // Regular paragraph line
          if (inList) {
            if (line.startsWith('  ')) {
              listItems.push(
                <div key={`li-cont-${i}`} className="pl-4 text-slate-400">
                  {formatInline(trimmed)}
                </div>
              )
              continue
            } else {
              flushList(i)
            }
          }

          renderedElements.push(
            <p key={i} className="my-1 text-slate-200 leading-relaxed">
              {formatInline(line)}
            </p>
          )
        }

        flushList(`end-${partIdx}`)
        flushTable(`end-${partIdx}`)

        return <React.Fragment key={partIdx}>{renderedElements}</React.Fragment>
      })}
    </div>
  )
}

export default function AICopilotOverlay({
  isOpen,
  onClose,
  initialPrompt,
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

  // Installed Ollama Models list state
  const [ollamaModels, setOllamaModels]       = useState<string[]>(['qwen2.5:3b', 'qwen2.5-vl:3b'])
  const [loadingOllamaModels, setLoadingOllamaModels] = useState(false)
  const [isCustomOllamaModel, setIsCustomOllamaModel] = useState(false)
  const [isCustomCloudModel, setIsCustomCloudModel]   = useState(false)

  const chatEndRef   = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setLoading(false)
    setErrorMsg('AI response generation stopped by user.')
  }

  // Load config & sessions on open, and set initialPrompt if present
  useEffect(() => {
    if (isOpen) {
      loadConfig()
      loadSessions()
      if (initialPrompt) {
        setInputPrompt(initialPrompt)
      }
    }
  }, [isOpen, initialPrompt])

  // Fetch installed Ollama models when settings opens
  useEffect(() => {
    if (isSettingsOpen && config.provider === 'ollama') {
      fetchInstalledOllamaModels(config.ollama_host)
    }
  }, [isSettingsOpen, config.provider, config.ollama_host])

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

  const fetchInstalledOllamaModels = async (host: string) => {
    setLoadingOllamaModels(true)
    try {
      const r = await fetch(`${API_BASE}/api/v1/assistant/ollama-models?host=${encodeURIComponent(host)}`)
      if (r.ok) {
        const data = await r.json()
        if (data.models && data.models.length > 0) {
          setOllamaModels(data.models)
        }
      }
    } catch (e) {
      // Fallback
    } finally {
      setLoadingOllamaModels(false)
    }
  }

  const loadSessions = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/assistant/sessions`)
      if (r.ok) {
        const data: ChatSessionItem[] = await r.json()
        setSessions(data)
        if (data.length > 0 && !activeSessionId) {
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

const HELP_MESSAGE_CONTENT = `### 🛰️ TraceNet AI Copilot — System Guide & Command Reference (Project DRISHTI)

Welcome to **TraceNet Copilot**! I am your domain-adapted AI Assistant for Smart City CCTV Surveillance, Digital Forensics, and Video Analytics.

---

### ⚡ Interactive Slash Commands
- **/help** or **/commands** — Open this capability & sitemap reference guide.
- **/cameras** — List all registered GIS camera nodes, coordinates, and status.
- **/alerts** — Retrieve real-time loitering and abandoned baggage security alerts.
- **/theft** — Retrieve outdoor chain snatching and violent theft alerts.
- **/assault** — Retrieve physical assault & fighting alerts.
- **/journey <tracklet_id>** — Reconstruct multi-camera spatial-temporal journey path.
- **/sentinel <camera_id>** — Activate predictive downstream Sentinel pursuit wave.
- **/models** — Inspect registered ML object detection models & class lists.
- **/metrics** — View high-level Smart City command-center overview metrics.
- **/logs** — Inspect search history audit logs for court chain-of-custody compliance.
- **/search <description>** — Search CCTV video tracklets by visual description.
- **/clear** — Clear current conversation and start a new session.

---

### 🛠️ Automated MCP System Tools (15 Active Tools)
1. **\`search_tracklets\`** — Semantic vector search over CCTV footage for target people or vehicles.
2. **\`list_cameras\`** — Query smart city camera profiles, GIS map locations, and corridor groups.
3. **\`get_camera_details\`** — View camera metadata, active model, and video feed segments.
4. **\`get_system_alerts\`** — Query loitering and abandoned baggage security events.
5. **\`get_chain_snatching_alerts\`** — Retrieve outdoor chain snatching and violent theft alerts.
6. **\`analyze_chain_snatching\`** — Trigger 4 FPS kinematic chain snatching analysis on video feeds.
7. **\`get_assault_alerts\`** — Retrieve physical assault, fighting, and violent incident alerts.
8. **\`detect_assault\`** — Trigger VideoMAE physical assault & fighting scan on video feeds.
9. **\`reconstruct_trajectory\`** — Reconstruct multi-camera spatial-temporal DAG journey path.
10. **\`activate_sentinel_wave\`** — Activate predictive downstream Sentinel search wave pursuit.
11. **\`get_search_logs\`** — Audit evidentiary search query history with SHA-256 validation.
12. **\`get_dashboard_metrics\`** — Command-center stats (cameras, videos, tracklets, alerts).
13. **\`list_models\`** — View loaded YOLO detection models, weights, and class lists.
14. **\`assign_camera_model\`** — Assign an ML object detector model to a camera node.
15. **\`trigger_video_reindex\`** — Re-index tracklet embeddings into Qdrant vector database.

---

### 💡 Example Prompts to Try
- \`"Find a person in a red jacket near CAM_001"\`
- \`"Reconstruct the journey path for tracklet CAM_001_trk_5"\`
- \`"Activate Sentinel pursuit wave from origin camera CAM_001"\`
- \`"Check for recent chain snatching or theft alerts"\`
- \`"Scan video_id_123 for physical assault or fighting"\`
- \`"Give me an overview of system health and total processed videos"\``

const SLASH_COMMANDS = [
  { cmd: '/help', desc: 'Display platform capabilities & commands reference guide' },
  { cmd: '/cameras', desc: 'List all registered GIS camera nodes & status' },
  { cmd: '/alerts', desc: 'Retrieve recent loitering & security alerts' },
  { cmd: '/theft', desc: 'Retrieve outdoor chain snatching & theft alerts' },
  { cmd: '/assault', desc: 'Retrieve physical assault & fighting alerts' },
  { cmd: '/journey', desc: 'Reconstruct multi-camera trajectory journey path' },
  { cmd: '/sentinel', desc: 'Activate predictive downstream Sentinel pursuit wave' },
  { cmd: '/models', desc: 'Inspect registered ML detector models & YOLO weights' },
  { cmd: '/metrics', desc: 'View high-level Smart City command-center metrics' },
  { cmd: '/logs', desc: 'View evidentiary search audit history' },
  { cmd: '/clear', desc: 'Clear current conversation and start new session' },
]

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    const rawInput = inputPrompt.trim()
    if (!rawInput && !referenceB64) return

    // ── Intercept Slash Commands ──────────────────────────────────────────────
    if (rawInput.startsWith('/')) {
      const parts = rawInput.split(' ')
      const cmd = parts[0].toLowerCase()

      if (cmd === '/help' || cmd === '/commands') {
        const userMsg: ChatMessage = { role: 'user', content: rawInput }
        const helpMsg: ChatMessage = { role: 'assistant', content: HELP_MESSAGE_CONTENT }
        setMessages((prev) => [...prev, userMsg, helpMsg])
        setInputPrompt('')
        return
      }

      if (cmd === '/clear') {
        setInputPrompt('')
        handleStartNewSession()
        return
      }

      let transformedPrompt = rawInput
      if (cmd === '/cameras') transformedPrompt = 'List all registered smart city camera nodes and their online status.'
      else if (cmd === '/alerts') transformedPrompt = 'Retrieve recent loitering and abandoned baggage security alerts.'
      else if (cmd === '/models') transformedPrompt = 'List all registered ML object detection models and YOLO weights.'
      else if (cmd === '/metrics') transformedPrompt = 'Retrieve high-level Smart City command-center overview metrics.'
      else if (cmd === '/logs') transformedPrompt = 'Retrieve search audit log history.'
      else if (cmd === '/search' && parts.length > 1) transformedPrompt = `Search tracklets for: ${parts.slice(1).join(' ')}`

      // Continue sending transformed command prompt to assistant LLM
      const userMsg: ChatMessage = {
        role: 'user',
        content: rawInput,
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
        const controller = new AbortController()
        abortControllerRef.current = controller

        const apiMessages = updatedMessages.slice(0, -1).map((m) => ({
          role: m.role,
          content: m.content,
          image_b64: m.image_b64 || null,
        }))
        apiMessages.push({
          role: 'user',
          content: transformedPrompt,
          image_b64: referenceB64 || null,
        })

        const res = await fetch(`${API_BASE}/api/v1/assistant/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: activeSessionId, messages: apiMessages }),
          signal: controller.signal,
        })

        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.detail || 'Assistant execution failed')
        }

        const responseData = await res.json()
        if (responseData.session_id) {
          setActiveSessionId(responseData.session_id)
          if (responseData.session_title) setActiveSessionTitle(responseData.session_title)
          loadSessions()
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
        if (err.name === 'AbortError') {
          setErrorMsg('Response generation stopped by user.')
          return
        }
        setErrorMsg(err.message || 'Copilot assistant failure.')
      } finally {
        abortControllerRef.current = null
        setLoading(false)
      }
      return
    }

    // Standard message handler
    const userContent = rawInput || 'Attached target photo for visual search.'
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
      const controller = new AbortController()
      abortControllerRef.current = controller

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
        signal: controller.signal,
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Assistant execution failed')
      }

      const responseData = await res.json()
      if (responseData.session_id) {
        setActiveSessionId(responseData.session_id)
        if (responseData.session_title) setActiveSessionTitle(responseData.session_title)
        loadSessions()
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
      if (err.name === 'AbortError') {
        setErrorMsg('Response generation stopped by user.')
        return
      }
      setErrorMsg(err.message || 'Copilot assistant failure.')
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ **Error**: ${err.message || 'Connection failure.'}\n\nPlease check your Copilot Settings or local LLM setup.`,
        },
      ])
    } finally {
      abortControllerRef.current = null
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[150] flex bg-slate-950/95 backdrop-blur-md text-slate-100 animate-in fade-in duration-200 isolation-isolate">
      
      {/* STREAMLINED CONVERSATIONS SIDEBAR */}
      <div
        className={`${
          isSidebarOpen ? 'w-72' : 'w-0 opacity-0 overflow-hidden'
        } shrink-0 border-r border-slate-800/80 bg-slate-900/95 flex flex-col transition-all duration-200 ease-in-out z-10`}
      >
        {/* Sidebar Header */}
        <div className="p-3 border-b border-slate-800/80 flex items-center justify-between gap-2">
          <button
            onClick={handleStartNewSession}
            className="flex-1 flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold transition-all shadow-sm group"
          >
            <Plus className="h-4 w-4 transition-transform group-hover:rotate-90" />
            <span>New Chat</span>
          </button>

          <button
            onClick={() => setIsSidebarOpen(false)}
            className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Collapse Sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <div className="px-2 py-1 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
            Recent Searches
          </div>

          {sessions.length === 0 ? (
            <div className="text-center py-10 text-xs text-slate-500">No past conversations</div>
          ) : (
            sessions.map((sess) => {
              const isActive = activeSessionId === sess.id
              return (
                <div
                  key={sess.id}
                  onClick={() => loadSingleSession(sess.id)}
                  className={`group relative flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer text-xs transition-all ${
                    isActive
                      ? 'bg-teal-600/20 border border-teal-500/40 text-teal-200 font-semibold shadow-sm'
                      : 'hover:bg-slate-800/70 text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-teal-400' : 'text-slate-500'}`} />
                    <span className="truncate">{sess.title || 'New Conversation'}</span>
                  </div>

                  <button
                    onClick={(e) => handleDeleteSession(e, sess.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 text-slate-500 transition-opacity rounded hover:bg-slate-800"
                    title="Delete Conversation"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* MAIN CHAT CONTAINER */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        
        {/* STREAMLINED TOP HEADER */}
        <div className="h-14 px-6 border-b border-slate-800/80 bg-slate-900/90 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {!isSidebarOpen && (
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors mr-1"
                title="Open Sidebar"
              >
                <PanelLeft className="h-4 w-4 text-teal-400" />
              </button>
            )}

            <div className="h-8 w-8 rounded-lg bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-teal-400 shrink-0">
              <Sparkles className="h-4 w-4 animate-pulse" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-bold text-slate-100 tracking-wide truncate max-w-sm">
                  {activeSessionTitle}
                </h2>
                <span className="text-[10px] font-mono bg-teal-500/10 text-teal-300 border border-teal-500/30 px-2 py-0.5 rounded font-bold shrink-0">
                  {config.provider === 'ollama' ? 'LOCAL OLLAMA' : 'UNIVERSAL API'}
                </span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors shadow-xs"
            >
              <Sliders className="h-3.5 w-3.5 text-teal-400" />
              <span className="hidden sm:inline">Provider Settings</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-slate-100 transition-colors"
              title="Close Copilot (Esc)"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* FULL-WIDTH SCROLLABLE MESSAGES CONTAINER */}
        <div className="flex-1 overflow-y-auto w-full">
          <div className="max-w-4xl mx-auto p-6 space-y-6">
            {messages.length === 0 ? (
              <div className="py-16 flex flex-col items-center justify-center text-center space-y-5">
                <div className="h-16 w-16 rounded-2xl bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-teal-400 shadow-inner">
                  <Bot className="h-8 w-8" />
                </div>

                <div className="max-w-md space-y-1.5">
                  <h3 className="text-sm font-bold text-slate-100 tracking-wide">
                    TraceNet AI Forensic Assistant
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Ask natural language queries across smart city camera nodes, loitering/abandonment security alerts, or perform visual target search.
                  </p>
                </div>

                {/* Sample Prompt Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-xl pt-3">
                  {[
                    'List all active smart city camera nodes',
                    'Find any vehicles or buses across active cameras',
                    'Check for recent security loitering alerts',
                    'Show camera details for CAM_001',
                  ].map((prompt, idx) => (
                    <button
                      key={idx}
                      onClick={() => setInputPrompt(prompt)}
                      className="p-3.5 rounded-2xl border border-slate-800 bg-slate-900/70 hover:bg-slate-800 hover:border-teal-500/40 text-xs text-slate-300 hover:text-white transition-all text-left flex items-start justify-between group shadow-sm"
                    >
                      <span className="leading-snug">{prompt}</span>
                      <ChevronRight className="h-4 w-4 text-slate-500 group-hover:text-teal-400 shrink-0 mt-0.5 ml-2 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, index) => (
                <div
                  key={index}
                  className={`flex gap-3.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'assistant' && (
                    <div className="h-8 w-8 rounded-xl bg-teal-500/10 border border-teal-500/30 text-teal-400 flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                      <Bot className="h-4 w-4" />
                    </div>
                  )}

                  <div className={`space-y-3 max-w-2xl ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    {/* User attached image thumbnail */}
                    {msg.image_b64 && (
                      <div className="rounded-xl overflow-hidden border border-slate-700 max-w-xs shadow-md">
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
                            className="inline-flex items-center gap-1.5 text-[10px] font-mono bg-slate-900 border border-slate-700 text-teal-300 px-2.5 py-1 rounded-lg shadow-2xs"
                          >
                            <SearchIcon className="h-3 w-3 text-teal-400" />
                            <span>Tool: {t.name}</span>
                            {t.result_count !== undefined && (
                              <span className="bg-teal-500/20 text-teal-200 px-1.5 rounded font-bold">
                                {t.result_count} matches
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Text Message Content */}
                    <div
                      className={`rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-teal-600 text-white font-medium rounded-tr-xs shadow-sm'
                          : 'bg-slate-900/90 border border-slate-800 text-slate-100 rounded-tl-xs shadow-sm'
                      }`}
                    >
                      {msg.role === 'user' ? (
                        <div className="whitespace-pre-wrap font-sans">{msg.content}</div>
                      ) : (
                        <Markdown content={msg.content} />
                      )}
                    </div>

                    {/* Candidate Tracklet Cards Grid */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="pt-2 space-y-2 w-full">
                        <div className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5">
                          <Play className="h-3 w-3 text-teal-400" />
                          <span>Matching Candidate Clips ({msg.attachments.length})</span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {msg.attachments.map((item, aIdx) => {
                            const cropUrl = item.best_crop_path
                              ? `${API_BASE}${item.best_crop_path}`
                              : item.thumbnail_path
                              ? `${API_BASE}/${item.thumbnail_path}`
                              : ''

                            return (
                              <div
                                key={aIdx}
                                className="bg-slate-900/90 border border-slate-800 hover:border-teal-500/50 rounded-2xl p-3 transition-all group flex flex-col justify-between shadow-xs"
                              >
                                <div className="flex gap-3 items-center">
                                  {cropUrl ? (
                                    <img
                                      src={cropUrl}
                                      alt="Tracklet crop"
                                      className="h-14 w-14 object-cover rounded-xl border border-slate-700 shrink-0 bg-slate-950"
                                    />
                                  ) : (
                                    <div className="h-14 w-14 bg-slate-950 rounded-xl flex items-center justify-center text-slate-500 text-[10px] shrink-0 border border-slate-800">
                                      No Crop
                                    </div>
                                  )}

                                  <div className="min-w-0 flex-1 space-y-1">
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="text-xs font-bold text-slate-100 truncate">
                                        {item.class_name || item.object_type} #{item.tracker_id}
                                      </span>
                                    </div>

                                    <div className="text-[10px] text-slate-400 flex items-center gap-1 truncate">
                                      <Clock className="h-3 w-3 text-slate-500 shrink-0" />
                                      <span className="truncate">{item.camera_name || item.camera_id}</span>
                                    </div>

                                    <div className="text-[10px] text-slate-400 font-mono">
                                      {item.timestamp_start_seconds !== undefined
                                        ? `Frame seek: ${item.timestamp_start_seconds.toFixed(1)}s`
                                        : '0.0s'}
                                    </div>
                                  </div>
                                </div>

                                <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
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
                                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl bg-teal-600/10 hover:bg-teal-600/20 border border-teal-500/30 text-teal-300 font-bold transition-all"
                                  >
                                    <Play className="h-3 w-3 fill-current" /> Seek &amp; Stream Clip
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
                    <div className="h-8 w-8 rounded-xl bg-teal-600 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                      <User className="h-4 w-4" />
                    </div>
                  )}
                </div>
              ))
            )}

            {loading && (
              <div className="flex gap-3 items-center text-slate-400 text-xs py-2">
                <div className="h-8 w-8 rounded-xl bg-teal-500/10 border border-teal-500/30 text-teal-400 flex items-center justify-center shrink-0">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                </div>
                <span>Copilot is analyzing query and executing system tools...</span>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        </div>

        {/* INPUT DOCK */}
        <div className="border-t border-slate-800/80 bg-slate-900/95 p-4 shrink-0">
          <div className="max-w-4xl mx-auto space-y-2">
            
            {errorMsg && (
              <div className="bg-red-950/50 border border-red-800 text-red-300 text-xs px-3.5 py-2 rounded-xl flex items-center justify-between">
                <span>{errorMsg}</span>
                <button onClick={() => setErrorMsg('')} className="text-red-400 hover:text-red-200">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Attached image preview */}
            {referencePreview && (
              <div className="flex items-center gap-3 bg-slate-850 border border-slate-750 p-2 rounded-xl w-fit">
                <img
                  src={referencePreview}
                  alt="Upload preview"
                  className="h-10 w-10 object-cover rounded-lg border border-slate-700"
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

            {/* Slash Command Autocomplete Menu */}
            {inputPrompt.startsWith('/') && (
              <div className="bg-slate-900 border border-slate-700 rounded-xl p-2 shadow-2xl space-y-1 animate-in slide-in-from-bottom-2 duration-150">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1 flex items-center justify-between">
                  <span>Available Slash Commands</span>
                  <span className="text-[9px] text-teal-400 font-mono">Click to select</span>
                </div>
                {SLASH_COMMANDS.filter(s => s.cmd.startsWith(inputPrompt.toLowerCase().split(' ')[0])).map((sc) => (
                  <button
                    key={sc.cmd}
                    type="button"
                    onClick={() => {
                      setInputPrompt(sc.cmd + ' ')
                    }}
                    className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-slate-800 flex items-center justify-between text-xs transition-colors group"
                  >
                    <span className="font-mono text-teal-300 font-bold group-hover:text-teal-200">{sc.cmd}</span>
                    <span className="text-slate-400 text-[11px] group-hover:text-slate-200">{sc.desc}</span>
                  </button>
                ))}
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
                className="px-3.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-teal-300 flex items-center justify-center transition-colors shadow-xs"
                title="Attach target photo for visual search"
              >
                <Upload className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => setInputPrompt('/help')}
                className="px-3 rounded-xl border border-teal-500/30 bg-teal-500/10 hover:bg-teal-500/20 text-teal-300 hover:text-teal-200 text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs shrink-0"
                title="View platform capabilities & /help guide"
              >
                <Sparkles className="h-3.5 w-3.5 text-teal-400" />
                <span>/help</span>
              </button>

              <input
                type="text"
                value={inputPrompt}
                onChange={(e) => setInputPrompt(e.target.value)}
                placeholder="Ask Copilot or type /help for commands guide..."
                className="flex-1 bg-slate-950 border border-slate-700 focus:border-teal-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-colors shadow-inner font-sans"
              />

              {loading ? (
                <button
                  type="button"
                  onClick={handleStopGeneration}
                  className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-2 transition-all shadow-sm animate-pulse"
                  title="Stop AI response generation"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!inputPrompt.trim() && !referenceB64}
                  className="px-5 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center gap-2 transition-colors shadow-sm"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>Send</span>
                </button>
              )}
            </form>
          </div>
        </div>
      </div>

      {/* UNIVERSAL API & MODEL SETTINGS MODAL WITH DROPDOWN SELECTORS */}
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
                <label className="font-bold text-slate-300">Execution Provider</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setConfig((prev) => ({ ...prev, provider: 'ollama' }))}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      config.provider === 'ollama'
                        ? 'border-teal-500 bg-teal-500/10 text-teal-300 font-bold shadow-xs'
                        : 'border-slate-800 bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>Local Ollama</span>
                      {config.provider === 'ollama' && <Check className="h-4 w-4 text-teal-400" />}
                    </div>
                    <p className="text-[10px] font-normal text-slate-400 mt-1">100% Offline Local Execution</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setConfig((prev) => ({ ...prev, provider: 'cloud' }))}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      config.provider === 'cloud'
                        ? 'border-teal-500 bg-teal-500/10 text-teal-300 font-bold shadow-xs'
                        : 'border-slate-800 bg-slate-800 text-slate-400 hover:text-slate-200'
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
                      className="w-full bg-slate-950 border border-slate-750 focus:border-teal-500 rounded-xl px-3 py-2 text-slate-200 focus:outline-none font-mono"
                    />
                  </div>

                  {/* Ollama Installed Models Dropdown */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="font-semibold text-slate-300">Ollama Model Name</label>
                      <button
                        type="button"
                        onClick={() => fetchInstalledOllamaModels(config.ollama_host)}
                        className="text-[10px] text-teal-400 hover:underline flex items-center gap-1"
                      >
                        <RefreshCw className={`h-3 w-3 ${loadingOllamaModels ? 'animate-spin' : ''}`} />
                        <span>Refresh Installed</span>
                      </button>
                    </div>

                    {!isCustomOllamaModel ? (
                      <select
                        value={ollamaModels.includes(config.ollama_model) ? config.ollama_model : '__custom__'}
                        onChange={(e) => {
                          if (e.target.value === '__custom__') {
                            setIsCustomOllamaModel(true)
                          } else {
                            setConfig((prev) => ({ ...prev, ollama_model: e.target.value }))
                          }
                        }}
                        className="w-full bg-slate-950 border border-slate-750 focus:border-teal-500 rounded-xl px-3 py-2 text-slate-200 focus:outline-none font-mono text-xs cursor-pointer"
                      >
                        <optgroup label="Installed Local Models">
                          {ollamaModels.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </optgroup>
                        <option value="__custom__">+ Enter Custom Model Name...</option>
                      </select>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={config.ollama_model}
                          onChange={(e) => setConfig((prev) => ({ ...prev, ollama_model: e.target.value }))}
                          placeholder="e.g. qwen2.5:3b"
                          className="flex-1 bg-slate-950 border border-slate-750 focus:border-teal-500 rounded-xl px-3 py-2 text-slate-200 focus:outline-none font-mono text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => setIsCustomOllamaModel(false)}
                          className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-750 text-xs text-slate-300 shrink-0"
                        >
                          Select from List
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Universal Cloud / Custom API Fields */
                <div className="space-y-4 border-t border-slate-800 pt-4">
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
                            setIsCustomCloudModel(false)
                          }}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-750 text-[11px] font-semibold text-slate-300 hover:text-teal-300 transition-colors"
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
                      className="w-full bg-slate-950 border border-slate-700 focus:border-teal-500 rounded-xl px-3 py-2 text-slate-200 focus:outline-none font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-slate-300">API Key (Optional for Local Proxies)</label>
                    <input
                      type="password"
                      value={config.cloud_api_key}
                      onChange={(e) => setConfig((prev) => ({ ...prev, cloud_api_key: e.target.value }))}
                      placeholder="sk-..."
                      className="w-full bg-slate-950 border border-slate-700 focus:border-teal-500 rounded-xl px-3 py-2 text-slate-200 focus:outline-none font-mono"
                    />
                  </div>

                  {/* Cloud Model Selector Dropdown */}
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-300">Model Name</label>
                    {!isCustomCloudModel ? (
                      <select
                        value={CLOUD_MODEL_OPTIONS.some((o) => o.value === config.cloud_model) ? config.cloud_model : '__custom__'}
                        onChange={(e) => {
                          if (e.target.value === '__custom__') {
                            setIsCustomCloudModel(true)
                          } else {
                            setConfig((prev) => ({ ...prev, cloud_model: e.target.value }))
                          }
                        }}
                        className="w-full bg-slate-950 border border-slate-750 focus:border-teal-500 rounded-xl px-3 py-2 text-slate-200 focus:outline-none font-mono text-xs cursor-pointer"
                      >
                        <optgroup label="Popular Provider Models">
                          {CLOUD_MODEL_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={config.cloud_model}
                          onChange={(e) => setConfig((prev) => ({ ...prev, cloud_model: e.target.value }))}
                          placeholder="e.g. gpt-4o-mini"
                          className="flex-1 bg-slate-950 border border-slate-750 focus:border-teal-500 rounded-xl px-3 py-2 text-slate-200 focus:outline-none font-mono text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => setIsCustomCloudModel(false)}
                          className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-750 text-xs text-slate-300 shrink-0"
                        >
                          Select from List
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingConfig}
                  className="px-5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold transition-colors shadow-sm"
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
