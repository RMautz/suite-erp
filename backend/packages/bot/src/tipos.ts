// Las 7 herramientas del bot (spec §3): interface tipada que implementa el ERP
// (apps/erp/lib/bot-herramientas.ts) con el admin client scoped a la empresa del
// vinculo. El package NO depende de supabase: recibe datos, el motor redacta.
export interface HerramientasBot {
  ventasHoy(): Promise<{ total: number; documentos: number }>
  ventasMes(): Promise<{ total: number; documentos: number }>
  cobranzaVencida(): Promise<{ total: number; deudores: { cliente: string; saldo: number }[] }>
  stockCritico(): Promise<{ producto: string; cantidad: number }[]>
  semaforoAuditor(): Promise<{ estado: string; observaciones: string[] }>
  saldoCliente(nombre: string): Promise<{ cliente: string; saldo: number } | null>
  // Accion (spec §3): dispara el recordatorio de cobranza P10 por correo.
  recordarFactura(folio: number): Promise<{ ok: boolean; detalle: string }>
  // Accion (spec tickets 2026-07-22): crea un ticket a administracion de la
  // plataforma (mismo ticket que /consultas de la web) y avisa por correo.
  crearTicket(asunto: string, mensaje: string): Promise<{ numero: number }>
}

export interface TurnoHistorial {
  direccion: 'entrante' | 'saliente'
  contenido: string
}

export interface ContextoBot {
  nombreEmpresa: string
  rol: string
  historial: TurnoHistorial[]
  herramientas: HerramientasBot
}

export interface MotorBot {
  responder(ctx: ContextoBot, mensaje: string): Promise<string>
}
