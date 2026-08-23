import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAppServer, initDatabase } from "../server.js";

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "team-task-v5-repair-"));
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

test("V5 repair API hides archived topics by default and exposes resource impact counts", async () => {
  const app = await fixture();
  try {
    const resources = (await app.request("/api/v5/resources")).data;
    assert.equal(typeof resources.source_groups[0].reference_count, "number");
    assert.equal(typeof resources.members[0].current_task_count, "number");
    assert.equal(typeof resources.cryostats[0].reference_count, "number");
    const topic = (await app.request("/api/v5/topics", { method: "POST", body: { name: "待归档专题" }, expected: [201] })).data;
    await app.request(`/api/v5/topics/${topic.id}`, { method: "PUT", body: { name: topic.name, status: "archived", expected_version: topic.version }, expected: [200] });
    assert.equal((await app.request("/api/v5/topics")).data.items.some((item) => item.id === topic.id), false);
    assert.equal((await app.request("/api/v5/topics?include_archived=1")).data.items.some((item) => item.id === topic.id), true);
  } finally { await app.close(); }
});

test("V5 repair API rejects duplicate sample updates before any task or sample write", async () => {
  const app = await fixture();
  try {
    const topic = (await app.request("/api/v5/topics", { method: "POST", body: { name: "原子保存专题" }, expected: [201] })).data;
    const sample = (await app.request("/api/v5/samples", { method: "POST", body: { planning_label: "原子保存样品", model: "Z4", eta_date: "2099-01-01" }, expected: [201] })).data;
    const input = { topic_id: topic.id, title: "原子保存任务", sample_ids: [sample.id] };
    const preview = (await app.request("/api/v5/tasks/preview", { method: "POST", body: input })).data;
    const created = (await app.request("/api/v5/tasks", { method: "POST", body: { ...preview.normalized_input, preview_token: preview.preview_token }, expected: [201] })).data;
    const currentTask = (await app.request(`/api/v5/tasks/${created.id}`)).data;
    const currentSample = (await app.request("/api/v5/samples")).data.items.find((item) => item.id === sample.id);
    const duplicate = { ...currentTask, sample_updates: [{ sample_id: sample.id, planning_label: "重复更新", model: "Z4", eta_date: "2099-01-02", eta_pending: false, expected_version: currentSample.version }, { sample_id: sample.id, planning_label: "重复更新 2", model: "Z4", eta_date: "2099-01-03", eta_pending: false, expected_version: currentSample.version }] };
    const invalid = await app.request(`/api/v5/tasks/${created.id}/preview`, { method: "POST", body: duplicate, expected: [400] });
    assert.equal(invalid.error.code, "VALIDATION_ERROR");
    assert.equal((await app.request(`/api/v5/tasks/${created.id}`)).data.version, currentTask.version);
    assert.equal((await app.request("/api/v5/samples")).data.items.find((item) => item.id === sample.id).version, currentSample.version);
  } finally { await app.close(); }
});
