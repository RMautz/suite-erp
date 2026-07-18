import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { exigirContabilidad } from '../../../../lib/contabilidad-acceso'
import { BotonRevertir } from '../../../../componentes/boton-revertir'
import { ETIQUETA_ORIGEN, rutaOrigen } from '../../origenes'
import { revertirAsiento } from '../acciones'

export default async function DetalleAsiento({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const activa = await exigirContabilidad()
  const supabase = await crearClienteServidor()
  const { data: asiento } = await supabase
    .from('asientos')
    .select('id, numero, fecha, glosa, origen, referencia_id, reversa_de, asientos_lineas (id, debe, haber, glosa, cuentas_contables (codigo, nombre))')
    .eq('id', id).eq('empresa_id', activa.id).single()
  if (!asiento) notFound()

  // ¿Ya tiene una reversa? (a lo más una por asiento). Si el propio asiento es reversa
  // o ya fue revertido, no se ofrece revertir (el RPC igual lo bloquea).
  const { data: reversa } = await supabase
    .from('asientos')
    .select('id, numero')
    .eq('empresa_id', activa.id)
    .eq('reversa_de', asiento.id)
    .maybeSingle()

  const lineas = asiento.asientos_lineas ?? []
  const totalDebe = lineas.reduce((s: number, l: { debe: number }) => s + l.debe, 0)
  const totalHaber = lineas.reduce((s: number, l: { haber: number }) => s + l.haber, 0)
  const href = rutaOrigen(asiento.origen, asiento.referencia_id)
  const esReversa = asiento.origen === 'reversa'
  const revertible = !esReversa && !reversa

  return (
    <div>
      <Encabezado titulo={`Asiento N° ${asiento.numero}`}>
        <Insignia tono="gris">{ETIQUETA_ORIGEN[asiento.origen] ?? asiento.origen}</Insignia>
      </Encabezado>

      <Tarjeta className="mb-4 max-w-3xl">
        <p><strong>Fecha:</strong> {new Date(asiento.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</p>
        <p className="mt-1"><strong>Glosa:</strong> {asiento.glosa}</p>
        {href && (
          <p className="mt-1"><Link className="text-marca-700 hover:underline" href={href}>Ver documento de origen</Link></p>
        )}
        {esReversa && asiento.reversa_de && (
          <p className="mt-1"><Link className="text-marca-700 hover:underline" href={`/contabilidad/asientos/${asiento.reversa_de}`}>Es la reversa del asiento original</Link></p>
        )}
        {reversa && (
          <p className="mt-1 text-sm text-amber-700">
            Revertido por el <Link className="underline" href={`/contabilidad/asientos/${reversa.id}`}>asiento N° {reversa.numero}</Link>.
          </p>
        )}
      </Tarjeta>

      <Tabla>
        <thead><tr><Th>Cuenta</Th><Th>Glosa</Th><Th className="text-right">Debe</Th><Th className="text-right">Haber</Th></tr></thead>
        <tbody>
          {lineas.map((l: { id: string; debe: number; haber: number; glosa: string | null; cuentas_contables: { codigo: string; nombre: string } | null }) => (
            <Tr key={l.id}>
              <Td className="font-mono">{l.cuentas_contables?.codigo} · {l.cuentas_contables?.nombre}</Td>
              <Td className="text-sm text-slate-500">{l.glosa ?? ''}</Td>
              <Td className="text-right font-mono">{l.debe ? formatearCLP(l.debe) : ''}</Td>
              <Td className="text-right font-mono">{l.haber ? formatearCLP(l.haber) : ''}</Td>
            </Tr>
          ))}
          <Tr>
            <Td className="font-semibold" colSpan={2}>Totales</Td>
            <Td className="text-right font-mono font-semibold">{formatearCLP(totalDebe)}</Td>
            <Td className="text-right font-mono font-semibold">{formatearCLP(totalHaber)}</Td>
          </Tr>
        </tbody>
      </Tabla>

      {revertible && (
        <Tarjeta className="mt-6 max-w-3xl">
          <h2 className="mb-1 text-lg font-semibold text-slate-800">Revertir</h2>
          <p className="mb-3 text-sm text-slate-600">
            Los asientos son inmutables: para corregir uno se crea su asiento inverso ligado. Un
            asiento se revierte a lo más una vez.
          </p>
          <BotonRevertir asientoId={asiento.id} accion={revertirAsiento} />
        </Tarjeta>
      )}
    </div>
  )
}
