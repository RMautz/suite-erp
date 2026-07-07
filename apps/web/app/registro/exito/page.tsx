export default function RegistroExitoso() {
  return (
    <main style={{ maxWidth: 420, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>¡Cuenta creada!</h1>
      <p>Tu organización quedó registrada con 14 días de prueba.</p>
      <a href={process.env.NEXT_PUBLIC_URL_ERP}>Entrar al ERP</a>
    </main>
  )
}
