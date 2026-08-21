---
doc_id: QUAL-TRACE-V21-001
type: quality.traceability.v21
status: active
version: 1.0
owner: human
baseline: BL-004
depends_on:
  - REQ-V21-001
  - ARC-COMP-005
  - DEC-003
supersedes: null
last_reviewed: 2026-08-21
---

# V2.1 追踪矩阵

| 需求 | 服务端/数据 | 桌面 | 验证 |
| --- | --- | --- | --- |
| REQ-V21-001～002 | v3_topics、来源/联系人约束 | 专题总览与筛选 | 来源组、专题 CRUD、空态 |
| REQ-V21-003 | v3_samples、编号/ETA/到样 | 样品池 | 同型号多样品、编号后补 |
| REQ-V21-004～005 | v3_topic_tasks、v3_task_samples | 任务链 | 线性链、跨任务复用、跨专题拒绝 |
| REQ-V21-006 | v3_task_members、工时 | 人工分配 | 多人、0.5h、周负载、个人备注保持 |
| REQ-V21-007 | 任务 cryostat、冲突 token | 制冷机预览 | 同专题豁免、跨专题冲突 |
| REQ-V21-008～010 | readiness、状态聚合、ETA 事件 | 状态颜色/窗口 | max ETA、pending、7 日、到样空白 |
| REQ-V21-009 | preview/confirm/version | 预览确认/错误保留 | stale、取消零写入、选择性平移 |
| REQ-V21-011～012 | submission/review 快照 | 成果验收 | 退回重提、完整集合、任务/专题完成 |
| REQ-V21-013～015 | V3 migration、legacy refs | 历史计划子页 | V1/V2 golden、备份/回滚 |
| REQ-V21-016 | 兼容性与无移动约束 | 六区、抽屉、双分辨率 | DOM、ARIA、scrollWidth、焦点 |

验收必须覆盖 16 项需求 exact-set、V3 schema/checksum、V1/V2 兼容、迁移失败恢复、无 AI/无手机端和 1280×720/1366×768。
