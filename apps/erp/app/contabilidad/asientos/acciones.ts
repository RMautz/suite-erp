'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import type { Json } from '@suite/db'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

export type EstadoAsiento = { error?: string }

interface LineaEntrada {
  cuentaId: string
  debe: number
  haber: number
  glosa: string
}

export async function crearAsiento(_prev: EstadoAsiento, formData: FormData): Promise<EstadoAsiento> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const fecha = String(formData.get('fecha') ?? '').trim()
  const glosa = String(formData.get('glosa') ?? '').trim()
  if (!fecha) return { error: 'La fecha es obligatoria' }
  if (!glosa) return { error: 'La glosa es obligatoria' }

  let lineas: LineaEntrada[]
  try {
    lineas = JSON.parse(String(formData.get('lineas') ?? '[]')) as LineaEntrada[]
  } catch {
    return { error: 'No se pudieron leer las líneas del asiento' }
  }

  const supabase = await crearClienteServidor()
  // p_lineas es jsonb en SQL; el codegen lo tipa como Json -> cast SOLO de tipo (mismo
  // criterio que cotizaciones/acciones.ts). Las claves camelCase (`cuentaId`) son el
  // contrato de la RPC (part-2, patrón registrar_pago) — se pasan tal cual, sin re-map.
  // Los montos van clampados a enteros >= 0 (Math.max(0, trunc) — defensa en profundidad;
  // el form ya clampa, la action también). El RPC valida cuadratura/cuentas/montos/rol
  // y sus mensajes (spec §4.3) llegan por error.message sin reescribir.
  const { data, error } = await supabase.rpc('crear_asiento', {
    p_empresa: activa.id,
    p_fecha: fecha,
    p_glosa: glosa,
    p_lineas: lineas.map((l) => ({
      cuentaId: l.cuentaId,
      debe: Math.max(0, Math.trunc(l.debe) || 0),
      haber: Math.max(0, Math.trunc(l.haber) || 0),
      glosa: l.glosa || null,
    })) as unknown as Json,
  })
  if (error) return { error: error.message }
  revalidatePath('/contabilidad/asientos')
  // redirect lanza NEXT_REDIRECT: va FUERA de cualquier try/catch. data = uuid del asiento.
  redirect(`/contabilidad/asientos/${data}`)
}

export async function revertirAsiento(_prev: EstadoAsiento, formData: FormData): Promise<EstadoAsiento> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const asiento = String(formData.get('asiento_id') ?? '')
  const glosa = String(formData.get('glosa') ?? '').trim()
  if (!asiento) return { error: 'Asiento no válido' }
  if (!glosa) return { error: 'Indica el motivo de la reversa' }
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('revertir_asiento', {
    p_empresa: activa.id,
    p_asiento: asiento,
    p_glosa: glosa,
  })
  if (error) return { error: error.message }
  revalidatePath('/contabilidad/asientos')
  redirect(`/contabilidad/asientos/${data}`)
}
