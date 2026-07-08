'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { cn } from './cn'

export interface ItemNav {
  href: string
  etiqueta: string
}

export function BarraLateral({
  titulo,
  items,
  pie,
}: {
  titulo: string
  items: ItemNav[]
  pie?: ReactNode
}) {
  const ruta = usePathname()
  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-slate-200 bg-marca-950 text-white">
      <div className="px-4 py-5 text-lg font-semibold">{titulo}</div>
      <nav className="flex-1 space-y-1 px-2">
        {items.map((item) => {
          const activo = item.href === '/' ? ruta === '/' : ruta.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'block rounded-md px-3 py-2 text-sm',
                activo ? 'bg-marca-700 font-medium text-white' : 'text-marca-100 hover:bg-marca-800'
              )}
            >
              {item.etiqueta}
            </Link>
          )
        })}
      </nav>
      {pie && <div className="border-t border-marca-800 p-3">{pie}</div>}
    </aside>
  )
}
