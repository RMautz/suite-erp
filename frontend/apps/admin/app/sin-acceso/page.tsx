// Destino de verificarAdmin() cuando la sesion es valida pero el correo no esta
// en ADMIN_EMAILS. No llama al guard (seria un bucle de redirects) y no muestra
// ningun dato del panel: solo explica por que no hay acceso.
export const metadata = { title: 'Sin acceso — Panel de plataforma' }

export default function SinAcceso() {
  return (
    <div className="mx-auto max-w-lg py-12 text-center">
      <h1 className="text-2xl font-bold text-slate-900">Sin acceso al panel</h1>
      <p className="mt-3 text-sm text-slate-600">
        Tu sesión está activa, pero esta cuenta no tiene permisos de administrador de la
        plataforma. Si crees que es un error, pide que agreguen tu correo a la lista de
        administradores.
      </p>
      <a
        href={process.env.NEXT_PUBLIC_URL_WEB}
        className="mt-8 inline-block text-sm font-medium text-marca-700 hover:underline"
      >
        Volver a Letier
      </a>
    </div>
  )
}
