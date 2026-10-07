import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Grid2X2, List, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { API_BASE } from '../config/api'
import { useToast } from '../components/Toast'

interface Area {
  id: string
  name: string
  description?: string | null
  thumbnail_path?: string | null
  thumbnail_url?: string | null
  default_thumbnail_path?: string | null
  camera_count: number
  camera_ids: string[]
}

const imageUrl = (path?: string | null) => {
  if (!path) return null
  if (/^https?:\/\//i.test(path)) return path
  return `${API_BASE}/data/${path.replace(/^\/?data\//, '').replace(/\\/g, '/')}`
}

export default function Areas() {
  const toast = useToast()
  const [areas, setAreas] = useState<Area[]>([])
  const [view, setView] = useState<'grid' | 'list'>(() => (localStorage.getItem('tracenet-area-view') as 'grid' | 'list') || 'grid')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<Area | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [thumbnailUrl, setThumbnailUrl] = useState('')
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteCandidate, setDeleteCandidate] = useState<Area | null>(null)

  const fetchAreas = async () => {
    const response = await fetch(`${API_BASE}/api/v1/areas`)
    if (!response.ok) throw new Error('Could not load Areas.')
    setAreas(await response.json())
  }

  useEffect(() => {
    fetchAreas().catch((error) => toast.error(error.message))
  }, [])

  const setViewMode = (mode: 'grid' | 'list') => {
    setView(mode)
    localStorage.setItem('tracenet-area-view', mode)
  }

  const openCreate = () => {
    setIsModalOpen(true)
    setEditing(null)
    setName('')
    setDescription('')
    setThumbnailUrl('')
    setThumbnailFile(null)
  }

  const openEdit = (area: Area) => {
    setIsModalOpen(true)
    setEditing(area)
    setName(area.name)
    setDescription(area.description || '')
    setThumbnailUrl(area.thumbnail_url || '')
    setThumbnailFile(null)
  }

  const saveArea = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      const response = await fetch(
        editing ? `${API_BASE}/api/v1/areas/${editing.id}` : `${API_BASE}/api/v1/areas`,
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), description: description.trim() || null, thumbnail_url: thumbnailUrl.trim() || null }),
        },
      )
      if (!response.ok) throw new Error((await response.json()).detail || 'Could not save Area.')
      const saved: Area = await response.json()
      if (thumbnailFile) {
        const form = new FormData()
        form.append('file', thumbnailFile)
        const uploadResponse = await fetch(`${API_BASE}/api/v1/areas/${saved.id}/thumbnail`, { method: 'POST', body: form })
        if (!uploadResponse.ok) throw new Error((await uploadResponse.json()).detail || 'Could not upload thumbnail.')
      }
      setEditing(null)
      setIsModalOpen(false)
      await fetchAreas()
      toast.success(editing ? 'Area updated.' : 'Area created.')
    } catch (error: any) {
      toast.error(error.message || 'Could not save Area.')
    } finally {
      setSaving(false)
    }
  }

  const deleteArea = async (area: Area) => {
    if (area.camera_count) {
      toast.error('Reassign all cameras before deleting this Area.')
      return
    }
    setDeleteCandidate(area)
  }

  const confirmDeleteArea = async () => {
    if (!deleteCandidate) return
    const response = await fetch(`${API_BASE}/api/v1/areas/${deleteCandidate.id}`, { method: 'DELETE' })
    if (!response.ok) {
      toast.error((await response.json()).detail || 'Could not delete Area.')
      return
    }
    setDeleteCandidate(null)
    await fetchAreas()
    toast.success('Area deleted.')
  }

  const sortedAreas = useMemo(() => areas.slice().sort((a, b) => a.name.localeCompare(b.name)), [areas])

  return (
    <div className="space-y-5 pb-16">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Areas</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Organize camera nodes by geographic or operational area.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded border border-slate-200 dark:border-slate-700 p-0.5">
            <button aria-label="Grid view" onClick={() => setViewMode('grid')} className={`rounded p-1.5 ${view === 'grid' ? 'bg-cyan-500/15 text-cyan-500' : 'text-slate-400'}`}><Grid2X2 className="h-4 w-4" /></button>
            <button aria-label="List view" onClick={() => setViewMode('list')} className={`rounded p-1.5 ${view === 'list' ? 'bg-cyan-500/15 text-cyan-500' : 'text-slate-400'}`}><List className="h-4 w-4" /></button>
          </div>
          <button onClick={openCreate} className="flex items-center gap-1.5 rounded bg-teal-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-800"><Plus className="h-3.5 w-3.5" /> New Area</button>
        </div>
      </div>

      <div className={view === 'grid' ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-2'}>
        {sortedAreas.map((area) => {
          const thumbnail = imageUrl(area.thumbnail_path || area.thumbnail_url || area.default_thumbnail_path)
          return (
            <article key={area.id} className={`overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 ${view === 'list' ? 'flex items-center' : ''}`}>
              <div className={view === 'list' ? 'h-20 w-32 shrink-0' : 'h-36'}>
                {thumbnail ? <img src={thumbnail} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center bg-slate-100 text-xs text-slate-400 dark:bg-slate-800">No thumbnail</div>}
              </div>
              <div className="min-w-0 flex-1 p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{area.name}</h3>
                    <p className="mt-1 text-xs text-slate-500">{area.camera_count} camera{area.camera_count === 1 ? '' : 's'}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => openEdit(area)} aria-label={`Edit ${area.name}`} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-cyan-500 dark:hover:bg-slate-800"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => deleteArea(area)} aria-label={`Delete ${area.name}`} className="rounded p-1.5 text-slate-400 hover:bg-rose-500/10 hover:text-rose-500"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
                {area.description && <p className="mt-2 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{area.description}</p>}
                <Link to="/cameras" className="mt-3 inline-block text-[11px] font-bold text-cyan-600 hover:text-cyan-500">View camera directory →</Link>
              </div>
            </article>
          )
        })}
      </div>

      <AreaModal
        open={isModalOpen}
        editing={editing}
        name={name}
        description={description}
        thumbnailUrl={thumbnailUrl}
        thumbnailFile={thumbnailFile}
        saving={saving}
        setName={setName}
        setDescription={setDescription}
        setThumbnailUrl={setThumbnailUrl}
        setThumbnailFile={setThumbnailFile}
        onClose={() => { setEditing(null); setIsModalOpen(false) }}
        onSubmit={saveArea}
      />
      {deleteCandidate && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-sm font-bold">Delete Area?</h3>
            <p className="mt-2 text-xs text-slate-500">Delete “{deleteCandidate.name}”? Areas with cameras cannot be deleted.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setDeleteCandidate(null)} className="rounded border border-slate-300 px-3 py-2 text-xs dark:border-slate-700">Cancel</button>
              <button onClick={confirmDeleteArea} className="rounded bg-rose-600 px-3 py-2 text-xs font-bold text-white">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AreaModal(props: any) {
  if (!props.open) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={(event) => event.target === event.currentTarget && props.onClose()}>
      <form onSubmit={props.onSubmit} className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between"><h3 className="text-sm font-bold">{props.editing ? 'Edit Area' : 'New Area'}</h3><button type="button" onClick={props.onClose}><X className="h-4 w-4" /></button></div>
        <input required minLength={2} value={props.name} onChange={(event) => props.setName(event.target.value)} placeholder="Area name" className="w-full rounded border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" />
        <textarea value={props.description} onChange={(event) => props.setDescription(event.target.value)} placeholder="Description (optional)" className="w-full rounded border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" rows={3} />
        <input value={props.thumbnailUrl} onChange={(event) => props.setThumbnailUrl(event.target.value)} placeholder="Thumbnail URL (optional)" className="w-full rounded border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" />
        <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500 dark:border-slate-700"><Upload className="h-4 w-4" />{props.thumbnailFile?.name || 'Upload custom thumbnail'}<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => props.setThumbnailFile(event.target.files?.[0] || null)} /></label>
        <div className="flex justify-end gap-2"><button type="button" onClick={props.onClose} className="rounded border border-slate-300 px-3 py-2 text-xs dark:border-slate-700">Cancel</button><button disabled={props.saving} className="rounded bg-teal-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{props.saving ? 'Saving…' : 'Save Area'}</button></div>
      </form>
    </div>
  )
}
