/**
 * Centralized API Base URL configuration for TraceNet.
 * Automatically adapts to host IP/domain when running across LAN/network.
 */
// Backend port; override at build/dev time with VITE_API_PORT (e.g. to run a second backend alongside).
const API_PORT = import.meta.env.VITE_API_PORT || '8000'

export const API_BASE = typeof window !== 'undefined' && window.location.hostname
  ? `http://${window.location.hostname}:${API_PORT}`
  : `http://localhost:${API_PORT}`
