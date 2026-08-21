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
