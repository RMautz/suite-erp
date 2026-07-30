import { clienteAdmin } from '@suite/auth/admin'
import { verificarAdmin } from '../../lib/guardia'
import { cerrarConsulta, responderConsulta } from './acciones'
import { FormularioRespuesta } from './formulario-respuesta'

// Bandeja de consultas de los tenants (spec 2026-07-22): abiertas primero.
export default async function PaginaConsultasAdmin() {
  await verificarAdmin()
  const admin = clienteAdmin()
  const [{ data: consultas }, { data: orgs }] = await Promise.all([
    admin
      .from('consultas_admin')
      .select('id, numero, origen, organizacion_id, email, asunto, mensaje, estado, respuesta, respondida_en, creado_en')
      .order('creado_en', { ascending: false })
      .limit(200),
    admin.from('organizaciones').select('id, razon_social, rut'),
  ])
  const nombreOrg = new Map((orgs ?? []).map((o) => [o.id, `${o.razon_social} · ${o.rut}`]))
  const lista = [...(consultas ?? [])].sort((a, b) => {
    const peso = (e: string) => (e === 'abierta' ? 0 : e === 'respondida' ? 1 : 2)
    return peso(a.estado) - peso(b.estado)
  })
  const abiertas = lista.filter((c) => c.estado === 'abierta').length

  const ETIQUETA: Record<string, string> = {
    abierta: 'border-amber-200 bg-amber-50 text-amber-700',
    respondida: 'border-green-200 bg-green-50 text-green-700',
    cerrada: 'border-slate-200 bg-slate-100 text-slate-600',
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Consultas de clientes</h1>
      <p className="mt-1 text-sm text-slate-500">
        {abiertas === 0 ? 'Sin consultas abiertas.' : `${abiertas} consulta${abiertas === 1 ? '' : 's'} abierta${abiertas === 1 ? '' : 's'}.`}
      </p>
      <div className="mt-6 space-y-4">
        {lista.map((c) => (
          <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-800">
                  <span className="mr-1.5 font-mono text-sm text-slate-400">#{c.numero}</span>
                  {c.asunto}
                  {c.origen === 'whatsapp' && (
                    <span className="ml-2 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                      WhatsApp
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-500">
                  {nombreOrg.get(c.organizacion_id) ?? c.organizacion_id} · {c.email} ·{' '}
                  {new Date(c.creado_en).toLocaleDateString('es-CL')}
                </p>
              </div>
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${ETIQUETA[c.estado] ?? ''}`}>
                {c.estado}
              </span>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{c.mensaje}</p>
            {c.respuesta && (
              <div className="mt-3 rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Respuesta{c.respondida_en && <> · {new Date(c.respondida_en).toLocaleDateString('es-CL')}</>}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{c.respuesta}</p>
              </div>
            )}
            <FormularioRespuesta consultaId={c.id} responder={responderConsulta} cerrar={cerrarConsulta} estado={c.estado} />
          </div>
        ))}
        {lista.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
            Aún no llegan consultas.
          </p>
        )}
      </div>
    </div>
  )
}
