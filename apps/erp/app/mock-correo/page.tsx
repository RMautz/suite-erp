import { notFound } from 'next/navigation'
import { correosMockEnviados } from '@suite/correo'
import { Encabezado, Tarjeta } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'

export default async function VisorMockCorreo() {
  // Gate estricto: fuera de modo mock la ruta no existe.
  if (process.env.PROVEEDOR_CORREO !== 'mock') notFound()
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />

  // Store de proceso del mock (dev local); más reciente arriba.
  const correos = [...correosMockEnviados()].reverse()

  return (
    <div>
      <Encabezado titulo="Correos enviados (mock)" />
      <p className="mb-4 text-sm text-slate-600">
        Bandeja de prueba local: cada correo que la app "envía" en modo mock aparece aquí con su HTML renderizado. No se entrega nada real.
      </p>
      {correos.length === 0 ? (
        <Tarjeta className="max-w-3xl">
          <p className="text-sm text-slate-500">Aún no se ha enviado ningún correo en este entorno.</p>
        </Tarjeta>
      ) : (
        <div className="space-y-6">
          {correos.map((c) => (
            <Tarjeta key={c.id} className="max-w-3xl">
              <p className="text-sm"><strong>Para:</strong> {c.para}</p>
              <p className="mt-1 text-sm"><strong>Asunto:</strong> {c.asunto}</p>
              <iframe
                title={c.asunto}
                srcDoc={c.html}
                sandbox=""
                className="mt-3 h-96 w-full rounded border border-slate-200 bg-white"
              />
            </Tarjeta>
          ))}
        </div>
      )}
    </div>
  )
}
