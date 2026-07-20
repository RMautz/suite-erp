import { describe, expect, it, vi } from 'vitest'
import { ClaudeMotor, DISCULPA_BOT } from './claude'
import type { ContextoBot, HerramientasBot } from './tipos'

function herramientasFake(): HerramientasBot {
  return {
    ventasHoy: vi.fn(async () => ({ total: 500000, documentos: 2 })),
    ventasMes: vi.fn(async () => ({ total: 0, documentos: 0 })),
    cobranzaVencida: vi.fn(async () => ({ total: 0, deudores: [] })),
    stockCritico: vi.fn(async () => []),
    semaforoAuditor: vi.fn(async () => ({ estado: 'ok', observaciones: [] })),
    saldoCliente: vi.fn(async () => null),
    recordarFactura: vi.fn(async () => ({ ok: true, detalle: 'x' })),
  }
}

function ctx(herramientas: HerramientasBot): ContextoBot {
  return {
    nombreEmpresa: 'Demo Transportes SpA',
    rol: 'dueno',
    historial: [{ direccion: 'entrante', contenido: 'hola' }, { direccion: 'saliente', contenido: 'Hola!' }],
    herramientas,
  }
}

function respuesta(json: unknown): { ok: true; status: 200; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: async () => json }
}

describe('ClaudeMotor.responder', () => {
  it('resuelve una ronda de tool_use y devuelve el texto final', async () => {
    const t = herramientasFake()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        respuesta({
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'tu-1', name: 'ventas_hoy', input: {} }],
        }),
      )
      .mockResolvedValueOnce(
        respuesta({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hoy llevas $500.000 en 2 documentos.' }] }),
      )
    const motor = new ClaudeMotor('KEY', 'claude-sonnet-5', fetchMock as unknown as typeof fetch)

    const salida = await motor.responder(ctx(t), 'cuánto vendí hoy?')

    expect(salida).toBe('Hoy llevas $500.000 en 2 documentos.')
    expect(t.ventasHoy).toHaveBeenCalledTimes(1)
    const segundoBody = JSON.parse((fetchMock.mock.calls[1] as unknown as [string, { body: string }])[1].body)
    const ultimoMensaje = segundoBody.messages.at(-1)
    expect(ultimoMensaje.role).toBe('user')
    expect(ultimoMensaje.content[0].type).toBe('tool_result')
    expect(ultimoMensaje.content[0].tool_use_id).toBe('tu-1')
  })

  it('arma el request correcto: url, headers de Anthropic, modelo, system, tools e historial', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }))
    await new ClaudeMotor('KEY-123', 'claude-sonnet-5', fetchMock as unknown as typeof fetch).responder(ctx(herramientasFake()), 'hola')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['x-api-key']).toBe('KEY-123')
    expect(init.headers['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('claude-sonnet-5')
    expect(body.system).toContain('Demo Transportes SpA')
    expect(body.tools).toHaveLength(7)
    expect(body.messages).toHaveLength(3)
    expect(body.messages[0]).toEqual({ role: 'user', content: 'hola' })
    expect(body.messages[1]).toEqual({ role: 'assistant', content: 'Hola!' })
  })

  it('error de API devuelve la disculpa sin lanzar y sin filtrar la key', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 529, json: async () => ({}) })
    const salida = await new ClaudeMotor('KEY-SECRETA', 'claude-sonnet-5', fetchMock as unknown as typeof fetch).responder(
      ctx(herramientasFake()),
      'hola',
    )
    expect(salida).toBe(DISCULPA_BOT)
    const loggeado = errSpy.mock.calls.flat().join(' ')
    expect(loggeado).toContain('529')
    expect(loggeado).not.toContain('KEY-SECRETA')
    errSpy.mockRestore()
  })
})
