import type { ReactNode } from 'react'
import { BarraLateral } from '@suite/ui'
import './globals.css'
import { cambiarEmpresaActiva } from './acciones'
import { BotonCerrarSesion } from '../componentes/boton-cerrar-sesion'
import { SelectorEmpresa } from '../componentes/selector-empresa'
import { obtenerEmpresaActiva } from '../lib/empresa-activa'

export const metadata = { title: 'Suite ERP' }

export default async function LayoutRaiz({ children }: { children: ReactNode }) {
  const { activa, empresas } = await obtenerEmpresaActiva()
  // El NAV depende de la empresa activa: las entradas de transporte solo existen
  // con el módulo activo. Esto es UX, no seguridad: RLS y las RPCs siguen
  // mandando aunque alguien navegue a mano.
  const nav = [
    { href: '/', etiqueta: 'Inicio' },
    { href: '/productos', etiqueta: 'Productos' },
    { href: '/clientes', etiqueta: 'Clientes' },
    { href: '/importar', etiqueta: 'Importar' },
    { href: '/cotizaciones', etiqueta: 'Cotizaciones' },
    ...(activa?.modulo_transporte
      ? [
          { href: '/flota', etiqueta: 'Flota' },
          { href: '/tarifario', etiqueta: 'Tarifario' },
          { href: '/entregas', etiqueta: 'Entregas' },
          { href: '/proformas', etiqueta: 'Proformas' },
          { href: '/combustible', etiqueta: 'Combustible' },
        ]
      : []),
    { href: '/ventas', etiqueta: 'Ventas' },
    { href: '/inventario', etiqueta: 'Inventario' },
    { href: '/compras', etiqueta: 'Compras' },
    { href: '/cobranza', etiqueta: 'Cobranza' },
    { href: '/por-pagar', etiqueta: 'Por pagar' },
    { href: '/reportes', etiqueta: 'Reportes' },
    { href: '/configuracion', etiqueta: 'Configuración' },
  ]
  return (
    <html lang="es">
      <body className="bg-slate-100 text-slate-900 antialiased">
        <div className="flex">
          <div className="print:hidden">
            <BarraLateral
              titulo="Suite ERP"
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
        </div>
      </body>
    </html>
  )
}
