<p align="center">
  <img src="assets/mcp-lens-hero.webp" alt="大量 MCP 工具 Schema 经过透镜收敛为两个模型入口" width="100%">
</p>

# DeepSeek Harness 的 MCP Lens

[English](README.md) | 简体中文

[![verify](https://github.com/labmimors/dsh-mcp-lens/actions/workflows/verify.yml/badge.svg)](https://github.com/labmimors/dsh-mcp-lens/actions/workflows/verify.yml)
[![release](https://img.shields.io/github/v/release/labmimors/dsh-mcp-lens?include_prereleases)](https://github.com/labmimors/dsh-mcp-lens/releases)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**1,000 个 MCP 工具，模型只看两个 Schema。**

MCP Lens 是面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的渐进披露 MCP 网关。它先搜索私有工具目录，只揭露命中工具的准确输入 Schema，再调用一个明确的能力，而不是预先注册全部远端工具。

> 在可复现的 1,000 工具组件基准中，Harness 可见的工具 Schema JSON 从 **647,962 B 降至 1,114 B（99.828%）**。这里测量的是序列化 Schema 字节，不是模型 Token、API 账单或 LLM 任务质量。

模型始终只看到两个稳定入口：

- `mcp_search`：搜索相关能力，并返回命中工具的准确 `inputSchema`。
- `mcp_call`：使用指定参数调用一个准确的 `server/tool`。

连接按需建立；单个异常 Server 不会遮蔽健康结果；搜索和直接调用遵守同一套默认拒绝 allow/deny 策略。

MCP Lens 适合多服务器或长尾 MCP 目录。如果只有少量稳定的高频工具，官方 `@deepseek-ai/dsh-mcp-client` 更简单，通常也更合适。

> MCP Lens 是独立社区插件，与 DeepSeek AI 无隶属关系，也不代表其官方背书。

## 从意图到一个准确工具

```text
用户意图
   ↓
mcp_search("查找某位作者的开放 Pull Request")
   ↓
github/list_pull_requests + 准确 inputSchema
   ↓
mcp_call("github", "list_pull_requests", arguments)
```

## 安装

前置要求：DeepSeek Harness `0.1.0-rc.6`，Node.js `^22.19.0` 或 `>=24.0.0`。Harness 当前仍处于开发者预览阶段。

推荐安装预编译 GitHub Release：

```sh
dsh plugin --profile web add https://github.com/labmimors/dsh-mcp-lens/releases/download/v0.1.0-rc.2/dsh-mcp-lens-0.1.0-rc.2.tgz
dsh --profile web --dump-config
```

该 tarball 已预编译，因此 pnpm 无需获准执行依赖构建脚本。

也可以安装固定到已审核 Tag 的源码：

```sh
dsh plugin --profile web add github:labmimors/dsh-mcp-lens#v0.1.0-rc.2
```

Git 安装会运行 `prepare` 构建。pnpm 10+ 默认阻止该脚本，直到你在该 Profile 的 `pnpm-workspace.yaml` 中明确加入：

```yaml
allowBuilds:
  dsh-mcp-lens: true
```

然后重新运行固定版本的安装命令。`allowBuilds` 等同于允许依赖在宿主机执行代码；请先审查源码，并固定 Tag 或 Commit SHA。

截至 2026 年 8 月 14 日，DeepSeek Harness 官方文档指向带有 [`dsh-plugin`](https://github.com/topics/dsh-plugin) Topic 的公开 GitHub 仓库作为发现入口，并提供 GitHub、tarball 或 npm 包安装流程；在当前官方文档中没有找到单独的插件市场上传表单。详见官方[插件发布教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.zh.md)。

## 配置

插件默认不携带服务器，并且 `allowTools: []` 会拒绝全部远端能力。请在 Profile 的 `cordis.patch.yml` 覆盖 `mcp-lens` 行并明确授权：

```yaml
- id: mcp-lens
  config:
    servers:
      - name: local
        transport: stdio
        command: node
        args: ['/absolute/path/to/mcp-server.mjs']

      - name: knowledge
        transport: streamable-http
        url: https://mcp.example.com/rpc
        headers:
          Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
        cacheNamespace: knowledge-acme-readonly

    cachePath: !!js dshHomePath('mcp-lens/catalog.json')
    allowTools: ['local/*', 'knowledge/read_*', 'knowledge/search_*']
    denyTools: ['*/delete_*', '*/destroy_*']
```

模式匹配的是准确 `server/tool` 身份，仅支持字面量和 `*`；deny 永远优先。后续 Patch 会替换该行的整个 `config`，需要的字段必须在覆盖层中重新写出。完整限制与默认值见英文 README 的[配置参考](README.md#configure)。

`cacheNamespace` 是某个租户／权限范围的非秘密稳定标识。带凭据的 Server 如果没有它，目录只保存在内存中，并在重启后重新发现。切换账户或权限范围时应轮换该值；绝不能把真实凭据写入其中。

## 可复现结果

内置无密钥基准使用真实 Harness `Context`、`SystemPrompt` 和 `ToolRuntime`，以官方 `@deepseek-ai/dsh-mcp-client` 为基线，两侧使用相同的真实 stdio MCP Fixture。

| 远端 MCP 工具 | 官方可见 Schema | 官方 Schema 字节 | Lens 可见 Schema | Lens Schema 字节 | 准确降幅 |
|---:|---:|---:|---:|---:|---:|
| 12 | 12 | 4,862 | 2 | 1,114 | 77.088% |
| 100 | 100 | 62,062 | 2 | 1,114 | 98.205% |
| 1,000 | 1,000 | 647,962 | 2 | 1,114 | 99.828% |

准确指标是 `Buffer.byteLength(JSON.stringify(ctx.tools.schemas()), 'utf8')`。这些字节不是 Token 或计费数据。在固定 12 查询词法检索 Fixture 上，Lens 的 Recall@1 / Recall@5 / MRR 为 `1.0 / 1.0 / 1.0`；文档中的朴素精确子串基线为 `0.8333 / 0.9167 / 0.8843`。这只是组件证据，不代表 LLM 任务质量。

```sh
npm ci
npm run verify
npm run bench -- --output benchmark.json
```

Release 包刻意包含源码、测试、Fixture、依赖锁和 Benchmark Runner，让数据可以从解包后的发布物独立复现。

## 安全边界

- MCP Lens **不是沙箱**。stdio Server 仍会作为宿主进程运行，HTTP Server 仍会收到你配置的 Header。
- 搜索和直接调用都受相同的 `allowTools` / `denyTools` 约束，默认不开放任何远端工具。
- 发现流程对整体时限、分页、工具数、单工具字节、游标字节、目录总字节与 HTTP 响应体设置上限；失败时保留上一份 last-good 目录。
- 目录缓存以 `0600` 原子写入，只保留窄化后的元数据；带凭据的 Server 默认不持久化目录。
- 当前版本只桥接 MCP Tools，不支持 OAuth、Resources、Prompts、Elicitation 或基于 Task 的工具执行。
- 首次使用通常多一次搜索和冷连接；少量稳定工具应优先使用官方 Client。

安全问题请阅读 [`SECURITY.md`](SECURITY.md)，不要在公开 Issue 中披露未修复漏洞。

## 参与贡献

```sh
npm ci
npm run verify
npm run bench
npm audit --omit=dev
npm pack --dry-run --json --ignore-scripts
```

请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)。我们尤其欢迎脱敏后的真实搜索失败用例：提交最小查询和工具 Fixture，让它成为公开回归测试。

## 社区状态

- GitHub：[labmimors/dsh-mcp-lens](https://github.com/labmimors/dsh-mcp-lens)
- Release：[`v0.1.0-rc.2`](https://github.com/labmimors/dsh-mcp-lens/releases/tag/v0.1.0-rc.2)
- Issue：[Bug、安装问题和搜索 Miss](https://github.com/labmimors/dsh-mcp-lens/issues)
- 许可证：MIT
