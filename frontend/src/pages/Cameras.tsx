import { Link } from 'react-router-dom'

interface Camera {
  camera_id: string
  name: string
  latitude?: number
  longitude?: number
  corridor_group?: string
  adjacency: string[]
  is_active: boolean
  video_count: number
}

interface CamerasProps {
  cameras: Camera[]
  onOpenRegisterModal: () => void
}

export default function Cameras({ cameras, onOpenRegisterModal }: CamerasProps) {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Registered CCTV Cameras</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Monitor sensor nodes, coordinates, corridors, and neighbor routing adjacency.
          </p>
        </div>
        <button
          onClick={onOpenRegisterModal}
          className="flex items-center gap-2 bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-750 text-white px-3.5 py-1.5 rounded-md text-xs font-bold transition-colors shadow-sm"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Register Camera
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cameras.length === 0 ? (
          <div className="col-span-full py-16 text-center bg-white dark:bg-slate-800/30 border border-dashed border-slate-200 dark:border-slate-700 rounded-md">
            <svg className="mx-auto h-10 w-10 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <h3 className="mt-4 text-sm font-semibold text-slate-800 dark:text-slate-200">No Cameras Configured</h3>
            <p className="mt-1 text-xs text-slate-400">Add a new CCTV node location to begin standardizing video assets.</p>
            <button
              onClick={onOpenRegisterModal}
              className="mt-4 inline-flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700 text-white px-3 py-1.5 rounded-md text-xs font-semibold transition-colors"
            >
              Add Camera
            </button>
          </div>
        ) : (
          cameras.map((camera) => (
            <div
              key={camera.camera_id}
              className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-4 rounded-md shadow-sm flex flex-col justify-between hover:border-teal-700/40 dark:hover:border-teal-400/40 transition-all group"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-850 px-2 py-0.5 rounded-md text-[11px] font-mono font-bold text-teal-700 dark:text-teal-400">
                    {camera.camera_id}
                  </span>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    camera.is_active ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-700 dark:text-rose-450'
                  }`}>
                    {camera.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-3 group-hover:text-teal-700 dark:group-hover:text-teal-400 transition-colors">
                  {camera.name}
                </h4>

                <div className="mt-3 space-y-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <div className="flex justify-between">
                    <span>Corridor Group:</span>
                    <span className="text-slate-800 dark:text-slate-200 font-medium">{camera.corridor_group ?? 'General'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Coordinates:</span>
                    <span className="text-slate-800 dark:text-slate-200 font-mono">
                      {camera.latitude !== null && camera.latitude !== undefined ? camera.latitude.toFixed(4) : '--'},{' '}
                      {camera.longitude !== null && camera.longitude !== undefined ? camera.longitude.toFixed(4) : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Adjacency Connections:</span>
                    <span className="text-slate-800 dark:text-slate-200 truncate max-w-[120px]" title={camera.adjacency.join(', ')}>
                      {camera.adjacency.length > 0 ? camera.adjacency.join(', ') : 'None'}
                    </span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-100 dark:border-slate-800 mt-2">
                    <span>Stored Feeds:</span>
                    <span className="text-teal-700 dark:text-teal-400 font-bold">{camera.video_count} videos</span>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <Link
                  to={`/cameras/${camera.camera_id}`}
                  className="w-full flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-teal-500/10 dark:bg-slate-900 dark:hover:bg-teal-500/10 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:text-teal-700 dark:hover:text-teal-400 py-1.5 rounded-md text-xs font-semibold transition-all"
                >
                  Open Camera
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
