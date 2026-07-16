import 'server-only'
import { cookies } from 'next/headers'
import { crearClienteServidor } from '@suite/auth/server'

export const COOKIE_EMPRESA = 'empresa_activa'

export interface EmpresaResumen {
  id: string
  organizacion_id: string
  rut: string
  razon_social: string
  modulo_transporte: boolean
}

export async function obtenerEmpresas(): Promise<EmpresaResumen[]> {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('empresas')
    .select('id, organizacion_id, rut, razon_social, modulo_transporte')
    .order('razon_social')
  if (error) throw new Error('No se pudieron cargar tus empresas')
  return data ?? []
}

export async function obtenerEmpresaActiva(): Promise<{
  activa: EmpresaResumen | null
  empresas: EmpresaResumen[]
}> {
  const empresas = await obtenerEmpresas()
  const almacen = await cookies()
  const id = almacen.get(COOKIE_EMPRESA)?.value
  const activa = empresas.find((e) => e.id === id) ?? empresas[0] ?? null
  return { activa, empresas }
}
