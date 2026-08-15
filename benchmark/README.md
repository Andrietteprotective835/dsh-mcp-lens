# Keyless component benchmark

This benchmark compares the model-visible tool-schema surface of the stock
`@deepseek-ai/dsh-mcp-client` with `dsh-mcp-lens`. Both arms use a real
DeepSeek Harness `Context`, `SystemPrompt`, and `ToolRuntime`, and connect to
the same local MCP stdio fixture with 12, 100, and 1,000 advertised tools.

Run it from the package root:

```sh
npm run bench
npm run bench -- --output ../../artifacts/mcp-lens-benchmark.json
```

The report records:

- exact visible schema count;
- exact UTF-8 byte length of `JSON.stringify(ctx.tools.schemas())`;
- plugin activation wall time;
- Lens cold search latency and selected search-result JSON bytes;
- seven warm `mcp_call` latency samples, median, and p95;
- Recall@1, Recall@5, and MRR on a checked-in deterministic retrieval corpus.

It also records the candidate package version, resolved versions of all
DeepSeek benchmark packages plus `@modelcontextprotocol/sdk` and
`@deepseek-ai/schemastery`, and a reproducible candidate source digest. The
digest covers these path-sorted files:

```text
benchmark/run.ts
cordis.patch.yml
npm-shrinkwrap.json
package.json
src/catalog.ts
src/index.ts
src/policy.ts
src/pool.ts
tests/fixture-server.ts
tsconfig.json
tsdown.config.ts
```

Each file entry contains its raw-byte SHA-256. The aggregate digest is the
SHA-256 of UTF-8 manifest lines in lexical path order, exactly
`<relative-path>\t<raw-file-sha256>\n`. The JSON artifact carries the complete
manifest, including byte sizes and per-file hashes, so the aggregate can be
independently reconstructed. The runner computes the version and digest before
measurement and again afterward; source drift fails the run instead of writing
an artifact that binds results to the wrong tree.

The retrieval comparison is intentionally modest. The baseline awards one
point for each query token that appears as an exact substring anywhere in the
serialized tool metadata, with no stemming, field weights, phrase boost, or
inverse-document frequency. It is named `naive-all-token-substring` in the
JSON artifact so it cannot be mistaken for the stock MCP client's behavior;
the stock client exposes tools but does not provide search ranking.

This is a keyless component benchmark. Schema JSON bytes are not tokenizer
tokens or provider billing, local wall time is host-specific, and retrieval on
this corpus is not evidence of model task quality. Every Context and MCP child
process is disposed between arms and sizes.

Activation and cold-search latency are each one fixed-order observation per
arm and tool count. The arms are not counterbalanced, so these numbers must not
be used to claim a performance advantage. They are descriptive smoke
measurements only; process startup, JIT, filesystem cache, and host load remain
uncontrolled. The seven warm-call samples do not repair that experimental
limitation.

## Search-index cache benchmark

`search-cache.ts` isolates the rc.9 immutable-snapshot search-index cache with
a fixed, keyless 10,000-tool synthetic catalog and one fixed query. It measures
12 first searches against fresh snapshot identities (`cold`) and 60 searches
after one unmeasured priming search on the same identity (`warm`):

```sh
npx tsx benchmark/search-cache.ts \
  --output ../../artifacts/packages/mcp-lens-search-cache-rc9-candidate.json
```

The versioned JSON records Node and machine characteristics, Git commit and
repository-wide dirty state, a path-sorted source digest, catalog tool count/UTF-8 bytes/digest,
the fixed query, iteration counts, raw samples, median, and nearest-rank p95.
Every measured result must byte-match an uncached caller-owned snapshot result;
any semantic mismatch or source drift fails the run before a report is written.
An existing output path is never replaced.

Catalog construction is outside the timer. `cold` means a fresh immutable
snapshot identity, not a cold process, filesystem, or CPU. The runner has no
time-based pass threshold: these are host-specific component timings, not a
universal speedup, provider-cost, or model-quality claim.
