import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause, RefreshCw } from 'lucide-react'
import { useToast } from './Toast'
import { API_BASE } from '../config/api'
import { formatDisplayDate } from '../utils/dateFormatter'

// ─── API contracts (mirror backend/app/analytics/lumpi/replay.py) ──────────────
interface ReplayCamera {
  camera_id: string
  device_id: number
  name: string
  width: number
  height: number
  fps_native: number
  video_url: string
  annotated_video_url: string
  position: [number, number, number]
  look_at: [number, number] | null
  sightings: number
}

interface ReplayTrack {
  gid: number
  object_type: 'person' | 'vehicle'
  class_name: string
  color: string
  cameras: string[]
  members: { camera_id: string; track_id: number; first_frame: number; last_frame: number }[]
  first_frame: number
  last_frame: number
  points: [number, number, number][] // [frame, x, y]
}

type FrameBox = [number, number, number, number, number, number] // gid, x1, y1, x2, y2, conf

interface Replay {
  experiment_id: number
  generated_at: string
  model: { weights: string; classes: string[]; conf: number; imgsz: number; tracker: string }
  fps: number
  frame_count: number
  duration_s: number
  ground_z: number
  bounds: { min_x: number; max_x: number; min_y: number; max_y: number }
  fusion: { radius_m: Record<string, number>; min_common_frames: number }
  cameras: ReplayCamera[]
  tracks: ReplayTrack[]
  frames: Record<string, FrameBox[]>[]
  stats: { detections: number; local_tracks: number; fused_tracks: number; multi_camera_tracks: number; build_seconds: number }
}

interface ReplayStatus {
  experiment_id: number
  built: boolean
  json_url: string | null
  generated_at: string | null
  model: Replay['model'] | null
  stats: Replay['stats'] | null
  building: boolean
  progress: number
  message: string | null
  error: string | null
  experiments: { experiment_id: number; camera_count: number; label_rows: number; has_video: boolean }[]
}

const TRAIL_FRAMES = 45
const SYNC_TOLERANCE_S = 0.08

/** Where the video content actually sits inside its element (object-fit: contain letterboxing). */
function contentRect(el: HTMLElement, srcW: number, srcH: number) {
  const ew = el.clientWidth, eh = el.clientHeight
  const s = Math.min(ew / srcW, eh / srcH)
  const w = srcW * s, h = srcH * s
  return { x: (ew - w) / 2, y: (eh - h) / 2, w, h, s }
}

// ─── Component ─────────────────────────────────────────────────────────────────
export const LumpiReplayPanel: React.FC = () => {
  const toast = useToast()
  const [experimentId, setExperimentId] = useState<number>(1)
  const [status, setStatus] = useState<ReplayStatus | null>(null)
  const [replay, setReplay] = useState<Replay | null>(null)
  const [loadingReplay, setLoadingReplay] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState<number>(1)
  const [showBoxes, setShowBoxes] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [dimOthers, setDimOthers] = useState(true)
  const [selectedGid, setSelectedGid] = useState<number | null>(null)
  const [frame, setFrame] = useState(0)

  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({})
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({})
  const bevRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number>(0)
  const selectedRef = useRef<number | null>(null)
  const optsRef = useRef({ showBoxes, showLabels, dimOthers })
  useEffect(() => { selectedRef.current = selectedGid }, [selectedGid])
  useEffect(() => { optsRef.current = { showBoxes, showLabels, dimOthers } }, [showBoxes, showLabels, dimOthers])

  const trackByGid = useMemo(() => {
    const m = new Map<number, ReplayTrack>()
    replay?.tracks.forEach((t) => m.set(t.gid, t))
    return m
  }, [replay])

  // ── status + replay loading
  const fetchStatus = useCallback(async (exp: number): Promise<ReplayStatus | null> => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/multicam/replay/lumpi/status?experiment_id=${exp}`)
      if (!res.ok) return null
      const s: ReplayStatus = await res.json()
      setStatus(s)
      return s
    } catch {
      return null
    }
  }, [])

  const fetchReplay = useCallback(async (exp: number) => {
    setLoadingReplay(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/multicam/replay/lumpi/${exp}`)
      if (!res.ok) { setReplay(null); return }
      const r: Replay = await res.json()
      setReplay(r)
      setSelectedGid(null)
      setFrame(0)
      setPlaying(false)
      // Demo deep links: /multicam?tab=replay&autoplay=1 starts playback; &follow=<gid> pre-selects an identity
      let autoplay = false
      try {
        const qs = new URLSearchParams(window.location.search)
        autoplay = qs.get('autoplay') === '1'
        const follow = parseInt(qs.get('follow') ?? '', 10)
        if (Number.isFinite(follow) && r.tracks.some((t) => t.gid === follow)) setSelectedGid(follow)
      } catch { /* ignore */ }
      if (autoplay) {
        setTimeout(() => {
          const vids = r.cameras.map((c) => videoRefs.current[c.camera_id]).filter(Boolean) as HTMLVideoElement[]
          vids.forEach((v) => v.play().catch(() => {}))
          if (vids.length) setPlaying(true)
        }, 400)
      }
    } catch (e: any) {
      toast.error('Replay load failed', e.message)
    } finally {
      setLoadingReplay(false)
    }
  }, [toast])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = await fetchStatus(experimentId)
      if (cancelled) return
      if (s?.built) fetchReplay(experimentId)
      else setReplay(null)
    })()
    return () => { cancelled = true }
  }, [experimentId, fetchStatus, fetchReplay])

  // poll while building
  useEffect(() => {
    if (!status?.building) return
    const id = setInterval(async () => {
      const s = await fetchStatus(experimentId)
      if (s && !s.building) {
        clearInterval(id)
        if (s.error) toast.error('Replay build failed', s.error)
        else if (s.built) { toast.success('Replay ready', `Experiment ${experimentId}: ${s.stats?.fused_tracks ?? '?'} fused identities`); fetchReplay(experimentId) }
      }
    }, 1500)
    return () => clearInterval(id)
  }, [status?.building, experimentId, fetchStatus, fetchReplay, toast])

  const startBuild = async (force: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/multicam/replay/lumpi/build`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ experiment_id: experimentId, force }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || `Build failed (${res.status})`)
      if (data.status === 'exists') { fetchReplay(experimentId); return }
      toast.info('Replay build started', 'Running the detector and ByteTrack on all three cameras, then fusing tracks.')
      setStatus((s) => (s ? { ...s, building: true, progress: 0, message: 'queued', error: null } : s))
    } catch (e: any) {
      toast.error('Could not start build', e.message)
    }
  }

  // ── playback control (first camera is the master clock)
  const masterVideo = () => (replay ? videoRefs.current[replay.cameras[0].camera_id] : null)
  const allVideos = () => (replay ? replay.cameras.map((c) => videoRefs.current[c.camera_id]).filter(Boolean) as HTMLVideoElement[] : [])

  const togglePlay = () => {
    const vids = allVideos()
    if (!vids.length) return
    if (playing) { vids.forEach((v) => v.pause()); setPlaying(false) }
    else { vids.forEach((v) => { v.playbackRate = rate; v.play().catch(() => {}) }); setPlaying(true) }
  }

  const seekToFrame = (f: number) => {
    if (!replay) return
    const t = Math.min(replay.duration_s - 0.001, Math.max(0, f / replay.fps))
    allVideos().forEach((v) => { v.currentTime = t })
    setFrame(f)
  }

  const stepFrame = (delta: number) => {
    if (!replay) return
    allVideos().forEach((v) => v.pause()); setPlaying(false)
    seekToFrame(Math.min(replay.frame_count - 1, Math.max(0, frame + delta)))
  }

  useEffect(() => { allVideos().forEach((v) => { v.playbackRate = rate }) }, [rate]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── render loop: keep slaves in sync, draw overlays + bird's-eye view
  useEffect(() => {
    if (!replay) return
    const draw = () => {
      const master = masterVideo()
      if (master) {
        const t = master.currentTime
        allVideos().forEach((v) => { if (v !== master && Math.abs(v.currentTime - t) > SYNC_TOLERANCE_S) v.currentTime = t })
        const f = Math.min(replay.frame_count - 1, Math.max(0, Math.round(t * replay.fps)))
        setFrame((prev) => (prev === f ? prev : f))
        drawOverlays(f)
        drawBev(f)
      }
      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [replay]) // eslint-disable-line react-hooks/exhaustive-deps

  const drawOverlays = (f: number) => {
    if (!replay) return
    const { showBoxes: boxes, showLabels: labels, dimOthers: dim } = optsRef.current
    const sel = selectedRef.current
    for (const cam of replay.cameras) {
      const canvas = canvasRefs.current[cam.camera_id]
      const video = videoRefs.current[cam.camera_id]
      if (!canvas || !video) continue
      const cw = video.clientWidth, ch = video.clientHeight
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      ctx.clearRect(0, 0, cw, ch)
      if (!boxes) continue
      const cr = contentRect(video, cam.width, cam.height)
      const rows = replay.frames[f]?.[cam.camera_id] ?? []
      for (const [gid, x1, y1, x2, y2, conf] of rows) {
        const tr = trackByGid.get(gid)
        const isSel = sel === gid
        const multi = (tr?.cameras.length ?? 1) > 1
        const bx = cr.x + x1 * cr.s, by = cr.y + y1 * cr.s, bw = (x2 - x1) * cr.s, bh = (y2 - y1) * cr.s
        ctx.globalAlpha = sel != null && !isSel && dim ? 0.25 : 1
        ctx.strokeStyle = tr?.color ?? '#38bdf8'
        ctx.lineWidth = isSel ? 4 : multi ? 2.5 : 1.5
        if (isSel) { ctx.shadowColor = tr?.color ?? '#fff'; ctx.shadowBlur = 14 } else ctx.shadowBlur = 0
        ctx.strokeRect(bx, by, bw, bh)
        ctx.shadowBlur = 0
        if (labels || isSel) {
          const text = `#${gid} ${tr?.class_name ?? ''}${isSel ? ` ${(conf * 100).toFixed(0)}%` : ''}`
          ctx.font = `${isSel ? 'bold 12px' : '10px'} Inter, ui-sans-serif, system-ui`
          const tw = ctx.measureText(text).width + 8
          ctx.fillStyle = tr?.color ?? '#38bdf8'
          ctx.fillRect(bx, by - 15, tw, 15)
          ctx.fillStyle = '#0f172a'
          ctx.fillText(text, bx + 4, by - 4)
        }
      }
      ctx.globalAlpha = 1
    }
  }

  const drawBev = (f: number) => {
    if (!replay || !bevRef.current) return
    const canvas = bevRef.current
    const parent = canvas.parentElement
    const cw = parent?.clientWidth ?? 360, ch = parent?.clientHeight ?? 360
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const b = replay.bounds
    const pad = 18
    const scale = Math.min((cw - 2 * pad) / (b.max_x - b.min_x), (ch - 2 * pad) / (b.max_y - b.min_y))
    const ox = (cw - (b.max_x - b.min_x) * scale) / 2, oy = (ch - (b.max_y - b.min_y) * scale) / 2
    const X = (x: number) => ox + (x - b.min_x) * scale
    const Y = (y: number) => ch - (oy + (y - b.min_y) * scale)

    ctx.fillStyle = '#020617'; ctx.fillRect(0, 0, cw, ch)
    // 10 m grid
    ctx.strokeStyle = 'rgba(148,163,184,0.12)'; ctx.lineWidth = 1
    for (let gx = Math.ceil(b.min_x / 10) * 10; gx <= b.max_x; gx += 10) { ctx.beginPath(); ctx.moveTo(X(gx), 0); ctx.lineTo(X(gx), ch); ctx.stroke() }
    for (let gy = Math.ceil(b.min_y / 10) * 10; gy <= b.max_y; gy += 10) { ctx.beginPath(); ctx.moveTo(0, Y(gy)); ctx.lineTo(cw, Y(gy)); ctx.stroke() }
    ctx.fillStyle = 'rgba(148,163,184,0.5)'; ctx.font = '10px Inter, ui-sans-serif'
    ctx.fillText('10 m grid · calibrated ground plane', 8, ch - 8)

    // cameras
    for (const cam of replay.cameras) {
      const [cx, cy] = cam.position
      ctx.fillStyle = '#38bdf8'
      ctx.beginPath(); ctx.arc(X(cx), Y(cy), 5, 0, Math.PI * 2); ctx.fill()
      if (cam.look_at) {
        ctx.strokeStyle = 'rgba(56,189,248,0.35)'; ctx.setLineDash([4, 4])
        ctx.beginPath(); ctx.moveTo(X(cx), Y(cy)); ctx.lineTo(X(cam.look_at[0]), Y(cam.look_at[1])); ctx.stroke(); ctx.setLineDash([])
      }
      ctx.fillStyle = '#7dd3fc'; ctx.font = 'bold 10px Inter, ui-sans-serif'
      ctx.fillText(`cam ${cam.device_id}`, X(cx) + 7, Y(cy) + 3)
    }

    const sel = selectedRef.current
    const dim = optsRef.current.dimOthers
    for (const tr of replay.tracks) {
      if (tr.first_frame > f) continue
      const pts = tr.points.filter((p) => p[0] <= f && p[0] >= f - TRAIL_FRAMES)
      if (!pts.length) continue
      const isSel = sel === tr.gid
      const alpha = sel != null && !isSel && dim ? 0.18 : 1
      ctx.globalAlpha = alpha
      ctx.strokeStyle = tr.color; ctx.lineWidth = isSel ? 3 : 1.5
      ctx.beginPath()
      pts.forEach((p, i) => { if (i === 0) ctx.moveTo(X(p[1]), Y(p[2])); else ctx.lineTo(X(p[1]), Y(p[2])) })
      ctx.stroke()
      const last = pts[pts.length - 1]
      const r = tr.object_type === 'person' ? 3 : 4.5
      ctx.fillStyle = tr.color
      ctx.beginPath(); ctx.arc(X(last[1]), Y(last[2]), isSel ? r + 2 : r, 0, Math.PI * 2); ctx.fill()
      if (tr.cameras.length > 1) { ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(X(last[1]), Y(last[2]), r + 3, 0, Math.PI * 2); ctx.stroke() }
      // label only what matters: the followed object, or (when nothing is followed) cross-camera identities
      if (isSel || (sel == null && tr.cameras.length > 1)) { ctx.fillStyle = isSel ? '#f8fafc' : 'rgba(226,232,240,0.75)'; ctx.font = isSel ? 'bold 11px Inter, ui-sans-serif' : '9px Inter, ui-sans-serif'; ctx.fillText(`#${tr.gid}`, X(last[1]) + 6, Y(last[2]) - 5) }
    }
    ctx.globalAlpha = 1
  }

  // ── click-to-select in any camera view
  const handleCanvasClick = (cam: ReplayCamera) => (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!replay) return
    const canvas = e.currentTarget
    const rect = canvas.getBoundingClientRect()
    const cr = contentRect(canvas, cam.width, cam.height)
    const px = (e.clientX - rect.left - cr.x) / cr.s
    const py = (e.clientY - rect.top - cr.y) / cr.s
    const rows = replay.frames[frame]?.[cam.camera_id] ?? []
    let best: FrameBox | null = null
    for (const row of rows) {
      const [, x1, y1, x2, y2] = row
      if (px >= x1 && px <= x2 && py >= y1 && py <= y2) {
        if (!best || (x2 - x1) * (y2 - y1) < (best[3] - best[1]) * (best[4] - best[2])) best = row
      }
    }
    setSelectedGid(best ? best[0] : null)
  }

  const selectedTrack = selectedGid != null ? trackByGid.get(selectedGid) ?? null : null
  const visibleNow = useMemo(() => {
    if (!replay) return { ids: 0, multi: 0 }
    const ids = new Set<number>()
    Object.values(replay.frames[frame] ?? {}).forEach((rows) => rows.forEach((r) => ids.add(r[0])))
    let multi = 0
    ids.forEach((g) => { if ((trackByGid.get(g)?.cameras.length ?? 1) > 1) multi++ })
    return { ids: ids.size, multi }
  }, [replay, frame, trackByGid])

  const experiments = status?.experiments?.length ? status.experiments : [{ experiment_id: experimentId, camera_count: 3, label_rows: 0, has_video: true }]

  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div className="h-full w-full overflow-y-auto bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div className="max-w-[1700px] mx-auto px-5 py-4 space-y-4">

        {/* Header row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              Multi-Camera Fusion Replay
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">LIVE DETECTOR OUTPUT</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-4xl leading-relaxed">
              Three synchronized LUMPI intersection cameras. Boxes are TraceNet's detector + ByteTrack on each feed; every detection is projected through the real camera calibration onto one ground plane, and tracks that occupy the same spot at the same time are fused into one identity. Same colour and ID in every view means one physical object. No dataset labels are used.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select value={experimentId} onChange={(e) => setExperimentId(parseInt(e.target.value, 10))} disabled={status?.building}
              className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs focus:outline-none focus:border-sky-500">
              {experiments.map((ex) => <option key={ex.experiment_id} value={ex.experiment_id}>Measurement {ex.experiment_id} ({ex.camera_count} cams)</option>)}
            </select>
            <button type="button" onClick={() => startBuild(!!status?.built)} disabled={status?.building}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50">
              {status?.building ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
              {status?.building ? `Building ${Math.round(status.progress)}%` : status?.built ? 'Rebuild' : 'Build replay'}
            </button>
          </div>
        </div>

        {status?.building && (
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-4 py-2.5 text-xs text-sky-800 dark:text-sky-200">
            <div className="flex justify-between"><span>{status.message ?? 'working…'}</span><span className="font-mono">{Math.round(status.progress)}%</span></div>
            <div className="mt-1.5 h-1.5 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden"><div className="h-full bg-sky-400 transition-all" style={{ width: `${status.progress}%` }} /></div>
          </div>
        )}
        {status?.error && !status.building && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-300">Last build failed: {status.error}</div>
        )}

        {!replay ? (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 py-20 text-center text-xs text-slate-500">
            {loadingReplay ? 'Loading replay…' : status?.building ? 'Detector running on all cameras — this takes about a minute.' : 'No replay built for this experiment yet. Click Build replay.'}
          </div>
        ) : (
          <>
            {/* Stats strip */}
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300">{replay.model.weights} · {replay.model.tracker}</span>
              <span>{replay.stats.detections.toLocaleString()} detections</span><span className="text-slate-300 dark:text-slate-700">·</span>
              <span>{replay.stats.local_tracks} per-camera tracks</span><span className="text-slate-300 dark:text-slate-700">·</span>
              <span className="text-emerald-700 dark:text-emerald-400 font-semibold">{replay.stats.fused_tracks} fused identities, {replay.stats.multi_camera_tracks} seen by 2+ cameras</span><span className="text-slate-300 dark:text-slate-700">·</span>
              <span>now on screen: {visibleNow.ids} objects, {visibleNow.multi} cross-camera</span>
              <span className="ml-auto">built {formatDisplayDate(replay.generated_at)} in {replay.stats.build_seconds}s</span>
            </div>

            <div className="grid xl:grid-cols-[1fr_340px] gap-4">
              {/* Camera views */}
              <div className="space-y-3">
                <div className={`grid gap-3 items-start ${replay.cameras.length >= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
                  {replay.cameras.map((cam) => (
                    <div key={cam.camera_id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-1.5 text-[11px] border-b border-slate-200 dark:border-slate-800">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">{cam.name}</span>
                        <span className="text-slate-500 font-mono">{cam.width}×{cam.height} · {cam.sightings} ids</span>
                      </div>
                      {/* padding-bottom trick keeps the box exactly the clip's aspect ratio regardless of grid row height */}
                      <div className="relative w-full h-0 bg-black" style={{ paddingBottom: `${(cam.height / cam.width) * 100}%` }}>
                        <video
                          ref={(el) => { videoRefs.current[cam.camera_id] = el }}
                          src={`${API_BASE}${cam.video_url}`}
                          muted loop playsInline preload="auto"
                          className="absolute inset-0 w-full h-full"
                          onEnded={() => setPlaying(false)}
                        />
                        <canvas
                          ref={(el) => { canvasRefs.current[cam.camera_id] = el }}
                          onClick={handleCanvasClick(cam)}
                          className="absolute inset-0 w-full h-full cursor-crosshair"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Transport */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 px-4 py-3 flex flex-wrap items-center gap-3 text-xs">
                  <button type="button" onClick={togglePlay} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold">
                    {playing ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}{playing ? 'Pause' : 'Play all'}
                  </button>
                  <button type="button" onClick={() => stepFrame(-1)} className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800" title="Previous frame">‹</button>
                  <button type="button" onClick={() => stepFrame(1)} className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800" title="Next frame">›</button>
                  <input type="range" min={0} max={replay.frame_count - 1} value={frame}
                    onChange={(e) => { allVideos().forEach((v) => v.pause()); setPlaying(false); seekToFrame(parseInt(e.target.value, 10)) }}
                    className="flex-1 min-w-[160px] accent-sky-400" />
                  <span className="font-mono text-slate-700 dark:text-slate-300 tabular-nums">{(frame / replay.fps).toFixed(2)}s / {replay.duration_s.toFixed(2)}s · f{frame}</span>
                  <div className="flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-300 dark:border-slate-700">
                    {[0.25, 0.5, 1].map((r) => (
                      <button key={r} type="button" onClick={() => setRate(r)} className={`px-2 py-1 rounded-md font-medium ${rate === r ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}>{r}×</button>
                    ))}
                  </div>
                  <label className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300"><input type="checkbox" checked={showBoxes} onChange={(e) => setShowBoxes(e.target.checked)} className="accent-sky-400" />Boxes</label>
                  <label className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300"><input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} className="accent-sky-400" />Labels</label>
                  <label className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300"><input type="checkbox" checked={dimOthers} onChange={(e) => setDimOthers(e.target.checked)} className="accent-sky-400" />Dim others when following</label>
                </div>
              </div>

              {/* Right column: BEV + selection */}
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800 flex justify-between">
                    <span>Fused ground-plane view</span><span className="text-slate-500 font-normal">ring = seen by 2+ cams</span>
                  </div>
                  <div className="relative w-full" style={{ height: 340 }}>
                    <canvas ref={bevRef} className="absolute inset-0 w-full h-full" />
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-3 text-xs">
                  {selectedTrack ? (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-3.5 h-3.5 rounded-sm" style={{ background: selectedTrack.color }} />
                          <span className="font-bold text-slate-900 dark:text-white">#{selectedTrack.gid} {selectedTrack.class_name}</span>
                          <span className="text-slate-500">({selectedTrack.object_type})</span>
                        </div>
                        <button type="button" onClick={() => setSelectedGid(null)} className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">clear</button>
                      </div>
                      <div className="mt-2 text-slate-500 dark:text-slate-400">Seen by <span className="text-emerald-700 dark:text-emerald-400 font-semibold">{selectedTrack.cameras.length}</span> of {replay.cameras.length} cameras · frames {selectedTrack.first_frame}–{selectedTrack.last_frame}</div>
                      <table className="w-full mt-2">
                        <thead className="text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="text-left py-1">Camera</th><th className="text-right py-1">Local track</th><th className="text-right py-1">Frames</th></tr></thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {selectedTrack.members.map((m) => {
                            const cam = replay.cameras.find((c) => c.camera_id === m.camera_id)
                            return (
                              <tr key={`${m.camera_id}-${m.track_id}`}>
                                <td className="py-1 text-slate-800 dark:text-slate-200">{cam?.name ?? m.camera_id}</td>
                                <td className="py-1 text-right font-mono text-slate-500 dark:text-slate-400">trk {m.track_id}</td>
                                <td className="py-1 text-right font-mono text-slate-500 dark:text-slate-400">{m.first_frame}–{m.last_frame}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      <div className="mt-2 text-[10px] text-slate-500 leading-relaxed">Fused because its ground-plane positions from different cameras stayed within {replay.fusion.radius_m[selectedTrack.object_type]} m of each other for at least {replay.fusion.min_common_frames} shared frames.</div>
                    </>
                  ) : (
                    <div className="text-slate-500 dark:text-slate-400 leading-relaxed">
                      <div className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Follow an object</div>
                      Click any box in any camera. The same identity lights up in every view and on the ground-plane map; everything else dims.
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-3 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
                  <div className="font-semibold text-slate-700 dark:text-slate-300 text-xs">Cross-camera identities on screen</div>
                  <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto">
                    {replay.tracks.filter((t) => t.cameras.length > 1 && t.first_frame <= frame && t.last_frame >= frame).map((t) => (
                      <button key={t.gid} type="button" onClick={() => setSelectedGid(t.gid === selectedGid ? null : t.gid)}
                        className={`px-1.5 py-0.5 rounded border text-[10px] font-mono transition-colors ${selectedGid === t.gid ? 'border-slate-900 dark:border-white text-slate-900 dark:text-white' : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500'}`}
                        style={{ background: `${t.color}22`, borderColor: selectedGid === t.gid ? '#fff' : `${t.color}66` }}>
                        #{t.gid} {t.class_name} ·{t.cameras.length}
                      </button>
                    ))}
                  </div>
                  <div className="pt-1 text-[10px] text-slate-500">Human review remains mandatory. Fusion asserts co-location on a calibrated plane, not identity on operational footage.</div>
                </div>
              </div>
            </div>

            <div className="text-[10px] text-slate-500">
              Annotated exports: {replay.cameras.map((c, i) => (
                <span key={c.camera_id}>{i > 0 && ' · '}<a className="text-sky-700 dark:text-sky-400 hover:underline" href={`${API_BASE}${c.annotated_video_url}`} target="_blank" rel="noreferrer">{c.name}</a></span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default LumpiReplayPanel
