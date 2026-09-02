# 项目当前工作模式

## 默认暂停治理

本项目当前默认采用业务开发优先模式。

除非用户明确提出以下请求之一：

- 治理台账
- 治理同步
- 更新状态文档
- 执行治理校验
- 恢复治理流程

否则：

- 不维护 `docs/04-delivery/TASK-LEDGER.md`、`docs/04-delivery/WORK-STATUS.md`、`docs/00-index/CURRENT-STATE.md`；
- 不创建或更新 `TASK-NNN`、`WP-NNN`；
- 不执行 Governance Preflight；
- 不主动运行 Strict 或 Release 治理校验；
- 不修改 `.governance/runtime/`；
- 直接处理用户要求的业务代码、界面和测试。

本约定覆盖项目治理自动化要求中的默认执行部分，不覆盖系统安全规则、数据保护规则、相关业务测试，以及发布、删除数据等不可逆操作的确认要求。

用户明确要求治理时，仅对该次请求恢复必要的治理流程；请求完成后继续保持默认暂停状态。
