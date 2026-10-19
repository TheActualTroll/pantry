import { cpSync, rmSync } from 'node:fs'
import { build } from 'esbuild'

// Single self-contained ESM bundle: workspace TS packages and npm deps are
// inlined, only Node built-ins stay external (node:sqlite is imported by name).
await build({
  entryPoints: ['server/index.ts'],
  outfile: 'dist/server/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  minify: false,
  legalComments: 'none',
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
})

rmSync('dist/server/migrations', { recursive: true, force: true })
cpSync('../../packages/database/migrations', 'dist/server/migrations', {
  recursive: true,
  filter: (source) => !source.endsWith('.test.ts'),
})
