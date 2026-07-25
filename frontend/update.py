import sys
import re

file_path = r'S:\TraceNet\frontend\src\App.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update Theme State
content = re.sub(
    r"const \[theme, setTheme\] = useState<'light' \| 'dark'>\(\(\) => \{.*?\}\)",
    "const [theme, setTheme] = useState<'light' | 'dark'>('dark')",
    content,
    flags=re.DOTALL
)

# 2. Update Theme effect
content = re.sub(
    r"// Theme effect\s+useEffect\(\(\) => \{\s+if \(theme === 'dark'\) \{.*?localStorage\.setItem\('drishti-theme', theme\)\s+\}, \[theme\]\)",
    "// Theme effect\n  useEffect(() => {\n    document.documentElement.classList.add('dark')\n    localStorage.setItem('drishti-theme', 'dark')\n  }, [])",
    content,
    flags=re.DOTALL
)

# 3. Main wrapper and aside start
old_wrapper = r'''<div className="flex min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 antialiased font-sans transition-colors duration-150">
      
      {/* COLLAPSIBLE SIDEBAR */}
      <aside
        className={`border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex flex-col justify-between transition-all duration-200 z-20 ${
          isSidebarCollapsed ? 'w-16' : 'w-60'
        }`}
      >
        <div className="space-y-6">
          {/* Logo & Collapse toggle header */}
          <div className="h-12 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-4">
            {!isSidebarCollapsed && (
              <div className="flex items-center gap-2">
                <span className="text-teal-700 dark:text-teal-400 font-bold tracking-wider text-sm">DRISHTI</span>
                <span className="text-[9px] bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-1 rounded font-bold text-slate-500">MVP</span>
              </div>
            )}
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="text-slate-500 hover:text-slate-800 dark:hover:text-white p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700/50 mx-auto"
            >'''

new_wrapper = '''<div className="flex min-h-screen text-slate-100 antialiased font-sans transition-colors duration-150">
      
      {/* COLLAPSIBLE SIDEBAR */}
      <aside
        className={`bg-slate-900 border-r border-slate-800 flex flex-col justify-between transition-all duration-200 z-20 ${
          isSidebarCollapsed ? 'w-[56px]' : 'w-[220px]'
        }`}
      >
        <div className="space-y-6">
          {/* Logo & Collapse toggle header */}
          <div className="h-11 border-b border-slate-800 flex items-center justify-between px-4">
            {!isSidebarCollapsed && (
              <div className="flex items-center gap-2">
                <span className="text-cyan-400 font-bold tracking-widest text-xs" style={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                  <span className="mr-1">◉</span>DRISHTI
                </span>
              </div>
            )}
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="text-slate-500 hover:text-slate-300 p-1 rounded hover:bg-slate-800/60 mx-auto"
            >'''
content = content.replace(old_wrapper, new_wrapper)

# 4. Nav links classes
old_nav_classes_base = r"className={`flex items-center gap-3 rounded px-3 py-2 text-xs font-semibold tracking-wide transition-all ${"
new_nav_classes_base = r"className={`flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-semibold tracking-wide transition-all ${"
content = content.replace(old_nav_classes_base, new_nav_classes_base)

# active active and hover states
content = re.sub(
    r"\? 'bg-teal-500/10 text-teal-700 dark:text-teal-400 font-bold border-l-2 border-teal-700 dark:border-teal-400'\s*:\s*'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-800 dark:hover:text-white'",
    r"? 'bg-slate-800 text-cyan-300'\n                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'",
    content
)

# 5. Bottom Sidebar (Theme toggle replacement with user avatar)
old_bottom = r'''        {/* Theme toggle SUN/MOON pinned at the bottom */}
        <div className="border-t border-slate-200 dark:border-slate-700 p-3">
          <button
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            className="w-full flex items-center justify-center gap-3 rounded px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-150 dark:hover:bg-slate-700/50 transition-all"
            title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
          >
            {theme === 'light' ? (
              <>
                <svg className="h-4 w-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M16.243 17.657l.707-.707M6.343 6.364l.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
                </svg>
                {!isSidebarCollapsed && <span>Light Mode</span>}
              </>
            ) : (
              <>
                <svg className="h-4 w-4 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
                {!isSidebarCollapsed && <span>Dark Mode</span>}
              </>
            )}
          </button>
        </div>
      </aside>'''

new_bottom = '''        {/* User avatar area at bottom */}
        <div className="border-t border-slate-800 p-4 flex items-center justify-center">
          <div className="relative shrink-0">
            <div className="h-8 w-8 rounded-full bg-slate-700 flex items-center justify-center text-slate-200 text-xs font-bold border border-slate-600">
              JD
            </div>
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-slate-900"></span>
          </div>
          {!isSidebarCollapsed && (
            <div className="ml-3 flex-1 min-w-0">
              <div className="text-xs font-semibold text-slate-200 truncate">John Doe</div>
              <div className="text-[10px] text-slate-500 truncate">Operator</div>
            </div>
          )}
        </div>
      </aside>'''
content = content.replace(old_bottom, new_bottom)

# 6. Header
old_header = r'''        {/* COMPACT APP BAR (44px-48px height) */}
        <header className="h-12 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-6 flex items-center justify-between z-10 transition-colors duration-150">
          
          {/* Breadcrumbs */}
          <nav className="flex items-center space-x-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            {getBreadcrumbs().map((crumb, idx, arr) => (
              <Fragment key={crumb.link}>
                {idx > 0 && <span className="text-slate-350 dark:text-slate-600">/</span>}
                {idx === arr.length - 1 ? (
                  <span className="text-slate-800 dark:text-slate-200 font-bold">{crumb.label}</span>
                ) : (
                  <Link to={crumb.link} className="hover:text-teal-700 dark:hover:text-teal-400 transition-colors">
                    {crumb.label}
                  </Link>
                )}
              </Fragment>
            ))}
          </nav>

          {/* Global AI Copilot Search Bar Trigger */}
          <GlobalSearchBar onOpenCopilot={() => setIsCopilotOpen(true)} />

          {/* System status & action */}
          <div className="flex items-center gap-4">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-850 px-2 py-0.5 rounded flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${metrics.pendingVideos > 0 ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`}></span>
              {metrics.pendingVideos > 0 ? `Transcoding: ${metrics.pendingVideos} Jobs` : 'Pipeline Idle'}
            </span>

            <button
              onClick={() => alert('Evidence archive exported with verification hash.')}
              className="bg-transparent hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-250 dark:border-slate-600 text-slate-700 dark:text-slate-300 px-3 py-1 rounded text-xs font-bold transition-colors"
            >
              Export Evidence
            </button>
            <div className="h-6 w-6 rounded-full bg-teal-700 dark:bg-teal-650 flex items-center justify-center text-white text-[10px] font-bold">
              JD
            </div>
          </div>
        </header>'''

new_header = '''        {/* COMPACT APP BAR */}
        <header className="h-11 bg-slate-900/80 backdrop-blur-sm border-b border-slate-800 px-6 flex items-center justify-between z-10 transition-colors duration-150">
          
          {/* Breadcrumbs */}
          <nav className="flex items-center space-x-2 text-xs font-medium text-slate-500">
            {getBreadcrumbs().map((crumb, idx, arr) => (
              <Fragment key={crumb.link}>
                {idx > 0 && <span className="text-slate-600">/</span>}
                {idx === arr.length - 1 ? (
                  <span className="text-slate-200 font-semibold">{crumb.label}</span>
                ) : (
                  <Link to={crumb.link} className="text-slate-500 hover:text-slate-300 transition-colors">
                    {crumb.label}
                  </Link>
                )}
              </Fragment>
            ))}
          </nav>

          {/* Global AI Copilot Search Bar Trigger */}
          <GlobalSearchBar onOpenCopilot={() => setIsCopilotOpen(true)} />

          {/* System status & action */}
          <div className="flex items-center gap-4">
            <span className="text-[11px] text-slate-400 font-semibold bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-full flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${metrics.pendingVideos > 0 ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`}></span>
              {metrics.pendingVideos > 0 ? `Transcoding: ${metrics.pendingVideos} Jobs` : 'Pipeline Idle'}
            </span>
          </div>
        </header>'''
content = content.replace(old_header, new_header)

# 7. Main workspace background
old_workspace = '<div className="flex-grow p-6 pb-24 overflow-y-auto bg-slate-50 dark:bg-slate-900 transition-colors duration-150">'
new_workspace = '<div className="flex-grow p-6 pb-24 overflow-y-auto bg-slate-950 transition-colors duration-150">'
content = content.replace(old_workspace, new_workspace)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Rewrite complete.")
