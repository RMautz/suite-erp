import { ClaudeMotor } from './claude'
import { MockMotor } from './mock'
import type { MotorBot } from './tipos'

// Seleccion por env FAIL-CLOSED (patron correoPorAmbiente P10): 'mock' -> MockMotor,
// 'claude' -> ClaudeMotor (exige apiKey; modelo por MOTOR_BOT_MODELO con default
// claude-sonnet-5). Cualquier otro valor o ausente -> THROW. Sin `?? 'mock'`.
const ERROR_NO_CONFIGURADO = 'El motor del bot no está configurado'

export function motorPorAmbiente(
  perilla: string | undefined,
  apiKey: string | undefined,
  modelo: string | undefined,
): MotorBot {
  if (perilla === 'mock') return new MockMotor()
  if (perilla === 'claude') {
    if (!apiKey) throw new Error(ERROR_NO_CONFIGURADO)
    return new ClaudeMotor(apiKey, modelo || 'claude-sonnet-5')
  }
  throw new Error(ERROR_NO_CONFIGURADO)
}
