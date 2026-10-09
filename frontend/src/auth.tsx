import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { API_BASE } from './config/api'
import LoginScreen from './pages/Login'

export type Role = 'operator' | 'admin'

export interface AuthUser {
  id: string
  username: string
  display_name: string
  role: Role
}

interface AuthContextValue {
  user: AuthUser
  authEnabled: boolean
  isAdmin: boolean
  logout: () => Promise<void>
}

const UNAUTHORIZED_EVENT = 'tracenet:unauthorized'
const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * Send the session cookie with every request to the backend and react to an expired / missing session.
 * Images and videos from the backend carry the cookie automatically (same site).
 */
export function installFetchAuth() {
  const original = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith(API_BASE)) return original(input, init)
    const response = await original(input, { ...init, credentials: 'include' })
    if (response.status === 401 && !url.includes('/api/v1/auth/')) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    return response
  }
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthGate>')
  return value
}

type GateState = 'loading' | 'login' | 'ready' | 'offline'

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authEnabled, setAuthEnabled] = useState(true)
  const [hasUsers, setHasUsers] = useState(true)

  const check = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/me`)
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
        setAuthEnabled(Boolean(data.auth_enabled))
        setState('ready')
        return
      }
      if (res.status === 401) {
        const status = await fetch(`${API_BASE}/api/v1/auth/status`).then((r) => r.json()).catch(() => ({}))
        setHasUsers(status.has_users !== false)
        setState('login')
        return
      }
      setState('offline')
    } catch {
      setState('offline')
    }
  }, [])

  useEffect(() => {
    check()
    const onUnauthorized = () => {
      setUser(null)
      setState('login')
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [check])

  const logout = useCallback(async () => {
    await fetch(`${API_BASE}/api/v1/auth/logout`, { method: 'POST' }).catch(() => undefined)
    setUser(null)
    setState('login')
  }, [])

  if (state === 'loading') {
    return <div className="min-h-screen bg-[#0B1324]" />
  }
  if (state === 'offline') {
    return (
      <div className="min-h-screen bg-[#0B1324] text-slate-200 flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-3">
          <p className="font-semibold">Cannot reach the TraceNet backend</p>
          <p className="text-sm text-slate-400">Expected at {API_BASE}. Start the backend, then retry.</p>
          <button onClick={check} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500">
            Retry
          </button>
        </div>
      </div>
    )
  }
  if (state === 'login' || !user) {
    return (
      <LoginScreen
        hasUsers={hasUsers}
        onLoggedIn={(loggedIn) => {
          setUser(loggedIn)
          setAuthEnabled(true)
          setState('ready')
        }}
      />
    )
  }
  return (
    <AuthContext.Provider value={{ user, authEnabled, isAdmin: user.role === 'admin', logout }}>
      {children}
    </AuthContext.Provider>
  )
}
