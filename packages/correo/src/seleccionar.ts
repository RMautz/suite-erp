import { MockCorreo } from './mock'
import { ResendCorreo } from './resend'
import type { ProveedorCorreo } from './tipos'

// Selección por env FAIL-CLOSED (spec §4). A diferencia de pasarelaPorAmbiente de
// packages/pagos (default '?? mock', aceptable por estar gated en credenciales por-empresa),
// aquí un env olvidado NO puede caer a mock: 'mock' → MockCorreo, 'resend' → ResendCorreo
// (exige apiKey Y remitente no vacíos), cualquier otro valor o ausente → THROW. El mensaje
// es el mismo que la action devuelve al usuario; el throw es backstop interno.
const ERROR_NO_CONFIGURADO = 'Proveedor de correo no configurado'

export function correoPorAmbiente(
  perilla: string | undefined,
  apiKey: string | undefined,
  remitente: string | undefined,
): ProveedorCorreo {
  if (perilla === 'mock') return new MockCorreo()
  if (perilla === 'resend') {
    if (!apiKey || !remitente) throw new Error(ERROR_NO_CONFIGURADO)
    return new ResendCorreo(apiKey, remitente)
  }
  throw new Error(ERROR_NO_CONFIGURADO)
}
