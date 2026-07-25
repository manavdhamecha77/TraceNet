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
      <div className="w-full flex items-center justify-between rounded-xl px-3.5 py-1.5 bg-white/90 dark:bg-slate-900/90 hover:bg-white dark:hover:bg-slate-850 border border-slate-200/90 dark:border-slate-800/90 hover:border-teal-500/40 dark:hover:border-teal-500/40 transition-all duration-150 shadow-xs">
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 group-hover:text-teal-600 dark:group-hover:text-cyan-400 transition-colors">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-cyan-400 animate-pulse" />
          <span className="text-xs font-medium truncate text-slate-600 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-slate-100 transition-colors">
            Ask Copilot or search footage...
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 shadow-2xs">
          <Command className="h-2.5 w-2.5" />
          <span>K</span>
        </div>
      </div>
    </div>
  )
}
