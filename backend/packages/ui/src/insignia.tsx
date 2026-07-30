import type { ReactNode } from 'react'
import { cn } from './cn'

const TONOS = {
  verde: 'bg-green-100 text-green-800',
  amarillo: 'bg-amber-100 text-amber-800',
  rojo: 'bg-red-100 text-red-800',
  gris: 'bg-slate-100 text-slate-600',
} as const

export function Insignia({ tono, children }: { tono: keyof typeof TONOS; children: ReactNode }) {
  return (
    <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium', TONOS[tono])}>
      {children}
    </span>
  )
}
