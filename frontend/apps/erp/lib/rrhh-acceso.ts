import 'server-only'
import { notFound } from 'next/navigation'
import { obtenerEmpresaActiva, type EmpresaResumen } from './empresa-activa'

// Roles que ven la sección Personas (spec §2.1: SELECT dueno/admin/contador).
// Es SOLO UX: la seguridad real es la RLS por rol y las RPCs.
export const ROLES_RRHH = ['dueno', 'admin', 'contador'] as const

// Predicado puro para guards y route handlers (patrón puedeVerContabilidad).
export function puedeVerRRHH(activa: EmpresaResumen | null): boolean {
  return activa?.rol != null && (ROLES_RRHH as readonly string[]).includes(activa.rol)
}

// Guard de las pantallas de Personas que exigen rol: sin rol → notFound (misma
// cara que una ruta inexistente; patrón exigirContabilidad).
export async function exigirRRHH(): Promise<EmpresaResumen> {
  const { activa } = await obtenerEmpresaActiva()
  if (!puedeVerRRHH(activa)) notFound()
  return activa as EmpresaResumen
}
