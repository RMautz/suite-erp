import { MercadoPagoPasarela } from './mercadopago'
import { MockPasarela } from './mock'
import { MockWebpay, WebpayPlus } from './webpay'
import type { PasarelaPagos } from './tipos'
import type { PasarelaWebpay } from './webpay'

// Selectores FAIL-CLOSED de suscripciones (spec §4). A diferencia de pasarelaPorAmbiente
// del Plan 13 (default '?? mock', aceptable por estar gated en credenciales por-empresa),
// aqui el dinero es de PLATAFORMA: una env olvidada NO puede caer a mock. 'mock' → mocks,
// 'real' → adaptadores reales, cualquier otro valor o ausente → THROW (los botones muestran
// 'no disponibles'). La perilla PASARELA_SUSCRIPCIONES gobierna los DOS metodos.
const ERROR_NO_CONFIGURADA = 'Pasarela de suscripciones no configurada'

// MP de plataforma: el token descifrado (o el propio access token de plataforma en claro
// desde env) lo inyecta el llamador; este selector solo elige Mock vs real por la perilla.
export function pasarelaSuscripciones(
  perilla: string | undefined,
  tokenDescifrado: string,
): PasarelaPagos {
  if (perilla === 'mock') return new MockPasarela()
  if (perilla === 'real') return new MercadoPagoPasarela(tokenDescifrado)
  throw new Error(ERROR_NO_CONFIGURADA)
}

export function webpaySuscripciones(
  perilla: string | undefined,
  commerceCode: string,
  apiKey: string,
  tbkAmbiente: string | undefined,
): PasarelaWebpay {
  if (perilla === 'mock') return new MockWebpay()
  if (perilla === 'real') {
    // Ambiente FAIL-CLOSED: solo 'integracion' | 'produccion' pasan. Un TBK_AMBIENTE ausente
    // o basura JAMAS cae a integracion por defecto — un olvido en produccion mandaria pagos
    // REALES al ambiente de pruebas de Transbank. El narrowing deja tbkAmbiente como
    // TbkAmbiente exacto para el ctor (que queda tipado estricto).
    if (tbkAmbiente !== 'integracion' && tbkAmbiente !== 'produccion') {
      throw new Error(ERROR_NO_CONFIGURADA)
    }
    return new WebpayPlus(commerceCode, apiKey, tbkAmbiente)
  }
  throw new Error(ERROR_NO_CONFIGURADA)
}
