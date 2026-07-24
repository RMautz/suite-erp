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
    .select('id, numero, origen, asunto, mensaje, estado, respuesta, respondida_en, creado_en')
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

      {process.env.NEXT_PUBLIC_WHATSAPP_URL && (
        // Acceso visible al bot (spec tickets): en local abre el simulador; en
        // produccion, wa.me/<numero> (credencial #15). Sin la env, no se ofrece.
        <a
          href={process.env.NEXT_PUBLIC_WHATSAPP_URL}
          className="mt-4 flex items-center gap-3 rounded-2xl border border-green-200 bg-green-50 p-4 transition-colors hover:bg-green-100"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#25D366] text-white">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
            </svg>
          </span>
          <span>
            <span className="block font-semibold text-slate-800">¿Más rápido? Escríbenos por WhatsApp</span>
            <span className="block text-sm text-slate-600">
              El bot también crea tickets: mándale <span className="font-mono">ayuda &lt;tu problema&gt;</span>.
            </span>
          </span>
        </a>
      )}

      <h2 className="mt-10 text-lg font-semibold text-slate-800">Tus consultas</h2>
      <div className="mt-3 space-y-4">
        {(consultas ?? []).map((c) => {
          const etiqueta = ETIQUETA[c.estado] ?? ETIQUETA.abierta
          return (
            <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-slate-800">
                  <span className="mr-1.5 font-mono text-sm text-slate-400">#{c.numero}</span>
                  {c.asunto}
                  {c.origen === 'whatsapp' && (
                    <span className="ml-2 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                      WhatsApp
                    </span>
                  )}
                </p>
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
