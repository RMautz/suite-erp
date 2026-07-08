import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Boton, Encabezado, Entrada, Insignia, Paginacion, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { alternarActivoProducto } from './acciones'

const POR_PAGINA = 25

export default async function PaginaProductos({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string; inactivos?: string }>
}) {
  const { q = '', pagina: paginaCruda, inactivos } = await searchParams
  const pagina = Math.max(1, Number(paginaCruda) || 1)
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />

  const supabase = await crearClienteServidor()
  let consulta = supabase
    .from('productos')
    .select('id, sku, nombre, unidad, precio_neto, exento, activo, categorias_producto (nombre)', {
      count: 'exact',
    })
    .eq('empresa_id', activa.id)
    .order('nombre')
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1)
  if (inactivos !== '1') consulta = consulta.eq('activo', true)
  // Comas y paréntesis rompen la sintaxis del filtro .or() de PostgREST.
  const qLimpia = q.replace(/[,()]/g, ' ').trim()
  if (qLimpia) consulta = consulta.or(`nombre.ilike.%${qLimpia}%,sku.ilike.%${qLimpia}%`)

  const { data: productos, count, error } = await consulta
  if (error) throw new Error('No se pudieron cargar los productos')
  const totalPaginas = Math.max(1, Math.ceil((count ?? 0) / POR_PAGINA))

  const hrefBase = `/productos?q=${encodeURIComponent(q)}${inactivos === '1' ? '&inactivos=1' : ''}`

  return (
    <div>
      <Encabezado titulo="Productos">
        <Link href="/productos/nuevo">
          <Boton>Nuevo producto</Boton>
        </Link>
      </Encabezado>

      <form className="mb-4 flex items-center gap-3" action="/productos" method="get">
        <Entrada name="q" defaultValue={q} placeholder="Buscar por nombre o SKU…" className="max-w-xs" />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="inactivos" value="1" defaultChecked={inactivos === '1'} />
          Ver inactivos
        </label>
        <Boton variante="secundario" type="submit">
          Buscar
        </Boton>
      </form>

      <Tabla>
        <thead>
          <tr>
            <Th>SKU</Th>
            <Th>Nombre</Th>
            <Th>Categoría</Th>
            <Th>Unidad</Th>
            <Th className="text-right">Precio neto</Th>
            <Th>Estado</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {(productos ?? []).map((p) => (
            <Tr key={p.id}>
              <Td className="font-mono">{p.sku}</Td>
              <Td>
                <Link className="text-marca-700 hover:underline" href={`/productos/${p.id}`}>
                  {p.nombre}
                </Link>
                {p.exento && (
                  <span className="ml-2">
                    <Insignia tono="gris">Exento</Insignia>
                  </span>
                )}
              </Td>
              <Td>{p.categorias_producto?.nombre ?? '—'}</Td>
              <Td>{p.unidad}</Td>
              <Td className="text-right">{formatearCLP(p.precio_neto)}</Td>
              <Td>{p.activo ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="gris">Inactivo</Insignia>}</Td>
              <Td>
                <form action={alternarActivoProducto}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="activo" value={String(p.activo)} />
                  <Boton variante="secundario" type="submit" className="px-2 py-1 text-xs">
                    {p.activo ? 'Desactivar' : 'Reactivar'}
                  </Boton>
                </form>
              </Td>
            </Tr>
          ))}
          {(productos ?? []).length === 0 && (
            <Tr>
              <Td colSpan={7} className="py-8 text-center text-slate-500">
                No hay productos {q ? 'que coincidan con la búsqueda' : 'todavía. Crea el primero o usa Importar'}.
              </Td>
            </Tr>
          )}
        </tbody>
      </Tabla>

      <Paginacion pagina={pagina} totalPaginas={totalPaginas} hrefBase={hrefBase} />
    </div>
  )
}
