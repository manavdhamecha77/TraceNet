import React, { useState, useEffect, useRef } from 'react'
import { Navigation, Radar, Play, RefreshCw } from 'lucide-react'
import { JourneyMapScrubber, type JourneyStep } from '../components/JourneyMapScrubber'
import { SentinelWaveHUD, type SentinelSession } from '../components/SentinelWaveHUD'

import { useToast } from '../components/Toast'

import { API_BASE } from '../config/api'

declare global {
  interface Window { L: any }
}

export const MultiCameraTracking: React.FC = () => {
  const toast = useToast()
  const [activeTab, setActiveTab] = useState<'journey' | 'sentinel'>('journey')
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

  // Sentinel Pursuit State
  const [activeSentinelSession, setActiveSentinelSession] = useState<SentinelSession | null>(null)

  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapInstanceRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const polylineRef = useRef<any>(null)

  // 1. Fetch available cameras on mount
  useEffect(() => {
    fetchCameras()
    fetchActiveSentinelSessions()
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

  const fetchActiveSentinelSessions = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/multicam/sentinel/sessions`)
      if (res.ok) {
        const data = await res.json()
        const active = data.find((s: any) => s.status === 'active')
        if (active) setActiveSentinelSession(active)
      }
    } catch (e) {
      console.error('Failed to fetch sentinel sessions:', e)
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

      window.L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19
      }).addTo(map)

      mapInstanceRef.current = map
    }

    renderMapMarkersAndPath()
  }, [cameras, journeySteps, activeSentinelSession, leafletReady])

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
        const isSentinelWatch = activeSentinelSession?.downstream_nodes?.some(
          (n) => n.camera_id === cam.camera_id
        )

        let pinColor = '#3B82F6' // default blue

        if (stepMatch) {
          pinColor = '#10B981' // green for journey hop
        } else if (isSentinelWatch) {
          pinColor = '#F59E0B' // amber for sentinel watch
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

  // 5. Trigger Sentinel Pursuit Activation API
  const handleActivateSentinel = async () => {
    if (!selectedOriginCam) return
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/multicam/sentinel/activate`, {
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
        setActiveSentinelSession({
          id: data.session_id,
          origin_camera_id: data.origin_camera.camera_id,
          speed_mode: data.speed_mode,
          downstream_nodes: data.downstream_nodes,
          status: 'active',
          created_at: new Date().toISOString()
        })
        toast.success('Sentinel Pursuit Active', `Monitoring ${data.downstream_nodes?.length || 0} downstream camera nodes.`)
      } else {
        const err = await res.json()
        toast.error('Sentinel Activation Failed', err.detail || 'Sentinel pursuit activation failed.')
      }
    } catch (e) {
      console.error(e)
      toast.error('Network Error', 'Error activating sentinel pursuit.')
    } finally {
      setLoading(false)
    }
  }

  // 6. Terminate Sentinel Session API
  const handleTerminateSentinel = async (sessionId: string) => {
    try {
      await fetch(`${API_BASE}/api/v1/multicam/sentinel/sessions/${sessionId}`, {
        method: 'DELETE'
      })
      setActiveSentinelSession(null)
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
    <div className="relative flex flex-col h-screen w-full bg-slate-950 text-slate-100 overflow-hidden">
      {/* Top Controls Header */}
      <div className="z-20 flex flex-wrap items-center justify-between gap-4 px-6 py-3 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400">
            <Navigation className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white flex items-center gap-2">
              Multi-Camera Intelligence Suite
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                PRO
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Cross-Camera Re-ID Journey Mapping & Predictive Pursuit Wave
            </p>
          </div>
        </div>

        {/* Tab & Speed Controls */}
        <div className="flex items-center gap-3">
          {/* Speed Mode Selector */}
          <div className="flex items-center rounded-lg bg-slate-800 p-0.5 border border-slate-700 text-xs">
            <button
              type="button"
              onClick={() => setSpeedMode('pedestrian')}
              className={`px-3 py-1 rounded-md font-medium transition-all ${
                speedMode === 'pedestrian'
                  ? 'bg-sky-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Pedestrian
            </button>
            <button
              type="button"
              onClick={() => setSpeedMode('vehicle')}
              className={`px-3 py-1 rounded-md font-medium transition-all ${
                speedMode === 'vehicle'
                  ? 'bg-sky-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Vehicle
            </button>
          </div>

          {/* Mode Tabs */}
          <div className="flex items-center rounded-lg bg-slate-800 p-0.5 border border-slate-700 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('journey')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-all ${
                activeTab === 'journey'
                  ? 'bg-slate-700 text-white font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Navigation className="w-3.5 h-3.5" />
              Journey Map
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('sentinel')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-all ${
                activeTab === 'sentinel'
                  ? 'bg-slate-700 text-white font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Radar className="w-3.5 h-3.5 text-sky-400" />
              Sentinel Pursuit Wave
            </button>
          </div>
        </div>
      </div>

      {/* Action Trigger Toolbar */}
      <div className="z-20 px-6 py-2.5 bg-slate-900/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
        {activeTab === 'journey' ? (
          <div className="flex items-center gap-3 w-full max-w-2xl">
            <input
              type="text"
              placeholder="Enter Tracklet ID (e.g. vid_01_trk_4) or leave empty for auto-link..."
              value={trackletIdInput}
              onChange={(e) => setTrackletIdInput(e.target.value)}
              className="flex-1 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500 text-xs"
            />
            <button
              type="button"
              onClick={handleReconstructTrajectory}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold transition-all disabled:opacity-50 shrink-0"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
              Reconstruct Trajectory
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 w-full max-w-2xl">
            <select
              value={selectedOriginCam}
              onChange={(e) => setSelectedOriginCam(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-sky-500 text-xs"
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
              className="flex-1 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500 text-xs"
            />
            <button
              type="button"
              onClick={handleActivateSentinel}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition-all disabled:opacity-50 shrink-0"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
              Activate Sentinel Wave
            </button>
          </div>
        )}
      </div>

      {/* Main Full Viewport Leaflet Map Container */}
      <div className="relative flex-1 w-full h-full bg-slate-950 overflow-hidden">
        <div
          ref={mapContainerRef}
          className="absolute inset-0 w-full h-full z-0"
          style={{ isolation: 'isolate' }}
        />

        {/* Floating Sentinel Pursuit HUD Overlay */}
        <SentinelWaveHUD
          activeSession={activeSentinelSession}
          onTerminateSession={handleTerminateSentinel}
        />
      </div>

      {/* Bottom Trajectory Timeline Scrubber */}
      {journeySteps.length > 0 && (
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
