---
doc_id: DEL-WORK-001
type: delivery.work-packages
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

# 工作包

| 编号 | 目标 | 基线 | 依赖 | 验证 | 负责人 |
| --- | --- | --- | --- | --- | --- |
| WP-001 | 建立已批准的项目基线 | BL-001 | 无 | 治理检查 | human |

执行状态统一记录在 `WORK-STATUS.md`，避免日常状态变化改写已经批准的工作包契约。
每个活动工作包还必须有 `context/WP-NNN.context.json`，声明所需权威文档、读取模式、适用基线和验证。上下文路由随基线锁定；已经 `accepted` 或 `superseded` 的历史工作包可以保留旧路由。生成的 `.governance/context/*.generated.md` 只是临时输入，不是项目事实。
新路由应使用 `.governance/tools/New-WorkPackageContext.ps1` 创建，由工具核对工作包、运行状态和文档注册表，避免产生未登记引用或覆盖既有路由。

## 工作包契约

编号：
目标：
范围：
范围外：
基线：
权威文档：
允许修改的文件/模块：
依赖：
验收标准：
必须执行的验证：
任务档位：
上下文路由：
