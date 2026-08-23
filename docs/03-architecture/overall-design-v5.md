---
doc_id: ARC-OVERALL-V5-001
type: architecture.overall.v5
status: proposed
version: 1.0
owner: human
baseline: BL-005
depends_on:
  - REQ-V5-001
  - CR-007
  - ARC-OVERALL-003
affects:
  - ARC-COMP-V5-001
  - QUAL-TRACE-V5-001
supersedes: ARC-OVERALL-V4-001
last_reviewed: 2026-08-23
---

# V5 总体设计：三模块任务管理架构

## 1. 设计原则

1. 任务事实只有一个来源，三个模块都是同一事实的不同工作视图。
2. 来源小组和专题是任务的两个独立归属字段；专题不再拥有来源小组。
3. 样品是独立规划对象，在任务编辑器中维护，不单独占一级导航。
4. 任务整体时间和成员任务时间分层保存；同步由人确认。
5. 状态只有必要的五类；人工动作与日期计算分开。
6. 所有不完整任务允许保存，用完整度提示替代强制填表。

## 2. 三模块与总体流程

~~~text
资源维护
  └─ 来源小组、成员、制冷机、数据维护
        ↓
任务全量编辑台
  └─ 专题树、任务、样品、测试定义、参与成员、计划时间
        ↓
执行中心
  └─ 甘特图、成员负载、任务/成员日期修改、状态执行
~~~

不再有独立工作台、需求中心、样品管理或成果验收入口。

## 3. 领域事实

~~~text
来源小组 1 ── N 任务
专题 1 ── N 任务
任务 M ── N 样品
任务 M ── N 测控成员
任务 1 ── 1 任务整体时间
任务 M ── N 成员任务时间片
~~~

专题只保存：

~~~text
name, purpose, status, notes, archived_at, version, created_at, updated_at
~~~

任务保存：

~~~text
task_id, topic_id, source_group_id, title, test_purpose, test_items,
notes, cryostat_id, task_color, execution_state, start_date, end_date,
version, created_at, updated_at
~~~

样品保存规划标签、型号、编号、ETA、实际到样和事件历史；任务与样品使用多对多关系。

## 4. 兼容策略

V5 设计不授权立即改写产品代码或数据库。后续实现必须采用增量迁移：

- V1/V2 canonical 任务编号和历史保留。
- 现有专题来源小组字段仅作为旧数据兼容，不再作为新任务来源事实。
- 任务需要新增独立来源小组事实。
- 旧联系人、默认制冷机、负责人和工时历史不在 V5 UI 新建或编辑。
- 现有成果记录暂不产生新记录，历史数据不得因 V5 页面重构被物理删除。
- 任务与样品跨专题关联规则需要在实现工作包中明确迁移和校验方案。

## 5. 状态计算

状态由人工状态和时间计算共同决定：

~~~text
已完成
  > 测试延期（人工开始测试且 now > end_date）
  > 正在测试（人工开始测试且 now <= end_date）
  > 样品交付延期（未开始且样品 ETA 已过且未到样）
  > 等待样品（未开始且样品未到、ETA 未过或待确认）
~~~

状态显示必须同时提供文字、颜色和可访问名称。
