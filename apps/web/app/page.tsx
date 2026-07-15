import Link from 'next/link'
import { Hero } from '../componentes/landing/hero'
import { Modulos } from '../componentes/landing/modulos'
import { Precios } from '../componentes/landing/precios'

export default function Inicio() {
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
          <Link href="/login" className="font-semibold text-marca-700">
            Iniciar sesión
          </Link>
          <Link
            href="/registro"
            className="rounded-lg bg-gradient-to-br from-marca-600 to-marca-700 px-4 py-2 font-semibold text-white shadow-md shadow-marca-600/30"
          >
            Prueba gratis
          </Link>
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
    </main>
  )
}
