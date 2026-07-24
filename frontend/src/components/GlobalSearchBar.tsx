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
      className="relative flex items-center w-full max-w-md cursor-pointer group"
    >
      <div className="w-full flex items-center justify-between bg-slate-100/90 dark:bg-slate-800/90 hover:bg-slate-200/80 dark:hover:bg-slate-750 border border-slate-250 dark:border-slate-700/80 rounded-lg px-3.5 py-1.5 shadow-inner transition-all">
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 group-hover:text-teal-700 dark:group-hover:text-teal-400 transition-colors">
          <Sparkles className="h-4 w-4 shrink-0 text-teal-700 dark:text-teal-400 animate-pulse" />
          <span className="text-xs font-medium truncate">
            Ask Copilot or search footage...
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0 bg-white dark:bg-slate-900 border border-slate-250 dark:border-slate-700 rounded px-1.5 py-0.5 text-[10px] font-mono text-slate-500 dark:text-slate-400 shadow-2xs">
          <Command className="h-2.5 w-2.5" />
          <span>K</span>
        </div>
      </div>
    </div>
  )
}
