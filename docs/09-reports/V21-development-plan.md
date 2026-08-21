---
doc_id: RPT-V21-DEV-001
type: report.development-plan.v21
status: active
version: 1.0
owner: human
baseline: BL-004
depends_on:
  - ARC-COMP-005
  - CR-003
supersedes: null
last_reviewed: 2026-08-21
---

# V2.1 开发计划

## 工作包

- DEV-V31-A：`src/server.js`、`src/v3/**`、`tests/v3-api.test.js`。负责 schema 3、迁移、V3 API、领域约束、V1 guard 和事务回归。独立 Reviewer A。
- DEV-V31-B：`public/index.html`、`public/styles.css`。负责专题/样品池/任务链 DOM、六区壳、空态、抽屉、对话框和双分辨率布局。独立 Reviewer B。
- DEV-V31-C：`public/app.js`。依赖 A/B，负责 V3 状态、列表、预览确认、链、多人、成果验收、焦点和错误路径。独立 Reviewer C。
- DEV-V31-D：集成与验收，只写测试/证据；负责真实 V2 副本、迁移、V1/V2/V3 回归、浏览器双尺寸和回滚演练。独立 Reviewer D。

A 与 B 可并行，C 等待 A 的 API 和 B 的 DOM，D 等待 A/B/C。每个 Release 交付必须完成两轮独立审核；实现成员不得自审。

## 停止条件

V2 canonical 内容、旧 checksum、V1/V2 路由、样品/ETA/制冷机语义、成果快照、DOM 契约或范围发生未批准变化时立即停止，回到 PM 设计门。迁移校验、兼容 golden、回滚或浏览器关键路径失败时不得进入验收。
