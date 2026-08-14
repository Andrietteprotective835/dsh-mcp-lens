import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outDir: 'lib',
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
})
