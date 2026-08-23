---
doc_id: PROJ-BASELINE-REGISTRY-001
type: governance.baseline-registry
status: active
version: 1.0
owner: human
baseline: BL-001
depends_on:
  - PROJ-DOC-REGISTRY-001
affects:
  - DEL-WORK-001
supersedes: null
last_reviewed: 2026-08-20
---

# 基线注册表

本文件登记所有项目基线。基线清单位于 `baselines/<基线编号>/manifest.json`，记录文档版本、文件哈希、Git 提交和批准记录。清单一旦批准不得原地修改。

清单的 `documents` 是不可变的基线受控内容；`context_routes` 锁定目标基线中活动工作包的上下文读取路由及哈希；`operational_documents` 仅登记运行状态文件，不参与内容哈希。运行状态文件可以随着基线登记、激活和任务推进更新，不构成基线内容漂移。

初始化产生的 `BL-001` 是草案基线，只能用于编写和评审，不能授权实现。完成项目章程、需求和设计评审后，生成清单并取得批准，再通过独立激活步骤将其设为唯一可执行基线。

| 基线 | 状态 | 清单 | Git 提交 | 批准记录 | 创建日期 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| BL-001 | superseded | baselines/BL-001/manifest.json | 0e33df4bf03bcfabc812eda9e1d549e621feb98f | APR-002 | 2026-08-20 | Approved desktop UX TEAM_PROJECT baseline |

允许的状态：`draft`、`approved`、`active`、`superseded`、`archived`。同一时刻只能有一个 `active` 基线。

## 登记要求

激活基线前必须确认：

- 清单中的规范性文件路径和版本与 `DOC-REGISTRY.md` 一致；
- 文件哈希和 Git 提交可重现；
- 所有关联决策和变更包已经批准；
- 批准日志明确记录批准对象和范围；
- 受影响工作包已经重新评估。

状态必须按 `draft -> approved -> active -> superseded -> archived` 转换。`approved` 只表示内容已获批准；激活时必须先将原 `active` 基线转为 `superseded`，再把新基线转为唯一 `active`，最后同步更新 `governance.json.current_baseline` 和 `CURRENT-STATE.md`。不得跳过激活步骤。
| BL-002 | superseded | baselines/BL-002/manifest.json | 8bd1a4ac80fcc71327a554b3bd4e2cc65268733d | APR-003 | 2026-08-20 | Corrected governed work package path scopes |
| BL-003 | superseded | baselines/BL-003/manifest.json | ebb86f52ea84877fdc07127b7c752c11045e7963 | APR-044 | 2026-08-21 | Approved V2 control-plan, human assignment, deliverable acceptance, and desktop execution baseline |
| BL-004 | superseded | baselines/BL-004/manifest.json | pending | APR-059 | 2026-08-21 | Approved V2.1 topic, sample-pool, linear task-chain, task cryostat, and V3 compatibility baseline |
| BL-005 | superseded | baselines/BL-005/manifest.json | 328076e6d56687443c6f0f06ca1c1103510d7d85 | APR-083 | 2026-08-22 | V4 专题唯一工作区、样品规划、人工连续任务排序、状态窗口与跨入口同步基线 |
| BL-006 | active | baselines/BL-006/manifest.json | be88bd0c89fbd8bcb63a74b5a0784ebdfe970f07 | APR-103 | 2026-08-23 | V5 三模块任务管理与执行设计基线（资源维护、任务全量编辑台、执行中心） |
