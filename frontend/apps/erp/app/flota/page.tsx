import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearPatente, formatearRut } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Td, Th, Tr } from '@suite/ui'
import { FormularioConductor } from '../../componentes/formulario-conductor'
import { FormularioVehiculo } from '../../componentes/formulario-vehiculo'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { alternarActivoConductor, alternarActivoVehiculo, guardarConductor, guardarVehiculo } from './acciones'

export default async function PaginaFlota({
  searchParams,
}: {
  searchParams: Promise<{ ev?: string; ec?: string }>
}) {
  const { ev = '', ec = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_transporte) notFound()
  const supabase = await crearClienteServidor()
  const [{ data: vehiculos }, { data: conductores }] = await Promise.all([
    supabase.from('vehiculos').select('id, patente, descripcion, capacidad_kg, activo').eq('empresa_id', activa.id).order('patente'),
    supabase.from('conductores').select('id, rut, nombre, telefono, activo').eq('empresa_id', activa.id).order('nombre'),
  ])
  const vehiculoEdit = (vehiculos ?? []).find((v) => v.id === ev) ?? null
  const conductorEdit = (conductores ?? []).find((c) => c.id === ec) ?? null
  return (
    <div>
      <Encabezado titulo="Flota" />
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Vehículos</h2>
        <div className="mb-4">
          <FormularioVehiculo
            key={vehiculoEdit?.id ?? 'nuevo-vehiculo'}
            accion={guardarVehiculo}
            inicial={vehiculoEdit ? {
              id: vehiculoEdit.id,
              patente: formatearPatente(vehiculoEdit.patente),
              descripcion: vehiculoEdit.descripcion ?? '',
              capacidad_kg: vehiculoEdit.capacidad_kg === null ? '' : String(vehiculoEdit.capacidad_kg),
            } : undefined}
          />
        </div>
        <Tabla>
          <thead><tr><Th>Patente</Th><Th>Descripción</Th><Th className="text-right">Capacidad (kg)</Th><Th>Estado</Th><Th /></tr></thead>
          <tbody>
            {(vehiculos ?? []).map((v) => (
              <Tr key={v.id}>
                <Td className="font-mono">{formatearPatente(v.patente)}</Td>
                <Td>{v.descripcion ?? '—'}</Td>
                <Td className="text-right font-mono">{v.capacidad_kg ?? '—'}</Td>
                <Td>{v.activo ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="gris">Inactivo</Insignia>}</Td>
                <Td>
                  <div className="flex items-center justify-end gap-3">
                    <Link className="text-sm text-marca-700 hover:underline" href={`/flota?ev=${v.id}`}>Editar</Link>
                    <form action={alternarActivoVehiculo}>
                      <input type="hidden" name="id" value={v.id} /><input type="hidden" name="activo" value={String(v.activo)} />
                      <Boton variante="secundario" type="submit" className="px-2 py-1 text-xs">{v.activo ? 'Desactivar' : 'Reactivar'}</Boton>
                    </form>
                  </div>
                </Td>
              </Tr>
            ))}
            {(vehiculos ?? []).length === 0 && <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">No hay vehículos todavía.</Td></Tr>}
          </tbody>
        </Tabla>
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Conductores</h2>
        <div className="mb-4">
          <FormularioConductor
            key={conductorEdit?.id ?? 'nuevo-conductor'}
            accion={guardarConductor}
            inicial={conductorEdit ? {
              id: conductorEdit.id,
              rut: formatearRut(conductorEdit.rut),
              nombre: conductorEdit.nombre,
              telefono: conductorEdit.telefono ?? '',
            } : undefined}
          />
        </div>
        <Tabla>
          <thead><tr><Th>RUT</Th><Th>Nombre</Th><Th>Teléfono</Th><Th>Estado</Th><Th /></tr></thead>
          <tbody>
            {(conductores ?? []).map((c) => (
              <Tr key={c.id}>
                <Td className="font-mono">{formatearRut(c.rut)}</Td>
                <Td>{c.nombre}</Td>
                <Td>{c.telefono ?? '—'}</Td>
                <Td>{c.activo ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="gris">Inactivo</Insignia>}</Td>
                <Td>
                  <div className="flex items-center justify-end gap-3">
                    <Link className="text-sm text-marca-700 hover:underline" href={`/flota?ec=${c.id}`}>Editar</Link>
                    <form action={alternarActivoConductor}>
                      <input type="hidden" name="id" value={c.id} /><input type="hidden" name="activo" value={String(c.activo)} />
                      <Boton variante="secundario" type="submit" className="px-2 py-1 text-xs">{c.activo ? 'Desactivar' : 'Reactivar'}</Boton>
                    </form>
                  </div>
                </Td>
              </Tr>
            ))}
            {(conductores ?? []).length === 0 && <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">No hay conductores todavía.</Td></Tr>}
          </tbody>
        </Tabla>
      </section>
    </div>
  )
}
