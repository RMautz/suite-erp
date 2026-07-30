import type { ReactNode } from 'react'
import './globals.css'

export const metadata = { title: 'Suite ERP — Gestión para pymes chilenas' }

export default function LayoutRaiz({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="font-sans text-slate-800 antialiased">{children}</body>
    </html>
  )
}
