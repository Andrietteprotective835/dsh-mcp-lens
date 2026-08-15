import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SEARCH_CACHE_SOURCE_FILES,
  SEARCH_CACHE_WORKLOAD,
  buildSyntheticTools,
  parseSearchCacheOutputPath,
  runSearchCacheBenchmark,
  summarizeLatency,
  writeSearchCacheReport,
} from '../benchmark/search-cache.js'

describe('search-cache benchmark contract', () => {
  it('constructs a stable keyless workload with one unambiguous target', () => {
    const first = buildSyntheticTools(128, 42)
    const second = buildSyntheticTools(128, 42)

    expect(second).toEqual(first)
    expect(first).toHaveLength(128)
    expect(first[42]?.name).toBe('customer_invoice_lookup_00042')
    expect(JSON.stringify(first)).not.toMatch(/api[_-]?key|authorization|bearer/i)
    expect(SEARCH_CACHE_WORKLOAD.query).toBe('find customer invoice by email address')
  })

  it('uses deterministic median and nearest-rank p95 summaries without a timing gate', () => {
    expect(summarizeLatency([5, 1, 4, 2, 3])).toEqual({
      iterations: 5,
      samplesMs: [5, 1, 4, 2, 3],
      medianMs: 3,
      p95Ms: 5,
    })
    expect(() => summarizeLatency([])).toThrow('finite non-negative')
    expect(() => summarizeLatency([1, Number.NaN])).toThrow('finite non-negative')
  })

  it('emits the versioned data contract and proves cold/warm result identity', async () => {
    const report = await runSearchCacheBenchmark({
      toolCount: 256,
      targetIndex: 42,
      coldIterations: 2,
      warmIterations: 3,
    })

    expect(report.format).toBe('dsh-mcp-lens/search-cache-benchmark')
    expect(report.formatVersion).toBe(1)
    expect(report.workload).toMatchObject({
      construction: 'deterministic-synthetic-v1',
      serverCount: 1,
      toolCount: 256,
      query: SEARCH_CACHE_WORKLOAD.query,
      expectedTopTool: 'customer_invoice_lookup_00042',
    })
    expect(report.workload.catalogUtf8Bytes).toBeGreaterThan(0)
    expect(report.workload.catalogSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(report.semantics).toMatchObject({
      reference: 'caller-owned-uncached-snapshot',
      topTool: 'customer_invoice_lookup_00042',
      coldAndWarmEqualReference: true,
    })
    expect(report.semantics.resultSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(report.latency.cold.iterations).toBe(2)
    expect(report.latency.cold.samplesMs).toHaveLength(2)
    expect(report.latency.warm.iterations).toBe(3)
    expect(report.latency.warm.samplesMs).toHaveLength(3)
    expect(report.methodology).toMatchObject({
      constructionExcluded: true,
      thresholdAssertion: false,
    })
    expect(report.provenance.gitCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(report.provenance.sourceDigest.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(report.provenance.sourceDigest.files.map(file => file.path)).toEqual([
      'benchmark/README.md',
      'benchmark/search-cache.ts',
      'npm-shrinkwrap.json',
      'package.json',
      'src/catalog.ts',
      'tests/search-cache-benchmark.spec.ts',
      'tsconfig.json',
    ])
    expect(SEARCH_CACHE_SOURCE_FILES).toEqual(report.provenance.sourceDigest.files.map(file => file.path))
  })

  it('rejects malformed CLI arguments and refuses to replace an existing report', async () => {
    expect(parseSearchCacheOutputPath([])).toBeUndefined()
    expect(parseSearchCacheOutputPath(['--output', 'report.json'])).toBe('report.json')
    expect(parseSearchCacheOutputPath(['--output=report.json'])).toBe('report.json')
    expect(() => parseSearchCacheOutputPath(['--unknown'])).toThrow('unknown argument')
    expect(() => parseSearchCacheOutputPath(['--output'])).toThrow('requires a path')
    expect(() => parseSearchCacheOutputPath(['--output=a.json', '--output=b.json'])).toThrow('only once')

    const directory = await mkdtemp(join(tmpdir(), 'mcp-lens-search-cache-benchmark-'))
    try {
      const path = join(directory, 'report.json')
      const report = await runSearchCacheBenchmark({
        toolCount: 64,
        targetIndex: 42,
        coldIterations: 1,
        warmIterations: 1,
      })
      await writeSearchCacheReport(path, report)
      const original = await readFile(path, 'utf8')
      await expect(writeSearchCacheReport(path, { ...report, generatedAt: 'replaced' }))
        .rejects.toMatchObject({ code: 'EEXIST' })
      expect(await readFile(path, 'utf8')).toBe(original)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
