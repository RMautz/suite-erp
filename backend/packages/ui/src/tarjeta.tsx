import type { ReactNode } from 'react'
import { cn } from './cn'

export function Tarjeta({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn('rounded-lg border border-slate-200 bg-white p-5', className)}>{children}</section>
  )
}
