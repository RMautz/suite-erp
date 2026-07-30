import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { estaVencido, formatearCLP, formatearNumeroProforma } from '@suite/core'
import { Boton, Encabezado, Insignia, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { BotonRecordar, BotonRecordarTodas } from '../../componentes/boton-enviar-correo'
import { BotonWhatsApp } from '../../componentes/boton-whatsapp'
import { FormularioAplicarAnticipo } from '../../componentes/formulario-aplicar-anticipo'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { aplicarAnticipoManual } from './acciones'
import { enviarRecordatorio, enviarRecordatorios } from '../correo/acciones'
import { recordarPorWhatsApp } from './acciones-whatsapp'

const HOY = () => new Date().toISOString().slice(0, 10)

export default async function PaginaCobranza({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; vencidas?: string }>
}) {
  const { cliente = '', vencidas = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: clientes }, consultaSaldos] = await Promise.all([
    supabase.from('clientes').select('id, razon_social, telefono').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
    (() => {
      let q = supabase
        .from('saldos_documentos')
        .select('documento_id, tipo, folio, cliente_id, cliente_razon_social, total, emitido_en, fecha_vencimiento, pagado, notas_credito, saldo')
        .eq('empresa_id', activa.id)
        .neq('saldo', 0)
        .order('fecha_vencimiento', { ascending: true })
        .limit(200)
      if (cliente) q = q.eq('cliente_id', cliente)
      return q
    })(),
  ])
  const hoy = HOY()
  let filas = consultaSaldos.data ?? []
  const telefonoPorCliente = new Map((clientes ?? []).map((c) => [c.id, c.telefono]))
  if (vencidas === '1') filas = filas.filter((f) => estaVencido(f.fecha_vencimiento, hoy, f.saldo ?? 0))
  const porCobrar = filas.reduce((s, f) => s + Math.max(0, f.saldo ?? 0), 0)
  const vencido = filas.filter((f) => estaVencido(f.fecha_vencimiento, hoy, f.saldo ?? 0)).reduce((s, f) => s + (f.saldo ?? 0), 0)

  // ---- Anticipos MercadoPago: etiqueta del origen (PF-N° / cotización N° / excedente de
  // factura folio X) por queries por tipo + Map, y facturas emitidas con saldo por cliente
  // para el botón Aplicar (mismo cliente). `.in('id', [])` devuelve 0 filas sin error.
  const { data: anticipos } = await supabase
    .from('anticipos')
    .select('id, origen_tipo, origen_id, monto, estado, recibido_en, cliente_id, clientes (razon_social)')
    .eq('empresa_id', activa.id)
    .order('recibido_en', { ascending: false })
    .limit(200)
  const listaAnticipos = anticipos ?? []
  const idsPF = [...new Set(listaAnticipos.filter((a) => a.origen_tipo === 'proforma').map((a) => a.origen_id))]
  const idsCot = [...new Set(listaAnticipos.filter((a) => a.origen_tipo === 'cotizacion').map((a) => a.origen_id))]
  const idsFac = [...new Set(listaAnticipos.filter((a) => a.origen_tipo === 'excedente').map((a) => a.origen_id))]
  const [refsPF, refsCot, refsFac, saldosAplicables] = await Promise.all([
    supabase.from('proformas').select('id, numero').eq('empresa_id', activa.id).in('id', idsPF),
    supabase.from('cotizaciones').select('id, numero').eq('empresa_id', activa.id).in('id', idsCot),
    supabase.from('documentos_venta').select('id, folio').eq('empresa_id', activa.id).in('id', idsFac),
    supabase.from('saldos_documentos').select('documento_id, tipo, folio, cliente_id, saldo').eq('empresa_id', activa.id).gt('saldo', 0).limit(500),
  ])
  const mapaPF = new Map((refsPF.data ?? []).map((p) => [p.id, p.numero]))
  const mapaCot = new Map((refsCot.data ?? []).map((c) => [c.id, c.numero]))
  const mapaFac = new Map((refsFac.data ?? []).map((f) => [f.id, f.folio]))

  // ---- Recordatorios enviados: el último por factura (para el "Recordado el X" junto al
  // botón) y los 20 más recientes para la sección de auditoría. Ordenado desc: la primera
  // aparición de cada documento en el Map es la más reciente.
  const [{ data: recordatorios }, { data: recordatoriosWa }] = await Promise.all([
    supabase
      .from('correos_enviados')
      .select('id, referencia_id, para, asunto, creado_en')
      .eq('empresa_id', activa.id)
      .eq('tipo', 'recordatorio')
      .order('creado_en', { ascending: false })
      .limit(200),
    supabase
      .from('whatsapp_mensajes')
      .select('id, referencia_id, telefono, contenido, creado_en')
      .eq('empresa_id', activa.id)
      .eq('origen', 'cobranza')
      .order('creado_en', { ascending: false })
      .limit(200),
  ])
  const listaRecordatorios = recordatorios ?? []
  const ultimoRecordatorio = new Map<string, string>()
  for (const r of listaRecordatorios) {
    if (!ultimoRecordatorio.has(r.referencia_id)) ultimoRecordatorio.set(r.referencia_id, r.creado_en)
  }
  // Ambos canales en una sola lista con etiqueta (spec §6); 20 mas recientes.
  const recientes = [
    ...listaRecordatorios.map((r) => ({
      id: r.id,
      canal: 'correo' as const,
      referencia_id: r.referencia_id,
      destinatario: r.para,
      resumen: r.asunto,
      creado_en: r.creado_en,
    })),
    ...(recordatoriosWa ?? []).map((r) => ({
      id: r.id,
      canal: 'whatsapp' as const,
      referencia_id: r.referencia_id ?? '',
      destinatario: r.telefono,
      resumen: r.contenido,
      creado_en: r.creado_en,
    })),
  ]
    .sort((a, b) => (a.creado_en < b.creado_en ? 1 : -1))
    .slice(0, 20)
  const idsRecordados = [...new Set(recientes.map((r) => r.referencia_id).filter(Boolean))]
  const { data: docsRecordados } = await supabase
    .from('documentos_venta')
    .select('id, tipo, folio')
    .eq('empresa_id', activa.id)
    .in('id', idsRecordados)
  const mapaDocRecordado = new Map((docsRecordados ?? []).map((d) => [d.id, `${d.tipo === 'factura' ? 'Factura' : 'Boleta'} ${d.folio ?? '—'}`]))
  const facturasPorCliente = new Map<string, { documentoId: string; etiqueta: string; saldo: number }[]>()
  for (const s of saldosAplicables.data ?? []) {
    if (!s.documento_id || !s.cliente_id) continue
    const arr = facturasPorCliente.get(s.cliente_id) ?? []
    arr.push({ documentoId: s.documento_id, etiqueta: `${s.tipo === 'factura' ? 'Factura' : 'Boleta'} ${s.folio ?? '—'}`, saldo: s.saldo ?? 0 })
    facturasPorCliente.set(s.cliente_id, arr)
  }
  function etiquetaAnticipo(a: { origen_tipo: string; origen_id: string }): string {
    if (a.origen_tipo === 'proforma') {
      const n = mapaPF.get(a.origen_id)
      return n ? formatearNumeroProforma(n) : 'Proforma'
    }
    if (a.origen_tipo === 'cotizacion') {
      const n = mapaCot.get(a.origen_id)
      return n != null ? `Cotización N° ${n}` : 'Cotización'
    }
    const folio = mapaFac.get(a.origen_id)
    return `Excedente de factura ${folio ?? '—'}`
  }

  return (
    <div>
      <Encabezado titulo="Cuentas por cobrar">
        <div className="flex items-center gap-2">
          <Link href="/cobranza/pagos"><Boton variante="secundario">Pagos</Boton></Link>
          <Link href="/cobranza/pagos/nuevo"><Boton>Registrar pago</Boton></Link>
        </div>
      </Encabezado>
      <form className="mb-4 flex flex-wrap items-center gap-3" action="/cobranza" method="get">
        <Selector name="cliente" defaultValue={cliente} className="max-w-xs">
          <option value="">Todos los clientes</option>
          {(clientes ?? []).map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
        </Selector>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="vencidas" value="1" defaultChecked={vencidas === '1'} /> Solo vencidas
        </label>
        <Boton variante="secundario" type="submit">Filtrar</Boton>
        <Link className="text-sm text-marca-700 hover:underline" href="/cobranza">Limpiar</Link>
      </form>
      <div className="mb-4">
        <BotonRecordarTodas accion={enviarRecordatorios} />
      </div>
      <Tabla>
        <thead><tr><Th>Documento</Th><Th>Cliente</Th><Th>Emisión</Th><Th>Vencimiento</Th><Th className="text-right">Total</Th><Th className="text-right">Pagado</Th><Th className="text-right">Saldo</Th><Th /></tr></thead>
        <tbody>
          {filas.map((f) => {
            const venc = estaVencido(f.fecha_vencimiento, hoy, f.saldo ?? 0)
            return (
              <Tr key={f.documento_id}>
                <Td>{f.tipo === 'factura' ? 'Factura' : 'Boleta'} {f.folio ?? '—'}</Td>
                <Td>{f.cliente_razon_social}</Td>
                <Td>{f.emitido_en ? new Date(f.emitido_en).toLocaleDateString('es-CL') : '—'}</Td>
                <Td>{f.fecha_vencimiento ? new Date(f.fecha_vencimiento + 'T00:00:00').toLocaleDateString('es-CL') : '—'}</Td>
                <Td className="text-right font-mono">{formatearCLP(f.total ?? 0)}</Td>
                <Td className="text-right font-mono">{formatearCLP((f.pagado ?? 0) + (f.notas_credito ?? 0))}</Td>
                <Td className="text-right font-mono">{(f.saldo ?? 0) < 0 ? <span className="text-marca-700">{formatearCLP(f.saldo ?? 0)} (a favor)</span> : formatearCLP(f.saldo ?? 0)}</Td>
                <Td>
                  <div className="flex items-center justify-end gap-2">
                    {venc && f.documento_id && ultimoRecordatorio.has(f.documento_id) && (
                      <span className="text-xs text-slate-500">
                        Recordado el {new Date(ultimoRecordatorio.get(f.documento_id)!).toLocaleDateString('es-CL')}
                      </span>
                    )}
                    {venc && <Insignia tono="rojo">Vencida</Insignia>}
                    {venc && f.documento_id && (
                      <BotonRecordar accion={enviarRecordatorio} documentoId={f.documento_id} />
                    )}
                    {venc && f.documento_id && f.cliente_id && telefonoPorCliente.get(f.cliente_id) && (
                      <BotonWhatsApp accion={recordarPorWhatsApp} documentoId={f.documento_id} />
                    )}
                  </div>
                </Td>
              </Tr>
            )
          })}
          {filas.length === 0 && <Tr><Td colSpan={8} className="py-8 text-center text-slate-500">No hay documentos con saldo {cliente || vencidas ? 'que coincidan' : 'pendiente'}.</Td></Tr>}
        </tbody>
      </Tabla>
      <div className="mt-3 flex justify-end gap-6 text-sm">
        <span>Por cobrar: <strong className="font-mono">{formatearCLP(porCobrar)}</strong></span>
        <span className="text-red-600">Vencido: <strong className="font-mono">{formatearCLP(vencido)}</strong></span>
      </div>

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Anticipos</h2>
        <Tabla>
          <thead><tr><Th>Cliente</Th><Th>Origen</Th><Th className="text-right">Monto</Th><Th>Estado</Th><Th>Fecha</Th><Th /></tr></thead>
          <tbody>
            {listaAnticipos.map((a) => (
              <Tr key={a.id}>
                <Td>{a.clientes?.razon_social ?? '—'}</Td>
                <Td>{etiquetaAnticipo(a)}</Td>
                <Td className="text-right font-mono">{formatearCLP(a.monto)}</Td>
                <Td>{a.estado === 'aplicado' ? <Insignia tono="verde">Aplicado</Insignia> : <Insignia tono="amarillo">Recibido</Insignia>}</Td>
                <Td>{new Date(a.recibido_en).toLocaleDateString('es-CL')}</Td>
                <Td className="text-right">
                  {a.estado === 'recibido' && (
                    <FormularioAplicarAnticipo anticipoId={a.id} facturas={facturasPorCliente.get(a.cliente_id) ?? []} accion={aplicarAnticipoManual} />
                  )}
                </Td>
              </Tr>
            ))}
            {listaAnticipos.length === 0 && <Tr><Td colSpan={6} className="py-8 text-center text-slate-500">No hay anticipos registrados.</Td></Tr>}
          </tbody>
        </Tabla>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Recordatorios enviados</h2>
        <Tabla>
          <thead><tr><Th>Fecha</Th><Th>Canal</Th><Th>Documento</Th><Th>Destinatario</Th><Th>Mensaje</Th><Th /></tr></thead>
          <tbody>
            {recientes.map((r) => (
              <Tr key={`${r.canal}-${r.id}`}>
                <Td>{new Date(r.creado_en).toLocaleDateString('es-CL')}</Td>
                <Td>{r.canal === 'correo' ? 'Correo' : 'WhatsApp'}</Td>
                <Td>{r.referencia_id ? (mapaDocRecordado.get(r.referencia_id) ?? '—') : '—'}</Td>
                <Td>{r.destinatario}</Td>
                <Td className="max-w-md truncate">{r.resumen}</Td>
                <Td className="text-right">
                  {r.canal === 'correo' && (
                    <Link className="text-sm text-marca-700 hover:underline" href={`/correo/${r.id}`}>Ver</Link>
                  )}
                </Td>
              </Tr>
            ))}
            {recientes.length === 0 && <Tr><Td colSpan={6} className="py-8 text-center text-slate-500">Aún no se envían recordatorios.</Td></Tr>}
          </tbody>
        </Tabla>
      </section>
    </div>
  )
}
