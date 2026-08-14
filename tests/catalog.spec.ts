import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CATALOG_CACHE_FORMAT,
  CATALOG_CACHE_FORMAT_VERSION,
  CatalogServerToolLimitError,
  CatalogSnapshotTooLargeError,
  CatalogToolTooLargeError,
  ToolCatalog,
  catalogToolFromRemote,
  catalogToolUtf8Bytes,
  emptyCatalog,
  loadCatalogCache,
  searchCatalog,
  serverFingerprint,
  writeCatalogCache,
  type CatalogTool,
} from '../src/catalog.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

function configured(name: string, fingerprint: string) {
  return { name, fingerprint }
}

function credentialedHttpUrl(username: string, password: string, token: string): string {
  const endpoint = new URL('https://example.com/mcp')
  endpoint.username = username
  endpoint.password = password
  endpoint.searchParams.set('access_token', token)
  return endpoint.href
}

function tool(
  name: string,
  description: string,
  properties: Readonly<Record<string, unknown>> = {},
  extra: Readonly<Record<string, unknown>> = {},
): CatalogTool {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties },
    ...extra,
  }
}

async function temporaryCache(): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-mcp-lens-catalog-'))
  temporaryDirectories.push(directory)
  return { directory, path: join(directory, 'catalog.json') }
}

describe('weighted lexical search', () => {
  const fingerprint = serverFingerprint({
    name: 'github',
    transport: 'stdio',
    command: 'github-mcp-server',
  })

  function populatedCatalog(): ToolCatalog {
    const catalog = new ToolCatalog([configured('github', fingerprint)])
    catalog.replaceServerTools('github', fingerprint, [
      tool(
        'createPullRequest',
        'Open a contribution against a repository',
        {
          owner: { type: 'string' },
          repository_name: { type: 'string' },
          baseBranch: { type: 'string' },
          head_branch: { type: 'string' },
        },
      ),
      tool('pull-request-metrics', 'Summarize merged contribution throughput'),
      tool('archive_logs', 'Create and download a diagnostic archive'),
      tool(
        '建立議題',
        '在專案中新增追蹤項目',
        { 專案名稱: { type: 'string' }, 議題內容: { type: 'string' } },
      ),
      tool('translate_text', '翻譯文字與文件'),
    ], 1_000)
    return catalog
  }

  it('normalizes camelCase, snake_case, kebab-case, plurals, and parameter names', () => {
    const catalog = populatedCatalog()

    expect(catalog.search('pull requests', { limit: 1 })[0]?.tool.name).toBe('createPullRequest')
    expect(catalog.search('repository owner base branch', { limit: 1 })[0]?.tool.name).toBe('createPullRequest')
    expect(catalog.search('merged pull request metrics', { limit: 1 })[0]?.tool.name).toBe('pull-request-metrics')
  })

  it('retrieves on partial intent instead of requiring every query token as a substring', () => {
    const results = populatedCatalog().search('urgent create pull request')

    expect(results[0]?.tool.name).toBe('createPullRequest')
    expect(results[0]?.matchedTerms).toContain('create')
    expect(results[0]?.matchedTerms).not.toContain('urgent')
  })

  it('matches CJK descriptions and nested parameter names', () => {
    const results = populatedCatalog().search('新增專案議題', { limit: 2 })

    expect(results[0]?.tool.name).toBe('建立議題')
    expect(results[0]?.matchedTerms.length).toBeGreaterThan(1)
  })

  it('uses a stable server/name tie-break and supports deterministic empty-query listing', () => {
    const sameFingerprint = serverFingerprint({ name: 'shared', transport: 'stdio', command: 'same' })
    const snapshot = {
      ...emptyCatalog(2),
      servers: [
        { name: 'beta', fingerprint: sameFingerprint, fetchedAt: 1, tools: [tool('echo', 'Echo a value')] },
        { name: 'alpha', fingerprint: sameFingerprint, fetchedAt: 1, tools: [tool('echo', 'Echo a value')] },
      ],
    }

    expect(searchCatalog(snapshot, 'echo').map(result => result.server)).toEqual(['alpha', 'beta'])
    expect(searchCatalog(snapshot, '').map(result => result.server)).toEqual(['alpha', 'beta'])
  })
})

describe('endpoint freshness', () => {
  it('fingerprints endpoint while excluding all secret-derived material', () => {
    const first = serverFingerprint({
      name: 'remote',
      transport: 'streamable-http',
      url: credentialedHttpUrl('alice', 'header-secret', 'env-secret'),
    })
    const rotatedSecret = serverFingerprint({
      name: 'remote',
      transport: 'streamable-http',
      url: credentialedHttpUrl('bob', 'another-secret', 'rotated'),
    })
    const newEndpoint = serverFingerprint({
      name: 'remote',
      transport: 'streamable-http',
      url: 'https://example.com/v2/mcp?access_token=rotated',
    })

    expect(first).toBe(rotatedSecret)
    expect(first).not.toBe(newEndpoint)
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(first).not.toContain('secret')

    const cliSecretA = serverFingerprint({
      name: 'local', transport: 'stdio', command: 'server', args: ['--api-key', 'alpha-secret', '--mode=tools'],
    })
    const cliSecretB = serverFingerprint({
      name: 'local', transport: 'stdio', command: 'server', args: ['--api-key', 'rotated-secret', '--mode=tools'],
    })
    expect(cliSecretA).toBe(cliSecretB)
  })

  it('uses an explicit non-secret cache namespace to separate tenant identities', () => {
    const base = {
      name: 'remote',
      transport: 'streamable-http' as const,
      url: 'https://mcp.example.test/rpc',
    }
    expect(serverFingerprint({ ...base, cacheNamespace: 'tenant-a' }))
      .not.toBe(serverFingerprint({ ...base, cacheNamespace: 'tenant-b' }))
  })

  it('rejects stale discovery, ignores stale invalidation, and applies TTL boundaries', () => {
    const oldFingerprint = serverFingerprint({ name: 'files', transport: 'stdio', command: 'old-server' })
    const currentFingerprint = serverFingerprint({ name: 'files', transport: 'stdio', command: 'new-server' })
    const catalog = new ToolCatalog([configured('files', currentFingerprint)])

    expect(catalog.replaceServerTools('files', oldFingerprint, [tool('stale', 'Must not appear')], 1_000)).toBe(false)
    expect(catalog.replaceServerTools('files', currentFingerprint, [tool('read_file', 'Read a file')], 1_000)).toBe(true)
    expect(catalog.isFresh('files', currentFingerprint)).toBe(true)
    expect(catalog.needsRefresh('files', currentFingerprint, 500, 1_499)).toBe(false)
    expect(catalog.needsRefresh('files', currentFingerprint, 500, 1_500)).toBe(true)
    expect(catalog.needsRefresh('files', currentFingerprint, 500, 999)).toBe(true)
    expect(catalog.invalidate('files', oldFingerprint)).toBe(false)
    expect(catalog.get('files', 'read_file')?.name).toBe('read_file')
    expect(catalog.invalidate('files', currentFingerprint)).toBe(true)
    expect(catalog.isFresh('files', currentFingerprint)).toBe(false)
  })

  it('prunes removed and reconfigured servers atomically', () => {
    const first = serverFingerprint({ name: 'first', transport: 'stdio', command: 'one' })
    const second = serverFingerprint({ name: 'second', transport: 'stdio', command: 'two' })
    const replaced = serverFingerprint({ name: 'first', transport: 'stdio', command: 'replacement' })
    const catalog = new ToolCatalog([configured('first', first), configured('second', second)])
    catalog.replaceServerTools('first', first, [tool('one', 'One')], 1)
    catalog.replaceServerTools('second', second, [tool('two', 'Two')], 1)
    const before = catalog.snapshot()

    catalog.configure([configured('first', replaced)])

    expect(catalog.snapshot()).not.toBe(before)
    expect(catalog.snapshot().servers).toEqual([])
    expect(catalog.replaceServerTools('first', first, [tool('stale', 'Stale')], 2)).toBe(false)
  })
})

describe('versioned atomic disk cache', () => {
  it('defines per-tool bytes as exact canonical JSON of the safe projection', () => {
    const remote = {
      server: 'fixture',
      name: 'lookup',
      title: 'Lookup',
      description: 'Find a record',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: '搜尋詞' } },
        required: ['query'],
      },
      annotations: { readOnlyHint: true, credential: 'DROPPED' },
      _meta: { padding: 'x'.repeat(10_000) },
    }
    const projected = catalogToolFromRemote(remote)

    expect(catalogToolUtf8Bytes(remote)).toBe(Buffer.byteLength(JSON.stringify(projected), 'utf8'))
    expect(catalogToolUtf8Bytes(remote)).toBe(catalogToolUtf8Bytes(projected))
    expect(JSON.stringify(projected)).not.toContain('DROPPED')
  })

  it('fails closed when a cache exceeds a lowered per-server or per-tool cap', async () => {
    const countCache = await temporaryCache()
    const sizeCache = await temporaryCache()
    const fingerprint = serverFingerprint({ name: 'fixture', transport: 'stdio', command: 'fixture' })
    const twoTools = new ToolCatalog([configured('fixture', fingerprint)])
    twoTools.replaceServerTools('fixture', fingerprint, [
      tool('first', 'First'),
      tool('second', 'Second'),
    ], 1)
    await twoTools.save(countCache.path)

    const countLimited = new ToolCatalog(
      [configured('fixture', fingerprint)],
      { maxToolsPerServer: 1 },
    )
    const countResult = await countLimited.load(countCache.path)

    const sizedTool = tool('sized', 'Size checked', {
      payload: { type: 'string', description: '多位元組'.repeat(20) },
    })
    const sizedToolBytes = catalogToolUtf8Bytes(sizedTool)
    const oneTool = new ToolCatalog([configured('fixture', fingerprint)])
    oneTool.replaceServerTools('fixture', fingerprint, [sizedTool], 1)
    await oneTool.save(sizeCache.path)
    const sizeLimited = new ToolCatalog(
      [configured('fixture', fingerprint)],
      { maxBytesPerTool: sizedToolBytes - 1 },
    )
    const sizeResult = await sizeLimited.load(sizeCache.path)

    expect(countResult.status).toBe('limit-exceeded')
    expect(countLimited.size).toBe(0)
    expect(sizeResult.status).toBe('limit-exceeded')
    expect(sizeLimited.size).toBe(0)
  })

  it('keeps last-good atomic when replacement exceeds tool count or projected bytes', () => {
    const fingerprint = serverFingerprint({ name: 'fixture', transport: 'stdio', command: 'fixture' })
    const small = tool('small', 'Small')
    const maxBytesPerTool = catalogToolUtf8Bytes(small) + 32
    const catalog = new ToolCatalog(
      [configured('fixture', fingerprint)],
      { maxToolsPerServer: 2, maxBytesPerTool },
    )
    catalog.replaceServerTools('fixture', fingerprint, [small], 1)
    const lastGood = catalog.snapshot()

    expect(() => catalog.replaceServerTools('fixture', fingerprint, [
      tool('one', 'One'),
      tool('two', 'Two'),
      tool('three', 'Three'),
    ], 2)).toThrow(CatalogServerToolLimitError)
    expect(catalog.snapshot()).toBe(lastGood)

    expect(() => catalog.replaceServerTools('fixture', fingerprint, [tool(
      'large',
      'Large',
      { payload: { type: 'string', description: 'x'.repeat(maxBytesPerTool) } },
    )], 2)).toThrow(CatalogToolTooLargeError)
    expect(catalog.snapshot()).toBe(lastGood)
    expect(catalog.get('fixture', 'small')).toBeDefined()
  })

  it('guards direct writes with the same lowered projected-tool byte cap', async () => {
    const { path } = await temporaryCache()
    const fingerprint = serverFingerprint({ name: 'fixture', transport: 'stdio', command: 'fixture' })
    const candidate = tool('candidate', 'Candidate', {
      payload: { type: 'string', description: 'x'.repeat(300) },
    })
    const candidateBytes = catalogToolUtf8Bytes(candidate)
    const catalog = new ToolCatalog([configured('fixture', fingerprint)])
    catalog.replaceServerTools('fixture', fingerprint, [candidate], 1)
    await writeFile(path, 'LAST_GOOD_CACHE', 'utf8')

    await expect(writeCatalogCache(path, catalog.snapshot(), {
      maxBytesPerTool: candidateBytes - 1,
    })).rejects.toBeInstanceOf(CatalogToolTooLargeError)
    expect(await readFile(path, 'utf8')).toBe('LAST_GOOD_CACHE')
  })

  it('rejects an oversized existing cache before it can repopulate the catalog', async () => {
    const { path } = await temporaryCache()
    const fingerprint = serverFingerprint({ name: 'legacy', transport: 'stdio', command: 'legacy' })
    const maxSnapshotBytes = 512
    await writeFile(path, JSON.stringify({
      format: CATALOG_CACHE_FORMAT,
      formatVersion: CATALOG_CACHE_FORMAT_VERSION,
      revision: 1,
      servers: [{
        name: 'legacy',
        fingerprint,
        fetchedAt: 1,
        tools: [{
          name: 'smuggled',
          inputSchema: { type: 'object' },
          _meta: { padding: 'x'.repeat(maxSnapshotBytes) },
        }],
      }],
    }), 'utf8')
    const catalog = new ToolCatalog(
      [configured('legacy', fingerprint)],
      { maxSnapshotBytes },
    )

    const loaded = await catalog.load(path)

    expect(loaded.status).toBe('oversized')
    expect(catalog.size).toBe(0)
    expect(catalog.maxSnapshotBytes).toBe(maxSnapshotBytes)
  })

  it('keeps the last-good immutable generation when replacement exceeds the cap', () => {
    const fingerprint = serverFingerprint({ name: 'fixture', transport: 'stdio', command: 'fixture' })
    const catalog = new ToolCatalog(
      [configured('fixture', fingerprint)],
      { maxSnapshotBytes: 1_024 },
    )
    expect(catalog.replaceServerTools('fixture', fingerprint, [tool('small', 'Small tool')], 1)).toBe(true)
    const lastGood = catalog.snapshot()

    expect(() => catalog.replaceServerTools('fixture', fingerprint, [tool(
      'oversized',
      'Oversized tool',
      { payload: { type: 'string', description: 'x'.repeat(2_000) } },
    )], 2)).toThrow(CatalogSnapshotTooLargeError)

    expect(catalog.snapshot()).toBe(lastGood)
    expect(catalog.get('fixture', 'small')?.name).toBe('small')
    expect(catalog.get('fixture', 'oversized')).toBeUndefined()
  })

  it('fails before touching the destination when write serialization exceeds the cap', async () => {
    const { directory, path } = await temporaryCache()
    const fingerprint = serverFingerprint({ name: 'fixture', transport: 'stdio', command: 'fixture' })
    const uncapped = new ToolCatalog([configured('fixture', fingerprint)])
    uncapped.replaceServerTools('fixture', fingerprint, [tool(
      'oversized',
      'Oversized tool',
      { payload: { type: 'string', description: 'x'.repeat(2_000) } },
    )], 1)
    await writeFile(path, 'LAST_GOOD_CACHE', 'utf8')

    await expect(writeCatalogCache(
      path,
      uncapped.snapshot(),
      { maxSnapshotBytes: 512 },
    )).rejects.toBeInstanceOf(CatalogSnapshotTooLargeError)

    expect(await readFile(path, 'utf8')).toBe('LAST_GOOD_CACHE')
    expect(await readdir(directory)).toEqual(['catalog.json'])
  })

  it('round-trips the safe metadata projection, exact input schema, and timestamp', async () => {
    const { directory, path } = await temporaryCache()
    const fingerprint = serverFingerprint({
      name: 'private',
      transport: 'streamable-http',
      url: 'https://user:password@example.com/mcp?token=env-token',
    })
    const catalog = new ToolCatalog([configured('private', fingerprint)])
    const inputSchema = {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'Account identifier' },
        filters: {
          type: 'array',
          items: { $ref: '#/$defs/filter' },
        },
      },
      required: ['account_id'],
      $defs: { filter: { type: 'string', 'x-vendor-keyword': { exact: true } } },
      additionalProperties: false,
    }
    catalog.replaceServerTools('private', fingerprint, [tool(
      'structured',
      'Returns a structured result',
      inputSchema.properties,
      {
        title: 'Structured Lookup',
        inputSchema,
        outputSchema: { description: 'OUTPUT_SCHEMA_SECRET_MARKER' },
        annotations: {
          title: 'Safe annotation title',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
          credential: 'ANNOTATION_SECRET_MARKER',
        },
        execution: { taskSupport: 'optional', credential: 'EXECUTION_SECRET_MARKER' },
        _meta: { credential: 'META_CREDENTIAL_SECRET_MARKER' },
        icons: [{ src: 'ICON_SECRET_MARKER' }],
        unknownVendorMetadata: { token: 'UNKNOWN_SECRET_MARKER' },
      },
    )], 12_345)

    await catalog.save(path)
    const serialized = await readFile(path, 'utf8')
    const files = await readdir(directory)
    const restored = new ToolCatalog([configured('private', fingerprint)])
    const result = await restored.load(path)

    expect(files).toEqual(['catalog.json'])
    expect(serialized).not.toContain('password')
    expect(serialized).not.toContain('env-token')
    for (const marker of [
      'OUTPUT_SCHEMA_SECRET_MARKER',
      'ANNOTATION_SECRET_MARKER',
      'EXECUTION_SECRET_MARKER',
      'META_CREDENTIAL_SECRET_MARKER',
      'ICON_SECRET_MARKER',
      'UNKNOWN_SECRET_MARKER',
    ]) expect(serialized).not.toContain(marker)
    expect(result.status).toBe('loaded')
    expect(restored.snapshot().format).toBe(CATALOG_CACHE_FORMAT)
    expect(restored.snapshot().formatVersion).toBe(CATALOG_CACHE_FORMAT_VERSION)
    expect(restored.snapshot().servers[0]?.fetchedAt).toBe(12_345)
    expect(restored.get('private', 'structured')).toEqual({
      name: 'structured',
      title: 'Structured Lookup',
      description: 'Returns a structured result',
      inputSchema,
      annotations: {
        title: 'Safe annotation title',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      execution: { taskSupport: 'optional' },
    })
  })

  it('re-projects an old cache so unknown metadata cannot be smuggled through load', async () => {
    const { path } = await temporaryCache()
    const fingerprint = serverFingerprint({ name: 'legacy', transport: 'stdio', command: 'legacy' })
    const exactSchema = {
      type: 'object',
      properties: { query: { type: ['string', 'null'], examples: ['needle'] } },
      required: ['query'],
      'x-exact-extension': { nested: [1, true, null] },
    }
    await writeFile(path, JSON.stringify({
      format: CATALOG_CACHE_FORMAT,
      formatVersion: CATALOG_CACHE_FORMAT_VERSION,
      revision: 7,
      servers: [{
        name: 'legacy',
        fingerprint,
        fetchedAt: 123,
        tools: [{
          name: 'lookup',
          title: 'Lookup',
          description: 'Find a record',
          inputSchema: exactSchema,
          outputSchema: { credential: 'OLD_OUTPUT_SECRET_MARKER' },
          annotations: { readOnlyHint: true, credential: 'OLD_ANNOTATION_SECRET_MARKER' },
          execution: { taskSupport: 'required', credential: 'OLD_EXECUTION_SECRET_MARKER' },
          _meta: { credential: 'OLD_META_SECRET_MARKER' },
          icons: [{ src: 'OLD_ICON_SECRET_MARKER' }],
          unknown: { credential: 'OLD_UNKNOWN_SECRET_MARKER' },
        }],
      }],
    }), 'utf8')

    const catalog = new ToolCatalog([configured('legacy', fingerprint)])
    const loaded = await catalog.load(path)
    await catalog.save(path)
    const rewritten = await readFile(path, 'utf8')

    expect(loaded.status).toBe('loaded')
    expect(catalog.get('legacy', 'lookup')).toEqual({
      name: 'lookup',
      title: 'Lookup',
      description: 'Find a record',
      inputSchema: exactSchema,
      annotations: { readOnlyHint: true },
      execution: { taskSupport: 'required' },
    })
    for (const marker of [
      'OLD_OUTPUT_SECRET_MARKER',
      'OLD_ANNOTATION_SECRET_MARKER',
      'OLD_EXECUTION_SECRET_MARKER',
      'OLD_META_SECRET_MARKER',
      'OLD_ICON_SECRET_MARKER',
      'OLD_UNKNOWN_SECRET_MARKER',
    ]) expect(rewritten).not.toContain(marker)
  })

  it('prunes cache entries whose server is removed or fingerprint changed', async () => {
    const { path } = await temporaryCache()
    const first = serverFingerprint({ name: 'first', transport: 'stdio', command: 'one' })
    const second = serverFingerprint({ name: 'second', transport: 'stdio', command: 'two' })
    const catalog = new ToolCatalog([configured('first', first), configured('second', second)])
    catalog.replaceServerTools('first', first, [tool('one', 'One')], 1)
    catalog.replaceServerTools('second', second, [tool('two', 'Two')], 1)
    await catalog.save(path)

    const changed = serverFingerprint({ name: 'first', transport: 'stdio', command: 'changed' })
    const loaded = await loadCatalogCache(path, [configured('first', changed), configured('second', second)])

    expect(loaded.status).toBe('loaded')
    expect(loaded.snapshot.servers.map(server => server.name)).toEqual(['second'])
  })

  it('serializes overlapping saves so the newest invoked revision wins', async () => {
    const { path } = await temporaryCache()
    const fingerprint = serverFingerprint({ name: 'fixture', transport: 'stdio', command: 'fixture' })
    const catalog = new ToolCatalog([configured('fixture', fingerprint)])
    catalog.replaceServerTools('fixture', fingerprint, [tool('first', 'First generation')], 1)
    const firstSave = catalog.save(path)
    catalog.replaceServerTools('fixture', fingerprint, [tool('second', 'Second generation')], 2)
    const secondSave = catalog.save(path)

    await Promise.all([firstSave, secondSave])
    const loaded = await loadCatalogCache(path, [configured('fixture', fingerprint)])

    expect(loaded.snapshot.servers[0]?.tools.map(entry => entry.name)).toEqual(['second'])
    expect(loaded.snapshot.servers[0]?.fetchedAt).toBe(2)
  })

  it('fails open as empty for corrupt and incompatible cache files', async () => {
    const corrupt = await temporaryCache()
    const incompatible = await temporaryCache()
    await writeFile(corrupt.path, '{not json', 'utf8')
    await writeFile(incompatible.path, JSON.stringify({
      format: CATALOG_CACHE_FORMAT,
      formatVersion: CATALOG_CACHE_FORMAT_VERSION + 1,
      revision: 1,
      servers: [],
    }), 'utf8')

    const corruptResult = await loadCatalogCache(corrupt.path, [])
    const incompatibleResult = await loadCatalogCache(incompatible.path, [])

    expect(corruptResult.status).toBe('corrupt')
    expect(corruptResult.snapshot.servers).toEqual([])
    expect(incompatibleResult.status).toBe('incompatible')
    expect(incompatibleResult.snapshot.servers).toEqual([])
  })

  it('projects a pool RemoteTool to the exact cache-safe allowlist', () => {
    const inputSchema = {
      type: 'object',
      properties: { issue: { type: 'integer', minimum: 1 } },
      required: ['issue'],
      'x-preserve-exactly': ['a', 2, false],
    }
    const mapped = catalogToolFromRemote({
      server: 'github',
      name: 'get_issue',
      title: 'Get issue',
      description: 'Get one issue',
      inputSchema,
      outputSchema: { credential: 'REMOTE_OUTPUT_SECRET_MARKER' },
      annotations: {
        title: 'Read-only issue lookup',
        readOnlyHint: true,
        credential: 'REMOTE_ANNOTATION_SECRET_MARKER',
      },
      execution: { taskSupport: 'forbidden', credential: 'REMOTE_EXECUTION_SECRET_MARKER' },
      _meta: { credential: 'REMOTE_META_SECRET_MARKER' },
      icons: [{ src: 'REMOTE_ICON_SECRET_MARKER' }],
      vendor: { credential: 'REMOTE_VENDOR_SECRET_MARKER' },
    })

    expect(mapped).toEqual({
      name: 'get_issue',
      title: 'Get issue',
      description: 'Get one issue',
      inputSchema,
      annotations: { title: 'Read-only issue lookup', readOnlyHint: true },
      execution: { taskSupport: 'forbidden' },
    })
    expect('server' in mapped).toBe(false)
    expect('outputSchema' in mapped).toBe(false)
    expect('_meta' in mapped).toBe(false)
    expect('icons' in mapped).toBe(false)
    expect('vendor' in mapped).toBe(false)
  })
})
