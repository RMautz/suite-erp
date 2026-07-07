'use client'

import { useActionState } from 'react'
import { registrar } from './acciones'
import type { EstadoForm } from '../tipos'

const inicial: EstadoForm = {}

export default function PaginaRegistro() {
  const [estado, accion, pendiente] = useActionState(registrar, inicial)
  return (
    <main style={{ maxWidth: 420, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Crea tu cuenta</h1>
      <p>14 días de prueba gratis. Sin tarjeta.</p>
      <form action={accion} style={{ display: 'grid', gap: 12 }}>
        <label>
          Correo
          <input name="email" type="email" required style={{ width: '100%' }} />
        </label>
        <label>
          Contraseña (mínimo 8 caracteres)
          <input name="password" type="password" required minLength={8} style={{ width: '100%' }} />
        </label>
        <label>
          RUT de la empresa
          <input name="rut" placeholder="76.543.210-3" required style={{ width: '100%' }} />
        </label>
        <label>
          Razón social
          <input name="razon_social" required style={{ width: '100%' }} />
        </label>
        {estado.error && <p style={{ color: 'crimson' }}>{estado.error}</p>}
        <button type="submit" disabled={pendiente}>
          {pendiente ? 'Creando cuenta…' : 'Crear cuenta'}
        </button>
      </form>
    </main>
  )
}
