export type {
  ContenidoCorreo,
  CorreoMock,
  DatosCotizacion,
  DatosDocumento,
  DatosProforma,
  DatosRecordatorio,
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
} from './plantillas'
export { MockCorreo, correosMockEnviados, limpiarCorreosMock } from './mock'
export { ResendCorreo } from './resend'
export { correoPorAmbiente } from './seleccionar'
