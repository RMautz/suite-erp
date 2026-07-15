'use client'

import { cerrarSesion } from '../app/acciones'

export function BotonCerrarSesion() {
  return (
    <form action={cerrarSesion}>
      <button
        type="submit"
        className="w-full rounded-md px-3 py-2 text-left text-sm text-marca-100 transition-colors hover:bg-marca-800 hover:text-white"
      >
        Cerrar sesión
      </button>
    </form>
  )
}
