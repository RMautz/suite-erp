import { clienteAdmin } from '@suite/auth/admin'
import { formatearCLP } from '@suite/core'
import { Boton, Campo, Encabezado, Entrada, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { verificarAdmin } from '../../lib/guardia'
import { guardarPeriodo } from './acciones'
import { AFPS, NOMBRES_AFP } from './afps'

type Tramo = { desde_utm: number; hasta_utm: number | null; factor: number; rebaja_utm: number }
type Periodo = {
  periodo: string
  uf: number
  utm: number
  ingreso_minimo: number
  tope_imponible_uf: number
  tope_cesantia_uf: number
  tasas_afp: Record<string, number>
  tramos_impuesto: Tramo[]
}

const num = (v: number) => v.toLocaleString('es-CL')

// '2026-07' → '2026-08' (sugerencia del formulario de período nuevo).
// Defaults en el destructuring: bajo noUncheckedIndexedAccess los elementos
// son number | undefined (el pattern del input garantiza el formato real).
function periodoSiguiente(p: string): string {
  const [a = 0, m = 0] = p.split('-').map(Number)
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`
}

function FormPeriodo({ base, nuevo }: { base: Periodo; nuevo: boolean }) {
  return (
    <form action={guardarPeriodo} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Campo etiqueta="Período (YYYY-MM)">
          <Entrada
            name="periodo"
            defaultValue={nuevo ? periodoSiguiente(base.periodo) : base.periodo}
            readOnly={!nuevo}
            required
            pattern="\d{4}-(0[1-9]|1[0-2])"
            className={nuevo ? undefined : 'bg-slate-100'}
          />
        </Campo>
        <Campo etiqueta="UF (CLP, último día del mes)">
          <Entrada name="uf" type="number" min={1} step={1} defaultValue={base.uf} required />
        </Campo>
        <Campo etiqueta="UTM (CLP)">
          <Entrada name="utm" type="number" min={1} step={1} defaultValue={base.utm} required />
        </Campo>
        <Campo etiqueta="Ingreso mínimo (CLP)">
          <Entrada name="ingreso_minimo" type="number" min={1} step={1} defaultValue={base.ingreso_minimo} required />
        </Campo>
        <Campo etiqueta="Tope imponible (UF)">
          <Entrada name="tope_imponible_uf" type="number" min={0.1} step={0.1} defaultValue={base.tope_imponible_uf} required />
        </Campo>
        <Campo etiqueta="Tope cesantía (UF)">
          <Entrada name="tope_cesantia_uf" type="number" min={0.1} step={0.1} defaultValue={base.tope_cesantia_uf} required />
        </Campo>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Tasas AFP (% total con comisión)</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {AFPS.map((a) => (
            <Campo key={a} etiqueta={NOMBRES_AFP[a] ?? a}>
              <Entrada name={'tasa_' + a} type="number" min={0.01} step={0.01} defaultValue={base.tasas_afp[a]} required />
            </Campo>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">
          Tramos del impuesto único (mensual; desde/hasta y rebaja en UTM — el jsonb se arma en el servidor)
        </p>
        <div className="space-y-2">
          {base.tramos_impuesto.map((t, i) => (
            <div key={i} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Campo etiqueta={`Tramo ${i + 1} · desde (UTM)`}>
                <Entrada name={`tramo_${i}_desde`} type="number" min={0} step={0.01} defaultValue={t.desde_utm} required />
              </Campo>
              <Campo etiqueta="Hasta (UTM; vacío = sin tope, solo el último)">
                <Entrada name={`tramo_${i}_hasta`} type="number" min={0} step={0.01} defaultValue={t.hasta_utm ?? ''} />
              </Campo>
              <Campo etiqueta="Factor (0 a 1)">
                <Entrada name={`tramo_${i}_factor`} type="number" min={0} max={1} step={0.001} defaultValue={t.factor} required />
              </Campo>
              <Campo etiqueta="Rebaja (UTM)">
                <Entrada name={`tramo_${i}_rebaja`} type="number" min={0} step={0.01} defaultValue={t.rebaja_utm} required />
              </Campo>
            </div>
          ))}
        </div>
      </div>
      <Boton type="submit">{nuevo ? 'Crear período' : 'Guardar cambios'}</Boton>
    </form>
  )
}

export default async function PaginaIndicadores() {
  await verificarAdmin()
  const admin = clienteAdmin()
  const { data, error } = await admin
    .from('indicadores_previsionales')
    .select('*')
    .order('periodo', { ascending: false })
  if (error) throw new Error('No se pudieron cargar los indicadores previsionales')
  const periodos = (data ?? []).map((p) => ({
    ...p,
    tasas_afp: p.tasas_afp as Record<string, number>,
    tramos_impuesto: p.tramos_impuesto as Tramo[],
  })) as Periodo[]
  // Solo se usa en la rama con períodos (length > 0 garantizado por el ternario);
  // el ! evita el undefined de noUncheckedIndexedAccess.
  const reciente = periodos[0]!

  return (
    <div className="space-y-6">
      <Encabezado titulo="Indicadores previsionales" />
      {periodos.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
          No hay períodos cargados: los siembra la migración 0025. Corre las migraciones antes de usar esta sección.
        </p>
      ) : (
        <>
          <Tabla>
            <thead>
              <Tr>
                <Th>Período</Th>
                <Th>UF</Th>
                <Th>UTM</Th>
                <Th>Ingreso mínimo</Th>
                <Th>Topes imp./ces. (UF)</Th>
                <Th>Tasas AFP</Th>
                <Th>Impuesto único</Th>
              </Tr>
            </thead>
            <tbody>
              {periodos.map((p) => (
                <Tr key={p.periodo}>
                  <Td className="font-medium tabular-nums text-slate-900">{p.periodo}</Td>
                  <Td className="tabular-nums">{formatearCLP(p.uf)}</Td>
                  <Td className="tabular-nums">{formatearCLP(p.utm)}</Td>
                  <Td className="tabular-nums">{formatearCLP(p.ingreso_minimo)}</Td>
                  <Td className="tabular-nums">
                    {num(p.tope_imponible_uf)} / {num(p.tope_cesantia_uf)}
                  </Td>
                  <Td className="text-xs">{AFPS.map((a) => `${NOMBRES_AFP[a]} ${num(p.tasas_afp[a] ?? 0)}%`).join(' · ')}</Td>
                  <Td className="text-xs">
                    {p.tramos_impuesto.length} tramos · exento hasta {num(p.tramos_impuesto[0]?.hasta_utm ?? 0)} UTM
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Tabla>

          <section className="space-y-3">
            <h2 className="text-sm font-medium text-slate-600">Editar un período</h2>
            {periodos.map((p) => (
              <details key={p.periodo} className="rounded-lg border border-slate-200 bg-white">
                <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-slate-800">{p.periodo}</summary>
                <div className="border-t border-slate-100 px-5 py-4">
                  <FormPeriodo base={p} nuevo={false} />
                </div>
              </details>
            ))}
          </section>

          <Tarjeta>
            <h2 className="mb-3 text-sm font-medium text-slate-600">
              Nuevo período (valores precargados del más reciente: {reciente.periodo})
            </h2>
            <FormPeriodo base={reciente} nuevo />
          </Tarjeta>
        </>
      )}
    </div>
  )
}
