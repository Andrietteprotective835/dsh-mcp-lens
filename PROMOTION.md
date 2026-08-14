# MCP Lens launch pack

This copy is ready to adapt for the public launch. Keep every metric attached to its measurement boundary.

## Positioning

Primary hook:

> **1,000 MCP tools. Two model-facing schemas.**

Supporting line:

> Search the catalog. Reveal one exact schema. Call the tool.

Exact evidence statement:

> In the reproducible 1,000-tool component benchmark, Harness-visible tool-schema JSON fell from 647,962 B to 1,114 B, a 99.828% reduction. These are serialized schema bytes, not tokenizer tokens, provider billing, or LLM task-quality evidence.

GitHub description:

> Progressive-disclosure MCP gateway for DeepSeek Harness: search and call large MCP catalogs through two fixed model-facing schemas.

Recommended GitHub topics:

`deepseek` `deepseek-harness` `dsh-plugin` `mcp` `mcp-gateway` `model-context-protocol` `progressive-disclosure` `tool-discovery` `tool-routing` `context-engineering` `ai-agents` `typescript`

## Claim boundary

Supported claims:

- Lens adds exactly two model-facing schemas regardless of the configured remote catalog size.
- Exact schema-byte results from the checked-in Harness serialization benchmark.
- Recall@1, Recall@5 and MRR from the frozen 12-query lexical fixture.
- Lazy connections, default-deny capability policy, last-good catalogs, server isolation and explicit resource limits.
- The release verification results recorded in the GitHub release.

Do not claim:

- 99.828% fewer tokens, lower API bills or smaller provider context windows.
- Higher LLM accuracy, task success, productivity or user satisfaction.
- SOTA, first, unique, production-ready or official DeepSeek endorsement.
- A sandbox, zero latency, zero overhead or support for every MCP capability.
- Cross-platform or remote-production validation beyond recorded evidence.
- Guaranteed virality.

## GitHub release headline

> **MCP Lens v0.1.0-rc.2: 1,000 MCP tools, two model-facing schemas**

Repository: https://github.com/labmimors/dsh-mcp-lens

Release: https://github.com/labmimors/dsh-mcp-lens/releases/tag/v0.1.0-rc.2

## X / Twitter

### Single post

```text
1,000 MCP tools shouldn't require 1,000 model-visible schemas.

MCP Lens gives DeepSeek Harness 2 fixed tools: search, then call.

Reproducible Harness benchmark: schema JSON fell from 647,962 to 1,114 bytes (-99.828%).

Code + benchmark: https://github.com/labmimors/dsh-mcp-lens
```

### Thread

```text
1/ 1,000 MCP tools shouldn't require 1,000 model-visible schemas.

I built MCP Lens for DeepSeek Harness: the model always sees two fixed tools—search, then call.

At 1,000 tools, schema JSON fell from 647,962 to 1,114 bytes (-99.828%).
```

```text
2/ The direct MCP client is simple and usually best for a small, stable tool set. With many servers and long-tail tools, however, the standing model-visible schema surface grows with the whole catalog.
```

```text
3/ MCP Lens keeps the interface constant:

• mcp_search finds relevant capabilities and reveals exact selected input schemas
• mcp_call invokes one exact server/tool

Connections stay lazy; one unhealthy server does not hide healthy results.
```

```text
4/ Benchmark method: real Harness Context, SystemPrompt and ToolRuntime, with the official dsh-mcp-client as baseline.

Metric: UTF-8 bytes of JSON.stringify(ctx.tools.schemas()).

12 tools: -77.088%
100 tools: -98.205%
1,000 tools: -99.828%
```

```text
5/ Important boundary: these are serialized schema bytes—not tokens, provider billing or LLM task quality.

The repository contains the source, fixture, lock and benchmark runner so you can challenge the result.
```

```text
6/ Security defaults matter because mcp_call compresses many capabilities behind one name.

MCP Lens ships with allowTools: []. Deny wins. Search and direct calls use the same policy. Credential-scoped catalogs remain memory-only unless explicitly namespaced.
```

```text
7/ Trade-off: first use normally adds a search step and cold connection. If you only have a few stable tools, use the official client.

Clone it, rerun the benchmark, and report a real search miss:
https://github.com/labmimors/dsh-mcp-lens
```

## LinkedIn

```text
Most MCP setups expose every tool schema up front.

That is simple—until the catalog gets large.

I’m open-sourcing MCP Lens, a progressive-disclosure MCP gateway for DeepSeek Harness. No matter how many remote MCP tools are configured, the model sees two fixed interfaces:

→ mcp_search: find capabilities and reveal exact selected schemas
→ mcp_call: invoke one exact server/tool

Measured with a real Harness Context, SystemPrompt and ToolRuntime:

12 tools: 4,862 → 1,114 schema JSON bytes
100 tools: 62,062 → 1,114
1,000 tools: 647,962 → 1,114

That last result is a 99.828% reduction in this exact schema-surface metric. It is not a token, billing or model-quality claim. The benchmark, fixtures and dependency lock are included so anyone can reproduce it.

The implementation also ships default-deny capability policy, lazy stdio and Streamable HTTP connections, last-good catalogs, failure isolation and explicit discovery/response limits.

For a few stable tools, the official client remains simpler. For a large or long-tail catalog, I’d like you to break my assumptions:

https://github.com/labmimors/dsh-mcp-lens

What is the largest MCP tool catalog you are operating today?

#DeepSeek #ModelContextProtocol #OpenSource
```

## Show HN

Title:

```text
Show HN: MCP Lens – Two fixed tools for large MCP catalogs in DeepSeek Harness
```

Body:

```text
Hi HN,

I made MCP Lens because the direct MCP approach registers one model-facing schema per remote tool. That is the simplest design for a small set, but the standing schema surface grows with large or long-tail catalogs.

MCP Lens is a DeepSeek Harness plugin exposing two tools:

- mcp_search searches a private catalog and returns selected exact input schemas
- mcp_call invokes one exact server/tool

In the checked-in benchmark, using a real Harness Context, SystemPrompt and ToolRuntime and the official dsh-mcp-client as baseline:

- 12 tools: 4,862 → 1,114 JSON bytes
- 100 tools: 62,062 → 1,114
- 1,000 tools: 647,962 → 1,114

The metric is UTF-8 bytes of JSON.stringify(ctx.tools.schemas()). It is not token, billing or LLM task-success evidence.

The package includes 58 tests, real stdio and Streamable HTTP fixtures, default-deny policy, bounded discovery, lazy connections and last-good catalog caching. First use adds a search step; for a few stable tools, the official client is simpler.

Source and reproduction: https://github.com/labmimors/dsh-mcp-lens

I would especially value feedback on catalog/cache failure modes, real-world ranking misses and whether the two-tool boundary composes with your agent policy.
```

## DeepSeek Harness GitHub Discussion

Title:

```text
Show and tell: dsh-mcp-lens – progressive-disclosure MCP with two fixed tools
```

Body:

```md
I’m sharing an independent community plugin for DeepSeek Harness:

**dsh-mcp-lens** keeps the model-facing MCP surface at `mcp_search` and `mcp_call`, regardless of remote catalog size.

Repository: https://github.com/labmimors/dsh-mcp-lens

The official direct client remains simpler for a small stable tool set. Lens is intended for larger long-tail catalogs, where it discovers capabilities before revealing exact schemas.

| Remote tools | Official client schema JSON | Lens schema JSON |
|---:|---:|---:|
| 12 | 4,862 B | 1,114 B |
| 100 | 62,062 B | 1,114 B |
| 1,000 | 647,962 B | 1,114 B |

Metric: UTF-8 bytes of `JSON.stringify(ctx.tools.schemas())`. This is not a token, billing or task-quality claim.

Safety/lifecycle: `allowTools: []` by default; the same search/call policy; lazy stdio and Streamable HTTP; bounded discovery and responses; last-good catalogs; credential-scoped catalogs stay memory-only unless explicitly namespaced.

Feedback requested: two-tool integration boundaries, real ranking misses, `tools/list_changed` lifecycle behavior and future Harness API changes.
```

## DeepSeek Discord

```text
I’ve released an independent Harness community plugin: dsh-mcp-lens.

It keeps large MCP catalogs behind two model-facing tools: mcp_search and mcp_call.

Reproducible Harness schema-surface benchmark:
12 tools: 4,862 → 1,114 JSON bytes
100 tools: 62,062 → 1,114
1,000 tools: 647,962 → 1,114 (-99.828%)

These are serialized schema bytes—not tokens, billing or task-success claims.

Repo: https://github.com/labmimors/dsh-mcp-lens

I’m looking for real catalog search misses and lifecycle/security review.
```

## 中文短帖

```text
为了调用一个工具，Agent 不该先加载一千份 MCP Schema。

我开源了 MCP Lens：一个给 DeepSeek Harness 用的渐进披露 MCP 网关。

模型始终只看到两个入口：
1. mcp_search：找到当前任务需要的工具，并返回准确 Schema
2. mcp_call：调用指定的 server/tool

可复现 Harness 基准：
12 个工具：4,862 → 1,114 bytes
100 个工具：62,062 → 1,114 bytes
1,000 个工具：647,962 → 1,114 bytes（下降 99.828%）

这是 Schema JSON bytes，不是 Token、账单或模型质量数据。源码、测试、Fixture 和 Benchmark Runner 全部公开。

工具少且固定时，官方 Client 更简单；工具目录很大时，欢迎复测并提交真实 Search Miss。

https://github.com/labmimors/dsh-mcp-lens
```

## First-hour operating plan

1. Pin one reply defining the benchmark metric and limits.
2. Answer technical questions with code, tests or a clear admission of an unknown.
3. Turn real installation failures and search misses into public issues.
4. Do not ask for votes, coordinate artificial engagement, or imply official endorsement.
5. Invite reproducible artifacts: tool count, sanitized fixture, environment and benchmark output.

The intended growth loop is:

> Clone → rerun benchmark → publish artifact → report search miss → become contributor.

## Visual guidance

Use `assets/mcp-lens-hero.webp` as the common visual. It was generated without text, numbers, logos, testimonials or official marks. Keep exact numbers and product text in HTML/SVG/Markdown overlays rather than asking an image model to render them.
