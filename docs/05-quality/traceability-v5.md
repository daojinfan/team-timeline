---
doc_id: QUAL-TRACE-V5-001
type: quality.traceability.v5
status: proposed
version: 1.0
owner: human
baseline: BL-005
depends_on:
  - REQ-V5-001
  - ARC-OVERALL-V5-001
  - ARC-COMP-V5-001
  - CR-007
supersedes: QUAL-TRACE-V4-001
last_reviewed: 2026-08-23
---

# V5 追踪矩阵：三模块任务管理

| 需求 | 设计位置 | 后续验证 |
| --- | --- | --- |
| REQ-V5-001～003 三模块边界 | ARC-OVERALL-V5-001 §2、ARC-COMP-V5-001 §1 | 顶层导航互斥、无重复入口 |
| REQ-V5-004～007 专题属性与删除 | ARC-COMP-V5-001 §3.2 | 专题 CRUD、归档保护、无专题 |
| REQ-V5-008～012 任务和样品字段 | ARC-OVERALL-V5-001 §3、ARC-COMP-V5-001 §3.3 | 全量编辑、字段保存、缺失项提示 |
| REQ-V5-013～017 状态 | ARC-OVERALL-V5-001 §5、ARC-COMP-V5-001 §4.3 | 手动开始/完成、ETA 延期、测试延期优先级 |
| REQ-V5-018～022 双层时间 | ARC-COMP-V5-001 §4.1～4.2 | 任务拖拽、成员拖拽、同步确认、冲突预览 |
| REQ-V5-023～025 搜索过滤 | ARC-COMP-V5-001 §3.4、§4.4 | 组合筛选、祖先专题保留、空结果 |
| REQ-V5-026～027 同步日志撤销 | ARC-COMP-V5-001 §5～6 | 跨入口刷新、版本冲突、日志和撤销 |
| 桌面边界 | ARC-COMP-V5-001 §7 | 1280×720、1366×768、容器滚动和可访问状态 |

## 质量门

实现前必须重新规划实现工作包，完成 V5 目标基线批准和激活；不得直接把 V4 实现任务扩权为 V5 实现。
