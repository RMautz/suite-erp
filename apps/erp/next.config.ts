import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@suite/core', '@suite/db', '@suite/auth', '@suite/ui'],
  experimental: {
    // 11 MB: margen sobre el tope real de 10 MB para que el check
    // `archivo.size > 10MB` de la action llegue a ejecutarse y dé el mensaje
    // claro, en vez de que Next corte el POST justo en el límite y el
    // usuario reciba el error genérico del framework. Este bodySizeLimit es
    // GLOBAL a la app (toda Server Action, no solo importarCargasTct); se
    // acepta porque todas las actions son autenticadas de un solo tenant.
    serverActions: { bodySizeLimit: '11mb' },
  },
}

export default config
