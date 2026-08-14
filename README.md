<p align="center">
  <img src="assets/mcp-lens-hero.webp" alt="Many MCP tool schemas converge through a lens into two model-facing interfaces" width="100%">
</p>

# MCP Lens for DeepSeek Harness

English | [简体中文](README.zh-CN.md)

[![verify](https://github.com/labmimors/dsh-mcp-lens/actions/workflows/verify.yml/badge.svg)](https://github.com/labmimors/dsh-mcp-lens/actions/workflows/verify.yml)
[![release](https://img.shields.io/github/v/release/labmimors/dsh-mcp-lens?include_prereleases)](https://github.com/labmimors/dsh-mcp-lens/releases)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-developer%20preview-5B5BD6)](https://github.com/deepseek-ai/deepseek-harness)

**1,000 MCP tools. Two model-facing schemas.**

MCP Lens is a progressive-disclosure MCP gateway for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It searches a private tool catalog, reveals only the selected tools' exact input schemas, and invokes one exact capability—without registering every remote tool up front.

> In the reproducible 1,000-tool component benchmark, Harness-visible tool-schema JSON fell from **647,962 B to 1,114 B (99.828%)**. This measures serialized schema bytes, not tokenizer tokens, provider billing, or LLM task quality.

The model always sees two stable interfaces:

- `mcp_search` finds relevant capabilities and reveals their exact `inputSchema`.
- `mcp_call` invokes one exact `server/tool` with the selected arguments.

Connections are lazy, one failed server does not hide healthy results, and the same fail-closed allow/deny policy governs search and direct calls.

MCP Lens is built for multi-server or long-tail MCP catalogs. For a small, stable set of hot-path tools, the stock `@deepseek-ai/dsh-mcp-client` is simpler and usually better.

> MCP Lens is an independent community plugin. It is not affiliated with or endorsed by DeepSeek AI.

## From intent to one exact tool

```text
User intent
   ↓
mcp_search("find open pull requests by author")
   ↓
github/list_pull_requests + exact input schema
   ↓
mcp_call("github", "list_pull_requests", arguments)
```

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

Prerequisites: DeepSeek Harness `0.1.0-rc.6` and Node.js `^22.19.0` or `>=24.0.0`. Harness is currently in developer preview.

### Recommended: prebuilt GitHub Release

```sh
dsh plugin --profile web add https://github.com/labmimors/dsh-mcp-lens/releases/download/v0.1.0-rc.2/dsh-mcp-lens-0.1.0-rc.2.tgz
dsh --profile web --dump-config
```

The attached tarball is prebuilt, so pnpm does not need permission to run a dependency build script.

### Source install pinned to a reviewed tag

```sh
dsh plugin --profile web add github:labmimors/dsh-mcp-lens#v0.1.0-rc.2
```

Git installs fetch source and run the package's `prepare` build. pnpm 10+ blocks that script until you explicitly add the exact package key to the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-mcp-lens: true
```

Then rerun the pinned install. Treat `allowBuilds` as permission to execute package code on the host; review the source and pin a tag or commit SHA first.

For local development:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-mcp-lens
```

As of August 14, 2026, the official DeepSeek Harness docs point to public GitHub repositories carrying the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic for discovery and to GitHub, tarball, or npm package installation. No separate marketplace upload form was found in the current official docs. See the official [plugin publishing guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md).

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

## Choosing the right MCP adapter

| Option | Best fit | Main trade-off |
|---|---|---|
| Official `@deepseek-ai/dsh-mcp-client` | A small, stable hot-path tool set | Registers one model-facing schema per remote tool |
| MCP Lens | Large, multi-server, or long-tail catalogs | First use normally adds a search step |
| [`dsh-mcp-proxy`](https://github.com/ben7am1n/dsh-mcp-proxy) | A similarly small lazy search/call proxy | Lens additionally emphasizes exact-schema retrieval evaluation, consistent capability policy, and explicit resource bounds |
| [`dsh-mcp-adapter`](https://github.com/NexusAgentX/dsh-mcp-adapter) | Web UI, OAuth, and direct-tool promotion | Broader product surface and more moving parts |

This comparison is based on the projects' current public documentation. MCP Lens does not claim to be the first or only search/call adapter.

## Development and reproducibility

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run bench
npm audit --omit=dev
npm pack --dry-run --json --ignore-scripts
```

The release package intentionally includes source, tests, fixture, benchmark runner, dependency lock, and source maps. That adds package size, but lets an unpacked release reproduce the published component evidence without relying on this README.

The implementation intentionally has no UI, OAuth stack, config migration framework, vector database, or model dependency. Optional product layers belong in separate plugins.

## Security and contributing

- Read [`SECURITY.md`](SECURITY.md) before reporting a vulnerability; do not disclose an unpatched exploit in a public issue.
- See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development and pull-request expectations.
- Search-quality contributions are especially useful: submit a small, sanitized failing query/tool fixture rather than credentials or a private catalog.

The public launch copy and claim boundaries are recorded in [`PROMOTION.md`](PROMOTION.md). The growth loop is deliberately evidence-led: clone → rerun the benchmark → report a search miss → turn it into a regression case.

## Community status

- GitHub: [labmimors/dsh-mcp-lens](https://github.com/labmimors/dsh-mcp-lens)
- Release: [`v0.1.0-rc.2`](https://github.com/labmimors/dsh-mcp-lens/releases/tag/v0.1.0-rc.2)
- Issues: [bug reports and search misses](https://github.com/labmimors/dsh-mcp-lens/issues)
- DeepSeek Harness: developer preview; plugin APIs may change

## License

MIT
