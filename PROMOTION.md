# Promotion Pack

## GitHub repo description

Constant two-tool MCP gateway for DeepSeek Harness: search exact capabilities, reveal exact schemas on demand, and keep model-facing context flat.

## GitHub About tags

`deepseek` `deepseek-harness` `dsh` `dsh-plugin` `mcp` `model-context-protocol` `ai-agents`

## Launch post: English

### Short version

Shipping `dsh-mcp-lens`: a DeepSeek Harness plugin that keeps the model-facing MCP surface fixed at 2 tools, even when the profile has hundreds of remote tools.

- `mcp_search` finds the right capability
- `mcp_call` executes the exact `server/tool`
- lazy connections, fail-closed policy, bounded discovery, reproducible benchmark

Measured schema-surface reduction on the same Harness serialization path:

- 12 tools: 4,862 → 1,114 bytes
- 100 tools: 62,062 → 1,114 bytes
- 1,000 tools: 647,962 → 1,114 bytes

This is component evidence, not a blanket model-quality claim.

Repo: `https://github.com/labmimors/dsh-mcp-lens`

### DeepSeek Discussions / release note version

`dsh-mcp-lens` is a progressive-disclosure MCP gateway for DeepSeek Harness.

Instead of registering every remote MCP capability directly into the model-visible tool registry, it keeps a private bounded catalog and exposes only two fixed tools:

1. `mcp_search`
2. `mcp_call`

Why this matters:

- constant standing schema surface,
- better fit for long-tail MCP profiles,
- fail-closed `allowTools` / `denyTools`,
- lazy stdio and Streamable HTTP connections,
- reproducible benchmark and release tarball.

Measured on the same real Harness `Context`/`ToolRuntime` path and the same stdio fixture for both arms, schema JSON bytes dropped by 77.088% at 12 tools and 99.828% at 1,000 tools.

Boundaries:

- bytes are not tokenizer billing,
- retrieval fixture is not a user-quality or causal benchmark,
- this plugin does not add OAuth/resources/prompts/task execution.

## Launch post: 中文

### 短版

发布 `dsh-mcp-lens`：一个给 DeepSeek Harness 用的 MCP 渐进披露插件。

它不会把 100 个、1000 个 MCP 工具一次性全暴露给模型，而是始终只给模型两个入口：

- `mcp_search`
- `mcp_call`

这样做的好处是：

- 常驻工具面恒定
- 更适合长尾 MCP 工具集
- allow/deny 策略 fail-closed
- 连接懒建立，坏 server 不拖垮全部结果

同一条 Harness schema 序列化路径下，工具面从：

- 12 tools: `4862 → 1114 bytes`
- 100 tools: `62062 → 1114 bytes`
- 1000 tools: `647962 → 1114 bytes`

这是组件级证据，不是“模型效果全面提升”的泛化宣传。

仓库：`https://github.com/labmimors/dsh-mcp-lens`

## X / Twitter thread

1. Most MCP integrations for agents fail the same way: too many tools get exposed all at once.

2. I built `dsh-mcp-lens` for DeepSeek Harness to keep the model-facing MCP surface fixed at 2 tools:
   - `mcp_search`
   - `mcp_call`

3. The model searches first, sees only the exact selected schema, then calls the exact `server/tool`.

4. Same Harness serialization path, exact schema JSON bytes:
   - 12 tools: 4862 → 1114
   - 100 tools: 62062 → 1114
   - 1000 tools: 647962 → 1114

5. It also ships with:
   - lazy stdio / Streamable HTTP connections
   - fail-closed allow/deny policy
   - bounded discovery
   - reproducible tarball benchmark

6. Important boundary: this is component evidence, not “all model tasks got better”.

7. If your DSH profile has a long tail of MCP tools, this is the plugin to try.

Repo: `https://github.com/labmimors/dsh-mcp-lens`

## LinkedIn post

Agent tool surfaces are quietly becoming a scaling bottleneck.

Once a DeepSeek Harness profile starts carrying dozens or hundreds of MCP tools, the problem is no longer “can the model call tools?” The problem becomes “how much tool surface do we keep permanently visible, and how much should stay private until the task actually needs it?”

I built `dsh-mcp-lens` to push that boundary in a simple way:

- keep the model-facing MCP surface fixed at 2 tools,
- search the private capability catalog first,
- reveal only the exact selected `inputSchema`,
- then execute the exact `server/tool`.

On the same Harness serialization path, visible schema JSON bytes dropped from 647,962 to 1,114 at 1,000 remote tools.

This is not a blanket model-quality claim. It is a focused, reproducible component result for long-tail MCP profiles.

If you are building DeepSeek Harness setups with many tools, this is the pattern I would test first.

Repo: `https://github.com/labmimors/dsh-mcp-lens`

## Short-video hook

“Your agent does not need to see 1,000 tools all the time. It needs to find the right one at the right moment.”
