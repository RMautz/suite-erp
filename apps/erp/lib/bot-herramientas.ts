import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { HerramientasBot } from '@suite/bot'
import type { Database } from '@suite/db'
import { enviarRecordatorioDocumento, proveedorCorreoConfigurado } from './recordatorio'

// Las 7 herramientas del bot (spec §5): implementacion con el ADMIN client y TODAS
// las queries explicitamente filtradas por la empresa del vinculo (patron webhook MP
// P13). El motor redacta; aqui solo datos tipados.
type Admin = SupabaseClient<Database>

const hoyISO = () => new Date().toISOString().slice(0, 10)

export function herramientasBot(
  admin: Admin,
  empresaId: string,
  empresa: { razonSocial: string; rut: string },
  usuarioId: string,
): HerramientasBot {
  return {
    async ventasHoy() {
      const { data } = await admin
        .from('documentos_venta')
        .select('total')
        .eq('empresa_id', empresaId)
        .eq('estado', 'emitido')
        .in('tipo', ['factura', 'boleta'])
        .gte('emitido_en', hoyISO())
      const filas = data ?? []
      return { total: filas.reduce((s, d) => s + (d.total ?? 0), 0), documentos: filas.length }
    },

    async ventasMes() {
      const primerDia = hoyISO().slice(0, 8) + '01'
      const { data } = await admin
        .from('documentos_venta')
        .select('total')
        .eq('empresa_id', empresaId)
        .eq('estado', 'emitido')
        .in('tipo', ['factura', 'boleta'])
        .gte('emitido_en', primerDia)
      const filas = data ?? []
      return { total: filas.reduce((s, d) => s + (d.total ?? 0), 0), documentos: filas.length }
    },

    async cobranzaVencida() {
      const { data } = await admin
        .from('saldos_documentos')
        .select('cliente_razon_social, saldo')
        .eq('empresa_id', empresaId)
        .gt('saldo', 0)
        .lt('fecha_vencimiento', hoyISO())
      const porCliente = new Map<string, number>()
      let total = 0
      for (const f of data ?? []) {
        const saldo = f.saldo ?? 0
        total += saldo
        const cliente = f.cliente_razon_social ?? '—'
        porCliente.set(cliente, (porCliente.get(cliente) ?? 0) + saldo)
      }
      const deudores = [...porCliente.entries()]
        .map(([cliente, saldo]) => ({ cliente, saldo }))
        .sort((a, b) => b.saldo - a.saldo)
        .slice(0, 5)
      return { total, deudores }
    },

    async stockCritico() {
      // ponytail: "critico" = 5 o menos unidades sumando bodegas; umbral por producto
      // cuando el maestro gane stock_minimo.
      const { data } = await admin
        .from('stock_actual')
        .select('producto_id, cantidad')
        .eq('empresa_id', empresaId)
      const porProducto = new Map<string, number>()
      for (const m of data ?? []) {
        if (!m.producto_id) continue
        porProducto.set(m.producto_id, (porProducto.get(m.producto_id) ?? 0) + (m.cantidad ?? 0))
      }
      const criticos = [...porProducto.entries()]
        .filter(([, cantidad]) => cantidad <= 5)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 5)
      if (criticos.length === 0) return []
      const { data: productos } = await admin
        .from('productos')
        .select('id, nombre')
        .eq('empresa_id', empresaId)
        .in('id', criticos.map(([id]) => id))
      const nombrePorId = new Map((productos ?? []).map((p) => [p.id, p.nombre]))
      return criticos.map(([id, cantidad]) => ({ producto: nombrePorId.get(id) ?? id, cantidad }))
    },

    async semaforoAuditor() {
      const ahora = new Date()
      const { data, error } = await admin.rpc('semaforo_whatsapp', {
        p_empresa: empresaId,
        p_usuario: usuarioId,
        p_anio: ahora.getFullYear(),
        p_mes: ahora.getMonth() + 1,
      })
      if (error || !data) return { estado: 'sin datos', observaciones: [] }
      const payload = data as { estado?: string; observaciones?: { titulo?: string; detalle?: string }[] }
      return {
        estado: payload.estado ?? 'sin datos',
        observaciones: (payload.observaciones ?? []).map((o) => `${o.titulo ?? ''}: ${o.detalle ?? ''}`),
      }
    },

    async saldoCliente(nombre) {
      const limpio = nombre.trim()
      if (!limpio) return null
      const { data: cliente } = await admin
        .from('clientes')
        .select('id, razon_social')
        .eq('empresa_id', empresaId)
        .ilike('razon_social', `%${limpio}%`)
        .order('razon_social')
        .limit(1)
        .maybeSingle()
      if (!cliente) return null
      const { data: saldos } = await admin
        .from('saldos_documentos')
        .select('saldo')
        .eq('empresa_id', empresaId)
        .eq('cliente_id', cliente.id)
      return { cliente: cliente.razon_social, saldo: (saldos ?? []).reduce((s, f) => s + (f.saldo ?? 0), 0) }
    },

    async recordarFactura(folio) {
      const proveedor = proveedorCorreoConfigurado()
      if (!proveedor) return { ok: false, detalle: 'El correo no está configurado' }
      const { data: fila } = await admin
        .from('saldos_documentos')
        .select('documento_id')
        .eq('empresa_id', empresaId)
        .eq('tipo', 'factura')
        .eq('folio', folio)
        .maybeSingle()
      if (!fila?.documento_id) {
        return { ok: false, detalle: `No encontré una factura con folio ${folio} y saldo pendiente.` }
      }
      const resultado = await enviarRecordatorioDocumento(
        admin,
        proveedor,
        { id: empresaId, razonSocial: empresa.razonSocial, rut: empresa.rut },
        fila.documento_id,
      )
      if ('error' in resultado) return { ok: false, detalle: resultado.error }
      return { ok: true, detalle: `Recordatorio enviado a ${resultado.para} por la factura N° ${folio}.` }
    },
  }
}
