// Escape mínimo para interpolar texto de usuario en HTML de correo. Cubre los cinco
// caracteres que rompen el markup o habilitan XSS. `&` va PRIMERO: si no, re-escaparía
// el `&` de las entidades que introducen los reemplazos siguientes. Las plantillas lo
// aplican a CADA string de origen usuario (razón social de empresa y cliente, glosa /
// nombre de línea, destino de ODE); montos, folios y fechas van formateados = seguros.
// El asunto NO pasa por aquí (header de texto plano vía API JSON).
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
