# 文档治理规则

## 必填元数据

每个具有约束效力的文档都必须以如下元数据开头：

```yaml
---
doc_id: ARC-OVERALL-001
type: architecture.overall
status: active
version: 1.0
owner: human
baseline: BL-001
depends_on: []
affects: []
supersedes: null
last_reviewed: 2026-08-13
---
```

`status` 允许的值为：`draft`、`proposed`、`active`、`superseded`、`retired`、`archived`。

`baseline` 表示当前文档内容最后被批准、首次引入或发生实质变更时所属的基线，用于追踪内容来源；它不是项目当前基线的动态副本。文档内容未变化时，可以被后续基线继续复用，不得仅因 `governance.json.current_baseline` 改变而重写文档的 `baseline`、版本或复审日期。

某份文档是否属于当前基线，以及当前基线采用它的哪个版本和哈希，以 `baselines/<基线编号>/manifest.json` 的成员记录为准。文档 frontmatter、`DOC-REGISTRY.md` 与基线清单中的版本和哈希互相矛盾时，必须进入 `needs-decision`，不得通过批量改写 frontmatter 掩盖差异。

基线清单中的 `documents` 只包含受控内容：章程、需求、架构、契约、工作包、质量标准和决策。`docs/04-delivery/context/WP-NNN.context.json` 是工作包的上下文路由；与目标基线一致的路由记录在 `context_routes` 并参与哈希校验。活动工作包必须有当前基线路由；已经 `accepted` 或 `superseded` 的历史工作包可以保留旧路由且不进入新基线。路由只引用权威文档，不能复制或改写权威要求。`docs/00-index/`、`WORK-STATUS.md`、`TASK-LEDGER.md`、`traceability.md`、`docs/08-changes/` 和 `docs/09-reports/` 属于运行状态或流程记录，记录在 `operational_documents` 中，不参与基线内容哈希。运行状态可以随执行过程更新，不因此自动产生新基线；受控内容或活动工作包的上下文路由发生变化时需要新基线。

## 权威来源表

项目必须为每类事实保留唯一权威位置：

| 事实 | 权威文档 |
| --- | --- |
| 项目目的和成功标准 | `docs/01-governance/charter.md` |
| 当前项目状态 | `docs/00-index/CURRENT-STATE.md` |
| 当前有效文档 | `docs/00-index/DOC-REGISTRY.md` |
| 当前框架版本和机器状态 | `governance.json` |
| 有效基线及其清单 | `docs/00-index/BASELINE-REGISTRY.md`、`baselines/` |
| 人类批准记录 | `docs/00-index/APPROVAL-LOG.md` |
| 人类决策 | `docs/07-decisions/DEC-*.md` |
| 变更影响和传播 | `docs/08-changes/CR-*.md` |
| 总体架构 | `docs/03-architecture/overall-design.md` |
| 领域/组件详设 | `docs/03-architecture/domains/`、`components/` |
| 工作包契约 | `docs/04-delivery/WORK-PACKAGES.md` |
| 工作包运行状态 | `docs/04-delivery/WORK-STATUS.md` |
| 验证结果 | `docs/05-quality/traceability.md`、`evidence/` |

## 维护规则

1. 事实发生变化时，更新权威文档，不要只更新重复摘要。
2. 修改规范性文档时，必须在同一个变更包中更新 `CURRENT-STATE.md` 和 `DOC-REGISTRY.md`。
3. 通过版本和状态保留历史，不要删除被替代的决策或设计。
4. 对规范性文档的引用应包含 `doc_id` 或稳定路径。
5. 相关变更发生后尚未复审的文档属于 `stale`，不能作为执行基线。
6. Markdown 用于解释与审阅，`governance.json` 用于机器校验；两者冲突时必须进入 `needs-decision`，不得自行选择。
7. `governance.json` 必须是符合 `schemas/governance.schema.json` 的有效 JSON，不得并列维护另一个机器权威状态文件。
8. 激活新基线时，只更新发生实质变化的文档元数据；复用文档通过新基线的 `manifest.json` 建立成员关系。
