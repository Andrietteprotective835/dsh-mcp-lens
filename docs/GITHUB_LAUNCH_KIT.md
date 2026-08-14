# GitHub launch kit

The complete platform-specific launch copy, first-hour response plan and evidence boundaries live in [`../PROMOTION.md`](../PROMOTION.md).

## Repository surfaces

- Repository: https://github.com/labmimors/dsh-mcp-lens
- Release: https://github.com/labmimors/dsh-mcp-lens/releases/tag/v0.1.0-rc.2
- Benchmark method: [`../benchmark/README.md`](../benchmark/README.md)
- Security policy: [`../SECURITY.md`](../SECURITY.md)
- Contribution guide: [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
- Required discoverability topic: [`dsh-plugin`](https://github.com/topics/dsh-plugin)

## Release title

`MCP Lens v0.1.0-rc.2: 1,000 MCP tools, two model-facing schemas`

## Release body

```md
MCP Lens is a progressive-disclosure MCP gateway for DeepSeek Harness.

- `mcp_search` finds capabilities and reveals exact selected schemas.
- `mcp_call` invokes one exact `server/tool`.
- Connections are lazy; catalogs are last-good and server failures stay isolated.
- Search and direct calls share a default-deny allow/deny policy.
- Discovery, pagination, tools, catalogs, cursors and HTTP responses have explicit bounds.

| Remote tools | Official client schema JSON | MCP Lens | Reduction |
|---:|---:|---:|---:|
| 12 | 4,862 B | 1,114 B | 77.088% |
| 100 | 62,062 B | 1,114 B | 98.205% |
| 1,000 | 647,962 B | 1,114 B | 99.828% |

Metric: UTF-8 bytes of Harness-visible serialized tool schemas. This is not tokenizer-token, billing-cost or LLM task-quality evidence.

Verified for this release: DSH `0.1.0-rc.6`, Node `22.19+` / `24+`, 58 tests, real stdio and Streamable HTTP fixtures, fresh tarball install and production dependency audit.

Install the attached prebuilt tarball or use the pinned Git source command from the README.

MCP Lens is an independent community plugin, not a sandbox and not an official DeepSeek component.
```
