---
doc_id: QUAL-TRACE-V2-001
type: quality.traceability.v2
status: active
version: 1.0
owner: human
baseline: BL-003
depends_on:
  - REQ-V2-001
  - ARC-OVERALL-002
  - ARC-COMP-004
  - DEC-002
  - CR-002
affects: []
supersedes: null
last_reviewed: 2026-08-21
---

# V2 需求追踪矩阵

## 1. 使用边界

本矩阵把 REQ-V2-001 的 V2-REQ-001..016 全量映射到 ARC-COMP-004 的 UI、API、DDL 和测试契约，并分派到批准详设中的 DEV-A（`src/server.js`、`tests/**`）、DEV-B（`public/index.html`、`public/styles.css`）和 DEV-C（`public/app.js`）。BL-003 激活前，本矩阵不授权任何开发或迁移。

## 2. 全量追踪

| 需求 | ARC-COMP-004 | API / DDL | UI / DOM | 验证 | 开发包 |
| --- | --- | --- | --- | --- | --- |
| V2-REQ-001 | §1、§11、§13 | `/api/v2/*` 仅本地追加；12 张 V2 表均无 AI/认证字段 | `#v2Nav` 六区；无移动端入口 | 静态扫描无 AI/登录/外部调用；监听范围与 V1 回归 | DEV-A / DEV-B / DEV-C |
| V2-REQ-002 | §2、§3、§6 | `v2_source_groups`、`v2_source_contacts`；资源端点按来源小组+规范化姓名去重 | `#v2PlanDialog` 高级联系人区、`#v2PlanFilters`、`#v2PlanDrawer` | 资源 CRUD、重复冲突、详情与筛选浏览器测试 | DEV-A / DEV-B / DEV-C |
| V2-REQ-003 | §1、§3、§6、§11 | `v2_control_plans`、`v2_plan_test_items`；计划/测试项端点 | `#v2PlansView`、`#v2PlanDialog`、可选项目/课题标签 | 最小计划成功；标签缺省不阻塞；列表/分组测试 | DEV-A / DEV-B / DEV-C |
| V2-REQ-004 | §3、§6.4、§11 | 计划 `sample_model` 必填，`temporary_sample_no`/`formal_sample_no` 可空；计划/到样端点 | 计划基本区与折叠高级区 | 仅型号创建、编号后补、未填编号仍可排期 | DEV-A / DEV-B / DEV-C |
| V2-REQ-005 | §3、§6.3.1、§6.4 | 计划字段 CHECK/外键；`POST /api/v2/plans` 稳定 `VALIDATION_ERROR` | `#v2PlanDialog` 基本字段、ETA/制冷机显式待定、至少一测试项 | 字段边界、空值组合、缺测试项和稳定错误 details | DEV-A / DEV-B / DEV-C |
| V2-REQ-006 | §1、§3.2、§9、§12.2 | `v2_plan_tasks.task_lineage_key`；四个 plan-task preview/confirm；不自动建任务 | `#v2AssignmentView`、`#v2TaskDialog`；确认后才成立 | 无自动任务；主负责人必填；UUID lineage 与人工审计 | DEV-A / DEV-B / DEV-C |
| V2-REQ-007 | §3、§6.3、§8 | ETA/cryo preview+confirm、token/version、`v2_plan_events`；事务内重算 | `#v2EtaDialog`、`#v2CryostatDialog`、影响预览和确认 | token 失效、历史追加、确认输入一致、制冷机冲突 | DEV-A / DEV-B / DEV-C |
| V2-REQ-008 | §8.1、§9.2 | ETA `selected_task_ids` 缺省 `[]`；只移动 eligible；批量排除旧基线后重算 | ETA 候选复选框、未选/进行中/完成只读展示 | 默认不平移；selected 间及与其他任务三类冲突；状态保护 | DEV-A / DEV-B / DEV-C |
| V2-REQ-009 | §6.2、§7、§11 | `GET /api/v2/plans` 的 search/filter/group/stats/pagination | `#v2WorkbenchView`、`#v2Stats`、`#v2PlanFilters`、`#v2PlanGroups` | 数据/总数/分组可含归档；stats 永远只算 active 并应用同筛选 | DEV-A / DEV-B / DEV-C |
| V2-REQ-010 | §7、§11 | `window_days` 1..365；分类器以服务端本地日历 today 和闭区间计算 | `#v2ArrivalWindowDays` 默认 7 | 0/7/边界日、跨月年、窗口变更不写业务日期 | DEV-A / DEV-B / DEV-C |
| V2-REQ-011 | §6.4、§7、§12.1 | 初始/当前 ETA、actual arrival、`main_status`/`eta_drift_days` | 计划卡和抽屉展示漂移；实际到样未测试不渲染状态 chip | 七级优先级；空白状态排除窗口；完成/执行覆盖 | DEV-A / DEV-B / DEV-C |
| V2-REQ-012 | §3.2、§9 | 主负责人、协作者、日期、0.5h 步进总工时；三类冲突 preview/confirm | `#v2AssignmentView`、`#v2ConflictDrawer`、`#v2TaskDialog` | 编辑先排除自身旧 assignments/工时；日期、周>40h、制冷机冲突 | DEV-A / DEV-B / DEV-C |
| V2-REQ-013 | §3、§10、§13 | submission、snapshot tables；URL 白名单、本地路径仅文本；不接收二进制 | `#v2SubmissionDialog` 和成果列表 | exact checklist set、伪造/重复/缺失拒绝、URL/路径安全测试 | DEV-A / DEV-B / DEV-C |
| V2-REQ-014 | §10、§12.3 | review endpoint；accepted/returned 事务；supersession 按 `(plan_id,task_lineage_key)` | `#v2ReviewDialog`、`#v2AcceptanceView` | accepted 全 passed；returned 恢复执行；个人 progress 保持独立；后继限制 | DEV-A / DEV-B / DEV-C |
| V2-REQ-015 | §3.3、§4、§5、§13、§15 | schema v2 增量迁移、备份/回滚、V1 API/CSV/JSON 不变；reset/软删策略 | `#v2ExecutionView` 复用 V1，`#v2ManagementView` 显示迁移/备份 | 真实 V1 副本；已有库/新库/重开幂等；reset 清序列后 lineage 不串历史 | DEV-A / DEV-B / DEV-C |
| V2-REQ-016 | §14、§15 | 34 个 V2 端点的 schema/错误/排序/分页；12 表与索引；全部 V1 回归 | 六区核心路径与全部 dialog/drawer/focus/空态 | `npm test`、`node --check`、迁移回归；1280×720、1366×768 浏览器验收 | DEV-A / DEV-B / DEV-C |

## 3. 交付与独立审核

| 开发包 | 独占文件 | 主要交付 | 必须验证 | 独立审核重点 |
| --- | --- | --- | --- | --- |
| DEV-A | `src/server.js`、`tests/**` | 12 表迁移、34 端点、分类器、冲突、成果/验收、V1 兼容 | Node 语法、API/迁移/回滚/V1 自动化 | DDL/API/事务/错误/lineage/reset/格式兼容 |
| DEV-B | `public/index.html`、`public/styles.css` | 六区 shell、固定 DOM、模态框/抽屉、双桌面尺寸 | DOM 契约、1280×720、1366×768、无横向溢出 | ID/可访问性/颜色/空态/桌面专用边界 |
| DEV-C | `public/app.js` | 六区状态、API 编排、预览/确认、焦点与错误保留 | Node 语法、API mock、全核心浏览器路径 | token/防重复/焦点/失败保留/无自动决定 |

三个开发包只能在 PM 完成 BL-003 权威化与激活门、生成工作包/上下文且 Release 达到 0 error / 0 warning 后启动；每包必须绑定不同于实现者的 Reviewer。任何 DDL/API/DOM/状态语义或迁移边界变化都触发停止和重新评审。

## 4. 批准与来源指纹

- TASK-025 来源审批：`APR-030`；subject SHA-256：`4a148b7a53b5b7112e71ca2c2f871654d8870267127ac2c27a40a0d700ed0dd0`。
- TASK-027 详设审批：`APR-033`；subject SHA-256：`177bb592755ffcc1dfb2d07a5e3930bd6df517f512a9c8a3692852474ef65140`。
- 四份已接受 proposal SHA-256（requirements / overall design / change / detailed design，依次）：`008b54c8ce2d03b12bb60ff96dc0637d31f30a6cfa621a1da9218e177b8dae24`、`7c4a27350621777704c5671eca66d2cf227f8177bfb966b5bca50d8310122481`、`9a737dc6d7350df0c007674b34b074dd12ffb5a3d9a7ade1a0309353a11bb465`、`867b2f24808eddf7a2936e749e93d6f6ac241e54d5ca9871ff7092bbc8cee695`。
- 详细设计 canonical body SHA-256（统一 LF）：`f683c2e0ea6211ace89f4623890232cf7160637eecc1760f7f9500d4b216924d`。
