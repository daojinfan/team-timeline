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
| WP-002 | 固化桌面 UX 规范和实现清单 | BL-001 | WP-001 | 文档与契约检查 | ARCHITECT |
| WP-003 | 实现桌面页面外壳和样式 | BL-001 | WP-002 | 语法与桌面浏览器验收 | IMPLEMENTER |
| WP-004 | 实现客户端任务交互和状态反馈 | BL-001 | WP-002 | 客户端语法与桌面浏览器验收 | IMPLEMENTER |
| WP-005 | 实现动态示例数据和状态回归测试 | BL-001 | WP-002 | npm test | TESTER |

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
