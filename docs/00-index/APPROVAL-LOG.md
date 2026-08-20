---
doc_id: PROJ-APPROVAL-LOG-001
type: governance.approval-log
status: active
version: 1.0
owner: human
baseline: BL-001
depends_on: []
affects:
  - PROJ-BASELINE-REGISTRY-001
supersedes: null
last_reviewed: 2026-08-20
---

# 批准日志

本日志保存人类批准的可审计记录。对话中的同意只有在批准对象、范围和原始文本被记录后才生效。不得补写不存在的批准，也不得覆盖、删除或改写历史记录；撤销或替代时追加新记录。

当前批准记录：APR-001、APR-002、APR-003。

## APR-001

approval_id: APR-001
status: approved
approval_type: stage_gate
approved_items:
  - ARC-OVERALL-001
scope:
  - 桌面端总体设计；排除手机端、认证、云部署和数据迁移
plan_sha256: null
approver: human
confirmation_id: CONF-01a01f24-f369-73b1-b0fe-4bc69e626a60
approved_at: 2026-08-20T20:40:00+08:00
expires_at: null
baseline: BL-001
related_change: null
related_work_packages:
  - WP-001
approval_text: 确认总体设计
evidence: codex-thread:01a01ef6-d413-7660-bdc5-62bd5873cbf4
notes: 用户随后明确排除手机端，总体设计已按该范围修订。

## APR-002

approval_id: APR-002
status: approved
approval_type: baseline
approved_items:
  - BL-001
  - PROJ-CHARTER-001
  - REQ-BASE-001
  - ARC-OVERALL-001
  - ARC-COMP-001
  - ARC-COMP-002
  - ARC-COMP-003
  - DEC-001
  - DEL-WORK-001
scope:
  - 小组任务管理与甘特图系统桌面端 UX 改造详细设计与执行工作包
plan_sha256: null
approver: human
confirmation_id: CONF-01a01f2f-d9fd-7e71-ad73-db7940e88029
approved_at: 2026-08-20T20:44:47+08:00
expires_at: null
baseline: BL-001
related_change: null
related_work_packages:
  - WP-001
  - WP-002
  - WP-003
  - WP-004
  - WP-005
approval_text: 确认详细设计
evidence: codex-thread:01a01ef6-d413-7660-bdc5-62bd5873cbf4
notes: 同时批准 TEAM_PROJECT、桌面端范围、文件所有权、验证计划和首个基线内容。

## APR-003

approval_id: APR-003
status: approved
approval_type: baseline
approved_items:
  - BL-002
  - CR-001
  - DEL-WORK-001
scope:
  - 将已确认工作包的描述性上下文标签修正为精确文件路径；不改变设计、接口、数据或验收范围
plan_sha256: null
approver: human
confirmation_id: CONF-01a01f2f-d9fd-7e71-ad73-db7940e88029:BL-002
approved_at: 2026-08-20T20:50:00+08:00
expires_at: null
baseline: BL-002
related_change: CR-001
related_work_packages:
  - WP-001
  - WP-002
  - WP-003
  - WP-004
  - WP-005
approval_text: 确认详细设计
evidence: codex-thread:01a01ef6-d413-7660-bdc5-62bd5873cbf4#BL-002-route-correction
notes: 从同一宿主批准消息派生唯一的基线对象引用；仅修复机器路由表达。

## 记录格式

每项批准使用独立小节，并填写以下字段：

```yaml
approval_id: APR-NNN
status: approved
approval_type: decision
approved_items:
  - DEC-NNN
scope:
  - 精确文件、模块、环境或操作
plan_sha256: 任务契约的 SHA-256；非执行任务填 null
approver: 人类负责人标识
confirmation_id: CONF-宿主消息或外部审批记录的稳定标识
approved_at: YYYY-MM-DDTHH:MM:SS+08:00
expires_at: null
baseline: BL-NNN
related_change: CR-NNN
related_work_packages:
  - WP-NNN
approval_text: 人类确认的原始批准文本
evidence: 对话、工单或签署记录的稳定引用
notes: null
```

`approval_type` 可使用 `decision`、`baseline`、`stage_gate`、`execution`、`acceptance`、`exception`、`production_release` 或 `irreversible_operation`。`execution` 和 AI 任务的 `acceptance` 必须填写 `plan_sha256`，把批准绑定到不可静默变化的 TASK 契约。例外还必须记录 `EXC-NNN`、补偿控制和失效条件。

TASK 的 `execution` 与 `acceptance` 批准必须包含 `confirmation_id`。AI 不得自行编造该值；应使用宿主会话提供的用户消息标识或外部审批记录标识。本地脚本只能验证引用格式和绑定关系，身份真实性由宿主或审批系统保证。

批准只覆盖记录中的对象、范围、环境和期限。范围变化、批准到期或对象内容变化后必须重新批准。
