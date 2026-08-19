import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

const VARIANTES = {
  primario:
    'grad-marca text-white hover:brightness-110 hover:shadow-md hover:shadow-marca-500/40 disabled:bg-marca-300 disabled:[background-image:none]',
  secundario: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400',
  peligro: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
} as const

export interface BotonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: keyof typeof VARIANTES
}

export function Boton({ variante = 'primario', className, ...props }: BotonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed',
        VARIANTES[variante],
        className
      )}
      {...props}
    />
  )
}
