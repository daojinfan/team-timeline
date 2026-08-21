---
doc_id: DEL-WORK-001
type: delivery.work-packages
status: active
version: 1.1
owner: human
baseline: BL-002
depends_on:
  - ARC-OVERALL-001
  - ARC-OVERALL-002
  - ARC-COMP-004
affects:
  - QUA-TRACE-001
supersedes: null
last_reviewed: 2026-08-20
---

# 工作包

| 编号 | 目标 | 基线 | 依赖 | 验证 | 负责人 |
| --- | --- | --- | --- | --- | --- |
| WP-001 | 建立已批准的项目基线 | BL-002 | 无 | 治理检查 | human |
| WP-002 | 固化桌面 UX 规范和实现清单 | BL-002 | WP-001 | 文档与契约检查 | ARCHITECT |
| WP-003 | 实现桌面页面外壳和样式 | BL-002 | WP-002 | 语法与桌面浏览器验收 | IMPLEMENTER |
| WP-004 | 实现客户端任务交互和状态反馈 | BL-002 | WP-002 | 客户端语法与桌面浏览器验收 | IMPLEMENTER |
| WP-005 | 实现动态示例数据和状态回归测试 | BL-002 | WP-002 | npm test | TESTER |
| WP-006 | 实现 V2 服务端、增量迁移与 API 回归 | BL-003 | WP-002 | schema/迁移/API/V1 回归与 Release 双轮审核 | IMPLEMENTER |
| WP-007 | 实现 V2 六区桌面外壳与样式 | BL-003 | WP-002 | DOM 契约、无溢出和双分辨率浏览器双轮审核 | IMPLEMENTER |
| WP-008 | 集成 V2 客户端交互与完整人工闭环 | BL-003 | WP-006、WP-007 | 关键交互、错误路径、焦点、V1 回归与双轮审核 | INTEGRATOR |
| WP-009 | 实现 V2.1 专题、样品池与连续任务链 | BL-004 | WP-006、WP-007、WP-008 | schema 3、/api/v3、专题桌面闭环、V1/V2 兼容与 Release 双轮审核 | IMPLEMENTER |
| WP-010 | 修复 V2.1 审核阻断并完成最终发布 | BL-004 | WP-009 历史交付 | 五项阻断闭环、V1/V2 兼容、双分辨率与 Release 双轮审核 | PM |
| WP-011 | 锁定 V2.1 最终修复差异并完成发布审核 | BL-004 | WP-010 历史计划 | 五项阻断闭环、V1/V2 兼容、双分辨率与 Release 双轮审核 | PM |

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

## WP-002 契约

- 目标：把已批准详细设计转换为实现者可直接使用的桌面 UX 规范和检查清单。
- 范围：`docs/03-architecture/components/` 中本期设计文档及实现验收映射。
- 范围外：产品代码、手机端设计、公共接口和数据库。
- 验收：规范无占位内容，组件状态、空状态、工具栏和验收步骤可追踪到 REQ-001 至 REQ-007。
- 任务档位：Release。

## WP-003 契约

- 目标：重构桌面 HTML 页面外壳和 CSS，使活动视图进入首屏并移除永久第三栏。
- 允许修改：`public/index.html`、`public/styles.css`。
- 范围外：`public/app.js`、服务端、手机端和数据接口。
- 验收：1280×720 与 1366×768 桌面布局满足 ARC-COMP-001。
- 任务档位：Release。

## WP-004 契约

- 目标：实现视图专属工具栏、新建模态框、完成状态、智能范围、筛选、偏好和反馈。
- 允许修改：`public/app.js`。
- 范围外：HTML/CSS、服务端、数据库和手机端。
- 验收：满足 ARC-COMP-002，`node --check public/app.js` 通过并完成桌面浏览器验收。
- 任务档位：Release。

## WP-005 契约

- 目标：让新数据库示例日期相对当天生成，并增加状态与兼容性自动化回归。
- 允许修改：`src/server.js`、`tests/`。
- 范围外：数据库表结构、现有数据库迁移、前端和导入导出格式。
- 验收：满足 ARC-COMP-003，全部 `npm test` 通过。
- 任务档位：Release。

## WP-006 契约

- 目标：实现 V2 schema、迁移前备份、34 个 `/api/v2` 端点、人工任务/冲突/成果/验收事务及自动化回归。
- 允许修改：`src/server.js`、`tests/`。
- 范围外：`public/`、规范文档、AI 自动建任务、认证、云同步和手机端。
- 依赖：BL-003 已激活，REQ-V2-001、ARC-OVERALL-002、ARC-COMP-004、DEC-002、CR-002 均已冻结。
- 验收：12 表、10 索引、迁移/重开/回滚、34 端点、V1 API/CSV/JSON/reset 兼容和 `npm test` 全部通过；独立 Reviewer 对同一指纹连续两轮通过。
- 回滚：停止服务，保留失败库，使用迁移前 SQLite 备份原子恢复，再回退代码。
- 任务档位：Release。

## WP-007 契约

- 目标：实现 V2 六区桌面导航、计划总览、计划/分配/验收表单、420px 详情抽屉及资源维护外壳。
- 允许修改：`public/index.html`、`public/styles.css`。
- 范围外：`public/app.js`、服务端、数据库、手机端和触摸专用交互。
- 依赖：BL-003 已激活，固定 DOM/颜色/桌面边界以 ARC-COMP-004 为唯一契约。
- 验收：保留全部 V1 ID，V2 固定 ID 无重复；1280×720 与 1366×768 下六区单行、主体首屏、页面无水平溢出、720px dialog/420px drawer 合规；独立 Reviewer 连续两轮通过。
- 回滚：回退 `index.html`/`styles.css` 的独立交付提交。
- 任务档位：Release。

## WP-008 契约

- 目标：在 WP-006/WP-007 已集成契约上实现计划总览、人工分配、预览确认、成果提交与人工验收的完整客户端闭环。
- 允许修改：`public/app.js`。
- 范围外：HTML/CSS、服务端、数据库、AI 自动建任务、认证、云同步和手机端。
- 依赖：WP-006 与 WP-007 已验证并由 PM 完成中间集成门。
- 验收：六区切换、状态/颜色、窗口筛选、ETA/制冷机两阶段确认、冲突确认、人工成果/验收、错误保留、键盘焦点及 V1 五视图均通过；独立 Reviewer 对同一指纹连续两轮通过。
- 回滚：回退 `app.js` 独立交付提交；若服务端已迁移真实库，同时按 WP-006 回滚数据库。
- 任务档位：Release。

## WP-009 契约

- 目标：在保持 V1/V2 兼容的前提下实现 V2.1 专题、样品池、线性连续任务链、任务级制冷机、多人工时和成果验收。
- 允许修改：`src/server.js`、`src/v3/`、`tests/`、`public/index.html`、`public/styles.css`、`public/app.js`。
- 范围外：修改 V2 canonical 表/API/checksum、AI 自动建任务、自动分配、手机端、登录、云同步和二进制附件。
- 依赖：BL-004、REQ-V21-001、ARC-OVERALL-003、ARC-COMP-005、DEC-003、CR-003。
- 验收：schema 3 增量迁移、V3 API exact set、V1/V2 golden 兼容、专题/样品/任务链/多人/ETA/制冷机/成果验收闭环、1280×720 与 1366×768 双分辨率；实现任务各自独立 Reviewer 连续两轮通过。
- 回滚：停止服务，保留失败库，使用迁移前 SQLite 备份恢复；代码按交付提交回退。

## WP-010 契约

- 目标：在 WP-009 的 V2.1 专题、样品池、连续任务链实现上，完成独立审核发现的导航、抽屉、必做任务、依赖更新和自冲突修复，并完成最终 Release 审核。
- 允许修改：`src/server.js`、`src/v3/`、`tests/`、`public/index.html`、`public/styles.css`、`public/app.js`。
- 范围外：修改 V2 canonical 表/API/checksum、AI 自动建任务、自动分配、手机端、登录、云同步和二进制附件。
- 依赖：BL-004、REQ-V21-001、ARC-OVERALL-003、ARC-COMP-005、DEC-003、CR-003；WP-009 的实现与审核历史作为修复输入。
- 验收：五项独立审核阻断全部闭环；V3 schema/API、V1/V2 兼容、专题/样品/任务链/多人/ETA/制冷机/成果验收、六区桌面交互及 1280×720/1366×768 双分辨率全部通过；独立 Reviewer 连续两轮通过。
- 回滚：停止服务，保留失败库，使用迁移前 SQLite 备份恢复；代码按最终交付提交回退。
- 任务档位：Release。

## WP-011 契约

- 目标：锁定当前 V2.1 最终修复差异，完成完整验证、独立审核和提交。
- 允许修改：`src/server.js`、`src/v3/`、`tests/`、`public/index.html`、`public/styles.css`、`public/app.js`。
- 范围外：修改 V2 canonical 表/API/checksum、AI 自动建任务、自动分配、手机端、登录、云同步和二进制附件。
- 依赖：BL-004、V2.1 已批准设计；WP-010 仅作为历史计划记录。
- 验收：五项审核阻断全部闭环，V1/V2/V3、六区桌面交互、双分辨率与 Release 双轮审核通过。
- 回滚：停止服务，保留失败库，恢复迁移前 SQLite 备份并回退最终提交。
- 任务档位：Release。
- 任务档位：Release。
