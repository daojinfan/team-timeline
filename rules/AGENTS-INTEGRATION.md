# AGENTS.md 接入规则

在项目根目录加入项目级 `AGENTS.md`，内容可以使用下面的契约，再根据项目实际路径和命令进行调整：

```markdown
# 项目 AI 协作契约

本项目使用《大型项目治理框架》。

人类只执行一次初始化；此后由 AI 主动建立和维护 TASK 执行契约、状态及验证证据，不把治理命令转交给人类。

任何文件修改前都必须按任务档位完成 Governance Preflight，并通过 `.governance/tools/Invoke-AIGovernedTask.ps1` 固化写入任务。按以下顺序读取：

1. governance.json
2. docs/00-index/PROJECT.md
3. docs/00-index/CURRENT-STATE.md
4. 当前工作包及其直接关联的权威文档
5. 相关决策、变更包和基线清单

有工作包时，缺失路由由 AI 使用 `.governance/tools/New-WorkPackageContext.ps1` 从已登记文档创建，再运行 `.governance/tools/Get-TaskContext.ps1 -WorkPackage WP-NNN`，并按 `docs/04-delivery/context/WP-NNN.context.json` 路由读取。上下文预算是软预算：超限应告警和优化路由，但不得静默截断必需文档。

普通请求在当前 WP 下建立 TASK，并按 Plan -> Start -> Verify 推进。AI 在 `Start` 时维护 `LeaseOwner`，在活动任务 `Verify` 时读取并提交匹配的 `LeaseId` 和持有者。风险识别覆盖标题、目标、写入路径以及验证命令和参数。Release TASK 还必须记录环境、窗口、回滚、观察指标、停止条件和发布后负责人。只有越出现有 WP/基线、触发重要风险控制点或需要验收时，才向人类提出一次合并确认；结构化批准必须引用宿主或外部审批系统提供且未被复用的 `ConfirmationId`，AI 不得编造。实际 Git 改动越界、契约哈希变化、基线过期或依赖未验证时必须暂停，不得自行扩权。

TEAM_PROJECT 的交付 TASK 必须绑定独立 REVIEWER TASK。Lite 对同一最终内容完成一轮全量审核即可通过；Standard/Release 必须连续两轮全量审核均通过，第二轮不得只复查上一轮发现项。只有自动化测试 pass、没有逐项检查新增或修改内容时，审核不得通过；整改或内容变化后按档位重新计数。

批准后的文档是权威来源，聊天记录不是权威来源。
规则冲突时遵循 rules/00-PRECEDENCE.md。
遵循 rules/AI-EXECUTION-PROTOCOL.md、rules/TASK-PROFILES.md、rules/CHANGE-CONTROL.md、rules/STATUS-TRANSITIONS.md 和 rules/AI-TRUST-AND-SECURITY.md。
如果 docs/00-index/PROJECT.md 的运行模式为 TEAM_PROJECT，还必须遵循 rules/TEAM-MODE.md，并通过任务台账接受工作包。
发现冲突、基线过期、所有权不明确或重要的未批准变更时，必须以 needs-decision 状态暂停。
报告完成前按当前阶段要求运行项目治理校验器。生产发布、数据删除或其他不可逆操作必须获得独立的结构化批准。
```

项目级 `AGENTS.md` 应使用项目相对路径引用规则文件。不要把完整规则复制到每个任务提示中，保持一份集中维护的规则副本。项目必须在 `governance.json` 中锁定框架版本、源提交和源树状态，以便审计与升级。
