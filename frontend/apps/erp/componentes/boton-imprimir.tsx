'use client'

import { Boton } from '@suite/ui'

export function BotonImprimir() {
  return (
    <Boton variante="secundario" type="button" onClick={() => window.print()}>
      Imprimir
    </Boton>
  )
}
