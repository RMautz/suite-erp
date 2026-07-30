'use server'

import { MockMotorVentas } from '@suite/bot'
import { crearClienteServidor } from '@suite/auth/server'
import { avisarLeadAdmin } from '../../lib/aviso-ticket'

// Chat de ventas de la landing (spec 2026-07-24): visitantes ANONIMOS. Stateless:
// el cliente guarda el hilo en su estado; el lead es la unica persistencia. El
// motor es scriptado (persona IA = seam credencial #12).
export async function responderVentas(mensaje: string): Promise<string> {
  const texto = String(mensaje ?? '').slice(0, 1000)
  const motor = new MockMotorVentas({
    async guardarLead(nombre, email, telefono, mensajeLead) {
      const supabase = await crearClienteServidor()
      const { data: numero, error } = await supabase.rpc('crear_lead', {
        p_nombre: nombre,
        p_email: email,
        p_telefono: telefono ?? '',
        p_mensaje: mensajeLead ?? '',
      })
      // Los mensajes de validacion de la RPC son aptos para el visitante; el motor
      // los relata tal cual.
      if (error || numero == null) throw new Error(error?.message ?? 'No pudimos registrar tus datos.')
      await avisarLeadAdmin({ numero: Number(numero), nombre, email, telefono, mensaje: mensajeLead })
      return { numero: Number(numero) }
    },
  })
  return motor.responder(texto)
}
