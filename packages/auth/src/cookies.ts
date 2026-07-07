export interface OpcionesCookie {
  domain?: string
  path?: string
  sameSite?: 'lax'
  secure?: boolean
}

export function dominioCookie(
  dominio: string | undefined = process.env.NEXT_PUBLIC_COOKIE_DOMAIN
): OpcionesCookie {
  if (!dominio) return {}
  return { domain: dominio, path: '/', sameSite: 'lax', secure: true }
}
