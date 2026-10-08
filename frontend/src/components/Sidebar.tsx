import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Bell, Boxes, Camera, ChevronLeft, FolderKanban, Map, Plus, Radio, ScanSearch, Settings, Sparkles, UsersRound } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Props = {
  collapsed: boolean
  onToggle: () => void
  onOpenAgents: () => void
  onStartNewChat: () => void
  onOpenCamera: () => void
  adminMode: boolean
  onToggleAdmin: () => void
  unackAlertCount: number
}

export default function Sidebar({ collapsed, onToggle, onOpenAgents, onStartNewChat, onOpenCamera, adminMode, onToggleAdmin, unackAlertCount }: Props) {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const links: { to: string; label: string; icon: LucideIcon; active: boolean }[] = [
    { to: '/dashboard', label: t('nav.dashboard'), icon: FolderKanban, active: location.pathname === '/dashboard' || location.pathname === '/' },
    { to: '/areas', label: t('nav.areas'), icon: Map, active: location.pathname === '/areas' },
    { to: '/cameras', label: t('nav.cameras'), icon: Camera, active: location.pathname.startsWith('/cameras') && !location.pathname.includes('/live') },
    { to: '/live-connect', label: t('nav.live'), icon: Radio, active: location.pathname === '/live-connect' || location.pathname === '/connect' },
    { to: '/multicam', label: t('nav.multicam'), icon: Boxes, active: location.pathname === '/multicam' },
    { to: '/search', label: t('nav.search'), icon: ScanSearch, active: location.pathname === '/search' },
    { to: '/face-search', label: t('nav.face'), icon: UsersRound, active: location.pathname === '/face-search' },
    { to: '/language-settings', label: t('nav.language'), icon: Settings, active: location.pathname === '/language-settings' },
    { to: '/targets', label: t('nav.targets'), icon: Settings, active: location.pathname.startsWith('/targets') || location.pathname.startsWith('/hot-targets') },
    { to: '/alerts', label: t('nav.alerts'), icon: Bell, active: location.pathname.startsWith('/alerts') || ['/theft-alerts', '/assault-detection', '/plate-detection'].includes(location.pathname) },
  ]
  const itemClass = (active: boolean) => `group relative flex h-10 items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-white transition-colors ${active ? 'bg-white/15 ring-1 ring-inset ring-white/45 shadow-sm' : 'hover:bg-white/10'} ${collapsed ? 'justify-center px-0' : ''}`
  const renderLink = ({ to, label, icon: Icon, active }: typeof links[number]) => (
    <Link key={to} to={to} className={itemClass(active)} title={collapsed ? label : undefined} aria-current={active ? 'page' : undefined}>
      <Icon className="h-[17px] w-[17px] shrink-0 text-white" strokeWidth={1.8} />
      {!collapsed && <span className="truncate">{label}</span>}
      {to === '/alerts' && unackAlertCount > 0 && <span className={`${collapsed ? 'absolute right-1 top-1 h-2 w-2 p-0' : 'ml-auto px-1.5 py-0.5'} rounded-full bg-rose-500 text-[9px] font-bold leading-none text-white`}>{!collapsed && unackAlertCount}</span>}
    </Link>
  )

  return <aside className={`sticky top-0 z-20 flex h-screen shrink-0 flex-col border-r border-white/15 text-white transition-[width] duration-200 ${collapsed ? 'w-[68px]' : 'w-[200px]'} bg-[#0f766e] dark:bg-[#667565]`}>
    <div className="flex min-h-0 flex-1 flex-col px-2.5 pt-3">
      <div className={`mb-2 flex h-10 items-center rounded-lg border border-white/20 bg-black/10 px-2.5 ${collapsed ? 'justify-center' : 'gap-2.5'}`} aria-label="Drishti Operations Workspace">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/15 text-[10px] font-bold text-white">D</span>
        {!collapsed && <span className="truncate text-[12px] font-semibold tracking-tight">DRISHTI</span>}
      </div>
      <nav aria-label="Main navigation" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pt-1">
        <div className="group/agent relative mb-1">
          <Link to="/agents" onClick={onOpenAgents} className={`${itemClass(location.pathname === '/agents')} w-full`} title={collapsed ? t('nav.agent') : undefined} aria-current={location.pathname === '/agents' ? 'page' : undefined}>
            <Sparkles className="h-[17px] w-[17px] shrink-0 text-violet-300" strokeWidth={1.8} />{!collapsed && <span>{t('nav.agent')}</span>}
          </Link>
          <div className="invisible absolute left-0 top-full z-50 w-full translate-y-1 rounded-lg border border-white/20 bg-[#0b5e58] p-1 opacity-0 shadow-xl transition-all group-hover/agent:visible group-hover/agent:translate-y-0 group-hover/agent:opacity-100 dark:bg-[#566554] group-focus-within/agent:visible group-focus-within/agent:opacity-100">
            <Link to="/agents" onClick={onOpenAgents} className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs text-white hover:bg-white/10"><Sparkles className="h-3.5 w-3.5 text-white"/>{t('nav.agent')}</Link>
            <button onClick={onStartNewChat} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-white hover:bg-white/10"><Plus className="h-3.5 w-3.5 text-white"/>{t('nav.newChat')}</button>
          </div>
        </div>
        {links.slice(0, 3).map(renderLink)}
        <div className="my-2 border-t border-white/25" />
        {links.slice(3, 4).map(renderLink)}
        {adminMode && <Link to="/models" className={itemClass(location.pathname.startsWith('/models'))} title={collapsed ? t('nav.models') : undefined}><Boxes className="h-[17px] w-[17px] shrink-0 text-slate-400" />{!collapsed && <span>{t('nav.models')}</span>}</Link>}
        {links.slice(4).map(renderLink)}
        {!collapsed && <div className="mt-3 border-t border-white/[0.08] pt-3">
          <div className="mb-1 flex items-center justify-between px-2.5"><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t('nav.mlAdmin')}</span><button onClick={onToggleAdmin} className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${adminMode ? 'bg-violet-400/15 text-violet-200' : 'bg-white/[0.06] text-slate-400 hover:text-white'}`}>{adminMode ? 'ON' : 'OFF'}</button></div>
          {adminMode && <div className="space-y-1">{[['/models', t('nav.models')], ['/embedding-models', t('nav.embedding')], ['/finetuning', t('nav.finetune')]].map(([to, label]) => <Link key={to} to={to} className={itemClass(location.pathname === to)}><Settings className="h-4 w-4 shrink-0 text-slate-400"/><span>{label}</span></Link>)}</div>}
        </div>}
      </nav>
    </div>
    <div className="shrink-0 space-y-1 px-2.5 pb-3 pt-2">
      <button onClick={onOpenCamera} title={collapsed ? t('nav.registerCamera') : undefined} className={`mb-1 flex h-10 w-full items-center gap-3 rounded-lg bg-[#ffc21c] px-3 text-[12px] font-semibold text-[#17130a] transition-colors hover:bg-[#ffd04a] ${collapsed ? 'justify-center px-0' : ''}`}><Camera className="h-4 w-4 shrink-0"/>{!collapsed && <span>{t('nav.registerCamera')}</span>}</button>
      {renderLink({ to: '/alerts', label: t('nav.activity'), icon: Bell, active: location.pathname.startsWith('/alerts') })}
      <button onClick={() => { if (!adminMode) onToggleAdmin(); navigate('/finetuning') }} className={`${itemClass(location.pathname === '/finetuning')} w-full`} title={collapsed ? t('nav.settings') : undefined}><Settings className="h-[17px] w-[17px] shrink-0 text-slate-400"/>{!collapsed && <span>{t('nav.settings')}</span>}</button>
      <div className={`mt-2 flex h-10 items-center gap-2.5 border-t border-white/[0.08] pt-2 ${collapsed ? 'justify-center' : ''}`}>
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-slate-600 to-slate-800 text-[9px] font-bold text-white">JD</div>
        {!collapsed && <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium text-slate-200">J. Doe</p><p className="truncate text-[10px] text-slate-500">{t('nav.operatorRole')}</p></div>}
        <button onClick={onToggle} className="rounded p-1 text-slate-500 hover:bg-white/[0.08] hover:text-slate-200" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}><ChevronLeft className={`h-4 w-4 transition-transform ${collapsed ? 'rotate-180' : ''}`}/></button>
      </div>
    </div>
  </aside>
}

