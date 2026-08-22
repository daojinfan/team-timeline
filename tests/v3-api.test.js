import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAppServer, initDatabase } from "../src/server.js";
import { V3_ENDPOINTS, V3_INDEXES, V3_SCHEMA_CHECKSUM, V3_TABLES } from "../src/v3/index.js";

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "team-task-v3-"));
  const database = await initDatabase(path.join(dir, "team_tasks.sqlite"));
  const server = createAppServer(database);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, { method = "GET", body, expected = [200] } = {}) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json();
    assert.ok(expected.includes(response.status), `${method} ${route}: ${response.status} ${JSON.stringify(payload)}`);
    return { response, payload };
  };
  return { database, request, async close() { await new Promise((resolve) => server.close(resolve)); database.close(); await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } };
}

test("V3 schema and endpoint surface are exact and re-open idempotently", async () => {
  const app = await fixture();
  try {
    assert.equal(V3_TABLES.length, 13);
    assert.equal(V3_INDEXES.length, 14);
    assert.equal(V3_ENDPOINTS.length, 34);
    const status = (await app.request("/api/v3/status")).payload.data;
    assert.deepEqual({ schema_version: status.schema_version, checksum: status.checksum, tables: status.tables, indexes: status.indexes, endpoints: status.endpoints }, { schema_version: 3, checksum: V3_SCHEMA_CHECKSUM, tables: 13, indexes: 14, endpoints: 34 });
    const names = app.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'v3_%'").all().map((row) => row.name);
    assert.equal(names.length, 13);
    const resources = (await app.request("/api/v3/topics")).payload.data;
    assert.deepEqual(resources.groups.map((item) => item.name), ["工艺组", "电子学组", "读取组", "量子门组"]);
    assert.deepEqual(resources.cryostats.map((item) => item.name), ["Z4.1", "合肥号", "重庆号"]);
  } finally { await app.close(); }
});

test("V3.1 task details expose topic context and persist structured test intent", async () => {
  const app = await fixture();
  try {
    const resources = (await app.request("/api/v3/topics")).payload.data;
    const member = app.database.prepare("SELECT id FROM members WHERE deleted_at IS NULL ORDER BY id LIMIT 1").get();
    const topic = (await app.request("/api/v3/topics", { method: "POST", body: { source_group_id: resources.groups[0].id, name: "任务详情专题", purpose: "验证低温测控工艺窗口" }, expected: [201] })).payload.data;
    const sample = (await app.request(`/api/v3/topics/${topic.id}/samples`, { method: "POST", body: { planning_label: "详情样品", model: "QPU-X", eta_date: "2026-09-01" }, expected: [201] })).payload.data;
    const input = { title: "低温窗口测试", description: "补充说明", test_purpose: "验证不同温区下的 Q 值稳定性", test_items: [{ name: "Q 值测试", acceptance_criteria: "达到目标阈值", is_required: 1 }, { name: "读取链路验证", acceptance_criteria: "链路无异常", is_required: 0 }], sample_ids: [sample.id], position: 0, primary_member_id: member.id, participant_member_ids: [], member_efforts: [{ member_id: member.id, planned_half_hours: 2 }], cryostat_pending: 1, cryostat_id: null, start_date: "2026-09-01", end_date: "2026-09-02", after_arrival: 0 };
    const preview = (await app.request(`/api/v3/topics/${topic.id}/tasks/preview`, { method: "POST", body: input })).payload.data;
    const created = (await app.request(`/api/v3/topics/${topic.id}/tasks`, { method: "POST", body: { ...preview.normalized_input, preview_token: preview.preview_token, ack: true }, expected: [201] })).payload.data;
    assert.equal(created.test_purpose, input.test_purpose);
    assert.deepEqual(created.test_items.map((item) => item.name), ["Q 值测试", "读取链路验证"]);
    assert.deepEqual(created.topic, { id: topic.id, name: topic.name, purpose: topic.purpose });
    assert.deepEqual(created.source_group, { id: resources.groups[0].id, name: resources.groups[0].name });
    assert.equal(created.cryostat, null);
    const updatedInput = { ...input, test_purpose: "确认窗口和链路稳定性", test_items: [{ name: "重复性测试", acceptance_criteria: "三轮结果一致", is_required: 1 }], expected_version: created.version };
    const updatedPreview = (await app.request(`/api/v3/topic-tasks/${created.id}/preview`, { method: "POST", body: updatedInput })).payload.data;
    const updated = (await app.request(`/api/v3/topic-tasks/${created.id}`, { method: "PUT", body: { ...updatedInput, preview_token: updatedPreview.preview_token, ack: true }, expected: [200] })).payload.data;
    assert.equal(updated.test_purpose, updatedInput.test_purpose);
    assert.deepEqual(updated.test_items.map((item) => item.name), ["重复性测试"]);
    assert.equal(app.database.prepare("SELECT test_purpose FROM v3_topic_tasks WHERE id=?").get(created.id).test_purpose, updatedInput.test_purpose);
  } finally { await app.close(); }
});

test("V3 topic source updates enforce contact ownership and sample initial ETA persists", async () => {
  const app = await fixture();
  try {
    const sourceA = (await app.request("/api/v2/source-groups", { method: "POST", body: { name: "来源 A" }, expected: [201] })).payload.data;
    const sourceB = (await app.request("/api/v2/source-groups", { method: "POST", body: { name: "来源 B" }, expected: [201] })).payload.data;
    const contactA = (await app.request(`/api/v2/source-groups/${sourceA.id}/contacts`, { method: "POST", body: { name: "A 负责人" }, expected: [201] })).payload.data;
    const contactB = (await app.request(`/api/v2/source-groups/${sourceB.id}/contacts`, { method: "POST", body: { name: "B 负责人" }, expected: [201] })).payload.data;
    const topic = (await app.request("/api/v3/topics", { method: "POST", body: { source_group_id: sourceA.id, source_contact_id: contactA.id, name: "来源变更专题", purpose: "验证来源迁移" }, expected: [201] })).payload.data;
    const moved = (await app.request(`/api/v3/topics/${topic.id}`, { method: "PUT", body: { source_group_id: sourceB.id, source_contact_id: contactB.id, expected_version: topic.version }, expected: [200] })).payload.data;
    assert.equal(moved.source_group_id, sourceB.id);
    assert.equal(moved.source_contact_id, contactB.id);
    const invalid = await app.request(`/api/v3/topics/${topic.id}`, { method: "PUT", body: { source_group_id: sourceA.id, source_contact_id: contactB.id, expected_version: moved.version }, expected: [400] });
    assert.equal(invalid.payload.error.code, "VALIDATION_ERROR");
    const legacyContactOnly = (await app.request(`/api/v3/topics/${topic.id}`, { method: "PUT", body: { source_contact_id: contactB.id, expected_version: moved.version }, expected: [200] })).payload.data;
    assert.equal(legacyContactOnly.source_group_id, sourceB.id);
    const sample = (await app.request(`/api/v3/topics/${topic.id}/samples`, { method: "POST", body: { planning_label: "初始 ETA 样品", model: "QPU-ETA", initial_eta_date: "2026-09-01", eta_date: "2026-09-10", eta_pending: 0 }, expected: [201] })).payload.data;
    assert.equal(sample.initial_eta_date, "2026-09-01");
    const updatedSample = (await app.request(`/api/v3/samples/${sample.id}`, { method: "PUT", body: { initial_eta_date: "2026-08-28", expected_version: sample.version }, expected: [200] })).payload.data;
    assert.equal(updatedSample.initial_eta_date, "2026-08-28");
    assert.equal(updatedSample.current_eta_date, "2026-09-10");
  } finally { await app.close(); }
});

test("topic, sample, task-chain, assignment and exact-set submission flow", async () => {
  const app = await fixture();
  try {
    const group = (await app.request("/api/v2/source-groups", { method: "POST", body: { name: "V3 来源组" }, expected: [201] })).payload.data;
    const contact = (await app.request(`/api/v2/source-groups/${group.id}/contacts`, { method: "POST", body: { name: "负责人" }, expected: [201] })).payload.data;
    const member = app.database.prepare("SELECT id FROM members WHERE deleted_at IS NULL ORDER BY id LIMIT 1").get();
    const topic = (await app.request("/api/v3/topics", { method: "POST", body: { source_group_id: group.id, source_contact_id: contact.id, name: "专题一", purpose: "测试" }, expected: [201] })).payload.data;
    const sample = (await app.request(`/api/v3/topics/${topic.id}/samples`, { method: "POST", body: { planning_label: "样品 A", model: "X-1", eta_date: "2026-09-01", eta_pending: 0 }, expected: [201] })).payload.data;
    const taskInput = { title: "首个任务", description: "任务说明", sample_ids: [sample.id], position: 0, primary_member_id: member.id, participant_member_ids: [], member_efforts: [{ member_id: member.id, planned_half_hours: 2 }], cryostat_pending: 1, cryostat_id: null, start_date: "2026-09-01", end_date: "2026-09-02", after_arrival: 1 };
    const preview = (await app.request(`/api/v3/topics/${topic.id}/tasks/preview`, { method: "POST", body: taskInput })).payload.data;
    const task = (await app.request(`/api/v3/topics/${topic.id}/tasks`, { method: "POST", body: { ...preview.normalized_input, preview_token: preview.preview_token, ack: true, actor: "本地用户" }, expected: [201] })).payload.data;
    assert.equal(task.samples.length, 1);
    assert.equal(task.is_required, 1);
    const selfPreview = (await app.request(`/api/v3/topic-tasks/${task.id}/preview`, { method: "POST", body: { ...taskInput, expected_version: task.version } })).payload.data;
    assert.equal(selfPreview.conflicts.some((item) => item.type === "MEMBER_DATE_OVERLAP" && item.topic_id == null && item.task_id === task.task_id), false);

    const optionalInput = { ...taskInput, title: "可选复测", position: 1, is_required: 0 };
    const optionalPreview = (await app.request(`/api/v3/topics/${topic.id}/tasks/preview`, { method: "POST", body: optionalInput })).payload.data;
    const optionalTask = (await app.request(`/api/v3/topics/${topic.id}/tasks`, { method: "POST", body: { ...optionalPreview.normalized_input, preview_token: optionalPreview.preview_token, ack: true, actor: "本地用户" }, expected: [201] })).payload.data;
    assert.equal(optionalTask.is_required, 0);
    const dependencyInput = { ...optionalInput, predecessor_task_id: task.id, expected_version: optionalTask.version };
    const dependencyPreview = (await app.request(`/api/v3/topic-tasks/${optionalTask.id}/preview`, { method: "POST", body: dependencyInput })).payload.data;
    const updatedOptionalTask = (await app.request(`/api/v3/topic-tasks/${optionalTask.id}`, { method: "PUT", body: { ...dependencyInput, preview_token: dependencyPreview.preview_token, ack: true, actor: "本地用户" } })).payload.data;
    assert.equal(updatedOptionalTask.is_required, 0);
    const dependency = app.database.prepare("SELECT predecessor_task_id,successor_task_id FROM v3_task_dependencies WHERE successor_task_id=?").get(optionalTask.id);
    assert.equal(dependency.predecessor_task_id, task.id);
    assert.equal(dependency.successor_task_id, optionalTask.id);
    const template = (await app.request(`/api/v3/topics/${topic.id}/acceptance-template`, { method: "PUT", body: { name: "默认", items: [{ position: 0, label: "检查" }] } })).payload.data;
    const item = template.items[0];
    const submission = (await app.request(`/api/v3/tasks/${task.id}/submissions`, { method: "POST", body: { sample_ids: [sample.id], description: "结果", resource_url: "file:///result.txt", submitted_by: "本地用户", template_item_ids: [{ id: item.id, checked: true }] }, expected: [201] })).payload.data;
    const reviewed = (await app.request(`/api/v3/submissions/${submission.id}/review`, { method: "POST", body: { decision: "accepted", reviewer: "本地用户", checked_items: [{ id: item.id, passed: true }] } })).payload.data;
    assert.equal(reviewed.status, "accepted");
    assert.equal(app.database.prepare("SELECT status FROM tasks WHERE id=?").get(task.task_id)?.status, "completed");
    const bad = await app.request(`/api/v3/tasks/${task.id}/submissions`, { method: "POST", body: { sample_ids: [], description: "bad", resource_url: "file:///bad", submitted_by: "本地用户", template_item_ids: [{ id: item.id, checked: true }] }, expected: [400] });
    assert.equal(bad.payload.error.code, "SAMPLE_SET_MISMATCH");
  } finally { await app.close(); }
});

test("cryostat preview warns only for overlapping tasks in another active topic", async () => {
  const app = await fixture();
  try {
    const resources = (await app.request("/api/v3/topics")).payload.data;
    const members = app.database.prepare("SELECT id FROM members WHERE deleted_at IS NULL ORDER BY id").all();
    const topicA = (await app.request("/api/v3/topics", { method: "POST", body: { source_group_id: resources.groups[0].id, name: "专题 A", purpose: "冷机冲突测试" }, expected: [201] })).payload.data;
    const topicB = (await app.request("/api/v3/topics", { method: "POST", body: { source_group_id: resources.groups[1].id, name: "专题 B", purpose: "冷机冲突测试" }, expected: [201] })).payload.data;
    const sampleA = (await app.request(`/api/v3/topics/${topicA.id}/samples`, { method: "POST", body: { planning_label: "A-样品", model: "A", eta_date: "2026-09-01" }, expected: [201] })).payload.data;
    const sampleB = (await app.request(`/api/v3/topics/${topicB.id}/samples`, { method: "POST", body: { planning_label: "B-样品", model: "B", eta_date: "2026-09-01" }, expected: [201] })).payload.data;
    const cryostat = resources.cryostats[0];
    const pendingInput = { title: "专题 A 任务", description: "", sample_ids: [sampleA.id], position: 0, primary_member_id: members[0].id, participant_member_ids: [], member_efforts: [{ member_id: members[0].id, planned_half_hours: 2 }], cryostat_id: null, cryostat_pending: 1, start_date: "2026-09-01", end_date: "2026-09-02", after_arrival: 0 };
    const pendingPreview = (await app.request(`/api/v3/topics/${topicA.id}/tasks/preview`, { method: "POST", body: pendingInput })).payload.data;
    const taskA = (await app.request(`/api/v3/topics/${topicA.id}/tasks`, { method: "POST", body: { ...pendingPreview.normalized_input, preview_token: pendingPreview.preview_token, ack: true }, expected: [201] })).payload.data;
    const taskInput = { title: "专题 B 任务", description: "", sample_ids: [sampleB.id], position: 0, primary_member_id: members[1].id, participant_member_ids: [], member_efforts: [{ member_id: members[1].id, planned_half_hours: 2 }], cryostat_id: cryostat.id, cryostat_pending: 0, start_date: "2026-09-01", end_date: "2026-09-02", after_arrival: 0 };
    const taskPreview = (await app.request(`/api/v3/topics/${topicB.id}/tasks/preview`, { method: "POST", body: taskInput })).payload.data;
    await app.request(`/api/v3/topics/${topicB.id}/tasks`, { method: "POST", body: { ...taskPreview.normalized_input, preview_token: taskPreview.preview_token, ack: true }, expected: [201] });
    const conflict = (await app.request(`/api/v3/topics/${topicA.id}/cryostat/preview`, { method: "POST", body: { new_cryostat_id: cryostat.id, cryostat_pending: 0, task_ids: [taskA.id] } })).payload.data;
    assert.equal(conflict.conflicts.length, 1);
    assert.equal(conflict.conflicts[0].type, "CRYOSTAT_DATE_OVERLAP");
    assert.equal(conflict.conflicts[0].candidate_task_id, taskA.id);
  } finally { await app.close(); }
});
