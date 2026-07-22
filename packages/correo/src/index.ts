export type {
  ContenidoCorreo,
  CorreoMock,
  DatosCotizacion,
  DatosDocumento,
  DatosProforma,
  DatosRecordatorio,
  DatosTicketAdmin,
  EmpresaCorreo,
  LineaCorreo,
  Mensaje,
  OdeCorreo,
  ProveedorCorreo,
} from './tipos'
export { escaparHtml } from './escapar'
export {
  plantillaCotizacion,
  plantillaDocumento,
  plantillaProforma,
  plantillaRecordatorio,
  plantillaTicketAdmin,
} from './plantillas'
export { MockCorreo, correosMockEnviados, limpiarCorreosMock } from './mock'
export { ResendCorreo } from './resend'
export { correoPorAmbiente } from './seleccionar'
