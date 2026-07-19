import Link from 'next/link'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata = { title: 'Suite ERP — Panel de plataforma' }

export default function LayoutRaiz({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-slate-50 font-sans text-slate-800 antialiased">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-marca-500 to-marca-700 text-sm font-bold text-white">
              SE
            </span>
            <div>
              <p className="text-lg font-semibold leading-tight text-slate-900">
                Suite{' '}
                <span className="bg-gradient-to-r from-marca-600 to-cyan-500 bg-clip-text text-transparent">
                  ERP
                </span>
              </p>
              <p className="text-xs text-slate-500">Panel de plataforma</p>
            </div>
            <nav className="ml-auto flex gap-5 text-sm font-medium text-slate-600">
              <Link href="/" className="hover:text-marca-700">
                Panel
              </Link>
              <Link href="/indicadores" className="hover:text-marca-700">
                Indicadores
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  )
}
