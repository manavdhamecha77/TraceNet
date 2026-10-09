import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { Compass } from 'lucide-react'

type TourStep = {
  route: string
  target?: string
  stage: string
  title: string
  description: string
}

const TOUR_KEY = 'TOUR_FINISHED'

// Stages are intentionally independent: Skip stage advances to the next major product area.
const steps: TourStep[] = [
  { route: '/dashboard', stage: 'Product overview', title: 'Welcome to TraceNet', description: 'This guided walkthrough covers the full operator workflow: ingest and monitor footage, search for people or vehicles, review alerts, and preserve evidence. Each stage can be skipped.' },
  { route: '/dashboard', target: '[data-tour="dashboard-metrics"]', stage: 'Product overview', title: 'Operational overview', description: 'The dashboard summarizes camera coverage, video intake, standardized footage, and processing queues so an operator can quickly see the system state.' },
  { route: '/dashboard', target: '[data-tour="dashboard-pipeline"]', stage: 'Product overview', title: 'From video to searchable tracklets', description: 'TraceNet standardizes uploaded footage, samples frames, detects and tracks people and vehicles, then makes tracklets available for search and review.' },
  { route: '/dashboard', target: '[data-tour="dashboard-assistant"]', stage: 'Product overview', title: 'Operational assistant', description: 'The Copilot can answer questions about cameras, footage, and alerts, and can help launch relevant searches.' },
  { route: '/cctv-wall', target: '[data-tour="cctv-wall"]', stage: 'Live operations', title: 'Live multi-camera wall', description: 'The control room wall brings configured camera feeds together, with synchronized playback, detection overlays, and stream telemetry.' },
  { route: '/cctv-wall', target: '[data-tour="cctv-wall-settings"]', stage: 'Live operations', title: 'Tune the feed and archive behavior', description: 'Operators can review stream and dispatch settings. Live detection is vehicle-focused; checked-in recording chunks enter the standard video processing pipeline.' },
  { route: '/areas', target: '[data-tour="areas-page"]', stage: 'Camera and footage management', title: 'Organize camera coverage', description: 'Areas group cameras by location and provide a useful starting point for browsing a deployment.' },
  { route: '/cameras', target: '[data-tour="camera-map"]', stage: 'Camera and footage management', title: 'Camera registry and map', description: 'The registry combines camera locations, status, neighboring nodes, and recorded video counts.' },
  { route: '/cameras', target: '[data-tour="camera-table"]', stage: 'Camera and footage management', title: 'Manage camera records', description: 'Register or review camera nodes here. Open a camera to inspect its original and standardized videos, processing progress, and detections.' },
  { route: '/search', target: '[data-tour="search-query"]', stage: 'Descriptive forensic search', title: 'Search by description or reference image', description: 'Describe visible person or vehicle attributes in natural language, or switch to a reference-photo search. Queries can include clothing, color, vehicle type, location, and time.' },
  { route: '/search', target: '[data-tour="search-filters"]', stage: 'Descriptive forensic search', title: 'Narrow and tune results', description: 'Camera, time, object category, and attribute matching controls refine the candidate list. Multilingual queries are supported, including Hindi, Gujarati, and mixed Latin-script phrases.' },
  { route: '/search', target: '[data-tour="search-results"]', stage: 'Descriptive forensic search', title: 'Review why a result matched', description: 'Results show ranked candidates and available attribute evidence. Scores are retrieval aids, not identity determinations; an operator must review the footage.' },
  { route: '/face-search', target: '[data-tour="face-search"]', stage: 'Specialized searches', title: 'Face search', description: 'Search face tracklets by description, reference image, or an existing label. Face search is a separate workflow from general person and vehicle attribute search.' },
  { route: '/plates', target: '[data-tour="plate-search"]', stage: 'Specialized searches', title: 'Vehicle plate search', description: 'Search recognized plate text exactly, approximately, or partially, then inspect the associated vehicle footage and plate crop.' },
  { route: '/multicam?tab=replay', target: '[data-tour="multicam-replay"]', stage: 'Cross-camera investigation', title: 'Fusion Replay', description: 'Replay synchronizes camera clips and overlays local tracks fused into cross-camera identities. Select an identity to follow its appearances across views.' },
  { route: '/multicam?tab=benchmark', target: '[data-tour="multicam-benchmark"]', stage: 'Cross-camera investigation', title: 'Benchmark and journey analysis', description: 'The benchmark panel evaluates cross-camera linking against LUMPI annotations. Journey and Pursuit Wave views provide additional tools for exploring camera-to-camera movement.' },
  { route: '/targets', target: '[data-tour="targets-page"]', stage: 'Alerts and target review', title: 'Target review', description: 'Review tracked targets and their available camera appearances. Treat linked appearances as candidates for investigation and verify them against the footage.' },
  { route: '/alerts', target: '[data-tour="alerts-page"]', stage: 'Alerts and target review', title: 'Unified alert review', description: 'The alert workspace brings together alert categories such as collisions, loitering, abandoned objects, and theft-related detections.' },
  { route: '/alerts', target: '[data-tour="alerts-evidence"]', stage: 'Alerts and target review', title: 'Inspect, then acknowledge', description: 'Open an alert to review its timeline, frames, and related track or clip. Acknowledgement records operator review; it does not establish identity or intent.' },
  { route: '/evidence', target: '[data-tour="evidence-vault"]', stage: 'Evidence and audit', title: 'Evidence Vault', description: 'Forensic exports package selected evidence with a manifest, hashes, custody information, and a reviewable report. Verify an export when you need to check its integrity.' },
  { route: '/search', target: '[data-tour="search-audit"]', stage: 'Evidence and audit', title: 'Search audit trail', description: 'Search activity is recorded with query details and result counts, supporting accountability and later review.' },
  { route: '/language-settings', target: '[data-tour="language-settings"]', stage: 'Settings and administration', title: 'Language and multilingual search', description: 'Choose the interface language and review how multilingual search handles translation and normalized query text.' },
  { route: '/models', target: '[data-tour="model-registry"]', stage: 'Settings and administration', title: 'Model registry (admin)', description: 'Administrators can review registered detection models and their availability. This stage is skipped automatically when the current role cannot access it.' },
  { route: '/dashboard', target: '[data-tour="dashboard-audit"]', stage: 'Wrap-up', title: 'Human review and accountability', description: 'TraceNet helps surface and explain candidate footage. Operators remain responsible for reviewing evidence, and every search leaves an audit record. You can replay this tour any time from the top bar.' },
]

const routeFor = (route: string) => route.split('?')[0]
const nextStageIndex = (index: number) => {
  let next = index + 1
  while (next < steps.length && steps[next].stage === steps[index].stage) next += 1
  return next
}

export default function ProductTour() {
  const navigate = useNavigate()
  const location = useLocation()
  const driverRef = useRef<ReturnType<typeof driver> | null>(null)
  const autoStartHandled = useRef(false)

  const goToStep = useCallback((index: number, direction: 'next' | 'previous' | 'jump') => {
    if (index < 0 || index >= steps.length) return
    const step = steps[index]
    const targetUrl = step.route
    const sameRoute = window.location.pathname === routeFor(targetUrl)
    if (!sameRoute || (targetUrl.includes('?') && window.location.search !== targetUrl.slice(targetUrl.indexOf('?')))) {
      navigate(targetUrl)
      window.setTimeout(() => {
        if (direction === 'next') driverRef.current?.moveNext()
        else if (direction === 'previous') driverRef.current?.movePrevious()
        else driverRef.current?.moveTo(index)
      }, 180)
      return
    }
    if (direction === 'next') driverRef.current?.moveNext()
    else if (direction === 'previous') driverRef.current?.movePrevious()
    else driverRef.current?.moveTo(index)
  }, [location.pathname, location.search, navigate])

  const startTour = useCallback(() => {
    driverRef.current?.destroy()
    localStorage.setItem(TOUR_KEY, 'false')
    if (location.pathname !== '/dashboard') navigate('/dashboard')
    const tour = driver({
      animate: true,
      smoothScroll: true,
      allowClose: true,
      allowScroll: true,
      overlayOpacity: 0.68,
      showProgress: true,
      progressText: '{{current}} of {{total}} · {{stage}}',
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Finish tour',
      popoverClass: 'tracenet-tour-popover',
      onNextClick: (_element, _step, options) => goToStep((options.index ?? 0) + 1, 'next'),
      onPrevClick: (_element, _step, options) => goToStep((options.index ?? 0) - 1, 'previous'),
      onDoneClick: () => { localStorage.setItem(TOUR_KEY, 'true'); tour.destroy() },
      onCloseClick: () => { localStorage.setItem(TOUR_KEY, 'true'); tour.destroy() },
      onDestroyStarted: () => { localStorage.setItem(TOUR_KEY, 'true') },
      onPopoverRender: (popover, options) => {
        const index = options.index ?? 0
        const stageLabel = steps[index]?.stage
        if (stageLabel) popover.progress.textContent = `${index + 1} of ${steps.length} · ${stageLabel}`
        if (nextStageIndex(index) < steps.length) {
          const skip = document.createElement('button')
          skip.type = 'button'
          skip.className = 'tracenet-tour-skip-stage'
          skip.textContent = 'Skip stage'
          skip.setAttribute('aria-label', `Skip ${stageLabel} stage`)
          skip.onclick = () => goToStep(nextStageIndex(index), 'jump')
          popover.footerButtons.appendChild(skip)
        }
      },
      steps: steps.map((step) => ({
        ...(step.target ? { element: step.target, waitForElement: 6000 } : {}),
        popover: { title: step.title, description: step.description, side: 'bottom' as const, align: 'start' as const },
      })),
    })
    driverRef.current = tour
    window.setTimeout(() => tour.drive(), location.pathname === '/dashboard' ? 120 : 220)
  }, [goToStep, location.pathname, navigate])

  useEffect(() => {
    if (autoStartHandled.current) return
    const saved = localStorage.getItem(TOUR_KEY)
    if (saved === null) localStorage.setItem(TOUR_KEY, 'false')
    if (saved !== 'true') {
      const timer = window.setTimeout(() => {
        autoStartHandled.current = true
        startTour()
      }, 800)
      return () => window.clearTimeout(timer)
    }
  }, [startTour])

  useEffect(() => () => driverRef.current?.destroy(), [])

  const replayTour = () => {
    localStorage.setItem(TOUR_KEY, 'false')
    autoStartHandled.current = true
    startTour()
  }

  return (
    <button
      type="button"
      onClick={replayTour}
      data-tour="tour-launcher"
      title="Replay the TraceNet product tour"
      aria-label="Replay the TraceNet product tour"
      className="inline-flex h-7 items-center gap-1.5 rounded border border-teal-700/30 bg-teal-50 px-2 text-[11px] font-semibold text-teal-800 hover:bg-teal-100 dark:border-teal-500/30 dark:bg-teal-950/40 dark:text-teal-200 dark:hover:bg-teal-900/60"
    >
      <Compass className="h-3.5 w-3.5" /> Tour
    </button>
  )
}
