import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Td, Th, Tr } from '@suite/ui'
import { FormularioAnularCompra } from '../../../componentes/formulario-anular-compra'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

const ETIQUETA: Record<string, string> = { factura: 'Factura', factura_exenta: 'Factura exenta' }

export default async function PaginaFacturasCompra() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: facturas } = await supabase
    .from('documentos_compra')
    .select('id, tipo, folio, fecha_emision, total, estado, motivo_anulacion, proveedores (razon_social), ordenes_compra (numero)')
    .eq('empresa_id', activa.id)
    .order('creado_en', { ascending: false })
    .limit(100)
  return (
    <div>
      <Encabezado titulo="Facturas de compra">
        <Link href="/por-pagar/facturas/nueva"><Boton>Registrar factura</Boton></Link>
      </Encabezado>
      <Tabla>
        <thead><tr><Th>Documento</Th><Th>Proveedor</Th><Th>Emisión</Th><Th>OC</Th><Th className="text-right">Total</Th><Th>Estado</Th><Th /></tr></thead>
        <tbody>
          {(facturas ?? []).map((f) => (
            <Tr key={f.id}>
              <Td>{ETIQUETA[f.tipo] ?? f.tipo} {f.folio}</Td>
              <Td>{f.proveedores?.razon_social ?? '—'}</Td>
              <Td>{new Date(f.fecha_emision + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
              <Td>{f.ordenes_compra?.numero ? `OC ${f.ordenes_compra.numero}` : '—'}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.total)}</Td>
              <Td>{f.estado === 'activa' ? <Insignia tono="verde">Activa</Insignia> : <Insignia tono="rojo">Anulada</Insignia>}</Td>
              <Td>{f.estado === 'activa' ? <FormularioAnularCompra documentoId={f.id} /> : <span className="text-xs text-slate-400">{f.motivo_anulacion}</span>}</Td>
            </Tr>
          ))}
          {(facturas ?? []).length === 0 && <Tr><Td colSpan={7} className="py-8 text-center text-slate-500">No hay facturas registradas.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}
