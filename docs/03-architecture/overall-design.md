---
doc_id: ARC-OVERALL-001
type: architecture.overall
status: active
version: 1.0
owner: human
baseline: BL-001
depends_on:
  - REQ-BASE-001
affects:
  - DEL-WORK-001
supersedes: null
last_reviewed: 2026-08-20
---

# 总体设计

## 设计意图

在保持现有单体架构、数据库和公共 API 兼容的前提下，重构桌面端信息架构和任务工作流。核心质量属性依次为可理解性、操作效率、数据安全与可回归验证。

## 系统上下文

系统继续作为本地单用户 Web 应用运行。浏览器通过现有 JSON API 访问 Node.js 服务，服务使用 SQLite 文件持久化。项目不引入外部账号、云服务或新的网络信任边界。

## 主要领域和组件

| 编号 | 区域 | 职责 | 设计文档 |
| --- | --- | --- | --- |
| ARC-DOMAIN-001 | 桌面工作区 | 任务优先页面外壳、视图专属工具栏、成员筛选和详情抽屉 | components/desktop-workspace.md |
| ARC-DOMAIN-002 | 任务工作流 | 新建、完成、编辑、批量、归档和恢复交互语义 | components/task-workflow.md |
| ARC-DOMAIN-003 | 验证与兼容 | API 回归、动态示例数据和桌面浏览器验收 | components/verification.md |

## 关键流程和接口

- 顶部主操作打开新建任务模态窗口；左栏不再承载创建、模板和导入表单。
- 统计卡可以直接应用逾期或重叠筛选。
- 完成任务继续调用 `PUT /api/tasks/:id` 并发送 `status=completed`，不自动覆盖个人进度。
- 批量完成继续使用 `POST /api/batch/tasks`，只补齐客户端入口与回归覆盖。
- 甘特图智能范围完全在客户端计算，不新增公共 API。
- 新数据库示例日期按当天偏移生成；已有数据库不迁移。

## 数据和信任边界

SQLite 表结构、软删除语义、备份结构、CSV 列和 JSON 导出结构保持不变。用户内容仍需在插入 HTML 前转义。应用不增加身份认证，也不得因本次改造扩大监听或部署范围。

## 部署和运行

继续使用 `npm start` 在本地启动，默认端口 3000，数据库仍为 `data/team_tasks.sqlite`。本期不推送远程、不部署生产环境。

## 主要风险和决策

- DEC-001：仅优化桌面端，保持原生技术栈、现有公共接口和数据库结构。
- 主要风险是三个前端文件间的契约漂移；通过先冻结 UX 规范、再按文件所有权并行实现控制。
- 完成状态与个人进度保持独立，避免标记完成时隐式改写历史进度。
