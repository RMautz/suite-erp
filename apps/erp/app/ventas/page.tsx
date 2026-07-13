import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'

const TONO: Record<string, 'verde' | 'amarillo' | 'rojo' | 'gris'> = {
  emitido: 'verde', pendiente_envio: 'amarillo', rechazado: 'rojo', borrador: 'gris',
}

export default async function PaginaVentas() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: docs } = await supabase
    .from('documentos_venta')
    .select('id, tipo, folio, estado, total, creado_en, clientes (razon_social)')
    .eq('empresa_id', activa.id)
    .order('creado_en', { ascending: false })
    .limit(100)
  return (
    <div>
      <Encabezado titulo="Ventas">
        <Link href="/ventas/nueva"><Boton>Nueva venta</Boton></Link>
      </Encabezado>
      <Tabla>
        <thead><tr><Th>Tipo</Th><Th>Folio</Th><Th>Cliente</Th><Th className="text-right">Total</Th><Th>Estado</Th></tr></thead>
        <tbody>
          {(docs ?? []).map((d) => (
            <Tr key={d.id}>
              <Td><Link className="text-marca-700 hover:underline" href={`/ventas/${d.id}`}>{d.tipo.replace('_', ' ')}</Link></Td>
              <Td>{d.folio ?? '—'}</Td>
              <Td>{d.clientes?.razon_social ?? '—'}</Td>
              <Td className="text-right">{formatearCLP(d.total)}</Td>
              <Td><Insignia tono={TONO[d.estado] ?? 'gris'}>{d.estado.replace('_', ' ')}</Insignia></Td>
            </Tr>
          ))}
          {(docs ?? []).length === 0 && <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">No hay ventas todavía.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}
