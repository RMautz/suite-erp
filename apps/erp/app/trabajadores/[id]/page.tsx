import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { calcularVacaciones, formatearCLP, formatearRut } from '@suite/core'
import { Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { BotonEliminarCosto } from '../../../componentes/boton-eliminar-costo'
import { FormularioContrato } from '../../../componentes/formulario-contrato'
import { FormularioTrabajador } from '../../../componentes/formulario-trabajador'
import { FormularioVacaciones } from '../../../componentes/formulario-vacaciones'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { eliminarVacaciones, guardarContrato, guardarTrabajador, registrarVacaciones } from '../acciones'
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

interface Toma {
  id: string
  desde: string
  hasta: string
  dias_habiles: number
  comentario: string | null
}

const fmtFecha = (f: string | null) =>
  f ? new Date(f + 'T00:00:00').toLocaleDateString('es-CL') : '—'

const fmtDias = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 2 })

export default async function FichaTrabajador({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  // Escritura de ficha, contratos y vacaciones: solo dueno/admin. Contador:
  // TODO en solo lectura (los formularios ni se montan). Vendedor/bodeguero:
  // RLS por rol → 0 filas → notFound() de abajo. UX; la seguridad es RLS.
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

  const { data: tomasData } = await supabase
    .from('vacaciones_tomadas')
    .select('id, desde, hasta, dias_habiles, comentario')
    .eq('empresa_id', activa.id)
    .eq('trabajador_id', id)
    .order('desde', { ascending: false })
  const tomas = (tomasData ?? []) as Toma[]
  const totalTomados = tomas.reduce((s, t) => s + t.dias_habiles, 0)

  // PRIMER contrato = fecha_inicio más antigua: continuidad laboral entre
  // contratos consecutivos del mismo trabajador (spec §2.4).
  const primerContrato = contratos.length
    ? contratos.reduce((min, c) => (c.fecha_inicio < min.fecha_inicio ? c : min))
    : undefined
  const hoy = new Date().toISOString().slice(0, 10)
  // Costura Task 6: con finiquito no-anulado el devengo corta en su
  // fecha_termino; mientras la emisión no exista (Task 6) se devenga a hoy.
  const vac = primerContrato
    ? calcularVacaciones(primerContrato.fecha_inicio, hoy, totalTomados)
    : null

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
            nombres: trabajador.nombres ?? '',
            apellido_paterno: trabajador.apellido_paterno ?? '',
            apellido_materno: trabajador.apellido_materno ?? '',
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

      <h2 className="mb-2 mt-8 text-lg font-semibold text-slate-800">Vacaciones</h2>
      {vac && primerContrato ? (
        <>
          <Tarjeta className="mb-4 max-w-2xl">
            <dl className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="font-medium text-slate-700">Devengados</dt>
                <dd className="text-lg font-semibold">{fmtDias(vac.devengados)}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">Tomados</dt>
                <dd className="text-lg font-semibold">{fmtDias(totalTomados)}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">Saldo</dt>
                <dd className={`text-lg font-semibold ${vac.saldo < 0 ? 'text-red-600' : ''}`}>
                  {fmtDias(vac.saldo)}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-slate-500">
              Devengo desde el {fmtFecha(primerContrato.fecha_inicio)} (primer contrato), 1,25 días
              hábiles por mes completo.
            </p>
            {vac.saldo > 30 && (
              <p className="mt-3 text-sm font-medium text-red-600">
                El saldo supera los 30 días: la ley permite acumular como máximo 2 períodos.
              </p>
            )}
            {vac.saldo < 0 && (
              <p className="mt-3 text-sm font-medium text-red-600">
                El saldo es negativo: el trabajador tomó más días de los devengados.
              </p>
            )}
          </Tarjeta>

          <Tabla>
            <thead>
              <tr>
                <Th>Desde</Th>
                <Th>Hasta</Th>
                <Th className="text-right">Días hábiles</Th>
                <Th>Comentario</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {tomas.map((t) => (
                <Tr key={t.id}>
                  <Td>{fmtFecha(t.desde)}</Td>
                  <Td>{fmtFecha(t.hasta)}</Td>
                  <Td className="text-right font-mono">{t.dias_habiles}</Td>
                  <Td>{t.comentario ?? '—'}</Td>
                  <Td className="text-right">
                    {escribe && <BotonEliminarCosto id={t.id} accion={eliminarVacaciones} />}
                  </Td>
                </Tr>
              ))}
              {tomas.length === 0 && (
                <Tr>
                  <Td colSpan={5} className="py-8 text-center text-slate-500">
                    Sin vacaciones registradas todavía.
                  </Td>
                </Tr>
              )}
            </tbody>
          </Tabla>

          {escribe && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-800">Registrar vacaciones</h3>
              <FormularioVacaciones accion={registrarVacaciones} trabajadorId={trabajador.id} />
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-slate-500">
          El devengo de vacaciones parte con el primer contrato del trabajador.
        </p>
      )}
    </div>
  )
}
