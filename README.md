# dsh-mcp-lens

`dsh-mcp-lens` turns a large MCP estate into **two fixed model-facing tools** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):

- `mcp_search` ranks capabilities and reveals only the selected tools' exact input schemas.
- `mcp_call` invokes one exact `server/tool` capability.
- Connections are lazy; catalogs are last-good, TTL-bound, versioned, and atomically cached.
- `allowTools` and `denyTools` apply identically to search and direct calls.
- MCP content and `structuredContent` remain available to programmatic callers.

MCP Lens is for installations with many servers or long-tail tools. If you have a small stable tool set and want one-round native calls, the stock `@deepseek-ai/dsh-mcp-client` is simpler and usually better.

## Why this exists

The stock Harness MCP client exposes every configured remote tool directly to the model. That is the right default when the tool set is small. It becomes expensive and noisy when one profile aggregates dozens to thousands of remote tools.

MCP Lens keeps the standing model surface constant:

- the model always sees exactly two tools
- exact remote schemas are disclosed only on demand
- broken servers degrade locally instead of poisoning the whole tool surface
- policy remains explicit at the final `server/tool` identity

This is a progressive-disclosure adapter, not a replacement for MCP or Harness.

## Measured result

The checked-in keyless benchmark uses a real Harness `Context`, `SystemPrompt`, and `ToolRuntime`, the official `@deepseek-ai/dsh-mcp-client` baseline, and the same real stdio MCP fixture for both arms.

| Remote MCP tools | Stock visible schemas | Stock schema bytes | Lens visible schemas | Lens schema bytes | Exact byte reduction |
|---:|---:|---:|---:|---:|---:|
| 12 | 12 | 4,862 | 2 | 1,114 | 77.088% |
| 100 | 100 | 62,062 | 2 | 1,114 | 98.205% |
| 1,000 | 1,000 | 647,962 | 2 | 1,114 | 99.828% |

The exact metric is `Buffer.byteLength(JSON.stringify(ctx.tools.schemas()), 'utf8')`. These bytes are **not tokenizer tokens or provider billing**. On the frozen 12-query lexical retrieval fixture, Lens measured Recall@1/Recall@5/MRR = `1.0/1.0/1.0`; a deliberately naive exact-substring-count baseline measured `0.8333/0.9167/0.8843`. This is component evidence, not LLM task-quality evidence.

Reproduce it from a source checkout or an unpacked release tarball:

```sh
npm ci
npm run verify
npm run bench -- --output benchmark.json
```

The release tarball deliberately includes the source, fixture, publishable dependency lock, and [`benchmark/README.md`](benchmark/README.md), so these claims remain independently runnable rather than README-only.

## Install

The package in this directory is an upload candidate, not a published npm release.

Install the prebuilt candidate tarball with:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-mcp-lens-0.1.0-rc.1.tgz
dsh --profile web --dump-config
```

For source development:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-mcp-lens
```

A GitHub source install needs the package's `prepare` build to be explicitly allowed by pnpm 10+, then pinned to a reviewed commit. A future published release would install as:

```sh
dsh plugin --profile web add dsh-mcp-lens@next
```

Current DeepSeek Harness profiles manage third-party plugins through `dsh plugin`, which forwards package specs to `pnpm`. In practice this means a plugin can be installed from:

- npm package names
- a local checkout or local tarball
- a Git-hosted package spec
- a release tarball URL

For discoverability, publish the repository with the GitHub topic `dsh-plugin`.

## Configure

The bundle ships with no servers. Every stdio command is trusted host code, and every HTTP server is a trusted network capability, so the profile owner must opt in. Override the `mcp-lens` row in the profile's `cordis.patch.yml`; later patches replace the row's entire `config`, so restate every field you need:

```yaml
- id: mcp-lens
  config:
    servers:
      - name: local
        transport: stdio
        command: node
        args: ['/absolute/path/to/mcp-server.mjs']
        env:
          SERVICE_TOKEN: !!js process.env.SERVICE_TOKEN
        cacheNamespace: local-acme-readonly

      - name: knowledge
        transport: streamable-http
        url: https://mcp.example.com/rpc
        headers:
          Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
        cacheNamespace: knowledge-acme-readonly

    cachePath: !!js dshHomePath('mcp-lens/catalog.json')
    catalogTtlMs: 86400000
    idleDisconnectMs: 300000
    connectTimeoutMs: 30000
    callTimeoutMs: 60000
    discoveryTimeoutMs: 30000
    maxDiscoveryPages: 1000
    maxToolsPerServer: 10000
    maxBytesPerTool: 1048576
    maxTotalCatalogBytes: 67108864
    maxHttpResponseBytes: 16777216
    maxCursorBytes: 4096
    searchLimitDefault: 5
    searchLimitMax: 10
    allowTools: ['local/*', 'knowledge/read_*', 'knowledge/search_*']
    denyTools: ['*/delete_*', '*/destroy_*']
```

Patterns match the exact `server/tool` identity. The glob language deliberately supports only literals and `*`; deny always wins. An empty allow list allows nothing.

The shipped default is `allowTools: []`: adding a server alone exposes no remote capability. Explicitly opt in the smallest capability set you need.

`cacheNamespace` is a non-secret, stable identity for one tenant/auth scope. When a server has env, headers, URL credentials/query values, or a credential-shaped argv flag and omits this field, its catalog remains memory-only and is rediscovered after restart. Set a distinct namespace only when cross-restart caching is worth it; rotate the namespace whenever the account or capability scope changes. Never put the credential itself in this field.

## Runtime behavior

1. Activation loads only a derived catalog cache and registers `mcp_search` plus `mcp_call`. It starts no MCP process and opens no MCP socket.
2. First search refreshes missing or expired server catalogs in parallel. Concurrent refreshes for one server coalesce; an in-flight generation invalidated by `tools/list_changed` is never published. One broken server is reported without hiding results from healthy servers.
3. Search ranks name, title, nested input-schema fields, description, and server name. It normalizes camel/snake/kebab forms, simple plurals, one-edit typos, and CJK bigrams.
4. Call verifies policy and exact catalog membership, rejects MCP tools that require task execution, then forwards cancellation and timeout to the SDK.
5. `tools/list_changed` invalidates only that server's catalog. HMR/disposal closes connections, cancels work, clears timers, and waits for quiescence.

The catalog cache is a derived artifact written atomically with mode `0600`. It retains exact input schemas but drops `_meta`, output schemas, icons, and unknown metadata; annotations and task-execution metadata use narrow protocol allowlists. Explicit env/header values and URL credentials/query values are not written to it, and credential-scoped servers are not persisted unless they declare a non-secret `cacheNamespace`. Stdio children inherit Harness' scrubbed environment plus only the explicit `env` block.

## Threat model and limits

- MCP Lens is **not a sandbox**. Stdio servers run as host processes; HTTP servers receive whatever headers you configure.
- Fine-grained Lens allow/deny reduces the capability-compression risk of one generic `mcp_call`, but other Harness policies still see the outer tool name. Keep destructive patterns denied unless intentionally enabled.
- Discovery rejects a whole generation rather than publishing partial data when its overall deadline, page/tool count, per-tool/cursor bytes, aggregate catalog byte cap, or HTTP streaming-response cap is exceeded; pagination cycle detection retains only fixed-size cursor digests, and the previous last-good generation remains available and is marked stale.
- This release bridges MCP tools only. It does not implement OAuth, resources, prompts, elicitation, or task-based tool execution.
- First use trades a search round-trip and cold connection latency for a constant standing schema surface. The benchmark's cold search was roughly 183–375 ms on one local Apple Silicon run; latency is host-specific.
- The catalog and ranking operate on untrusted server metadata with discovery deadlines and count/byte caps, but accepted server descriptions and schemas still enter model context when selected and, when persistence is enabled for that server, enter the owner-only cache. Do not configure an MCP server that puts credentials in descriptions or schemas.
- DeepSeek Harness is in developer preview; its external plugin APIs may change.

## Development

```sh
npm run typecheck
npm test
npm run build
npm run bench
npm pack --dry-run
```

The implementation intentionally has no UI, OAuth stack, config migration framework, vector database, or model dependency. Its model-facing surface stays at two tools; optional product layers belong in separate plugins.

## Release surfaces

For a healthy public release, keep these surfaces aligned:

- `README.md`: positioning, install, configuration, and claim boundaries
- `benchmark/README.md`: exact measurement method and reproduction
- `package.json`: `dsh.bundle.patch` manifest and publishable file list
- `cordis.patch.yml`: the bundle entry mounted by Harness
- GitHub release notes: exact DSH/Node versions verified
- GitHub topic: `dsh-plugin`

## License

MIT
