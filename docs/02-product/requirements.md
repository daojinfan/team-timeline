---
doc_id: REQ-BASE-001
type: product.requirements
status: active
version: 1.0
owner: human
baseline: BL-001
depends_on:
  - PROJ-CHARTER-001
affects:
  - ARC-OVERALL-001
supersedes: null
last_reviewed: 2026-08-20
---

# 需求

| 编号 | 需求 | 优先级 | 验收标准 | 状态 |
| --- | --- | --- | --- | --- |
| REQ-001 | 桌面首屏以当前任务或甘特图为核心内容 | high | 1280×720 下无需滚动即可看到活动视图主体 | approved |
| REQ-002 | 各主视图只显示适用的工具栏与操作 | high | 日志、维护不出现甘特图和批量任务控件 | approved |
| REQ-003 | 提供完整且稳定的任务完成工作流 | high | 可单项和批量完成；编辑已完成任务保持 completed | approved |
| REQ-004 | 甘特图首次进入应展示有意义的数据范围 | high | 智能范围展示当前或最近任务；空状态提供明确操作 | approved |
| REQ-005 | 新建、反馈、筛选和偏好应减少重复操作 | medium | 新建一次点击可达；操作有加载/错误反馈；桌面偏好可恢复 | approved |
| REQ-006 | 保持数据、接口与导入导出兼容 | high | 无表结构迁移；现有 SQLite、CSV、JSON 可继续使用 | approved |
| REQ-007 | 交付必须通过自动化和桌面浏览器验收 | high | npm test、客户端语法及两种桌面分辨率验收通过 | approved |

需求获得批准前，必须有验收标准和负责人。
