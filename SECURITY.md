# Security Policy

## Scope

This repository contains a DeepSeek Harness plugin that can launch trusted stdio MCP servers and connect to trusted Streamable HTTP MCP servers. It is not a sandbox.

Security reports are especially relevant for:

- credential disclosure or persistence,
- policy bypass around `allowTools` / `denyTools`,
- unintended model-visible disclosure of `_meta`, resources, or signed URLs,
- command injection or shell-seam issues in stdio transport,
- SSRF or unsafe network behavior in HTTP transport,
- cache poisoning, stale cross-tenant reuse, or unsafe persistence.

## Reporting

Please do **not** open a public issue for an unpatched vulnerability.

Instead, send a private report with:

1. affected version or commit SHA,
2. reproduction steps,
3. expected vs actual behavior,
4. impact assessment,
5. any proof-of-concept artifacts that can be shared safely.

If a private security channel is not yet configured on the public repository, open a minimal issue asking for a private contact path without disclosing exploit details.

## Response target

- Initial triage target: within 3 business days
- Reproduction / impact confirmation target: within 7 business days
- Public disclosure only after a fix or explicit maintainer coordination
