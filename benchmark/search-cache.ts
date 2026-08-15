import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { arch, cpus, machine, platform, release, totalmem } from 'node:os'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  CATALOG_CACHE_FORMAT,
  CATALOG_CACHE_FORMAT_VERSION,
  ToolCatalog,
  searchCatalog,
  serverFingerprint,
  type CatalogSearchResult,
  type CatalogSnapshot,
  type CatalogTool,
} from '../src/catalog.js'

export const SEARCH_CACHE_WORKLOAD = Object.freeze({
  server: 'synthetic-benchmark',
  toolCount: 10_000,
  targetIndex: 4_242,
  query: 'find customer invoice by email address',
  limit: 8,
  coldIterations: 12,
  warmIterations: 60,
})

export const SEARCH_CACHE_SOURCE_FILES = Object.freeze([
  'benchmark/README.md',
  'benchmark/search-cache.ts',
  'npm-shrinkwrap.json',
  'package.json',
  'src/catalog.ts',
  'tests/search-cache-benchmark.spec.ts',
  'tsconfig.json',
])

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const syntheticFingerprint = serverFingerprint({
  name: SEARCH_CACHE_WORKLOAD.server,
  transport: 'stdio',
  command: 'keyless-synthetic-benchmark',
})

interface BenchmarkOptions {
  readonly toolCount?: number
  readonly targetIndex?: number
  readonly coldIterations?: number
  readonly warmIterations?: number
}

interface LatencySummary {
  readonly iterations: number
  readonly samplesMs: readonly number[]
  readonly medianMs: number
  readonly p95Ms: number
}

interface SourceDigestFile {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

interface SourceDigest {
  readonly algorithm: 'sha256'
  readonly manifestFormat: '<relative-path>\\t<raw-file-sha256>\\n'
  readonly digest: string
  readonly files: readonly SourceDigestFile[]
}

export interface SearchCacheBenchmarkReport {
  readonly format: 'dsh-mcp-lens/search-cache-benchmark'
  readonly formatVersion: 1
  readonly generatedAt: string
  readonly environment: {
    readonly node: string
    readonly platform: NodeJS.Platform
    readonly release: string
    readonly arch: string
    readonly machine: string
    readonly cpuModel: string
    readonly logicalCpus: number
    readonly totalMemoryBytes: number
    readonly timer: 'performance.now'
  }
  readonly provenance: {
    readonly packageVersion: string
    readonly gitCommit: string
    readonly gitDirty: boolean
    readonly sourceDigest: SourceDigest
  }
  readonly workload: {
    readonly construction: 'deterministic-synthetic-v1'
    readonly serverCount: 1
    readonly toolCount: number
    readonly catalogUtf8Bytes: number
    readonly catalogSha256: string
    readonly query: string
    readonly limit: number
    readonly expectedTopTool: string
  }
  readonly semantics: {
    readonly reference: 'caller-owned-uncached-snapshot'
    readonly resultSha256: string
    readonly resultCount: number
    readonly topTool: string
    readonly coldAndWarmEqualReference: true
  }
  readonly latency: {
    readonly cold: LatencySummary
    readonly warm: LatencySummary
  }
  readonly methodology: {
    readonly cold: string
    readonly warm: string
    readonly constructionExcluded: true
    readonly thresholdAssertion: false
    readonly claimBoundary: string
  }
}

export function buildSyntheticTools(
  toolCount: number = SEARCH_CACHE_WORKLOAD.toolCount,
  targetIndex: number = Math.min(SEARCH_CACHE_WORKLOAD.targetIndex, toolCount - 1),
): readonly CatalogTool[] {
  assertPositiveSafeInteger(toolCount, 'toolCount')
  if (!Number.isSafeInteger(targetIndex) || targetIndex < 0 || targetIndex >= toolCount) {
    throw new TypeError('targetIndex must identify one synthetic tool')
  }

  const families = ['calendar', 'repository', 'invoice', 'message', 'storage'] as const
  return Array.from({ length: toolCount }, (_, index): CatalogTool => {
    const id = String(index).padStart(5, '0')
    if (index === targetIndex) {
      return {
        name: `customer_invoice_lookup_${id}`,
        title: 'Customer invoice lookup by email',
        description: 'Find one customer invoice record using an email address and account identifier.',
        inputSchema: {
          type: 'object',
          properties: {
            customerEmail: { type: 'string', description: 'Customer email address' },
            accountId: { type: 'string', description: 'Customer account identifier' },
            invoiceId: { type: 'string', description: 'Optional invoice identifier' },
          },
          required: ['customerEmail'],
        },
      }
    }

    const family = families[index % families.length]!
    return {
      name: `synthetic_${family}_${id}`,
      title: `${family} operation ${id}`,
      description: `Deterministic ${family} fixture for record ${id}.`,
      inputSchema: {
        type: 'object',
        properties: {
          recordId: { type: 'string', description: 'Synthetic record identifier' },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          [`${family}Id`]: { type: 'string' },
        },
        required: ['recordId'],
      },
    }
  })
}

export function summarizeLatency(samples: readonly number[]): LatencySummary {
  if (samples.length === 0 || samples.some(sample => !Number.isFinite(sample) || sample < 0)) {
    throw new TypeError('latency samples must be finite non-negative numbers')
  }
  const sorted = [...samples].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle]!
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1)
  return {
    iterations: samples.length,
    samplesMs: samples.map(sample => round(sample)),
    medianMs: round(median),
    p95Ms: round(sorted[p95Index]!),
  }
}

export async function runSearchCacheBenchmark(
  options: BenchmarkOptions = {},
): Promise<SearchCacheBenchmarkReport> {
  const toolCount = options.toolCount ?? SEARCH_CACHE_WORKLOAD.toolCount
  const targetIndex = options.targetIndex ?? Math.min(SEARCH_CACHE_WORKLOAD.targetIndex, toolCount - 1)
  const coldIterations = options.coldIterations ?? SEARCH_CACHE_WORKLOAD.coldIterations
  const warmIterations = options.warmIterations ?? SEARCH_CACHE_WORKLOAD.warmIterations
  assertPositiveSafeInteger(toolCount, 'toolCount')
  assertPositiveSafeInteger(coldIterations, 'coldIterations')
  assertPositiveSafeInteger(warmIterations, 'warmIterations')

  const before = await captureProvenance()
  const tools = buildSyntheticTools(toolCount, targetIndex)
  const expectedTopTool = tools[targetIndex]!.name
  const referenceSnapshot = makeCallerOwnedSnapshot(tools)
  const referenceResults = searchCatalog(referenceSnapshot, SEARCH_CACHE_WORKLOAD.query, {
    limit: SEARCH_CACHE_WORKLOAD.limit,
  })
  assertExpectedTopTool(referenceResults, expectedTopTool, 'uncached reference')
  const referenceJson = JSON.stringify(referenceResults)

  const coldSamples: number[] = []
  for (let iteration = 0; iteration < coldIterations; iteration += 1) {
    const catalog = makeCatalog(tools)
    const startedAt = performance.now()
    const results = catalog.search(SEARCH_CACHE_WORKLOAD.query, { limit: SEARCH_CACHE_WORKLOAD.limit })
    coldSamples.push(performance.now() - startedAt)
    assertSameResults(referenceJson, results, `cold iteration ${iteration + 1}`)
  }

  const warmCatalog = makeCatalog(tools)
  const warmupResults = warmCatalog.search(SEARCH_CACHE_WORKLOAD.query, { limit: SEARCH_CACHE_WORKLOAD.limit })
  assertSameResults(referenceJson, warmupResults, 'warm-cache priming search')
  const warmSamples: number[] = []
  for (let iteration = 0; iteration < warmIterations; iteration += 1) {
    const startedAt = performance.now()
    const results = warmCatalog.search(SEARCH_CACHE_WORKLOAD.query, { limit: SEARCH_CACHE_WORKLOAD.limit })
    warmSamples.push(performance.now() - startedAt)
    assertSameResults(referenceJson, results, `warm iteration ${iteration + 1}`)
  }

  const measuredSnapshot = warmCatalog.snapshot()
  const catalogJson = JSON.stringify(measuredSnapshot)
  const after = await captureProvenance()
  if (before.gitCommit !== after.gitCommit || before.sourceDigest.digest !== after.sourceDigest.digest) {
    throw new Error('benchmark source changed during measurement; no report was accepted')
  }

  const cpu = cpus()
  const packageVersion = await readPackageVersion()
  return {
    format: 'dsh-mcp-lens/search-cache-benchmark',
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: platform(),
      release: release(),
      arch: arch(),
      machine: machine(),
      cpuModel: cpu[0]?.model ?? 'unknown',
      logicalCpus: cpu.length,
      totalMemoryBytes: totalmem(),
      timer: 'performance.now',
    },
    provenance: {
      packageVersion,
      gitCommit: before.gitCommit,
      gitDirty: before.gitDirty,
      sourceDigest: before.sourceDigest,
    },
    workload: {
      construction: 'deterministic-synthetic-v1',
      serverCount: 1,
      toolCount,
      catalogUtf8Bytes: Buffer.byteLength(catalogJson, 'utf8'),
      catalogSha256: sha256(catalogJson),
      query: SEARCH_CACHE_WORKLOAD.query,
      limit: SEARCH_CACHE_WORKLOAD.limit,
      expectedTopTool,
    },
    semantics: {
      reference: 'caller-owned-uncached-snapshot',
      resultSha256: sha256(referenceJson),
      resultCount: referenceResults.length,
      topTool: referenceResults[0]!.tool.name,
      coldAndWarmEqualReference: true,
    },
    latency: {
      cold: summarizeLatency(coldSamples),
      warm: summarizeLatency(warmSamples),
    },
    methodology: {
      cold: 'First search against each fresh immutable ToolCatalog snapshot identity.',
      warm: 'Repeated searches after one unmeasured priming search against one immutable snapshot identity.',
      constructionExcluded: true,
      thresholdAssertion: false,
      claimBoundary: 'Host-specific component timing; not provider cost, model quality, or a universal speedup claim.',
    },
  }
}

async function captureProvenance(): Promise<{
  gitCommit: string
  gitDirty: boolean
  sourceDigest: SourceDigest
}> {
  const gitCommit = git(['rev-parse', 'HEAD'])
  const gitDirty = git(['status', '--porcelain']).length > 0
  return { gitCommit, gitDirty, sourceDigest: await computeSourceDigest() }
}

async function computeSourceDigest(): Promise<SourceDigest> {
  const files: SourceDigestFile[] = []
  for (const relativePath of [...SEARCH_CACHE_SOURCE_FILES].sort()) {
    const bytes = await readFile(resolve(repositoryRoot, relativePath))
    files.push({ path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) })
  }
  const manifest = files.map(file => `${file.path}\t${file.sha256}\n`).join('')
  return {
    algorithm: 'sha256',
    manifestFormat: '<relative-path>\\t<raw-file-sha256>\\n',
    digest: sha256(manifest),
    files,
  }
}

function makeCatalog(tools: readonly CatalogTool[]): ToolCatalog {
  const catalog = new ToolCatalog([{ name: SEARCH_CACHE_WORKLOAD.server, fingerprint: syntheticFingerprint }])
  const replaced = catalog.replaceServerTools(
    SEARCH_CACHE_WORKLOAD.server,
    syntheticFingerprint,
    tools,
    1,
  )
  if (!replaced) throw new Error('synthetic catalog generation was not accepted')
  return catalog
}

function makeCallerOwnedSnapshot(tools: readonly CatalogTool[]): CatalogSnapshot {
  return {
    format: CATALOG_CACHE_FORMAT,
    formatVersion: CATALOG_CACHE_FORMAT_VERSION,
    revision: 1,
    servers: [{
      name: SEARCH_CACHE_WORKLOAD.server,
      fingerprint: syntheticFingerprint,
      fetchedAt: 1,
      tools,
    }],
  }
}

function assertSameResults(
  referenceJson: string,
  results: readonly CatalogSearchResult[],
  label: string,
): void {
  const actualJson = JSON.stringify(results)
  if (actualJson !== referenceJson) {
    throw new Error(`${label} changed search semantics: ${sha256(actualJson)} != ${sha256(referenceJson)}`)
  }
}

function assertExpectedTopTool(
  results: readonly CatalogSearchResult[],
  expected: string,
  label: string,
): void {
  const actual = results[0]?.tool.name
  if (actual !== expected) throw new Error(`${label} top result was ${actual ?? '<none>'}; expected ${expected}`)
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer`)
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

function git(args: readonly string[]): string {
  try {
    return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim()
  } catch (error) {
    throw new Error(`git ${args.join(' ')} failed; benchmark provenance is required`, { cause: error })
  }
}

async function readPackageVersion(): Promise<string> {
  const raw = await readFile(resolve(repositoryRoot, 'package.json'), 'utf8')
  const parsed = JSON.parse(raw) as { version?: unknown }
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error('package.json does not contain a valid version')
  }
  return parsed.version
}

export async function writeSearchCacheReport(
  path: string,
  report: SearchCacheBenchmarkReport,
): Promise<void> {
  const destination = resolve(path)
  const temporary = `${destination}.${process.pid}.tmp`
  await mkdir(dirname(destination), { recursive: true })
  try {
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    // The temporary file is complete before its atomic link appears. `link`
    // fails with EEXIST rather than replacing an existing evidence artifact.
    await link(temporary, destination)
    await unlink(temporary)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

export function parseSearchCacheOutputPath(args: readonly string[]): string | undefined {
  let output: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (argument === '--output') {
      const value = args[index + 1]
      if (value === undefined || value.startsWith('--')) throw new TypeError('--output requires a path')
      if (output !== undefined) throw new TypeError('--output may be specified only once')
      output = value
      index += 1
      continue
    }
    if (argument.startsWith('--output=')) {
      if (output !== undefined) throw new TypeError('--output may be specified only once')
      output = argument.slice('--output='.length)
      if (output.length === 0) throw new TypeError('--output requires a path')
      continue
    }
    throw new TypeError(`unknown argument: ${argument}`)
  }
  return output
}

function isMainModule(): boolean {
  const entry = process.argv[1]
  return entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href
}

async function main(): Promise<void> {
  const output = parseSearchCacheOutputPath(process.argv.slice(2))
  const report = await runSearchCacheBenchmark()
  if (output === undefined) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return
  }
  await writeSearchCacheReport(output, report)
  process.stdout.write(`wrote ${resolve(output)}\n`)
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
