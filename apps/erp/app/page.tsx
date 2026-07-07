import { crearClienteServidor } from '@suite/auth/server'
import { formatearRut } from '@suite/core'

export default async function Inicio() {
  const supabase = await crearClienteServidor()
  const { data: organizaciones, error } = await supabase
    .from('organizaciones')
    .select('id, razon_social, estado, trial_hasta, empresas (id, rut, razon_social)')

  if (error) throw new Error('No se pudieron cargar tus organizaciones')

  if (!organizaciones || organizaciones.length === 0) {
    return (
      <main style={{ maxWidth: 720, margin: '4rem auto', padding: '0 1rem' }}>
        <h1>Sin organización</h1>
        <p>
          Tu usuario no pertenece a ninguna organización. Pide una invitación o{' '}
          <a href={process.env.NEXT_PUBLIC_URL_WEB + '/registro'}>crea tu cuenta</a>.
        </p>
      </main>
    )
  }

  return (
    <main style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Suite ERP</h1>
      {organizaciones.map((org) => (
        <section key={org.id} style={{ border: '1px solid #ddd', padding: 16, marginBottom: 16 }}>
          <h2>{org.razon_social}</h2>
          {org.estado === 'trial' && (
            <p style={{ background: '#fff3cd', padding: 8 }}>
              Período de prueba hasta el {new Date(org.trial_hasta).toLocaleDateString('es-CL')}.
            </p>
          )}
          {org.estado === 'suspendida' && (
            <p style={{ background: '#f8d7da', padding: 8 }}>
              Organización suspendida. Contáctanos para reactivarla.
            </p>
          )}
          <h3>Empresas</h3>
          <ul>
            {org.empresas.map((empresa) => (
              <li key={empresa.id}>
                {empresa.razon_social} — {formatearRut(empresa.rut)}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  )
}
