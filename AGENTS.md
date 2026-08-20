# 项目 AI 协作契约

本项目使用《大型项目治理框架》。

人类只需完成一次项目初始化。此后 AI 负责选择工作包、拆解 TASK、记录状态、执行、验证和维护证据；除范围/架构/接口/数据/安全、例外、验收、发布和不可逆操作等明确控制点外，不把治理工具操作转交给人类。

任何文件修改前都必须按任务档位完成 Governance Preflight，并优先通过 `.governance/tools/Invoke-AIGovernedTask.ps1` 建立机器可校验的 `TASK-NNN` 执行契约。未显式指定时使用全局 `Release` 档位；只有满足较低档位全部条件时才可显式指定为 `Standard` 或 `Lite`。按以下顺序读取：

1. governance.json
2. docs/00-index/PROJECT.md
3. docs/00-index/CURRENT-STATE.md
4. 当前工作包及其直接关联的权威文档
5. 相关决策、变更包和基线清单

有工作包时，缺失路由由 AI 使用 `.governance/tools/New-WorkPackageContext.ps1` 从已登记文档创建，再运行 `.governance/tools/Get-TaskContext.ps1 -WorkPackage WP-NNN`，并按 `docs/04-delivery/context/WP-NNN.context.json` 路由读取。上下文预算是软预算：超限应告警和优化路由，但不得静默截断必需文档。

日常请求映射为当前基线内的 `TASK-NNN`，不是每次都新建基线级 `WP-NNN`。AI 必须按 `Plan -> Start -> Verify` 推进；验证失败保留证据并修复后重试。AI 必须根据语义影响主动设置风险标志，不能只依赖路径名推断。仅在用户确认验收后执行 `RecordApproval -ApprovalType acceptance` 和 `Accept`。实际改动越出 `allowed_paths`、基线变化、依赖未验证或契约哈希变化时，必须停止为 `needs-decision`，不得自行扩权。若请求超出现有工作包及上下文路由，AI 应提交一次合并后的范围/设计确认，再创建工作包或新基线。

Release TASK 必须记录目标环境、执行窗口、回滚方案、观察指标、停止条件和发布后负责人，并在完成/验收前自动通过 Release 级校验。风险识别必须覆盖标题、目标、写入路径以及验证命令和参数。`Start` 由 AI 写入 `LeaseOwner`，活动 TASK 的 `Verify` 必须提供匹配的 `LeaseId` 与持有者。`RecordApproval` 必须引用宿主或外部审批系统提供的唯一 `ConfirmationId`，AI 不得自行编造或复用。

升级旧状态时，非 accepted TASK 逐项使用 `MigrateTask`，全部迁移完成后执行普通 Strict；旧 accepted 审核任务使用 `MigrateReviewer`；缺少验收快照或需要纠正的 accepted 交付使用 `ReopenAcceptance`，随后重新执行完整审核、批准和验收。

批准后的文档是权威来源，聊天记录只是探索上下文。
规则冲突时遵循 rules/00-PRECEDENCE.md。遵循 rules/PROJECT-RULES.md、rules/DOCUMENT-GOVERNANCE.md、rules/AI-EXECUTION-PROTOCOL.md、rules/TASK-PROFILES.md、rules/CHANGE-CONTROL.md、rules/STATUS-TRANSITIONS.md 和 rules/AI-TRUST-AND-SECURITY.md。
如果 docs/00-index/PROJECT.md 的运行模式为 TEAM_PROJECT，还必须遵循 rules/TEAM-MODE.md，并通过任务台账接受工作包。
TEAM_PROJECT 下，每个准备进入集成或验收的非审核交付任务都必须在开始前绑定独立的 `TEAM_REVIEWER` 任务；其 TASK 契约角色值为 `REVIEWER`。AI 应优先让编排器把不可变的 `role`、`read_paths`、`write_paths` 和 `review.required` 写入契约，再用 `AssignReview` 把动态 `reviewer_task_id` 写入运行状态；审核状态和证据也只以运行状态及台账为准。审核成员完成结构化证据后用 `RecordReview` 登记结果。审核必须审查本次实际新增/修改/删除/重命名内容，并在 `changes` 中逐项列出；重命名必须额外记录 `old_path`，清单必须与任务启动提交后的实际 Git 变更及变更类型一致，且证据工作包和基线必须与 TASK 契约一致。只读取自动化测试 pass 项、只复述执行报告或没有实际变更清单，都不得通过。审核任务的 `allowed_paths` 和 `write_paths` 只能是自己的审核证据目录，`read_paths` 才用于读取实现范围；该限制由启动门和 Strict 双重校验。`Lite` 任务一轮完整审核通过即可形成 `passed`；`Standard`/`Release` 第一轮形成 `provisional-passed`，必须执行 `ReopenReview` 并对同一最终内容完成第二轮全量审核后才形成 `passed`。任一所需轮次 `changes-required` 或两轮之间内容变化都会按档位重新计数；第二轮不得只复查上一轮发现项，也不得靠重复调用 `RecordReview` 伪造。审核任务由 `RecordReview` 完成并保持 `verified`，不得记录 acceptance approval 或单独执行 `Accept`；工作包聚合时该状态按审核已完成处理。历史 `accepted` 审核任务由 AI 使用 `MigrateReviewer` 规范化并重新执行 Strict，不得直接修改运行状态。实现者不得自审；审核者不得直接修改交付范围；审核未完成、结论不是最终 `passed`、连续通过计数不足档位要求、内容指纹不一致或证据缺失时，不得把交付任务标记为 completed、进入集成或请求验收。被替换或归档且从未进入集成的任务只能记录为 `cancelled` 审核，不能作为交付成果。

TEAM_PROJECT 必须由项目经理指定唯一协调工作树。所有治理状态动作只在该工作树执行；隔离执行 worktree 只返回代码提交、实际差异和证据，由项目经理集成后统一 `Verify`、审核和落账。不得让多个 worktree 分别修改 `.governance/runtime`、`TASK-LEDGER.md` 或 `WORK-STATUS.md`。执行租约过期时使用 `Recover` 停止为 `needs-decision`，不得静默接管。
编排器使用持久 transaction journal 恢复核心状态多文件写入时的进程崩溃；下次治理动作必须先完成恢复再继续。
发现冲突、基线过期、所有权不明确或重要的未批准变更时，必须以 needs-decision 状态暂停。
报告完成前按当前阶段要求运行项目治理校验器。生产发布、数据删除或其他不可逆操作必须获得独立的结构化批准。
