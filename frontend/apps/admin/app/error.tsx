'use client'

// El panel no tenia boundary: cualquier throw del servidor salia como la pantalla
// blanca "Application error: a server-side exception has occurred", que fue el
// sintoma del 500 en la raiz. El guard ya no lanza, pero el resto del panel si
// (errores de carga de datos), y sin esto reproducen el mismo sintoma.
export default function ErrorPanel({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="mx-auto max-w-lg py-12 text-center">
      <h1 className="text-2xl font-bold text-slate-900">Algo falló en el panel</h1>
      <p className="mt-3 text-sm text-slate-600">
        No pudimos cargar esta vista. Vuelve a intentarlo; si sigue ocurriendo, revisa los
        logs del servidor.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-slate-400">digest: {error.digest}</p>
      )}
      <button
        onClick={reset}
        className="mt-8 rounded-lg bg-marca-700 px-4 py-2 text-sm font-medium text-white hover:bg-marca-800"
      >
        Reintentar
      </button>
    </div>
  )
}
