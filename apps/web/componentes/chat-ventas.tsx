'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { responderVentas } from '../app/chat-ventas/acciones'

// Widget de ventas de la landing (spec 2026-07-24): burbuja -> panel embebido con el
// asistente scriptado que explica el producto y captura leads. El hilo vive en el
// estado del cliente (visitante anonimo); el lead es la unica persistencia.

type Burbuja = { id: number; mio: boolean; texto: string }

function IconoChat({ clase }: { clase: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={clase} aria-hidden="true">
      <path d="M12 3C6.48 3 2 6.94 2 11.8c0 2.13.86 4.08 2.3 5.6-.16 1.24-.68 2.6-1.94 3.6 2.06.13 3.66-.5 4.77-1.24 1.44.6 3.08.94 4.87.94 5.52 0 10-3.94 10-8.9S17.52 3 12 3Z" />
    </svg>
  )
}

export function ChatVentas() {
  const [abierto, setAbierto] = useState(false)
  const [burbujas, setBurbujas] = useState<Burbuja[]>([])
  const [texto, setTexto] = useState('')
  const [pendiente, iniciarTransicion] = useTransition()
  const finRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [burbujas, abierto])

  function enviar(contenido?: string) {
    const mio = (contenido ?? texto).trim()
    if (!mio || pendiente) return
    setTexto('')
    setBurbujas((b) => [...b, { id: Date.now(), mio: true, texto: mio }])
    iniciarTransicion(async () => {
      const respuesta = await responderVentas(mio).catch(() => 'Ups, algo falló. Intenta de nuevo.')
      setBurbujas((b) => [...b, { id: Date.now() + 1, mio: false, texto: respuesta }])
    })
  }

  return (
    <div>
      {abierto && (
        <div className="fixed bottom-24 right-5 z-50 flex h-[520px] w-[360px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/25">
          <div className="bg-gradient-to-br from-marca-700 to-cyan-600 px-5 py-4 text-white">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-white/15">
                <IconoChat clase="h-6 w-6" />
              </span>
              <div>
                <p className="text-base font-bold leading-tight">¡Te damos la bienvenida a Suite ERP!</p>
                <p className="text-xs text-marca-100">Te contamos cómo funciona y te ayudamos a partir</p>
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3">
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
                Hola! ¿En qué te puedo ayudar? Pregúntame por los <strong>módulos</strong>, los{' '}
                <strong>precios</strong> o cómo funciona Suite ERP.
              </div>
            </div>
            {burbujas.map((b) => (
              <div key={b.id} className={b.mio ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm text-slate-800 ${
                    b.mio ? 'bg-marca-100' : 'border border-slate-200 bg-white'
                  }`}
                >
                  {b.texto}
                </div>
              </div>
            ))}
            {pendiente && <p className="px-1 text-xs text-slate-400">Escribiendo…</p>}
            {/* Sugerencias SIEMPRE tras la ultima respuesta (pedido 2026-07-24): el
                visitante nunca queda sin siguiente paso. */}
            {!pendiente && (
              <div className="flex flex-wrap gap-2 px-1 pt-1">
                {['¿Qué es Suite ERP?', 'Módulos', 'Precios', 'Quiero que me contacten'].map((sugerencia) => (
                  <button
                    key={sugerencia}
                    type="button"
                    onClick={() => enviar(sugerencia)}
                    className="rounded-full border border-marca-200 bg-white px-3 py-1.5 text-xs font-medium text-marca-700 transition-colors hover:bg-marca-50"
                  >
                    {sugerencia}
                  </button>
                ))}
              </div>
            )}
            <div ref={finRef} />
          </div>

          <div className="flex items-center gap-2 border-t border-slate-200 bg-white p-3">
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') enviar()
              }}
              placeholder="Escribe tu pregunta…"
              className="w-full rounded-full border border-slate-300 px-4 py-2 text-sm focus:border-marca-500 focus:outline-none focus:ring-1 focus:ring-marca-500"
            />
            <button
              type="button"
              onClick={() => enviar()}
              disabled={pendiente || !texto.trim()}
              aria-label="Enviar pregunta"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-marca-600 to-marca-700 text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
                <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </div>
          <p className="border-t border-slate-100 bg-white py-1.5 text-center text-[10px] text-slate-400">
            Asistente de Suite ERP · prueba gratis 14 días
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-label={abierto ? 'Cerrar el chat' : 'Chatear con Suite ERP'}
        title="¿Te ayudamos?"
        className="fixed bottom-5 right-5 z-50 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-marca-600 to-marca-700 text-white shadow-lg shadow-marca-600/40 transition-transform hover:scale-105"
      >
        {abierto ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-6 w-6" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        ) : (
          <IconoChat clase="h-7 w-7" />
        )}
      </button>
    </div>
  )
}
