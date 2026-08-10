import React, { createContext, useContext, useState, useCallback } from 'react'
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastMessage {
  id: string
  type: ToastType
  title: string
  message?: string
}

interface ToastContextType {
  showToast: (title: string, message?: string, type?: ToastType) => void
  success: (title: string, message?: string) => void
  error: (title: string, message?: string) => void
  warning: (title: string, message?: string) => void
  info: (title: string, message?: string) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback((title: string, message?: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).substring(2, 9)
    setToasts((prev) => [...prev, { id, title, message, type }])

    setTimeout(() => {
      removeToast(id)
    }, 4500)
  }, [removeToast])

  const success = useCallback((title: string, message?: string) => showToast(title, message, 'success'), [showToast])
  const error = useCallback((title: string, message?: string) => showToast(title, message, 'error'), [showToast])
  const warning = useCallback((title: string, message?: string) => showToast(title, message, 'warning'), [showToast])
  const info = useCallback((title: string, message?: string) => showToast(title, message, 'info'), [showToast])

  return (
    <ToastContext.Provider value={{ showToast, success, error, warning, info }}>
      {children}
      {/* Toast Render Container */}
      <div className="fixed bottom-5 right-5 z-[200] space-y-2.5 max-w-md w-full pointer-events-none px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-2xl backdrop-blur-md transition-all animate-in slide-in-from-bottom-3 duration-300 ${
              toast.type === 'success'
                ? 'bg-slate-900/95 border-emerald-500/40 text-emerald-300 ring-1 ring-emerald-500/20'
                : toast.type === 'error'
                ? 'bg-slate-900/95 border-rose-500/40 text-rose-300 ring-1 ring-rose-500/20'
                : toast.type === 'warning'
                ? 'bg-slate-900/95 border-amber-500/40 text-amber-300 ring-1 ring-amber-500/20'
                : 'bg-slate-900/95 border-cyan-500/40 text-cyan-300 ring-1 ring-cyan-500/20'
            }`}
          >
            <div className="shrink-0 pt-0.5">
              {toast.type === 'success' && <CheckCircle2 className="h-5 w-5 text-emerald-400" />}
              {toast.type === 'error' && <AlertCircle className="h-5 w-5 text-rose-400" />}
              {toast.type === 'warning' && <AlertTriangle className="h-5 w-5 text-amber-400" />}
              {toast.type === 'info' && <Info className="h-5 w-5 text-cyan-400" />}
            </div>

            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-bold text-slate-100 tracking-tight">{toast.title}</h4>
              {toast.message && <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{toast.message}</p>}
            </div>

            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 p-1 text-slate-500 hover:text-slate-300 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
