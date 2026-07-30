import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import type { IndicadoresPeriodo } from '@suite/core'
import { Encabezado, Tarjeta } from '@suite/ui'
import {
  FormularioLiquidacion,
  type IndicadorGenerar,
  type TrabajadorGenerar,
} from '../../../componentes/formulario-liquidacion'
import { exigirRRHH } from '../../../lib/rrhh-acceso'

export default async function PaginaGenerar() {
  const activa = await exigirRRHH()
  const supabase = await crearClienteServidor()

  const [indicadoresRes, contratosRes, empresaRes] = await Promise.all([
    // Períodos con indicadores existentes (RLS: SELECT authenticated — tabla de plataforma).
    supabase
      .from('indicadores_previsionales')
      .select('periodo, uf, utm, ingreso_minimo, tope_imponible_uf, tope_cesantia_uf, tasa_sis, tasas_afp, tramos_impuesto')
      .order('periodo', { ascending: false })
      .limit(12),
    // Trabajadores con contrato vigente (unique parcial: a lo más uno por trabajador).
    supabase
      .from('contratos')
      .select('tipo, sueldo_base, gratificacion_legal, afp, salud, plan_isapre_uf, cargo, trabajador_id, trabajadores (nombre, rut, activo)')
      .eq('empresa_id', activa.id)
      .eq('vigente', true),
    // Tasa mutual de la EMPRESA activa (spec P19 §2): EmpresaResumen no la trae —
    // consulta puntual a empresas, patrón factor_volumetrico de entregas/nueva.
    supabase.from('empresas').select('tasa_mutual').eq('id', activa.id).single(),
  ])

  // jsonb llega tipado como Json del codegen: cast SOLO de tipo al espejo del §3.
  // tramos_impuesto exige `as unknown as` (TramoImpuesto es interface sin index
  // signature: no solapa con Json — TS2352; precedente asientos/acciones.ts:50).
  const indicadores: IndicadorGenerar[] = (indicadoresRes.data ?? []).map((i) => ({
    periodo: i.periodo,
    datos: {
      uf: i.uf,
      utm: i.utm,
      ingreso_minimo: i.ingreso_minimo,
      tope_imponible_uf: Number(i.tope_imponible_uf),
      tope_cesantia_uf: Number(i.tope_cesantia_uf),
      tasa_sis: Number(i.tasa_sis),
      tasas_afp: i.tasas_afp as Record<string, number>,
      tramos_impuesto: i.tramos_impuesto as unknown as IndicadoresPeriodo['tramos_impuesto'],
    },
  }))

  // Espejo del default de la BD (0026): si la fila no llegara, la vista previa
  // usa el 0,90% base — el servidor snapshotea la tasa REAL al emitir.
  const tasaMutual = Number(empresaRes.data?.tasa_mutual ?? 0.9)

  const trabajadores: TrabajadorGenerar[] = (contratosRes.data ?? [])
    .filter((c) => c.trabajadores?.activo)
    .map((c) => ({
      trabajador_id: c.trabajador_id,
      nombre: c.trabajadores!.nombre,
      rut: c.trabajadores!.rut,
      cargo: c.cargo,
      contrato: {
        tipo: c.tipo as 'indefinido' | 'plazo_fijo',
        sueldo_base: c.sueldo_base,
        gratificacion_legal: c.gratificacion_legal,
        afp: c.afp,
        salud: c.salud as 'fonasa' | 'isapre',
        plan_isapre_uf: c.plan_isapre_uf == null ? null : Number(c.plan_isapre_uf),
      },
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

  if (indicadores.length === 0) {
    return (
      <div>
        <Encabezado titulo="Generar liquidación" />
        <Tarjeta className="max-w-xl">
          <p className="text-slate-600">
            No hay indicadores previsionales cargados. El administrador de la plataforma debe
            crearlos antes de emitir liquidaciones.
          </p>
        </Tarjeta>
      </div>
    )
  }
  if (trabajadores.length === 0) {
    return (
      <div>
        <Encabezado titulo="Generar liquidación" />
        <Tarjeta className="max-w-xl">
          <p className="text-slate-600">
            No hay trabajadores con contrato vigente.{' '}
            <Link className="text-marca-700 hover:underline" href="/trabajadores">
              Crea el trabajador y su contrato
            </Link>{' '}
            antes de emitir la liquidación.
          </p>
        </Tarjeta>
      </div>
    )
  }

  return (
    <div>
      <Encabezado titulo="Generar liquidación" />
      <FormularioLiquidacion trabajadores={trabajadores} indicadores={indicadores} tasaMutual={tasaMutual} />
    </div>
  )
}
