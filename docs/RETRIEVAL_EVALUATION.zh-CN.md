# 冻结检索评测

[English](RETRIEVAL_EVALUATION.md) | 简体中文

本文为 MCP Lens `v0.1.0-rc.9` Candidate 延续冻结检索证据。唯一一次计分评测针对 rc.8 排序器；rc.9 改变的是索引构建与复用，不是排序契约。该评测**源自 MCP-Atlas，但不是 MCP-Atlas 官方分数**。它测量固定目录中的确定性 covered-call 词法检索，不是端到端任务执行评测。

## 结果

便利 Holdout 包含 304 个未触碰 Prompt，覆盖 15 个真实 MCP Server 和 102 份实际捕获的工具 Schema。candidate v3 与已发布的 rc.7 Runtime 排序器比较；该 Baseline 与评测使用的 rc.6 Runtime 排序器逐字节相同。

| 指标 | 已发布 rc.7 Baseline | candidate v3 | candidate − baseline |
|---|---:|---:|---:|
| Recall@1 | 0.020559 | 0.099507 | +0.078948 |
| Recall@5 | 0.062610 | 0.246656 | +0.184046 |
| MRR | 0.119999 | 0.258684 | +0.138685 |
| nDCG@5 | 0.051830 | 0.204307 | +0.152477 |
| Hit@5 | 0.138158 | 0.361842 | +0.223684 |

主指标 Recall@5 的逐 Prompt 胜／平／负为 `99/197/8`。使用 100,000 次重复的确定性 paired bootstrap 后，candidate-minus-baseline 差值的 95% 区间为 `[0.144846, 0.224342]`。

### rc.9 无标签兼容性重放

冻结搜索索引缓存完成后，一次只读重放把 rc.9 Candidate 集成后的 `searchCatalog()` 输出与已经冻结的 Candidate Ranking 工件进行比较。在 102 个工具上的 `304/304` 个公开 Prompt 中，Ranking 顺序与 Score 全部一致。重放先校验公开工件 Hash，在拒绝网络与文件系统写入的环境中运行，并且没有读取私有标签、Score 输出或 Score Receipt。

这只属于一致性证据：它说明 rc.9 的索引复用优化保留了冻结公开 Ranking 输出，不是第二次 Holdout 计分，也没有产生新的质量、延迟或费用结论。

## 冻结方法

目录、Prompt、排除集合、候选、Runner 与评分规则都在一次性评分前完成冻结。固定的 500 行来源中，只有成功轨迹至少包含一个冻结目录已覆盖调用的 Prompt 才会保留，最终得到 304 条。选择过程排除了先前的 15 条开发集和 38 条 Holdout A；准确文本 Hash 还排除了本仓库自建的 12 查询 Fixture，实际交集为零。

candidate v3 使用按字段加权的准确词法匹配。Fallback 被刻意限制：只有单个、长度 5–64 字符、由拉丁字母组成且词表外的查询，才允许在工具名称与标题上执行 edit-distance-1 匹配。没有合格命中时会返回空 Ranking，不会返回按字母排序的零分结果。

排序进程只能读取冻结的公开 Prompt、目录与排序器输入，不允许联网、启动子进程或读取私有标签。Ranking 在标签揭示给独立评分进程前就已冻结；评分只运行一次，并且没有持久化明文标签。

预注册的 `GO` 规则要求同时满足：

1. candidate 的宏平均 Recall@5 严格高于 Baseline；
2. Recall@5 差值 paired-bootstrap 95% 区间下界大于零；
3. candidate 的 MRR 与 nDCG@5 都不低于 Baseline；
4. 隔离、来源、目录、候选、Ranking 与 Score 的所有 Hash 都通过验证。

四项要求全部通过。较早的两版 Handoff Manifest 因 Runtime 权限／身份检查主动停止，在产生任何 Ranking 或揭示标签前就已撤销；它们都没有改变候选或输入。最终 Handoff 先绑定修正后的 Runtime 检查，之后才执行唯一一次有效 Ranking 和评分。

## 公开摘要

以下摘要让审查者可以把聚合结论绑定到冻结输入与输出，同时不公开逐任务标签或私有标识：

| 工件 | SHA-256 |
|---|---|
| MCP-Atlas Repository Revision | `f24ba3fb0bfa484c86acb28431fad6d7282455f9` |
| Hugging Face Dataset Revision | `8c563b55d7c967755f474299848049834d624617` |
| 来源 Parquet | `2d7bc052f14cbcb3b8294293481053f7111d256f9c9deaa96f3ff632d19958d0` |
| 冻结 Candidate | `2894dd35e37a1fb7a1431941780fd7b0748eea5fa452fc79190fc9ffb6a297e3` |
| 最终 Handoff | `1f5c8fe41139ff3ef8bb6a647af48149104b8bae6fd17ec35c0ba12303da54b3` |
| 冻结 Rankings | `f3c1aaa550cb8cc64af3b7dd70d80ffc26136ed4f0ed711da0b0dfada81730db` |
| Ranking Receipt | `2175e971e005fd3d48edacdf269c026afdf95c99b0ca8fc607e7891adbe4167e` |
| 聚合 Scores | `cd5b594a023d737e1aa8d07f1487976c696efa512d81b7a16604e86a9b7713ef` |
| Score Receipt | `558fb75eef75ee1d003a09fb7cac5dcdcc81d7042009a4cd9e1f9ac805d7dca8` |

上游来源：[MCP-Atlas Repository](https://github.com/scaleapi/mcp-atlas) 与 [MCP-Atlas Dataset](https://huggingface.co/datasets/ScaleAI/MCP-Atlas)。

## 结论边界

MCP-Atlas 记录一条成功轨迹，而不是完成任务的所有有效路径。本 Holdout 只评分成功轨迹中与固定 102 工具目录相交的调用。目录领域选择不是代表性抽样；统一目录排序也不同于工作流连续执行多次短搜索。

因此，这组结果只支持**该冻结构造下的 covered-call 词法检索**结论。它不能证明端到端完成率、Token 或费用节省、延迟、语义检索质量、安全性或通用提升。本仓库自建 12 查询的结果仍为 `Recall@1 / Recall@5 / MRR = 1 / 1 / 1`；它只是兼容性回归保护，不是独立证据。

返回[中文 README](../README.zh-CN.md)。
