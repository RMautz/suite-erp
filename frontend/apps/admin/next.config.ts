import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@suite/core', '@suite/db', '@suite/auth', '@suite/ui'],
}

export default config
