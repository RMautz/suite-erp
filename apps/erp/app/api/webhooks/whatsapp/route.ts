import { clienteAdmin } from '@suite/auth/admin'
import { DISCULPA_BOT, motorPorAmbiente, type MotorBot, type TurnoHistorial } from '@suite/bot'
import { verificarFirma, whatsappPorAmbiente, type ProveedorWhatsApp } from '@suite/whatsapp'
import { herramientasBot } from '../../../../lib/bot-herramientas'

// Webhook de WhatsApp (Plan 21, spec §5). GET = verificacion de Meta (hub.challenge).
// POST nunca-lanza (200 SIEMPRE; 500 solo ante errores de BD transitorios, para que
// Meta reintente). Sin vinculo verificado -> instrucciones de vinculacion, CERO datos.
// Con vinculo -> herramientas de SU empresa (patron webhook MP P13) -> motor -> log
// entrante/saliente -> envio. Vive bajo api/webhooks/ para heredar la exclusion del
// middleware sin tocar el matcher.

const SIN_VINCULO =
  'Este número no está vinculado a ninguna empresa. El dueño o admin puede vincularlo en el ERP: Configuración → WhatsApp.'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const esperado = process.env.WHATSAPP_VERIFY_TOKEN
  const challenge = url.searchParams.get('hub.challenge')
  if (
    url.searchParams.get('hub.mode') === 'subscribe' &&
    esperado &&
    url.searchParams.get('hub.verify_token') === esperado &&
    challenge
  ) {
    return new Response(challenge, { status: 200 })
  }
  return new Response(null, { status: 403 })
}

// Payload de Meta: entry[].changes[].value.messages[] con from (SIN '+') y text.body.
// El simulador /mock-whatsapp postea este mismo shape.
function parsearEntrante(crudo: string): { telefono: string; texto: string } | null {
  try {
    const cuerpo = JSON.parse(crudo) as {
      entry?: { changes?: { value?: { messages?: { from?: string; type?: string; text?: { body?: string } }[] } }[] }[]
    }
    const msg = cuerpo.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
    if (!msg || msg.type !== 'text' || !msg.from || !msg.text?.body) return null
    return { telefono: '+' + msg.from.replace(/^\+/, ''), texto: msg.text.body }
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const crudo = await req.text().catch(() => '')
  const perilla = process.env.PROVEEDOR_WHATSAPP

  // El bypass de firma del modo mock es SOLO para desarrollo local: en un deploy
  // publico aceptaria POSTs sin firmar (hallazgo review final P21).
  if (perilla === 'mock' && process.env.NODE_ENV === 'production') {
    console.error('webhook whatsapp: modo mock vetado en producción')
    return new Response(null, { status: 200 })
  }

  // Firma obligatoria en cloud (invalida -> 200 silencioso); bypass SOLO en mock (el
  // simulador postea sin firmar); sin perilla valida no se procesa nada (fail-closed).
  if (perilla === 'cloud') {
    if (!verificarFirma(crudo, req.headers.get('x-hub-signature-256'), process.env.WHATSAPP_APP_SECRET ?? '')) {
      console.error('webhook whatsapp: firma inválida')
      return new Response(null, { status: 200 })
    }
  } else if (perilla !== 'mock') {
    console.error('webhook whatsapp: PROVEEDOR_WHATSAPP no configurado')
    return new Response(null, { status: 200 })
  }

  const entrante = parsearEntrante(crudo)
  if (!entrante) return new Response(null, { status: 200 })

  let proveedor: ProveedorWhatsApp
  let motor: MotorBot
  let admin: ReturnType<typeof clienteAdmin>
  try {
    proveedor = whatsappPorAmbiente(
      perilla,
      process.env.WHATSAPP_TOKEN,
      process.env.WHATSAPP_PHONE_ID,
      process.env.WHATSAPP_VERIFY_TOKEN,
      process.env.WHATSAPP_APP_SECRET,
    )
    motor = motorPorAmbiente(process.env.MOTOR_BOT, process.env.ANTHROPIC_API_KEY, process.env.MOTOR_BOT_MODELO)
    admin = clienteAdmin()
  } catch (e) {
    console.error('webhook whatsapp:', e instanceof Error ? e.message : 'selector no configurado')
    return new Response(null, { status: 200 })
  }

  // El vinculo verificado y activo es la UNICA llave de entrada a datos.
  const { data: vinculo, error: eVinculo } = await admin
    .from('whatsapp_vinculos')
    .select('empresa_id, usuario_id')
    .eq('telefono', entrante.telefono)
    .eq('activo', true)
    .not('verificado_en', 'is', null)
    .maybeSingle()
  if (eVinculo) {
    console.error('webhook whatsapp: error de BD al resolver el vínculo:', eVinculo.message)
    return new Response(null, { status: 500 })
  }
  if (!vinculo) {
    try {
      await proveedor.enviarTexto(entrante.telefono, SIN_VINCULO)
    } catch {
      // nunca-lanza: el numero desconocido simplemente no recibe respuesta.
    }
    return new Response(null, { status: 200 })
  }

  const { data: empresa, error: eEmpresa } = await admin
    .from('empresas')
    .select('razon_social, rut, organizacion_id')
    .eq('id', vinculo.empresa_id)
    .maybeSingle()
  if (eEmpresa) {
    console.error('webhook whatsapp: error de BD al resolver la empresa:', eEmpresa.message)
    return new Response(null, { status: 500 })
  }
  if (!empresa) {
    console.error('webhook whatsapp: vínculo sin empresa:', vinculo.empresa_id)
    return new Response(null, { status: 200 })
  }
  const { data: miembro, error: eMiembro } = await admin
    .from('miembros')
    .select('rol')
    .eq('organizacion_id', empresa.organizacion_id)
    .eq('usuario_id', vinculo.usuario_id)
    .eq('estado', 'activo')
    .maybeSingle()
  if (eMiembro) {
    console.error('webhook whatsapp: error de BD al resolver el miembro:', eMiembro.message)
    return new Response(null, { status: 500 })
  }

  // El vinculo muere con la membresia (hallazgo review T5): sin miembro activo
  // dueno/admin, el telefono queda como no vinculado — CERO datos, fail-closed.
  if (!miembro || (miembro.rol !== 'dueno' && miembro.rol !== 'admin')) {
    try {
      await proveedor.enviarTexto(entrante.telefono, SIN_VINCULO)
    } catch {
      // nunca-lanza
    }
    return new Response(null, { status: 200 })
  }

  // Historial: ultimos 10 mensajes del telefono, en orden cronologico para el motor.
  const { data: previos } = await admin
    .from('whatsapp_mensajes')
    .select('direccion, contenido')
    .eq('empresa_id', vinculo.empresa_id)
    .eq('telefono', entrante.telefono)
    .order('creado_en', { ascending: false })
    .limit(10)
  const historial: TurnoHistorial[] = (previos ?? [])
    .reverse()
    .map((m) => ({ direccion: m.direccion === 'saliente' ? 'saliente' : 'entrante', contenido: m.contenido }))

  const { error: eLogIn } = await admin.from('whatsapp_mensajes').insert({
    empresa_id: vinculo.empresa_id,
    telefono: entrante.telefono,
    direccion: 'entrante',
    origen: 'bot',
    contenido: entrante.texto,
  })
  if (eLogIn) {
    console.error('webhook whatsapp: error de BD al loguear el entrante:', eLogIn.message)
    return new Response(null, { status: 500 })
  }

  let respuesta: string
  try {
    respuesta = await motor.responder(
      {
        nombreEmpresa: empresa.razon_social,
        rol: miembro.rol,
        historial,
        herramientas: herramientasBot(
          admin,
          vinculo.empresa_id,
          { razonSocial: empresa.razon_social, rut: empresa.rut },
          vinculo.usuario_id,
        ),
      },
      entrante.texto,
    )
  } catch (e) {
    // ClaudeMotor nunca lanza; esto cubre un throw de herramienta bajo MockMotor.
    console.error('webhook whatsapp: motor:', e instanceof Error ? e.message : 'error desconocido')
    respuesta = DISCULPA_BOT
  }

  const { error: eLogOut } = await admin.from('whatsapp_mensajes').insert({
    empresa_id: vinculo.empresa_id,
    telefono: entrante.telefono,
    direccion: 'saliente',
    origen: 'bot',
    contenido: respuesta,
  })
  if (eLogOut) console.error('webhook whatsapp: error de BD al loguear el saliente:', eLogOut.message)

  try {
    await proveedor.enviarTexto(entrante.telefono, respuesta)
  } catch {
    // El envio fallo pero el log ya quedo; Meta no debe reintentar (el motor ya corrio).
  }
  return new Response(null, { status: 200 })
}
