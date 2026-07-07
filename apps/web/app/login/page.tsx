'use client'

import { useActionState } from 'react'
import { iniciarSesion } from './acciones'
import type { EstadoForm } from '../tipos'

const inicial: EstadoForm = {}

export default function PaginaLogin() {
  const [estado, accion, pendiente] = useActionState(iniciarSesion, inicial)
  return (
    <main style={{ maxWidth: 420, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Iniciar sesión</h1>
      <form action={accion} style={{ display: 'grid', gap: 12 }}>
        <label>
          Correo
          <input name="email" type="email" required style={{ width: '100%' }} />
        </label>
        <label>
          Contraseña
          <input name="password" type="password" required style={{ width: '100%' }} />
        </label>
        {estado.error && <p style={{ color: 'crimson' }}>{estado.error}</p>}
        <button type="submit" disabled={pendiente}>
          {pendiente ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}
