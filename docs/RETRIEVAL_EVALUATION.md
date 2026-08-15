# Frozen retrieval evaluation

English | [简体中文](RETRIEVAL_EVALUATION.zh-CN.md)

This report carries the frozen retrieval evidence forward for the MCP Lens `v0.1.0-rc.9` candidate. The one scored evaluation was run for the rc.8 ranker; rc.9 changes index construction and reuse, not the ranking contract. The evaluation is **derived from MCP-Atlas but is not an official MCP-Atlas score**. It measures deterministic covered-call lexical retrieval in one fixed catalog, not end-to-end task execution.

## Result

The convenience holdout contains 304 untouched prompts over 15 real MCP servers and 102 captured tool schemas. Candidate v3 was compared with the released rc.7 runtime ranker; that baseline is byte-identical to the rc.6 runtime ranker used by the evaluator.

| Metric | Released rc.7 baseline | Candidate v3 | Candidate − baseline |
|---|---:|---:|---:|
| Recall@1 | 0.020559 | 0.099507 | +0.078948 |
| Recall@5 | 0.062610 | 0.246656 | +0.184046 |
| MRR | 0.119999 | 0.258684 | +0.138685 |
| nDCG@5 | 0.051830 | 0.204307 | +0.152477 |
| Hit@5 | 0.138158 | 0.361842 | +0.223684 |

For the primary Recall@5 metric, prompt-level wins/ties/losses were `99/197/8`. A deterministic paired bootstrap with 100,000 replicates produced a 95% interval of `[0.144846, 0.224342]` for the candidate-minus-baseline difference.

### rc.9 label-free compatibility replay

After the frozen search-index cache was implemented, a read-only replay compared the rc.9 candidate's integrated `searchCatalog()` output with the already-frozen candidate ranking artifact. All `304/304` public prompts over 102 tools matched in ranking order and score. The replay verified public artifact hashes, ran with network and filesystem writes denied, and read no private labels, score output, or score receipt.

This is parity evidence only. It shows that the rc.9 index-reuse optimization preserved the frozen public ranking output; it is not a second holdout scoring run and does not add a new quality, latency, or cost result.

## Frozen method

The catalog, prompts, exclusions, candidate, runner, and scoring rule were fixed before the single scoring run. The 304 prompts were retained from the pinned 500-row source only when their successful trajectory contained at least one call covered by the frozen catalog. Selection excluded the earlier 15-prompt development set and 38-prompt holdout A. Exact-text hashes also excluded the repository-authored 12-query fixture; the measured intersection was zero.

Candidate v3 uses field-weighted exact lexical matching. Its fallback is intentionally narrow: only one 5–64-character Latin out-of-vocabulary query may use edit-distance-1 matching, and only against tool names and titles. A query with no eligible match returns an empty ranking instead of alphabetical zero-score results.

The ranking lane could read only the frozen public prompts, catalog, and ranker inputs, with no network, child-process, or private-label access. Rankings were frozen before labels were revealed to a separate scorer. Scoring ran once and did not persist plaintext labels.

The preregistered `GO` rule required all of the following:

1. candidate macro Recall@5 strictly above baseline;
2. the paired-bootstrap 95% lower bound for the Recall@5 difference above zero;
3. candidate MRR and nDCG@5 no lower than baseline; and
4. every isolation, provenance, catalog, candidate, ranking, and score hash passing.

All four requirements passed. Two earlier handoff manifests were revoked before any ranking output or label reveal after runtime permission/identity checks stopped them. Neither changed the candidate or inputs; the final handoff bound the corrected runtime checks before the one valid ranking and scoring run.

## Public commitments

These digests let reviewers bind aggregate claims to the frozen inputs and outputs without publishing task-level labels or private identifiers:

| Artifact | SHA-256 |
|---|---|
| MCP-Atlas repository revision | `f24ba3fb0bfa484c86acb28431fad6d7282455f9` |
| Hugging Face dataset revision | `8c563b55d7c967755f474299848049834d624617` |
| Source Parquet | `2d7bc052f14cbcb3b8294293481053f7111d256f9c9deaa96f3ff632d19958d0` |
| Frozen candidate | `2894dd35e37a1fb7a1431941780fd7b0748eea5fa452fc79190fc9ffb6a297e3` |
| Final handoff | `1f5c8fe41139ff3ef8bb6a647af48149104b8bae6fd17ec35c0ba12303da54b3` |
| Frozen rankings | `f3c1aaa550cb8cc64af3b7dd70d80ffc26136ed4f0ed711da0b0dfada81730db` |
| Ranking receipt | `2175e971e005fd3d48edacdf269c026afdf95c99b0ca8fc607e7891adbe4167e` |
| Aggregate scores | `cd5b594a023d737e1aa8d07f1487976c696efa512d81b7a16604e86a9b7713ef` |
| Score receipt | `558fb75eef75ee1d003a09fb7cac5dcdcc81d7042009a4cd9e1f9ac805d7dca8` |

Upstream sources: [MCP-Atlas repository](https://github.com/scaleapi/mcp-atlas) and [MCP-Atlas dataset](https://huggingface.co/datasets/ScaleAI/MCP-Atlas).

## Claim boundary

MCP-Atlas records one successful trajectory, not every valid way to solve a task. This holdout scores only successful-trajectory calls that intersect the fixed 102-tool catalog. Catalog-domain selection is not representative sampling, and a unified-catalog ranking differs from a workflow performing several short searches.

Therefore this result supports only a claim about **covered-call lexical retrieval under this frozen construction**. It does not establish end-to-end completion rate, token or dollar savings, latency, semantic retrieval quality, safety, or universal improvement. The repository-authored 12-query result remains `Recall@1 / Recall@5 / MRR = 1 / 1 / 1`; it is a compatibility regression guard, not independent evidence.

Return to the [README](../README.md).
