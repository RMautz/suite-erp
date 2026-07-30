import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCantidad } from '@suite/core'
import { Boton, Encabezado, Entrada, Insignia, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { FormularioMovimiento } from '../../../componentes/formulario-movimiento'
import { registrarAjuste, registrarEntrada, registrarTraslado } from './acciones'

const TONO: Record<string, 'verde' | 'amarillo' | 'rojo' | 'gris'> = { entrada: 'verde', salida: 'rojo', ajuste: 'amarillo', traslado: 'gris' }
const TIPOS = ['entrada', 'salida', 'ajuste', 'traslado'] as const

export default async function PaginaMovimientos({
  searchParams,
}: {
  searchParams: Promise<{ producto?: string; bodega?: string; tipo?: string; desde?: string; hasta?: string }>
}) {
  const { producto = '', bodega = '', tipo = '', desde = '', hasta = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: productos }, { data: bodegas }, { data: proveedores }] = await Promise.all([
    supabase.from('productos').select('id, nombre').eq('empresa_id', activa.id).eq('activo', true).order('nombre'),
    supabase.from('bodegas').select('id, nombre').eq('empresa_id', activa.id).eq('activo', true).order('nombre'),
    supabase.from('proveedores').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
  ])
  let consulta = supabase.from('movimientos_stock').select('id, tipo, cantidad, motivo, creado_en, productos (nombre), bodegas (nombre)').eq('empresa_id', activa.id)
  if (producto) consulta = consulta.eq('producto_id', producto)
  if (bodega) consulta = consulta.eq('bodega_id', bodega)
  if ((TIPOS as readonly string[]).includes(tipo)) consulta = consulta.eq('tipo', tipo)
  if (desde) consulta = consulta.gte('creado_en', desde)
  if (hasta) consulta = consulta.lte('creado_en', hasta + 'T23:59:59.999')
  const { data: movimientos } = await consulta.order('creado_en', { ascending: false }).limit(100)
  const hayFiltros = Boolean(producto || bodega || tipo || desde || hasta)
  return (
    <div>
      <Encabezado titulo="Movimientos de stock" />
      <FormularioMovimiento
        productos={(productos ?? []).map((p) => ({ id: p.id, nombre: p.nombre }))}
        bodegas={(bodegas ?? []).map((b) => ({ id: b.id, nombre: b.nombre }))}
        proveedores={(proveedores ?? []).map((p) => ({ id: p.id, nombre: p.razon_social }))}
        accionEntrada={registrarEntrada} accionAjuste={registrarAjuste} accionTraslado={registrarTraslado}
      />
      <form className="mb-4 flex flex-wrap items-end gap-3" action="/inventario/movimientos" method="get">
        <Selector name="producto" defaultValue={producto} className="max-w-xs">
          <option value="">Todos los productos</option>
          {(productos ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Selector>
        <Selector name="bodega" defaultValue={bodega} className="max-w-xs">
          <option value="">Todas las bodegas</option>
          {(bodegas ?? []).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
        </Selector>
        <Selector name="tipo" defaultValue={tipo} className="max-w-xs">
          <option value="">Todos los tipos</option>
          {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
        </Selector>
        <Entrada type="date" name="desde" defaultValue={desde} className="max-w-xs" />
        <Entrada type="date" name="hasta" defaultValue={hasta} className="max-w-xs" />
        <Boton variante="secundario" type="submit">Filtrar</Boton>
        <Link className="text-sm text-marca-700 hover:underline" href="/inventario/movimientos">Limpiar</Link>
      </form>
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
          {(movimientos ?? []).length === 0 && (
            <Tr><Td colSpan={6} className="py-8 text-center text-slate-500">{hayFiltros ? 'No hay movimientos que coincidan con los filtros.' : 'No hay movimientos todavía.'}</Td></Tr>
          )}
        </tbody>
      </Tabla>
    </div>
  )
}
