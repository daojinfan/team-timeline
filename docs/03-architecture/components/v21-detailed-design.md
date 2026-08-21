---
doc_id: ARC-COMP-005
type: architecture.component.v21-detailed-design
status: active
version: 1.0
owner: human
baseline: BL-004
depends_on:
  - REQ-V21-001
  - ARC-OVERALL-003
  - DEC-003
affects:
  - CR-003
supersedes: null
last_reviewed: 2026-08-21
---

# V2.1 详细设计

## 1. 数据模型

新增 13 张 `v3_*` 表和 14 个索引，不 ALTER V1/V2 业务表。核心表为 `v3_topics`、`v3_samples`、`v3_topic_tasks`、`v3_task_samples`、`v3_task_members`、`v3_task_dependencies`、`v3_submissions`、`v3_submission_samples`、`v3_reviews`、`v3_events`、`v3_legacy_refs` 及验收模板/条目表。

稳定业务身份使用 `topic_key`、`sample_key`、`task_lineage_key`。数字 `task_id` 仅作为与 V1 `tasks` 的可选关联；任务被 reset 或 hard delete 后 lineage、样品关系、成果快照和事件保留，数字 ID 复用不得继承历史。

`v3_task_samples` 保证任务和样品属于同一专题；`v3_task_members` 保证成员集合唯一、至少一人、可选一名协调负责人和每人 `planned_half_hours`。任务总工时为成员工时求和。任务制冷机字段允许设备或 pending；专题默认值只用于新建任务。

## 2. 状态与排期

样品保存初始 ETA、当前 ETA、pending、实际到样和事件历史。任务 readiness 为需到样样品 ETA 的最大值；任一 pending 时 readiness 为 pending。ETA 预览只列出关联的未开始任务，默认选择集为空，确认时事务内重算 token/version。任务日期平移保持所有成员日期一致，不改 progress、note 和工时。实际到样不自动开始任务。

任务链每个活动节点至多一个前驱和一个后继；同专题、无环、唯一链头。插入、重排、删除和替代先预览确认，已提交/已通过节点不能静默跳过。前置未验收时后续任务可规划，但成果提交需要人工覆盖理由或等待前置完成。

## 3. API

新增 `/api/v3`，统一返回 `{data,meta}` 或 `{error,code,details}`。路由使用精确版本匹配，不能把 `/api/v3` 落入 V2。端点分为：状态/备份；专题 CRUD、归档恢复；样品 CRUD、编号、ETA、到样；任务链 CRUD、排序、成员与工时；制冷机预览确认；旧计划引用预览确认；成果提交与人工验收；事件查询。

所有变更确认采用绑定当前事实、输入集合、版本和冲突选择的 SHA-256 token。confirm 在 `BEGIN IMMEDIATE` 中重新计算；stale token 返回 409，不自动覆盖。V1/V2 接口遇到 V3 管理任务时返回稳定 409，并引导用户走 V3 预览确认。

## 4. 成果与验收

成果提交快照任务完整样品集合、样品字段、任务标题、lineage 和验收模板。任务内每个样品可有结果条目；验收通过要求快照清单完整。退回后只能按同一集合重提；通过后样品集合冻结，新增样品必须创建替代任务或新 lineage。同一样品跨多个任务时各自独立验收。

## 5. 迁移、备份与回滚

新库按 V1→V2→V3 顺序创建。已有库先执行 `quick_check`、`foreign_key_check` 和 `VACUUM INTO` 备份，再在 `BEGIN IMMEDIATE` 中建立 V3 表、写入 version 3 checksum、校验后提交。V3 不自动回填专题和样品；旧计划只通过人工复制预览转换。部分表、checksum 不符或迁移失败时拒绝启动，恢复迁移前备份，不使用 reset 代替回滚。

## 6. 桌面契约与测试

新增 `v3` 前缀的专题列表、样品池、任务链、任务成员、ETA/制冷机预览、成果和验收控件；保留全部 V1/V2 ID。对话框最大 720px，专题抽屉 fixed 420px；Escape 顺序为对话框→专题抽屉→旧计划抽屉→V1 任务抽屉，重渲染后恢复触发焦点。测试覆盖 schema/checksum、V1/V2 golden、迁移回滚、跨任务样品、多人工时、ETA max、任务级制冷机冲突、链约束、成果快照/退回/通过、ID 复用和 1280×720/1366×768。
