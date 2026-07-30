import { MercadoPagoPasarela } from './mercadopago'
import { MockPasarela } from './mock'
import type { PasarelaPagos } from './tipos'

// Selección por env (patrón de proveedorPorAmbiente en @suite/dte). 'mock' opera
// sin credenciales; 'mercadopago' liga la pasarela al token de la empresa que
// llega YA descifrado (el descifrado vive en el helper de app pasarelaParaEmpresa
// de apps/erp/lib/pagos.ts, espejo de credencialesEmpresa). El ambiente lo pasa
// el llamador (process.env.PASARELA_PAGOS). Env desconocida → error claro.
export function pasarelaPorAmbiente(ambiente: string | undefined, tokenDescifrado: string): PasarelaPagos {
  const pasarela = ambiente ?? 'mock'
  if (pasarela === 'mock') return new MockPasarela()
  if (pasarela !== 'mercadopago') {
    throw new Error(`Pasarela de pagos desconocida: ${pasarela}`)
  }
  return new MercadoPagoPasarela(tokenDescifrado)
}
