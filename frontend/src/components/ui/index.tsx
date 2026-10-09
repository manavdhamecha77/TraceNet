/**
 * TraceNet UI primitives.
 *
 * One place for the patterns every page was hand-building: page headers, bordered panels, KPI
 * tiles, status badges, skeleton loaders, empty states and buttons. All tokens follow
 * frontend/DESIGN.md: Inter at 13-14px, teal-700 accent, amber for warnings, 1px borders,
 * 4px radius (`rounded`), no drop shadows, light + dark variants on every element.
 */
import type { ReactNode, ButtonHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'

// ─── shared class fragments ───────────────────────────────────────────────────

export const surface = 'rounded border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'
export const subtleSurface = 'rounded border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60'
export const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900'

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'

const toneText: Record<Tone, string> = {
  neutral: 'text-slate-800 dark:text-slate-100',
  brand: 'text-teal-700 dark:text-teal-300',
  success: 'text-emerald-700 dark:text-emerald-300',
  warning: 'text-amber-700 dark:text-amber-400',
  danger: 'text-rose-700 dark:text-rose-300',
  info: 'text-sky-700 dark:text-sky-300',
}

const toneDot: Record<Tone, string> = {
  neutral: 'bg-slate-400',
  brand: 'bg-teal-600',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  info: 'bg-sky-500',
}

const toneBadge: Record<Tone, string> = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
  brand: 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  danger: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300',
  info: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300',
}

// ─── PageHeader ───────────────────────────────────────────────────────────────

export interface PageHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  /** Small category line above the title (e.g. "Operations / Overview"). */
  eyebrow?: ReactNode
  /** Chips next to the title (status pills, counts). */
  badges?: ReactNode
  /** Buttons / links on the right. */
  actions?: ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, eyebrow, badges, actions, className = '' }: PageHeaderProps) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{eyebrow}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-slate-800 dark:text-slate-100">{title}</h1>
          {badges}
        </div>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-300">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export interface PanelProps {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  /** Remove body padding (tables, maps). */
  flush?: boolean
  className?: string
  bodyClassName?: string
  as?: 'section' | 'div'
}

export function Panel({ title, subtitle, actions, children, flush = false, className = '', bodyClassName = '', as = 'section' }: PanelProps) {
  const Tag = as
  return (
    <Tag className={`${surface} overflow-hidden ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? bodyClassName : `p-4 ${bodyClassName}`}>{children}</div>
    </Tag>
  )
}

// ─── StatTile ─────────────────────────────────────────────────────────────────

export interface StatTileProps {
  label: ReactNode
  value: ReactNode
  detail?: ReactNode
  tone?: Tone
  icon?: LucideIcon
  /** Render as a link to drill down. */
  to?: string
  loading?: boolean
  className?: string
}

export function StatTile({ label, value, detail, tone = 'neutral', icon: Icon, to, loading = false, className = '' }: StatTileProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
        {Icon ? <Icon className={`h-4 w-4 shrink-0 ${toneText[tone === 'neutral' ? 'brand' : tone]}`} aria-hidden="true" /> : <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${toneDot[tone === 'neutral' ? 'brand' : tone]}`} />}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-16" />
      ) : (
        <p className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${toneText[tone]}`}>{value}</p>
      )}
      {detail && <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">{detail}</p>}
    </>
  )
  const cls = `${surface} block p-4 ${className}`
  if (to) return <Link to={to} className={`${cls} transition-colors hover:border-teal-400 dark:hover:border-teal-600 ${focusRing}`}>{body}</Link>
  return <div className={cls}>{body}</div>
}

// ─── StatusBadge ──────────────────────────────────────────────────────────────

export interface StatusBadgeProps {
  children: ReactNode
  tone?: Tone
  dot?: boolean
  pulse?: boolean
  className?: string
}

export function StatusBadge({ children, tone = 'neutral', dot = true, pulse = false, className = '' }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-semibold ${toneBadge[tone]} ${className}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${toneDot[tone]} ${pulse ? 'animate-pulse' : ''}`} aria-hidden="true" />}
      {children}
    </span>
  )
}

/** Maps the camera status vocabulary to a tone. */
export function cameraStatusTone(status?: string): Tone {
  if (status === 'active') return 'success'
  if (status === 'maintenance') return 'warning'
  if (status === 'not-working') return 'danger'
  return 'neutral'
}

// ─── Skeleton / loading ───────────────────────────────────────────────────────

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200/80 dark:bg-slate-700/70 motion-reduce:animate-none ${className}`} aria-hidden="true" />
}

export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  )
}

/** Row placeholders shaped like a data table; use inside a table body wrapper or a Panel. */
export function TableSkeleton({ rows = 6, columns = 5, label = 'Loading' }: { rows?: number; columns?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-label={label} className="divide-y divide-slate-100 dark:divide-slate-800">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className={`h-3 ${c === 0 ? 'w-10' : c === 1 ? 'w-40' : 'w-24'} ${c === columns - 1 ? 'ml-auto' : ''}`} />
          ))}
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  )
}

export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`${surface} p-4`}>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-16" />
          <Skeleton className="mt-3 h-3 w-32" />
        </div>
      ))}
    </div>
  )
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

export interface EmptyStateProps {
  icon?: LucideIcon
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  tone?: Tone
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, tone = 'neutral', className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center px-6 py-12 text-center ${className}`}>
      {Icon && (
        <span className={`mb-3 flex h-10 w-10 items-center justify-center rounded border ${toneBadge[tone]}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      )}
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
      {description && <p className="mt-1 max-w-md text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ─── Button ───────────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

const variantCls: Record<ButtonVariant, string> = {
  primary: 'border border-teal-700 bg-teal-700 text-white hover:bg-teal-800 dark:border-teal-600 dark:bg-teal-600 dark:hover:bg-teal-500',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
  ghost: 'border border-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
  danger: 'border border-rose-600 bg-rose-600 text-white hover:bg-rose-700',
}

const sizeCls: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-3.5 text-sm',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
  loading?: boolean
}

export function Button({ variant = 'secondary', size = 'sm', icon: Icon, loading = false, className = '', children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded font-medium transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 ${focusRing} ${variantCls[variant]} ${sizeCls[size]} ${className}`}
      {...rest}
    >
      {Icon && <Icon className={`h-3.5 w-3.5 shrink-0 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />}
      {children}
    </button>
  )
}

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'sm', extra = ''): string {
  return `inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded font-medium transition-colors active:translate-y-px ${focusRing} ${variantCls[variant]} ${sizeCls[size]} ${extra}`
}
