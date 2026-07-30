import 'server-only'
import { notFound } from 'next/navigation'
import { obtenerEmpresaActiva, type EmpresaResumen } from './empresa-activa'

// Roles que ven y operan contabilidad (spec §2). vendedor/bodeguero NO.
export const ROLES_CONTABLES = ['dueno', 'admin', 'contador'] as const

// Predicado puro para el NAV (layout) y los guards. Es SOLO UX: la seguridad real
// vive en la RLS por rol de asientos/cuentas y en las RPCs; esto oculta el link y
// devuelve notFound en las pantallas.
export function puedeVerContabilidad(activa: EmpresaResumen | null): boolean {
  return (
    !!activa?.modulo_contabilidad &&
    activa.rol !== null &&
    (ROLES_CONTABLES as readonly string[]).includes(activa.rol)
  )
}

// Guard de todas las pantallas de /contabilidad: sin módulo o sin rol -> notFound
// (misma cara que una ruta inexistente). Devuelve la empresa activa ya validada.
export async function exigirContabilidad(): Promise<EmpresaResumen> {
  const { activa } = await obtenerEmpresaActiva()
  if (!puedeVerContabilidad(activa)) notFound()
  return activa as EmpresaResumen
}
