import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Td, Th, Tr } from '@suite/ui'
import { FormularioDestino } from '../../componentes/formulario-destino'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { alternarActivoDestino, guardarDestino } from './acciones'

export default async function PaginaTarifario({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>
}) {
  const { e = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_transporte) notFound()
  const supabase = await crearClienteServidor()
  const { data: destinos } = await supabase
    .from('destinos')
    .select('id, nombre, tarifa_kg, activo')
    .eq('empresa_id', activa.id)
    .order('nombre')
  const destinoEdit = (destinos ?? []).find((d) => d.id === e) ?? null
  return (
    <div>
      <Encabezado titulo="Tarifario de destinos" />
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        Los cambios de tarifa aplican solo a órdenes de entrega NUEVAS: lo ya registrado conserva su kilo
        afecto y su neto. Solo dueño o administrador pueden modificar el tarifario.
      </p>
      <div className="mb-4">
        <FormularioDestino
          key={destinoEdit?.id ?? 'nuevo-destino'}
          accion={guardarDestino}
          inicial={destinoEdit ? {
            id: destinoEdit.id,
            nombre: destinoEdit.nombre,
            tarifa_kg: String(destinoEdit.tarifa_kg),
          } : undefined}
        />
      </div>
      <Tabla>
        <thead><tr><Th>Destino</Th><Th className="text-right">Tarifa por kg afecto</Th><Th>Estado</Th><Th /></tr></thead>
        <tbody>
          {(destinos ?? []).map((d) => (
            <Tr key={d.id}>
              <Td>{d.nombre}</Td>
              <Td className="text-right font-mono">{formatearCLP(d.tarifa_kg)}/kg</Td>
              <Td>{d.activo ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="gris">Inactivo</Insignia>}</Td>
              <Td>
                <div className="flex items-center justify-end gap-3">
                  <Link className="text-sm text-marca-700 hover:underline" href={`/tarifario?e=${d.id}`}>Editar tarifa</Link>
                  <form action={alternarActivoDestino}>
                    <input type="hidden" name="id" value={d.id} /><input type="hidden" name="activo" value={String(d.activo)} />
                    <Boton variante="secundario" type="submit" className="px-2 py-1 text-xs">{d.activo ? 'Desactivar' : 'Reactivar'}</Boton>
                  </form>
                </div>
              </Td>
            </Tr>
          ))}
          {(destinos ?? []).length === 0 && <Tr><Td colSpan={4} className="py-8 text-center text-slate-500">No hay destinos todavía.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}
