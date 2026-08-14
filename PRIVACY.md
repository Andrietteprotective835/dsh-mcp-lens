# Privacy Notice

Effective date: August 14, 2026

This notice explains the data-handling boundaries for MCP Lens artifacts published from this repository.

## What is covered

- the DeepSeek Harness plugin in this repository,
- the `MCP Lens Schema Audit` GitHub Action,
- the static calculator and study pages published from this repository.

## Data the maintainers do not collect directly

The shipped plugin, GitHub Action, and static calculator do not include built-in telemetry, analytics beacons, ad pixels, or maintainer-operated call-home endpoints.

## Data flow you control

MCP Lens can process data that you choose to route through it:

- MCP server names, tool names, descriptions, and input schemas discovered from configured servers,
- tool-call arguments and tool results,
- model prompts and model-visible tool context assembled by your Harness profile,
- HTTP headers or local command invocations that you configure for your own servers.

That data may be sent to:

- your configured model provider,
- your configured MCP servers,
- your local filesystem cache, if caching is enabled.

## Local storage

When configured with a cache path, MCP Lens stores projected catalog metadata locally with owner-only permissions (`0600`) where supported. The cache is intended to contain projected tool metadata, not raw secret values. Operators remain responsible for host security, backups, and disk access control.

## GitHub Action boundaries

`MCP Lens Schema Audit` runs inside GitHub Actions on a JSON payload you provide from your repository or workflow workspace.

- It performs no network requests.
- It writes numeric outputs only.
- It does not intentionally copy tool names, descriptions, or schemas into the GitHub Step Summary.

Workflow logs, retention, and access are governed by your GitHub repository settings and GitHub's policies.

## Static site boundaries

The published calculator is designed for local-only measurement in the browser. Your pasted tool payload stays in the browser session unless you separately choose to share exported artifacts or links.

## Third-party services

If you connect MCP Lens to third-party model providers, MCP servers, GitHub, or other services, their privacy terms and retention policies apply independently.

## Security reporting

Do not send secrets or live credentials in public issues. For vulnerabilities, use the process in [`SECURITY.md`](SECURITY.md).

## Contact

For product support or privacy questions about this repository, use the channels listed in [`SUPPORT.md`](SUPPORT.md).
