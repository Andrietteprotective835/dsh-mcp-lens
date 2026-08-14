# Security Policy

## Supported versions

Security fixes target the latest `0.1.x` release candidate and the current `main` branch. DeepSeek Harness itself is in developer preview, so compatibility and threat assumptions may change between upstream releases.

## Scope and trust model

MCP Lens can launch trusted stdio MCP servers and connect to trusted Streamable HTTP MCP servers. It reduces standing schema exposure; it is **not a sandbox**.

- Stdio servers execute as host processes.
- HTTP servers receive the headers you configure.
- Selected remote descriptions and schemas enter model context.
- Allowed remote tools can still act with all authority granted to their server.

Treat every configured MCP endpoint, command, argument and working directory as trusted infrastructure.

Security reports are especially relevant for:

- credential disclosure or persistence,
- bypass of `allowTools` or `denyTools`,
- unintended model-visible disclosure of `_meta`, resources or signed URLs,
- shell-seam or process-launch issues in stdio transport,
- unexpected network behavior in HTTP transport,
- cache poisoning or stale cross-tenant catalog reuse,
- bypass of discovery, pagination, catalog, cursor or response-size limits.

MCP Lens does not claim to prevent malicious behavior by an explicitly trusted server, data exfiltration by an allowed tool, prompt injection inside accepted tool metadata, or model misuse of a capability the operator intentionally allowed.

## Reporting a vulnerability

Do **not** open a public issue for an unpatched vulnerability. Use [GitHub private vulnerability reporting](https://github.com/labmimors/dsh-mcp-lens/security/advisories/new).

Include:

1. affected release or full commit SHA,
2. DeepSeek Harness, Node.js, OS and architecture versions,
3. minimal reproduction steps,
4. expected and actual behavior,
5. impact assessment,
6. proof-of-concept artifacts that can be shared safely.

Never attach real tokens, cookies, device codes, `.env` values, `.npmrc`, private profile state, signed URLs or production catalog data. Redact secrets before sharing logs.

## Response targets

- Initial triage: three business days.
- Reproduction and impact confirmation: seven business days.
- Public disclosure: after a fix or explicit maintainer coordination.

These are response targets, not a guarantee of resolution within a fixed period.
