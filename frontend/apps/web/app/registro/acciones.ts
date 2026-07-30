'use server'

import { redirect } from 'next/navigation'
import { RUBROS, validarRut } from '@suite/core'
import { crearClienteServidor } from '@suite/auth/server'
import type { EstadoForm } from '../tipos'

export async function registrar(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const rut = String(formData.get('rut') ?? '').trim()
  const razonSocial = String(formData.get('razon_social') ?? '').trim()
  const rubro = String(formData.get('rubro') ?? '')

  if (!email.includes('@')) return { error: 'Ingresa un correo válido' }
  if (password.length < 8) return { error: 'La contraseña debe tener al menos 8 caracteres' }
  if (!validarRut(rut)) return { error: 'El RUT ingresado no es válido' }
  if (!razonSocial) return { error: 'Ingresa la razón social de tu empresa' }
  if (!RUBROS.some((r) => r.codigo === rubro)) return { error: 'Elige el rubro de tu Pyme' }

  const supabase = await crearClienteServidor()

  // Reintento tras un fallo posterior (ej. RUT duplicado): si ya hay sesión o el
  // correo ya tiene cuenta, no volver a crear el usuario — así el segundo envío
  // del formulario llega al RPC en vez de morir en "User already registered".
  let {
    data: { user },
  } = await supabase.auth.getUser()
  if (user && user.email?.toLowerCase() !== email.toLowerCase()) {
    // Registrar OTRA cuenta con la sesion viva (mas RUTs por usuario, 2026-07-22): se
    // suelta la sesion SOLO en este navegador (scope local, no revoca otros equipos)
    // y se sigue como registro nuevo. Cambiar de cuenta = volver a iniciar sesion.
    await supabase.auth.signOut({ scope: 'local' })
    user = null
  }
  if (!user) {
    const { error: errorAuth } = await supabase.auth.signUp({ email, password })
    if (errorAuth?.code === 'user_already_exists') {
      const { error: errorLogin } = await supabase.auth.signInWithPassword({ email, password })
      if (errorLogin) return { error: 'Este correo ya tiene una cuenta. Inicia sesión para continuar.' }
    } else if (errorAuth) {
      console.error('Error de signUp en registro:', errorAuth)
      return { error: 'No se pudo crear la cuenta. Inténtalo de nuevo en unos minutos.' }
    }
  }

  // La BD normaliza y valida el RUT de nuevo (última línea de defensa).
  const { error: errorOrg } = await supabase.rpc('registrar_organizacion', {
    p_rut: rut,
    p_razon_social: razonSocial,
    p_rubro: rubro,
  })
  if (errorOrg) return { error: errorOrg.message }

  redirect('/registro/exito')
}
