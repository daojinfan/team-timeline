# 验证证据目录

本目录保存支持工作包 `verified` 状态的可复核证据。README 只定义格式，本身不是验证证据。

AI 执行任务使用独立的 TASK 目录：

```text
docs/05-quality/evidence/
└── TASK-NNN/
    ├── <run-token>-<validation-id>.output.txt
    └── <run-token>-<validation-id>.evidence.json
```

这些文件由 `.governance/tools/Invoke-AIGovernedTask.ps1 -Action Verify` 生成；JSON 绑定 TASK 契约哈希、工作包、基线、Git 提交、命令、参数、退出码、脱敏次数及输出哈希。编排器会对常见凭证格式做尽力脱敏，并拒绝明显包含凭证的命令参数，但这不能保证识别所有秘密；验证命令仍必须避免输出敏感信息。不得手工编写“通过”文本替代工具执行结果。

TEAM_PROJECT 的独立审核证据另须符合 `schemas/review-evidence.schema.json`。审核结果为 `passed` 或 `changes-required` 时，必须声明 `diff_checked: true`，并在 `changes` 中逐项记录本次实际新增、修改、删除或重命名的项目内容、路径、类型和摘要；重命名必须记录 `old_path`。工作包和基线必须与被审核 TASK 契约一致，变更清单必须匹配该 TASK 启动 Git 提交后的实际差异及变更类型。只保存自动化测试的 pass 输出，或只列出治理/证据文件，均不能作为审核通过依据。一次审核可以使用多个证据文件，但每个被审核 TASK 的状态和台账只记录实际覆盖它的证据路径，而且这仍只算一轮审核。`Lite` 一轮完整审核即可形成 `passed`；`Standard/Release` 第一轮形成 `provisional-passed`，重新开启并对相同内容指纹完成第二轮全量审核后才形成最终 `passed`。每轮必须创建内容不同的新证据文件；编排器会在 `review_history` 中保存路径、结论、轮次标识和 SHA-256，后续覆盖、复用或复制旧证据将导致校验失败。任一所需轮次不通过或两轮之间内容指纹变化都会按档位重新计数。

非 TASK 形式的人工或外部验证可以继续使用 manifest，至少记录：

```yaml
evidence_id: EVD-WP-NNN-001
work_package: WP-NNN
baseline: BL-NNN
verified_at: YYYY-MM-DDTHH:MM:SS+08:00
verifier: human-or-automation-id
environment: 环境和关键版本
commands:
  - command: 实际执行的命令
    exit_code: 0
    result: passed
acceptance_criteria:
  - criterion: 可验证的验收标准
    result: passed
artifacts:
  - path: 相对于项目根目录的证据路径
    sha256: 64位十六进制哈希
limitations: []
```

证据要求：

- 记录真实执行结果，不能只写“已测试”或复制预期结果；
- 证据必须绑定工作包和基线，且能映射到验收标准；
- 保留失败和重验历史，不覆盖旧证据；
- 日志、截图和报告不得包含密钥、令牌、个人信息或其他敏感数据；
- 大型二进制产物可存放在受控外部系统，但必须记录稳定引用、哈希和访问条件。
