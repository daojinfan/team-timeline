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

当前批准记录：暂无。

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
