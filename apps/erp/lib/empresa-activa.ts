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
  modulo_contabilidad: boolean
  rol: string | null
}

export async function obtenerEmpresas(): Promise<EmpresaResumen[]> {
  const supabase = await crearClienteServidor()
  const [empresasRes, usuarioRes] = await Promise.all([
    supabase
      .from('empresas')
      .select('id, organizacion_id, rut, razon_social, modulo_transporte, modulo_contabilidad')
      .order('razon_social'),
    supabase.auth.getUser(),
  ])
  if (empresasRes.error) throw new Error('No se pudieron cargar tus empresas')
  const empresas = empresasRes.data ?? []

  // Rol del usuario POR organización (UNA consulta a miembros, no N): el NAV y los
  // guards de /contabilidad necesitan saber si es dueno/admin/contador. Un vendedor
  // ve sus empresas pero con rol 'vendedor' -> sin acceso al módulo contable.
  let rolPorOrg = new Map<string, string>()
  const usuario = usuarioRes.data.user
  if (usuario) {
    const { data: miembros } = await supabase
      .from('miembros')
      .select('organizacion_id, rol')
      .eq('usuario_id', usuario.id)
      .eq('estado', 'activo')
    rolPorOrg = new Map((miembros ?? []).map((m) => [m.organizacion_id, m.rol] as const))
  }

  return empresas.map((e) => ({ ...e, rol: rolPorOrg.get(e.organizacion_id) ?? null }))
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
