import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { createAppServer, initDatabase, V2_ENDPOINTS, V2_SCHEMA_CHECKSUM } from "../src/server.js";

const V2_TABLES = [
  "app_schema_versions",
  "v2_acceptance_reviews",
  "v2_acceptance_template_items",
  "v2_acceptance_templates",
  "v2_control_plans",
  "v2_cryostats",
  "v2_deliverable_submissions",
  "v2_plan_events",
  "v2_plan_tasks",
  "v2_source_contacts",
  "v2_source_groups",
  "v2_test_items"
].sort();

const V2_INDEXES = [
  "idx_v2_contacts_group",
  "idx_v2_events_plan",
  "idx_v2_one_active_template",
  "idx_v2_plan_tasks_plan",
  "idx_v2_plan_tasks_primary",
  "idx_v2_plans_cryostat",
  "idx_v2_plans_eta",
  "idx_v2_plans_source",
  "idx_v2_submissions_plan",
  "idx_v2_test_items_plan"
].sort();

const EXPECTED_V2_ENDPOINTS = `
GET /api/v2/status
GET /api/v2/source-groups
POST /api/v2/source-groups
PUT /api/v2/source-groups/:id
GET /api/v2/source-groups/:id/contacts
POST /api/v2/source-groups/:id/contacts
PUT /api/v2/source-contacts/:id
GET /api/v2/cryostats
POST /api/v2/cryostats
PUT /api/v2/cryostats/:id
GET /api/v2/plans
POST /api/v2/plans
GET /api/v2/plans/:id
PUT /api/v2/plans/:id
POST /api/v2/plans/:id/archive
POST /api/v2/plans/:id/restore
POST /api/v2/plans/:id/arrival
POST /api/v2/plans/:id/test-items
PUT /api/v2/test-items/:id
GET /api/v2/plans/:id/acceptance-template
PUT /api/v2/plans/:id/acceptance-template
GET /api/v2/plans/:id/events
GET /api/v2/backup
POST /api/v2/plans/:id/eta/preview
POST /api/v2/plans/:id/eta/confirm
POST /api/v2/plans/:id/cryostat/preview
POST /api/v2/plans/:id/cryostat/confirm
POST /api/v2/plans/:id/tasks/preview
POST /api/v2/plans/:id/tasks
POST /api/v2/plan-tasks/:task_id/preview
PUT /api/v2/plan-tasks/:task_id
GET /api/v2/plans/:id/submissions
POST /api/v2/tasks/:task_id/submissions
POST /api/v2/submissions/:id/review
`.trim().split("\n");

function addDays(date, amount) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(year, month - 1, day);
  next.setDate(next.getDate() + amount);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "team-task-v2-"));
  const databasePath = path.join(dir, "team_tasks.sqlite");
  const database = await initDatabase(databasePath);
  const server = createAppServer(database);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, { method = "GET", body, expected = [200] } = {}) => {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json();
    assert.ok(expected.includes(response.status), `${method} ${route}: ${response.status} ${JSON.stringify(payload)}`);
    return { status: response.status, payload, headers: response.headers };
  };
  return {
    dir,
    databasePath,
    database,
    request,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      database.close();
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  };
}

async function createPlanFixture(app) {
  const today = (await app.request("/api/dashboard")).payload.today;
  const members = (await app.request("/api/members")).payload;
  const group = (await app.request("/api/v2/source-groups", { method: "POST", body: { name: "量子器件组", note: "来源" }, expected: [201] })).payload.data;
  const contact = (await app.request(`/api/v2/source-groups/${group.id}/contacts`, { method: "POST", body: { name: "张老师", title: "负责人", contact_text: "ext-1" }, expected: [201] })).payload.data;
  const cryostat = (await app.request("/api/v2/cryostats", { method: "POST", body: { name: "DR-1", note: "主机" }, expected: [201] })).payload.data;
  const secondCryostat = (await app.request("/api/v2/cryostats", { method: "POST", body: { name: "DR-2", note: "备用" }, expected: [201] })).payload.data;
  const plan = (await app.request("/api/v2/plans", {
    method: "POST",
    expected: [201],
    body: {
      source_group_id: group.id,
      counterpart_contact_id: contact.id,
      local_liaison_name: "本地用户",
      name: "QPU-A 测控计划",
      purpose: "验证基础参数",
      sample_model: "QPU-A",
      sample_identifier: null,
      identifier_kind: null,
      current_eta_date: addDays(today, 10),
      eta_pending: false,
      cryostat_id: cryostat.id,
      cryostat_pending: false,
      project_tag: "项目甲",
      topic_tag: "谱学",
      test_items: [{ title: "基础谱测量", description: "", acceptance_criteria: "结果可复核", is_required: true, position: 0 }],
      acceptance_template: { name: "计划验收清单", items: [{ label: "结果链接可访问", position: 0 }] },
      actor_label: "本地用户"
    }
  })).payload.data;
  return { today, members, group, contact, cryostat, secondCryostat, plan };
}

async function createPlanTask(app, state, overrides = {}) {
  const input = {
    test_item_id: state.plan.test_items[0].id,
    title: "到样后基础谱测量",
    description: "人工分配",
    primary_member_id: state.members[0].id,
    collaborator_member_ids: [state.members[1].id],
    start_date: addDays(state.today, 11),
    end_date: addDays(state.today, 13),
    estimated_hours: 8,
    after_arrival: true,
    expected_version: state.plan.version,
    ...overrides
  };
  const preview = (await app.request(`/api/v2/plans/${state.plan.id}/tasks/preview`, { method: "POST", body: input })).payload.data;
  const confirmed = (await app.request(`/api/v2/plans/${state.plan.id}/tasks`, {
    method: "POST",
    expected: [201],
    body: { ...input, preview_token: preview.preview_token, acknowledged_conflict_codes: [...new Set(preview.conflicts.map((item) => item.code))], actor_label: "本地用户" }
  })).payload.data;
  state.plan = (await app.request(`/api/v2/plans/${state.plan.id}`)).payload.data;
  return confirmed;
}

test("V2 schema is exactly version 2 with 12 tables and 10 indexes", async () => {
  const app = await fixture();
  try {
    const tables = app.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name='app_schema_versions' OR name LIKE 'v2_%') ORDER BY name").all().map((row) => row.name);
    const indexes = app.database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_v2_%' ORDER BY name").all().map((row) => row.name);
    assert.deepEqual(tables, V2_TABLES);
    assert.deepEqual(indexes, V2_INDEXES);
    const version = app.database.prepare("SELECT version,name,checksum FROM app_schema_versions").get();
    assert.equal(version.version, 2);
    assert.equal(version.name, "v2-control-plan");
    assert.equal(version.checksum, V2_SCHEMA_CHECKSUM);
    const status = (await app.request("/api/v2/status")).payload.data;
    assert.equal(status.schema_version, 2);
    assert.equal(status.checksum, V2_SCHEMA_CHECKSUM);
    assert.equal(status.quick_check, "ok");
    assert.equal(status.foreign_key_violations, 0);
  } finally {
    await app.close();
  }
});

test("the guarded V2 endpoint surface is the exact frozen set of 34 method-path pairs", () => {
  assert.equal(V2_ENDPOINTS.length, 34);
  assert.equal(new Set(V2_ENDPOINTS).size, 34);
  assert.deepEqual([...V2_ENDPOINTS], EXPECTED_V2_ENDPOINTS);
});

test("a real V1-shaped database is backed up, migrated once, and reopened idempotently", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "team-task-v1-migration-"));
  const databasePath = path.join(dir, "team_tasks.sqlite");
  try {
    const initial = await initDatabase(databasePath);
    const taskCount = initial.prepare("SELECT COUNT(*) count FROM tasks").get().count;
    initial.exec("PRAGMA foreign_keys=OFF");
    for (const table of V2_TABLES.filter((name) => name !== "app_schema_versions")) initial.exec(`DROP TABLE ${table}`);
    initial.exec("DROP TABLE app_schema_versions");
    initial.close();

    const migrated = await initDatabase(databasePath);
    assert.equal(migrated.prepare("SELECT COUNT(*) count FROM tasks").get().count, taskCount);
    assert.equal(migrated.prepare("SELECT checksum FROM app_schema_versions WHERE version=2").get().checksum, V2_SCHEMA_CHECKSUM);
    assert.equal(migrated.prepare("PRAGMA quick_check").get().quick_check, "ok");
    migrated.close();

    const backupDir = path.join(dir, "backups");
    const backupsAfterMigration = (await readdir(backupDir)).filter((name) => name.endsWith(".sqlite"));
    assert.equal(backupsAfterMigration.length, 1);
    const backup = new DatabaseSync(path.join(backupDir, backupsAfterMigration[0]), { readOnly: true });
    assert.equal(backup.prepare("PRAGMA quick_check").get().quick_check, "ok");
    assert.equal(backup.prepare("SELECT COUNT(*) count FROM tasks").get().count, taskCount);
    assert.equal(backup.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name LIKE 'v2_%'").get().count, 0);
    backup.close();

    const reopened = await initDatabase(databasePath);
    reopened.close();
    assert.equal((await readdir(backupDir)).filter((name) => name.endsWith(".sqlite")).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test("checksum mismatch refuses startup without rewriting the database", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "team-task-v2-mismatch-"));
  const databasePath = path.join(dir, "team_tasks.sqlite");
  try {
    const database = await initDatabase(databasePath);
    const badChecksum = "0".repeat(64);
    database.prepare("UPDATE app_schema_versions SET checksum=? WHERE version=2").run(badChecksum);
    database.close();
    const serverModule = new URL("../src/server.js", import.meta.url).href;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { initDatabase } from ${JSON.stringify(serverModule)};
      try { await initDatabase(${JSON.stringify(databasePath)}); process.exit(0); }
      catch (error) { console.error(error.message); process.exit(42); }
    `], { encoding: "utf8" });
    assert.equal(child.status, 42, child.stderr);
    assert.match(child.stderr, /checksum mismatch/i);
    const inspection = new DatabaseSync(databasePath);
    assert.equal(inspection.prepare("SELECT checksum FROM app_schema_versions WHERE version=2").get().checksum, badChecksum);
    inspection.close();
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test("resource, plan, test-item, template, event, archive, arrival, and backup APIs preserve canonical contracts", async () => {
  const app = await fixture();
  try {
    const state = await createPlanFixture(app);

    const groups = await app.request("/api/v2/source-groups?include_inactive=1&sort=name_asc");
    assert.equal(groups.payload.meta.total, 1);
    const updatedGroup = (await app.request(`/api/v2/source-groups/${state.group.id}`, {
      method: "PUT",
      body: { name: "量子器件组", note: "已复核", is_active: true, expected_updated_at: state.group.updated_at }
    })).payload.data;
    assert.equal(updatedGroup.note, "已复核");

    const contacts = await app.request(`/api/v2/source-groups/${state.group.id}/contacts?include_inactive=1`);
    assert.equal(contacts.payload.meta.total, 1);
    const updatedContact = (await app.request(`/api/v2/source-contacts/${state.contact.id}`, {
      method: "PUT",
      body: { name: "张老师", title: "对方负责人", contact_text: "ext-2", is_active: true, expected_updated_at: state.contact.updated_at }
    })).payload.data;
    assert.equal(updatedContact.title, "对方负责人");

    const cryostats = await app.request("/api/v2/cryostats?include_inactive=1");
    assert.equal(cryostats.payload.meta.total, 2);
    const updatedCryostat = (await app.request(`/api/v2/cryostats/${state.secondCryostat.id}`, {
      method: "PUT",
      body: { name: "DR-2", note: "备用冷机", status: "active", expected_updated_at: state.secondCryostat.updated_at }
    })).payload.data;
    assert.equal(updatedCryostat.note, "备用冷机");

    let plan = (await app.request(`/api/v2/plans/${state.plan.id}`)).payload.data;
    plan = (await app.request(`/api/v2/plans/${plan.id}`, {
      method: "PUT",
      body: {
        source_group_id: state.group.id,
        counterpart_contact_id: state.contact.id,
        local_liaison_name: "本地用户",
        name: "QPU-A 测控计划（更新）",
        purpose: "验证基础参数与重复性",
        sample_model: "QPU-A",
        sample_identifier: null,
        identifier_kind: null,
        project_tag: "项目甲",
        topic_tag: "谱学",
        actor_label: "本地用户",
        expected_version: plan.version
      }
    })).payload.data;
    assert.equal(plan.name, "QPU-A 测控计划（更新）");

    const added = (await app.request(`/api/v2/plans/${plan.id}/test-items`, {
      method: "POST",
      expected: [201],
      body: { title: "可选复测", description: "", acceptance_criteria: "记录完整", is_required: false, position: 1, actor_label: "本地用户", expected_version: plan.version }
    })).payload.data;
    assert.equal(added.test_item.position, 1);
    plan = (await app.request(`/api/v2/plans/${plan.id}`)).payload.data;
    const changedItem = (await app.request(`/api/v2/test-items/${added.test_item.id}`, {
      method: "PUT",
      body: { title: "可选复测（归档）", description: "", acceptance_criteria: "记录完整", is_required: false, position: 1, archived: true, actor_label: "本地用户", expected_version: plan.version }
    })).payload.data;
    assert.equal(changedItem.test_item.archived, true);

    plan = (await app.request(`/api/v2/plans/${plan.id}`)).payload.data;
    const previousTemplate = (await app.request(`/api/v2/plans/${plan.id}/acceptance-template`)).payload.data;
    const templateUpdate = (await app.request(`/api/v2/plans/${plan.id}/acceptance-template`, {
      method: "PUT",
      body: { name: "第二版清单", items: [{ label: "结果可访问", position: 0 }, { label: "说明完整", position: 1 }], actor_label: "本地用户", expected_version: plan.version }
    })).payload.data;
    assert.equal(templateUpdate.template.version, previousTemplate.version + 1);

    plan = (await app.request(`/api/v2/plans/${plan.id}`)).payload.data;
    const archived = (await app.request(`/api/v2/plans/${plan.id}/archive`, { method: "POST", body: { actor_label: "本地用户", expected_version: plan.version } })).payload.data.plan;
    assert.equal(archived.archived, true);
    const historical = (await app.request("/api/v2/plans?include_archived=1&window_days=7")).payload;
    assert.equal(historical.meta.total, 1);
    assert.deepEqual(historical.meta.stats, { testing: 0, delayed: 0, within: 0, outside: 0, pending: 0, completed: 0, unclassified: 0 });

    plan = (await app.request(`/api/v2/plans/${plan.id}/restore`, { method: "POST", body: { actor_label: "本地用户", expected_version: archived.version } })).payload.data.plan;
    plan = (await app.request(`/api/v2/plans/${plan.id}/arrival`, {
      method: "POST",
      body: { actual_arrival_date: addDays(state.today, 8), sample_identifier: "TMP-QPU-A-01", identifier_kind: "temporary", actor_label: "本地用户", expected_version: plan.version }
    })).payload.data.plan;
    assert.equal(plan.actual_arrival_date, addDays(state.today, 8));
    assert.equal(plan.display_status, null);

    const events = await app.request(`/api/v2/plans/${plan.id}/events?sort=id_asc`);
    assert.ok(events.payload.meta.total >= 8);
    assert.equal(events.payload.data[0].event_type, "create_plan");
    const backup = await app.request("/api/v2/backup");
    assert.equal(backup.payload.data.schema_version, 2);
    assert.equal(backup.payload.data.control_plans.length, 1);
    assert.equal(backup.headers.get("content-disposition"), null);
  } finally {
    await app.close();
  }
});

test("manual task preview and confirm preserve progress while ETA and cryostat confirmations bind current facts", async () => {
  const app = await fixture();
  try {
    const state = await createPlanFixture(app);
    const created = await createPlanTask(app, state);
    assert.match(created.plan_task.task_lineage_key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(created.plan_task.primary_member.id, state.members[0].id);
    assert.deepEqual(created.plan_task.collaborators.map((member) => member.id), [state.members[1].id]);

    const primaryAssignment = created.task.assignments.find((assignment) => assignment.member_id === state.members[0].id);
    await app.request(`/api/assignments/${primaryAssignment.id}`, { method: "PUT", body: { progress: 37, note: "保留个人进度" } });

    const updateInput = {
      test_item_id: created.plan_task.test_item_id,
      title: "到样后基础谱测量（更新）",
      description: "人工调整但保持个人进度",
      primary_member_id: state.members[0].id,
      collaborator_member_ids: [state.members[1].id],
      start_date: created.task.default_start_date,
      end_date: created.task.default_end_date,
      estimated_hours: 8,
      after_arrival: true,
      expected_version: state.plan.version
    };
    const updatePreview = (await app.request(`/api/v2/plan-tasks/${created.task.id}/preview`, { method: "POST", body: updateInput })).payload.data;
    assert.equal(updatePreview.conflicts.some((conflict) => conflict.task_ids.every((id) => id === created.task.id)), false);
    const updated = (await app.request(`/api/v2/plan-tasks/${created.task.id}`, {
      method: "PUT",
      body: { ...updateInput, preview_token: updatePreview.preview_token, acknowledged_conflict_codes: [...new Set(updatePreview.conflicts.map((item) => item.code))], actor_label: "本地用户" }
    })).payload.data;
    assert.equal(updated.plan_task.task_lineage_key, created.plan_task.task_lineage_key);
    assert.equal(updated.task.assignments.find((assignment) => assignment.id === primaryAssignment.id).progress, 37);
    assert.equal(updated.task.assignments.find((assignment) => assignment.id === primaryAssignment.id).note, "保留个人进度");
    state.plan = (await app.request(`/api/v2/plans/${state.plan.id}`)).payload.data;

    const newEta = addDays(state.plan.current_eta_date, 2);
    const emptyEta = (await app.request(`/api/v2/plans/${state.plan.id}/eta/preview`, {
      method: "POST",
      body: { new_eta_date: newEta, eta_pending: false, selected_task_ids: [], actor_label: "本地用户", expected_version: state.plan.version }
    })).payload.data;
    assert.equal(emptyEta.eligible_tasks.length, 1);
    assert.equal(emptyEta.eligible_tasks[0].selected, false);
    assert.deepEqual(emptyEta.conflicts, []);

    const staleSelection = await app.request(`/api/v2/plans/${state.plan.id}/eta/confirm`, {
      method: "POST",
      expected: [409],
      body: { new_eta_date: newEta, eta_pending: false, selected_task_ids: [created.task.id], preview_token: emptyEta.preview_token, acknowledged_conflict_codes: [], actor_label: "本地用户", expected_version: state.plan.version }
    });
    assert.equal(staleSelection.payload.code, "STALE_PREVIEW");
    const afterStale = (await app.request(`/api/v2/plans/${state.plan.id}`)).payload.data;
    assert.equal(afterStale.version, state.plan.version);
    assert.equal(afterStale.current_eta_date, state.plan.current_eta_date);
    assert.equal(afterStale.plan_tasks[0].default_start_date, created.task.default_start_date);

    const selectedEta = (await app.request(`/api/v2/plans/${state.plan.id}/eta/preview`, {
      method: "POST",
      body: { new_eta_date: newEta, eta_pending: false, selected_task_ids: [created.task.id], actor_label: "本地用户", expected_version: state.plan.version }
    })).payload.data;
    const etaConfirmed = (await app.request(`/api/v2/plans/${state.plan.id}/eta/confirm`, {
      method: "POST",
      body: {
        new_eta_date: newEta,
        eta_pending: false,
        selected_task_ids: [created.task.id],
        preview_token: selectedEta.preview_token,
        acknowledged_conflict_codes: [...new Set(selectedEta.conflicts.map((item) => item.code))],
        actor_label: "本地用户",
        expected_version: state.plan.version
      }
    })).payload.data;
    assert.equal(etaConfirmed.moved_tasks.length, 1);
    assert.equal(etaConfirmed.moved_tasks[0].new_start_date, addDays(created.task.default_start_date, 2));
    assert.equal(etaConfirmed.moved_tasks[0].assignment_moves.find((assignment) => assignment.assignment_id === primaryAssignment.id).new_start_date, addDays(primaryAssignment.start_date, 2));
    assert.equal(etaConfirmed.plan.plan_tasks[0].assignments.find((assignment) => assignment.id === primaryAssignment.id).progress, 37);

    state.plan = etaConfirmed.plan;
    const cryostatPreview = (await app.request(`/api/v2/plans/${state.plan.id}/cryostat/preview`, {
      method: "POST",
      body: { new_cryostat_id: state.secondCryostat.id, cryostat_pending: false, actor_label: "本地用户", expected_version: state.plan.version }
    })).payload.data;
    const cryostatConfirmed = (await app.request(`/api/v2/plans/${state.plan.id}/cryostat/confirm`, {
      method: "POST",
      body: { new_cryostat_id: state.secondCryostat.id, cryostat_pending: false, preview_token: cryostatPreview.preview_token, acknowledged_conflict_codes: [...new Set(cryostatPreview.conflicts.map((item) => item.code))], actor_label: "本地用户", expected_version: state.plan.version }
    })).payload.data;
    assert.equal(cryostatConfirmed.plan.cryostat.id, state.secondCryostat.id);
  } finally {
    await app.close();
  }
});

test("V2 plan-task text boundaries are enforced without changing the V1 task endpoint", async () => {
  const app = await fixture();
  try {
    const state = await createPlanFixture(app);
    const invalid = await app.request(`/api/v2/plans/${state.plan.id}/tasks/preview`, {
      method: "POST",
      expected: [400],
      body: {
        test_item_id: state.plan.test_items[0].id,
        title: "长".repeat(201),
        description: "",
        primary_member_id: state.members[0].id,
        collaborator_member_ids: [],
        start_date: addDays(state.today, 11),
        end_date: addDays(state.today, 12),
        estimated_hours: 0.5,
        after_arrival: true,
        expected_version: state.plan.version
      }
    });
    assert.equal(invalid.payload.code, "VALIDATION_ERROR");
    assert.deepEqual(invalid.payload.details, { field: "title", reason: "length" });

    const v1Task = await app.request("/api/tasks", {
      method: "POST",
      expected: [201],
      body: { title: "长".repeat(201), description: "V1 保持兼容", default_start_date: addDays(state.today, 1), default_end_date: addDays(state.today, 2), color: "#2563eb", member_ids: [], checklist: [] }
    });
    assert.equal(v1Task.payload.title.length, 201);
  } finally {
    await app.close();
  }
});

test("submission checklist snapshots and manual returned/accepted reviews are authoritative and progress-independent", async () => {
  const app = await fixture();
  try {
    const state = await createPlanFixture(app);
    const created = await createPlanTask(app, state);
    const assignment = created.task.assignments.find((item) => item.member_id === state.members[0].id);
    await app.request(`/api/assignments/${assignment.id}`, { method: "PUT", body: { progress: 43, note: "验收不覆盖" } });
    const templateItem = state.plan.acceptance_template.items[0];

    const forged = await app.request(`/api/v2/tasks/${created.task.id}/submissions`, {
      method: "POST",
      expected: [400],
      body: { description: "伪造标签", submitter_label: "本地用户", resource_kind: "local_path", resource_value: "D:\\results\\qpu-a", checklist: [{ template_item_id: templateItem.id, checked: true, label: "客户端标签" }] }
    });
    assert.equal(forged.payload.code, "UNKNOWN_FIELD");

    const first = (await app.request(`/api/v2/tasks/${created.task.id}/submissions`, {
      method: "POST",
      expected: [201],
      body: { description: "第一版结果", submitter_label: "提交人甲", resource_kind: "local_path", resource_value: "D:\\results\\qpu-a", checklist: [{ template_item_id: templateItem.id, checked: true }] }
    })).payload.data;
    assert.equal(first.sequence, 1);
    assert.equal(first.checklist_snapshot[0].label, templateItem.label);

    const returned = (await app.request(`/api/v2/submissions/${first.id}/review`, {
      method: "POST",
      body: { decision: "returned", reviewer_label: "验收人", comment: "补充说明", checklist: [{ template_item_id: templateItem.id, passed: false, note: "说明不足" }], expected_version: first.version }
    })).payload.data;
    assert.equal(returned.submission.status, "returned");
    assert.notEqual(returned.task.status, "completed");
    assert.equal(returned.task.assignments.find((item) => item.id === assignment.id).progress, 43);

    const second = (await app.request(`/api/v2/tasks/${created.task.id}/submissions`, {
      method: "POST",
      expected: [201],
      body: { description: "第二版结果", submitter_label: "提交人甲", resource_kind: "url", resource_value: "https://example.test/qpu-a", supersedes_submission_id: first.id, checklist: [{ template_item_id: templateItem.id, checked: true }] }
    })).payload.data;
    assert.equal(second.sequence, 2);
    assert.equal(second.supersedes_submission_id, first.id);

    const accepted = (await app.request(`/api/v2/submissions/${second.id}/review`, {
      method: "POST",
      body: { decision: "accepted", reviewer_label: "验收人", comment: "通过", checklist: [{ template_item_id: templateItem.id, passed: true, note: "" }], expected_version: second.version }
    })).payload.data;
    assert.equal(accepted.submission.status, "accepted");
    assert.equal(accepted.task.status, "completed");
    assert.equal(accepted.task.assignments.find((item) => item.id === assignment.id).progress, 43);
    assert.equal(accepted.plan_summary.display_status, "completed");

    const submissions = await app.request(`/api/v2/plans/${state.plan.id}/submissions?sort=lineage_asc_sequence_desc`);
    assert.equal(submissions.payload.meta.total, 2);
    assert.deepEqual(submissions.payload.data.map((item) => item.sequence), [2, 1]);
  } finally {
    await app.close();
  }
});

test("V1 primary guards, soft-delete restore, and reset preserve V2 lineage history without changing success shapes", async () => {
  const app = await fixture();
  try {
    const state = await createPlanFixture(app);
    const created = await createPlanTask(app, state);
    const primary = created.task.assignments.find((item) => item.member_id === state.members[0].id);
    const collaborator = created.task.assignments.find((item) => item.member_id === state.members[1].id);

    const primaryAssignmentDelete = await app.request(`/api/assignments/${primary.id}`, { method: "DELETE", expected: [409] });
    assert.equal(primaryAssignmentDelete.payload.code, "PRIMARY_ASSIGNMENT_REQUIRED");
    const primaryMemberDelete = await app.request(`/api/members/${state.members[0].id}`, { method: "DELETE", expected: [409] });
    assert.equal(primaryMemberDelete.payload.code, "PRIMARY_MEMBER_IN_USE");
    assert.deepEqual((await app.request(`/api/assignments/${collaborator.id}`, { method: "DELETE" })).payload, { ok: true });

    assert.deepEqual((await app.request(`/api/tasks/${created.task.id}`, { method: "DELETE" })).payload, { ok: true });
    assert.deepEqual((await app.request(`/api/members/${state.members[0].id}`, { method: "DELETE" })).payload, { ok: true });
    const unavailable = await app.request(`/api/tasks/${created.task.id}/restore`, { method: "POST", expected: [409] });
    assert.equal(unavailable.payload.code, "PRIMARY_MEMBER_UNAVAILABLE");
    await app.request(`/api/members/${state.members[0].id}/restore`, { method: "POST" });
    const restored = await app.request(`/api/tasks/${created.task.id}/restore`, { method: "POST" });
    assert.equal(restored.payload.id, created.task.id);
    assert.ok(restored.payload.assignments.some((item) => item.id === primary.id));

    const templateItem = state.plan.acceptance_template.items[0];
    const submission = (await app.request(`/api/v2/tasks/${created.task.id}/submissions`, {
      method: "POST",
      expected: [201],
      body: { description: "重置前成果", submitter_label: "本地用户", resource_kind: "local_path", resource_value: "D:\\results\\before-reset", checklist: [{ template_item_id: templateItem.id, checked: true }] }
    })).payload.data;
    const reviewed = (await app.request(`/api/v2/submissions/${submission.id}/review`, {
      method: "POST",
      body: { decision: "accepted", reviewer_label: "本地用户", comment: "通过", checklist: [{ template_item_id: templateItem.id, passed: true, note: "" }], expected_version: submission.version }
    })).payload.data;
    assert.equal(reviewed.plan_summary.display_status, "completed");

    const versionBeforeReset = (await app.request(`/api/v2/plans/${state.plan.id}`)).payload.data.version;
    const reset = await app.request("/api/maintenance/reset-sample", { method: "POST", body: {} });
    assert.equal(reset.payload.ok, true);
    assert.ok(Array.isArray(reset.payload.backup.tasks));
    let resetPlan = (await app.request(`/api/v2/plans/${state.plan.id}`)).payload.data;
    assert.equal(resetPlan.version, versionBeforeReset + 1);
    assert.equal(resetPlan.plan_tasks.length, 0);
    assert.notEqual(resetPlan.display_status, "completed");
    const oldSubmission = (await app.request(`/api/v2/plans/${state.plan.id}/submissions`)).payload.data.find((item) => item.id === submission.id);
    assert.equal(oldSubmission.task_id, null);
    assert.equal(oldSubmission.task_lineage_key, created.plan_task.task_lineage_key);
    const hardDeleteEvent = resetPlan.events.find((event) => event.event_type === "task_hard_delete");
    assert.equal(hardDeleteEvent.old_value.task_lineage_key, created.plan_task.task_lineage_key);

    state.plan = resetPlan;
    state.members = (await app.request("/api/members")).payload;
    const replacement = await createPlanTask(app, state, { title: "重置后新任务" });
    assert.equal(replacement.task.id, created.task.id);
    assert.notEqual(replacement.plan_task.task_lineage_key, created.plan_task.task_lineage_key);
    const replacementSubmission = (await app.request(`/api/v2/tasks/${replacement.task.id}/submissions`, {
      method: "POST",
      expected: [201],
      body: { description: "重置后成果", submitter_label: "本地用户", resource_kind: "local_path", resource_value: "D:\\results\\after-reset", checklist: [{ template_item_id: templateItem.id, checked: true }] }
    })).payload.data;
    assert.equal(replacementSubmission.sequence, 1);
    assert.notEqual(replacementSubmission.task_lineage_key, oldSubmission.task_lineage_key);
    const afterReplacement = (await app.request(`/api/v2/plans/${state.plan.id}`)).payload.data;
    assert.notEqual(afterReplacement.display_status, "completed");
  } finally {
    await app.close();
  }
});
