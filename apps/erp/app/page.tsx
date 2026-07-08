import { crearClienteServidor } from '@suite/auth/server'
import { formatearRut } from '@suite/core'
import { Encabezado, Insignia, Tarjeta } from '@suite/ui'
import { obtenerEmpresaActiva } from '../lib/empresa-activa'

export default async function Inicio() {
  const { activa } = await obtenerEmpresaActiva()

  if (!activa) {
    return (
      <div>
        <Encabezado titulo="Sin organización" />
        <Tarjeta>
          <p>
            Tu usuario no pertenece a ninguna organización. Pide una invitación o{' '}
            <a className="text-marca-600 underline" href={process.env.NEXT_PUBLIC_URL_WEB + '/registro'}>
              crea tu cuenta
            </a>
            .
          </p>
        </Tarjeta>
      </div>
    )
  }

  const supabase = await crearClienteServidor()
  const [{ data: organizacion }, productos, clientes] = await Promise.all([
    supabase
      .from('empresas')
      .select('organizaciones (estado, trial_hasta)')
      .eq('id', activa.id)
      .single()
      .then((r) => ({ data: r.data?.organizaciones ?? null })),
    supabase
      .from('productos')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', activa.id)
      .eq('activo', true),
    supabase
      .from('clientes')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', activa.id)
      .eq('activo', true),
  ])

  return (
    <div>
      <Encabezado titulo={activa.razon_social}>
        <span className="text-sm text-slate-500">{formatearRut(activa.rut)}</span>
      </Encabezado>

      {organizacion?.estado === 'trial' && (
        <div className="mb-6">
          <Insignia tono="amarillo">
            Período de prueba hasta el{' '}
            {new Date(organizacion.trial_hasta + 'T00:00:00').toLocaleDateString('es-CL')}
          </Insignia>
        </div>
      )}
      {organizacion?.estado === 'suspendida' && (
        <div className="mb-6">
          <Insignia tono="rojo">Organización suspendida. Contáctanos para reactivarla.</Insignia>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Tarjeta>
          <p className="text-sm text-slate-500">Productos activos</p>
          <p className="mt-1 text-3xl font-semibold">{productos.count ?? 0}</p>
        </Tarjeta>
        <Tarjeta>
          <p className="text-sm text-slate-500">Clientes activos</p>
          <p className="mt-1 text-3xl font-semibold">{clientes.count ?? 0}</p>
        </Tarjeta>
        <Tarjeta>
          <p className="text-sm text-slate-500">Ventas</p>
          <p className="mt-1 text-sm text-slate-400">Disponible en el módulo de ventas (Plan 3)</p>
        </Tarjeta>
      </div>
    </div>
  )
}
