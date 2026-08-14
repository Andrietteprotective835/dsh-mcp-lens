# Security Policy

## Supported surface

This repository currently supports the latest published `0.1.x` release line and the current `main` branch.

## Security posture

`dsh-mcp-lens` reduces standing MCP schema exposure, but it is **not** a sandbox.

- stdio MCP servers still run as local host processes
- HTTP MCP servers still receive the headers you configure
- selected remote schemas still enter model context
- operator mistakes in `allowTools` can still expose the wrong capability

Treat every configured MCP endpoint as trusted infrastructure.

## What this project tries to prevent

- persisting configured secrets into the derived on-disk catalog
- unbounded `tools/list` growth from one server
- oversized Streamable HTTP responses
- accidental capability exposure from "install and forget" defaults
- stale catalog reuse across auth scopes without an explicit `cacheNamespace`

## What this project does not try to prevent

- malicious behavior by a trusted MCP server
- data exfiltration by an allowed remote tool
- model misuse of a capability that the operator explicitly allowed
- provider-side prompt injection contained inside remote tool descriptions or schemas

## Reporting

Please do not open a public issue for a suspected secret leak or exploit chain.

Open a private GitHub security advisory if available for the repository. If private advisory flow is not available, contact the maintainer through a non-public channel first and include:

- affected version
- DSH version
- Node version
- reproduction steps
- whether a real credential was involved

When sharing logs, remove tokens, cookies, device codes, `~/.dsh/.credentials.yaml`, and any local `.env` values.
