// E.164 estricto — MISMO regex que el CHECK de whatsapp_vinculos (migracion 0028):
// '+', primer digito 1-9, 8 a 15 digitos en total.
const RE_E164 = /^\+[1-9][0-9]{7,14}$/

export function esTelefonoE164(telefono: string): boolean {
  return RE_E164.test(telefono)
}
