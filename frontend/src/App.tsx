function App() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col justify-between px-6 py-8 sm:px-10 lg:px-12">
      <section className="glass-panel overflow-hidden p-6 sm:p-10">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-6">
            <span className="inline-flex items-center rounded-full border border-aurora-400/30 bg-aurora-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-aurora-400">
              TraceNet Foundation
            </span>
            <div className="space-y-4">
              <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-6xl">
                Descriptive search for CCTV footage, built for review-first workflows.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                This starter is ready for the search pipeline: upload, track,
                embed, rank, and explain. The demo UI will grow from here without
                losing the audit trail and human-in-the-loop design.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:w-[28rem] lg:grid-cols-1">
            <div className="metric-card">
              <div className="text-sm text-slate-400">Pipeline</div>
              <div className="mt-2 text-2xl font-semibold text-white">Ready</div>
            </div>
            <div className="metric-card">
              <div className="text-sm text-slate-400">Framework</div>
              <div className="mt-2 text-2xl font-semibold text-white">React + Vite</div>
            </div>
            <div className="metric-card">
              <div className="text-sm text-slate-400">Styling</div>
              <div className="mt-2 text-2xl font-semibold text-white">Tailwind</div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 py-6 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="glass-panel p-6 sm:p-8">
          <h2 className="text-lg font-semibold text-white">What is wired now</h2>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
            <li>React 19 app shell with TypeScript.</li>
            <li>Tailwind directives and custom theme extensions.</li>
            <li>Dark, polished starter surface that can host the demo UX.</li>
          </ul>
        </div>

        <div className="glass-panel p-6 sm:p-8">
          <h2 className="text-lg font-semibold text-white">Next build step</h2>
          <p className="mt-4 text-sm leading-6 text-slate-300">
            We can now swap in the upload and search pages without reworking the
            foundation.
          </p>
        </div>
      </section>
    </main>
  )
}

export default App
