import type { NextConfig } from 'next'

const config: NextConfig = {
  // La app vive bajo www.letier.cl/erp/admin (multi-zone: el sitio letier hace rewrite).
  basePath: '/erp/admin',
  transpilePackages: ['@suite/core', '@suite/db', '@suite/auth', '@suite/ui'],
}

export default config
