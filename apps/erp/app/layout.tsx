import type { ReactNode } from 'react'
import './globals.css'

export const metadata = { title: 'Suite ERP' }

export default function LayoutRaiz({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-slate-100 text-slate-900 antialiased">{children}</body>
    </html>
  )
}
