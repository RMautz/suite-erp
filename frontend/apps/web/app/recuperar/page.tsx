import Link from 'next/link'
import { MarcoRecuperacion } from '../../componentes/tarjeta-recuperacion'
import { FormularioRecuperar } from './formulario'

// Server component: lee ?expirado=1 (a donde manda /auth/confirm cuando el enlace
// no canjea) y delega las vistas al client component.
export default async function PaginaRecuperar({ searchParams }: { searchParams: Promise<{ expirado?: string }> }) {
  const { expirado = '' } = await searchParams
  return (
    <MarcoRecuperacion
      pie={
        <Link href="/login" className="font-semibold text-marca-700 hover:underline">
          Volver a iniciar sesión
        </Link>
      }
    >
      <FormularioRecuperar expirado={expirado === '1'} />
    </MarcoRecuperacion>
  )
}
