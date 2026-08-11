/**
 * Centralized API Base URL configuration for TraceNet.
 * Automatically adapts to host IP/domain when running across LAN/network.
 */
export const API_BASE = typeof window !== 'undefined' && window.location.hostname
  ? `http://${window.location.hostname}:8000`
  : 'http://localhost:8000'
