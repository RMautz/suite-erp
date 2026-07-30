export default function RegistroExitoso() {
  return (
    <main
      className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10"
      style={{ background: 'radial-gradient(900px 420px at 50% -10%, #e0f2fe 0%, rgba(224,242,254,0) 60%), #f8fafc' }}
    >
      <div className="w-full max-w-sm">
        <p className="mb-6 block text-center text-2xl font-bold tracking-tight text-slate-900">
          Suite <span className="bg-gradient-to-r from-marca-600 to-cyan-500 bg-clip-text text-transparent">ERP</span>
        </p>
        <div className="rounded-2xl border border-marca-100 bg-white p-8 text-center shadow-xl shadow-marca-600/10">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-2xl text-emerald-700" aria-hidden>
            ✓
          </div>
          <h1 className="mt-4 text-xl font-semibold text-slate-900">¡Cuenta creada!</h1>
          <p className="mt-2 text-sm text-slate-500">Tu organización quedó registrada con 14 días de prueba.</p>
          <a
            href={process.env.NEXT_PUBLIC_URL_ERP}
            className="mt-6 inline-block w-full rounded-lg bg-gradient-to-br from-marca-600 to-marca-700 px-5 py-2.5 font-semibold text-white shadow-lg shadow-marca-600/30 transition-opacity hover:opacity-95"
          >
            Entrar al ERP
          </a>
        </div>
      </div>
    </main>
  )
}
