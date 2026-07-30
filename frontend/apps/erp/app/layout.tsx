import type { ReactNode } from 'react'
import { crearClienteServidor } from '@suite/auth/server'
import { BarraLateral } from '@suite/ui'
import { ChatWidget } from '../componentes/chat-widget'
import './globals.css'
import { cambiarEmpresaActiva } from './acciones'
import { BotonCerrarSesion } from '../componentes/boton-cerrar-sesion'
import { SelectorEmpresa } from '../componentes/selector-empresa'
import { obtenerEmpresaActiva } from '../lib/empresa-activa'
import { puedeVerContabilidad } from '../lib/contabilidad-acceso'
import { puedeVerRRHH } from '../lib/rrhh-acceso'

export const metadata = { title: 'Suite ERP' }

export default async function LayoutRaiz({ children }: { children: ReactNode }) {
  const { activa, empresas } = await obtenerEmpresaActiva()

  // Telefono del vinculo verificado (para el widget de chat). RLS: solo dueno/admin
  // lo ven; otros roles reciben null y el widget invita a vincular.
  let telefonoBot: string | null = null
  if (activa) {
    const supabase = await crearClienteServidor()
    const { data: vinculos } = await supabase
      .from('whatsapp_vinculos')
      .select('telefono')
      .eq('empresa_id', activa.id)
      .eq('activo', true)
      .not('verificado_en', 'is', null)
      .limit(1)
    telefonoBot = vinculos?.[0]?.telefono ?? null
  }
  const modoMock = process.env.PROVEEDOR_WHATSAPP === 'mock'
  // El NAV depende de la empresa activa: las entradas de transporte solo existen
  // con el módulo activo. Esto es UX, no seguridad: RLS y las RPCs siguen
  // mandando aunque alguien navegue a mano.
  // NAV agrupado por categorías. Los condicionales siguen siendo UX, no seguridad:
  // RLS y las RPCs mandan aunque alguien navegue a mano.
  const nav = [
    { href: '/', etiqueta: 'Inicio' },
    { seccion: 'Comercial' },
    { href: '/cotizaciones', etiqueta: 'Cotizaciones' },
    { href: '/ventas', etiqueta: 'Ventas' },
    { href: '/cobranza', etiqueta: 'Cobranza' },
    ...(activa?.modulo_transporte
      ? [
          { seccion: 'Transporte' },
          { href: '/flota', etiqueta: 'Flota' },
          { href: '/tarifario', etiqueta: 'Tarifario' },
          { href: '/entregas', etiqueta: 'Entregas' },
          { href: '/proformas', etiqueta: 'Proformas' },
          { href: '/combustible', etiqueta: 'Combustible' },
        ]
      : []),
    { seccion: 'Compras' },
    { href: '/compras', etiqueta: 'Compras' },
    { href: '/por-pagar', etiqueta: 'Por pagar' },
    { href: '/inventario', etiqueta: 'Inventario' },
    { seccion: 'Maestros' },
    { href: '/productos', etiqueta: 'Productos' },
    { href: '/clientes', etiqueta: 'Clientes' },
    { href: '/importar', etiqueta: 'Importar' },
    // Personas solo para dueno/admin/contador (spec §6). Es UX, no seguridad:
    // por URL directa la RLS igual manda (tabla vacía o 404).
    ...(puedeVerRRHH(activa)
      ? [
          { seccion: 'Personas' },
          { href: '/trabajadores', etiqueta: 'Trabajadores' },
          { href: '/liquidaciones', etiqueta: 'Liquidaciones' },
          { href: '/libro-remuneraciones', etiqueta: 'Libro de remuneraciones' },
        ]
      : []),
    { seccion: 'Análisis' },
    { href: '/reportes', etiqueta: 'Reportes' },
    ...(puedeVerContabilidad(activa) ? [{ href: '/contabilidad', etiqueta: 'Contabilidad' }] : []),
    { seccion: 'Sistema' },
    { href: '/configuracion', etiqueta: 'Configuración' },
  ]
  return (
    <html lang="es">
      <body className="bg-slate-100 text-slate-900 antialiased">
        <div className="flex">
          <div className="print:hidden">
            <BarraLateral
              titulo="Suite ERP"
              tituloHref={process.env.NEXT_PUBLIC_URL_WEB ?? '/'}
              items={nav}
              pie={
                <div className="grid gap-2">
                  {activa && <SelectorEmpresa empresas={empresas} activaId={activa.id} accion={cambiarEmpresaActiva} />}
                  <BotonCerrarSesion />
                </div>
              }
            />
          </div>
          <main className="min-h-screen flex-1 p-8 print:p-0">{children}</main>
          {activa && (modoMock || process.env.NEXT_PUBLIC_WHATSAPP_URL) && (
            <ChatWidget
              telefono={telefonoBot}
              modoMock={modoMock}
              urlExterna={process.env.NEXT_PUBLIC_WHATSAPP_URL}
              nombreEmpresa={activa.razon_social}
            />
          )}
        </div>
      </body>
    </html>
  )
}
