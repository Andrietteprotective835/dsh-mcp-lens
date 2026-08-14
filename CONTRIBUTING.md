# Contributing to MCP Lens

Thanks for helping make large MCP catalogs easier to operate and audit.

## Before you start

- Use Node.js `^22.19.0` or `>=24.0.0`.
- Never commit credentials, private MCP catalogs, `.env*`, `.npmrc`, DSH profile state, or production logs.
- For a security vulnerability, follow [`SECURITY.md`](SECURITY.md) instead of opening a public exploit report.
- Keep the model-facing contract at exactly `mcp_search` and `mcp_call` unless a proposal includes new benchmark evidence and a migration plan.

## Local checks

```sh
npm ci
npm run verify
npm run bench -- --output benchmark.json
npm audit --omit=dev
npm pack --dry-run --json --ignore-scripts
```

`npm run verify` must pass type checking, all tests, and the production build. The benchmark is component evidence; do not turn schema bytes or lexical retrieval scores into token, cost, or LLM task-quality claims.

## High-value contributions

- A sanitized search query and minimal tool metadata that reproduce a ranking miss.
- Lifecycle regressions involving refresh, invalidation, cancellation, or disposal.
- Protocol fixtures for stdio or Streamable HTTP edge cases.
- Resource-boundary tests for discovery, pagination, catalogs, cursors, or responses.
- Documentation improvements verified against the current DeepSeek Harness developer preview.

Remove credentials, tenant names, signed URLs, private hostnames, and business data before sharing a fixture.

## Pull requests

Keep each pull request focused. Explain the user-visible problem, describe the smallest solution, list exact verification commands, and state what was not tested. Update both language READMEs when changing metrics, installation, configuration, or security behavior.

By contributing, you agree that your contribution is licensed under the repository's MIT License.
