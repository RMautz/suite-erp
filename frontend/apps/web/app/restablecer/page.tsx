'use client'

import Link from 'next/link'
import { useActionState, useEffect, useState } from 'react'
import { BadgeIcono, CLASES_INPUT, MarcoRecuperacion, Stepper } from '../../componentes/tarjeta-recuperacion'
import { cambiarPassword, type EstadoRestablecer } from './acciones'
import { fuerzaPassword } from './fuerza'

const inicial: EstadoRestablecer = {}

const COLORES_FUERZA = ['bg-slate-200', 'bg-red-400', 'bg-amber-400', 'bg-green-500']
const TEXTO_FUERZA = ['text-slate-400', 'text-red-600', 'text-amber-600', 'text-green-600']

function CampoPassword({
  name,
  etiqueta,
  valor,
  onChange,
}: {
  name: string
  etiqueta: string
  valor: string
  onChange: (v: string) => void
}) {
  const [visible, setVisible] = useState(false)
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{etiqueta}</span>
      <span className="relative block">
        <input
          name={name}
          type={visible ? 'text' : 'password'}
          required
          minLength={8}
          autoComplete="new-password"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          className={`${CLASES_INPUT} pr-10`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center text-slate-400 hover:text-slate-600"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden="true"
          >
            {visible ? (
              <>
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
                <path d="m4 4 16 16" />
              </>
            ) : (
              <>
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </>
            )}
          </svg>
        </button>
      </span>
    </label>
  )
}

export default function PaginaRestablecer() {
  const [estado, accion, pendiente] = useActionState(cambiarPassword, inicial)
  const [password, setPassword] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const fuerza = fuerzaPassword(password)

  // Check animado 1,2 s y recien ahi entra al ERP (spec §2.4).
  useEffect(() => {
    if (!estado.ok) return
    const t = setTimeout(() => window.location.assign(process.env.NEXT_PUBLIC_URL_ERP!), 1200)
    return () => clearTimeout(t)
  }, [estado.ok])

  if (estado.ok) {
    return (
      <MarcoRecuperacion>
        <style>{'@keyframes exito-pop{0%{transform:scale(.5);opacity:0}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}'}</style>
        <div className="text-center" style={{ animation: 'exito-pop .45s ease-out' }}>
          <BadgeIcono icono="check" tono="verde" />
          <h1 className="mt-4 text-xl font-semibold text-slate-900">Contraseña actualizada</h1>
          <p className="mt-2 text-sm text-slate-600">
            Entrando a tu ERP…{' '}
            <a href={process.env.NEXT_PUBLIC_URL_ERP} className="font-semibold text-marca-700 hover:underline">
              o entra aquí
            </a>
          </p>
        </div>
      </MarcoRecuperacion>
    )
  }

  return (
    <MarcoRecuperacion
      pie={
        <>
          ¿El enlace expiró?{' '}
          <Link href="/recuperar" className="font-semibold text-marca-700 hover:underline">
            Pide uno nuevo
          </Link>
        </>
      }
    >
      <BadgeIcono icono="candado" />
      <Stepper paso={2} />
      <h1 className="text-center text-xl font-semibold text-slate-900">Nueva contraseña</h1>
      <p className="mt-1 text-center text-sm text-slate-500">Elige una contraseña de al menos 8 caracteres.</p>
      <form action={accion} className="mt-6 grid gap-4">
        <div>
          <CampoPassword name="password" etiqueta="Nueva contraseña" valor={password} onChange={setPassword} />
          <div className="mt-2 flex items-center gap-2">
            <div className="flex flex-1 gap-1">
              {[1, 2, 3].map((tramo) => (
                <span
                  key={tramo}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${fuerza.nivel >= tramo ? COLORES_FUERZA[fuerza.nivel] : 'bg-slate-200'}`}
                />
              ))}
            </div>
            <span className={`w-16 text-right text-xs font-medium ${TEXTO_FUERZA[fuerza.nivel]}`}>{fuerza.etiqueta}</span>
          </div>
        </div>
        <CampoPassword name="confirmar" etiqueta="Repite la contraseña" valor={confirmar} onChange={setConfirmar} />
        {estado.error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{estado.error}</p>
        )}
        <button
          type="submit"
          disabled={pendiente}
          className="w-full rounded-lg bg-gradient-to-br from-marca-600 to-marca-700 px-5 py-2.5 font-semibold text-white shadow-lg shadow-marca-600/30 transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pendiente ? 'Guardando…' : 'Guardar y entrar'}
        </button>
      </form>
    </MarcoRecuperacion>
  )
}
