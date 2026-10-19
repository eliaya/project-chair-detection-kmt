import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  ignore: [
    'src/components/ui/**',
    'src/tanstack-table.d.ts',
    // Third-party source (vendor/blueprint3d/VENDOR.md); only the parts we import are used.
    'vendor/**',
  ],
}

export default config