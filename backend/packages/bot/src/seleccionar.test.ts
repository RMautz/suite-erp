import { describe, expect, it } from 'vitest'
import { ClaudeMotor } from './claude'
import { MockMotor } from './mock'
import { motorPorAmbiente } from './seleccionar'

describe('motorPorAmbiente (fail-closed)', () => {
  it("'mock' construye MockMotor y 'claude' con key construye ClaudeMotor (modelo default)", () => {
    expect(motorPorAmbiente('mock', undefined, undefined)).toBeInstanceOf(MockMotor)
    expect(motorPorAmbiente('claude', 'KEY', undefined)).toBeInstanceOf(ClaudeMotor)
    expect(motorPorAmbiente('claude', 'KEY', 'claude-opus-4-8')).toBeInstanceOf(ClaudeMotor)
  })

  it('perilla ausente/desconocida o claude sin key lanza — JAMÁS cae a mock', () => {
    expect(() => motorPorAmbiente(undefined, 'KEY', undefined)).toThrow('El motor del bot no está configurado')
    expect(() => motorPorAmbiente('gpt', 'KEY', undefined)).toThrow('El motor del bot no está configurado')
    expect(() => motorPorAmbiente('claude', undefined, undefined)).toThrow('El motor del bot no está configurado')
    expect(() => motorPorAmbiente('claude', '', undefined)).toThrow('El motor del bot no está configurado')
  })
})
