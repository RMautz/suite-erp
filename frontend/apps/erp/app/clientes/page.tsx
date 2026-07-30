import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearRut } from '@suite/core'
import { Boton, Encabezado, Entrada, Insignia, Paginacion, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { alternarActivoCliente } from './acciones'

const POR_PAGINA = 25

export default async function PaginaClientes({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string; inactivos?: string }>
}) {
  const { q = '', pagina: paginaCruda, inactivos } = await searchParams
  const pagina = Math.max(1, Math.trunc(Number(paginaCruda) || 1))
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />

  const supabase = await crearClienteServidor()
  let consulta = supabase
    .from('clientes')
    .select('id, rut, razon_social, comuna, condicion_pago_dias, activo', { count: 'exact' })
    .eq('empresa_id', activa.id)
    .order('razon_social')
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1)
  if (inactivos !== '1') consulta = consulta.eq('activo', true)
  // Comas y paréntesis rompen la sintaxis del filtro .or() de PostgREST.
  const qLimpia = q.replace(/[,()]/g, ' ').trim()
  if (qLimpia) consulta = consulta.or(`razon_social.ilike.%${qLimpia}%,rut.ilike.%${qLimpia}%`)

  const { data: clientes, count, error } = await consulta
  if (error) throw new Error('No se pudieron cargar los clientes')
  const totalPaginas = Math.max(1, Math.ceil((count ?? 0) / POR_PAGINA))
  const hrefBase = `/clientes?q=${encodeURIComponent(q)}${inactivos === '1' ? '&inactivos=1' : ''}`

  return (
    <div>
      <Encabezado titulo="Clientes">
        <Link href="/clientes/nuevo">
          <Boton>Nuevo cliente</Boton>
        </Link>
      </Encabezado>

      <form className="mb-4 flex items-center gap-3" action="/clientes" method="get">
        <Entrada name="q" defaultValue={q} placeholder="Buscar por razón social o RUT…" className="max-w-xs" />
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
            <Th>RUT</Th>
            <Th>Razón social</Th>
            <Th>Comuna</Th>
            <Th>Condición de pago</Th>
            <Th>Estado</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {(clientes ?? []).map((c) => (
            <Tr key={c.id}>
              <Td className="font-mono">{formatearRut(c.rut)}</Td>
              <Td>
                <Link className="text-marca-700 hover:underline" href={`/clientes/${c.id}`}>
                  {c.razon_social}
                </Link>
              </Td>
              <Td>{c.comuna ?? '—'}</Td>
              <Td>{c.condicion_pago_dias === 0 ? 'Contado' : `${c.condicion_pago_dias} días`}</Td>
              <Td>{c.activo ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="gris">Inactivo</Insignia>}</Td>
              <Td>
                <form action={alternarActivoCliente}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="activo" value={String(c.activo)} />
                  <Boton variante="secundario" type="submit" className="px-2 py-1 text-xs">
                    {c.activo ? 'Desactivar' : 'Reactivar'}
                  </Boton>
                </form>
              </Td>
            </Tr>
          ))}
          {(clientes ?? []).length === 0 && (
            <Tr>
              <Td colSpan={6} className="py-8 text-center text-slate-500">
                No hay clientes {q ? 'que coincidan con la búsqueda' : 'todavía. Crea el primero o usa Importar'}.
              </Td>
            </Tr>
          )}
        </tbody>
      </Tabla>

      <Paginacion pagina={pagina} totalPaginas={totalPaginas} hrefBase={hrefBase} />
    </div>
  )
}
