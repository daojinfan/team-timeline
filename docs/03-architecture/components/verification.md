---
doc_id: ARC-COMP-003
type: architecture.component.verification
status: active
version: 1.0
owner: human
baseline: BL-001
depends_on:
  - ARC-OVERALL-001
affects:
  - QUA-TRACE-001
supersedes: null
last_reviewed: 2026-08-20
---

# 验证与兼容详细设计

## 自动化验证

- `npm test`：现有 API 与新增完成状态、动态示例数据回归。
- `node --check public/app.js`：客户端脚本语法。
- Release 治理检查：基线、工作包、任务、审核和证据一致性。

## 浏览器验收

在 1280×720 和 1366×768 验证：首页首屏、视图专属工具栏、新建任务、完成与重新打开、智能甘特图、统计卡筛选、详情抽屉、归档恢复和维护流程。

## 兼容约束

不修改 SQLite 表结构、数据库文件位置、CSV 列、JSON 备份结构和现有 API 路径。动态示例日期只作用于首次创建的新数据库。
