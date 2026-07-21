// Heuristica de GUIA (spec §2.3): no es el gate — el minimo de 8 lo valida el action.
export type Fuerza = { nivel: 0 | 1 | 2 | 3; etiqueta: '' | 'Débil' | 'Aceptable' | 'Fuerte' }

export function fuerzaPassword(password: string): Fuerza {
  if (password.length === 0) return { nivel: 0, etiqueta: '' }
  if (password.length < 8) return { nivel: 1, etiqueta: 'Débil' }
  const clases = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length
  if (password.length >= 12 && clases >= 3) return { nivel: 3, etiqueta: 'Fuerte' }
  if (clases >= 2) return { nivel: 2, etiqueta: 'Aceptable' }
  return { nivel: 1, etiqueta: 'Débil' }
}
