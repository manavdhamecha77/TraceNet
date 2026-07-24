import { useEffect } from 'react'
import { Sparkles, Command } from 'lucide-react'

interface GlobalSearchBarProps {
  onOpenCopilot: (initialQuery?: string) => void
}

export default function GlobalSearchBar({ onOpenCopilot }: GlobalSearchBarProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpenCopilot()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onOpenCopilot])

  return (
    <div
      onClick={() => onOpenCopilot()}
      className="relative flex items-center w-full max-w-sm cursor-pointer group"
      role="button"
      aria-label="Open AI Copilot (Ctrl+K)"
    >
      <div
        className="w-full flex items-center justify-between rounded-lg px-3 py-1.5 transition-all duration-150"
        style={{
          background: 'rgba(13, 21, 41, 0.9)',
          border: '1px solid #1E2D4A',
        }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(0, 201, 184, 0.4)'
          ;(e.currentTarget as HTMLDivElement).style.boxShadow = '0 0 0 3px rgba(0, 201, 184, 0.08)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLDivElement).style.borderColor = '#1E2D4A'
          ;(e.currentTarget as HTMLDivElement).style.boxShadow = 'none'
        }}
      >
        <div className="flex items-center gap-2 text-slate-500 group-hover:text-cyan-400 transition-colors duration-150">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-cyan-500" style={{ animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite' }} />
          <span className="text-xs font-medium truncate text-slate-400 group-hover:text-slate-300 transition-colors">
            Ask Copilot or search footage...
          </span>
        </div>

        <div
          className="flex items-center gap-1 shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]"
          style={{
            background: '#080E1C',
            border: '1px solid #1E2D4A',
            color: '#475569',
          }}
        >
          <Command className="h-2.5 w-2.5" />
          <span>K</span>
        </div>
      </div>
    </div>
  )
}
