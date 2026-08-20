---
doc_id: DEL-TASK-LEDGER-001
type: delivery.task-ledger
status: active
version: 1.0
owner: human
baseline: BL-001
depends_on:
  - DEL-WORK-001
affects:
  - PROJ-STATE-001
supersedes: null
last_reviewed: 2026-08-20
project_mode: TEAM_PROJECT
ledger_status: active
project_manager_task_id: 01a01ef6-d413-7660-bdc5-62bd5873cbf4
project_manager_host_id: 01a01ef6-d413-7660-bdc5-62bd5873cbf4
review_policy: independent-required
---

# 团队任务台账

本台账仅在项目启用 `TEAM_PROJECT` 后使用。它记录独立 Codex 任务的身份、基线、工作包、环境、状态、交付物和生命周期。

切换到团队模式时，必须把元数据 `project_mode` 改为 `TEAM_PROJECT`、`ledger_status` 改为 `active`，填写真实的项目经理任务与宿主标识，并保持 `review_policy: independent-required`。`governance.json.authoritative_documents.task_ledger` 必须指向本文件。机器校验器以这些字段和下表固定列名判断团队台账及强制审核门是否可执行。

## 项目经理

- 项目经理任务：小组任务管理与甘特图系统桌面 UX 改造
- 项目经理任务标识：01a01ef6-d413-7660-bdc5-62bd5873cbf4
- 项目经理宿主标识：01a01ef6-d413-7660-bdc5-62bd5873cbf4
- 当前阶段：EXECUTION_PLANNING
- 当前基线：BL-001

## 任务列表

| 工作包 | 独立任务标识 | 宿主标识 | 任务角色 | 任务标题 | 基线 | 环境/分支 | 依赖 | 状态 | 交付物 | 验证 | 审核任务 | 审核状态 | 审核证据 | 最近进展 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WP-007 | TASK-040 | pending | REVIEWER | Review repaired V2 desktop shell | BL-003 | pending | TASK-039 | completed | docs/05-quality/evidence/TASK-040 | required-validation | n/a | n/a | n/a | Plan 自动登记，等待调度 |
| WP-007 | TASK-039 | pending | IMPLEMENTER | Apply reviewed V2 shell focus repair | BL-003 | pending | n/a | running | public/index.html, public/styles.css | required-validation | TASK-040 | provisional-passed | docs/05-quality/evidence/TASK-040/review-round-1.json | Plan 自动登记，等待调度 |
| WP-006 | TASK-038 | pending | REVIEWER | Review repaired V2 server integration | BL-003 | pending | TASK-037 | completed | docs/05-quality/evidence/TASK-038 | required-validation | n/a | n/a | n/a | Plan 自动登记，等待调度 |
| WP-006 | TASK-037 | pending | IMPLEMENTER | Apply reviewed V2 server conflict repair | BL-003 | pending | TASK-031 | running | src/server.js, tests | required-validation | TASK-038 | provisional-passed | docs/05-quality/evidence/TASK-038/review-round-1.json | Plan 自动登记，等待调度 |
| WP-008 | TASK-036 | pending | REVIEWER | Review V2 client interactions | BL-003 | pending | TASK-035 | pending | docs/05-quality/evidence/TASK-036 | required-validation | n/a | n/a | n/a | Plan 自动登记，等待调度 |
| WP-008 | TASK-035 | pending | INTEGRATOR | Integrate V2 client interactions | BL-003 | pending | TASK-031, TASK-033 | pending | public/app.js | required-validation | TASK-036 | pending | pending | Plan 自动登记，等待调度 |
| WP-007 | TASK-034 | pending | REVIEWER | Review V2 six-zone desktop shell | BL-003 | pending | TASK-033 | completed | docs/05-quality/evidence/TASK-034 | required-validation | n/a | n/a | n/a | Plan 自动登记，等待调度 |
| WP-007 | TASK-033 | pending | IMPLEMENTER | Implement V2 six-zone desktop shell | BL-003 | pending | n/a | needs-attention | public/index.html, public/styles.css | required-validation | TASK-034 | changes-required | docs/05-quality/evidence/TASK-034/review-round-1.json | Plan 自动登记，等待调度 |
| WP-006 | TASK-032 | pending | REVIEWER | Review V2 server migration and APIs | BL-003 | pending | TASK-031 | completed | docs/05-quality/evidence/TASK-032 | required-validation | n/a | n/a | n/a | Plan 自动登记，等待调度 |
| WP-006 | TASK-031 | pending | IMPLEMENTER | Implement V2 server migration and APIs | BL-003 | pending | n/a | running | src/server.js, tests | required-validation | TASK-032 | changes-required | docs/05-quality/evidence/TASK-032/review-round-1.json | Plan 自动登记，等待调度 |
| WP-002 | TASK-030 | pending | REVIEWER | Review formal V2 authority documents | BL-002 | pending | TASK-029 | completed | docs/05-quality/evidence/TASK-030 | required-validation | n/a | n/a | n/a | Plan 自动登记，等待调度 |
| WP-002 | TASK-029 | pending | ARCHITECT | Formalize approved V2 design documents | BL-002 | pending | TASK-025, TASK-027 | completed | docs/02-product/requirements-v2.md, docs/03-architecture/overall-design-v2.md, docs/03-architecture/components/v2-detailed-design.md, docs/07-decisions/DEC-002.md, docs/08-changes/CR-002.md, docs/05-quality/traceability-v2.md, docs/00-index/DOC-REGISTRY.md | required-validation | TASK-030 | passed | docs/05-quality/evidence/TASK-030/review-round-4.json | Plan 自动登记，等待调度 |
| WP-002 | TASK-028 | pending | REVIEWER | Review V2 detailed design and development plan | BL-002 | pending | TASK-027 | completed | docs/05-quality/evidence/TASK-028 | required-validation | n/a | n/a | n/a | Plan 自动登记，等待调度 |
| WP-002 | TASK-027 | pending | ARCHITECT | Create V2 detailed design and development plan | BL-002 | pending | TASK-025 | completed | docs/09-reports/V2-detailed-design.proposal, docs/09-reports/V2-development-plan.proposal | required-validation | TASK-028 | passed | docs/05-quality/evidence/TASK-028/review-round-4.json | Plan 自动登记，等待调度 |
| WP-002 | TASK-026 | pending | REVIEWER | Review V2 requirements and overall design proposal | BL-002 | pending | TASK-025 | completed | docs/05-quality/evidence/TASK-026 | required-validation | n/a | n/a | n/a | Plan 自动登记，等待调度 |
| WP-002 | TASK-025 | pending | ARCHITECT | Prepare V2 requirements and overall design proposal | BL-002 | pending | n/a | completed | docs/09-reports/V2-requirements.proposal, docs/09-reports/V2-overall-design.proposal, docs/09-reports/V2-change.proposal | required-validation | TASK-026 | passed | docs/05-quality/evidence/TASK-026/review-round-3.json | Plan 自动登记，等待调度 |
| WP-001 | TASK-024 | pending | REVIEWER | Review V2 requirements and overall design | BL-002 | pending | TASK-023 | replaced | docs/05-quality/evidence/TASK-024 | required-validation | n/a | n/a | n/a | Plan 自动登记，等待调度 |
| WP-001 | TASK-023 | pending | ARCHITECT | Draft V2 requirements and overall design | BL-002 | pending | n/a | replaced | docs/02-product/requirements-v2.md, docs/03-architecture/overall-design-v2.md, docs/08-changes/CR-002.md, docs/00-index/DOC-REGISTRY.md, docs/00-index/CURRENT-STATE.md, governance.json | required-validation | TASK-024 | pending | pending | Plan 自动登记，等待调度 |
| WP-005 | TASK-022 | pending | REVIEWER | Review integrated sample data and tests | BL-002 | pending | TASK-021 | completed | docs/05-quality/evidence/TASK-022 | required-validation | n/a | n/a | n/a | Plan 自动登记，等待调度 |
| WP-005 | TASK-021 | pending | TESTER | Sequentially validate integrated sample data and tests | BL-002 | pending | TASK-009 | completed | src/server.js, tests | required-validation | TASK-022 | passed | docs/05-quality/evidence/TASK-022/review-round-2.json | Plan 自动登记，等待调度 |
| WP-004 | TASK-020 | pending | REVIEWER | Review integrated client interactions | BL-002 | pending | TASK-019 | completed | docs/05-quality/evidence/TASK-020 | required-validation | n/a | n/a | n/a | Plan 自动登记，等待调度 |
| WP-004 | TASK-019 | pending | IMPLEMENTER | Sequentially validate integrated client interactions | BL-002 | pending | TASK-009 | completed | public/app.js | required-validation | TASK-020 | passed | docs/05-quality/evidence/TASK-020/review-round-2.json | Plan 自动登记，等待调度 |
| WP-003 | TASK-018 | pending | REVIEWER | Review integrated desktop shell | BL-002 | pending | TASK-017 | completed | docs/05-quality/evidence/TASK-018 | required-validation | n/a | n/a | n/a | Plan 自动登记，等待调度 |
| WP-003 | TASK-017 | pending | IMPLEMENTER | Sequentially validate integrated desktop shell | BL-002 | pending | TASK-009 | completed | public/index.html, public/styles.css | required-validation | TASK-018 | passed | docs/05-quality/evidence/TASK-018/review-round-2.json | Plan 自动登记，等待调度 |
| WP-005 | TASK-016 | pending | REVIEWER | Review dynamic sample data and regression tests | BL-002 | pending | TASK-015 | replaced | docs/05-quality/evidence/TASK-016 | required-validation | n/a | n/a | n/a | Plan 自动登记，等待调度 |
| WP-005 | TASK-015 | pending | TESTER | Implement dynamic sample data and regression tests | BL-002 | pending | TASK-009 | replaced | src/server.js, tests | required-validation | TASK-016 | pending | pending | Plan 自动登记，等待调度 |
| WP-004 | TASK-014 | pending | REVIEWER | Review client task interactions | BL-002 | pending | TASK-013 | replaced | docs/05-quality/evidence/TASK-014 | required-validation | n/a | n/a | n/a | Plan 自动登记，等待调度 |
| WP-004 | TASK-013 | pending | IMPLEMENTER | Implement client task interactions | BL-002 | pending | TASK-009 | replaced | public/app.js | required-validation | TASK-014 | pending | pending | Plan 自动登记，等待调度 |
| WP-003 | TASK-012 | pending | REVIEWER | Review desktop page shell and styles | BL-002 | pending | TASK-011 | replaced | docs/05-quality/evidence/TASK-012 | required-validation | n/a | n/a | n/a | Plan 自动登记，等待调度 |
| WP-003 | TASK-011 | pending | IMPLEMENTER | Implement desktop page shell and styles | BL-002 | pending | TASK-009 | replaced | public/index.html, public/styles.css | required-validation | TASK-012 | pending | pending | Plan 自动登记，等待调度 |
| WP-002 | TASK-010 | pending | REVIEWER | Review registered desktop UX implementation brief | BL-002 | pending | TASK-009 | completed | docs/05-quality/evidence/TASK-010 | required-validation | n/a | n/a | n/a | Plan 自动登记，等待调度 |
| WP-002 | TASK-009 | pending | ARCHITECT | Finalize registered desktop UX implementation brief | BL-002 | pending | n/a | replaced | docs/09-reports/WP-002-implementation-brief.md, docs/00-index/DOC-REGISTRY.md | required-validation | TASK-010 | cancelled | docs/05-quality/evidence/TASK-010/review-cancelled-20260820T184234378Z.json | Plan 自动登记，等待调度 |
| WP-005 | TASK-008 | pending | REVIEWER | Review dynamic sample data and regression tests | BL-002 | pending | TASK-007 | replaced | docs/05-quality/evidence/TASK-008 | required-validation | n/a | n/a | n/a | Plan 自动登记，等待调度 |
| WP-005 | TASK-007 | pending | TESTER | Implement dynamic sample data and regression tests | BL-002 | pending | TASK-001 | replaced | src/server.js, tests | required-validation | TASK-008 | pending | pending | Plan 自动登记，等待调度 |
| WP-004 | TASK-006 | pending | REVIEWER | Review client task interactions | BL-002 | pending | TASK-005 | replaced | docs/05-quality/evidence/TASK-006 | required-validation | n/a | n/a | n/a | Plan 自动登记，等待调度 |
| WP-004 | TASK-005 | pending | IMPLEMENTER | Implement client task interactions | BL-002 | pending | TASK-001 | replaced | public/app.js | required-validation | TASK-006 | pending | pending | Plan 自动登记，等待调度 |
| WP-003 | TASK-004 | pending | REVIEWER | Review desktop page shell and styles | BL-002 | pending | TASK-003 | replaced | docs/05-quality/evidence/TASK-004 | required-validation | n/a | n/a | n/a | Plan 自动登记，等待调度 |
| WP-003 | TASK-003 | pending | IMPLEMENTER | Implement desktop page shell and styles | BL-002 | pending | TASK-001 | replaced | public/index.html, public/styles.css | required-validation | TASK-004 | pending | pending | Plan 自动登记，等待调度 |
| WP-002 | TASK-002 | pending | REVIEWER | Review desktop UX implementation brief | BL-002 | pending | TASK-001 | replaced | docs/05-quality/evidence/TASK-002 | required-validation | n/a | n/a | n/a | Plan 自动登记，等待调度 |
| WP-002 | TASK-001 | pending | ARCHITECT | Prepare desktop UX implementation brief | BL-002 | pending | n/a | replaced | docs/09-reports/WP-002-implementation-brief.md | required-validation | TASK-002 | pending | pending | Plan 自动登记，等待调度 |

允许的任务状态：

```text
pending
running
needs-attention
completed
replaced
archived
```

## 任务登记要求

每个任务至少记录：

- `thread_id` 和宿主标识；
- 工作包编号、任务角色和任务标题；
- 使用的项目基线；
- 环境、分支或 worktree；
- 上游依赖及满足状态；
- 最近一次有意义的进展；
- 实际交付物、验证命令和结果；
- 对非 `REVIEWER` 任务指定独立审核任务、审核状态和审核证据；
- 未解决问题、风险和后续建议；
- 替换、复用或归档原因。

任务台账是项目经理的协调记录，不替代设计、代码、测试和实际交付物。

任务角色只允许 `ANALYST`、`ARCHITECT`、`IMPLEMENTER`、`TESTER`、`INTEGRATOR` 和 `REVIEWER`。非 `REVIEWER` 任务在开始前必须绑定另一个同工作包的 `REVIEWER` 任务；审核任务必须依赖被审核任务。审核通过的证据必须位于审核任务自己的 `docs/05-quality/evidence/TASK-NNN/` 目录。`REVIEWER` 行的审核任务、审核状态和审核证据统一填写 `n/a`，避免产生无限递归审核。

任务契约中的 `read_paths` 用于声明可读取范围，`write_paths` 用于声明可修改范围，`review.required` 只记录不可变审核要求；审核任务标识、状态和证据属于运行状态与本台账。`Plan` 自动创建本表任务行，`AssignReview` 自动写入审核任务标识，AI 不得要求用户预先手工造行。审核状态允许 `pending`、`running`、`changes-required`、`provisional-passed`、`passed` 和 `cancelled`。审核任务的 `allowed_paths` 和 `write_paths` 只能位于自己的审核证据目录。推荐流程为：`Lite：Plan -> AssignReview -> Start -> Verify -> RecordReview -> passed -> Accept`；`Standard/Release：Plan -> AssignReview -> Start -> Verify -> 第一轮 RecordReview -> provisional-passed -> ReopenReview -> Start reviewer -> Verify reviewer -> 第二轮 RecordReview -> passed -> Accept`。任一所需轮次 `changes-required` 时执行 `修复 -> Verify -> ReopenReview`，连续通过计数按档位重新开始；一次审核中的多个证据文件仍只算一轮。`RecordReview` 必须写入符合 `schemas/review-evidence.schema.json` 的一个或多个审核证据，其中 `diff_checked=true`、`changes` 和 `change_summary` 用于证明审核确实检查了新增/修改内容；清单必须匹配任务启动提交后的实际 Git 变更及变更类型，重命名还需记录 `old_path`，且工作包、基线必须与 TASK 契约一致。只有自动化测试 pass、没有实际变更清单时不得通过。审核任务由 `RecordReview` 完成并保持 `verified`，不得记录 acceptance approval 或单独执行 `Accept`；工作包聚合时该状态按审核已完成处理。历史 `accepted` 审核任务使用 `MigrateReviewer` 规范化并重新执行 Strict。取消审核时应先用 `Supersede` 将运行时状态置为 `superseded`，由工具映射为台账 `replaced`；`archived` 只用于之后的历史台账整理。

本台账和 `.governance/runtime` 只允许由项目经理的唯一协调工作树写入。表中的环境/worktree 字段用于定位成员交付来源，不表示成员 worktree 可以独立维护治理状态；项目经理应先集成成员提交，再在协调工作树执行 Verify、审核登记和验收。
