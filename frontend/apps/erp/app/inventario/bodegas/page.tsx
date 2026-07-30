import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { Boton, Encabezado, Insignia, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { alternarActivoBodega } from './acciones'

export default async function PaginaBodegas() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: bodegas } = await supabase
    .from('bodegas').select('id, nombre, direccion, activo').eq('empresa_id', activa.id).order('nombre')
  return (
    <div>
      <Encabezado titulo="Bodegas">
        <Link href="/inventario/bodegas/nueva"><Boton>Nueva bodega</Boton></Link>
      </Encabezado>
      <Tabla>
        <thead><tr><Th>Nombre</Th><Th>Dirección</Th><Th>Estado</Th><Th /></tr></thead>
        <tbody>
          {(bodegas ?? []).map((b) => (
            <Tr key={b.id}>
              <Td><Link className="text-marca-700 hover:underline" href={`/inventario/bodegas/${b.id}`}>{b.nombre}</Link></Td>
              <Td>{b.direccion ?? '—'}</Td>
              <Td>{b.activo ? <Insignia tono="verde">Activa</Insignia> : <Insignia tono="gris">Inactiva</Insignia>}</Td>
              <Td>
                <form action={alternarActivoBodega}>
                  <input type="hidden" name="id" value={b.id} /><input type="hidden" name="activo" value={String(b.activo)} />
                  <Boton variante="secundario" type="submit" className="px-2 py-1 text-xs">{b.activo ? 'Desactivar' : 'Reactivar'}</Boton>
                </form>
              </Td>
            </Tr>
          ))}
          {(bodegas ?? []).length === 0 && <Tr><Td colSpan={4} className="py-8 text-center text-slate-500">No hay bodegas. Crea la primera.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}
