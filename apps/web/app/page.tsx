import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { cerrarSesion } from './acciones'
import { ChatVentas } from '../componentes/chat-ventas'
import { Hero } from '../componentes/landing/hero'
import { Modulos } from '../componentes/landing/modulos'
import { Precios } from '../componentes/landing/precios'
import { urlMiCuenta } from '../lib/plataforma'

// Con sesion viva la landing ofrece la vuelta a la plataforma ("Mi cuenta"). Leer
// cookies vuelve la pagina dinamica: correcto, el saludo es por visitante. Cualquier
// fallo de auth (token vencido, cookies rancias) degrada a la vista sin sesion.
async function sesionActual(): Promise<{ email: string; destino: string } | null> {
  try {
    const supabase = await crearClienteServidor()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user?.email) return null
    return { email: user.email, destino: await urlMiCuenta(supabase, user.email) }
  } catch {
    return null
  }
}

export default async function Inicio() {
  const sesion = await sesionActual()
  return (
    <main className="mx-auto max-w-6xl">
      <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4 sm:px-10">
        <div className="flex items-center gap-2 font-bold text-slate-900">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-marca-500 to-marca-700 text-sm text-white">
            S
          </span>
          Suite ERP
        </div>
        <nav className="hidden gap-6 text-sm text-slate-600 sm:flex">
          <a href="#modulos">Módulos</a>
          <a href="#precios">Precios</a>
        </nav>
        <div className="flex items-center gap-3 text-sm">
          {sesion && <span className="hidden text-slate-500 sm:inline">{sesion.email}</span>}
          <Link href="/login" className="font-semibold text-marca-700">
            Iniciar sesión
          </Link>
          <Link
            href="/registro"
            className={
              sesion
                ? 'font-semibold text-marca-700'
                : 'rounded-lg bg-gradient-to-br from-marca-600 to-marca-700 px-4 py-2 font-semibold text-white shadow-md shadow-marca-600/30'
            }
          >
            Prueba gratis
          </Link>
          {sesion &&
            (sesion.destino === process.env.NEXT_PUBLIC_URL_ADMIN ? (
              // Menu del ADMIN de plataforma (mismo tratamiento que la cuenta empresa).
              <details className="relative">
                <summary className="cursor-pointer list-none rounded-lg bg-gradient-to-br from-marca-600 to-marca-700 px-4 py-2 font-semibold text-white shadow-md shadow-marca-600/30 [&::-webkit-details-marker]:hidden">
                  Mi cuenta ▾
                </summary>
                <div className="absolute right-0 z-10 mt-2 w-60 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/10">
                  <a
                    href={sesion.destino}
                    className="block rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-marca-50 hover:text-marca-700"
                  >
                    Entrar al panel
                  </a>
                  <a
                    href={`${sesion.destino}/consultas`}
                    className="block rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-marca-50 hover:text-marca-700"
                  >
                    Consultas
                  </a>
                  <a
                    href={`${sesion.destino}/leads`}
                    className="block rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-marca-50 hover:text-marca-700"
                  >
                    Leads
                  </a>
                  <form action={cerrarSesion} className="border-t border-slate-100 pt-1.5 mt-1.5">
                    <button
                      type="submit"
                      className="block w-full rounded-lg px-3 py-2 text-left font-medium text-slate-700 hover:bg-red-50 hover:text-red-700"
                    >
                      Cerrar sesión
                    </button>
                  </form>
                </div>
              </details>
            ) : (
              // Menu nativo (details/summary): entrar al ERP o ir directo a la suscripcion.
              <details className="relative">
                <summary className="cursor-pointer list-none rounded-lg bg-gradient-to-br from-marca-600 to-marca-700 px-4 py-2 font-semibold text-white shadow-md shadow-marca-600/30 [&::-webkit-details-marker]:hidden">
                  Mi cuenta ▾
                </summary>
                <div className="absolute right-0 z-10 mt-2 w-60 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/10">
                  <a
                    href={sesion.destino}
                    className="block rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-marca-50 hover:text-marca-700"
                  >
                    Entrar al ERP
                  </a>
                  <a
                    href={`${sesion.destino}/configuracion/suscripcion`}
                    className="block rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-marca-50 hover:text-marca-700"
                  >
                    Gestionar suscripción
                  </a>
                  <Link
                    href="/consultas"
                    className="block rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-marca-50 hover:text-marca-700"
                  >
                    Consultar a administración
                  </Link>
                  <form action={cerrarSesion} className="border-t border-slate-100 pt-1.5 mt-1.5">
                    <button
                      type="submit"
                      className="block w-full rounded-lg px-3 py-2 text-left font-medium text-slate-700 hover:bg-red-50 hover:text-red-700"
                    >
                      Cerrar sesión
                    </button>
                  </form>
                </div>
              </details>
            ))}
        </div>
      </header>

      <Hero />
      <Modulos />
      <Precios />

      <section className="bg-gradient-to-br from-marca-700 via-marca-600 to-cyan-500 px-6 py-14 text-center text-white">
        <h2 className="text-2xl font-bold">Deja las planillas hoy</h2>
        <p className="mt-1 text-marca-100">Crea tu cuenta y emite tu primer documento en menos de 10 minutos.</p>
        <Link href="/registro" className="mt-5 inline-block rounded-lg bg-white px-5 py-2.5 font-semibold text-marca-800">
          Prueba gratis 14 días
        </Link>
      </section>

      <footer className="flex justify-between px-6 py-5 text-sm text-slate-400 sm:px-10">
        <span>© 2026 Suite ERP</span>
        <span>contacto@suite-erp.cl</span>
      </footer>

      <ChatVentas />
    </main>
  )
}
