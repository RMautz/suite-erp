// Un envio de WhatsApp: telefono E.164 + texto plano. `plantilla` (opcional) es el
// nombre de la plantilla HSM aprobada por Meta para mensajes business-initiated —
// va en la interface desde ya (spec §2) pero AMBOS adaptadores la ignoran hoy: las
// HSM reales van con la credencial #15 (fuera de alcance §9); dentro de la ventana
// de 24 h el texto libre es valido.
export interface ProveedorWhatsApp {
  enviarTexto(telefono: string, texto: string, plantilla?: string): Promise<void>
}

// Mensaje guardado por MockWhatsApp (lo lee el simulador /mock-whatsapp).
export interface WhatsAppMock {
  id: string
  telefono: string
  texto: string
}
