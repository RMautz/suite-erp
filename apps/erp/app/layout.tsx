import type { ReactNode } from 'react'

export const metadata = { title: 'Suite ERP' }

export default function LayoutRaiz({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: 'system-ui', margin: 0 }}>{children}</body>
    </html>
  )
}
