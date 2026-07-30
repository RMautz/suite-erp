import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearRut } from '@suite/core'
import { Boton, Encabezado, Entrada, Insignia, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { alternarActivoProveedor } from './acciones'

export default async function PaginaProveedores({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  let consulta = supabase.from('proveedores').select('id, rut, razon_social, comuna, activo').eq('empresa_id', activa.id).order('razon_social')
  const qLimpia = q.replace(/[,()]/g, ' ').trim()
  if (qLimpia) consulta = consulta.or(`razon_social.ilike.%${qLimpia}%,rut.ilike.%${qLimpia}%`)
  const { data: proveedores } = await consulta
  return (
    <div>
      <Encabezado titulo="Proveedores">
        <Link href="/inventario/proveedores/nuevo"><Boton>Nuevo proveedor</Boton></Link>
      </Encabezado>
      <form className="mb-4 flex items-center gap-3" action="/inventario/proveedores" method="get">
        <Entrada name="q" defaultValue={q} placeholder="Buscar por razón social o RUT…" className="max-w-xs" />
        <Boton variante="secundario" type="submit">Buscar</Boton>
      </form>
      <Tabla>
        <thead><tr><Th>RUT</Th><Th>Razón social</Th><Th>Comuna</Th><Th>Estado</Th><Th /></tr></thead>
        <tbody>
          {(proveedores ?? []).map((p) => (
            <Tr key={p.id}>
              <Td className="font-mono">{formatearRut(p.rut)}</Td>
              <Td><Link className="text-marca-700 hover:underline" href={`/inventario/proveedores/${p.id}`}>{p.razon_social}</Link></Td>
              <Td>{p.comuna ?? '—'}</Td>
              <Td>{p.activo ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="gris">Inactivo</Insignia>}</Td>
              <Td>
                <form action={alternarActivoProveedor}>
                  <input type="hidden" name="id" value={p.id} /><input type="hidden" name="activo" value={String(p.activo)} />
                  <Boton variante="secundario" type="submit" className="px-2 py-1 text-xs">{p.activo ? 'Desactivar' : 'Reactivar'}</Boton>
                </form>
              </Td>
            </Tr>
          ))}
          {(proveedores ?? []).length === 0 && <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">No hay proveedores {q ? 'que coincidan' : 'todavía'}.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}
