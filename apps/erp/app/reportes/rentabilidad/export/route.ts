import { crearClienteServidor } from '@suite/auth/server'
import { filasACsv, formatearPatente, rangoDeMes } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'

export async function GET(req: Request) {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return new Response('No autorizado', { status: 401 })
  // Paridad con la página: módulo apagado → 404 (misma condición que su notFound()).
  if (!activa.modulo_transporte) return new Response('No encontrado', { status: 404 })
  const mes = new URL(req.url).searchParams.get('mes') ?? new Date().toISOString().slice(0, 7)
  const rango = rangoDeMes(mes)
  if (!rango) return new Response('Mes inválido (use YYYY-MM)', { status: 400 })
  const supabase = await crearClienteServidor()
  const [{ data, error }, { data: vehiculos, error: errorVehiculos }] = await Promise.all([
    supabase
      .from('rentabilidad_vehiculo')
      .select('vehiculo_id, ingresos, combustible, gastos')
      .eq('empresa_id', activa.id)
      .gte('mes', rango.desde)
      .lte('mes', rango.hasta),
    supabase.from('vehiculos').select('id, patente, descripcion').eq('empresa_id', activa.id),
  ])
  if (error || errorVehiculos) return new Response('No se pudo generar el reporte', { status: 500 })
  const etiqueta = new Map(
    (vehiculos ?? []).map((v) => [v.id, formatearPatente(v.patente) + (v.descripcion ? ` — ${v.descripcion}` : '')])
  )
  const filas = (data ?? [])
    .map((f) => {
      const ingresos = Number(f.ingresos ?? 0)
      const combustible = Number(f.combustible ?? 0)
      const gastos = Number(f.gastos ?? 0)
      return {
        vehiculo: f.vehiculo_id === null ? 'Sin asignar' : etiqueta.get(f.vehiculo_id) ?? '—',
        sinAsignar: f.vehiculo_id === null,
        ingresos,
        combustible,
        gastos,
        margen: ingresos - combustible - gastos,
      }
    })
    .sort((a, b) => Number(a.sinAsignar) - Number(b.sinAsignar) || a.vehiculo.localeCompare(b.vehiculo, 'es'))
  const csv = filasACsv(
    ['Vehículo', 'Ingresos', 'Combustible', 'Gastos', 'Margen', 'Margen %'],
    filas.map((f) => [
      f.vehiculo,
      f.ingresos,
      f.combustible,
      f.gastos,
      f.margen,
      f.ingresos === 0 ? null : Math.round((f.margen / f.ingresos) * 1000) / 10,
    ])
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="rentabilidad-${mes}.csv"`,
    },
  })
}
