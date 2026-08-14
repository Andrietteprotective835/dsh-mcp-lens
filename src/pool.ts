import { createHash } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FetchLike, Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  CallToolResultSchema,
  ListToolsResultSchema,
  ToolListChangedNotificationSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000
const DEFAULT_CALL_TIMEOUT_MS = 60_000
const DEFAULT_IDLE_TIMEOUT_MS = 60_000
const DEFAULT_DISCOVERY_TIMEOUT_MS = 30_000
const DEFAULT_MAX_DISCOVERY_PAGES = 1_000
const DEFAULT_MAX_TOOLS_PER_SERVER = 10_000
const DEFAULT_MAX_BYTES_PER_TOOL = 1_048_576
const DEFAULT_MAX_TOTAL_CATALOG_BYTES = 67_108_864
const DEFAULT_MAX_HTTP_RESPONSE_BYTES = 16_777_216
const DEFAULT_MAX_CURSOR_BYTES = 4_096
const MAX_TIMER_DELAY_MS = 2_147_483_647
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

interface CommonServerConfig {
  /** Stable name used to address this server from the two public tools. */
  name: string
  /** Optional non-secret scope used by the catalog fingerprint layer. */
  cacheNamespace?: string
  /** Maximum MCP initialize handshake time. Defaults to 15 seconds. */
  connectTimeoutMs?: number
  /** Maximum time for one tools/list page or tools/call request. Defaults to 60 seconds. */
  callTimeoutMs?: number
  /** Close an unused connection after this many milliseconds. Zero closes immediately. */
  idleTimeoutMs?: number
}

export interface StdioServerConfig extends CommonServerConfig {
  transport: 'stdio'
  command: string
  args?: readonly string[]
  /** Explicit child environment layered over Harness' scrubbed parent environment. */
  env?: Readonly<Record<string, string>>
  cwd?: string
}

export interface StreamableHttpServerConfig extends CommonServerConfig {
  transport: 'streamable-http'
  url: string
  headers?: Readonly<Record<string, string>>
}

/** One configured MCP server. Connections are created only on first use. */
export type ServerConfig = StdioServerConfig | StreamableHttpServerConfig

/** An MCP tool with the local server identity needed for an exact call. */
export type RemoteTool = Tool & { readonly server: string }

/** The unprojected MCP call result, including every content block and structuredContent. */
export type RemoteCallResult = CallToolResult

export interface ConnectionPoolOptions {
  /** Called when a server explicitly announces tools/list_changed. */
  onCatalogInvalidated?: (server: string) => void
  /** Overall wall-clock deadline for one full paginated discovery. */
  discoveryTimeoutMs?: number
  /** Maximum tools/list pages accepted from one discovery. */
  maxDiscoveryPages?: number
  /** Maximum tools accepted from one server. */
  maxToolsPerServer?: number
  /** Maximum UTF-8 JSON bytes accepted for one tool definition. */
  maxBytesPerTool?: number
  /** Maximum UTF-8 JSON bytes across the latest discovered catalogs in this pool. */
  maxTotalCatalogBytes?: number
  /** Maximum decoded bytes accepted from each Streamable HTTP response. */
  maxHttpResponseBytes?: number
  /** Maximum UTF-8 bytes accepted for one opaque tools/list cursor. */
  maxCursorBytes?: number
}

interface DiscoveryLimits {
  readonly discoveryTimeoutMs: number
  readonly maxDiscoveryPages: number
  readonly maxToolsPerServer: number
  readonly maxBytesPerTool: number
  readonly maxTotalCatalogBytes: number
  readonly maxCursorBytes: number
}

interface Generation {
  readonly client: Client
  closed: boolean
}

interface ConnectAttempt {
  readonly controller: AbortController
  readonly generation: Generation
  promise: Promise<Generation>
  waiters: number
  settled: boolean
}

interface Entry {
  readonly config: ServerConfig
  client: Generation | undefined
  connecting: ConnectAttempt | undefined
  activeOperations: number
  idleTimer: NodeJS.Timeout | undefined
}

interface CombinedSignal {
  signal: AbortSignal
  dispose(): void
}

/**
 * Lazy, bounded MCP connection pool used by the fixed `mcp_search` and
 * `mcp_call` surface. It deliberately never registers remote tools in DSH.
 */
export class ConnectionPool {
  readonly #entries = new Map<string, Entry>()
  readonly #onCatalogInvalidated: ((server: string) => void) | undefined
  readonly #discoveryLimits: DiscoveryLimits
  readonly #maxHttpResponseBytes: number
  readonly #catalogBytesByServer = new Map<string, number>()
  readonly #disposeController = new AbortController()
  readonly #inflight = new Set<Promise<unknown>>()
  #totalCatalogBytes = 0
  #disposed = false
  #disposePromise: Promise<void> | undefined

  constructor(configs: readonly ServerConfig[], options: ConnectionPoolOptions = {}) {
    if (options.onCatalogInvalidated !== undefined && typeof options.onCatalogInvalidated !== 'function') {
      throw new Error('dsh-mcp-lens: onCatalogInvalidated must be a function')
    }
    this.#onCatalogInvalidated = options.onCatalogInvalidated
    this.#discoveryLimits = resolveDiscoveryLimits(options)
    this.#maxHttpResponseBytes = options.maxHttpResponseBytes ?? DEFAULT_MAX_HTTP_RESPONSE_BYTES
    validatePositiveSafeInteger(this.#maxHttpResponseBytes, 'maxHttpResponseBytes')
    for (const raw of configs) {
      const config = normalizeConfig(raw)
      if (this.#entries.has(config.name)) {
        throw new Error(`dsh-mcp-lens: duplicate MCP server name "${config.name}"`)
      }
      this.#entries.set(config.name, {
        config,
        client: undefined,
        connecting: undefined,
        activeOperations: 0,
        idleTimer: undefined,
      })
    }
  }

  /** Configured server names in deterministic configuration order. */
  serverNames(): string[] {
    return [...this.#entries.keys()]
  }

  /** Drain every tools/list page and retain the complete MCP tool metadata. */
  listTools(server: string, signal?: AbortSignal): Promise<RemoteTool[]> {
    return this.#operate(server, signal, async (entry, generation, operationSignal) => {
      const tools: RemoteTool[] = []
      const names = new Set<string>()
      // Store only fixed-size digests: an untrusted server cannot retain its
      // raw cursor strings for the lifetime of a many-page discovery.
      const cursorDigests = new Set<string>()
      const deadlineController = new AbortController()
      const deadlineAt = performance.now() + this.#discoveryLimits.discoveryTimeoutMs
      const deadlineTimer = setTimeout(() => {
        deadlineController.abort(discoveryDeadlineError(server, this.#discoveryLimits.discoveryTimeoutMs))
      }, this.#discoveryLimits.discoveryTimeoutMs)
      deadlineTimer.unref()
      const discoverySignal = combineSignals(operationSignal, deadlineController.signal)
      let cursor: string | undefined
      let pageCount = 0
      let catalogBytes = 0

      try {
        do {
          pageCount += 1
          if (pageCount > this.#discoveryLimits.maxDiscoveryPages) {
            throw new Error(
              `dsh-mcp-lens(${server}): discovery exceeded maxDiscoveryPages (${this.#discoveryLimits.maxDiscoveryPages})`,
            )
          }

          const remainingMs = Math.ceil(deadlineAt - performance.now())
          if (remainingMs <= 0) {
            throw discoveryDeadlineError(server, this.#discoveryLimits.discoveryTimeoutMs)
          }

          let response
          try {
            response = await generation.client.request(
              {
                method: 'tools/list',
                ...(cursor === undefined ? {} : { params: { cursor } }),
              },
              ListToolsResultSchema,
              {
                signal: discoverySignal.signal,
                timeout: Math.min(callTimeout(entry.config), remainingMs),
              },
            )
          } catch (error) {
            if (deadlineController.signal.aborted && !operationSignal.aborted) {
              throw discoveryDeadlineError(server, this.#discoveryLimits.discoveryTimeoutMs)
            }
            throw contextualError(`dsh-mcp-lens(${server}): tools/list failed`, error)
          }

          if (performance.now() >= deadlineAt) {
            throw discoveryDeadlineError(server, this.#discoveryLimits.discoveryTimeoutMs)
          }

          const nextCursor = response.nextCursor
          if (nextCursor !== undefined) {
            const cursorBytes = Buffer.byteLength(nextCursor, 'utf8')
            if (cursorBytes > this.#discoveryLimits.maxCursorBytes) {
              throw new Error(
                `dsh-mcp-lens(${server}): tools/list cursor is ${cursorBytes} bytes, exceeds maxCursorBytes (${this.#discoveryLimits.maxCursorBytes})`,
              )
            }
            const digest = createHash('sha256').update(nextCursor, 'utf8').digest('hex')
            if (cursorDigests.has(digest)) {
              throw new Error(`dsh-mcp-lens(${server}): tools/list repeated cursor`)
            }
            cursorDigests.add(digest)
          }

          for (const tool of response.tools) {
            if (tools.length >= this.#discoveryLimits.maxToolsPerServer) {
              throw new Error(
                `dsh-mcp-lens(${server}): discovery exceeded maxToolsPerServer (${this.#discoveryLimits.maxToolsPerServer})`,
              )
            }
            if (names.has(tool.name)) {
              throw new Error(`dsh-mcp-lens(${server}): tools/list returned duplicate tool "${tool.name}"`)
            }
            const toolBytes = jsonBytes(tool, `dsh-mcp-lens(${server}): tool "${tool.name}"`)
            if (toolBytes > this.#discoveryLimits.maxBytesPerTool) {
              throw new Error(
                `dsh-mcp-lens(${server}): tool "${tool.name}" is ${toolBytes} bytes, exceeds maxBytesPerTool (${this.#discoveryLimits.maxBytesPerTool})`,
              )
            }
            catalogBytes += toolBytes
            if (catalogBytes > this.#discoveryLimits.maxTotalCatalogBytes) {
              throw this.#catalogLimitError(server, catalogBytes)
            }
            names.add(tool.name)
            tools.push({ ...tool, server })
          }

          if (performance.now() >= deadlineAt) {
            throw discoveryDeadlineError(server, this.#discoveryLimits.discoveryTimeoutMs)
          }

          cursor = nextCursor
        } while (cursor !== undefined)

        this.#recordCatalogBytes(server, catalogBytes)
        return tools
      } finally {
        clearTimeout(deadlineTimer)
        discoverySignal.dispose()
      }
    })
  }

  /** Call one exact remote tool while preserving the protocol result as JSON. */
  callTool(
    server: string,
    tool: string,
    args: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<RemoteCallResult> {
    if (tool.length === 0) return Promise.reject(new Error('dsh-mcp-lens: MCP tool name must not be empty'))
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      return Promise.reject(new Error('dsh-mcp-lens: MCP tool arguments must be a JSON object'))
    }

    return this.#operate(server, signal, async (entry, generation, operationSignal) => {
      try {
        // Use the low-level request path so the SDK does not project content to
        // text or pre-validate it through a cached advertised output schema.
        return await generation.client.request(
          { method: 'tools/call', params: { name: tool, arguments: { ...args } } },
          CallToolResultSchema,
          {
            signal: operationSignal,
            timeout: callTimeout(entry.config),
          },
        )
      } catch (error) {
        throw contextualError(`dsh-mcp-lens(${server}): tools/call "${tool}" failed`, error)
      }
    })
  }

  /**
   * Abort work, close all generations, and wait for in-flight operations to
   * settle. Repeated calls share the same teardown promise.
   */
  dispose(): Promise<void> {
    if (this.#disposePromise !== undefined) return this.#disposePromise
    this.#disposed = true
    this.#disposeController.abort(new DOMException('dsh-mcp-lens connection pool disposed', 'AbortError'))

    const attempts: Promise<Generation>[] = []
    for (const entry of this.#entries.values()) {
      this.#clearIdleTimer(entry)
      if (entry.connecting !== undefined) {
        entry.connecting.controller.abort(new DOMException('dsh-mcp-lens connection pool disposed', 'AbortError'))
        attempts.push(entry.connecting.promise)
      }
    }

    this.#disposePromise = (async () => {
      await Promise.allSettled(attempts)

      const generations = new Set<Generation>()
      for (const entry of this.#entries.values()) {
        if (entry.client !== undefined) {
          generations.add(entry.client)
          entry.client = undefined
        }
      }
      await Promise.allSettled([...generations].map(generation => generation.client.close()))
      await Promise.allSettled([...this.#inflight])

      // A connect may have won the abort race immediately before settling.
      const late = new Set<Client>()
      for (const entry of this.#entries.values()) {
        if (entry.client !== undefined) {
          late.add(entry.client.client)
          entry.client = undefined
        }
      }
      await Promise.allSettled([...late].map(client => client.close()))
      this.#catalogBytesByServer.clear()
      this.#totalCatalogBytes = 0
    })()

    return this.#disposePromise
  }

  #operate<T>(
    server: string,
    callerSignal: AbortSignal | undefined,
    action: (entry: Entry, generation: Generation, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const operation = (async () => {
      if (this.#disposed) throw new Error('dsh-mcp-lens: connection pool is disposed')
      const entry = this.#entries.get(server)
      if (entry === undefined) throw new Error(`dsh-mcp-lens: unknown MCP server "${server}"`)

      const combined = combineSignals(callerSignal, this.#disposeController.signal)
      entry.activeOperations += 1
      this.#clearIdleTimer(entry)
      try {
        combined.signal.throwIfAborted()
        const generation = await this.#acquire(entry, combined.signal)
        combined.signal.throwIfAborted()
        return await action(entry, generation, combined.signal)
      } finally {
        combined.dispose()
        entry.activeOperations -= 1
        this.#scheduleIdle(entry)
      }
    })()

    this.#inflight.add(operation)
    void operation.then(
      () => this.#inflight.delete(operation),
      () => this.#inflight.delete(operation),
    )
    return operation
  }

  async #acquire(entry: Entry, signal: AbortSignal): Promise<Generation> {
    if (entry.client !== undefined && !entry.client.closed) return entry.client

    let attempt = entry.connecting
    if (attempt === undefined) {
      const controller = new AbortController()
      const generation: Generation = {
        client: new Client({ name: 'dsh-mcp-lens', version: '0.1.0' }, { capabilities: {} }),
        closed: false,
      }
      attempt = {
        controller,
        generation,
        promise: Promise.resolve(generation),
        waiters: 0,
        settled: false,
      }
      attempt.promise = this.#connect(entry, attempt)
      entry.connecting = attempt
      void attempt.promise.then(
        () => this.#finishAttempt(entry, attempt!),
        () => this.#finishAttempt(entry, attempt!),
      )
    }

    attempt.waiters += 1
    try {
      return await waitWithSignal(attempt.promise, signal)
    } finally {
      attempt.waiters -= 1
      if (!attempt.settled && attempt.waiters === 0) {
        attempt.controller.abort(new DOMException('MCP connection attempt has no remaining waiters', 'AbortError'))
      }
    }
  }

  async #connect(entry: Entry, attempt: ConnectAttempt): Promise<Generation> {
    const { generation } = attempt
    const { client } = generation
    client.onclose = () => {
      generation.closed = true
      if (entry.client === generation) {
        entry.client = undefined
        this.#clearIdleTimer(entry)
      }
    }
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      if (!this.#disposed && !generation.closed) this.#invalidate(entry.config.name)
    })

    try {
      await client.connect(createTransport(entry.config, this.#maxHttpResponseBytes), {
        signal: attempt.controller.signal,
        timeout: connectTimeout(entry.config),
      })
      attempt.controller.signal.throwIfAborted()
      if (generation.closed) throw new Error('connection closed during MCP initialization')
      if (this.#disposed) throw new Error('connection pool disposed during MCP initialization')
      entry.client = generation
      this.#scheduleIdle(entry)
      return generation
    } catch (error) {
      try { await client.close() } catch { /* the transport may already be closed */ }
      throw contextualError(`dsh-mcp-lens(${entry.config.name}): connection failed`, error)
    }
  }

  #finishAttempt(entry: Entry, attempt: ConnectAttempt): void {
    attempt.settled = true
    if (entry.connecting === attempt) entry.connecting = undefined
  }

  #scheduleIdle(entry: Entry): void {
    if (this.#disposed || entry.activeOperations !== 0 || entry.client === undefined) return
    this.#clearIdleTimer(entry)
    const generation = entry.client
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = undefined
      if (this.#disposed || entry.activeOperations !== 0 || entry.client !== generation) return
      entry.client = undefined
      void generation.client.close().catch(() => {})
    }, idleTimeout(entry.config))
    entry.idleTimer.unref()
  }

  #clearIdleTimer(entry: Entry): void {
    if (entry.idleTimer === undefined) return
    clearTimeout(entry.idleTimer)
    entry.idleTimer = undefined
  }

  #invalidate(server: string): void {
    const catalogBytes = this.#catalogBytesByServer.get(server)
    if (catalogBytes !== undefined) {
      this.#catalogBytesByServer.delete(server)
      this.#totalCatalogBytes -= catalogBytes
    }
    try {
      this.#onCatalogInvalidated?.(server)
    } catch {
      // Catalog invalidation is advisory and must not tear down MCP protocol handling.
    }
  }

  #recordCatalogBytes(server: string, catalogBytes: number): void {
    const previous = this.#catalogBytesByServer.get(server) ?? 0
    const bytesWithoutPrevious = this.#totalCatalogBytes - previous
    if (catalogBytes > this.#discoveryLimits.maxTotalCatalogBytes - bytesWithoutPrevious) {
      throw this.#catalogLimitError(server, bytesWithoutPrevious + catalogBytes)
    }
    this.#catalogBytesByServer.set(server, catalogBytes)
    this.#totalCatalogBytes = bytesWithoutPrevious + catalogBytes
  }

  #catalogLimitError(server: string, bytes: number): Error {
    return new Error(
      `dsh-mcp-lens(${server}): catalog would total ${bytes} bytes, exceeds maxTotalCatalogBytes (${this.#discoveryLimits.maxTotalCatalogBytes})`,
    )
  }
}

function createTransport(config: ServerConfig, maxHttpResponseBytes: number): Transport {
  if (config.transport === 'stdio') {
    const options = {
      command: config.command,
      args: [...(config.args ?? [])],
      env: { ...scrubbedParentEnv(), ...(config.env ?? {}) },
      ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
    }
    // StdioClientTransport executes command + argv directly; there is no shell seam.
    return new StdioClientTransport(options)
  }

  return new StreamableHTTPClientTransport(
    new URL(config.url),
    {
      requestInit: { headers: { ...(config.headers ?? {}) } },
      fetch: boundedFetch(maxHttpResponseBytes),
    },
  ) as Transport
}

/** Bound every decoded HTTP response before the MCP SDK parses JSON or SSE. */
function boundedFetch(maxBytes: number): FetchLike {
  return async (url, init) => {
    const response = await globalThis.fetch(url, init)
    const declaredLength = response.headers.get('content-length')?.trim()
    if (declaredLength !== undefined && /^\d+$/.test(declaredLength)) {
      const declaredBytes = BigInt(declaredLength)
      if (declaredBytes > BigInt(maxBytes)) {
        const error = httpResponseLimitError(maxBytes, `declared Content-Length ${declaredLength}`)
        void response.body?.cancel(error).catch(() => {})
        throw error
      }
    }

    if (response.body === null) return response
    const reader = response.body.getReader()
    let receivedBytes = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await reader.read()
          if (result.done) {
            controller.close()
            return
          }
          if (result.value.byteLength > maxBytes - receivedBytes) {
            const error = httpResponseLimitError(maxBytes, 'streamed body')
            void reader.cancel(error).catch(() => {})
            controller.error(error)
            return
          }
          receivedBytes += result.value.byteLength
          controller.enqueue(result.value)
        } catch (error) {
          controller.error(error)
        }
      },
      cancel(reason) {
        return reader.cancel(reason)
      },
    })

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    })
  }
}

function httpResponseLimitError(maxBytes: number, detail: string): Error {
  return new Error(`dsh-mcp-lens: MCP HTTP response ${detail} exceeds maxHttpResponseBytes (${maxBytes})`)
}

function normalizeConfig(config: ServerConfig): ServerConfig {
  if (!SERVER_NAME_PATTERN.test(config.name)) {
    throw new Error(`dsh-mcp-lens: server name "${config.name}" must match ${SERVER_NAME_PATTERN}`)
  }
  validateTimeout(config.connectTimeoutMs, 'connectTimeoutMs', false)
  validateTimeout(config.callTimeoutMs, 'callTimeoutMs', false)
  validateTimeout(config.idleTimeoutMs, 'idleTimeoutMs', true)

  if (config.transport === 'stdio') {
    if (config.command.trim().length === 0) {
      throw new Error(`dsh-mcp-lens(${config.name}): stdio command must not be empty`)
    }
    return {
      ...config,
      args: [...(config.args ?? [])],
      env: { ...(config.env ?? {}) },
    }
  }

  let url: URL
  try {
    url = new URL(config.url)
  } catch (error) {
    throw new Error(`dsh-mcp-lens(${config.name}): invalid streamable-http URL`, { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`dsh-mcp-lens(${config.name}): streamable-http URL must use http or https`)
  }
  return { ...config, url: url.toString(), headers: { ...(config.headers ?? {}) } }
}

function resolveDiscoveryLimits(options: ConnectionPoolOptions): DiscoveryLimits {
  const discoveryTimeoutMs = options.discoveryTimeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS
  const maxDiscoveryPages = options.maxDiscoveryPages ?? DEFAULT_MAX_DISCOVERY_PAGES
  const maxToolsPerServer = options.maxToolsPerServer ?? DEFAULT_MAX_TOOLS_PER_SERVER
  const maxBytesPerTool = options.maxBytesPerTool ?? DEFAULT_MAX_BYTES_PER_TOOL
  const maxTotalCatalogBytes = options.maxTotalCatalogBytes ?? DEFAULT_MAX_TOTAL_CATALOG_BYTES
  const maxCursorBytes = options.maxCursorBytes ?? DEFAULT_MAX_CURSOR_BYTES

  validateTimeout(discoveryTimeoutMs, 'discoveryTimeoutMs', false)
  validatePositiveSafeInteger(maxDiscoveryPages, 'maxDiscoveryPages')
  validatePositiveSafeInteger(maxToolsPerServer, 'maxToolsPerServer')
  validatePositiveSafeInteger(maxBytesPerTool, 'maxBytesPerTool')
  validatePositiveSafeInteger(maxTotalCatalogBytes, 'maxTotalCatalogBytes')
  validatePositiveSafeInteger(maxCursorBytes, 'maxCursorBytes')

  return Object.freeze({
    discoveryTimeoutMs,
    maxDiscoveryPages,
    maxToolsPerServer,
    maxBytesPerTool,
    maxTotalCatalogBytes,
    maxCursorBytes,
  })
}

function validateTimeout(value: number | undefined, field: string, allowZero: boolean): void {
  if (value === undefined) return
  const lowerBound = allowZero ? 0 : 1
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < lowerBound || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`dsh-mcp-lens: ${field} must be an integer from ${lowerBound} to ${MAX_TIMER_DELAY_MS}`)
  }
}

function validatePositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`dsh-mcp-lens: ${field} must be a positive safe integer`)
  }
}

function jsonBytes(value: unknown, context: string): number {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new Error('value is not JSON-serializable')
    return Buffer.byteLength(serialized, 'utf8')
  } catch (error) {
    throw new Error(`${context} is not JSON-serializable`, { cause: error })
  }
}

function discoveryDeadlineError(server: string, timeoutMs: number): Error {
  return new Error(`dsh-mcp-lens(${server}): discovery exceeded overall deadline (${timeoutMs}ms)`)
}

function connectTimeout(config: ServerConfig): number {
  return config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
}

function callTimeout(config: ServerConfig): number {
  return config.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
}

function idleTimeout(config: ServerConfig): number {
  return config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
}

function contextualError(context: string, error: unknown): Error {
  if (error instanceof Error && error.name === 'AbortError') return error
  const detail = error instanceof Error ? error.message : String(error)
  return new Error(`${context}: ${detail}`, { cause: error })
}

function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(abortReason(signal))
    }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then(
      value => {
        cleanup()
        resolve(value)
      },
      error => {
        cleanup()
        reject(error)
      },
    )
  })
}

function combineSignals(caller: AbortSignal | undefined, disposal: AbortSignal): CombinedSignal {
  if (caller === undefined) return { signal: disposal, dispose() {} }
  const controller = new AbortController()
  const abortFrom = (source: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(abortReason(source))
  }
  const onCallerAbort = () => abortFrom(caller)
  const onDisposalAbort = () => abortFrom(disposal)
  caller.addEventListener('abort', onCallerAbort, { once: true })
  disposal.addEventListener('abort', onDisposalAbort, { once: true })
  if (caller.aborted) abortFrom(caller)
  else if (disposal.aborted) abortFrom(disposal)

  return {
    signal: controller.signal,
    dispose() {
      caller.removeEventListener('abort', onCallerAbort)
      disposal.removeEventListener('abort', onDisposalAbort)
    },
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}
