'use client'

import { useActionState, useEffect, useState } from 'react'
import { BadgeIcono, CLASES_INPUT, Stepper } from '../../componentes/tarjeta-recuperacion'
import { solicitarRecuperacion, type EstadoRecuperar } from './acciones'

const inicial: EstadoRecuperar = {}

export function FormularioRecuperar({ expirado }: { expirado: boolean }) {
  const [estado, accion, pendiente] = useActionState(solicitarRecuperacion, inicial)
  const [correo, setCorreo] = useState('')
  const [corrigiendo, setCorrigiendo] = useState(false)
  const [restante, setRestante] = useState(0)

  // Cada envio exitoso (incluido el reenvio) reinicia el cooldown de 60 s.
  useEffect(() => {
    if (estado.ok) {
      setCorrigiendo(false)
      setRestante(60)
    }
  }, [estado])
  const contando = restante > 0
  useEffect(() => {
    if (!contando) return
    const t = setInterval(() => setRestante((r) => r - 1), 1000)
    return () => clearInterval(t)
  }, [contando])

  // Vista 2: "Revisa tu correo" (exito del paso 1) con reenviar + corregir.
  if (estado.ok && !corrigiendo) {
    return (
      <div className="text-center">
        <BadgeIcono icono="check" tono="verde" />
        <Stepper paso={1} />
        <h1 className="text-xl font-semibold text-slate-900">Revisa tu correo</h1>
        <p className="mt-2 text-sm text-slate-600">
          Si el correo existe, enviamos un enlace a <strong className="text-slate-800">{correo}</strong>. Vence en una
          hora.
        </p>
        <form action={accion} className="mt-6">
          <input type="hidden" name="email" value={correo} />
          <button
            type="submit"
            disabled={pendiente || restante > 0}
            className="w-full rounded-lg border border-marca-200 px-5 py-2.5 text-sm font-semibold text-marca-700 transition-colors hover:bg-marca-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pendiente ? 'Reenviando…' : restante > 0 ? `Reenviar (${restante} s)` : 'Reenviar enlace'}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setCorrigiendo(true)}
          className="mt-4 text-sm font-medium text-slate-500 hover:text-marca-700 hover:underline"
        >
          ¿Te equivocaste de correo? Corregir
        </button>
      </div>
    )
  }

  // Vista 5: enlace expirado (llega de /auth/confirm) hasta que pida uno nuevo.
  if (expirado && !corrigiendo) {
    return (
      <div className="text-center">
        <BadgeIcono icono="reloj" tono="ambar" />
        <h1 className="mt-4 text-xl font-semibold text-slate-900">El enlace expiró</h1>
        <p className="mt-2 text-sm text-slate-600">
          Los enlaces duran una hora y solo sirven una vez. Pide uno nuevo y usa el correo más reciente.
        </p>
        <button
          type="button"
          onClick={() => setCorrigiendo(true)}
          className="mt-6 w-full rounded-lg bg-gradient-to-br from-marca-600 to-marca-700 px-5 py-2.5 font-semibold text-white shadow-lg shadow-marca-600/30 transition-opacity hover:opacity-95"
        >
          Pedir enlace nuevo
        </button>
      </div>
    )
  }

  // Vista 1: formulario del paso 1.
  return (
    <div>
      <BadgeIcono icono="sobre" />
      <Stepper paso={1} />
      <h1 className="text-center text-xl font-semibold text-slate-900">Recuperar contraseña</h1>
      <p className="mt-1 text-center text-sm text-slate-500">Te enviaremos un enlace para crear una nueva.</p>
      <form action={accion} className="mt-6 grid gap-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Correo</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="tu@empresa.cl"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            className={CLASES_INPUT}
          />
        </label>
        {estado.error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{estado.error}</p>
        )}
        <button
          type="submit"
          disabled={pendiente}
          className="w-full rounded-lg bg-gradient-to-br from-marca-600 to-marca-700 px-5 py-2.5 font-semibold text-white shadow-lg shadow-marca-600/30 transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pendiente ? 'Enviando…' : 'Enviar enlace →'}
        </button>
      </form>
    </div>
  )
}
