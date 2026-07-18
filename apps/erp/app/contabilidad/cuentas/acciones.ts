'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

export type EstadoCuenta = { error?: string; ok?: boolean }

const TIPOS = ['activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto']

export async function guardarCuenta(_prev: EstadoCuenta, formData: FormData): Promise<EstadoCuenta> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const id = String(formData.get('id') ?? '').trim()
  const codigo = String(formData.get('codigo') ?? '').trim()
  const nombre = String(formData.get('nombre') ?? '').trim()
  const tipo = String(formData.get('tipo') ?? '').trim()
  if (!codigo || !nombre) return { error: 'El código y el nombre son obligatorios' }
  if (!TIPOS.includes(tipo)) return { error: 'Tipo de cuenta no válido' }

  const supabase = await crearClienteServidor()
  // p_id acepta NULL en SQL (crear cuando es null); el codegen no refleja la nulabilidad
  // de argumentos, así que el cast es SOLO de tipo (mismo criterio que cotizaciones/acciones.ts).
  // Los mensajes de la RPC (spec §4.6) son contractuales y pasan por error.message sin reescribir.
  const { error } = await supabase.rpc('guardar_cuenta', {
    p_empresa: activa.id,
    p_id: (id || null) as string,
    p_codigo: codigo,
    p_nombre: nombre,
    p_tipo: tipo,
    p_acepta_movimientos: formData.get('acepta_movimientos') === 'on',
    p_activa: formData.get('activa') === 'on',
  })
  if (error) return { error: error.message }
  revalidatePath('/contabilidad/cuentas')
  return { ok: true }
}
