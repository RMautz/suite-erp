import type { ReactNode } from 'react'
import { BarraLateral } from '@suite/ui'
import './globals.css'
import { cambiarEmpresaActiva } from './acciones'
import { SelectorEmpresa } from '../componentes/selector-empresa'
import { obtenerEmpresaActiva } from '../lib/empresa-activa'

export const metadata = { title: 'Suite ERP' }

const NAV = [
  { href: '/', etiqueta: 'Inicio' },
  { href: '/productos', etiqueta: 'Productos' },
  { href: '/clientes', etiqueta: 'Clientes' },
  { href: '/importar', etiqueta: 'Importar' },
]

export default async function LayoutRaiz({ children }: { children: ReactNode }) {
  const { activa, empresas } = await obtenerEmpresaActiva()
  return (
    <html lang="es">
      <body className="bg-slate-100 text-slate-900 antialiased">
        <div className="flex">
          <BarraLateral
            titulo="Suite ERP"
            items={NAV}
            pie={
              activa && (
                <SelectorEmpresa empresas={empresas} activaId={activa.id} accion={cambiarEmpresaActiva} />
              )
            }
          />
          <main className="min-h-screen flex-1 p-8">{children}</main>
        </div>
      </body>
    </html>
  )
}
