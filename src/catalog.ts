import { createHash, randomBytes } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export const CATALOG_CACHE_FORMAT = 'dsh-mcp-lens/catalog' as const
export const CATALOG_CACHE_FORMAT_VERSION = 1 as const
export const DEFAULT_MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024
export const DEFAULT_MAX_TOOLS_PER_SERVER = 10_000
export const DEFAULT_MAX_BYTES_PER_TOOL = 1_048_576

export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[]
export interface JsonObject {
  readonly [key: string]: JsonValue
}

/**
 * JSON-safe metadata returned by MCP `tools/list`.
 *
 * This is an intentional projection of MCP `Tool`: full input schemas are
 * retained, while response schemas, icons, `_meta`, and unknown top-level
 * fields are discarded before either memory indexing or disk persistence.
 */
export interface CatalogTool {
  readonly name: string
  readonly title?: string
  readonly description?: string
  /** Runtime validation guarantees JSON; the broad object type accepts MCP SDK Tool directly. */
  readonly inputSchema: Readonly<Record<string, unknown>>
  readonly annotations?: Readonly<Record<string, unknown>>
  readonly execution?: Readonly<Record<string, unknown>>
}

/** Backwards-compatible descriptive alias. */
export type McpToolMetadata = CatalogTool

export interface ConfiguredServer {
  readonly name: string
  readonly fingerprint: string
}

export interface CatalogServerSnapshot extends ConfiguredServer {
  /** Epoch milliseconds when the complete tools/list generation was fetched. */
  readonly fetchedAt: number
  readonly tools: readonly McpToolMetadata[]
}

export interface CatalogSnapshot {
  readonly format: typeof CATALOG_CACHE_FORMAT
  readonly formatVersion: typeof CATALOG_CACHE_FORMAT_VERSION
  /** Monotonic logical revision of the catalog contents. */
  readonly revision: number
  readonly servers: readonly CatalogServerSnapshot[]
}

export interface CatalogSearchOptions {
  readonly limit?: number
  readonly server?: string
}

export interface CatalogToolFilter {
  allows(server: string, tool: string): boolean
}

export interface CatalogSearchResult {
  readonly server: string
  readonly fingerprint: string
  readonly tool: McpToolMetadata
  readonly score: number
  readonly matchedTerms: readonly string[]
}

export type CacheLoadStatus =
  | 'loaded'
  | 'missing'
  | 'corrupt'
  | 'incompatible'
  | 'oversized'
  | 'limit-exceeded'
  | 'superseded'

export interface CacheLoadResult {
  readonly status: CacheLoadStatus
  readonly snapshot: CatalogSnapshot
}

export interface CatalogSizeOptions {
  /** Maximum UTF-8 bytes of canonical cache JSON, including its final newline. */
  readonly maxSnapshotBytes?: number
  /** Maximum number of projected tools retained for one server generation. */
  readonly maxToolsPerServer?: number
  /** Maximum canonical UTF-8 JSON bytes of one projected tool, with no trailing newline. */
  readonly maxBytesPerTool?: number
}

interface ResolvedCatalogLimits {
  readonly maxSnapshotBytes: number
  readonly maxToolsPerServer: number
  readonly maxBytesPerTool: number
}

const ENGLISH_STOPWORDS = new Set([
  'a', 'about', 'after', 'again', 'all', 'also', 'am', 'an', 'and', 'any',
  'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'between',
  'both', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'doing', 'each',
  'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her',
  'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in',
  'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more', 'most', 'my',
  'myself', 'no', 'nor', 'not', 'of', 'on', 'once', 'only', 'or', 'other',
  'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 'should',
  'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them',
  'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
  'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what',
  'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with',
  'would', 'you', 'your', 'yours', 'yourself', 'yourselves',
])

const EXACT_FIELD_IDF_PARAMS = {
  maxDocumentFrequencyRatio: 0.72,
  minimumLatinTermLength: 3,
  coverageBonus: 0.12,
  fields: {
    name: { weight: 3.2, b: 0.08 },
    title: { weight: 2.4, b: 0.15 },
    schema: { weight: 1.15, b: 0.55 },
    description: { weight: 0.9, b: 0.72 },
    server: { weight: 1.9, b: 0.05 },
  },
  oneEdit: {
    minimumLength: 5,
    maximumLength: 64,
  },
} as const

// Product integration guard outside the frozen ranker: once policy/server
// filtering leaves at most two tools, retain exact-hit terms despite high DF.
const SMALL_VISIBLE_CORPUS_MAX_DOCUMENTS = 2

// One-edit fallback is intentionally secondary to exact retrieval. Bound the
// only path that scans name/title vocabulary so an allowed 64 MiB catalog
// cannot turn one typo into unbounded synchronous work.
const MAX_ONE_EDIT_CANDIDATE_TOKENS = 250_000

// An internal capability, not an Object.isFrozen() heuristic: a caller may
// shallow-freeze the envelope while leaving schemas mutable.
const FROZEN_CATALOG_SNAPSHOTS = new WeakSet<CatalogSnapshot>()
const FILTERED_CATALOGS = new WeakMap<
  CatalogSnapshot,
  WeakMap<CatalogToolFilter, CatalogSnapshot>
>()

export class CatalogSnapshotTooLargeError extends RangeError {
  public readonly actualBytes: number
  public readonly maxBytes: number

  public constructor(actualBytes: number, maxBytes: number) {
    super(`MCP catalog snapshot is ${actualBytes} bytes; limit is ${maxBytes} bytes`)
    this.name = 'CatalogSnapshotTooLargeError'
    this.actualBytes = actualBytes
    this.maxBytes = maxBytes
  }
}

export class CatalogServerToolLimitError extends RangeError {
  public readonly server: string
  public readonly actualTools: number
  public readonly maxTools: number

  public constructor(server: string, actualTools: number, maxTools: number) {
    super(`MCP catalog server "${server}" has ${actualTools} tools; limit is ${maxTools}`)
    this.name = 'CatalogServerToolLimitError'
    this.server = server
    this.actualTools = actualTools
    this.maxTools = maxTools
  }
}

export class CatalogToolTooLargeError extends RangeError {
  public readonly server: string
  public readonly tool: string
  public readonly actualBytes: number
  public readonly maxBytes: number

  public constructor(server: string, tool: string, actualBytes: number, maxBytes: number) {
    super(`MCP catalog tool "${server}/${tool}" is ${actualBytes} bytes; limit is ${maxBytes}`)
    this.name = 'CatalogToolTooLargeError'
    this.server = server
    this.tool = tool
    this.actualBytes = actualBytes
    this.maxBytes = maxBytes
  }
}

/** Endpoint material that is safe to use for identity derivation. */
export type ServerEndpointIdentity =
  | {
    readonly name: string
    readonly transport: 'stdio'
    readonly command: string
    readonly args?: readonly string[]
    readonly cwd?: string
    readonly cacheNamespace?: string
  }
  | {
    readonly name: string
    readonly transport: 'http' | 'streamable-http'
    readonly url: string
    readonly cacheNamespace?: string
  }

/**
 * Create a stable endpoint identity without persisting endpoint configuration.
 *
 * Headers, environment variables, URL credentials, and query values are
 * deliberately excluded: not even a digest derived from a secret is written
 * to cache. Endpoint path and non-secret process argv still invalidate stale
 * tool metadata. Credential-shaped command-line flag values are redacted
 * before hashing as a final defense for servers that do not use `env`.
 */
export function serverFingerprint(endpoint: ServerEndpointIdentity): string {
  const canonical = endpoint.transport === 'stdio'
    ? {
        name: endpoint.name,
        transport: endpoint.transport,
        command: endpoint.command,
        args: sanitizedArgsIdentity(endpoint.args ?? []),
        cwd: endpoint.cwd ?? '',
        cacheNamespace: endpoint.cacheNamespace ?? '',
      }
    : {
        name: endpoint.name,
        transport: endpoint.transport,
        url: sanitizedUrlIdentity(endpoint.url),
        cacheNamespace: endpoint.cacheNamespace ?? '',
      }
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`
}

/** Project a pool RemoteTool to the cache-safe metadata allowlist. */
export function catalogToolFromRemote(remoteTool: unknown): CatalogTool {
  return parseTool(remoteTool)
}

/**
 * Exact per-tool budget unit: UTF-8 bytes of `JSON.stringify()` applied to the
 * cache-safe projected tool, with deterministic top-level field order and no
 * whitespace or trailing newline.
 */
export function catalogToolUtf8Bytes(remoteOrProjectedTool: unknown): number {
  return serializedToolBytes(parseTool(remoteOrProjectedTool))
}

/** Return an immutable empty catalog. */
export function emptyCatalog(revision = 0): CatalogSnapshot {
  return freezeSnapshot({
    format: CATALOG_CACHE_FORMAT,
    formatVersion: CATALOG_CACHE_FORMAT_VERSION,
    revision,
    servers: [],
  })
}

/**
 * Search an immutable snapshot using deterministic exact-field IDF ranking.
 *
 * The exact route uses canonical tokens, best-field scoring, corpus rarity,
 * field-length normalization, and a bounded coverage bonus. Only when that
 * route is empty may one eligible Latin OOV term use true edit-distance-one
 * fallback against name/title tokens. Prefix, substring, transposition,
 * description, and schema fuzzy matches are never used.
 */
export function searchCatalog(
  snapshot: CatalogSnapshot,
  query: string,
  options: CatalogSearchOptions = {},
): readonly CatalogSearchResult[] {
  const limit = normalizeLimit(options.limit)
  if (limit === 0) return []

  const indexed = indexedDocuments(snapshot)
  const documents = options.server === undefined
    ? indexed
    : indexed.filter(document => document.server === options.server)
  if (documents.length === 0) return []

  const canonicalQueryTerms = tokenizeCanonical(query)
  if (canonicalQueryTerms.length === 0) {
    return documents
      .slice(0, limit)
      .map(document => ({
        server: document.server,
        fingerprint: document.fingerprint,
        tool: document.tool,
        score: 0,
        matchedTerms: [],
      }))
  }

  const queryTerms = gateQueryTerms(canonicalQueryTerms, documents)
  if (queryTerms.length === 0) return []

  const exact = rankDocuments(documents, queryTerms)
  if (exact.length > 0) return exact.slice(0, limit)
  if (!fallbackEligible(queryTerms)) return []
  const fallback = rankOneEditFallback(documents, queryTerms[0]!)
  return fallback === undefined ? [] : fallback.slice(0, limit)
}

/**
 * Filter one immutable catalog generation once per stable policy identity.
 * Mutable caller-owned snapshots and policies are never identity-cached.
 */
export function filterCatalog(
  snapshot: CatalogSnapshot,
  policy: CatalogToolFilter,
): CatalogSnapshot {
  const stableSource = FROZEN_CATALOG_SNAPSHOTS.has(snapshot)
  const cacheable = stableSource && Object.isFrozen(policy)
  if (cacheable) {
    const cached = FILTERED_CATALOGS.get(snapshot)?.get(policy)
    if (cached !== undefined) return cached
  }

  let changed = false
  const servers = snapshot.servers.map(server => {
    const tools = server.tools.filter(tool => policy.allows(server.name, tool.name))
    if (tools.length === server.tools.length) return server
    changed = true
    return { ...server, tools }
  })
  const filtered = changed
    ? stableSource
      ? freezeSnapshot({ ...snapshot, servers })
      : { ...snapshot, servers }
    : snapshot

  if (cacheable) {
    let byPolicy = FILTERED_CATALOGS.get(snapshot)
    if (byPolicy === undefined) {
      byPolicy = new WeakMap<CatalogToolFilter, CatalogSnapshot>()
      FILTERED_CATALOGS.set(snapshot, byPolicy)
    }
    byPolicy.set(policy, filtered)
  }
  return filtered
}

/**
 * Load, validate, and prune a cache against currently configured endpoints.
 * Invalid or unreadable data fails open as an empty catalog and never throws.
 */
export async function loadCatalogCache(
  cachePath: string,
  configuredServers: Iterable<ConfiguredServer>,
  options: CatalogSizeOptions = {},
): Promise<CacheLoadResult> {
  const limits = resolveCatalogLimits(options)
  const configured = normalizeConfiguredServers(configuredServers)
  try {
    const metadata = await stat(cachePath)
    if (!metadata.isFile()) return { status: 'corrupt', snapshot: emptyCatalog() }
    if (metadata.size > limits.maxSnapshotBytes) return { status: 'oversized', snapshot: emptyCatalog() }
  } catch (error) {
    return {
      status: isNodeError(error, 'ENOENT') ? 'missing' : 'corrupt',
      snapshot: emptyCatalog(),
    }
  }

  let bytes: Buffer
  try {
    bytes = await readFile(cachePath)
  } catch (error) {
    return {
      status: isNodeError(error, 'ENOENT') ? 'missing' : 'corrupt',
      snapshot: emptyCatalog(),
    }
  }
  // Recheck the bytes actually read to close the stat/read replacement race.
  if (bytes.byteLength > limits.maxSnapshotBytes) return { status: 'oversized', snapshot: emptyCatalog() }

  let raw: unknown
  try {
    raw = JSON.parse(bytes.toString('utf8'))
  } catch {
    return { status: 'corrupt', snapshot: emptyCatalog() }
  }
  if (isRecord(raw) && raw.format === CATALOG_CACHE_FORMAT && raw.formatVersion !== CATALOG_CACHE_FORMAT_VERSION) {
    return { status: 'incompatible', snapshot: emptyCatalog() }
  }

  try {
    const parsed = parseSnapshot(raw, limits)
    assertSnapshotSize(parsed, limits.maxSnapshotBytes)
    return {
      status: 'loaded',
      snapshot: pruneSnapshot(parsed, configured),
    }
  } catch (error) {
    if (error instanceof CatalogSnapshotTooLargeError) {
      return { status: 'oversized', snapshot: emptyCatalog() }
    }
    if (error instanceof CatalogServerToolLimitError || error instanceof CatalogToolTooLargeError) {
      return { status: 'limit-exceeded', snapshot: emptyCatalog() }
    }
    return { status: 'corrupt', snapshot: emptyCatalog() }
  }
}

/** Atomically write a validated snapshot with owner-only file permissions. */
export async function writeCatalogCache(
  cachePath: string,
  snapshot: CatalogSnapshot,
  options: CatalogSizeOptions = {},
): Promise<void> {
  const limits = resolveCatalogLimits(options)
  const validated = parseSnapshot(snapshot, limits)
  const serialized = serializeSnapshot(validated, limits.maxSnapshotBytes)
  const directory = dirname(cachePath)
  const temporary = join(
    directory,
    `.${basename(cachePath)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  )
  await mkdir(directory, { recursive: true })

  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(serialized, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, cachePath)
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

/**
 * Mutable facade whose every content update swaps one immutable generation.
 * Slow discovery from a previous endpoint cannot overwrite a reconfigured
 * server because `replaceServerTools` requires the current fingerprint.
 */
export class ToolCatalog {
  #configured = new Map<string, string>()
  #snapshot: CatalogSnapshot = emptyCatalog()
  #epoch = 0
  #writeQueue: Promise<void> = Promise.resolve()
  readonly #limits: ResolvedCatalogLimits

  public constructor(
    configuredServers: Iterable<ConfiguredServer> = [],
    options: CatalogSizeOptions = {},
  ) {
    this.#limits = resolveCatalogLimits(options)
    assertSnapshotSize(this.#snapshot, this.#limits.maxSnapshotBytes)
    this.configure(configuredServers)
  }

  public get revision(): number {
    return this.#snapshot.revision
  }

  public get size(): number {
    return this.#snapshot.servers.reduce((total, server) => total + server.tools.length, 0)
  }

  public get maxSnapshotBytes(): number {
    return this.#limits.maxSnapshotBytes
  }

  public get maxToolsPerServer(): number {
    return this.#limits.maxToolsPerServer
  }

  public get maxBytesPerTool(): number {
    return this.#limits.maxBytesPerTool
  }

  public snapshot(): CatalogSnapshot {
    return this.#snapshot
  }

  /** Replace the configured endpoint set and immediately prune stale tools. */
  public configure(configuredServers: Iterable<ConfiguredServer>): void {
    const next = normalizeConfiguredServers(configuredServers)
    const configurationChanged = !mapsEqual(this.#configured, next)
    this.#configured = next
    const pruned = pruneSnapshot(this.#snapshot, next)
    const contentChanged = pruned.servers.length !== this.#snapshot.servers.length
      || pruned.servers.some((server, index) => server !== this.#snapshot.servers[index])

    if (contentChanged) {
      this.#snapshot = freezeSnapshot({ ...pruned, revision: this.#snapshot.revision + 1 })
    }
    if (configurationChanged || contentChanged) this.#epoch += 1
  }

  /**
   * Atomically replace one server's tool generation.
   * Returns false for an unconfigured or stale endpoint instead of publishing it.
   */
  public replaceServerTools(
    serverName: string,
    fingerprint: string,
    tools: readonly McpToolMetadata[],
    fetchedAt = Date.now(),
  ): boolean {
    if (this.#configured.get(serverName) !== fingerprint) return false
    if (!isTimestamp(fetchedAt)) throw new TypeError('Catalog fetchedAt must be a non-negative epoch millisecond')
    const nextServer = cloneServer({ name: serverName, fingerprint, fetchedAt, tools }, this.#limits)
    const servers = this.#snapshot.servers.filter(server => server.name !== serverName)
    servers.push(nextServer)
    servers.sort((left, right) => codePointCompare(left.name, right.name))
    this.#replace({ ...this.#snapshot, revision: this.#snapshot.revision + 1, servers })
    return true
  }

  /** Ignore stale teardown events by optionally binding removal to a fingerprint. */
  public removeServer(serverName: string, fingerprint?: string): boolean {
    const existing = this.#snapshot.servers.find(server => server.name === serverName)
    if (existing === undefined || (fingerprint !== undefined && existing.fingerprint !== fingerprint)) return false
    this.#replace({
      ...this.#snapshot,
      revision: this.#snapshot.revision + 1,
      servers: this.#snapshot.servers.filter(server => server.name !== serverName),
    })
    return true
  }

  public get(serverName: string, toolName: string): McpToolMetadata | undefined {
    return this.#snapshot.servers
      .find(server => server.name === serverName)
      ?.tools.find(tool => tool.name === toolName)
  }

  /** Whether this exact endpoint currently has a complete catalog generation. */
  public isFresh(serverName: string, fingerprint: string): boolean {
    return this.#configured.get(serverName) === fingerprint
      && this.#snapshot.servers.some(server => server.name === serverName && server.fingerprint === fingerprint)
  }

  /**
   * Return true when an endpoint has no matching generation or its TTL elapsed.
   * Clock rollback is treated as stale rather than extending cache lifetime.
   */
  public needsRefresh(serverName: string, fingerprint: string, ttlMs: number, now = Date.now()): boolean {
    if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new TypeError('Catalog TTL must be a non-negative number')
    if (!isTimestamp(now)) throw new TypeError('Catalog clock must be a non-negative epoch millisecond')
    if (this.#configured.get(serverName) !== fingerprint) return true
    const server = this.#snapshot.servers.find(candidate => candidate.name === serverName)
    if (server === undefined || server.fingerprint !== fingerprint) return true
    if (now < server.fetchedAt) return true
    return now - server.fetchedAt >= ttlMs
  }

  /** Remove one generation; stale fingerprint-bound invalidations are ignored. */
  public invalidate(serverName: string, fingerprint?: string): boolean {
    return this.removeServer(serverName, fingerprint)
  }

  public search(query: string, options: CatalogSearchOptions = {}): readonly CatalogSearchResult[] {
    return searchCatalog(this.#snapshot, query, options)
  }

  /** Load only if no in-memory generation changed while disk I/O was pending. */
  public async load(cachePath: string): Promise<CacheLoadResult> {
    const epoch = this.#epoch
    const result = await loadCatalogCache(
      cachePath,
      [...this.#configured].map(([name, fingerprint]) => ({ name, fingerprint })),
      this.#limits,
    )
    if (epoch !== this.#epoch) return { status: 'superseded', snapshot: this.#snapshot }
    this.#snapshot = result.snapshot
    this.#epoch += 1
    return result
  }

  /** Serialize writes per catalog instance; each file replacement is atomic. */
  public async save(cachePath: string): Promise<void> {
    const snapshot = this.#snapshot
    const write = this.#writeQueue.then(async () => writeCatalogCache(
      cachePath,
      snapshot,
      this.#limits,
    ))
    this.#writeQueue = write.catch(() => undefined)
    await write
  }

  #replace(snapshot: CatalogSnapshot): void {
    const next = freezeSnapshot(snapshot)
    assertCatalogLimits(next, this.#limits)
    assertSnapshotSize(next, this.#limits.maxSnapshotBytes)
    this.#snapshot = next
    this.#epoch += 1
  }
}

type SearchFieldKind = 'name' | 'title' | 'schema' | 'description' | 'server'

interface SearchField {
  readonly kind: SearchFieldKind
  readonly tokens: ReadonlySet<string>
  readonly length: number
}

interface IndexedDocument {
  readonly server: string
  readonly fingerprint: string
  readonly tool: McpToolMetadata
  readonly fields: readonly SearchField[]
}

const INDEXED_DOCUMENTS = new WeakMap<CatalogSnapshot, readonly IndexedDocument[]>()

function indexedDocuments(snapshot: CatalogSnapshot): readonly IndexedDocument[] {
  const cacheable = FROZEN_CATALOG_SNAPSHOTS.has(snapshot)
  if (cacheable) {
    const cached = INDEXED_DOCUMENTS.get(snapshot)
    if (cached !== undefined) return cached
  }
  const documents = snapshot.servers
    .flatMap(server => server.tools.map(tool => indexTool(server, tool)))
    .sort(compareIndexedDocuments)
  const indexed = Object.freeze(documents)
  if (cacheable) INDEXED_DOCUMENTS.set(snapshot, indexed)
  return indexed
}

function indexTool(server: CatalogServerSnapshot, tool: McpToolMetadata): IndexedDocument {
  const title = typeof tool.title === 'string'
    ? tool.title
    : isRecord(tool.annotations) && typeof tool.annotations.title === 'string'
      ? tool.annotations.title
      : ''
  const parameterText = collectSchemaText(tool.inputSchema as JsonObject).join(' ')
  return {
    server: server.name,
    fingerprint: server.fingerprint,
    tool,
    fields: [
      makeField('name', tool.name),
      makeField('title', title),
      makeField('schema', parameterText),
      makeField('description', tool.description ?? ''),
      makeField('server', server.name),
    ],
  }
}

function makeField(kind: SearchFieldKind, value: string): SearchField {
  const tokens = new Set(tokenizeCanonical(value))
  return { kind, tokens, length: tokens.size }
}

interface GatedQueryTerm {
  readonly term: string
  readonly documentFrequency: number
}

function gateQueryTerms(
  terms: readonly string[],
  documents: readonly IndexedDocument[],
): readonly GatedQueryTerm[] {
  return [...new Set(terms)]
    .filter(term => isCjkChunk(term) || (
      term.length >= EXACT_FIELD_IDF_PARAMS.minimumLatinTermLength
      && !ENGLISH_STOPWORDS.has(term)
    ))
    .map(term => ({ term, documentFrequency: exactDocumentFrequency(term, documents) }))
    .filter(({ documentFrequency }) => documentFrequency === 0
      || documents.length <= SMALL_VISIBLE_CORPUS_MAX_DOCUMENTS
      || (documentFrequency / documents.length) <= EXACT_FIELD_IDF_PARAMS.maxDocumentFrequencyRatio)
}

function rankDocuments(
  documents: readonly IndexedDocument[],
  terms: readonly GatedQueryTerm[],
): CatalogSearchResult[] {
  const ranked: CatalogSearchResult[] = []
  for (const document of documents) {
    let total = 0
    let matched = 0
    const matchedTerms: string[] = []
    for (const term of terms) {
      const contribution = bestExactFieldContribution(document, term)
      if (contribution.score === 0) continue
      matched += 1
      matchedTerms.push(term.term)
      const boundedDocumentFrequency = Math.max(1, contribution.effectiveDocumentFrequency)
      const inverseDocumentFrequency = Math.log(
        1 + ((documents.length - boundedDocumentFrequency + 0.5) / (boundedDocumentFrequency + 0.5)),
      )
      total += contribution.score * inverseDocumentFrequency
    }
    if (matched === 0) continue
    const score = total
      * (1 + EXACT_FIELD_IDF_PARAMS.coverageBonus * (matched / terms.length))
      / Math.sqrt(Math.max(1, terms.length))
    ranked.push({
      server: document.server,
      fingerprint: document.fingerprint,
      tool: document.tool,
      score: roundScore(score),
      // The public string[] has no match-kind discriminator. Keep this field
      // exact-only rather than representing a one-edit fallback as exact.
      matchedTerms,
    })
  }
  ranked.sort(compareSearchResults)
  return ranked
}

interface FieldContribution {
  readonly score: number
  readonly effectiveDocumentFrequency: number
}

function bestExactFieldContribution(
  document: IndexedDocument,
  term: GatedQueryTerm,
): FieldContribution {
  let best = 0
  for (const field of document.fields) {
    const settings = EXACT_FIELD_IDF_PARAMS.fields[field.kind]
    const lengthNormalization = 1 / (
      1 + settings.b * Math.log2(1 + Math.max(0, field.length - 1))
    )
    if (field.tokens.has(term.term)) {
      best = Math.max(best, settings.weight * lengthNormalization)
    }
  }
  return { score: best, effectiveDocumentFrequency: term.documentFrequency }
}

interface OneEditMatch {
  readonly document: IndexedDocument
  readonly fieldScore: number
}

/** `undefined` means the global candidate-token budget was exceeded. */
function rankOneEditFallback(
  documents: readonly IndexedDocument[],
  term: GatedQueryTerm,
): CatalogSearchResult[] | undefined {
  const matches: OneEditMatch[] = []
  let candidateTokens = 0
  for (const document of documents) {
    let best = 0
    for (const field of document.fields) {
      if (field.kind !== 'name' && field.kind !== 'title') continue
      const settings = EXACT_FIELD_IDF_PARAMS.fields[field.kind]
      const lengthNormalization = 1 / (
        1 + settings.b * Math.log2(1 + Math.max(0, field.length - 1))
      )
      for (const candidate of field.tokens) {
        candidateTokens += 1
        if (candidateTokens > MAX_ONE_EDIT_CANDIDATE_TOKENS) return undefined
        if (!isTrueOneEdit(term.term, candidate)) continue
        best = Math.max(best, settings.weight * lengthNormalization)
      }
    }
    if (best > 0) matches.push({ document, fieldScore: best })
  }

  const documentFrequency = matches.length
  if (documentFrequency === 0) return []
  const inverseDocumentFrequency = Math.log(
    1 + ((documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5)),
  )
  const coverage = 1 + EXACT_FIELD_IDF_PARAMS.coverageBonus
  const ranked = matches.map(({ document, fieldScore }): CatalogSearchResult => ({
    server: document.server,
    fingerprint: document.fingerprint,
    tool: document.tool,
    score: roundScore(fieldScore * inverseDocumentFrequency * coverage),
    matchedTerms: [],
  }))
  ranked.sort(compareSearchResults)
  return ranked
}

function fallbackEligible(terms: readonly GatedQueryTerm[]): boolean {
  const only = terms[0]
  return terms.length === 1
    && only !== undefined
    && only.documentFrequency === 0
    && eligibleLatinTerm(only.term)
}

function exactDocumentFrequency(term: string, documents: readonly IndexedDocument[]): number {
  let count = 0
  for (const document of documents) {
    if (document.fields.some(field => field.tokens.has(term))) count += 1
  }
  return count
}

function tokenizeCanonical(value: string): readonly string[] {
  const separated = value
    .normalize('NFKC')
    .replace(/([\p{Ll}\d])([\p{Lu}])/gu, '$1 $2')
    .toLowerCase()
  const terms = new Set<string>()
  const chunks = separated.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{L}\p{N}]+/gu) ?? []
  for (const chunk of chunks) {
    if (isCjkChunk(chunk)) {
      terms.add(chunk)
      if ([...chunk].length > 2) {
        const characters = [...chunk]
        for (let index = 0; index < characters.length - 1; index += 1) {
          terms.add(`${characters[index]}${characters[index + 1]}`)
        }
      }
      continue
    }
    terms.add(canonicalStem(chunk))
  }
  return [...terms]
}

function canonicalStem(term: string): string {
  if (term.length > 4 && term.endsWith('ies')) return `${term.slice(0, -3)}y`
  if (term.length > 4 && /(?:[sxz]|ch|sh)es$/u.test(term)) return term.slice(0, -2)
  if (term.length > 3 && term.endsWith('s') && !term.endsWith('ss')) return term.slice(0, -1)
  return term
}

function isCjkChunk(value: string): boolean {
  return /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(value)
}

function eligibleLatinTerm(term: string): boolean {
  return term.length >= EXACT_FIELD_IDF_PARAMS.oneEdit.minimumLength
    && term.length <= EXACT_FIELD_IDF_PARAMS.oneEdit.maximumLength
    && /^[a-z]+$/u.test(term)
}

function isTrueOneEdit(left: string, right: string): boolean {
  if (!eligibleLatinTerm(left) || !eligibleLatinTerm(right)) return false
  if (Math.abs(left.length - right.length) > 1 || left === right) return false
  if (left.length === right.length) {
    let differences = 0
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] === right[index]) continue
      differences += 1
      if (differences > 1) return false
    }
    return differences === 1
  }

  const shorter = left.length < right.length ? left : right
  const longer = left.length < right.length ? right : left
  let shortIndex = 0
  let longIndex = 0
  let skipped = false
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1
      longIndex += 1
      continue
    }
    if (skipped) return false
    skipped = true
    longIndex += 1
  }
  return true
}

function compareSearchResults(left: CatalogSearchResult, right: CatalogSearchResult): number {
  if (left.score !== right.score) return right.score - left.score
  const byServer = codePointCompare(left.server, right.server)
  if (byServer !== 0) return byServer
  return codePointCompare(left.tool.name, right.tool.name)
}

function collectSchemaText(schema: JsonObject): readonly string[] {
  const collected: string[] = []
  const seen = new Set<object>()

  const visit = (value: JsonValue, depth: number): void => {
    if (depth > 64 || value === null || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    const record = value as JsonObject
    if (typeof record.title === 'string') collected.push(record.title)
    if (typeof record.description === 'string') collected.push(record.description)
    if (isRecord(record.properties)) {
      for (const [parameterName, parameterSchema] of Object.entries(record.properties)) {
        collected.push(parameterName)
        if (isJsonValue(parameterSchema)) visit(parameterSchema, depth + 1)
      }
    }
    for (const keyword of ['$defs', 'definitions', 'items', 'prefixItems', 'allOf', 'anyOf', 'oneOf', 'not']) {
      const nested = record[keyword]
      if (nested !== undefined) visit(nested, depth + 1)
    }
  }
  visit(schema, 0)
  return collected
}

function parseSnapshot(value: unknown, limits: ResolvedCatalogLimits): CatalogSnapshot {
  if (!isRecord(value)
    || value.format !== CATALOG_CACHE_FORMAT
    || value.formatVersion !== CATALOG_CACHE_FORMAT_VERSION
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 0
    || !Array.isArray(value.servers)) {
    throw new TypeError('Invalid catalog cache envelope')
  }

  const names = new Set<string>()
  const servers: CatalogServerSnapshot[] = []
  for (const candidate of value.servers) {
    if (!isRecord(candidate)
      || !isNonEmptyString(candidate.name)
      || !isNonEmptyString(candidate.fingerprint)
      || !isTimestamp(candidate.fetchedAt)
      || !Array.isArray(candidate.tools)
      || names.has(candidate.name)) {
      throw new TypeError('Invalid catalog server entry')
    }
    if (candidate.tools.length > limits.maxToolsPerServer) {
      throw new CatalogServerToolLimitError(candidate.name, candidate.tools.length, limits.maxToolsPerServer)
    }
    names.add(candidate.name)
    const tools = candidate.tools.map(parseTool)
    servers.push(cloneServer({
      name: candidate.name,
      fingerprint: candidate.fingerprint,
      fetchedAt: candidate.fetchedAt,
      tools,
    }, limits))
  }
  servers.sort((left, right) => codePointCompare(left.name, right.name))
  return freezeSnapshot({
    format: CATALOG_CACHE_FORMAT,
    formatVersion: CATALOG_CACHE_FORMAT_VERSION,
    revision: value.revision as number,
    servers,
  })
}

function parseTool(value: unknown): McpToolMetadata {
  if (!isRecord(value)
    || !isNonEmptyString(value.name)
    || !isRecord(value.inputSchema)
    || !isJsonValue(value.inputSchema)) {
    throw new TypeError('Invalid MCP tool metadata')
  }
  if (value.description !== undefined && typeof value.description !== 'string') {
    throw new TypeError('Invalid MCP tool description')
  }
  if (value.title !== undefined && typeof value.title !== 'string') {
    throw new TypeError('Invalid MCP tool title')
  }

  const annotations = projectAnnotations(value.annotations)
  const execution = projectExecution(value.execution)
  const projected: CatalogTool = {
    name: value.name,
    ...(typeof value.title === 'string' ? { title: value.title } : {}),
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    inputSchema: cloneJson(value.inputSchema) as Readonly<Record<string, unknown>>,
    ...(annotations === undefined ? {} : { annotations }),
    ...(execution === undefined ? {} : { execution }),
  }
  return deepFreeze(projected)
}

function cloneServer(server: CatalogServerSnapshot, limits: ResolvedCatalogLimits): CatalogServerSnapshot {
  if (server.tools.length > limits.maxToolsPerServer) {
    throw new CatalogServerToolLimitError(server.name, server.tools.length, limits.maxToolsPerServer)
  }
  const names = new Set<string>()
  const tools = server.tools.map(tool => {
    const parsed = parseTool(tool)
    const toolBytes = serializedToolBytes(parsed)
    if (toolBytes > limits.maxBytesPerTool) {
      throw new CatalogToolTooLargeError(server.name, parsed.name, toolBytes, limits.maxBytesPerTool)
    }
    if (names.has(parsed.name)) throw new TypeError(`Duplicate MCP tool name: ${parsed.name}`)
    names.add(parsed.name)
    return parsed
  })
  tools.sort((left, right) => codePointCompare(left.name, right.name))
  return deepFreeze({ name: server.name, fingerprint: server.fingerprint, fetchedAt: server.fetchedAt, tools })
}

function projectAnnotations(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new TypeError('Invalid MCP tool annotations')
  const projected: Record<string, string | boolean> = {}
  projectString(value, projected, 'title')
  projectBoolean(value, projected, 'readOnlyHint')
  projectBoolean(value, projected, 'destructiveHint')
  projectBoolean(value, projected, 'idempotentHint')
  projectBoolean(value, projected, 'openWorldHint')
  return Object.keys(projected).length === 0 ? undefined : deepFreeze(projected)
}

function projectExecution(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new TypeError('Invalid MCP tool execution metadata')
  const taskSupport = value.taskSupport
  if (taskSupport === undefined) return undefined
  if (taskSupport !== 'forbidden' && taskSupport !== 'optional' && taskSupport !== 'required') {
    throw new TypeError('Invalid MCP taskSupport metadata')
  }
  return deepFreeze({ taskSupport })
}

function projectString(
  source: Readonly<Record<string, unknown>>,
  target: Record<string, string | boolean>,
  key: string,
): void {
  const value = source[key]
  if (value === undefined) return
  if (typeof value !== 'string') throw new TypeError(`Invalid MCP annotation ${key}`)
  target[key] = value
}

function projectBoolean(
  source: Readonly<Record<string, unknown>>,
  target: Record<string, string | boolean>,
  key: string,
): void {
  const value = source[key]
  if (value === undefined) return
  if (typeof value !== 'boolean') throw new TypeError(`Invalid MCP annotation ${key}`)
  target[key] = value
}

function cloneJson(value: unknown): unknown {
  const text = JSON.stringify(value)
  if (text === undefined) throw new TypeError('MCP metadata must be JSON serializable')
  return JSON.parse(text) as unknown
}

function serializedToolBytes(tool: CatalogTool): number {
  return Buffer.byteLength(JSON.stringify(tool), 'utf8')
}

function serializeSnapshot(snapshot: CatalogSnapshot, maxSnapshotBytes: number): string {
  const serialized = `${JSON.stringify(snapshot)}\n`
  const actualBytes = Buffer.byteLength(serialized, 'utf8')
  if (actualBytes > maxSnapshotBytes) {
    throw new CatalogSnapshotTooLargeError(actualBytes, maxSnapshotBytes)
  }
  return serialized
}

function assertSnapshotSize(snapshot: CatalogSnapshot, maxSnapshotBytes: number): void {
  void serializeSnapshot(snapshot, maxSnapshotBytes)
}

function assertCatalogLimits(snapshot: CatalogSnapshot, limits: ResolvedCatalogLimits): void {
  for (const server of snapshot.servers) {
    if (server.tools.length > limits.maxToolsPerServer) {
      throw new CatalogServerToolLimitError(server.name, server.tools.length, limits.maxToolsPerServer)
    }
    for (const tool of server.tools) {
      const actualBytes = serializedToolBytes(tool)
      if (actualBytes > limits.maxBytesPerTool) {
        throw new CatalogToolTooLargeError(server.name, tool.name, actualBytes, limits.maxBytesPerTool)
      }
    }
  }
}

function resolveCatalogLimits(options: CatalogSizeOptions): ResolvedCatalogLimits {
  const maxSnapshotBytes = options.maxSnapshotBytes ?? DEFAULT_MAX_SNAPSHOT_BYTES
  const maxToolsPerServer = options.maxToolsPerServer ?? DEFAULT_MAX_TOOLS_PER_SERVER
  const maxBytesPerTool = options.maxBytesPerTool ?? DEFAULT_MAX_BYTES_PER_TOOL
  validatePositiveSafeInteger(maxSnapshotBytes, 'maxSnapshotBytes')
  validatePositiveSafeInteger(maxToolsPerServer, 'maxToolsPerServer')
  validatePositiveSafeInteger(maxBytesPerTool, 'maxBytesPerTool')
  return Object.freeze({ maxSnapshotBytes, maxToolsPerServer, maxBytesPerTool })
}

function validatePositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive safe integer`)
  }
}

function pruneSnapshot(snapshot: CatalogSnapshot, configured: ReadonlyMap<string, string>): CatalogSnapshot {
  const servers = snapshot.servers.filter(server => configured.get(server.name) === server.fingerprint)
  if (servers.length === snapshot.servers.length) return snapshot
  return freezeSnapshot({ ...snapshot, servers })
}

function normalizeConfiguredServers(servers: Iterable<ConfiguredServer>): Map<string, string> {
  const normalized = new Map<string, string>()
  for (const server of servers) {
    if (!isNonEmptyString(server.name) || !isNonEmptyString(server.fingerprint)) {
      throw new TypeError('Configured server names and fingerprints must be non-empty strings')
    }
    if (normalized.has(server.name)) throw new TypeError(`Duplicate configured server: ${server.name}`)
    normalized.set(server.name, server.fingerprint)
  }
  return normalized
}

function sanitizedUrlIdentity(rawUrl: string): Readonly<Record<string, string | readonly string[]>> {
  const url = new URL(rawUrl)
  const queryNames = [...new Set(url.searchParams.keys())].sort(codePointCompare)
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  return { endpoint: url.toString(), queryNames }
}

function sanitizedArgsIdentity(args: readonly string[]): readonly string[] {
  const sanitized: string[] = []
  let redactNext = false
  for (const argument of args) {
    if (redactNext) {
      sanitized.push('[REDACTED]')
      redactNext = false
      continue
    }
    const equals = argument.indexOf('=')
    const flag = equals < 0 ? argument : argument.slice(0, equals)
    if (/^(?:--?|\/).*(?:token|secret|pass|key|auth|cookie|credential)/i.test(flag)) {
      if (equals >= 0) sanitized.push(`${flag}=[REDACTED]`)
      else {
        sanitized.push(flag)
        redactNext = true
      }
      continue
    }
    sanitized.push(argument)
  }
  return sanitized
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return 8
  if (!Number.isFinite(value)) return 8
  return Math.max(0, Math.min(100, Math.floor(value)))
}

function compareIndexedDocuments(left: IndexedDocument, right: IndexedDocument): number {
  const byServer = codePointCompare(left.server, right.server)
  return byServer === 0 ? codePointCompare(left.tool.name, right.tool.name) : byServer
}

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function mapsEqual(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean {
  if (left.size !== right.size) return false
  for (const [key, value] of left) if (right.get(key) !== value) return false
  return true
}

function isNodeError(value: unknown, code: string): boolean {
  return value instanceof Error && 'code' in value && value.code === code
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isJsonValue(value: unknown, depth = 0, seen = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || depth > 128 || seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) return value.every(item => isJsonValue(item, depth + 1, seen))
  return Object.values(value).every(item => isJsonValue(item, depth + 1, seen))
}

function freezeSnapshot(snapshot: CatalogSnapshot): CatalogSnapshot {
  const frozen = deepFreeze(snapshot)
  FROZEN_CATALOG_SNAPSHOTS.add(frozen)
  return frozen
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const nested of Object.values(value)) deepFreeze(nested, seen)
  return Object.freeze(value)
}
