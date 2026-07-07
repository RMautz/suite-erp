import Link from 'next/link'

export default function Inicio() {
  return (
    <main style={{ maxWidth: 720, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Suite ERP</h1>
      <p>
        Ventas, facturación electrónica e inventario para pymes chilenas.
        100% web. Prueba gratis por 14 días.
      </p>
      <p>
        <Link href="/registro">Crear cuenta</Link> · <Link href="/login">Iniciar sesión</Link>
      </p>
    </main>
  )
}
