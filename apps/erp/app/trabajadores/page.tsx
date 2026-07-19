import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearRut } from '@suite/core'
import { Boton, Encabezado, Entrada, Insignia, Paginacion, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { alternarActivoTrabajador } from './acciones'

const POR_PAGINA = 25

interface FilaTrabajador {
  id: string
  rut: string
  nombre: string
  activo: boolean
  contratos: { cargo: string }[]
}

export default async function PaginaTrabajadores({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string; inactivos?: string }>
}) {
  const { q = '', pagina: paginaCruda, inactivos } = await searchParams
  const pagina = Math.max(1, Math.trunc(Number(paginaCruda) || 1))
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  // Escritura solo dueno/admin (spec §2.1); contador ve todo en solo lectura.
  // UX, no seguridad: RLS por rol manda (vendedor/bodeguero → 0 filas → tabla vacía).
  const escribe = activa.rol === 'dueno' || activa.rol === 'admin'

  const supabase = await crearClienteServidor()
  // El join trae SOLO el contrato vigente (filtro embebido .eq sobre
  // contratos.vigente, sin !inner): un trabajador sin contrato queda con
  // contratos = [] y sigue apareciendo en la lista.
  let consulta = supabase
    .from('trabajadores')
    .select('id, rut, nombre, activo, contratos (cargo)', { count: 'exact' })
    .eq('empresa_id', activa.id)
    .eq('contratos.vigente', true)
    .order('nombre')
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1)
  if (inactivos !== '1') consulta = consulta.eq('activo', true)
  // Comas y paréntesis rompen la sintaxis del filtro .or() de PostgREST.
  const qLimpia = q.replace(/[,()]/g, ' ').trim()
  if (qLimpia) consulta = consulta.or(`nombre.ilike.%${qLimpia}%,rut.ilike.%${qLimpia}%`)

  const { data, count, error } = await consulta
  if (error) throw new Error('No se pudieron cargar los trabajadores')
  const trabajadores = (data ?? []) as FilaTrabajador[]
  const totalPaginas = Math.max(1, Math.ceil((count ?? 0) / POR_PAGINA))
  const hrefBase = `/trabajadores?q=${encodeURIComponent(q)}${inactivos === '1' ? '&inactivos=1' : ''}`

  return (
    <div>
      <Encabezado titulo="Trabajadores">
        {escribe && (
          <Link href="/trabajadores/nuevo">
            <Boton>Nuevo trabajador</Boton>
          </Link>
        )}
      </Encabezado>

      <form className="mb-4 flex items-center gap-3" action="/trabajadores" method="get">
        <Entrada name="q" defaultValue={q} placeholder="Buscar por nombre o RUT…" className="max-w-xs" />
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
            <Th>Nombre</Th>
            <Th>Cargo (contrato vigente)</Th>
            <Th>Estado</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {trabajadores.map((t) => (
            <Tr key={t.id}>
              <Td className="font-mono">{formatearRut(t.rut)}</Td>
              <Td>
                <Link className="text-marca-700 hover:underline" href={`/trabajadores/${t.id}`}>
                  {t.nombre}
                </Link>
              </Td>
              <Td>{t.contratos[0]?.cargo ?? <span className="text-slate-400">Sin contrato</span>}</Td>
              <Td>{t.activo ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="gris">Inactivo</Insignia>}</Td>
              <Td>
                {escribe && (
                  <form action={alternarActivoTrabajador}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="activo" value={String(t.activo)} />
                    <Boton variante="secundario" type="submit" className="px-2 py-1 text-xs">
                      {t.activo ? 'Desactivar' : 'Reactivar'}
                    </Boton>
                  </form>
                )}
              </Td>
            </Tr>
          ))}
          {trabajadores.length === 0 && (
            <Tr>
              <Td colSpan={5} className="py-8 text-center text-slate-500">
                No hay trabajadores {q ? 'que coincidan con la búsqueda' : 'todavía. Crea el primero'}.
              </Td>
            </Tr>
          )}
        </tbody>
      </Tabla>

      <Paginacion pagina={pagina} totalPaginas={totalPaginas} hrefBase={hrefBase} />
    </div>
  )
}
