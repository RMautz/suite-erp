import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearNumeroProforma } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { ETIQUETA_ESTADO, TONO_ESTADO } from './estados'

export default async function PaginaProformas() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_transporte) notFound()
  const supabase = await crearClienteServidor()
  const { data: profs } = await supabase
    .from('proformas')
    .select('id, numero, fecha, total, estado, clientes (razon_social), documentos_venta (folio)')
    .eq('empresa_id', activa.id)
    .order('numero', { ascending: false })
    .limit(100)
  return (
    <div>
      <Encabezado titulo="Proformas">
        <Link href="/proformas/nueva"><Boton>Nueva proforma</Boton></Link>
      </Encabezado>
      <Tabla>
        <thead><tr><Th>N°</Th><Th>Cliente</Th><Th>Fecha</Th><Th className="text-right">Total</Th><Th>Estado</Th><Th>Folio FAV</Th></tr></thead>
        <tbody>
          {(profs ?? []).map((p) => (
            <Tr key={p.id}>
              <Td><Link className="text-marca-700 hover:underline" href={`/proformas/${p.id}`}>{formatearNumeroProforma(p.numero)}</Link></Td>
              <Td>{p.clientes?.razon_social ?? '—'}</Td>
              <Td>{new Date(p.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
              <Td className="text-right font-mono">{formatearCLP(p.total)}</Td>
              <Td><Insignia tono={TONO_ESTADO[p.estado] ?? 'gris'}>{ETIQUETA_ESTADO[p.estado] ?? p.estado}</Insignia></Td>
              <Td>{p.estado === 'facturada' ? (p.documentos_venta?.folio ?? '— (sin folio)') : '—'}</Td>
            </Tr>
          ))}
          {(profs ?? []).length === 0 && <Tr><Td colSpan={6} className="py-8 text-center text-slate-500">No hay proformas todavía.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}
