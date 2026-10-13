import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAppServer, initDatabase } from "../src/server.js";
import { V5_ENDPOINTS, V5_INDEXES, V5_SCHEMA_CHECKSUM, V5_TABLES, validateV5Schema } from "../src/v3/index.js";

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "team-task-v5-"));
  const database = await initDatabase(path.join(dir, "team_tasks.sqlite"));
  const server = createAppServer(database, { auth: false });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, { method = "GET", body, expected = [200] } = {}) => {
    const response = await fetch(`${base}${route}`, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json();
    assert.ok(expected.includes(response.status), `${method} ${route}: ${response.status} ${JSON.stringify(payload)}`);
    return payload;
  };
  return { database, request, async close() { await new Promise((resolve) => server.close(resolve)); database.close(); await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } };
}

test("V5 schema is additive, exposes the frozen endpoint surface, and reopens idempotently", async () => {
  const app = await fixture();
  try {
    const status = (await app.request("/api/v5/status")).data;
    assert.equal(status.schema_version, 1);
    assert.equal(status.checksum, V5_SCHEMA_CHECKSUM);
    assert.equal(status.tables, V5_TABLES.length);
    assert.equal(status.indexes, V5_INDEXES.length);
    assert.equal(status.endpoints, V5_ENDPOINTS.length);
    assert.equal(status.v1_compat, true);
    assert.equal(validateV5Schema(app.database).name, "v5-three-modules");
    assert.equal(app.database.prepare("SELECT COUNT(*) AS count FROM v5_topics WHERE system_key='unassigned'").get().count, 1);
    const tables = app.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'v5_%'").all();
    assert.equal(tables.length, V5_TABLES.length);
    const group = (await app.request("/api/v5/resources")).data.source_groups[0];
    const renamed = (await app.request(`/api/v5/resources/source-groups/${group.id}`, { method: "PUT", body: { name: `${group.name}-复核`, expected_updated_at: group.updated_at } })).data;
    assert.notEqual(renamed.updated_at, group.updated_at);
    const stale = await app.request(`/api/v5/resources/source-groups/${group.id}`, { method: "PUT", body: { name: "过期改名", expected_updated_at: group.updated_at }, expected: [409] });
    assert.equal(stale.error.code, "VERSION_CONFLICT");
  } finally { await app.close(); }
});

test("requirement document draft can be completed, previewed, created, and viewed from its task", async () => {
  const app = await fixture();
  try {
    const resources = (await app.request("/api/v5/resources")).data;
    const source = resources.source_groups[0]; const member = resources.members[0];
    const content = `# 集成测试组测控任务需求文档

## 1. 需求方填写

### 1.1 任务基本信息
| 字段 | 填写内容 |
| --- | --- |
| 项目名称（必填） | 导入验证项目 |
| 专题名称（可选） | 无专题 |
| 来源小组（必填） | ${source.name} |
| 任务名称（必填） | 文档导入任务 |
| 预计样品交付时间（必填） | 2099-03-01 |

### 1.2 制冷机安排
| 字段 | 填写内容 |
| --- | --- |
| 制冷机协调状态（必填） | 协调中 |
| 制冷机名称 |  |

### 1.3 测试目的
| 内容 | 填写内容 |
| --- | --- |
| 测试任务背景或重要性（必填） | 验证文档导入 |
| 测试目的（必填） | 验证自动建任务 |

### 1.4 样品信息
| 序号 | 样品类型（必填） | 样品型号（必填） | 数量说明（必填） | 样品编号 | 样品备注 |
| ---: | --- | --- | --- | --- | --- |
| 1 | 芯片 | IMPORT-01 | 1 件 | 待定 | 集成验证 |

### 1.5 测试对象
| 内容 | 填写内容 |
| --- | --- |
| 测试对象描述（必填） | 单芯片读出链路 |

### 1.6 主要测试项
| 序号 | 测试项名称（必填） | 需求方特别要求或预期输出 |
| ---: | --- | --- |
| 1 | 基础读出测试 | 输出测试记录 |

## 2. 集成测试组补充

### 2.1 任务排期
| 字段 | 填写内容 |
| --- | --- |
| 测试周期（天）（必填） |  |

### 2.2 测试准备与执行安排
| 项目 | 填写内容 |
| --- | --- |
| 测控负责人 | ${member.name} |
| 参与成员 | ${member.name} |

### 2.3 测试项验收标准
| 序号 | 测试项名称 | 验收标准或判定规则 | 集成测试组预期输出 |
| ---: | --- | --- | --- |
| 1 | 基础读出测试 | 能够完成读出 | 测试报告 |`;
    const uploaded = (await app.request("/api/v5/requirement-documents", { method: "POST", body: { file_name: "导入验证.md", content }, expected: [201] })).data;
    assert.equal(uploaded.status, "needs_completion"); assert.ok(uploaded.validation.errors.some((item) => item.field === "duration_days"));
    const completed = (await app.request(`/api/v5/requirement-drafts/${uploaded.id}`, { method: "PUT", body: { integration: { duration_days: "3", owner: member.name, members: member.name } } })).data;
    assert.equal(completed.status, "ready_for_confirmation");
    const preview = (await app.request(`/api/v5/requirement-drafts/${uploaded.id}/preview`, { method: "POST", body: {} })).data;
    assert.equal(preview.start_date, "2099-03-01"); assert.equal(preview.end_date, "2099-03-03"); assert.equal(preview.resolved_members[0].id, member.id);
    const created = (await app.request(`/api/v5/requirement-drafts/${uploaded.id}/create`, { method: "POST", body: { confirmation_token: preview.confirmation_token }, expected: [201] })).data;
    const task = (await app.request(`/api/v5/tasks/${created.task_id}`)).data;
    assert.equal(task.title, "文档导入任务"); assert.equal(task.samples.length, 1); assert.equal(task.test_items.length, 1); assert.equal(task.participants[0].id, member.id); assert.equal(task.requirement_document.file_name, "导入验证.md");
    const document = (await app.request(`/api/v5/tasks/${created.task_id}/requirement-document`)).data;
    assert.equal(document.content, content);
  } finally { await app.close(); }
});

test("V5 resource maintenance deletes unused resources and protects referenced resources", async () => {
  const app = await fixture();
  try {
    const resources = (await app.request("/api/v5/resources")).data;
    const createdGroup = (await app.request("/api/v5/resources/source-groups", { method: "POST", body: { name: "待删除来源小组" }, expected: [201] })).data;
    const staleDelete = await app.request(`/api/v5/resources/source-groups/${createdGroup.id}`, { method: "DELETE", body: { expected_updated_at: "stale", actor: "测试" }, expected: [409] });
    assert.equal(staleDelete.error.code, "VERSION_CONFLICT");
    const deletedGroup = await app.request(`/api/v5/resources/source-groups/${createdGroup.id}`, { method: "DELETE", body: { expected_updated_at: createdGroup.updated_at, actor: "测试" } });
    assert.equal(deletedGroup.data.deleted, true);
    assert.equal((await app.request("/api/v5/resources")).data.source_groups.some((row) => row.id === createdGroup.id), false);

    const createdCryostat = (await app.request("/api/v5/resources/cryostats", { method: "POST", body: { name: "待删除制冷机" }, expected: [201] })).data;
    const deletedCryostat = await app.request(`/api/v5/resources/cryostats/${createdCryostat.id}`, { method: "DELETE", body: { expected_updated_at: createdCryostat.updated_at, actor: "测试" } });
    assert.equal(deletedCryostat.data.deleted, true);

    const createdMember = (await app.request("/api/v5/resources/members", { method: "POST", body: { name: "待删除成员" }, expected: [201] })).data;
    const deletedMember = await app.request(`/api/v5/resources/members/${createdMember.id}`, { method: "DELETE", body: { expected_updated_at: createdMember.updated_at, actor: "测试" } });
    assert.equal(deletedMember.data.status, "inactive");
    assert.ok(deletedMember.data.deleted_at);

    const topic = (await app.request("/api/v5/topics", { method: "POST", body: { name: "资源引用保护专题" }, expected: [201] })).data;
    const source = resources.source_groups[0];
    const cryostat = resources.cryostats[0];
    const member = resources.members[0];
    const preview = (await app.request("/api/v5/tasks/preview", { method: "POST", body: { topic_id: topic.id, source_group_id: source.id, cryostat_id: cryostat.id, title: "引用资源的任务", participant_member_ids: [member.id] } })).data;
    await app.request("/api/v5/tasks", { method: "POST", body: { ...preview.normalized_input, preview_token: preview.preview_token }, expected: [201] });
    const protectedGroup = await app.request(`/api/v5/resources/source-groups/${source.id}`, { method: "DELETE", body: { expected_updated_at: source.updated_at }, expected: [409] });
    assert.equal(protectedGroup.error.code, "RESOURCE_IN_USE");
    const protectedCryostat = await app.request(`/api/v5/resources/cryostats/${cryostat.id}`, { method: "DELETE", body: { expected_updated_at: cryostat.updated_at }, expected: [409] });
    assert.equal(protectedCryostat.error.code, "RESOURCE_IN_USE");
  } finally { await app.close(); }
});

test("V5 member deletion directly soft-deletes members with current task ownership", async () => {
  const app = await fixture();
  try {
    const resources = (await app.request("/api/v5/resources")).data;
    const member = (await app.request("/api/v5/resources/members", { method: "POST", body: { name: "历史负责人" }, expected: [201] })).data;
    const stamp = new Date().toISOString();
    const topic = app.database.prepare("INSERT INTO v3_topics(source_group_id,name,purpose,created_at,updated_at) VALUES(?,?,?,?,?)").run(resources.source_groups[0].id, "成员删除保护专题", "验证成员删除", stamp, stamp);
    const topicId = Number(topic.lastInsertRowid);
    app.database.prepare("INSERT INTO v3_topic_tasks(topic_id,task_lineage_key,title,description,position,is_required,primary_member_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(topicId, "00000000-0000-0000-0000-000000000001", "当前负责人任务", "", 0, 1, member.id, stamp, stamp);
    const deleted = await app.request(`/api/v5/resources/members/${member.id}`, { method: "DELETE", body: { expected_updated_at: member.updated_at } });
    assert.ok(deleted.data.deleted_at);
    assert.equal(app.database.prepare("SELECT deleted_at FROM members WHERE id=?").get(member.id).deleted_at, deleted.data.deleted_at);
    assert.equal(app.database.prepare("SELECT primary_member_id FROM v3_topic_tasks WHERE topic_id=?").get(topicId).primary_member_id, member.id);
  } finally { await app.close(); }
});

test("V5 task editor persists canonical fields and computes the five user-facing states", async () => {
  const app = await fixture();
  try {
    const resources = (await app.request("/api/v5/resources")).data;
    const topic = (await app.request("/api/v5/topics", { method: "POST", body: { name: "测控专题", purpose: "验证样品测试窗口", notes: "V5" }, expected: [201] })).data;
    const sample = (await app.request("/api/v5/samples", { method: "POST", body: { planning_label: "Z4 型号样品", model: "Z4", eta_date: "2099-01-01" }, expected: [201] })).data;
    const input = { topic_id: topic.id, source_group_id: resources.source_groups[0].id, cryostat_id: resources.cryostats[0].id, title: "Q 值窗口测试", purpose: "确认低温窗口稳定性", notes: "先测 Q 值", color: "#2563eb", start_date: "2020-01-02", end_date: "2020-01-04", sample_ids: [sample.id], participant_member_ids: [resources.members[0].id], member_dates: [{ member_id: resources.members[0].id, start_date: "2020-01-02", end_date: "2020-01-04" }], test_items: [{ name: "Q 值测试", acceptance_criteria: "达到阈值" }] };
    const preview = (await app.request("/api/v5/tasks/preview", { method: "POST", body: input })).data;
    const created = (await app.request("/api/v5/tasks", { method: "POST", body: { ...preview.normalized_input, preview_token: preview.preview_token }, expected: [201] })).data;
    assert.equal(created.purpose, input.purpose);
    assert.equal(created.source_group.id, input.source_group_id);
    assert.equal(created.cryostat.id, input.cryostat_id);
    assert.equal(created.topic.purpose, "验证样品测试窗口");
    assert.equal(created.topic.notes, "V5");
    assert.ok(Object.hasOwn(created.source_group, "note"));
    assert.ok(Object.hasOwn(created.cryostat, "note"));
    assert.equal(created.samples[0].sample_no, null);
    assert.equal(created.test_items[0].name, "Q 值测试");
    assert.equal(created.status, "waiting");
    assert.equal((await app.request(`/api/v5/tasks/${created.id}`)).data.status, "waiting");
    await app.request(`/api/v5/samples/${sample.id}`, { method: "PUT", body: { eta_date: "2020-01-01", expected_version: sample.version } });
    const delayed = (await app.request(`/api/v5/tasks/${created.id}`)).data;
    assert.equal(delayed.status, "sample-delayed");
    const testing = (await app.request(`/api/v5/tasks/${created.id}/start-testing`, { method: "POST", body: { expected_version: created.version } })).data;
    assert.equal(testing.status, "test-delayed");
    const completed = (await app.request(`/api/v5/tasks/${created.id}/complete`, { method: "POST", body: { expected_version: testing.version } })).data;
    assert.equal(completed.status, "completed");
    const conflictPreview = (await app.request(`/api/v5/tasks/${created.id}/preview`, { method: "POST", body: { title: "过期编辑", expected_version: 1 } })).data;
    const conflict = await app.request(`/api/v5/tasks/${created.id}`, { method: "PUT", body: { ...conflictPreview.normalized_input, preview_token: conflictPreview.preview_token, expected_version: 1 }, expected: [409] });
    assert.equal(conflict.error.code, "VERSION_CONFLICT");
  } finally { await app.close(); }
});

test("V5 sample compatibility defaults the hidden planning label and uses the sample number for delivery status", async () => {
  const app = await fixture();
  try {
    const resources = (await app.request("/api/v5/resources")).data;
    const topic = (await app.request("/api/v5/topics", { method: "POST", body: { name: "样品字段兼容专题" }, expected: [201] })).data;
    const sample = (await app.request("/api/v5/samples", { method: "POST", body: { model: "QPU-COMPAT", eta_date: "2020-01-01", notes: "待补充编号" }, expected: [201] })).data;
    assert.equal(sample.planning_label, "QPU-COMPAT");
    assert.equal(sample.sample_no, null);
    assert.equal(sample.notes, "待补充编号");
    const preview = (await app.request("/api/v5/tasks/preview", { method: "POST", body: { topic_id: topic.id, title: "编号状态测试", sample_ids: [sample.id] } })).data;
    const task = (await app.request("/api/v5/tasks", { method: "POST", body: { ...preview.normalized_input, preview_token: preview.preview_token }, expected: [201] })).data;
    assert.equal(task.status, "sample-delayed");
    const taskEdit = (await app.request(`/api/v5/tasks/${task.id}/preview`, { method: "POST", body: { title: task.title, sample_ids: [sample.id], sample_updates: [{ sample_id: sample.id, model: "QPU-COMPAT-TASK", eta_date: "2020-01-01", eta_pending: false, notes: "任务编辑备注", expected_version: sample.version }], expected_version: task.version } })).data;
    const taskUpdated = (await app.request(`/api/v5/tasks/${task.id}`, { method: "PUT", body: { ...taskEdit.normalized_input, preview_token: taskEdit.preview_token, expected_version: task.version }, expected: [200] })).data;
    assert.equal(taskUpdated.samples[0].planning_label, "QPU-COMPAT-TASK");
    assert.equal(taskUpdated.samples[0].notes, "任务编辑备注");
    const updated = (await app.request(`/api/v5/samples/${sample.id}`, { method: "PUT", body: { sample_no: "QPU-COMPAT-01", notes: "已补录编号", expected_version: taskUpdated.samples[0].version } })).data;
    assert.equal(updated.planning_label, "QPU-COMPAT-TASK");
    assert.equal(updated.notes, "已补录编号");
    assert.equal((await app.request(`/api/v5/tasks/${task.id}`)).data.status, "waiting");
    const renamed = (await app.request(`/api/v5/samples/${sample.id}`, { method: "PUT", body: { model: "QPU-COMPAT-REV", sample_no: null, expected_version: updated.version } })).data;
    assert.equal(renamed.planning_label, "QPU-COMPAT-REV");
  } finally { await app.close(); }
});

test("V5 task-local sample records are created only when the task is saved and unlinking preserves the record", async () => {
  const app = await fixture();
  try {
    const topic = (await app.request("/api/v5/topics", { method: "POST", body: { name: "任务样品记录专题" }, expected: [201] })).data;
    const before = app.database.prepare("SELECT COUNT(*) AS count FROM v5_samples").get().count;
    const input = { topic_id: topic.id, title: "任务内新增样品", sample_ids: [], sample_creates: [{ model: "TASK-LOCAL-MODEL", sample_no: null, eta_date: "2099-03-01", eta_pending: false, notes: "仅属于当前任务的记录" }] };
    const preview = (await app.request("/api/v5/tasks/preview", { method: "POST", body: input })).data;
    assert.equal(app.database.prepare("SELECT COUNT(*) AS count FROM v5_samples").get().count, before);
    const task = (await app.request("/api/v5/tasks", { method: "POST", body: { ...preview.normalized_input, preview_token: preview.preview_token }, expected: [201] })).data;
    assert.equal(app.database.prepare("SELECT COUNT(*) AS count FROM v5_samples").get().count, before + 1);
    assert.equal(task.samples.length, 1);
    assert.equal(task.samples[0].model, "TASK-LOCAL-MODEL");
    const editPreview = (await app.request(`/api/v5/tasks/${task.id}/preview`, { method: "POST", body: { title: task.title, topic_id: topic.id, sample_ids: [], sample_creates: [], expected_version: task.version } })).data;
    const unlinked = (await app.request(`/api/v5/tasks/${task.id}`, { method: "PUT", body: { ...editPreview.normalized_input, preview_token: editPreview.preview_token, expected_version: task.version }, expected: [200] })).data;
    assert.equal(unlinked.samples.length, 0);
    assert.equal(app.database.prepare("SELECT COUNT(*) AS count FROM v5_samples").get().count, before + 1);
  } finally { await app.close(); }
});

test("V5 supports topic regrouping, member schedule synchronization, and execution load projections", async () => {
  const app = await fixture();
  try {
    const resources = (await app.request("/api/v5/resources")).data;
    const topicA = (await app.request("/api/v5/topics", { method: "POST", body: { name: "专题 A" }, expected: [201] })).data;
    const topicB = (await app.request("/api/v5/topics", { method: "POST", body: { name: "专题 B" }, expected: [201] })).data;
    const preview = (await app.request("/api/v5/tasks/preview", { method: "POST", body: { topic_id: topicA.id, title: "排期任务", start_date: "2099-02-01", end_date: "2099-02-03", participant_member_ids: [resources.members[0].id] } })).data;
    const task = (await app.request("/api/v5/tasks", { method: "POST", body: { ...preview.normalized_input, preview_token: preview.preview_token }, expected: [201] })).data;
    const moved = (await app.request(`/api/v5/topics/${topicA.id}/move-tasks`, { method: "POST", body: { target_topic_id: topicB.id, task_ids: [task.id] } })).data;
    assert.equal(moved.moved, 1);
    const schedulePreview = (await app.request(`/api/v5/tasks/${task.id}/schedule-preview`, { method: "POST", body: { start_date: "2099-02-04", end_date: "2099-02-06", sync_members: true } })).data;
    const rescheduled = (await app.request(`/api/v5/tasks/${task.id}/schedule`, { method: "POST", body: { start_date: "2099-02-04", end_date: "2099-02-06", sync_members: true, preview_token: schedulePreview.preview_token, expected_version: (await app.request(`/api/v5/tasks/${task.id}`)).data.version } })).data;
    assert.equal(rescheduled.participants[0].start_date, "2099-02-04");
    const currentTask = (await app.request(`/api/v5/tasks/${task.id}`)).data;
    const memberPreview = (await app.request(`/api/v5/tasks/${task.id}/member-schedule-preview`, { method: "POST", body: { member_id: resources.members[0].id, start_date: "2099-02-04", end_date: "2099-02-06" } })).data;
    const scheduled = (await app.request(`/api/v5/tasks/${task.id}/member-schedule`, { method: "POST", body: { member_id: resources.members[0].id, start_date: "2099-02-04", end_date: "2099-02-06", preview_token: memberPreview.preview_token, expected_version: currentTask.version, ack: true } })).data;
    assert.equal(scheduled.participants[0].start_date, "2099-02-04");
    const member = resources.members[0];
    const disabled = await app.request(`/api/v5/resources/members/${member.id}`, { method: "PUT", body: { name: member.name, status: "inactive", expected_updated_at: member.updated_at } });
    assert.equal(disabled.data.status, "inactive");
    const execution = (await app.request("/api/v5/execution?topic_id=" + topicB.id)).data;
    assert.equal(execution.items.length, 1);
    const memberLoad = execution.member_load.find((row) => row.id === member.id);
    assert.ok(memberLoad);
    assert.equal(memberLoad.task_count >= 1, true);
    const historicalTask = (await app.request(`/api/v5/tasks/${task.id}`)).data;
    const historicalEdit = (await app.request(`/api/v5/tasks/${task.id}/preview`, { method: "POST", body: { title: "停用成员仍可维护", participant_member_ids: [member.id], member_dates: [{ member_id: member.id, start_date: "2099-02-04", end_date: "2099-02-06" }], expected_version: historicalTask.version } })).data;
    const editedHistoricalTask = (await app.request(`/api/v5/tasks/${task.id}`, { method: "PUT", body: { title: "停用成员仍可维护", participant_member_ids: [member.id], member_dates: [{ member_id: member.id, start_date: "2099-02-04", end_date: "2099-02-06" }], preview_token: historicalEdit.preview_token, expected_version: historicalTask.version } })).data;
    assert.equal(editedHistoricalTask.title, "停用成员仍可维护");
    assert.equal(editedHistoricalTask.participants[0].id, member.id);
  } finally { await app.close(); }
});
