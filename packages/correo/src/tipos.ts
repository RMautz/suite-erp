// Contrato del proveedor de correo (spec §4). ProveedorCorreo abstrae el envío para
// que la app opere igual contra MockCorreo (dev/visor) y ResendCorreo (real), elegidos
// por env — mismo patrón que @suite/pagos y @suite/dte.

// Un mensaje listo para enviar: destinatario + asunto + cuerpo HTML.
export interface Mensaje {
  para: string
  asunto: string
  html: string
}

export interface ProveedorCorreo {
  enviar(mensaje: Mensaje): Promise<{ id: string }>
}

// Lo que devuelve una plantilla: asunto (texto plano, NO escapado) + cuerpo HTML (con
// cada dato de usuario ya escapado). La action le agrega `para` (clientes.email) para
// formar el Mensaje — la plantilla no conoce al destinatario.
export interface ContenidoCorreo {
  asunto: string
  html: string
}

// Correo guardado por MockCorreo (lo lee el visor /mock-correo). Sin fecha: el
// "Enviado el ..." de la UI sale de correos_enviados en BD, no del store efímero.
export interface CorreoMock {
  id: string
  para: string
  asunto: string
  html: string
}

// ----- Entradas de las plantillas: datos PLANOS. La action los arma desde @suite/db;
//       el package NO depende de @suite/db (evita acoplar el formato al schema). Montos
//       en pesos (enteros); TODA fecha llega YA FORMATEADA es-CL (la action la pasa por
//       `new Date(x).toLocaleDateString('es-CL')` ANTES de pasar) = segura. Los strings de
//       origen usuario los escapa la plantilla. La razón social del cliente va PLANA
//       (`clienteRazonSocial`), como la arma la action desde el join con `clientes`. -----

// Identidad de la empresa emisora. razonSocial se escapa en el HTML; rut se formatea.
export interface EmpresaCorreo {
  razonSocial: string
  rut: string
}

// Línea de cotización o documento. descripcion (glosa / nombre de producto o servicio)
// se escapa; precioNeto (unitario) y subtotal van formateados.
export interface LineaCorreo {
  descripcion: string
  cantidad: number
  precioNeto: number
  subtotal: number
}

// Una ODE de la nómina de la proforma (spec §4). destino (nombre del destino) se escapa;
// numero, bultos, kiloAfecto y neto son numéricos = seguros.
export interface OdeCorreo {
  numero: number
  destino: string
  bultos: number
  kiloAfecto: number
  neto: number
}

// clienteRazonSocial se escapa en el HTML. fecha y validez llegan ya formateadas es-CL.
export interface DatosCotizacion {
  empresa: EmpresaCorreo
  clienteRazonSocial: string
  numero: number
  fecha: string
  validez: string
  lineas: LineaCorreo[]
  neto: number
  exento: number
  iva: number
  total: number
}

// La proforma lista sus ODEs (no líneas de detalle). fecha llega ya formateada es-CL.
export interface DatosProforma {
  empresa: EmpresaCorreo
  clienteRazonSocial: string
  numero: number
  fecha: string
  odes: OdeCorreo[]
  neto: number
  iva: number
  total: number
}

// tipo: 'factura' | 'boleta' en minúscula (enum de BD → seguro, no se escapa); la plantilla
// capitaliza la ETIQUETA ('Factura'/'Boleta'). fecha llega ya formateada es-CL.
export interface DatosDocumento {
  empresa: EmpresaCorreo
  clienteRazonSocial: string
  tipo: 'factura' | 'boleta'
  folio: number
  fecha: string
  lineas: LineaCorreo[]
  neto: number
  exento: number
  iva: number
  total: number
}

// Recordatorio de una factura/boleta vencida con saldo. tipo en minúscula (la plantilla
// capitaliza la etiqueta). fechaVencimiento llega ya formateada es-CL.
export interface DatosRecordatorio {
  empresa: EmpresaCorreo
  clienteRazonSocial: string
  tipo: 'factura' | 'boleta'
  folio: number
  total: number
  saldo: number
  fechaVencimiento: string
}

// Aviso al administrador de la PLATAFORMA por un ticket nuevo (spec tickets
// 2026-07-22): no es correo de una empresa, no usa EmpresaCorreo ni envolver().
export interface DatosTicketAdmin {
  numero: number
  organizacion: string
  rut: string
  autorEmail: string
  asunto: string
  mensaje: string
  origen: 'web' | 'whatsapp'
}
