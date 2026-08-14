import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const execFileAsync = promisify(execFile)

interface Scenario {
  connect?: (options: { signal?: AbortSignal, timeout?: number }) => Promise<void>
  request?: (
    request: { method: string, params?: Record<string, unknown> },
    options: { signal?: AbortSignal, timeout?: number },
  ) => Promise<unknown>
}

const mocks = vi.hoisted(() => ({
  scenarios: [] as Scenario[],
  clients: [] as Array<{
    onclose?: () => void
    notificationHandler?: () => void
    connect: ReturnType<typeof vi.fn>
    request: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }>,
  stdioOptions: [] as Array<Record<string, unknown>>,
  httpOptions: [] as Array<{ url: URL, options: Record<string, unknown> }>,
  scrubbedParentEnv: vi.fn(() => ({ PATH: '/scrubbed/bin', LANG: 'C' })),
}))

vi.mock('@deepseek-ai/dsh-subprocess', () => ({
  scrubbedParentEnv: mocks.scrubbedParentEnv,
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {
    constructor(options: Record<string, unknown>) {
      mocks.stdioOptions.push(options)
    }
  },
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    constructor(url: URL, options: Record<string, unknown>) {
      mocks.httpOptions.push({ url, options })
    }
  },
}))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    onclose?: () => void
    notificationHandler?: () => void
    readonly scenario = mocks.scenarios.shift() ?? {}
    readonly connect = vi.fn(async (_transport: unknown, options: { signal?: AbortSignal, timeout?: number }) => {
      await this.scenario.connect?.(options)
      options.signal?.throwIfAborted()
    })
    readonly request = vi.fn(async (
      request: { method: string, params?: Record<string, unknown> },
      _schema: unknown,
      options: { signal?: AbortSignal, timeout?: number },
    ) => {
      options.signal?.throwIfAborted()
      if (this.scenario.request !== undefined) return await this.scenario.request(request, options)
      if (request.method === 'tools/list') return { tools: [] }
      return { content: [] }
    })
    readonly close = vi.fn(async () => {
      this.onclose?.()
    })

    constructor() {
      mocks.clients.push(this)
    }

    setNotificationHandler(_schema: unknown, handler: () => void): void {
      this.notificationHandler = handler
    }
  },
}))

import { ConnectionPool, type ConnectionPoolOptions, type ServerConfig } from '../src/pool.js'

const pools = new Set<ConnectionPool>()

function makePool(configs: readonly ServerConfig[], onCatalogInvalidated?: (server: string) => void): ConnectionPool {
  const options = onCatalogInvalidated === undefined ? {} : { onCatalogInvalidated }
  return makePoolWithOptions(configs, options)
}

function makePoolWithOptions(configs: readonly ServerConfig[], options: ConnectionPoolOptions): ConnectionPool {
  const pool = new ConnectionPool(configs, options)
  pools.add(pool)
  return pool
}

function stdio(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    name: 'local',
    transport: 'stdio',
    command: 'mcp-fixture',
    args: ['--stdio'],
    env: { EXPLICIT_TOKEN: 'allowed' },
    cwd: '/fixture',
    connectTimeoutMs: 1_234,
    callTimeoutMs: 4_321,
    idleTimeoutMs: 60_000,
    ...overrides,
  } as ServerConfig
}

function deferred<T>(): { promise: Promise<T>, resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(settle => { resolve = settle })
  return { promise, resolve }
}

beforeEach(() => {
  mocks.scenarios.length = 0
  mocks.clients.length = 0
  mocks.stdioOptions.length = 0
  mocks.httpOptions.length = 0
  mocks.scrubbedParentEnv.mockClear()
})

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all([...pools].map(pool => pool.dispose()))
  pools.clear()
})

describe('ConnectionPool', () => {
  it('is lazy and starts stdio without a shell from scrubbed plus explicit env', async () => {
    const pool = makePool([stdio()])
    expect(mocks.clients).toHaveLength(0)

    await pool.listTools('local')

    expect(mocks.clients).toHaveLength(1)
    expect(mocks.scrubbedParentEnv).toHaveBeenCalledOnce()
    expect(mocks.stdioOptions).toEqual([{
      command: 'mcp-fixture',
      args: ['--stdio'],
      env: { PATH: '/scrubbed/bin', LANG: 'C', EXPLICIT_TOKEN: 'allowed' },
      cwd: '/fixture',
    }])
    expect(mocks.stdioOptions[0]).not.toHaveProperty('shell')
    expect(mocks.clients[0]?.connect.mock.calls[0]?.[1]).toMatchObject({ timeout: 1_234 })
  })

  it('merges concurrent first-use handshakes for one server', async () => {
    const gate = deferred<void>()
    mocks.scenarios.push({ connect: async () => await gate.promise })
    const pool = makePool([stdio()])

    const first = pool.listTools('local')
    const second = pool.listTools('local')
    expect(mocks.clients).toHaveLength(1)
    expect(mocks.clients[0]?.connect).toHaveBeenCalledOnce()

    gate.resolve(undefined)
    await expect(Promise.all([first, second])).resolves.toEqual([[], []])
    expect(mocks.clients[0]?.request).toHaveBeenCalledTimes(2)
  })

  it('lets one handshake waiter cancel without aborting another waiter', async () => {
    const gate = deferred<void>()
    mocks.scenarios.push({ connect: async options => {
      expect(options.timeout).toBe(1_234)
      await gate.promise
      options.signal?.throwIfAborted()
    } })
    const pool = makePool([stdio()])
    const controller = new AbortController()

    const cancelled = pool.listTools('local', controller.signal)
    const surviving = pool.listTools('local')
    controller.abort(new DOMException('only this waiter stopped', 'AbortError'))
    gate.resolve(undefined)

    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    await expect(surviving).resolves.toEqual([])
    expect(mocks.clients).toHaveLength(1)
    expect(mocks.clients[0]?.connect).toHaveBeenCalledOnce()
  })

  it('drains tools/list pagination and retains task support for upper-layer policy', async () => {
    const pages = [
      {
        tools: [{
          name: 'alpha',
          description: 'first',
          inputSchema: { type: 'object' },
          execution: { taskSupport: 'required' },
        }],
        nextCursor: 'page-2',
      },
      {
        tools: [{ name: 'beta', inputSchema: { type: 'object' } }],
      },
    ]
    mocks.scenarios.push({ request: async request => {
      if (request.method !== 'tools/list') throw new Error('unexpected method')
      const page = pages.shift()
      if (page === undefined) throw new Error('too many pages')
      return page
    } })
    const pool = makePool([stdio()])

    const tools = await pool.listTools('local')

    expect(tools.map(tool => `${tool.server}/${tool.name}`)).toEqual(['local/alpha', 'local/beta'])
    expect(tools[0]?.execution?.taskSupport).toBe('required')
    expect(mocks.clients[0]?.request.mock.calls[1]?.[0]).toEqual({
      method: 'tools/list',
      params: { cursor: 'page-2' },
    })
  })

  it('rejects duplicate tools and cursor cycles instead of publishing an ambiguous catalog', async () => {
    const cursors = ['alpha', 'beta', 'alpha']
    let page = 0
    mocks.scenarios.push({ request: async () => ({
      tools: [{ name: `tool-${page += 1}`, inputSchema: { type: 'object' } }],
      nextCursor: cursors.shift(),
    }) })
    const pool = makePool([stdio()])

    await expect(pool.listTools('local')).rejects.toThrow(/tools\/list repeated cursor/)
    expect(mocks.clients[0]?.request).toHaveBeenCalledTimes(3)
  })

  it('rejects an oversized unique cursor by UTF-8 bytes before requesting another page', async () => {
    mocks.scenarios.push({ request: async () => ({
      tools: [{ name: 'first', inputSchema: { type: 'object' } }],
      nextCursor: '界界',
    }) })
    const pool = makePoolWithOptions([stdio()], { maxCursorBytes: 4 })

    await expect(pool.listTools('local')).rejects.toThrow(
      /tools\/list cursor is 6 bytes, exceeds maxCursorBytes \(4\)/,
    )
    expect(mocks.clients[0]?.request).toHaveBeenCalledOnce()
  })

  it('stops unique-cursor infinite pagination at maxDiscoveryPages without returning partial tools', async () => {
    let page = 0
    mocks.scenarios.push({ request: async () => ({
      tools: [{ name: `tool-${page}`, inputSchema: { type: 'object' } }],
      nextCursor: `cursor-${page += 1}`,
    }) })
    const pool = makePoolWithOptions([stdio()], { maxDiscoveryPages: 3 })

    await expect(pool.listTools('local')).rejects.toThrow(/exceeded maxDiscoveryPages \(3\)/)
    expect(mocks.clients[0]?.request).toHaveBeenCalledTimes(3)
  })

  it('fails the whole discovery when maxToolsPerServer is exceeded', async () => {
    const listed = Array.from({ length: 3 }, (_, index) => ({
      name: `tool-${index}`,
      inputSchema: { type: 'object' as const },
    }))
    mocks.scenarios.push({ request: async () => ({ tools: listed }) })
    const pool = makePoolWithOptions([stdio()], { maxToolsPerServer: 2 })

    await expect(pool.listTools('local')).rejects.toThrow(/exceeded maxToolsPerServer \(2\)/)
  })

  it('fails the whole discovery when one tool exceeds maxBytesPerTool', async () => {
    const listed = {
      name: 'oversized',
      description: 'x'.repeat(128),
      inputSchema: { type: 'object' as const },
    }
    const bytes = Buffer.byteLength(JSON.stringify(listed), 'utf8')
    mocks.scenarios.push({ request: async () => ({ tools: [listed] }) })
    const pool = makePoolWithOptions([stdio()], { maxBytesPerTool: bytes - 1 })

    await expect(pool.listTools('local')).rejects.toThrow(
      new RegExp(`tool "oversized" is ${bytes} bytes, exceeds maxBytesPerTool \\(${bytes - 1}\\)`),
    )
  })

  it('caps total bytes across the latest successfully discovered server catalogs', async () => {
    const firstTool = { name: 'alpha', description: 'a'.repeat(40), inputSchema: { type: 'object' as const } }
    const secondTool = { name: 'beta', description: 'b'.repeat(40), inputSchema: { type: 'object' as const } }
    const firstBytes = Buffer.byteLength(JSON.stringify(firstTool), 'utf8')
    const secondBytes = Buffer.byteLength(JSON.stringify(secondTool), 'utf8')
    const totalLimit = firstBytes + secondBytes - 1
    mocks.scenarios.push(
      { request: async () => ({ tools: [firstTool] }) },
      { request: async () => ({ tools: [secondTool] }) },
    )
    const pool = makePoolWithOptions(
      [stdio({ name: 'first' }), stdio({ name: 'second' })],
      { maxTotalCatalogBytes: totalLimit },
    )

    await expect(pool.listTools('first')).resolves.toHaveLength(1)
    await expect(pool.listTools('second')).rejects.toThrow(
      new RegExp(`catalog would total ${firstBytes + secondBytes} bytes, exceeds maxTotalCatalogBytes \\(${totalLimit}\\)`),
    )
  })

  it('enforces one overall discovery deadline across pages instead of resetting callTimeout', async () => {
    vi.useFakeTimers()
    const observedTimeouts: number[] = []
    let page = 0
    mocks.scenarios.push({ request: async (_request, options) => {
      observedTimeouts.push(options.timeout ?? -1)
      const signal = options.signal
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup()
          page += 1
          resolve({ tools: [], nextCursor: `page-${page}` })
        }, 20)
        const onAbort = () => {
          cleanup()
          reject(signal?.reason)
        }
        const cleanup = () => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
        }
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    } })
    const pool = makePoolWithOptions(
      [stdio({ callTimeoutMs: 1_000 })],
      { discoveryTimeoutMs: 25, maxDiscoveryPages: 100 },
    )

    const discovery = pool.listTools('local')
    await vi.advanceTimersByTimeAsync(20)
    await vi.advanceTimersByTimeAsync(5)

    await expect(discovery).rejects.toThrow(/overall deadline \(25ms\)/)
    expect(observedTimeouts).toHaveLength(2)
    expect(observedTimeouts[0]).toBeLessThanOrEqual(25)
    expect(observedTimeouts[1]).toBeLessThanOrEqual(5)
  })

  it('preserves JSON content, structuredContent, and isError while passing timeout and cancellation', async () => {
    const result = {
      content: [
        { type: 'text', text: 'hello', _meta: { source: 'fixture' } },
        { type: 'image', data: 'AQID', mimeType: 'image/png' },
      ],
      structuredContent: { nested: { count: 2 }, items: [1, true, null] },
      isError: true,
      _meta: { trace: 't-1' },
    }
    mocks.scenarios.push({ request: async (_request, options) => {
      expect(options.timeout).toBe(4_321)
      expect(options.signal).toBeInstanceOf(AbortSignal)
      return result
    } })
    const pool = makePool([stdio()])

    await expect(pool.callTool('local', 'render', { quality: 2 })).resolves.toEqual(result)
    expect(mocks.clients[0]?.request.mock.calls[0]?.[0]).toEqual({
      method: 'tools/call',
      params: { name: 'render', arguments: { quality: 2 } },
    })
  })

  it('propagates caller cancellation into an in-flight call', async () => {
    mocks.scenarios.push({ request: async (_request, options) => await new Promise((_resolve, reject) => {
      const signal = options.signal
      if (signal === undefined) return reject(new Error('missing signal'))
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }) })
    const pool = makePool([stdio()])
    const controller = new AbortController()

    const call = pool.callTool('local', 'slow', {}, controller.signal)
    await vi.waitFor(() => expect(mocks.clients[0]?.request).toHaveBeenCalledOnce())
    controller.abort(new DOMException('caller stopped', 'AbortError'))

    await expect(call).rejects.toMatchObject({ name: 'AbortError', message: 'caller stopped' })
  })

  it('constructs streamable HTTP and never connects it at pool creation', async () => {
    const pool = makePool([{
      name: 'remote',
      transport: 'streamable-http',
      url: 'https://mcp.example.test/rpc',
      headers: { Authorization: 'Bearer explicit' },
    }])
    expect(mocks.httpOptions).toHaveLength(0)

    await pool.listTools('remote')

    expect(mocks.httpOptions[0]?.url.toString()).toBe('https://mcp.example.test/rpc')
    expect(mocks.httpOptions[0]?.options).toMatchObject({
      requestInit: { headers: { Authorization: 'Bearer explicit' } },
    })
    expect(mocks.httpOptions[0]?.options.fetch).toBeTypeOf('function')
  })

  it('rejects an oversized HTTP Content-Length before decoding and cancels the body', async () => {
    const pool = makePoolWithOptions([{
      name: 'remote',
      transport: 'streamable-http',
      url: 'https://mcp.example.test/rpc',
    }], { maxHttpResponseBytes: 10 })
    await pool.listTools('remote')
    const bounded = mocks.httpOptions[0]?.options.fetch as
      | ((url: string | URL, init?: RequestInit) => Promise<Response>)
      | undefined
    expect(bounded).toBeTypeOf('function')

    let cancelReason: unknown
    const source = new ReadableStream<Uint8Array>({
      cancel(reason) { cancelReason = reason },
    })
    const upstream = new Response(source, {
      status: 200,
      statusText: 'OK',
      headers: { 'content-length': '11', 'content-type': 'application/json' },
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(upstream)
    try {
      await expect(bounded?.('https://mcp.example.test/rpc', { method: 'POST' })).rejects.toThrow(
        /declared Content-Length 11 exceeds maxHttpResponseBytes \(10\)/,
      )
      await vi.waitFor(() => expect(cancelReason).toBeInstanceOf(Error))
      expect(fetchSpy).toHaveBeenCalledWith('https://mcp.example.test/rpc', { method: 'POST' })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('streams chunked HTTP bodies and errors plus cancels at maxHttpResponseBytes', async () => {
    const pool = makePoolWithOptions([{
      name: 'remote',
      transport: 'streamable-http',
      url: 'https://mcp.example.test/rpc',
    }], { maxHttpResponseBytes: 10 })
    await pool.listTools('remote')
    const bounded = mocks.httpOptions[0]?.options.fetch as
      | ((url: string | URL, init?: RequestInit) => Promise<Response>)
      | undefined
    expect(bounded).toBeTypeOf('function')

    let cancelReason: unknown
    const source = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(6).fill(97)) },
      cancel(reason) { cancelReason = reason },
    })
    const upstream = new Response(source, {
      status: 206,
      statusText: 'Partial Content',
      headers: { 'content-type': 'text/event-stream', 'x-fixture': 'preserved' },
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(upstream)
    try {
      const response = await bounded?.('https://mcp.example.test/rpc', { method: 'GET' })
      expect(response?.status).toBe(206)
      expect(response?.statusText).toBe('Partial Content')
      expect(response?.headers.get('content-type')).toBe('text/event-stream')
      expect(response?.headers.get('x-fixture')).toBe('preserved')
      await expect(response?.text()).rejects.toThrow(/streamed body exceeds maxHttpResponseBytes \(10\)/)
      await vi.waitFor(() => expect(cancelReason).toBeInstanceOf(Error))
      expect(fetchSpy).toHaveBeenCalledWith('https://mcp.example.test/rpc', { method: 'GET' })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('lists and calls through a real local Streamable HTTP MCP server', async () => {
    const script = String.raw`
      import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
      import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
      import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
      import * as z from 'zod/v4'
      import { ConnectionPool } from './src/pool.ts'

      const makeServer = () => {
        const server = new McpServer({ name: 'http-fixture', version: '1.0.0' })
        server.registerTool('echo', {
          description: 'Echo structured text',
          inputSchema: { text: z.string() },
          outputSchema: { echoed: z.string() },
        }, async ({ text }) => ({
          content: [{ type: 'text', text }],
          structuredContent: { echoed: text },
        }))
        return server
      }

      const app = createMcpExpressApp()
      app.post('/mcp', async (request, response) => {
        const server = makeServer()
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
        try {
          await server.connect(transport)
          await transport.handleRequest(request, response, request.body)
        } catch (error) {
          if (!response.headersSent) response.status(500).json({ error: String(error) })
        } finally {
          response.on('close', () => {
            void transport.close()
            void server.close()
          })
        }
      })

      const httpServer = await new Promise((resolve, reject) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
        listening.on('error', reject)
      })
      const address = httpServer.address()
      if (address === null || typeof address === 'string') throw new Error('fixture did not bind TCP')
      const pool = new ConnectionPool([{
        name: 'real-http',
        transport: 'streamable-http',
        url: 'http://127.0.0.1:' + address.port + '/mcp',
        connectTimeoutMs: 5_000,
        callTimeoutMs: 5_000,
        idleTimeoutMs: 5_000,
      }], { discoveryTimeoutMs: 5_000 })

      try {
        const tools = await pool.listTools('real-http')
        const result = await pool.callTool('real-http', 'echo', { text: 'round-trip' })
        process.stdout.write(JSON.stringify({ names: tools.map(tool => tool.name), result }))
      } finally {
        await pool.dispose()
        await new Promise(resolve => httpServer.close(resolve))
      }
    `

    const { stdout } = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', script],
      { cwd: process.cwd(), timeout: 15_000, maxBuffer: 1_000_000 },
    )
    expect(JSON.parse(stdout)).toEqual({
      names: ['echo'],
      result: {
        content: [{ type: 'text', text: 'round-trip' }],
        structuredContent: { echoed: 'round-trip' },
      },
    })
  }, 20_000)

  it('invalidates on tools/list_changed and replaces a client closed by the peer', async () => {
    const invalidated = vi.fn()
    const pool = makePool([stdio()], invalidated)
    await pool.listTools('local')
    const firstClient = mocks.clients[0]

    firstClient?.notificationHandler?.()
    expect(invalidated).toHaveBeenCalledWith('local')

    firstClient?.onclose?.()
    await pool.listTools('local')
    expect(mocks.clients).toHaveLength(2)
  })

  it('disconnects idle clients and the timer does not retain later work', async () => {
    vi.useFakeTimers()
    const pool = makePool([stdio({ idleTimeoutMs: 25 })])
    await pool.listTools('local')
    const firstClient = mocks.clients[0]

    await vi.advanceTimersByTimeAsync(25)
    expect(firstClient?.close).toHaveBeenCalledOnce()

    await pool.listTools('local')
    expect(mocks.clients).toHaveLength(2)
  })

  it('aborts a lone pending handshake and disposal is quiescent and idempotent', async () => {
    mocks.scenarios.push({ connect: async options => await new Promise((_resolve, reject) => {
      const signal = options.signal
      if (signal === undefined) return reject(new Error('missing signal'))
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }) })
    const pool = makePool([stdio()])
    const pending = pool.listTools('local')
    await vi.waitFor(() => expect(mocks.clients[0]?.connect).toHaveBeenCalledOnce())

    const firstDispose = pool.dispose()
    const secondDispose = pool.dispose()
    expect(secondDispose).toBe(firstDispose)
    await firstDispose

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.clients[0]?.close).toHaveBeenCalled()
    await expect(pool.listTools('local')).rejects.toThrow(/pool is disposed/)
  })

  it('fails loud for duplicate, unknown, and malformed server configuration', async () => {
    expect(() => new ConnectionPool([stdio(), stdio()])).toThrow(/duplicate MCP server name/)
    expect(() => new ConnectionPool([stdio({ name: 'bad name' })])).toThrow(/must match/)
    expect(() => new ConnectionPool([{
      name: 'remote', transport: 'streamable-http', url: 'file:///tmp/socket',
    }])).toThrow(/must use http or https/)
    expect(() => new ConnectionPool([stdio()], { discoveryTimeoutMs: 0 })).toThrow(/discoveryTimeoutMs/)
    expect(() => new ConnectionPool([stdio()], { maxDiscoveryPages: 0 })).toThrow(/maxDiscoveryPages/)
    expect(() => new ConnectionPool([stdio()], { maxToolsPerServer: 1.5 })).toThrow(/maxToolsPerServer/)
    expect(() => new ConnectionPool([stdio()], { maxBytesPerTool: 0 })).toThrow(/maxBytesPerTool/)
    expect(() => new ConnectionPool([stdio()], { maxTotalCatalogBytes: Number.MAX_VALUE })).toThrow(/maxTotalCatalogBytes/)
    expect(() => new ConnectionPool([stdio()], { maxHttpResponseBytes: 0 })).toThrow(/maxHttpResponseBytes/)
    expect(() => new ConnectionPool([stdio()], { maxCursorBytes: 0 })).toThrow(/maxCursorBytes/)

    const pool = makePool([stdio()])
    await expect(pool.listTools('missing')).rejects.toThrow(/unknown MCP server/)
  })
})
