import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'

const API_BASE = 'http://localhost:8000'

interface Camera {
  camera_id: string
  name: string
  latitude?: number
  longitude?: number
  corridor_group?: string
  adjacency: string[]
  is_active: boolean
  status: string
  altitude?: number
  model_id?: string | null
  video_count: number
}

interface CamerasProps {
  cameras: Camera[]
  models: any[]
  onOpenRegisterModal: () => void
  onRefreshCameras?: () => void
}

declare global {
  interface Window { L: any }
}

// ─── tiny helpers ────────────────────────────────────────────────────────────
const SVG_FALLBACK =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%230F766E'><path stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z'/></svg>"

function StatusBadge({ status }: { status: string }) {
  const cfg =
    status === 'active'
      ? { dot: 'bg-emerald-500', txt: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-500/10' }
      : status === 'maintenance'
      ? { dot: 'bg-amber-500', txt: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-500/10' }
      : { dot: 'bg-rose-500', txt: 'text-rose-700 dark:text-rose-400', bg: 'bg-rose-500/10' }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${cfg.bg} ${cfg.txt}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {status.toUpperCase()}
    </span>
  )
}

// Reusable mini-map – renders when lat/lon valid, shows placeholder otherwise
function MiniMap({ containerRef, noCoords }: {
  containerRef: React.RefObject<HTMLDivElement | null>
  noCoords?: boolean
}) {
  return (
    <div className="relative w-full h-full rounded border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-100 dark:bg-slate-900">
      {noCoords && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 z-10 bg-slate-100 dark:bg-slate-900">
          <svg className="h-6 w-6 text-slate-300 dark:text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-[10px] text-slate-400 dark:text-slate-600 font-medium">No coordinates set</span>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full z-0" />
    </div>
  )
}

// ─── Modal wrapper with full-viewport backdrop + internal scroll ──────────────
function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    // Full-screen backdrop — covers 100% of viewport including top
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-[3px]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {children}
    </div>
  )
}

// ─── FIELD ROW for the details panel ─────────────────────────────────────────
function DetailRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-2 border-b border-slate-100 dark:border-slate-800 last:border-0 gap-4">
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider shrink-0">{label}</span>
      <span className={`text-xs text-right text-slate-800 dark:text-slate-200 ${mono ? 'font-mono' : 'font-medium'}`}>{value}</span>
    </div>
  )
}

// ─── FORM FIELD wrapper ───────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">{label}</label>
      {children}
    </div>
  )
}

const inputCls = "w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-[7px] text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-teal-600 dark:focus:border-teal-500 transition-colors"

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function Cameras({ cameras, models, onOpenRegisterModal, onRefreshCameras }: CamerasProps) {
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const [localCameras, setLocalCameras] = useState<Camera[]>(cameras)

  const [activeMenuId, setActiveMenuId] = useState<string | null>(null)
  // Store button position for fixed-positioned dropdown
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)

  const [detailCamera, setDetailCamera] = useState<Camera | null>(null)
  const detailMapContainerRef = useRef<HTMLDivElement>(null)
  const detailMapRef = useRef<any>(null)

  const [editCamera, setEditCamera] = useState<Camera | null>(null)
  const [editName, setEditName] = useState('')
  const [editLat, setEditLat] = useState('')
  const [editLon, setEditLon] = useState('')
  const [editCorridor, setEditCorridor] = useState('')
  const [editAdjacency, setEditAdjacency] = useState('')
  const [editStatus, setEditStatus] = useState('active')
  const [editAltitude, setEditAltitude] = useState('')
  const [editModelId, setEditModelId] = useState('')
  const [editFormError, setEditFormError] = useState('')
  const editMapContainerRef = useRef<HTMLDivElement>(null)
  const editMapRef = useRef<any>(null)

  const [deleteCamera, setDeleteCamera] = useState<Camera | null>(null)
  const [confirmName, setConfirmName] = useState('')
  const [deleteError, setDeleteError] = useState('')

  const mainMapRef = useRef<HTMLDivElement>(null)
  const mainMapInstanceRef = useRef<any>(null)

  // ── sync props
  useEffect(() => { setLocalCameras(cameras) }, [cameras])

  const refreshCameras = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/cameras`)
      if (r.ok) {
        setLocalCameras(await r.json())
        if (onRefreshCameras) {
          onRefreshCameras()
        }
      }
    } catch { /* ignore */ }
  }

  // ── thumbnails
  useEffect(() => {
    localCameras.forEach(async (cam) => {
      try {
        const r = await fetch(`${API_BASE}/api/v1/cameras/${cam.camera_id}/videos`)
        if (!r.ok) return
        const vids = await r.json()
        const v = vids.find((x: any) => x.thumbnail_path && x.processing_status === 'complete')
        if (v?.thumbnail_path) {
          let rel = v.thumbnail_path.replace(/\\/g, '/')
          const backendDataIndex = rel.indexOf('/backend/data/')
          if (backendDataIndex !== -1) {
            rel = rel.substring(backendDataIndex + 14)
          } else {
            const dataIndex = rel.indexOf('/data/')
            if (dataIndex !== -1) {
              rel = rel.substring(dataIndex + 6)
            } else {
              rel = rel.replace(/^\.?\/?data\//, '')
            }
          }
          setThumbnails(p => ({ ...p, [cam.camera_id]: `${API_BASE}/data/${rel}` }))
        }
      } catch { /* ignore */ }
    })
  }, [localCameras])

  // ── close dropdown on outside click
  useEffect(() => {
    const h = () => setActiveMenuId(null)
    window.addEventListener('click', h)
    return () => window.removeEventListener('click', h)
  }, [])

  // ── INITIALIZE MAP ONCE
  useEffect(() => {
    if (!window.L || !mainMapRef.current) return
    if (mainMapInstanceRef.current) return // Already initialized

    const valid = localCameras.filter(c => c.latitude != null && c.longitude != null)
    const center: [number, number] = valid.length > 0 ? [valid[0].latitude!, valid[0].longitude!] : [23.0225, 72.5714]

    try {
      const map = window.L.map(mainMapRef.current, { zoomControl: true }).setView(center, 12)
      mainMapInstanceRef.current = map
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
      }).addTo(map)

      const markerGroup = window.L.layerGroup().addTo(map)
      map.markerGroup = markerGroup
    } catch (err) {
      console.error("Leaflet Map init failed:", err)
    }

    return () => {
      if (mainMapInstanceRef.current) {
        mainMapInstanceRef.current.remove()
        mainMapInstanceRef.current = null
      }
    }
  }, []) // Empty dependency -> runs only ONCE on mount

  // ── UPDATE MARKERS ON THE EXISTING MAP
  useEffect(() => {
    const map = mainMapInstanceRef.current
    if (!map || !map.markerGroup || !window.L) return

    map.markerGroup.clearLayers()

    const valid = localCameras.filter(c => c.latitude != null && c.longitude != null)
    valid.forEach(cam => {
      const color = cam.status === 'active' ? '#059669' : cam.status === 'maintenance' ? '#D97706' : '#DC2626'
      const assignedModel = models.find(m => m.id === cam.model_id)
      const modelLabel = assignedModel ? `${assignedModel.name} (${assignedModel.model_type})` : 'None (Default)'
      const popup = `
        <div style="font-family:Inter,sans-serif;font-size:12px;min-width:160px">
          <div style="font-weight:700;color:#1F2937;margin-bottom:5px">${cam.name}</div>
          <div style="color:#6B7280;font-size:11px;margin-bottom:2px">ID: <b>${cam.camera_id}</b></div>
          <div style="color:#6B7280;font-size:11px;margin-bottom:2px">Model: <b>${modelLabel}</b></div>
          <div style="color:#6B7280;font-size:11px;margin-bottom:5px">${cam.latitude?.toFixed(5)}, ${cam.longitude?.toFixed(5)}</div>
          <div style="font-weight:700;font-size:11px;color:${color};text-transform:uppercase">${cam.status}</div>
        </div>`
      window.L.marker([cam.latitude!, cam.longitude!]).bindPopup(popup).addTo(map.markerGroup)
    })
  }, [localCameras, models])

  // ── DETAIL MAP
  function initLeafletMap(
    container: HTMLDivElement | null,
    mapRef: React.MutableRefObject<any>,
    lat?: number, lon?: number,
    opts: { zoom?: number; controls?: boolean } = {}
  ) {
    if (!window.L || !container || lat == null || lon == null) return
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    try {
      const m = window.L.map(container, {
        zoomControl: opts.controls ?? false,
        attributionControl: opts.controls ?? false,
      }).setView([lat, lon], opts.zoom ?? 14)
      mapRef.current = m
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(m)
      window.L.marker([lat, lon]).addTo(m)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (!detailCamera) return
    const t = setTimeout(() => initLeafletMap(detailMapContainerRef.current, detailMapRef, detailCamera.latitude, detailCamera.longitude), 80)
    return () => {
      clearTimeout(t)
      if (detailMapRef.current) { detailMapRef.current.remove(); detailMapRef.current = null }
    }
  }, [detailCamera])

  // ── EDIT MAP (debounced on lat/lon change)
  useEffect(() => {
    if (!editCamera) return
    const lat = parseFloat(editLat), lon = parseFloat(editLon)
    if (isNaN(lat) || isNaN(lon)) return
    const t = setTimeout(() => initLeafletMap(editMapContainerRef.current, editMapRef, lat, lon), 400)
    return () => {
      clearTimeout(t)
      if (editMapRef.current) { editMapRef.current.remove(); editMapRef.current = null }
    }
  }, [editCamera, editLat, editLon])

  // ── HANDLERS
  const openEdit = (cam: Camera) => {
    setEditCamera(cam)
    setEditName(cam.name)
    setEditLat(cam.latitude?.toString() ?? '')
    setEditLon(cam.longitude?.toString() ?? '')
    setEditCorridor(cam.corridor_group ?? '')
    setEditAdjacency(cam.adjacency.join(', '))
    setEditStatus(cam.status)
    setEditAltitude(cam.altitude?.toString() ?? '')
    setEditModelId(cam.model_id ?? '')
    setEditFormError('')
    setActiveMenuId(null)
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editCamera) return
    if (!editName.trim()) { setEditFormError('Camera name is required.'); return }
    const payload = {
      name: editName.trim(),
      latitude: editLat ? parseFloat(editLat) : null,
      longitude: editLon ? parseFloat(editLon) : null,
      corridor_group: editCorridor.trim() || null,
      adjacency: editAdjacency ? editAdjacency.split(',').map(s => s.trim()).filter(Boolean) : [],
      status: editStatus,
      altitude: editAltitude ? parseFloat(editAltitude) : null,
      model_id: editModelId || null,
    }
    try {
      const r = await fetch(`${API_BASE}/api/v1/cameras/${editCamera.camera_id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      if (r.ok) { setEditCamera(null); refreshCameras() }
      else { const d = await r.json(); setEditFormError(d.detail ?? 'Failed to save.') }
    } catch { setEditFormError('Network error.') }
  }

  const handleDeleteSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!deleteCamera) return
    if (confirmName.toLowerCase() !== deleteCamera.name.toLowerCase()) {
      setDeleteError('Name does not match. Please type the exact camera name.')
      return
    }
    try {
      const r = await fetch(`${API_BASE}/api/v1/cameras/${deleteCamera.camera_id}`, { method: 'DELETE' })
      if (r.ok) { setDeleteCamera(null); setConfirmName(''); refreshCameras() }
      else { const d = await r.json(); setDeleteError(d.detail ?? 'Delete failed.') }
    } catch { setDeleteError('Network error.') }
  }

  const nameMatches = confirmName.toLowerCase() === (deleteCamera?.name ?? '').toLowerCase()

  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── PAGE HEADER ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Camera Nodes</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Geographic grid, node statuses, and video archive registry.</p>
        </div>
        <button
          onClick={onOpenRegisterModal}
          className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white px-3 py-1.5 rounded text-xs font-bold transition-colors"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Register Camera
        </button>
      </div>

      {/* ── LEAFLET MAP ── */}
      {/* isolation:isolate creates a new CSS stacking context, containing Leaflet's
          internal z-index values (200–650) so they never bleed above fixed modals */}
      <section
        className="border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden bg-white dark:bg-slate-800"
        style={{ isolation: 'isolate' }}
      >
        <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          Sensor Grid — Topographical Map
        </div>
        <div ref={mainMapRef} className="h-72 w-full" />
      </section>

      {/* ── DEVICE TABLE ── */}
      <section className="border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden bg-white dark:bg-slate-800">
        <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          Device Directory — {localCameras.length} Node{localCameras.length !== 1 ? 's' : ''} Registered
        </div>

        {/* Table must NOT be overflow-x-auto — dropdown would clip */}
        <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-left">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
            <tr>
              <th className="px-3 py-2.5 w-[72px]">Preview</th>
              <th className="px-3 py-2.5">Camera / ID</th>
              <th className="px-3 py-2.5">Zone</th>
              <th className="px-3 py-2.5">Neighbors</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Assigned Model</th>
              <th className="px-3 py-2.5 text-center">Feeds</th>
              <th className="px-3 py-2.5 text-right w-[110px]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            {localCameras.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-16 text-xs text-slate-400 dark:text-slate-600">
                  No camera nodes configured. Use <strong>Register Camera</strong> to add the first node.
                </td>
              </tr>
            ) : localCameras.map(cam => {
              const thumb = thumbnails[cam.camera_id]
              return (
                <tr key={cam.camera_id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">

                  {/* THUMBNAIL — 16:9 inside fixed box */}
                  <td className="px-3 py-2.5">
                    <div className="w-[64px] h-[36px] rounded border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-100 dark:bg-slate-900 shrink-0">
                      <img
                        src={thumb || '/images/defaults/default_camera_thumbnail.webp'}
                        alt=""
                        onError={e => { e.currentTarget.src = SVG_FALLBACK }}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </td>

                  {/* NAME / ID */}
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">{cam.name}</div>
                    <div className="text-[10px] font-mono text-teal-700 dark:text-teal-400 mt-0.5">{cam.camera_id}</div>
                  </td>

                  {/* ZONE */}
                  <td className="px-3 py-2.5 whitespace-nowrap text-xs text-slate-600 dark:text-slate-400">
                    {cam.corridor_group ?? <span className="text-slate-400 dark:text-slate-600 italic">—</span>}
                  </td>

                  {/* NEIGHBORS */}
                  <td className="px-3 py-2.5 text-xs text-slate-600 dark:text-slate-400 max-w-[160px] truncate" title={cam.adjacency.join(', ')}>
                    {cam.adjacency.length > 0 ? cam.adjacency.join(', ') : <span className="text-slate-400 dark:text-slate-600 italic">None</span>}
                  </td>

                  {/* STATUS */}
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <StatusBadge status={cam.status} />
                  </td>

                  {/* ASSIGNED MODEL */}
                  <td className="px-3 py-2.5 whitespace-nowrap text-xs">
                    {(() => {
                      const model = models.find(m => m.id === cam.model_id)
                      return model ? (
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-800 dark:text-slate-100">{model.name}</span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">{model.model_type}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500 italic">None (Default)</span>
                      )
                    })()}
                  </td>

                  {/* FEEDS COUNT */}
                  <td className="px-3 py-2.5 whitespace-nowrap text-center">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{cam.video_count}</span>
                  </td>

                  {/* ACTIONS — Open + Kebab menu */}
                  <td className="px-3 py-2.5 whitespace-nowrap text-right">
                    <div className="inline-flex items-center gap-2 justify-end">
                      <Link
                        to={`/cameras/${cam.camera_id}`}
                        className="inline-flex items-center gap-1 bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700 text-white px-2.5 py-1 rounded text-[11px] font-bold transition-colors"
                      >
                        Open
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                        </svg>
                      </Link>

                      {/* ── KEBAB — independent size, stands alone ── */}
                      <div className="relative">
                        <button
                          title="More options"
                          onClick={e => {
                            e.stopPropagation()
                            if (activeMenuId === cam.camera_id) {
                              setActiveMenuId(null)
                              setMenuPos(null)
                            } else {
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                              setMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
                              setActiveMenuId(cam.camera_id)
                            }
                          }}
                          className="flex items-center justify-center w-7 h-7 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors"
                        >
                          {/* Vertical 3-dot icon — sized for the button, not the row */}
                          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                            <circle cx="12" cy="5" r="1.5" />
                            <circle cx="12" cy="12" r="1.5" />
                            <circle cx="12" cy="19" r="1.5" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {/* ── FIXED-POSITION DROPDOWN (escapes table overflow) ── */}
      {activeMenuId && menuPos && (() => {
        const cam = localCameras.find(c => c.camera_id === activeMenuId)
        if (!cam) return null
        return (
          <div
            style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 200 }}
            className="w-40 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl py-1"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => { setDetailCamera(cam); setActiveMenuId(null) }}
              className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <svg className="h-3.5 w-3.5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              View Details
            </button>
            <button
              onClick={() => { openEdit(cam) }}
              className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <svg className="h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              Edit Camera
            </button>
            <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
            <button
              onClick={() => { setDeleteCamera(cam); setConfirmName(''); setDeleteError(''); setActiveMenuId(null) }}
              className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete Camera
            </button>
          </div>
        )
      })()}

      {/* ════════════════════════════════════════════════════════════════
          VIEW DETAILS MODAL
          Layout: left = thumbnail (16:9) + metadata table
                  right = leaflet map (fills height)
          ════════════════════════════════════════════════════════════════ */}
      {detailCamera && (
        <Modal onClose={() => setDetailCamera(null)}>
          <div className="relative w-full max-w-5xl mx-4 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-md shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono font-bold bg-teal-500/10 text-teal-700 dark:text-teal-400 border border-teal-500/20 px-2 py-0.5 rounded">
                  {detailCamera.camera_id}
                </span>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Sensor Node Details</h3>
                <StatusBadge status={detailCamera.status} />
              </div>
              <button
                onClick={() => setDetailCamera(null)}
                className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal body — scrolls internally */}
            <div className="flex-1 overflow-y-auto">
              <div className="grid md:grid-cols-[1fr_1.2fr] gap-0 min-h-0">

                {/* ── LEFT COLUMN ── */}
                <div className="flex flex-col gap-0 border-r border-slate-200 dark:border-slate-700">

                  {/* Thumbnail — proper 16:9 */}
                  <div className="w-full aspect-video bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 overflow-hidden">
                    <img
                      src={thumbnails[detailCamera.camera_id] || '/images/defaults/default_camera_thumbnail.webp'}
                      alt="Latest frame preview"
                      onError={e => { e.currentTarget.src = SVG_FALLBACK }}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Metadata table */}
                  <div className="px-5 py-4 flex-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Node Metadata</p>
                    <div className="space-y-0">
                      <DetailRow label="Camera Name" value={detailCamera.name} />
                      <DetailRow label="Corridor / Zone" value={detailCamera.corridor_group ?? '—'} />
                      <DetailRow label="Latitude" value={detailCamera.latitude?.toFixed(6) ?? '—'} mono />
                      <DetailRow label="Longitude" value={detailCamera.longitude?.toFixed(6) ?? '—'} mono />
                      <DetailRow label="Altitude" value={detailCamera.altitude != null ? `${detailCamera.altitude.toFixed(1)} m` : '—'} mono />
                      <DetailRow label="Video Feeds" value={`${detailCamera.video_count} file${detailCamera.video_count !== 1 ? 's' : ''}`} />
                      <DetailRow
                        label="Adjacent Nodes"
                        value={detailCamera.adjacency.length > 0 ? detailCamera.adjacency.join(', ') : '—'}
                      />
                    </div>
                  </div>
                </div>

                {/* ── RIGHT COLUMN — full-height map ── */}
                <div className="flex flex-col min-h-[380px]">
                  <div className="px-5 pt-4 pb-2 shrink-0">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Location Reference</p>
                    {(detailCamera.latitude == null || detailCamera.longitude == null) && (
                      <p className="text-[11px] text-slate-400 mt-1">No coordinates registered for this node.</p>
                    )}
                  </div>
                  <div className="flex-1 px-5 pb-5">
                    <MiniMap
                      containerRef={detailMapContainerRef}
                      noCoords={detailCamera.latitude == null || detailCamera.longitude == null}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 shrink-0">
              <button
                onClick={() => { setDetailCamera(null); openEdit(detailCamera) }}
                className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                Edit Node
              </button>
              <button
                onClick={() => setDetailCamera(null)}
                className="px-4 py-1.5 rounded bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ════════════════════════════════════════════════════════════════
          EDIT MODAL
          Layout: left = form fields | right = live map + thumbnail
          ════════════════════════════════════════════════════════════════ */}
      {editCamera && (
        <Modal onClose={() => setEditCamera(null)}>
          <div className="relative w-full max-w-5xl mx-4 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono font-bold bg-slate-200 dark:bg-slate-900 text-slate-500 dark:text-slate-400 border border-slate-300 dark:border-slate-700 px-2 py-0.5 rounded">
                  {editCamera.camera_id} — read-only
                </span>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Edit Camera Node</h3>
              </div>
              <button
                onClick={() => setEditCamera(null)}
                className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <form onSubmit={handleEditSubmit} className="flex-1 overflow-y-auto">
              {editFormError && (
                <div className="mx-5 mt-4 p-3 rounded bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 text-xs">
                  {editFormError}
                </div>
              )}

              <div className="grid md:grid-cols-[1fr_1fr] gap-0">
                {/* ── LEFT: form fields ── */}
                <div className="flex flex-col gap-4 px-5 py-5 border-r border-slate-200 dark:border-slate-700">
                  <Field label="Camera Name *">
                    <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                      placeholder="e.g. Main Street Junction" className={inputCls} />
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Latitude">
                      <input type="number" step="0.000001" value={editLat} onChange={e => setEditLat(e.target.value)}
                        placeholder="23.0225" className={inputCls} />
                    </Field>
                    <Field label="Longitude">
                      <input type="number" step="0.000001" value={editLon} onChange={e => setEditLon(e.target.value)}
                        placeholder="72.5714" className={inputCls} />
                    </Field>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Corridor / Zone">
                      <input type="text" value={editCorridor} onChange={e => setEditCorridor(e.target.value)}
                        placeholder="Zone-A" className={inputCls} />
                    </Field>
                    <Field label="Altitude (m) — optional">
                      <input type="number" step="0.1" value={editAltitude} onChange={e => setEditAltitude(e.target.value)}
                        placeholder="e.g. 45.2" className={inputCls} />
                    </Field>
                  </div>

                  <Field label="Adjacent Camera IDs (comma-separated)">
                    <input type="text" value={editAdjacency} onChange={e => setEditAdjacency(e.target.value)}
                      placeholder="CAM_041, CAM_043" className={inputCls} />
                  </Field>

                  <Field label="Operational Status">
                    <select value={editStatus} onChange={e => setEditStatus(e.target.value)} className={inputCls}>
                      <option value="active">Active</option>
                      <option value="maintenance">Maintenance</option>
                      <option value="not-working">Not Working</option>
                    </select>
                  </Field>

                  <Field label="Assigned ML Model *">
                    <select
                      value={editModelId}
                      onChange={e => setEditModelId(e.target.value)}
                      className={inputCls}
                      required
                    >
                      <option value="">-- Select Model --</option>
                      {models.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.model_type})
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                {/* ── RIGHT: Live map + thumbnail preview ── */}
                <div className="flex flex-col gap-4 px-5 py-5">
                  {/* Live coordinate map — takes most vertical space */}
                  <div className="flex flex-col gap-1.5 flex-1 min-h-[220px]">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Live Coordinates Preview</p>
                    <MiniMap
                      containerRef={editMapContainerRef}
                      noCoords={!editLat || !editLon || isNaN(parseFloat(editLat)) || isNaN(parseFloat(editLon))}
                    />
                    <p className="text-[10px] text-slate-400 dark:text-slate-600">Map updates ~0.4 s after you stop typing.</p>
                  </div>

                  {/* Camera thumbnail preview — fixed 16:9 */}
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Current Thumbnail</p>
                    <div className="w-full aspect-video rounded border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-100 dark:bg-slate-900">
                      <img
                        src={thumbnails[editCamera.camera_id] || '/images/defaults/default_camera_thumbnail.webp'}
                        alt="Node thumbnail"
                        onError={e => { e.currentTarget.src = SVG_FALLBACK }}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer inside form so submit works */}
              <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 shrink-0">
                <button type="button" onClick={() => setEditCamera(null)}
                  className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                  Cancel
                </button>
                <button type="submit"
                  className="px-4 py-1.5 rounded bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold transition-colors">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* ════════════════════════════════════════════════════════════════
          DELETE CONFIRMATION MODAL
          ════════════════════════════════════════════════════════════════ */}
      {deleteCamera && (
        <Modal onClose={() => setDeleteCamera(null)}>
          <div className="relative w-full max-w-lg mx-4 bg-white dark:bg-slate-850 border border-red-200 dark:border-red-900/60 rounded-md shadow-2xl overflow-hidden flex flex-col">

            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-red-100 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 shrink-0">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 shrink-0">
                <svg className="h-4.5 w-4.5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-bold text-red-700 dark:text-red-400">Permanent Node Deletion</h3>
                <p className="text-[11px] text-red-500 dark:text-red-500/80 mt-0.5">This action cannot be undone.</p>
              </div>
            </div>

            {/* Body */}
            <form onSubmit={handleDeleteSubmit} className="flex flex-col gap-4 px-5 py-5">
              {deleteError && (
                <div className="p-3 rounded bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 text-xs">
                  {deleteError}
                </div>
              )}

              <div className="space-y-3 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                <p>
                  You are about to permanently delete camera node{' '}
                  <span className="font-bold text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-mono">
                    {deleteCamera.camera_id}
                  </span>{' '}
                  — <span className="font-semibold">"{deleteCamera.name}"</span>.
                </p>

                <div className="flex gap-3 p-3.5 rounded border-l-4 border-red-500 bg-red-50 dark:bg-red-950/20">
                  <svg className="h-4 w-4 text-red-500 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  <p className="text-red-700 dark:text-red-400 text-[11px] leading-relaxed">
                    <strong>All {deleteCamera.video_count} video feed record{deleteCamera.video_count !== 1 ? 's' : ''}</strong> associated with this camera will be permanently erased from the database. Video files on disk are not automatically removed, but forensic metadata and search index entries will be gone.
                  </p>
                </div>

                <p className="text-slate-600 dark:text-slate-400">
                  <strong>Recommendation:</strong> Transfer associated video feeds to another camera node before deleting, or export them as evidence packages first.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Type <span className="font-mono font-bold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{deleteCamera.name}</span> to confirm deletion:
                </label>
                <input
                  type="text"
                  value={confirmName}
                  onChange={e => setConfirmName(e.target.value)}
                  placeholder="Type exact camera name"
                  className={`${inputCls} focus:border-red-500`}
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setDeleteCamera(null)}
                  className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!nameMatches}
                  className={`px-4 py-1.5 rounded text-xs font-bold text-white transition-colors ${
                    nameMatches
                      ? 'bg-red-600 hover:bg-red-700 cursor-pointer'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  Delete Permanently
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}
    </div>
  )
}
