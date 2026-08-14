import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const benchmarkEntry = resolve(root, 'benchmark', 'run.ts')

if (!existsSync(benchmarkEntry)) {
  console.error('The packed MCP Lens release artifact omits benchmark/. Run the benchmark from the source checkout or Git tag instead.')
  process.exit(1)
}

const result = spawnSync(
  'tsx',
  ['benchmark/run.ts', ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  },
)

process.exit(result.status ?? 1)
