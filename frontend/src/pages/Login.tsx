import { useState, type FormEvent } from 'react'
import { ShieldCheck } from 'lucide-react'
import { API_BASE } from '../config/api'
import type { AuthUser } from '../auth'

interface Props {
  hasUsers: boolean
  onLoggedIn: (user: AuthUser) => void
}

export default function LoginScreen({ hasUsers, onLoggedIn }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.detail || 'Login failed.')
        return
      }
      onLoggedIn(data.user)
    } catch {
      setError('Cannot reach the TraceNet backend.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0B1324] text-slate-100 flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-slate-800 bg-[#0F172A] p-6 space-y-4 shadow-xl">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-teal-400" />
          <div>
            <h1 className="text-lg font-semibold">TraceNet</h1>
            <p className="text-xs text-slate-400">Sign in with your officer account</p>
          </div>
        </div>

        {!hasUsers && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200 space-y-1">
            <p className="font-semibold">No accounts exist yet.</p>
            <p>Create the first Admin on the server (from <code className="font-mono">backend/</code>):</p>
            <code className="block font-mono text-[11px] text-amber-100">
              python -m app.auth.users add &lt;username&gt; --role admin --name "Name / Badge"
            </code>
          </div>
        )}

        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-300">Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-300">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
          />
        </label>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-teal-600 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="text-[11px] text-slate-500">Every search, acknowledgement and Copilot action is logged under your name.</p>
      </form>
    </div>
  )
}
