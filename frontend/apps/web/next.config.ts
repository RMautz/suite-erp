import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@suite/core', '@suite/db', '@suite/auth'],
}

export default config
