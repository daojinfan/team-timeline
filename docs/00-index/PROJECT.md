---
doc_id: PROJ-INDEX-001
type: governance.project-index
status: active
version: 1.1
owner: human
baseline: BL-001
depends_on: []
affects: []
supersedes: null
last_reviewed: 2026-08-20
---

# 项目入口

- 项目名称：小组任务管理与甘特图系统
- 项目标识：PRJ-PROJECT-A0C26D10
- 项目负责人：human
- 项目路径：D:\Codex\人员管理系统
- 治理框架版本：2.0.0
- 治理框架源提交：216b1871d0f3bb152197710d69a428d54dc321c6
- 治理框架源工作树为脏状态：true
- 治理框架源树哈希：c7761d457726ed6174afd2229e9e111fa7db6c72a7d191d39bcbd06a22d0620e
- 运行模式：TEAM_PROJECT
- 默认任务档位：Release
- 团队模式：已启用（当前任务为 PROJECT_MANAGER）

## 当前控制面板

- 当前状态：docs/00-index/CURRENT-STATE.md
- 决策队列：docs/00-index/DECISION-QUEUE.md
- 文档注册表：docs/00-index/DOC-REGISTRY.md
- 基线注册表：docs/00-index/BASELINE-REGISTRY.md
- 批准日志：docs/00-index/APPROVAL-LOG.md
- 工作包：docs/04-delivery/WORK-PACKAGES.md
- 工作包状态：docs/04-delivery/WORK-STATUS.md
- 团队运行规则：rules/TEAM-MODE.md
- 团队任务台账：docs/04-delivery/TASK-LEDGER.md
- 当前基线：BL-004
- 机器可读状态：governance.json

每次任务先读取本入口，再读取当前状态和权威文档。旧报告、聊天消息、自动生成的摘要和已被替代的文档都不能作为当前执行指令。

## 运行模式说明

当前使用 `TEAM_PROJECT` 和 Release 任务档位。项目经理是人类负责人的唯一项目管理接口，独立交付任务必须绑定独立 Reviewer；只有文件范围互不重叠且依赖满足的任务才允许并行。
