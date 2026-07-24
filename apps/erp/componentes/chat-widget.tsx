'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useTransition } from 'react'
import { enviarAlBot, hiloDelBot, type MensajeChat } from '../app/chat-bot/acciones'

// Widget de chat del bot (spec tickets 2026-07-22): la burbuja abre un panel
// embebido que habla con el MISMO bot real (webhook + motor + log). En modo mock el
// chat corre aqui; en produccion (urlExterna = wa.me/<numero>) el panel deriva al
// WhatsApp real; sin telefono vinculado invita a vincular en Configuracion.

function IconoWhatsApp({ clase }: { clase: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={clase} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  )
}

export function ChatWidget({
  telefono,
  modoMock,
  urlExterna,
  nombreEmpresa,
}: {
  telefono: string | null
  modoMock: boolean
  urlExterna?: string
  nombreEmpresa: string
}) {
  const [abierto, setAbierto] = useState(false)
  const [mensajes, setMensajes] = useState<MensajeChat[]>([])
  const [texto, setTexto] = useState('')
  const [error, setError] = useState('')
  const [pendiente, iniciarTransicion] = useTransition()
  const finRef = useRef<HTMLDivElement>(null)

  const chatEmbebido = modoMock && !!telefono

  useEffect(() => {
    if (abierto && chatEmbebido && telefono) {
      hiloDelBot(telefono).then(setMensajes)
    }
  }, [abierto, chatEmbebido, telefono])

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [mensajes, abierto])

  function enviar() {
    if (!telefono || !texto.trim() || pendiente) return
    const mio = texto.trim()
    setTexto('')
    setError('')
    setMensajes((m) => [...m, { id: 'local-' + Date.now(), direccion: 'entrante', contenido: mio, creado_en: new Date().toISOString() }])
    iniciarTransicion(async () => {
      const r = await enviarAlBot(telefono, mio)
      if (r.error) setError(r.error)
      setMensajes(await hiloDelBot(telefono))
    })
  }

  return (
    <div className="print:hidden">
      {abierto && (
        <div className="fixed bottom-24 right-5 z-50 flex h-[520px] w-[360px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/25">
          <div className="bg-gradient-to-br from-[#075E54] to-[#128C7E] px-5 py-4 text-white">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-[#25D366]">
                <IconoWhatsApp clase="h-6 w-6" />
              </span>
              <div>
                <p className="text-base font-bold leading-tight">¡Te damos la bienvenida al chat de tu ERP!</p>
                <p className="text-xs text-green-100">{nombreEmpresa}</p>
              </div>
            </div>
          </div>

          {chatEmbebido ? (
            <>
              <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3">
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
                    Hola! ¿En qué te puedo ayudar? Escribe <strong>menú</strong> para ver todo lo que sé hacer, o{' '}
                    <strong>ayuda</strong> + tu problema para dejarle un ticket a administración.
                  </div>
                </div>
                {mensajes.map((m) => (
                  <div key={m.id} className={m.direccion === 'entrante' ? 'flex justify-end' : 'flex justify-start'}>
                    <div
                      className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm text-slate-800 ${
                        m.direccion === 'entrante' ? 'bg-[#DCF8C6]' : 'border border-slate-200 bg-white'
                      }`}
                    >
                      {m.contenido}
                    </div>
                  </div>
                ))}
                {pendiente && <p className="px-1 text-xs text-slate-400">El bot está escribiendo…</p>}
                {error && <p className="px-1 text-xs text-red-600">{error}</p>}
                <div ref={finRef} />
              </div>
              <div className="flex items-center gap-2 border-t border-slate-200 bg-white p-3">
                <input
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') enviar()
                  }}
                  placeholder="Escribe un mensaje…"
                  className="w-full rounded-full border border-slate-300 px-4 py-2 text-sm focus:border-[#128C7E] focus:outline-none focus:ring-1 focus:ring-[#128C7E]"
                />
                <button
                  type="button"
                  onClick={enviar}
                  disabled={pendiente || !texto.trim()}
                  aria-label="Enviar mensaje"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#25D366] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
                    <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
                  </svg>
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center">
              <p className="text-sm text-slate-600">
                {urlExterna && !modoMock
                  ? 'Chatea con tu ERP directo en WhatsApp: consultas de ventas, cobranza, stock y tickets a administración.'
                  : 'Vincula tu WhatsApp para chatear con tu ERP: consultas de ventas, cobranza, stock y tickets a administración.'}
              </p>
              {urlExterna && !modoMock ? (
                <a
                  href={urlExterna}
                  className="rounded-full bg-[#25D366] px-5 py-2.5 font-semibold text-white shadow-lg shadow-green-600/30 transition-opacity hover:opacity-90"
                >
                  Abrir WhatsApp
                </a>
              ) : (
                <Link
                  href="/configuracion/whatsapp"
                  className="rounded-full bg-[#25D366] px-5 py-2.5 font-semibold text-white shadow-lg shadow-green-600/30 transition-opacity hover:opacity-90"
                >
                  Vincular mi WhatsApp
                </Link>
              )}
            </div>
          )}
          <p className="border-t border-slate-100 bg-white py-1.5 text-center text-[10px] text-slate-400">
            Bot de Suite ERP · también responde en WhatsApp
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-label={abierto ? 'Cerrar el chat' : 'Chatear con tu ERP por WhatsApp'}
        title="Chatear con tu ERP"
        className="fixed bottom-5 right-5 z-50 grid h-14 w-14 place-items-center rounded-full bg-[#25D366] text-white shadow-lg shadow-green-600/40 transition-transform hover:scale-105"
      >
        {abierto ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-6 w-6" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        ) : (
          <IconoWhatsApp clase="h-7 w-7" />
        )}
      </button>
    </div>
  )
}
