import type { NextConfig } from 'next'

const config: NextConfig = {
  // La app vive bajo www.letier.cl/erp/cuenta (multi-zone: el sitio letier hace rewrite).
  basePath: '/erp/cuenta',
  transpilePackages: ['@suite/core', '@suite/db', '@suite/auth'],
}

export default config
