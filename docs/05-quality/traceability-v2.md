---
doc_id: QUAL-TRACE-V2-001
type: quality.traceability.v2
status: active
version: 1.0
owner: human
baseline: BL-003
depends_on:
  - REQ-V2-001
  - ARC-OVERALL-002
  - ARC-COMP-004
  - DEC-002
  - CR-002
affects: []
supersedes: null
last_reviewed: 2026-08-21
---

# V2 需求追踪矩阵

## 1. 使用边界

本矩阵把 REQ-V2-001 的 V2-REQ-001..016 全量映射到 ARC-COMP-004 的 UI、API、DDL 和测试契约，并分派到批准详设中的 DEV-A（`src/server.js`、`tests/**`）、DEV-B（`public/index.html`、`public/styles.css`）和 DEV-C（`public/app.js`）。BL-003 激活前，本矩阵不授权任何开发或迁移。

## 2. 全量追踪

| 需求 | ARC-COMP-004 | API / DDL | UI / DOM | 验证 | 开发包 |
| --- | --- | --- | --- | --- | --- |
| V2-REQ-001 | §1、§11、§13、§14 | `GET /api/v2/status` 与其余 `/api/v2` 端点仅本地追加；12 张新增表无 AI/认证实体 | `#v2Nav`、`#workbenchView`、`#plansView`、`#assignmentView`、`#executionView`、`#acceptanceView`、`#managementView`；无移动入口 | 静态扫描无 AI/登录/外部调用；监听范围与 V1 回归 | DEV-A / DEV-B / DEV-C |
| V2-REQ-002 | §2、§3、§6、§11、§14 | `v2_source_groups`、`v2_source_contacts`；`GET /api/v2/source-groups`、`POST /api/v2/source-groups`、`PUT /api/v2/source-groups/:id`、`GET /api/v2/source-groups/:id/contacts`、`POST /api/v2/source-groups/:id/contacts`、`PUT /api/v2/source-contacts/:id` | `#planAdvancedFields`、`#planSourceFilter`、`#planDetailPane`、`#sourceGroupAdmin`、`#resourceDialog` | `(source_group_id,normalized_name)` 去重、停用历史显示、详情与筛选浏览器测试 | DEV-A / DEV-B / DEV-C |
| V2-REQ-003 | §1、§3、§6、§11、§14 | `v2_control_plans`、`v2_test_items`；`POST /api/v2/plans`、`GET /api/v2/plans`、`GET /api/v2/plans/:id`、`PUT /api/v2/plans/:id`、`POST /api/v2/plans/:id/test-items`、`PUT /api/v2/test-items/:id` | `#plansView`、`#planDialog`、`#planList`、`#testItemList`、`#planAdvancedFields` | 最小计划成功；标签缺省不阻塞；列表、测试项与分组测试 | DEV-A / DEV-B / DEV-C |
| V2-REQ-004 | §3、§6.3、§6.4、§11、§14 | `v2_control_plans.sample_model` 必填，`sample_identifier` 与 `identifier_kind` 成对可空，`actual_arrival_date` 可空；`POST /api/v2/plans`、`PUT /api/v2/plans/:id`、`POST /api/v2/plans/:id/arrival` | `#planDialog`、`#planAdvancedFields`、`#planDetailContent` | 仅型号创建、编号后补、`IDENTIFIER_PAIR_INVALID`、未填编号仍可排期 | DEV-A / DEV-B / DEV-C |
| V2-REQ-005 | §3、§6.3.1、§6.4、§11、§14 | `v2_control_plans.current_eta_date`/`eta_pending`、`cryostat_id`/`cryostat_pending` 互斥 CHECK，`v2_test_items.is_required`；`POST /api/v2/plans` | `#planDialog`、`#planForm`、`#planAdvancedFields`、`#testItemList` | 字段边界、ETA/制冷机二选一、至少一项且至少一个 required、稳定错误 details | DEV-A / DEV-B / DEV-C |
| V2-REQ-006 | §1、§3.2、§9、§11、§12.2、§14 | `v2_plan_tasks.task_lineage_key`、V1 `tasks`/`task_assignments`；`POST /api/v2/plans/:id/tasks/preview`、`POST /api/v2/plans/:id/tasks`、`POST /api/v2/plan-tasks/:task_id/preview`、`PUT /api/v2/plan-tasks/:task_id` | `#assignmentView`、`#assignmentDialog`、`#assignmentForm`、`#assignmentTaskList`、`#openAssignmentBtn` | 无自动任务/成员；主负责人必填；每个任务新 UUID lineage；标题/描述边界 | DEV-A / DEV-B / DEV-C |
| V2-REQ-007 | §3、§6、§8、§11、§14 | `v2_control_plans.version`、`v2_plan_events`；`POST /api/v2/plans/:id/eta/preview`、`POST /api/v2/plans/:id/eta/confirm`、`POST /api/v2/plans/:id/cryostat/preview`、`POST /api/v2/plans/:id/cryostat/confirm` | `#etaChangeDialog`、`#etaChangeForm`、`#cryostatChangeDialog`、`#cryostatChangeForm`、`#planHistoryList` | token/版本失效、事务内重算、历史追加、确认输入一致、制冷机冲突 | DEV-A / DEV-B / DEV-C |
| V2-REQ-008 | §3、§8.1、§9.2、§11、§14 | `v2_plan_tasks.after_arrival`；`POST /api/v2/plans/:id/eta/preview`、`POST /api/v2/plans/:id/eta/confirm` 的 `selected_task_ids` 缺省 `[]`，只平移 eligible 的 V1 task/assignment 日期 | `#etaChangeDialog`、`#etaChangeForm` 中的候选勾选与 protected 只读结果 | 默认不平移；selected 间及与未选/其他计划的三类冲突；进行中/完成受保护；progress/note 不变 | DEV-A / DEV-B / DEV-C |
| V2-REQ-009 | §6.3、§7、§11、§14 | `GET /api/v2/plans` 的 `search`、筛选、`group_by`、active-only `stats`、分页；`v2_control_plans` 与关联资源/任务 | `#workbenchView`、`#planStats`、`#planSearchInput`、`#planStatusFilter`、`#planSourceFilter`、`#planCryostatFilter`、`#planOwnerFilter`、`#planGroupBy`、`#planOverviewList`、`#planResultCount` | `include_archived=1` 只扩展 data/total/groups；stats 永远只算 active 并应用同源筛选 | DEV-A / DEV-B / DEV-C |
| V2-REQ-010 | §6.3、§7、§11、§14 | `GET /api/v2/plans?window_days=`；`window_days=0..365`，默认 7，非持久化分类，以服务端本地日历 today 和闭区间计算 | `#arrivalWindowDays`、`#planStats`、`#planOverviewList` | 0/7/365 与边界日、跨月年、窗口变化不写业务日期 | DEV-A / DEV-B / DEV-C |
| V2-REQ-011 | §3、§6.4、§7、§11、§12.1、§14 | `initial_eta_date`、`current_eta_date`、`actual_arrival_date`；canonical response 的 `display_status`、`display_color`、`eta_drift_days`、`window_bucket` | `#planOverviewList`、`#planDetailContent`、`#planStats`；到样未测试不渲染彩色 chip | 七级优先级、drift、`display_status=null` 与窗口排除、completed/testing 覆盖 | DEV-A / DEV-B / DEV-C |
| V2-REQ-012 | §3.2、§9、§11、§14 | `v2_plan_tasks.primary_member_id`、`estimated_half_hours` 与 V1 `task_assignments`；`POST /api/v2/plans/:id/tasks/preview`、`POST /api/v2/plans/:id/tasks`、`POST /api/v2/plan-tasks/:task_id/preview`、`PUT /api/v2/plan-tasks/:task_id` | `#assignmentView`、`#assignmentDialog`、`#assignmentForm`、`#assignmentConflictSummary`、`#assignmentTaskList` | 编辑先排除自身旧日期/assignment/工时；`MEMBER_DATE_OVERLAP`、`MEMBER_LOAD_HIGH`、`CRYOSTAT_DATE_OVERLAP` | DEV-A / DEV-B / DEV-C |
| V2-REQ-013 | §3、§6.1、§10、§11、§13、§14 | `v2_deliverable_submissions`、`v2_acceptance_templates`、`v2_acceptance_template_items`；`GET /api/v2/plans/:id/submissions`、`POST /api/v2/tasks/:task_id/submissions` | `#acceptanceView`、`#submissionDialog`、`#submissionForm`、`#submissionList` | 活动模板 exact set、伪造/重复/缺失拒绝、同 lineage supersession、URL 白名单/本地路径文本 | DEV-A / DEV-B / DEV-C |
| V2-REQ-014 | §3、§6.1、§10、§11、§12.3、§14 | `v2_acceptance_reviews`、`v2_deliverable_submissions.status/version`；`POST /api/v2/submissions/:id/review`，supersession 按 `(plan_id,task_lineage_key)` | `#acceptanceView`、`#reviewDialog`、`#reviewForm`、`#submissionList`、`#submissionStatusFilter` | accepted 要求清单全 passed 并完成任务；returned 恢复执行；个人 progress/note 不变；后继限制 | DEV-A / DEV-B / DEV-C |
| V2-REQ-015 | §3.3、§4、§5、§6、§11、§13、§15 | `app_schema_versions` 与 11 张 V2 业务表；`GET /api/v2/status`、`GET /api/v2/backup`；`v2_deliverable_submissions.task_id` 可空并保留 lineage/审计快照；V1 API/CSV/JSON 不变 | `#executionView`/`#executionSubnav` 复用 V1，`#managementView`/`#managementSubnav`、`#migrationStatus` 显示迁移与备份 | 真实 V1 副本；已有库/新库/重开幂等；reset 清序列后新 lineage 不串历史；soft-delete/restore/hard-delete 回归 | DEV-A / DEV-B / DEV-C |
| V2-REQ-016 | §14、§15 | 34 个冻结 V2 端点的 schema/错误/排序/分页；12 张表和 10 个索引；全部 V1 回归 | 六个固定视图、七个 dialog、420px `#planDetailPane`、焦点/空态；1280×720 与 1366×768 | `npm test`、`node --check`、迁移/回滚回归和双尺寸浏览器验收 | DEV-A / DEV-B / DEV-C |

## 3. 交付与独立审核

| 开发包 | 独占文件 | 主要交付 | 必须验证 | 独立审核重点 |
| --- | --- | --- | --- | --- |
| DEV-A | `src/server.js`、`tests/**` | 12 表迁移、34 端点、分类器、冲突、成果/验收、V1 兼容 | Node 语法、API/迁移/回滚/V1 自动化 | DDL/API/事务/错误/lineage/reset/格式兼容 |
| DEV-B | `public/index.html`、`public/styles.css` | 六区 shell、固定 DOM、模态框/抽屉、双桌面尺寸 | DOM 契约、1280×720、1366×768、无横向溢出 | ID/可访问性/颜色/空态/桌面专用边界 |
| DEV-C | `public/app.js` | 六区状态、API 编排、预览/确认、焦点与错误保留 | Node 语法、API mock、全核心浏览器路径 | token/防重复/焦点/失败保留/无自动决定 |

三个开发包只能在 PM 完成 BL-003 权威化与激活门、生成工作包/上下文且 Release 达到 0 error / 0 warning 后启动；每包必须绑定不同于实现者的 Reviewer。任何 DDL/API/DOM/状态语义或迁移边界变化都触发停止和重新评审。

## 4. 批准与来源指纹

- TASK-025 来源审批：`APR-030`；subject SHA-256：`4a148b7a53b5b7112e71ca2c2f871654d8870267127ac2c27a40a0d700ed0dd0`。
- TASK-027 详设审批：`APR-033`；subject SHA-256：`177bb592755ffcc1dfb2d07a5e3930bd6df517f512a9c8a3692852474ef65140`。
- 四份已接受 proposal SHA-256（requirements / overall design / change / detailed design，依次）：`008b54c8ce2d03b12bb60ff96dc0637d31f30a6cfa621a1da9218e177b8dae24`、`7c4a27350621777704c5671eca66d2cf227f8177bfb966b5bca50d8310122481`、`9a737dc6d7350df0c007674b34b074dd12ffb5a3d9a7ade1a0309353a11bb465`、`867b2f24808eddf7a2936e749e93d6f6ac241e54d5ca9871ff7092bbc8cee695`。
- 详细设计 canonical body SHA-256（统一 LF）：`f683c2e0ea6211ace89f4623890232cf7160637eecc1760f7f9500d4b216924d`。
