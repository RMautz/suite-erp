import { clienteAdmin } from '@suite/auth/admin'
import { verificarAdmin } from '../../lib/guardia'

// Leads del chat de ventas de la landing (spec 2026-07-24): posibles clientes que
// dejaron sus datos. Solo service_role los lee (la tabla no tiene grants API).
export default async function PaginaLeads() {
  await verificarAdmin()
  const admin = clienteAdmin()
  const { data: leads } = await admin
    .from('leads')
    .select('id, numero, nombre, email, telefono, mensaje, origen, creado_en')
    .order('creado_en', { ascending: false })
    .limit(200)
  const lista = leads ?? []

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-bold text-slate-900">Leads</h1>
      <p className="mt-1 text-sm text-slate-500">
        {lista.length === 0
          ? 'Aún no hay leads del chat de la landing.'
          : `${lista.length} lead${lista.length === 1 ? '' : 's'} del chat de la landing, el más reciente primero.`}
      </p>

      <div className="mt-6 space-y-4">
        {lista.map((l) => (
          <div key={l.id} className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-slate-800">
                <span className="mr-1.5 font-mono text-sm text-slate-400">#{l.numero}</span>
                {l.nombre}
              </p>
              <span className="text-xs text-slate-500">{new Date(l.creado_en).toLocaleString('es-CL')}</span>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              <a href={`mailto:${l.email}`} className="font-medium text-marca-700 hover:underline">
                {l.email}
              </a>
              {l.telefono && <> · {l.telefono}</>}
            </p>
            {l.mensaje && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{l.mensaje}</p>}
          </div>
        ))}
      </div>
    </main>
  )
}
