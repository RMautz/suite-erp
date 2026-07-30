import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return new Response('No autorizado', { status: 401 })
  const supabase = await crearClienteServidor()
  const { data: doc } = await supabase
    .from('documentos_venta').select('pdf_ruta').eq('id', id).eq('empresa_id', activa.id).single()
  if (!doc?.pdf_ruta) return new Response('PDF no disponible', { status: 404 })
  // v1: pdf_ruta guarda el PDF en base64 devuelto por el proveedor (mock/real).
  const pdf = Buffer.from(doc.pdf_ruta, 'base64')
  return new Response(pdf, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="documento-${id}.pdf"` },
  })
}
