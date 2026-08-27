---
doc_id: DEL-WORK-001
type: delivery.work-packages
status: active
version: 1.4
owner: human
baseline: BL-011
depends_on:
  - ARC-OVERALL-001
  - ARC-OVERALL-002
  - ARC-COMP-004
affects:
  - QUA-TRACE-001
supersedes: null
last_reviewed: 2026-08-22
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
| WP-009 | 在 V2.1 兼容基础上修正 V4 专题唯一工作区与连续任务体验 | BL-005 | WP-006、WP-007、WP-008 | V3 schema/API 兼容、V4 专题主路径、样品/任务/状态/同步、双分辨率与 Release 双轮审核 | IMPLEMENTER |
| WP-010 | 按 Web 字段表收敛工艺组专题、样品与任务数据 | BL-005 | CR-006 | 备份、数据库完整性、V3 API/页面数据核对与回滚演练 | PM |
| WP-011 | 从已确认的测控任务需求文档受控导入单个 V5 任务 | BL-006 | REQ-V5-001、ARC-OVERALL-V5-001、ARC-COMP-V5-001 | 来源哈希、备份、精确字段映射、V5/V1 投影与数据库完整性 | PM |
| WP-012 | 收敛 V5 样品字段并保持历史数据与 V3 兼容 | BL-008 | CR-008、REQ-V5-001、ARC-OVERALL-V5-001、ARC-COMP-V5-001 | V5 表单字段回归、样品新增/编辑、编号后补、ETA 状态、历史字段保留与 API 回归 | IMPLEMENTER |
| WP-013 | 为任务全量编辑台和执行中心增加可配置的默认状态筛选 | BL-009 | DEC-005、CR-009、REQ-V5-001、ARC-COMP-V5-001 | 默认值设置入口、独立状态集合、浏览器持久化、无效配置回退、两视图初始化与回归测试 | IMPLEMENTER |
| WP-014 | 优化执行中心选中任务排期详情的结构与视觉层级 | BL-010 | WP-013、REQ-V5-001、ARC-COMP-V5-001 | 详情事实网格、成员列表样式隔离、桌面粘性面板、窄屏回落、操作层级与视觉回归 | IMPLEMENTER |
| WP-015 | 重设计执行中心任务与负载数据工作区 | BL-011 | WP-014、REQ-V5-001、ARC-COMP-V5-001 | 自适应工作区高度、任务表格化、负载可视化、滚动保持、窄屏成员筛选回落与双视口回归 | IMPLEMENTER |

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

## WP-013 契约

- 目标：让任务全量编辑台和执行中心的默认状态筛选可由用户配置，同时保持当前首次使用的“全部状态”行为。
- 范围：`public/index.html` 中资源维护的工作区默认值设置入口；`public/app.js` 中 V5 偏好解析、保存、应用、重置和两个视图的状态筛选初始化；`tests/` 中相关回归。
- 业务规则：任务全量编辑台和执行中心分别保存状态集合；空集合表示全部状态；手动修改当前筛选不覆盖默认值；配置损坏或版本不兼容回退到全部状态。
- 兼容策略：使用版本化浏览器 `localStorage`，不增加数据库表、不改变 V5/V3/V2/V1 API 和任务事实；不影响其他浏览器或历史数据。
- 范围外：共享用户配置、登录权限、云同步、数据库迁移、V5 API 变化、状态计算规则变化、远程发布。
- 基线：BL-010。
- 权威文档：`REQ-V5-001`、`ARC-COMP-V5-001`、`QUAL-TRACE-V5-001`、`DEC-005`、`CR-009`、`DEL-WORK-001`。
- 允许修改：`public/index.html`、`public/app.js`、`tests/`、`docs/02-product/requirements-v5.md`、`docs/03-architecture/components/v5-detailed-design.md`、`docs/05-quality/traceability-v5.md`、`docs/07-decisions/DEC-005.md`、`docs/08-changes/CR-009.md`、`docs/04-delivery/WORK-PACKAGES.md`、`docs/04-delivery/WORK-STATUS.md`、`docs/00-index/CURRENT-STATE.md`、`docs/05-quality/evidence`、治理任务与工作状态文件。
- 验收：设置入口可达；两视图可独立保存 0～5 类状态；刷新或重新进入对应模块后应用配置；空集合显示全部状态；无效 JSON/未知状态/旧版本回退到全部状态；手动筛选不覆盖默认值；重置清除配置并恢复全部状态；`npm test`、`node --check public/app.js` 和 V5 静态回归通过；独立 Reviewer 完成 Standard 双轮复审。
- 回滚：回退前端、测试和文档交付提交；清除本地偏好键即可恢复固定“全部状态”行为；不涉及数据库回滚。
- 任务档位：Standard（本地展示偏好，无数据/API/发布风险）。

## WP-014 契约

- 目标：修复执行中心“选中任务 / 排期详情”的日期竖排、异常留白和成员列表样式串扰，并把详情重组为与当前选择保持上下文关联的响应式面板。
- 范围：`public/index.html` 中详情卡位置与头部操作；`public/app.js` 中详情渲染、打开/关闭和选择状态；`public/styles.css` 中执行工作区三列/两列回落、事实信息块、详情成员列表与响应式样式；`tests/` 中相关回归。
- 业务规则：未选择任务时详情不占用桌面第三列；选择任务后桌面端显示右侧粘性详情面板；较窄屏幕回落到主内容下方；任务选择高亮、排期编辑、全量编辑和成员排期入口保持可用。
- 兼容策略：不增加或改变 API、数据库、排期计算、冲突预览、版本校验和任务事实；只调整客户端 DOM、交互状态与样式。
- 范围外：服务端、数据库、排期业务规则、任务状态算法、全量编辑台结构、远程发布。
- 基线：BL-010。
- 权威文档：`REQ-V5-001`、`ARC-COMP-V5-001`、`QUAL-TRACE-V5-001`、`DEC-005`、`CR-009`、`DEL-WORK-001`。
- 允许修改：`public/index.html`、`public/app.js`、`public/styles.css`、`tests/`、`docs/04-delivery/WORK-PACKAGES.md`、`docs/04-delivery/WORK-STATUS.md`、`docs/05-quality/evidence`、治理任务与工作状态文件。
- 依赖：WP-013 已完成相关 V5 执行中心前置交付；实现任务依赖已验收的 TASK-284。
- 验收：事实字段无 0px 内容列和逐字竖排；详情成员列表不继承侧栏滚动/最小高度；桌面选择后详情在右侧粘性展示且未选择时不占位；窄屏无横向溢出；操作入口无重复；`npm test`、`node --check public/app.js`、Strict 治理检查和浏览器视觉回归通过；独立 Reviewer 完成 Standard 双轮复审。
- 回滚：回退前端和测试提交即可恢复原详情卡；不涉及数据库或数据回滚。
- 任务档位：Standard（本地 UI 结构与样式优化，无数据/API/发布风险）。

## WP-015 契约

- 目标：扩大并重组执行中心“任务”和“负载”视图的数据承载区域，使主内容与成员筛选栏高度协调，在桌面和窄屏下保持清晰、稳定和高效浏览。
- 范围：`public/index.html` 中任务列头与成员筛选折叠入口；`public/app.js` 中任务/负载渲染、相对负载条、数据视图状态和滚动位置保持；`public/styles.css` 中自适应工作区高度、固定表头、任务两行标题、负载风险提示和窄屏回落；`tests/` 中相关回归。
- 业务规则：任务和负载继续使用现有筛选结果；任务选择仍打开右侧排期详情；成员点击仍执行成员筛选；负载统计口径保持任务数量、排期天数和重叠数量，相对负载条只把当前筛选内排期天数归一化用于视觉比较。
- 兼容策略：不增加或改变 API、数据库、任务事实、筛选表达式、状态算法、排期预览和负载统计口径；只调整客户端 DOM、视图状态与样式。
- 范围外：服务端、SQLite、任务全量编辑台、资源维护、甘特图排期规则、远程发布。
- 基线：BL-011。
- 权威文档：`REQ-V5-001`、`ARC-COMP-V5-001`、`QUAL-TRACE-V5-001`、`DEC-005`、`CR-009`、`DEL-WORK-001`。
- 允许修改：`public/index.html`、`public/app.js`、`public/styles.css`、`tests/v5-execution-task-load-panel.test.js`、`docs/04-delivery/WORK-PACKAGES.md`、`docs/04-delivery/WORK-STATUS.md`、`docs/05-quality/evidence`、治理任务与工作状态文件。
- 依赖：WP-014 已验收，最终执行内容由已验收的 TASK-288 提供。
- 验收：1280×720 下任务/负载主卡与成员栏等高，任务至少可见 8 行、负载至少可见 10 名成员；任务固定列头、长标题最多两行；负载固定表头并显示相对负载条和重叠提示；重绘保持滚动位置；右侧详情不降低主卡高度；700×720 下主内容优先、成员筛选可折叠且无横向溢出；`npm test`、`node --check public/app.js`、Strict 和双视口浏览器回归通过；独立 Reviewer 完成 Standard 双轮复审。
- 回滚：回退前端和测试交付提交即可恢复原 340px/355px 数据框；不涉及数据库或数据回滚。
- 任务档位：Standard（本地 UI 结构与样式优化，无数据/API/发布风险）。

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

- 目标：在保持 V1/V2 与 V3 API 兼容的前提下，完成 V2.1 专题、样品池、连续任务、任务级制冷机、多人时和成果验收，并按 V4 信息架构统一专题入口、样品规划、人工排序、状态窗口和跨入口同步。
- 允许修改：`src/server.js`、`src/v3/`、`tests/`、`public/index.html`、`public/styles.css`、`public/app.js`。
- 范围外：修改 V2 canonical 表/API/checksum、V3 schema/API 破坏性变化、AI 自动建任务、自动分配、手机端、登录、云同步和二进制附件；本地联络人持久化需另立变更。
- 依赖：BL-005、REQ-V21-001、REQ-V4-001、ARC-OVERALL-003、ARC-OVERALL-V4-001、ARC-COMP-005、ARC-COMP-V4-001、DEC-003、DEC-004、CR-003、CR-005。
- 验收：V3 schema/API 兼容、V1/V2 golden 兼容、专题/样品/任务链/多人/ETA/制冷机/成果验收闭环、V4 主路径/编辑归属/人工排序/状态颜色与窗口/跨入口同步、1280×720 与 1366×768 双分辨率；实现任务各自独立 Reviewer 连续两轮通过。
- 回滚：停止服务，保留失败库，使用迁移前 SQLite 备份恢复；代码按交付提交回退。
- 任务档位：Release。

## WP-010 契约

- 目标：依据已确认的《专题任务Web字段整理表》，将当前 Web 中来源小组为“工艺组”的专题、样品和连续任务收敛到表格保留范围。
- 范围：`data/team_tasks.sqlite` 的 V3 工艺组数据；执行前数据库备份；变更后 V3 关系、V1 canonical 任务投影和 Web 查询结果核对；保留可重复执行的整理脚本。
- 范围外：其他来源小组数据、V2 schema/API、代码逻辑、V3 schema/API 合约、物理删除备份数据、手机端和 AI 功能。
- 基线：BL-005。
- 权威文档：`REQ-V4-001`、`ARC-OVERALL-V4-001`、`ARC-COMP-V4-001`、`CR-006`、`DEL-WORK-001`。
- 允许修改：`scripts/reconcile-web-data.mjs`、`data/team_tasks.sqlite`、`data/backups`、`outputs/专题信息补全模板-20260822/专题任务Web字段整理表.xlsx`（只读）、`docs/08-changes/CR-006.md`、`docs/04-delivery/WORK-PACKAGES.md`、`docs/04-delivery/WORK-STATUS.md`、`docs/00-index/CURRENT-STATE.md`、`docs/00-index/APPROVAL-LOG.md`、`docs/05-quality/evidence`。
- 验收：保留 5 个专题、9 个样品、9 个任务；多余工艺组专题/样品可恢复归档；其他来源小组数据不变；关联无孤儿；备份可恢复；V3 API 查询与前端页面只展示保留范围。
- 回滚：停止服务，使用执行前 SQLite 备份原子恢复；保留失败库和验证证据。
- 任务档位：Release。

## WP-011 契约

- 目标：根据 `CONF-V5-DEMAND-IMPORT-20260825-01`，把已确认的 Z3.2.2 读取线路异常复核需求作为一个完整 V5 任务写入当前本地系统。
- 范围：读取指定 Markdown 需求源；执行前备份 `data/team_tasks.sqlite`；新增且仅新增 1 个样品、1 个任务、1 个结构化测试项及其必要 V1/V5 兼容投影和事件；通过现有 V5 API 核对 Web 可见结果。
- 已确认映射：专题“读取驻波问题”；来源小组“工艺组”；制冷机“祖4”；样品型号“Z3.2.2 107Q”；样品编号“Z3.2.2_FC_V2_Bottom 02-05”；ETA `2026-08-25`；无参与成员、无任务排期、人工阶段 `waiting`。
- 范围外：修改现有专题/资源/任务/样品，修改或停用 `Z4.1` 资源，新增成员或排期，修改 schema/API/前端代码，删除数据，远程发布。
- 基线：BL-006。
- 权威文档：`REQ-V5-001`、`ARC-OVERALL-V5-001`、`ARC-COMP-V5-001`、`QUAL-TRACE-V5-001`、`DEC-004`、`DEL-WORK-001`。
- 允许修改：`data/team_tasks.sqlite`、`data/backups`、`docs/09-reports`、`docs/05-quality/evidence`、`docs/04-delivery/WORK-PACKAGES.md`、`docs/04-delivery/WORK-STATUS.md`、`docs/04-delivery/context/WP-011.context.json`、`docs/00-index/APPROVAL-LOG.md`、`.governance/runtime/tasks`、`docs/04-delivery/TASK-LEDGER.md`。
- 验收：需求源哈希固定；写入前备份可读且 `PRAGMA integrity_check=ok`；无同名任务和同编号样品；新增对象精确匹配已确认字段；来源/专题/制冷机均引用既有稳定 ID；任务在 V5 查询和 V1 兼容投影可见；外键检查通过；其他既有业务对象不变；独立 Reviewer 对同一最终内容连续两轮通过。
- 回滚：停止本地服务，将失败后的数据库另存后，用执行前 SQLite 备份恢复 `data/team_tasks.sqlite`，重启并复核计数、对象哈希和完整性。
- 任务档位：Release。

## WP-012 契约

- 目标：按 `CONF-V5-SAMPLE-FIELDS-20260825-01` 收敛当前 V5 任务编辑器中的样品字段，降低创建和补录成本。
- 范围：`public/index.html`、`public/app.js` 中 V5 样品新增与任务全量编辑展示；`src/v3/index.js` 中 V5 样品默认映射、样品更新兼容和样品交付延期判定；相关自动化回归测试与验证证据。
- 业务字段：保留样品型号、样品编号、预计交付时间、样品备注；移除规划标签、样品数量、实际到样时间的当前 V5 UI 展示和写入。
- 兼容策略：不删除或重命名 SQLite 历史列；V3 旧页面/API 不改；新增样品由型号生成兼容规划标签，未传规划标签的更新沿用或同步型号。
- 范围外：独立样品库导航、数据库物理删除、V3 破坏性接口、任务/专题/资源字段变化、远程发布。
- 基线：BL-008。
- 权威文档：`REQ-V5-001`、`ARC-OVERALL-V5-001`、`ARC-COMP-V5-001`、`QUAL-TRACE-V5-001`、`CR-008`、`DEL-WORK-001`。
- 允许修改：`public/index.html`、`public/app.js`、`src/v3/index.js`、`tests/`、`docs/05-quality/evidence`、`docs/09-reports`、治理任务与工作状态文件。
- 验收：V5 新增/编辑表单只出现四个样品字段；样品编号可为空并可后补；样品备注可新增和编辑；不再显示规划标签、样品数量、实际到样时间；历史列和 V3 API 保留；无规划标签请求可成功创建；编号补录后状态计算正确；`npm test`、客户端/服务端语法和 V5 回归通过；独立 Reviewer 对最终内容完成 Release 双轮复审。
- 回滚：停止本地服务，按交付提交回退代码；不执行数据库删除或不可逆迁移。
- 任务档位：Release。
