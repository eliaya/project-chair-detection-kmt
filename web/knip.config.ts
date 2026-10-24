import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  ignore: [
    'src/components/ui/**',
    'src/tanstack-table.d.ts',
    // Third-party source (vendor/blueprint3d/VENDOR.md); only the parts we import are used.
    'vendor/**',
  ],
  // Workers runtime module (worker/live.ts), not an npm package
  ignoreDependencies: ['cloudflare'],
}

export default config