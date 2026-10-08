import React, { useState, useEffect, useRef } from 'react'
import { Navigation, Radar, Play, RefreshCw } from 'lucide-react'
import { JourneyMapScrubber, type JourneyStep } from '../components/JourneyMapScrubber'
import { PursuitWaveHUD, type PursuitSession } from '../components/PursuitWaveHUD'
import { LumpiBenchmarkPanel } from '../components/LumpiBenchmarkPanel'
import { LumpiReplayPanel } from '../components/LumpiReplayPanel'

import { useToast } from '../components/Toast'

import { API_BASE } from '../config/api'

declare global {
  interface Window { L: any }
}

export const MultiCameraTracking: React.FC = () => {
  const toast = useToast()
  // Deep-linkable tab for demos: /multicam?tab=replay | pursuit | benchmark
  const initialTab = (() => {
    try {
      const t = new URLSearchParams(window.location.search).get('tab')
      return t === 'pursuit' || t === 'replay' || t === 'benchmark' ? t : 'journey'
    } catch { return 'journey' }
  })() as 'journey' | 'pursuit' | 'replay' | 'benchmark'
  const [activeTab, setActiveTab] = useState<'journey' | 'pursuit' | 'replay' | 'benchmark'>(initialTab)
  const isOverlayTab = activeTab === 'replay' || activeTab === 'benchmark'
  const [speedMode, setSpeedMode] = useState<'pedestrian' | 'vehicle'>('pedestrian')
  const [trackletIdInput, setTrackletIdInput] = useState<string>('')
  const [selectedOriginCam, setSelectedOriginCam] = useState<string>('')
  const [cameras, setCameras] = useState<any[]>([])
  const [loading, setLoading] = useState<boolean>(false)

  // Journey Map State
  const [journeySteps, setJourneySteps] = useState<JourneyStep[]>([])
  const [totalDistance, setTotalDistance] = useState<number>(0)
  const [totalDuration, setTotalDuration] = useState<number>(0)
  const [activeStepNo, setActiveStepNo] = useState<number>(1)

  // Pursuit State
  const [activePursuitSession, setActivePursuitSession] = useState<PursuitSession | null>(null)

  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapInstanceRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const polylineRef = useRef<any>(null)

  // 1. Fetch available cameras on mount
  useEffect(() => {
    fetchCameras()
    fetchActivePursuitSessions()
  }, [])

  const fetchCameras = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/cameras`)
      if (res.ok) {
        const data = await res.json()
        setCameras(data)
        if (data.length > 0) {
          setSelectedOriginCam(data[0].camera_id)
        }
      }
    } catch (e) {
      console.error('Failed to fetch cameras:', e)
    }
  }

  const fetchActivePursuitSessions = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/multicam/pursuit/sessions`)
      if (res.ok) {
        const data = await res.json()
        const active = data.find((s: any) => s.status === 'active')
        if (active) setActivePursuitSession(active)
      }
    } catch (e) {
      console.error('Failed to fetch pursuit sessions:', e)
    }
  }

  const [leafletReady, setLeafletReady] = useState<boolean>(typeof window !== 'undefined' && !!(window as any).L)

  // Poll window.L ready state if CDN is slow to load
  useEffect(() => {
    if (leafletReady) return
    const interval = setInterval(() => {
      if ((window as any).L) {
        setLeafletReady(true)
        clearInterval(interval)
      }
    }, 200)
    return () => clearInterval(interval)
  }, [leafletReady])

  // 2. Initialize Leaflet Map (Fixes Issue #9 and #20)
  useEffect(() => {
    if (!mapContainerRef.current || !window.L || !leafletReady) return

    if (!mapInstanceRef.current) {
      const validCams = cameras.filter(c => c.latitude != null && c.longitude != null)
      const defaultCenter: [number, number] = validCams.length > 0
        ? [
            validCams.reduce((sum, c) => sum + (c.latitude || 0), 0) / validCams.length,
            validCams.reduce((sum, c) => sum + (c.longitude || 0), 0) / validCams.length
          ]
        : [20.5937, 78.9629] // Generic centered view fallback

      const map = window.L.map(mapContainerRef.current, {
        center: defaultCenter,
        zoom: validCams.length > 0 ? 14 : 5,
        zoomControl: true
      })

      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(map)

      mapInstanceRef.current = map
    }

    renderMapMarkersAndPath()
  }, [cameras, journeySteps, activePursuitSession, leafletReady])

  // 3. Render Map Markers and Trajectory Polyline
  const renderMapMarkersAndPath = () => {
    const L = window.L
    const map = mapInstanceRef.current
    if (!map || !L) return

    // Clear existing markers & polyline
    markersRef.current.forEach((m) => map.removeLayer(m))
    markersRef.current = []
    if (polylineRef.current) {
      map.removeLayer(polylineRef.current)
      polylineRef.current = null
    }

    const bounds: any[] = []

    // A. Render all base cameras
    cameras.forEach((cam) => {
      if (cam.latitude && cam.longitude) {
        const latLng = [cam.latitude, cam.longitude]
        bounds.push(latLng)

        // Check if camera is part of journey steps
        const stepMatch = journeySteps.find((s) => s.camera_id === cam.camera_id)
        const isPursuitWatch = activePursuitSession?.downstream_nodes?.some(
          (n) => n.camera_id === cam.camera_id
        )

        let pinColor = '#3B82F6' // default blue

        if (stepMatch) {
          pinColor = '#10B981' // green for journey hop
        } else if (isPursuitWatch) {
          pinColor = '#F59E0B' // amber for pursuit watch
        }

        const iconHtml = `
          <div style="background-color: ${pinColor}; width: 28px; height: 28px; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 10px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 11px;">
            ${stepMatch ? stepMatch.step : '📷'}
          </div>
        `

        const customIcon = L.divIcon({
          html: iconHtml,
          className: 'custom-cam-pin',
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        })

        const marker = L.marker(latLng, { icon: customIcon }).addTo(map)
        marker.bindPopup(`
          <div class="p-2 text-xs text-slate-900 font-sans">
            <strong>${cam.name}</strong> (${cam.camera_id})<br/>
            ${stepMatch ? `<span class="text-emerald-600 font-bold">Hop #${stepMatch.step} matched</span>` : ''}
          </div>
        `)
        markersRef.current.push(marker)
      }
    })

    // B. Draw Trajectory Polyline if Journey steps exist
    if (journeySteps.length > 1) {
      const lineCoords: any[] = []
      journeySteps.forEach((st) => {
        const cam = cameras.find((c) => c.camera_id === st.camera_id)
        if (cam?.latitude && cam?.longitude) {
          lineCoords.push([cam.latitude, cam.longitude])
        }
      })

      if (lineCoords.length > 1) {
        polylineRef.current = L.polyline(lineCoords, {
          color: '#0EA5E9',
          weight: 4,
          opacity: 0.85,
          dashArray: '8, 8'
        }).addTo(map)
      }
    }

    if (bounds.length > 0 && journeySteps.length === 0) {
      map.fitBounds(bounds, { padding: [50, 50] })
    }
  }

  // 4. Trigger Journey Reconstruction API
  const handleReconstructTrajectory = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/multicam/trajectory/reconstruct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tracklet_id: trackletIdInput.trim() || undefined,
          speed_mode: speedMode,
          top_k_candidates: 50
        })
      })

      if (res.ok) {
        const data = await res.json()
        setJourneySteps(data.journey_steps || [])
        setTotalDistance(data.total_distance_meters || 0)
        setTotalDuration(data.total_duration_seconds || 0)
        setActiveStepNo(1)
        toast.success('Trajectory Reconstructed', `Mapped ${(data.journey_steps || []).length} camera hops across nodes.`)
      } else {
        const err = await res.json()
        toast.error('Reconstruction Error', err.detail || 'Trajectory reconstruction failed.')
      }
    } catch (e) {
      console.error(e)
      toast.error('Network Error', 'Error triggering trajectory reconstruction.')
    } finally {
      setLoading(false)
    }
  }

  // 5. Trigger Pursuit Activation API
  const handleActivatePursuit = async () => {
    if (!selectedOriginCam) return
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/multicam/pursuit/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin_camera_id: selectedOriginCam,
          tracklet_id: trackletIdInput.trim() || undefined,
          speed_mode: speedMode
        })
      })

      if (res.ok) {
        const data = await res.json()
        setActivePursuitSession({
          id: data.session_id,
          origin_camera_id: data.origin_camera.camera_id,
          speed_mode: data.speed_mode,
          downstream_nodes: data.downstream_nodes,
          status: 'active',
          created_at: new Date().toISOString()
        })
        toast.success('Pursuit Active', `Monitoring ${data.downstream_nodes?.length || 0} downstream camera nodes.`)
      } else {
        const err = await res.json()
        toast.error('Pursuit Activation Failed', err.detail || 'pursuit activation failed.')
      }
    } catch (e) {
      console.error(e)
      toast.error('Network Error', 'Error activating pursuit.')
    } finally {
      setLoading(false)
    }
  }

  // 6. Terminate Pursuit Session API
  const handleTerminatePursuit = async (sessionId: string) => {
    try {
      await fetch(`${API_BASE}/api/v1/multicam/pursuit/sessions/${sessionId}`, {
        method: 'DELETE'
      })
      setActivePursuitSession(null)
    } catch (e) {
      console.error(e)
    }
  }

  // Focus map on selected step hop
  const handleSelectStepHop = (stepNo: number) => {
    setActiveStepNo(stepNo)
    const st = journeySteps.find((s) => s.step === stepNo)
    if (st && mapInstanceRef.current) {
      const cam = cameras.find((c) => c.camera_id === st.camera_id)
      if (cam?.latitude && cam?.longitude) {
        mapInstanceRef.current.flyTo([cam.latitude, cam.longitude], 16, { duration: 1.2 })
      }
    }
  }

  return (
    <div className="relative flex flex-col h-screen w-full overflow-hidden bg-[#F8F9FA] text-slate-800 dark:bg-[#111827] dark:text-slate-100">
      {/* Top Controls Header */}
      <div className="z-20 flex flex-wrap items-center justify-between gap-4 px-6 py-3 bg-white border-b border-slate-200 dark:bg-slate-800/95 dark:border-slate-700">
        <div>
            <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              Multi-Camera Intelligence Suite
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Cross-Camera Re-ID Journey Mapping & Predictive Pursuit Wave
            </p>
        </div>

        {/* Tab & Speed Controls */}
        <div className="flex items-center gap-3">
          {/* Speed Mode Selector */}
          <div className="flex items-center rounded border border-slate-200 bg-slate-100 p-0.5 text-xs dark:border-slate-700 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setSpeedMode('pedestrian')}
              className={`px-3 py-1 rounded-md font-medium transition-all ${
                speedMode === 'pedestrian'
                  ? 'bg-white text-teal-800 font-semibold shadow-sm dark:bg-teal-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              Pedestrian
            </button>
            <button
              type="button"
              onClick={() => setSpeedMode('vehicle')}
              className={`px-3 py-1 rounded-md font-medium transition-all ${
                speedMode === 'vehicle'
                  ? 'bg-white text-teal-800 font-semibold shadow-sm dark:bg-teal-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              Vehicle
            </button>
          </div>

          {/* Mode Tabs */}
          <div className="flex items-center rounded border border-slate-200 bg-slate-100 p-0.5 text-xs dark:border-slate-700 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setActiveTab('journey')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-all ${
                activeTab === 'journey'
                  ? 'bg-white text-teal-800 font-semibold shadow-sm dark:bg-teal-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              <Navigation className="w-3.5 h-3.5" />
              Journey Map
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('pursuit')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-all ${
                activeTab === 'pursuit'
                  ? 'bg-white text-teal-800 font-semibold shadow-sm dark:bg-teal-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              <Radar className="w-3.5 h-3.5 text-sky-400" />
              Pursuit Wave
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('replay')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-all ${
                activeTab === 'replay'
                  ? 'bg-white text-teal-800 font-semibold shadow-sm dark:bg-teal-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
              title="Live detector + ByteTrack on three synchronized LUMPI cameras, fused on a calibrated ground plane"
            >
              <Play className="w-3.5 h-3.5 text-emerald-400 fill-current" />
              Fusion Replay
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('benchmark')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-all ${
                activeTab === 'benchmark'
                  ? 'bg-white text-teal-800 font-semibold shadow-sm dark:bg-teal-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
              title="Score cross-camera linking against the LUMPI benchmark ground truth"
            >
              <svg className="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v18h18" /><rect x="7" y="12" width="3" height="6" /><rect x="12" y="8" width="3" height="10" /><rect x="17" y="5" width="3" height="13" />
              </svg>
              LUMPI Benchmark
            </button>
          </div>
        </div>
      </div>

      {/* Action Trigger Toolbar */}
      <div className="z-20 px-6 py-2.5 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3 text-xs">
        {activeTab === 'journey' ? (
          <div className="flex items-center gap-3 w-full max-w-2xl">
            <input
              type="text"
              placeholder="Enter Tracklet ID (e.g. vid_01_trk_4) or leave empty for auto-link..."
              value={trackletIdInput}
              onChange={(e) => setTrackletIdInput(e.target.value)}
              className="flex-1 px-3 py-2 rounded border border-slate-300 bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-teal-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-teal-400 text-xs"
            />
            <button
              type="button"
              onClick={handleReconstructTrajectory}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700 text-white font-semibold transition-colors disabled:opacity-50 shrink-0"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
              Reconstruct Trajectory
            </button>
          </div>
        ) : activeTab === 'replay' ? (
          <div className="flex items-center gap-2 text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Real detector output on real multi-camera footage. Click any object to follow it across all three views and the ground-plane map.
          </div>
        ) : activeTab === 'benchmark' ? (
          <div className="flex items-center gap-2 text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Offline evaluation against LUMPI ground truth. Configure weights below and run; nothing here touches operational cameras or alerts.
          </div>
        ) : (
          <div className="flex items-center gap-3 w-full max-w-2xl">
            <select
              value={selectedOriginCam}
              onChange={(e) => setSelectedOriginCam(e.target.value)}
              className="px-3 py-2 rounded border border-slate-300 bg-white text-slate-800 focus:outline-none focus:border-teal-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-teal-400 text-xs"
            >
              {cameras.map((c) => (
                <option key={c.camera_id} value={c.camera_id}>
                  {c.name} ({c.camera_id})
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Optional Target Tracklet ID..."
              value={trackletIdInput}
              onChange={(e) => setTrackletIdInput(e.target.value)}
              className="flex-1 px-3 py-2 rounded border border-slate-300 bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-teal-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-teal-400 text-xs"
            />
            <button
              type="button"
              onClick={handleActivatePursuit}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700 text-white font-semibold transition-colors disabled:opacity-50 shrink-0"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
              Activate Pursuit Wave
            </button>
          </div>
        )}
      </div>

      {/* Main Full Viewport Leaflet Map Container */}
      <div className="relative flex-1 w-full h-full bg-slate-100 dark:bg-slate-900 overflow-hidden">
        <div
          ref={mapContainerRef}
          className="absolute inset-0 w-full h-full z-0"
          style={{ isolation: 'isolate' }}
        />

        {/* Floating Pursuit HUD Overlay */}
        {!isOverlayTab && (
          <PursuitWaveHUD
            activeSession={activePursuitSession}
            onTerminateSession={handleTerminatePursuit}
          />
        )}

        {/* LUMPI panels overlay the (still mounted) map so Leaflet keeps its instance */}
        {activeTab === 'replay' && (
          <div className="absolute inset-0 z-10">
            <LumpiReplayPanel />
          </div>
        )}
        {activeTab === 'benchmark' && (
          <div className="absolute inset-0 z-10">
            <LumpiBenchmarkPanel />
          </div>
        )}
      </div>

      {/* Bottom Trajectory Timeline Scrubber */}
      {!isOverlayTab && journeySteps.length > 0 && (
        <JourneyMapScrubber
          steps={journeySteps}
          activeStep={activeStepNo}
          onSelectStep={handleSelectStepHop}
          totalDistanceMeters={totalDistance}
          totalDurationSeconds={totalDuration}
        />
      )}
    </div>
  )
}
