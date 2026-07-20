import type { ContextoBot, HerramientasBot, MotorBot } from './tipos'

// Motor IA real (spec §3): Anthropic Messages API via fetch INYECTABLE (sin SDK,
// decision del spec). Las 7 herramientas van como tools tipadas; maximo 5 rondas de
// tool-use; si la API falla o se agotan las rondas -> DISCULPA (nunca-lanza hacia el
// webhook). A logs SOLO error.message: jamas la apiKey.
export const DISCULPA_BOT = 'Perdona, tuve un problema para responderte. Intenta de nuevo en unos minutos.'

const URL_ANTHROPIC = 'https://api.anthropic.com/v1/messages'
const SIN_PARAMETROS = { type: 'object' as const, properties: {}, additionalProperties: false }

const TOOLS = [
  { name: 'ventas_hoy', description: 'Total de ventas de hoy (documentos emitidos) de la empresa.', input_schema: SIN_PARAMETROS },
  { name: 'ventas_mes', description: 'Total de ventas del mes en curso de la empresa.', input_schema: SIN_PARAMETROS },
  { name: 'cobranza_vencida', description: 'Total vencido por cobrar y top 5 deudores.', input_schema: SIN_PARAMETROS },
  { name: 'stock_critico', description: 'Productos con stock critico (5 o menos unidades).', input_schema: SIN_PARAMETROS },
  { name: 'semaforo_auditor', description: 'Estado del semaforo del Contador Auditor del mes y sus observaciones.', input_schema: SIN_PARAMETROS },
  {
    name: 'saldo_cliente',
    description: 'Saldo por cobrar de UN cliente buscado por nombre parcial.',
    input_schema: { type: 'object' as const, properties: { nombre: { type: 'string', description: 'Nombre o parte del nombre del cliente' } }, required: ['nombre'], additionalProperties: false },
  },
  {
    name: 'recordar_factura',
    description: 'Envia el recordatorio de pago por correo de UNA factura vencida (unica accion disponible).',
    input_schema: { type: 'object' as const, properties: { folio: { type: 'integer', description: 'Folio de la factura' } }, required: ['folio'], additionalProperties: false },
  },
]

type BloqueContenido =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

interface RespuestaMensajes {
  content: BloqueContenido[]
  stop_reason: string
}

async function ejecutarHerramienta(t: HerramientasBot, nombre: string, input: Record<string, unknown>): Promise<unknown> {
  switch (nombre) {
    case 'ventas_hoy':
      return t.ventasHoy()
    case 'ventas_mes':
      return t.ventasMes()
    case 'cobranza_vencida':
      return t.cobranzaVencida()
    case 'stock_critico':
      return t.stockCritico()
    case 'semaforo_auditor':
      return t.semaforoAuditor()
    case 'saldo_cliente':
      return t.saldoCliente(String(input.nombre ?? ''))
    case 'recordar_factura':
      return t.recordarFactura(Number(input.folio ?? 0))
    default:
      return { error: `Herramienta desconocida: ${nombre}` }
  }
}

function promptSistema(ctx: ContextoBot): string {
  return (
    `Eres el asistente por WhatsApp del ERP de ${ctx.nombreEmpresa}. Hablas con su ${ctx.rol} ` +
    'en español de Chile. Respondes SOLO con datos de SU empresa obtenidos con las herramientas; ' +
    'JAMÁS inventes cifras ni hables de otras empresas. Respuestas cortas, estilo WhatsApp, sin ' +
    'markdown. Si te piden algo fuera de las herramientas, dilo con amabilidad.'
  )
}

export class ClaudeMotor implements MotorBot {
  constructor(
    private readonly apiKey: string,
    private readonly modelo: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async responder(ctx: ContextoBot, mensaje: string): Promise<string> {
    try {
      const mensajes: unknown[] = ctx.historial.map((t) => ({
        role: t.direccion === 'entrante' ? 'user' : 'assistant',
        content: t.contenido,
      }))
      mensajes.push({ role: 'user', content: mensaje })

      for (let ronda = 0; ronda < 5; ronda++) {
        const res = await this.fetchFn(URL_ANTHROPIC, {
          method: 'POST',
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: this.modelo,
            max_tokens: 1024,
            system: promptSistema(ctx),
            tools: TOOLS,
            messages: mensajes,
          }),
        })
        if (!res.ok) throw new Error(`Anthropic respondió ${res.status}`)
        const data = (await res.json()) as RespuestaMensajes

        if (data.stop_reason === 'tool_use') {
          mensajes.push({ role: 'assistant', content: data.content })
          const resultados: unknown[] = []
          for (const bloque of data.content) {
            if (bloque.type !== 'tool_use') continue
            resultados.push({
              type: 'tool_result',
              tool_use_id: bloque.id,
              content: JSON.stringify(await ejecutarHerramienta(ctx.herramientas, bloque.name, bloque.input)),
            })
          }
          mensajes.push({ role: 'user', content: resultados })
          continue
        }

        const texto = data.content
          .filter((b): b is Extract<BloqueContenido, { type: 'text' }> => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim()
        return texto || DISCULPA_BOT
      }
      // 5 rondas de tool-use sin respuesta final: se corta con la disculpa.
      return DISCULPA_BOT
    } catch (error) {
      console.error('ClaudeMotor:', error instanceof Error ? error.message : 'error desconocido')
      return DISCULPA_BOT
    }
  }
}
