import Link from 'next/link'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { FormularioConsulta } from './formulario'

// Consultas a administracion (spec 2026-07-22): formulario + historial con la
// respuesta del admin. Con sesion; sin ella, al login.
export default async function PaginaConsultas() {
  const supabase = await crearClienteServidor()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: consultas } = await supabase
    .from('consultas_admin')
    .select('id, asunto, mensaje, estado, respuesta, respondida_en, creado_en')
    .order('creado_en', { ascending: false })
    .limit(50)

  const ETIQUETA: Record<string, { texto: string; clase: string }> = {
    abierta: { texto: 'Abierta', clase: 'bg-amber-50 text-amber-700 border-amber-200' },
    respondida: { texto: 'Respondida', clase: 'bg-green-50 text-green-700 border-green-200' },
    cerrada: { texto: 'Cerrada', clase: 'bg-slate-100 text-slate-600 border-slate-200' },
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/" className="text-sm font-semibold text-marca-700 hover:underline">
        ← Volver al inicio
      </Link>
      <h1 className="mt-4 text-2xl font-bold text-slate-900">Consultar a administración</h1>
      <p className="mt-1 text-sm text-slate-500">
        Escríbenos por tu cuenta, tu suscripción o cualquier duda de Suite ERP. Te respondemos aquí mismo.
      </p>

      <div className="mt-6 rounded-2xl border border-marca-100 bg-white p-6 shadow-xl shadow-marca-600/10">
        <FormularioConsulta />
      </div>

      <h2 className="mt-10 text-lg font-semibold text-slate-800">Tus consultas</h2>
      <div className="mt-3 space-y-4">
        {(consultas ?? []).map((c) => {
          const etiqueta = ETIQUETA[c.estado] ?? ETIQUETA.abierta
          return (
            <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-slate-800">{c.asunto}</p>
                <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${etiqueta.clase}`}>
                  {etiqueta.texto}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">{new Date(c.creado_en).toLocaleDateString('es-CL')}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{c.mensaje}</p>
              {c.respuesta && (
                <div className="mt-3 rounded-lg border border-marca-100 bg-marca-50/50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-marca-700">
                    Respuesta de administración
                    {c.respondida_en && <> · {new Date(c.respondida_en).toLocaleDateString('es-CL')}</>}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{c.respuesta}</p>
                </div>
              )}
            </div>
          )
        })}
        {(consultas ?? []).length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
            Aún no has enviado consultas.
          </p>
        )}
      </div>
    </main>
  )
}
