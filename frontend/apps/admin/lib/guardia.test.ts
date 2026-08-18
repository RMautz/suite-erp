import { beforeEach, describe, expect, it, vi } from 'vitest'

// server-only revienta al importarse fuera del runtime RSC y aqui no aporta nada.
vi.mock('server-only', () => ({}))

// redirect() de Next interrumpe la ejecucion lanzando NEXT_REDIRECT. Replicamos
// ese contrato para poder afirmar las dos cosas que importan: a donde manda al
// visitante, y que el caller efectivamente se corta.
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    const senal = new Error(`NEXT_REDIRECT:${destino}`)
    Object.assign(senal, { destino })
    throw senal
  },
}))

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }))
vi.mock('@suite/auth/server', () => ({
  crearClienteServidor: async () => ({ auth: { getUser } }),
}))

const { esAdmin, verificarAdmin } = await import('./guardia')

const sesionDe = (email: string | null) => ({
  data: { user: email === null ? null : { email } },
})

/** Devuelve el destino del redirect, o falla si la ejecucion siguio de largo. */
async function destinoDelRedirect(fn: () => Promise<void>): Promise<string> {
  try {
    await fn()
  } catch (e) {
    const destino = (e as { destino?: string }).destino
    if (destino) return destino
    throw e
  }
  throw new Error('se esperaba un redirect y la ejecucion continuo')
}

describe('esAdmin', () => {
  it('acepta el correo de la lista sin importar mayusculas ni espacios', () => {
    expect(esAdmin('Ada@letier.cl', ' ada@letier.cl , otro@letier.cl ')).toBe(true)
  })

  it('rechaza un correo fuera de la lista', () => {
    expect(esAdmin('intruso@letier.cl', 'ada@letier.cl')).toBe(false)
  })

  it('rechaza cuando no hay correo o la lista viene vacia', () => {
    expect(esAdmin(null, 'ada@letier.cl')).toBe(false)
    expect(esAdmin('ada@letier.cl', '')).toBe(false)
    expect(esAdmin('ada@letier.cl', undefined)).toBe(false)
  })
})

describe('verificarAdmin', () => {
  beforeEach(() => {
    getUser.mockReset()
    process.env.NEXT_PUBLIC_URL_WEB = 'https://www.letier.cl'
    process.env.ADMIN_EMAILS = 'ada@letier.cl'
  })

  it('manda al login al visitante sin sesion', async () => {
    getUser.mockResolvedValue(sesionDe(null))
    expect(await destinoDelRedirect(verificarAdmin)).toBe('https://www.letier.cl/login')
  })

  // El bug: este caso lanzaba Error y la raiz del panel respondia 500.
  it('manda a sin-acceso al visitante con sesion pero sin permisos', async () => {
    getUser.mockResolvedValue(sesionDe('intruso@letier.cl'))
    expect(await destinoDelRedirect(verificarAdmin)).toBe('/sin-acceso')
  })

  it('nunca deja pasar a un no-admin: siempre interrumpe', async () => {
    for (const email of [null, 'intruso@letier.cl']) {
      getUser.mockResolvedValue(sesionDe(email))
      await expect(verificarAdmin()).rejects.toThrow(/NEXT_REDIRECT/)
    }
  })

  it('deja pasar al admin de la lista', async () => {
    getUser.mockResolvedValue(sesionDe('ada@letier.cl'))
    await expect(verificarAdmin()).resolves.toBeUndefined()
  })
})
