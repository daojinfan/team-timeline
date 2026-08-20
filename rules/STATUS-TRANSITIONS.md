# 状态转换规则

状态表示已经具备的事实，不表示意图。每次状态转换都必须记录操作者、时间、依据和必要证据；不得仅靠修改状态文本声明完成。

## 1. 文档状态

允许的主路径：

```text
draft -> proposed -> active -> superseded -> archived
                         \-> retired -> archived
```

- `draft -> proposed`：作者确认内容可供正式评审。
- `proposed -> active`：人类批准记录存在，依赖有效，并已登记到文档注册表。
- `active -> superseded`：替代文档已经生效，且双方记录 `supersedes` 关系。
- `active -> retired`：人类确认该文档不再适用且没有替代文档。
- `superseded/retired -> archived`：历史引用和审计信息已保留。

评审未通过的文档回到 `draft` 修改。不得直接修改 `superseded` 或 `archived` 文档使其重新生效；应创建新版本或新文档。

## 2. 决策状态

```text
proposed -> approved -> superseded
         \-> rejected      \-> retired
```

- `approved` 必须引用结构化人类批准记录。
- `superseded` 必须引用替代决策及影响分析。
- `retired` 表示决策不再适用且没有替代项。
- 被拒绝、替代或退役的决策不得继续约束新工作。

## 3. 工作包状态

工作包契约记录在 `WORK-PACKAGES.md`，以下状态转换统一记录在运行状态文件 `WORK-STATUS.md`；`CURRENT-STATE.md` 只保留摘要。

工作包内的日常 AI 执行由 `.governance/runtime/tasks/TASK-NNN.contract.json` 与对应 `state.json` 记录。多个 TASK 共用一个 WP 时，WP 状态必须由工具聚合，不能由任一任务直接宣称整个工作包完成：存在 `needs-decision`、`blocked`、`in-progress`、`implemented` 时依次优先；全部交付 TASK 至少 verified 才能使 WP verified；全部交付 TASK accepted，且所有必需 `REVIEWER` TASK 已完成审核并保持 verified，才能使 WP accepted。聚合器只在计算 WP 状态时把该 reviewer verified 视为审核完成，不会改变审核任务自身状态。

主路径为：

```text
planned -> in-progress -> implemented -> verified -> accepted
```

辅助状态为 `blocked`、`needs-decision` 和 `superseded`：

- `planned -> in-progress`：基线可执行、依赖已满足、范围和所有权明确。
- `in-progress -> implemented`：范围内交付物已经完成，但尚未证明验收标准通过。
- `implemented -> verified`：所有必需验证成功，证据已写入 `docs/05-quality/evidence/` 并完成追踪。
- `verified -> accepted`：仅适用于非 `REVIEWER` 交付任务且人类负责人已记录接受结果；在 `TEAM_PROJECT` 中，还必须先由独立 `TEAM_REVIEWER` 任务按任务档位完成审核（`Lite` 一轮，`Standard/Release` 对同一最终内容连续两轮），形成 `passed` 结论并保存所需证据。`acceptance` 批准只能在这些条件满足后记录，并绑定当时的最终内容和当前验证证据指纹；批准生成到 `Accept` 之间的任一内容变化都会使旧批准失效。进入 accepted 后保留冻结快照，不用未来 HEAD 重算历史验收。
- `accepted -> verified`：只允许项目经理通过 `ReopenAcceptance -Reason <原因>` 显式撤销需要纠正或迁移的旧验收。动作原子清除旧批准和冻结快照；`TEAM_PROJECT` 同时把审核结论重置为 `changes-required`、把旧 `accepted` 审核任务规范化为 `verified`，随后必须执行 `ReopenReview` 和按档位要求的完整审核，再生成新的 acceptance 批准。不得用当前 HEAD 猜测并回填历史验收指纹。
- `AssignReview`：仅允许在交付 TASK 仍为 `planned` 时绑定同工作包、依赖该 TASK 的 `REVIEWER` 任务。
- `RecordReview`：仅允许已 `verified` 的 `REVIEWER` TASK 在交付审核状态为 `pending` 时写入本轮的新结构化证据。`Lite` 的第一轮通过直接形成 `passed` 并记录计数 1；`Standard/Release` 的第一轮形成 `provisional-passed` 并记录计数 1，只有重新执行一轮完整审核且指纹未变化，第二次通过才形成 `passed`。`changes-required` 使交付 TASK 回到 `implemented` 并清零连续通过计数；`cancelled` 只适用于未进入集成且已被替代的 `superseded` TASK（其台账状态为 `replaced`）。临时 `blocked` TASK 必须恢复或转为 `superseded`，不能用取消审核绕过审核门。审核任务本身由 `RecordReview` 完成并保持 `verified`，不得记录 acceptance approval 或单独执行 `Accept`。
- `ReopenReview`：`changes-required` 后，交付 TASK 必须先修复并重新达到 `verified`；`Standard/Release` 的 `provisional-passed` 后则直接开启第二轮。两种情况都会把原 `REVIEWER` TASK 从 `verified` 恢复为 `planned`，保留不可变历史并要求重新经过 `Start -> Verify -> RecordReview`。前者从零计数，后者只有在最终内容指纹未变化时才能延续计数。`Lite` 的 `passed` 不需要 ReopenReview。
- `MigrateReviewer`：只用于把旧版本留下的 `REVIEWER accepted` 规范化为 `verified`，清除审核任务自身无效的 acceptance 绑定并执行 Strict。它不创造审核结论，也不绕过证据门；现有审核状态或证据无效时迁移必须失败并回滚。
- `blocked`：外部依赖暂时不满足；解除后回到原主路径状态。
- `needs-decision`：存在范围、设计、基线或权威来源问题；取得并登记决定后回到 `planned` 或 `in-progress`。
- `superseded`：工作包被新的工作包替代，必须记录替代关系和未完成项去向。

TASK 的暂时阻塞使用编排器 `Block` 并填写原因；解除后使用 `Resume`，工具会重新检查基线、依赖、范围和并发冲突。`needs-decision` 不得直接恢复：决定若不改变契约，可在记录决定后建立替代 TASK；若改变范围或设计，必须回到相应工作包或基线流程，并将旧 TASK 标记为 `superseded`。

`Start` 会为执行任务建立同时绑定随机 `LeaseId`、`LeaseOwner` 和到期时间的运行租约。活动 TASK 的 `Verify` 必须提供匹配的 ID 与持有者；其他执行者不得验证或接管。租约过期后继续 `Verify` 会把任务停止为 `needs-decision`；项目经理可用 `Recover` 记录异常退出原因并清除过期租约，再依据决定建立替代任务。

旧的非 accepted TASK 使用 `MigrateTask` 逐项升级到运行状态 Schema v2，并补齐验收快照占位、审核计数和租约字段；迁移事务可以临时跳过项目中其他尚未升级的 v1 状态，避免多个旧 TASK 互相阻塞，但全部迁移结束后必须再次执行普通 Strict，普通运行不得使用兼容开关。旧 accepted 交付由 `ReopenAcceptance` 同时升级交付与审核状态。v1 只有审核证据路径而没有不可变历史时，迁移会对现存证据建立迁移时哈希快照，但交付结论必须重置并重新完成完整审核，不把迁移快照当作新通过轮次。无法归属或没有到期时间的旧活动租约会安全停止为 `needs-decision`。新契约使用 Schema v2；旧 v1 契约保持不可变哈希，后续新增的 Release 控制只强制作用于 v2 契约。核心状态写入前保存 transaction journal，若进程中断，下次治理动作先恢复旧快照。

验证失败、实现变更或基线变化时，`implemented`、`verified` 工作包应回到 `in-progress` 或 `planned`，并保留原验证证据。`accepted` 后发生变化必须创建新工作包或变更包，不能覆盖历史接受记录。

## 4. 基线状态

```text
draft -> approved -> active -> superseded -> archived
```

- `draft`：可用于编写和评审，不能授权实现；项目初始化的 `BL-001` 默认处于此状态。
- `approved`：基线内容及影响已获人类批准，清单和文件哈希完整。
- `active`：当前唯一可执行基线；同一项目同一时刻只能有一个。
- `superseded`：新基线已经激活；旧基线保持不可变并可审计。
- `archived`：不再用于日常导航，但仍保留清单和批准记录。

基线一旦进入 `approved` 就不可原地修改。任何内容变化必须产生新的基线编号。

在项目尚未形成第一份批准基线时，`governance.json.current_baseline` 可以指向登记表中的 `draft` 基线，用于文档编写和评审；此时不得将依赖该基线的工作包推进到 `in-progress` 或执行实现。

批准和激活是两个独立动作：

1. 创建 `draft` 基线清单；
2. 人类审阅清单和影响后形成批准记录，将状态改为 `approved`；
3. 激活工具确认清单不可变、批准有效及工作包已重评；
4. 原 `active` 基线转为 `superseded`，新基线转为唯一的 `active`；
5. 只有此时才更新 `governance.json.current_baseline` 和 `CURRENT-STATE.md`。

不得把 `approved` 基线直接写入当前基线字段来替代激活步骤。

## 5. 项目阶段

团队项目的正常路径为：

```text
DISCOVERY
-> OVERALL_DESIGN_PENDING_APPROVAL
-> DETAILED_DESIGN_PENDING_APPROVAL
-> EXECUTION_PLANNING
-> TEAM_EXECUTION
-> INTEGRATION_AND_VERIFICATION
-> USER_ACCEPTANCE
-> CLOSED
```

进入下一阶段前必须满足 `TEAM-MODE.md` 的阶段门。回退阶段必须说明原因、受影响工作包和所需重验；范围、架构或验收标准发生重大变化时还必须建立变更包并重新批准基线。

## 6. 状态转换权限

AI 可以在已批准工作包内记录 `in-progress`、`implemented`、`blocked` 和 `needs-decision`。只有可核验的自动化结果或指定验证者可以支持 `verified`；TEAM_PROJECT 的交付任务还必须经过不同任务承担的独立审核，项目经理或人类批准不得替代该审核。只有人类批准可以产生 `approved`、`accepted`、阶段门通过、例外授权和生产发布授权。
