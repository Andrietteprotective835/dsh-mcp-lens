import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('npm', ['run', 'typecheck'])

const hasSourceTests = existsSync(resolve(root, 'tests', 'catalog.spec.ts'))
if (hasSourceTests) {
  run('npm', ['run', 'test'])
} else {
  console.warn('MCP Lens package verification skipped source-only tests because the packed release artifact omits tests/.')
}

run('npm', ['run', 'build'])
