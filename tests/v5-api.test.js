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
  const server = createAppServer(database);
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
    const execution = (await app.request("/api/v5/execution?topic_id=" + topicB.id)).data;
    assert.equal(execution.items.length, 1);
    assert.equal(execution.member_load[0].task_count >= 1, true);
  } finally { await app.close(); }
});
