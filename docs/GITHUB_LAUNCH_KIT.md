# GitHub Launch Kit

This file packages the repo-facing and community-facing launch copy for `dsh-mcp-lens`.

## Positioning

### One-line repo description

Progressive-disclosure MCP gateway for DeepSeek Harness: keep the model-facing surface fixed at two tools while scaling to large MCP estates.

### Short pitch

If your Harness profile has too many MCP tools, `dsh-mcp-lens` stops paying that schema cost on every turn. The model sees two stable tools, searches for the exact remote capability it needs, then calls only that tool.

### Sharp differentiation

- not another MCP server
- not a vector database
- not an OAuth layer
- not a UI plugin
- a small protocol adapter that shrinks standing tool surface and keeps the install path simple

## GitHub release title

`v0.1.0-rc.1: progressive-disclosure MCP for DeepSeek Harness`

## GitHub release body

```md
## What shipped

`dsh-mcp-lens` adds a progressive-disclosure MCP layer to DeepSeek Harness.

- `mcp_search`: search remote MCP capabilities and reveal only the selected exact schemas
- `mcp_call`: invoke one exact `server/tool`
- lazy connections, TTL-bound last-good catalog, and failure isolation
- consistent `allowTools` / `denyTools` policy on both search and direct call
- bounded discovery, bounded HTTP response bytes, and credential-aware cache persistence

## Measured result

Exact visible tool-schema surface:

- 12 remote tools: `4,862 -> 1,114 bytes` (`-77.088%`)
- 100 remote tools: `62,062 -> 1,114 bytes` (`-98.205%`)
- 1,000 remote tools: `647,962 -> 1,114 bytes` (`-99.828%`)

The metric is exact UTF-8 JSON bytes of `ctx.tools.schemas()`. It is not tokenizer tokens, provider billing, or task-quality evidence.

## Verified on

- DSH `0.1.0-rc.6`
- Node `22.19+` and `24+`

## Install

```sh
dsh plugin --profile web add dsh-mcp-lens@next
```

Or install a reviewed release tarball / Git tag if you prefer immutable pinning.

## Boundary

This plugin is not a sandbox. It reduces standing schema exposure; it does not make an untrusted MCP server safe.
```

## DeepSeek Harness discussion post

Title:

`[Plugin] dsh-mcp-lens — progressive-disclosure MCP for large Harness tool estates`

Body:

```md
Hi everyone! I built `dsh-mcp-lens`, a community plugin for DeepSeek Harness that keeps the model-facing MCP surface fixed at **two tools**, even when a profile aggregates a very large remote MCP estate.

## What it does

- `mcp_search`: searches remote capabilities and reveals only the selected exact input schemas
- `mcp_call`: invokes one exact `server/tool`
- lazy stdio / Streamable HTTP connections
- last-good catalog with TTL, invalidation, and bounded persistence
- exact allow/deny policy over the hidden `server/tool` identity

## Why

The stock MCP client is the right default for a small stable tool set. It gets expensive and noisy when one profile carries dozens or thousands of remote tools.

This plugin keeps the standing model surface constant:

- 12 remote tools: `4,862 -> 1,114 bytes`
- 100 remote tools: `62,062 -> 1,114 bytes`
- 1,000 remote tools: `647,962 -> 1,114 bytes`

Metric: exact UTF-8 JSON bytes of `ctx.tools.schemas()`. This is component evidence only, not task-quality evidence.

## Install

```sh
dsh plugin --profile web add dsh-mcp-lens@next
```

Or install from a reviewed Git tag / tarball.

## Links

- GitHub: `https://github.com/<owner>/dsh-mcp-lens`
- npm: `https://www.npmjs.com/package/dsh-mcp-lens`

Verified on DSH `0.1.0-rc.6`, Node `22.19+` and `24+`.

This is an independent community plugin, not affiliated with the official project. Feedback and issues are welcome.
```

## Social posts

### X / Twitter

```text
DeepSeek Harness has a clean MCP story for small tool sets.

But what if your profile carries 100 or 1,000 remote tools?

I built `dsh-mcp-lens`: a progressive-disclosure MCP gateway that keeps the model-facing surface fixed at 2 tools:

- mcp_search
- mcp_call

1,000 remote tools:
647,962 -> 1,114 visible schema bytes
(-99.828%)

It’s not another MCP server.
It’s a smaller control surface for the same estate.

Repo: https://github.com/<owner>/dsh-mcp-lens
Topic: #DeepSeekHarness #MCP #AIAgents #dsh
```

### LinkedIn

```text
Most agent teams are optimizing prompts while ignoring tool-surface inflation.

In DeepSeek Harness, the default MCP path is excellent for a small, stable tool set. But once a single profile aggregates dozens or hundreds of remote tools, the standing schema surface becomes an engineering problem of its own.

I built `dsh-mcp-lens` to change that tradeoff.

Instead of exposing every remote tool directly to the model, it keeps the model-facing surface fixed at two tools:

1. `mcp_search`
2. `mcp_call`

The model searches first, then receives only the exact schema it needs.

Measured visible schema surface:
- 12 remote tools: 4,862 -> 1,114 bytes
- 100 remote tools: 62,062 -> 1,114 bytes
- 1,000 remote tools: 647,962 -> 1,114 bytes

Important boundary: this is component evidence, not a claim about model quality or token billing.

What it is:
- a progressive-disclosure MCP adapter
- lazy connections + bounded discovery
- exact allow/deny policy over hidden `server/tool` identities

What it is not:
- a sandbox
- an OAuth stack
- another MCP server

Repo: https://github.com/<owner>/dsh-mcp-lens
```

### Chinese self-media post

```text
我做了一个 DeepSeek Harness 社区插件：`dsh-mcp-lens`。

它解决的不是“再多接一个工具”，而是“工具接太多以后，模型常驻工具面变得太大”这个问题。

核心思路很简单：

- 不把 100/1000 个 MCP 工具直接全暴露给模型
- 只保留两个固定工具：
  - `mcp_search`
  - `mcp_call`
- 先搜，再按需暴露精确 schema，再调用

我实测的 standing schema surface：

- 12 个远程工具：4862 -> 1114 bytes
- 100 个远程工具：62062 -> 1114 bytes
- 1000 个远程工具：647962 -> 1114 bytes

这不是“模型效果 SOTA”宣称，也不是 token 账单结论。
它证明的是：在 Harness 生态里，MCP 工具面可以做成按需披露，而不是一次性全塞给模型。

如果你也在做 DeepSeek Harness / MCP / agent engineering，这个方向值得一起打磨。

Repo:
https://github.com/<owner>/dsh-mcp-lens
```

## Launch checklist

- publish npm package
- create public GitHub repo
- add topic `dsh-plugin`
- create tagged release
- paste the benchmark table into release notes
- open a DeepSeek Harness GitHub Discussion under `Show and tell`
- do not post logs containing tokens, `.credentials.yaml`, or local `.env` values
