import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAppServer, initDatabase } from "../src/server.js";

async function fixture({ bootstrap = false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "team-task-auth-"));
  const databasePath = path.join(dir, "team_tasks.sqlite");
  const previous = { username: process.env.AUTH_BOOTSTRAP_USERNAME, password: process.env.AUTH_BOOTSTRAP_PASSWORD };
  if (bootstrap) {
    process.env.AUTH_BOOTSTRAP_USERNAME = "admin";
    process.env.AUTH_BOOTSTRAP_PASSWORD = "Bootstrap-123456";
  } else {
    delete process.env.AUTH_BOOTSTRAP_USERNAME;
    delete process.env.AUTH_BOOTSTRAP_PASSWORD;
  }
  const database = await initDatabase(databasePath);
  if (previous.username === undefined) delete process.env.AUTH_BOOTSTRAP_USERNAME; else process.env.AUTH_BOOTSTRAP_USERNAME = previous.username;
  if (previous.password === undefined) delete process.env.AUTH_BOOTSTRAP_PASSWORD; else process.env.AUTH_BOOTSTRAP_PASSWORD = previous.password;
  const server = createAppServer(database);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, { method = "GET", body, rawBody, cookie, expected = [200] } = {}) => {
    const hasBody = rawBody !== undefined || body !== undefined;
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { ...(hasBody ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body)
    });
    const type = response.headers.get("content-type") || "";
    const payload = type.includes("application/json") ? await response.json() : await response.text();
    assert.ok(expected.includes(response.status), `${method} ${route}: ${response.status} ${JSON.stringify(payload)}`);
    return { response, payload, cookie: response.headers.get("set-cookie")?.split(";")[0] || null };
  };
  return { database, request, async close() { await new Promise((resolve) => server.close(resolve)); database.close(); await rm(dir, { recursive: true, force: true }); } };
}

test("未初始化时业务接口拒绝访问并公开初始化状态", async () => {
  const app = await fixture();
  try {
    const status = await app.request("/api/auth/bootstrap-status");
    assert.equal(status.payload.initialized, false);
    const denied = await app.request("/api/dashboard", { expected: [503] });
    assert.equal(denied.payload.code, "AUTH_NOT_INITIALIZED");
  } finally { await app.close(); }
});

test("管理员登录、首次改密、viewer 只读和管理员审计", async () => {
  const app = await fixture({ bootstrap: true });
  try {
    await app.request("/api/dashboard", { expected: [401] });
    await app.request("/api/auth/login", { method: "POST", body: { username: "admin", password: "wrong-password" }, expected: [401] });
    const malformedLogin = await app.request("/api/auth/login", { method: "POST", rawBody: "{", expected: [400] });
    assert.equal(malformedLogin.payload.code, "VALIDATION_ERROR");
    const login = await app.request("/api/auth/login", { method: "POST", body: { username: "admin", password: "Bootstrap-123456" } });
    assert.equal(login.payload.user.must_change_password, true);
    await app.request("/api/v5/topics", { cookie: login.cookie, expected: [403] });
    const changed = await app.request("/api/auth/change-password", { method: "POST", cookie: login.cookie, body: { current_password: "Bootstrap-123456", new_password: "Admin-Changed-123" } });
    assert.equal(changed.payload.user.must_change_password, false);
    const me = await app.request("/api/auth/me", { cookie: login.cookie });
    assert.equal(me.payload.user.role, "admin");

    const viewer = await app.request("/api/admin/users", { method: "POST", cookie: login.cookie, body: { username: "viewer", display_name: "普通用户", role: "viewer", temporary_password: "Viewer-Password-123" }, expected: [201] });
    assert.equal(viewer.payload.user.role, "viewer");
    const missingResetPassword = await app.request(`/api/admin/users/${viewer.payload.user.id}/reset-password`, { method: "POST", cookie: login.cookie, body: {}, expected: [400] });
    assert.equal(missingResetPassword.payload.code, "VALIDATION_ERROR");
    const topic = await app.request("/api/v5/topics", { method: "POST", cookie: login.cookie, body: { name: "审计专题", purpose: "测试认证", actor: "伪造操作者" }, expected: [201] });
    const event = app.database.prepare("SELECT actor FROM v5_events WHERE event_type='topic_create' ORDER BY id DESC LIMIT 1").get();
    assert.equal(event.actor, "admin");
    assert.ok(topic.payload.data?.id);
    const taskPreview = await app.request("/api/v5/tasks/preview", { method: "POST", cookie: login.cookie, body: { topic_id: topic.payload.data.id, title: "普通用户可查看的任务", sample_ids: [] } });
    const task = await app.request("/api/v5/tasks", { method: "POST", cookie: login.cookie, body: { ...taskPreview.payload.data.normalized_input, preview_token: taskPreview.payload.data.preview_token }, expected: [201] });
    assert.ok(task.payload.data?.id);
    const audit = await app.request("/api/admin/audit-log", { cookie: login.cookie });
    const topicAudit = audit.payload.items.find((row) => row.action === "POST /api/v5/topics" && row.username === "admin");
    assert.equal(topicAudit.target_type, "v5_topic");
    assert.ok(topicAudit.after_json);

    await app.request(`/api/admin/users/${me.payload.user.id}`, { method: "PUT", cookie: login.cookie, body: { is_active: 0 }, expected: [409] });
    await app.request(`/api/admin/users/${me.payload.user.id}`, { method: "PUT", cookie: login.cookie, body: { is_active: null }, expected: [400] });

    const viewerLogin = await app.request("/api/auth/login", { method: "POST", body: { username: "viewer", password: "Viewer-Password-123" } });
    await app.request("/api/auth/change-password", { method: "POST", cookie: viewerLogin.cookie, body: { current_password: "Viewer-Password-123", new_password: "Viewer-Changed-123" } });
    await app.request("/api/v5/topics", { cookie: viewerLogin.cookie });
    const viewerTaskDetail = await app.request(`/api/v5/tasks/${task.payload.data.id}`, { cookie: viewerLogin.cookie });
    assert.equal(viewerTaskDetail.payload.data.title, "普通用户可查看的任务");
    await app.request("/api/v5/topics", { method: "POST", cookie: viewerLogin.cookie, body: { name: "不应创建" }, expected: [403] });
    await app.request("/api/admin/users", { cookie: viewerLogin.cookie, expected: [403] });
    const csv = await app.request("/api/export/tasks.csv", { cookie: viewerLogin.cookie });
    assert.equal(csv.response.status, 200);
    await app.request("/api/admin/audit-log", { cookie: viewerLogin.cookie, expected: [403] });

    await app.request(`/api/admin/users/${viewer.payload.user.id}/disable`, { method: "POST", cookie: login.cookie, body: {}, expected: [200] });
    await app.request("/api/v5/topics", { cookie: viewerLogin.cookie, expected: [401] });
    assert.ok(app.database.prepare("SELECT COUNT(*) AS count FROM audit_log").get().count >= 3);
  } finally { await app.close(); }
});

test("viewer GET 不会初始化或写入默认资源", async () => {
  const app = await fixture({ bootstrap: true });
  try {
    const login = await app.request("/api/auth/login", { method: "POST", body: { username: "admin", password: "Bootstrap-123456" } });
    await app.request("/api/auth/change-password", { method: "POST", cookie: login.cookie, body: { current_password: "Bootstrap-123456", new_password: "Admin-Changed-123" } });
    const viewer = await app.request("/api/admin/users", { method: "POST", cookie: login.cookie, body: { username: "reader", display_name: "读取用户", role: "viewer", temporary_password: "Reader-Password-123" }, expected: [201] });
    const viewerLogin = await app.request("/api/auth/login", { method: "POST", body: { username: "reader", password: "Reader-Password-123" } });
    await app.request("/api/auth/change-password", { method: "POST", cookie: viewerLogin.cookie, body: { current_password: "Reader-Password-123", new_password: "Reader-Changed-123" } });

    app.database.exec("DELETE FROM v2_source_contacts; DELETE FROM v2_source_groups; DELETE FROM v2_cryostats;");
    const count = (table) => app.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    const before = { groups: count("v2_source_groups"), cryostats: count("v2_cryostats") };
    await app.request("/api/v3/status", { cookie: viewerLogin.cookie });
    await app.request("/api/v3/topics", { cookie: viewerLogin.cookie });
    await app.request("/api/v5/resources", { cookie: viewerLogin.cookie });
    const after = { groups: count("v2_source_groups"), cryostats: count("v2_cryostats") };
    assert.deepEqual(after, before);
    assert.equal(viewer.payload.user.role, "viewer");
  } finally { await app.close(); }
});

test("认证用户写入 V2 事件且不接受客户端操作者伪造", async () => {
  const app = await fixture({ bootstrap: true });
  try {
    const login = await app.request("/api/auth/login", { method: "POST", body: { username: "admin", password: "Bootstrap-123456" } });
    await app.request("/api/auth/change-password", { method: "POST", cookie: login.cookie, body: { current_password: "Bootstrap-123456", new_password: "Admin-Changed-123" } });
    const group = await app.request("/api/v2/source-groups", { method: "POST", cookie: login.cookie, body: { name: "认证来源组", note: "测试" }, expected: [201] });
    await app.request("/api/v2/plans", {
      method: "POST",
      cookie: login.cookie,
      expected: [201],
      body: {
        source_group_id: group.payload.data.id,
        counterpart_contact_id: null,
        local_liaison_name: "本地",
        name: "认证计划",
        purpose: "审计操作者",
        sample_model: "样品",
        sample_identifier: null,
        identifier_kind: null,
        current_eta_date: null,
        eta_pending: true,
        cryostat_id: null,
        cryostat_pending: true,
        project_tag: null,
        topic_tag: null,
        test_items: [{ title: "基础测试", description: "", acceptance_criteria: "通过", is_required: true, position: 0 }],
        acceptance_template: { name: "基础验收", items: [{ label: "完成", position: 0 }] },
        actor_label: "伪造操作者"
      }
    });
    const event = app.database.prepare("SELECT actor_label FROM v2_plan_events ORDER BY id DESC LIMIT 1").get();
    assert.equal(event.actor_label, "admin");
  } finally { await app.close(); }
});
