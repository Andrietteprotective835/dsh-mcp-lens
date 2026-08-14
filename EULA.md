## MCP Lens End User License Agreement

Effective date: August 14, 2026

This End User License Agreement ("EULA") governs use of the MCP Lens software, release artifacts, and GitHub Action published from this repository.

### 1. License grant

Subject to this EULA and the repository license terms, you are granted a non-exclusive, non-transferable, revocable license to use, copy, and run MCP Lens for your internal or external workflows.

### 2. Open-source license

MCP Lens source code is also distributed under the MIT License in [`LICENSE`](LICENSE). If any term in this EULA conflicts with the MIT License for code you received under that license, the MIT License controls for that code.

### 3. Operator responsibility

You are responsible for:

- reviewing the code, release notes, and configuration before use,
- deciding which MCP servers, credentials, headers, commands, and tools are trusted,
- complying with laws, policies, contracts, and internal review requirements that apply to your environment,
- validating benchmarks, budgets, and operational claims against your own workload.

### 4. No hosted service

MCP Lens is distributed as software artifacts only. The maintainers do not provide a managed hosted service, uptime commitment, or data-processing service agreement through this repository.

### 5. External systems and data flow

Depending on how you configure it, MCP Lens may:

- launch local stdio MCP servers,
- connect to remote Streamable HTTP MCP servers,
- send selected tool descriptions or schemas into model context,
- transmit tool-call arguments to your configured MCP endpoints and model providers.

You control those integrations and remain responsible for the data you route through them.

### 6. No warranty

MCP Lens is provided "as is" and "as available," without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement, to the maximum extent permitted by law.

### 7. Limitation of liability

To the maximum extent permitted by law, the maintainers and contributors will not be liable for indirect, incidental, special, consequential, or exemplary damages arising from use of MCP Lens. If liability cannot be excluded, it is limited to the amount you paid for the specific artifact giving rise to the claim; for free artifacts, that amount is zero.

### 8. Termination

Your rights under this EULA terminate automatically if you materially violate it. Upon termination, you must stop using MCP Lens and remove copies under your control, except where an applicable open-source license separately permits continued use.

### 9. Support

Support is provided on a best-effort basis through the channels listed in [`SUPPORT.md`](SUPPORT.md). Security issues must follow [`SECURITY.md`](SECURITY.md).
