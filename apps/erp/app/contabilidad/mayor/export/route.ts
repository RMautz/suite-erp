import { crearClienteServidor } from '@suite/auth/server'
import { filasACsv, rangoDeMes } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'

interface LineaMayor {
  debe: number
  haber: number
  glosa: string | null
}
interface AsientoMayor {
  numero: number
  fecha: string
  glosa: string
  asientos_lineas: LineaMayor[]
}

export async function GET(req: Request) {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return new Response('No autorizado', { status: 401 })
  if (!activa.modulo_contabilidad) return new Response('No encontrado', { status: 404 })
  // Guard de rol EXPLÍCITO (lección P12): rol sin permiso → 403, jamás un CSV vacío.
  // El rol YA viene en EmpresaResumen (task de UI) — se reusa sin re-consultar miembros.
  if (!activa.rol || !['dueno', 'admin', 'contador'].includes(activa.rol)) {
    return new Response('No autorizado', { status: 403 })
  }

  const supabase = await crearClienteServidor()
  const url = new URL(req.url)
  const cuentaId = url.searchParams.get('cuenta')
  if (!cuentaId) return new Response('Falta la cuenta (use ?cuenta=<id>)', { status: 400 })
  // La cuenta debe pertenecer a la empresa (RLS ya lo cubre; el chequeo evita un CSV
  // vacío silencioso cuando el id es de otra empresa).
  const { data: cuenta } = await supabase
    .from('cuentas_contables')
    .select('codigo, nombre')
    .eq('empresa_id', activa.id)
    .eq('id', cuentaId)
    .maybeSingle()
  if (!cuenta) return new Response('Cuenta no encontrada', { status: 404 })

  const base = rangoDeMes(new Date().toISOString().slice(0, 7))!
  const qDesde = url.searchParams.get('desde')
  const qHasta = url.searchParams.get('hasta')
  const desde = qDesde && /^\d{4}-\d{2}-\d{2}$/.test(qDesde) ? qDesde : base.desde
  const hasta = qHasta && /^\d{4}-\d{2}-\d{2}$/.test(qHasta) ? qHasta : base.hasta

  const { data: previos } = await supabase
    .from('asientos')
    .select('asientos_lineas!inner (debe, haber, cuenta_id)')
    .eq('empresa_id', activa.id)
    .eq('asientos_lineas.cuenta_id', cuentaId)
    .lt('fecha', desde)
  let saldoInicial = 0
  for (const a of (previos ?? []) as { asientos_lineas: { debe: number; haber: number }[] }[]) {
    for (const l of a.asientos_lineas) saldoInicial += l.debe - l.haber
  }

  const { data, error } = await supabase
    .from('asientos')
    .select('numero, fecha, glosa, asientos_lineas!inner (debe, haber, glosa, cuenta_id)')
    .eq('empresa_id', activa.id)
    .eq('asientos_lineas.cuenta_id', cuentaId)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha')
    .order('numero')
  if (error) return new Response('No se pudo generar el mayor', { status: 500 })

  let corriente = saldoInicial
  const filas: (string | number | null)[][] = [['', '', 'Saldo inicial', null, null, saldoInicial]]
  for (const a of (data ?? []) as AsientoMayor[]) {
    for (const l of a.asientos_lineas) {
      corriente += l.debe - l.haber
      filas.push([a.fecha, a.numero, l.glosa ?? a.glosa, l.debe, l.haber, corriente])
    }
  }
  const csv = filasACsv(['Fecha', 'N° asiento', 'Glosa', 'Debe', 'Haber', 'Saldo acumulado'], filas)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="libro-mayor-${cuenta.codigo}-${desde}_${hasta}.csv"`,
    },
  })
}
