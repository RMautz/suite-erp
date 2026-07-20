import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { whatsappMockEnviados } from '@suite/whatsapp'
import { Encabezado, Tarjeta } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { FormularioMockWhatsApp } from '../../componentes/formulario-mock-whatsapp'
import { simularEntrante } from './acciones'

// Simulador de chat (spec §6, patron /mock-correo + /mock-pago): panel de telefonos +
// hilo del log de la empresa activa + bandeja mock (lo que "llego al celular", incluye
// codigos de vinculacion y respuestas a numeros sin vinculo). Gate estricto.
export default async function SimuladorWhatsApp({ searchParams }: { searchParams: Promise<{ tel?: string }> }) {
  if (process.env.PROVEEDOR_WHATSAPP !== 'mock') notFound()
  const { tel = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()

  const { data: mensajes } = await supabase
    .from('whatsapp_mensajes')
    .select('telefono')
    .eq('empresa_id', activa.id)
    .order('creado_en', { ascending: false })
    .limit(500)
  const bandeja = [...whatsappMockEnviados()].reverse()
  const telefonos = [
    ...new Set([...(mensajes ?? []).map((m) => m.telefono), ...bandeja.map((b) => b.telefono), ...(tel ? [tel] : [])]),
  ]

  const { data: hilo } = tel
    ? await supabase
        .from('whatsapp_mensajes')
        .select('id, direccion, origen, contenido, creado_en')
        .eq('empresa_id', activa.id)
        .eq('telefono', tel)
        .order('creado_en', { ascending: true })
        .limit(100)
    : { data: [] as { id: string; direccion: string; origen: string; contenido: string; creado_en: string }[] }
  const bandejaTel = bandeja.filter((b) => b.telefono === tel)

  return (
    <div>
      <Encabezado titulo="Simulador de WhatsApp (mock)" />
      <p className="mb-4 text-sm text-slate-600">
        Chat de prueba local: escribe como si fueras el celular y el webhook real responde con el bot.
        No se envía nada de verdad.
      </p>
      <div className="grid max-w-5xl grid-cols-1 gap-4 md:grid-cols-[16rem_1fr]">
        <Tarjeta>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Teléfonos</h2>
          <ul className="space-y-1">
            {telefonos.map((t) => (
              <li key={t}>
                <Link
                  className={`block rounded px-2 py-1 font-mono text-sm ${t === tel ? 'bg-slate-100 font-semibold text-marca-700' : 'text-slate-700 hover:bg-slate-50'}`}
                  href={`/mock-whatsapp?tel=${encodeURIComponent(t)}`}
                >
                  {t}
                </Link>
              </li>
            ))}
            {telefonos.length === 0 && <li className="text-sm text-slate-500">Sin conversaciones aún.</li>}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            Elige un teléfono o escribe uno nuevo abajo (E.164, ej. +56912345678). Tras escribir a un
            teléfono nuevo, haz clic en él para ver su hilo.
          </p>
        </Tarjeta>
        <Tarjeta>
          {tel ? (
            <>
              <h2 className="mb-3 text-sm font-semibold text-slate-700">
                Conversación con <span className="font-mono">{tel}</span>
              </h2>
              <div className="mb-4 max-h-96 space-y-2 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-3">
                {(hilo ?? []).map((m) => (
                  <div key={m.id} className={m.direccion === 'entrante' ? 'flex justify-end' : 'flex justify-start'}>
                    <div
                      className={`max-w-md whitespace-pre-wrap rounded-lg px-3 py-2 text-sm text-slate-800 ${
                        m.direccion === 'entrante' ? 'bg-green-100' : 'border border-slate-200 bg-white'
                      }`}
                    >
                      {m.contenido}
                      <div className="mt-1 text-right text-[10px] text-slate-400">
                        {m.origen} · {new Date(m.creado_en).toLocaleTimeString('es-CL')}
                      </div>
                    </div>
                  </div>
                ))}
                {(hilo ?? []).length === 0 && (
                  <p className="text-sm text-slate-500">Sin mensajes en el log para este teléfono.</p>
                )}
              </div>
              {bandejaTel.length > 0 && (
                <div className="mb-4">
                  <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">
                    Bandeja mock (lo que llegó al celular)
                  </h3>
                  <ul className="space-y-1">
                    {bandejaTel.map((b) => (
                      <li
                        key={b.id}
                        className="whitespace-pre-wrap rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      >
                        {b.texto}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="mb-4 text-sm text-slate-500">Elige o escribe un teléfono para ver su conversación.</p>
          )}
          <FormularioMockWhatsApp key={tel} accion={simularEntrante} telefonoInicial={tel} />
        </Tarjeta>
      </div>
    </div>
  )
}
