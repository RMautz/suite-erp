import Link from 'next/link'
import { FormularioRecuperar } from './formulario'

// Server component: lee ?expirado=1 (a donde manda /auth/confirm cuando el enlace
// no canjea) y delega el formulario al client component.
export default async function PaginaRecuperar({ searchParams }: { searchParams: Promise<{ expirado?: string }> }) {
  const { expirado = '' } = await searchParams
  return (
    <main
      className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10"
      style={{ background: 'radial-gradient(900px 420px at 50% -10%, #e0f2fe 0%, rgba(224,242,254,0) 60%), #f8fafc' }}
    >
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 block text-center text-2xl font-bold tracking-tight text-slate-900">
          Suite <span className="bg-gradient-to-r from-marca-600 to-cyan-500 bg-clip-text text-transparent">ERP</span>
        </Link>
        <FormularioRecuperar expirado={expirado === '1'} />
        <p className="mt-6 text-center text-sm text-slate-500">
          <Link href="/login" className="font-semibold text-marca-700 hover:underline">
            Volver a iniciar sesión
          </Link>
        </p>
      </div>
    </main>
  )
}
