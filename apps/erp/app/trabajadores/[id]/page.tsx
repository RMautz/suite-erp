import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearRut } from '@suite/core'
import { Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { FormularioContrato } from '../../../componentes/formulario-contrato'
import { FormularioTrabajador } from '../../../componentes/formulario-trabajador'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { guardarContrato, guardarTrabajador } from '../acciones'
import { ETIQUETA_AFP, ETIQUETA_TIPO } from '../catalogos'

interface Contrato {
  id: string
  tipo: string
  fecha_inicio: string
  fecha_termino: string | null
  cargo: string
  sueldo_base: number
  gratificacion_legal: boolean
  afp: string
  salud: string
  plan_isapre_uf: number | null
  vigente: boolean
}

const fmtFecha = (f: string | null) =>
  f ? new Date(f + 'T00:00:00').toLocaleDateString('es-CL') : '—'

export default async function FichaTrabajador({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  // Escritura de ficha y contratos: solo dueno/admin. Contador: TODO en solo
  // lectura (los formularios ni se montan). Vendedor/bodeguero: RLS por rol →
  // 0 filas → notFound() de abajo. UX; la seguridad es RLS.
  const escribe = activa.rol === 'dueno' || activa.rol === 'admin'

  const supabase = await crearClienteServidor()
  const { data: trabajador } = await supabase
    .from('trabajadores')
    .select('*')
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .single()
  if (!trabajador) notFound()

  const { data: contratosData } = await supabase
    .from('contratos')
    .select('id, tipo, fecha_inicio, fecha_termino, cargo, sueldo_base, gratificacion_legal, afp, salud, plan_isapre_uf, vigente')
    .eq('empresa_id', activa.id)
    .eq('trabajador_id', id)
    .order('creado_en', { ascending: false })
  const contratos = (contratosData ?? []) as Contrato[]
  const vigente = contratos.find((c) => c.vigente)

  return (
    <div>
      <Encabezado titulo={trabajador.nombre}>
        {!trabajador.activo && <Insignia tono="gris">Inactivo</Insignia>}
      </Encabezado>

      {escribe ? (
        <FormularioTrabajador
          accion={guardarTrabajador}
          inicial={{
            id: trabajador.id,
            rut: formatearRut(trabajador.rut),
            nombre: trabajador.nombre,
            email: trabajador.email ?? '',
            telefono: trabajador.telefono ?? '',
            direccion: trabajador.direccion ?? '',
            fecha_nacimiento: trabajador.fecha_nacimiento ?? '',
          }}
        />
      ) : (
        <Tarjeta className="max-w-2xl">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium text-slate-700">RUT</dt>
              <dd className="font-mono">{formatearRut(trabajador.rut)}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Nombre</dt>
              <dd>{trabajador.nombre}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Correo</dt>
              <dd>{trabajador.email ?? '—'}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Teléfono</dt>
              <dd>{trabajador.telefono ?? '—'}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Fecha de nacimiento</dt>
              <dd>{fmtFecha(trabajador.fecha_nacimiento)}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Dirección</dt>
              <dd>{trabajador.direccion ?? '—'}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-slate-500">
            Tu rol permite solo lectura: la ficha y los contratos los editan dueño o admin.
          </p>
        </Tarjeta>
      )}

      <h2 className="mb-2 mt-8 text-lg font-semibold text-slate-800">Contratos</h2>
      <Tabla>
        <thead>
          <tr>
            <Th>Estado</Th>
            <Th>Tipo</Th>
            <Th>Cargo</Th>
            <Th>Inicio</Th>
            <Th>Término</Th>
            <Th className="text-right">Sueldo base</Th>
            <Th>AFP</Th>
            <Th>Salud</Th>
            <Th>Gratificación</Th>
          </tr>
        </thead>
        <tbody>
          {contratos.map((c) => (
            <Tr key={c.id}>
              <Td>
                {c.vigente ? <Insignia tono="verde">Vigente</Insignia> : <Insignia tono="gris">Cerrado</Insignia>}
              </Td>
              <Td>{ETIQUETA_TIPO[c.tipo] ?? c.tipo}</Td>
              <Td>{c.cargo}</Td>
              <Td>{fmtFecha(c.fecha_inicio)}</Td>
              <Td>{fmtFecha(c.fecha_termino)}</Td>
              <Td className="text-right font-mono">{formatearCLP(c.sueldo_base)}</Td>
              <Td>{ETIQUETA_AFP[c.afp] ?? c.afp}</Td>
              <Td>
                {c.salud === 'fonasa'
                  ? 'Fonasa'
                  : `Isapre · ${Number(c.plan_isapre_uf ?? 0).toLocaleString('es-CL')} UF`}
              </Td>
              <Td>{c.gratificacion_legal ? 'Sí' : 'No'}</Td>
            </Tr>
          ))}
          {contratos.length === 0 && (
            <Tr>
              <Td colSpan={9} className="py-8 text-center text-slate-500">
                Sin contratos todavía.
              </Td>
            </Tr>
          )}
        </tbody>
      </Tabla>

      {escribe && (
        <div className="mt-8">
          <h2 className="mb-2 text-lg font-semibold text-slate-800">
            {vigente ? 'Renovar contrato (cierra el vigente y crea uno nuevo)' : 'Primer contrato'}
          </h2>
          <FormularioContrato
            accion={guardarContrato}
            trabajadorId={trabajador.id}
            contratoVigenteId={vigente?.id}
          />
        </div>
      )}
    </div>
  )
}
