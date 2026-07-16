import type { NextRequest } from 'next/server'
import { actualizarSesion } from '@suite/auth/middleware'

export async function middleware(request: NextRequest) {
  return actualizarSesion(request, process.env.NEXT_PUBLIC_URL_WEB + '/login')
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/pagos-suscripcion|mock-pago).*)'],
}
