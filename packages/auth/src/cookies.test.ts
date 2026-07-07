import { describe, expect, it } from 'vitest'
import { dominioCookie } from './cookies'

describe('dominioCookie', () => {
  it('sin dominio configurado devuelve objeto vacío (cookies por host, dev local)', () => {
    expect(dominioCookie(undefined)).toEqual({})
    expect(dominioCookie('')).toEqual({})
  })
  it('con dominio configurado habilita SSO entre subdominios', () => {
    expect(dominioCookie('.misuite.cl')).toEqual({
      domain: '.misuite.cl',
      path: '/',
      sameSite: 'lax',
      secure: true,
    })
  })
})
