import { crearClienteServidor } from '@suite/auth/server'
import { formatearCantidad } from '@suite/core'
import { Encabezado, Insignia, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { FormularioMovimiento } from '../../../componentes/formulario-movimiento'
import { registrarAjuste, registrarEntrada, registrarTraslado } from './acciones'

const TONO: Record<string, 'verde' | 'amarillo' | 'rojo' | 'gris'> = { entrada: 'verde', salida: 'rojo', ajuste: 'amarillo', traslado: 'gris' }

export default async function PaginaMovimientos() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: productos }, { data: bodegas }, { data: proveedores }, { data: movimientos }] = await Promise.all([
    supabase.from('productos').select('id, nombre').eq('empresa_id', activa.id).eq('activo', true).order('nombre'),
    supabase.from('bodegas').select('id, nombre').eq('empresa_id', activa.id).eq('activo', true).order('nombre'),
    supabase.from('proveedores').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
    supabase.from('movimientos_stock').select('id, tipo, cantidad, motivo, creado_en, productos (nombre), bodegas (nombre)').eq('empresa_id', activa.id).order('creado_en', { ascending: false }).limit(100),
  ])
  return (
    <div>
      <Encabezado titulo="Movimientos de stock" />
      <FormularioMovimiento
        productos={(productos ?? []).map((p) => ({ id: p.id, nombre: p.nombre }))}
        bodegas={(bodegas ?? []).map((b) => ({ id: b.id, nombre: b.nombre }))}
        proveedores={(proveedores ?? []).map((p) => ({ id: p.id, nombre: p.razon_social }))}
        accionEntrada={registrarEntrada} accionAjuste={registrarAjuste} accionTraslado={registrarTraslado}
      />
      <Tabla>
        <thead><tr><Th>Fecha</Th><Th>Tipo</Th><Th>Producto</Th><Th>Bodega</Th><Th className="text-right">Cantidad</Th><Th>Motivo</Th></tr></thead>
        <tbody>
          {(movimientos ?? []).map((m) => (
            <Tr key={m.id}>
              <Td>{new Date(m.creado_en).toLocaleDateString('es-CL')}</Td>
              <Td><Insignia tono={TONO[m.tipo] ?? 'gris'}>{m.tipo}</Insignia></Td>
              <Td>{m.productos?.nombre ?? '—'}</Td>
              <Td>{m.bodegas?.nombre ?? '—'}</Td>
              <Td className="text-right font-mono">{formatearCantidad(m.cantidad)}</Td>
              <Td>{m.motivo ?? '—'}</Td>
            </Tr>
          ))}
          {(movimientos ?? []).length === 0 && <Tr><Td colSpan={6} className="py-8 text-center text-slate-500">No hay movimientos todavía.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}
