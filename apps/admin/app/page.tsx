import { clienteAdmin } from '@suite/auth/admin'
import { formatearRut } from '@suite/core'
import { verificarAdmin } from '../lib/guardia'
import { activarOrganizacion, suspenderOrganizacion } from './acciones'

export default async function PanelAdmin() {
  await verificarAdmin()
  const admin = clienteAdmin()
  const { data: organizaciones, error } = await admin
    .from('organizaciones')
    .select('id, rut, razon_social, estado, trial_hasta, creado_en, planes (nombre), suscripciones (hasta)')
    .order('creado_en', { ascending: false })

  if (error) throw new Error('No se pudieron cargar las organizaciones')

  return (
    <main style={{ maxWidth: 960, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Organizaciones ({organizaciones?.length ?? 0})</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th align="left">RUT</th>
            <th align="left">Razón social</th>
            <th align="left">Plan</th>
            <th align="left">Estado</th>
            <th align="left">Trial hasta</th>
            <th align="left">Suscrita hasta</th>
            <th align="left">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {organizaciones?.map((org) => (
            <tr key={org.id} style={{ borderTop: '1px solid #ddd' }}>
              <td>{formatearRut(org.rut)}</td>
              <td>{org.razon_social}</td>
              <td>{org.planes?.nombre ?? '—'}</td>
              <td>{org.estado}</td>
              <td>{new Date(org.trial_hasta + 'T00:00:00').toLocaleDateString('es-CL')}</td>
              <td>
                {org.suscripciones?.hasta
                  ? new Date(org.suscripciones.hasta + 'T00:00:00').toLocaleDateString('es-CL')
                  : '—'}
              </td>
              <td>
                <form action={activarOrganizacion} style={{ display: 'inline' }}>
                  <input type="hidden" name="id" value={org.id} />
                  <button type="submit" disabled={org.estado === 'activa'}>Activar</button>
                </form>{' '}
                <form action={suspenderOrganizacion} style={{ display: 'inline' }}>
                  <input type="hidden" name="id" value={org.id} />
                  <button type="submit" disabled={org.estado === 'suspendida'}>Suspender</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
