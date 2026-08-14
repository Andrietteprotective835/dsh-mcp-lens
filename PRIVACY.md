# MCP Lens Privacy Notice

Effective date: August 15, 2026

This notice covers the MCP Lens plugin, `MCP Lens Schema Audit` GitHub Action, static calculator and study pages, and project support channels. The project maintainer is the GitHub account [`labmimors`](https://github.com/labmimors). Contact routes are listed in [SUPPORT.md](SUPPORT.md).

## No maintainer-operated runtime collection

The shipped plugin, Action, and static calculator do not contain maintainer-operated telemetry, analytics beacons, advertising pixels, or call-home endpoints.

- The Action reads the workspace-relative JSON file you choose, makes no network request, and writes numeric outputs only.
- The calculator processes pasted data in the browser and has no upload endpoint.
- The plugin communicates only with model providers, MCP servers, commands, and cache paths that you configure.

The maintainers therefore do not receive your runtime prompts, schemas, credentials, tool arguments, tool results, or workflow payloads through MCP Lens itself.

## Data flows you configure

Depending on your configuration, data may be processed by your model provider, MCP servers, GitHub Actions runner, local commands, and local filesystem cache. Those systems are selected and controlled by you; their own privacy, retention, and location terms apply.

When configured with a cache path, MCP Lens stores projected catalog metadata locally with owner-only permissions (`0600`) where supported. The cache is intended to contain projected tool metadata, not explicit environment-variable, header, or URL credential values.

## Information you voluntarily send for support

If you open a GitHub Issue or Discussion, submit a private security advisory, or otherwise contact the maintainers through GitHub, the maintainers receive the account information and content you choose to provide. It is used only to operate the project, answer support requests, investigate defects or security reports, and maintain public regression evidence.

GitHub hosts and processes those communications under its own policies and may store them in countries where GitHub operates. Public Issues and Discussions may remain in repository history. Use private vulnerability reporting for confidential security information, do not submit credentials or customer data, and remove unnecessary personal information before posting.

Where GitHub's features and applicable rules allow, you may edit or delete content you submitted or ask the maintainer through the channels in [SUPPORT.md](SUPPORT.md) to minimize it. The project does not sell support-contact data or use it for advertising.

## Third-party services

Model providers, MCP servers, GitHub, and other services you connect are independent third parties. This notice does not replace their privacy terms or your responsibility to configure access, retention, and data location appropriately.
