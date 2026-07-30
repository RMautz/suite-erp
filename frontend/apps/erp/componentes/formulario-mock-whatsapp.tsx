'use client'

import { useActionState } from 'react'
import { Boton, Entrada } from '@suite/ui'
import type { EstadoMockWhatsApp } from '../app/mock-whatsapp/acciones'

// "Teclado del celular": telefono + texto -> action que postea al webhook real.
export function FormularioMockWhatsApp({
  accion,
  telefonoInicial,
}: {
  accion: (prev: EstadoMockWhatsApp, formData: FormData) => Promise<EstadoMockWhatsApp>
  telefonoInicial: string
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoMockWhatsApp)
  return (
    <form action={enviar} className="flex flex-wrap items-center gap-2">
      <Entrada name="telefono" defaultValue={telefonoInicial} placeholder="+56912345678" required className="w-44 font-mono" />
      <Entrada name="texto" placeholder="Escribe como si fueras el celular…" required className="min-w-0 flex-1" />
      <Boton type="submit" disabled={pendiente}>{pendiente ? 'Enviando…' : 'Enviar'}</Boton>
      {estado.error && <span className="text-sm text-red-600">{estado.error}</span>}
    </form>
  )
}
