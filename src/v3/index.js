import { createHash, randomUUID } from "node:crypto";

/**
 * V3 is deliberately isolated from the V1/V2 route and schema modules.  The
 * adapter only receives a DatabaseSync instance and never mutates V2 meaning.
 */
export const V3_TABLES = Object.freeze([
  "v3_topics", "v3_samples", "v3_topic_plan_links", "v3_topic_tasks",
  "v3_task_samples", "v3_task_dependencies", "v3_task_member_efforts",
  "v3_acceptance_templates", "v3_acceptance_template_items",
  "v3_deliverable_submissions", "v3_submission_samples",
  "v3_acceptance_reviews", "v3_topic_events"
]);

export const V3_INDEXES = Object.freeze([
  "idx_v3_topics_source", "idx_v3_topics_cryostat", "idx_v3_samples_topic_eta",
  "idx_v3_samples_identifier", "idx_v3_topic_tasks_topic", "idx_v3_topic_tasks_primary",
  "idx_v3_task_samples_sample", "idx_v3_dependencies_successor",
  "idx_v3_dependencies_predecessor", "idx_v3_efforts_member", "idx_v3_one_active_template",
  "idx_v3_submissions_task", "idx_v3_submission_samples_sample", "idx_v3_events_topic"
]);

export const V3_ENDPOINTS = Object.freeze([
  "GET /api/v3/status", "GET /api/v3/backup", "GET /api/v3/topics", "POST /api/v3/topics",
  "GET /api/v3/topics/:id", "PUT /api/v3/topics/:id", "POST /api/v3/topics/:id/archive",
  "POST /api/v3/topics/:id/restore", "GET /api/v3/topics/:id/samples",
  "POST /api/v3/topics/:id/samples", "GET /api/v3/samples/:id", "PUT /api/v3/samples/:id",
  "POST /api/v3/samples/:id/archive", "POST /api/v3/samples/:id/restore",
  "POST /api/v3/samples/:id/arrival", "POST /api/v3/samples/:id/eta/preview",
  "POST /api/v3/samples/:id/eta/confirm", "POST /api/v3/topics/:id/cryostat/preview",
  "POST /api/v3/topics/:id/cryostat/confirm", "POST /api/v3/topics/:id/legacy-plans/preview",
  "POST /api/v3/topics/:id/legacy-plans/confirm",
  "POST /api/v3/topics/:id/legacy-plans/:plan_id/unlink", "GET /api/v3/topics/:id/tasks",
  "POST /api/v3/topics/:id/tasks/preview", "POST /api/v3/topics/:id/tasks",
  "POST /api/v3/topic-tasks/:task_id/preview", "PUT /api/v3/topic-tasks/:task_id",
  "PUT /api/v3/topics/:id/task-order", "GET /api/v3/topics/:id/acceptance-template",
  "PUT /api/v3/topics/:id/acceptance-template", "GET /api/v3/topics/:id/submissions",
  "POST /api/v3/tasks/:task_id/submissions", "POST /api/v3/submissions/:id/review",
  "GET /api/v3/topics/:id/events"
]);

export const V3_SCHEMA_SQL = `
CREATE TABLE v3_topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_group_id INTEGER NOT NULL REFERENCES v2_source_groups(id) ON DELETE RESTRICT,
  source_contact_id INTEGER REFERENCES v2_source_contacts(id) ON DELETE SET NULL,
  name TEXT NOT NULL, purpose TEXT NOT NULL,
  default_cryostat_id INTEGER REFERENCES v2_cryostats(id) ON DELETE SET NULL,
  archived_at TEXT, version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE v3_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL REFERENCES v3_topics(id) ON DELETE CASCADE,
  planning_label TEXT NOT NULL, model TEXT NOT NULL,
  formal_identifier TEXT, temporary_identifier TEXT,
  initial_eta_date TEXT, current_eta_date TEXT,
  eta_pending INTEGER NOT NULL DEFAULT 0 CHECK(eta_pending IN (0,1)),
  actual_arrival_date TEXT, notes TEXT NOT NULL DEFAULT '', archived_at TEXT,
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE v3_topic_plan_links (
  topic_id INTEGER NOT NULL REFERENCES v3_topics(id) ON DELETE CASCADE,
  v2_plan_id INTEGER NOT NULL REFERENCES v2_control_plans(id) ON DELETE RESTRICT,
  copy_mode TEXT NOT NULL CHECK(copy_mode='snapshot'), snapshot_json TEXT NOT NULL,
  copied_by TEXT NOT NULL, copied_at TEXT NOT NULL, PRIMARY KEY(topic_id,v2_plan_id)
);
CREATE TABLE v3_topic_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL REFERENCES v3_topics(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  task_lineage_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL CHECK(position>=0),
  is_required INTEGER NOT NULL DEFAULT 1 CHECK(is_required IN (0,1)),
  primary_member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  cryostat_id INTEGER REFERENCES v2_cryostats(id) ON DELETE SET NULL,
  cryostat_pending INTEGER NOT NULL DEFAULT 0 CHECK(cryostat_pending IN (0,1)),
  start_date TEXT, end_date TEXT,
  after_arrival INTEGER NOT NULL DEFAULT 0 CHECK(after_arrival IN (0,1)),
  status_source TEXT NOT NULL DEFAULT 'manual' CHECK(status_source='manual'),
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(topic_id,position)
);
CREATE TABLE v3_task_samples (
  topic_task_id INTEGER NOT NULL REFERENCES v3_topic_tasks(id) ON DELETE CASCADE,
  sample_id INTEGER NOT NULL REFERENCES v3_samples(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL, PRIMARY KEY(topic_task_id,sample_id)
);
CREATE TABLE v3_task_dependencies (
  topic_id INTEGER NOT NULL REFERENCES v3_topics(id) ON DELETE CASCADE,
  predecessor_task_id INTEGER NOT NULL REFERENCES v3_topic_tasks(id) ON DELETE CASCADE,
  successor_task_id INTEGER NOT NULL REFERENCES v3_topic_tasks(id) ON DELETE CASCADE,
  lag_days INTEGER NOT NULL DEFAULT 0 CHECK(lag_days BETWEEN 0 AND 3650), created_at TEXT NOT NULL,
  PRIMARY KEY(predecessor_task_id,successor_task_id),
  UNIQUE(topic_id,predecessor_task_id), UNIQUE(topic_id,successor_task_id)
);
CREATE TABLE v3_task_member_efforts (
  topic_task_id INTEGER NOT NULL REFERENCES v3_topic_tasks(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  planned_half_hours INTEGER NOT NULL CHECK(planned_half_hours>=0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(topic_task_id,member_id)
);
CREATE TABLE v3_acceptance_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL REFERENCES v3_topics(id) ON DELETE CASCADE,
  name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE v3_acceptance_template_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES v3_acceptance_templates(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK(position>=0), label TEXT NOT NULL, UNIQUE(template_id,position)
);
CREATE TABLE v3_deliverable_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_task_id INTEGER REFERENCES v3_topic_tasks(id) ON DELETE SET NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  task_lineage_key TEXT NOT NULL, task_title_snapshot TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence>0),
  supersedes_submission_id INTEGER REFERENCES v3_deliverable_submissions(id) ON DELETE SET NULL,
  sample_set_fingerprint TEXT NOT NULL, description TEXT NOT NULL, submitted_by TEXT NOT NULL,
  submitted_at TEXT NOT NULL, resource_url TEXT NOT NULL, checklist_snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','returned','accepted')),
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(task_lineage_key,sequence), UNIQUE(supersedes_submission_id)
);
CREATE TABLE v3_submission_samples (
  submission_id INTEGER NOT NULL REFERENCES v3_deliverable_submissions(id) ON DELETE CASCADE,
  sample_id INTEGER, sample_key TEXT NOT NULL, position INTEGER NOT NULL CHECK(position>=0),
  model_snapshot TEXT NOT NULL, identifier_snapshot TEXT, planning_label_snapshot TEXT NOT NULL,
  PRIMARY KEY(submission_id,sample_key), UNIQUE(submission_id,position)
);
CREATE TABLE v3_acceptance_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL UNIQUE REFERENCES v3_deliverable_submissions(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK(decision IN ('accepted','returned')), reviewer TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '', checked_snapshot_json TEXT NOT NULL, reviewed_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE v3_topic_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL REFERENCES v3_topics(id) ON DELETE CASCADE,
  topic_task_id INTEGER REFERENCES v3_topic_tasks(id) ON DELETE SET NULL,
  sample_id INTEGER REFERENCES v3_samples(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL, actor TEXT NOT NULL, before_json TEXT, after_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_v3_topics_source ON v3_topics(source_group_id,archived_at);
CREATE INDEX idx_v3_topics_cryostat ON v3_topics(default_cryostat_id,archived_at);
CREATE INDEX idx_v3_samples_topic_eta ON v3_samples(topic_id,current_eta_date,eta_pending,archived_at);
CREATE UNIQUE INDEX idx_v3_samples_identifier ON v3_samples(topic_id,formal_identifier) WHERE formal_identifier IS NOT NULL AND archived_at IS NULL;
CREATE INDEX idx_v3_topic_tasks_topic ON v3_topic_tasks(topic_id,position);
CREATE INDEX idx_v3_topic_tasks_primary ON v3_topic_tasks(primary_member_id);
CREATE INDEX idx_v3_task_samples_sample ON v3_task_samples(sample_id);
CREATE INDEX idx_v3_dependencies_successor ON v3_task_dependencies(successor_task_id);
CREATE INDEX idx_v3_dependencies_predecessor ON v3_task_dependencies(predecessor_task_id);
CREATE INDEX idx_v3_efforts_member ON v3_task_member_efforts(member_id);
CREATE UNIQUE INDEX idx_v3_one_active_template ON v3_acceptance_templates(topic_id) WHERE is_active=1;
CREATE INDEX idx_v3_submissions_task ON v3_deliverable_submissions(task_lineage_key,sequence DESC);
CREATE INDEX idx_v3_submission_samples_sample ON v3_submission_samples(sample_id);
CREATE INDEX idx_v3_events_topic ON v3_topic_events(topic_id,id DESC);
`;

export const V3_SCHEMA_CHECKSUM = createHash("sha256").update(V3_SCHEMA_SQL).digest("hex");

// V5 is an additive canonical model for the three approved modules.  It is
// deliberately kept outside app_schema_versions (which is owned by V2/V3) so
// that reopening an existing V3 database remains backwards compatible.
export const V5_TABLES = Object.freeze([
  "v5_schema_versions", "v5_topics", "v5_tasks", "v5_test_items",
  "v5_samples", "v5_task_samples", "v5_task_members", "v5_events"
]);

export const V5_INDEXES = Object.freeze([
  "idx_v5_tasks_topic", "idx_v5_tasks_source", "idx_v5_tasks_cryostat",
  "idx_v5_tasks_dates", "idx_v5_samples_eta", "idx_v5_task_samples_sample",
  "idx_v5_task_members_member", "idx_v5_events_topic", "idx_v5_events_task"
]);

export const V5_ENDPOINTS = Object.freeze([
  "GET /api/v5/status", "GET /api/v5/resources", "POST /api/v5/resources/:kind",
  "PUT /api/v5/resources/:kind/:id", "GET /api/v5/topics", "POST /api/v5/topics",
  "PUT /api/v5/topics/:id", "DELETE /api/v5/topics/:id", "POST /api/v5/topics/:id/move-tasks",
  "GET /api/v5/samples", "POST /api/v5/samples", "PUT /api/v5/samples/:id",
  "GET /api/v5/tasks", "GET /api/v5/tasks/:id", "POST /api/v5/tasks/preview",
  "POST /api/v5/tasks", "POST /api/v5/tasks/:id/preview", "PUT /api/v5/tasks/:id",
  "POST /api/v5/tasks/:id/start-testing", "POST /api/v5/tasks/:id/complete",
  "POST /api/v5/tasks/:id/schedule-preview", "POST /api/v5/tasks/:id/schedule",
  "POST /api/v5/tasks/:id/member-schedule-preview", "POST /api/v5/tasks/:id/member-schedule",
  "GET /api/v5/execution", "GET /api/v5/events"
]);

export const V5_SCHEMA_SQL = `
CREATE TABLE v5_schema_versions (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL CHECK(length(checksum)=64),
  applied_at TEXT NOT NULL
);
CREATE TABLE v5_topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
  purpose TEXT NOT NULL DEFAULT '' CHECK(length(purpose)<=4000),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
  system_key TEXT UNIQUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE v5_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_task_id INTEGER UNIQUE REFERENCES tasks(id) ON DELETE SET NULL,
  topic_id INTEGER NOT NULL REFERENCES v5_topics(id) ON DELETE RESTRICT,
  source_group_id INTEGER REFERENCES v2_source_groups(id) ON DELETE RESTRICT,
  cryostat_id INTEGER REFERENCES v2_cryostats(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
  purpose TEXT NOT NULL DEFAULT '' CHECK(length(purpose)<=4000),
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
  color TEXT NOT NULL DEFAULT '' CHECK(length(color)<=32),
  manual_phase TEXT NOT NULL DEFAULT 'waiting' CHECK(manual_phase IN ('waiting','testing','completed')),
  start_date TEXT,
  end_date TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((start_date IS NULL AND end_date IS NULL) OR (start_date IS NOT NULL AND end_date IS NOT NULL AND start_date<=end_date))
);
CREATE TABLE v5_test_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES v5_tasks(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 300),
  acceptance_criteria TEXT NOT NULL DEFAULT '' CHECK(length(acceptance_criteria)<=2000),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=2000),
  position INTEGER NOT NULL DEFAULT 0 CHECK(position>=0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(task_id,position)
);
CREATE TABLE v5_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  planning_label TEXT NOT NULL CHECK(length(trim(planning_label)) BETWEEN 1 AND 300),
  model TEXT NOT NULL CHECK(length(trim(model)) BETWEEN 1 AND 200),
  sample_no TEXT,
  eta_date TEXT,
  arrival_date TEXT,
  eta_pending INTEGER NOT NULL DEFAULT 0 CHECK(eta_pending IN (0,1)),
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((eta_pending=1) OR eta_date IS NOT NULL),
  CHECK(arrival_date IS NULL OR eta_date IS NULL OR arrival_date>=eta_date)
);
CREATE TABLE v5_task_samples (
  task_id INTEGER NOT NULL REFERENCES v5_tasks(id) ON DELETE CASCADE,
  sample_id INTEGER NOT NULL REFERENCES v5_samples(id) ON DELETE RESTRICT,
  is_required INTEGER NOT NULL DEFAULT 1 CHECK(is_required IN (0,1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(task_id,sample_id)
);
CREATE TABLE v5_task_members (
  task_id INTEGER NOT NULL REFERENCES v5_tasks(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  start_date TEXT,
  end_date TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(task_id,member_id),
  CHECK((start_date IS NULL AND end_date IS NULL) OR (start_date IS NOT NULL AND end_date IS NOT NULL AND start_date<=end_date))
);
CREATE TABLE v5_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL REFERENCES v5_topics(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES v5_tasks(id) ON DELETE SET NULL,
  sample_id INTEGER REFERENCES v5_samples(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT '本地用户',
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_v5_tasks_topic ON v5_tasks(topic_id,updated_at DESC);
CREATE INDEX idx_v5_tasks_source ON v5_tasks(source_group_id,updated_at DESC);
CREATE INDEX idx_v5_tasks_cryostat ON v5_tasks(cryostat_id,start_date,end_date);
CREATE INDEX idx_v5_tasks_dates ON v5_tasks(start_date,end_date);
CREATE INDEX idx_v5_samples_eta ON v5_samples(eta_date,arrival_date,eta_pending);
CREATE INDEX idx_v5_task_samples_sample ON v5_task_samples(sample_id);
CREATE INDEX idx_v5_task_members_member ON v5_task_members(member_id,start_date,end_date);
CREATE INDEX idx_v5_events_topic ON v5_events(topic_id,id DESC);
CREATE INDEX idx_v5_events_task ON v5_events(task_id,id DESC);
`;

export const V5_SCHEMA_CHECKSUM = createHash("sha256").update(V5_SCHEMA_SQL).digest("hex");

// V3.1 is an additive task-detail migration.  Keeping these fields on the
// existing task table preserves the schema-3 checksum and all V1/V2 routes.
const V31_TASK_DETAIL_COLUMNS = Object.freeze([
  ["test_purpose", "TEXT NOT NULL DEFAULT ''"],
  ["test_items_json", "TEXT NOT NULL DEFAULT '[]'"]
]);

class V3Error extends Error {
  constructor(status, code, details = {}, message = code) { super(message); this.status = status; this.code = code; this.details = details; }
}

function fail(status, code, details = {}, message = code) { throw new V3Error(status, code, details, message); }
function now() { return new Date().toISOString(); }
function todayIsoDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function id(value, field = "id") { const n = Number(value); if (!Number.isInteger(n) || n <= 0) fail(400, "VALIDATION_ERROR", { field, reason: "positive integer required" }); return n; }
function uuid(value, field = "task_lineage_key") { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "")) fail(400, "VALIDATION_ERROR", { field, reason: "UUID required" }); return value; }
function trim(value, field, min = 0, max = 4000) { const v = String(value ?? "").trim(); if (v.length < min || v.length > max) fail(400, "VALIDATION_ERROR", { field, reason: `length ${min}..${max}` }); return v; }
function date(value, field, nullable = true) { if (value == null && nullable) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) fail(400, "VALIDATION_ERROR", { field, reason: "YYYY-MM-DD required" }); return value; }
function bool(value, field) { if (value === undefined) return 0; if (value !== 0 && value !== 1 && value !== true && value !== false) fail(400, "VALIDATION_ERROR", { field, reason: "boolean required" }); return value ? 1 : 0; }
function response(res, status, data, meta = {}) { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ data, ...(Object.keys(meta).length ? { meta } : {}) })); }
function errorResponse(res, error) { const e = error instanceof V3Error ? error : new V3Error(500, "INTERNAL_ERROR", {}, error?.message || "service error"); res.writeHead(e.status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: { code: e.code, message: e.message, details: e.details }, meta: { request_id: randomUUID() } })); }
async function body(req) { return await new Promise((resolve, reject) => { let text = ""; req.on("data", (chunk) => { text += chunk; if (text.length > 3_000_000) reject(new V3Error(413, "PAYLOAD_TOO_LARGE")); }); req.on("end", () => { if (!text) return resolve({}); try { resolve(JSON.parse(text)); } catch { reject(new V3Error(400, "VALIDATION_ERROR", { reason: "invalid JSON" })); } }); req.on("error", reject); }); }
function transaction(database, fn) { database.exec("BEGIN IMMEDIATE"); try { const out = fn(); database.exec("COMMIT"); return out; } catch (e) { database.exec("ROLLBACK"); throw e; } }
function tables(database, type) { return database.prepare("SELECT name FROM sqlite_master WHERE type=? ORDER BY name").all(type).map((r) => r.name); }

export function seedV3ReferenceResources(database) {
  const groups = ["工艺组", "读取组", "量子门组", "电子学组"];
  const cryostats = ["重庆号", "合肥号", "Z4.1"];
  const timestamp = now();
  const seed = () => {
    const insertGroup = database.prepare("INSERT OR IGNORE INTO v2_source_groups(name,normalized_name,note,is_active,created_at,updated_at) VALUES(?,?,?,1,?,?)");
    for (const name of groups) insertGroup.run(name, name.trim().toLocaleLowerCase("zh-CN"), "V3 默认来源小组", timestamp, timestamp);
    const insertCryostat = database.prepare("INSERT OR IGNORE INTO v2_cryostats(name,normalized_name,note,status,created_at,updated_at) VALUES(?,?,?, 'active',?,?)");
    for (const name of cryostats) insertCryostat.run(name, name.trim().toLocaleLowerCase("zh-CN"), "V3 默认制冷机", timestamp, timestamp);
  };
  database.exec("BEGIN IMMEDIATE");
  try { seed(); database.exec("COMMIT"); } catch (error) { database.exec("ROLLBACK"); throw error; }
}

export function validateV3Schema(database) {
  const actualTables = new Set(tables(database, "table"));
  const actualIndexes = new Set(tables(database, "index"));
  for (const name of V3_TABLES) if (!actualTables.has(name)) throw new Error(`V3 schema missing table: ${name}`);
  for (const name of V3_INDEXES) if (!actualIndexes.has(name)) throw new Error(`V3 schema missing index: ${name}`);
  const actualV3Tables = [...actualTables].filter((name) => name.startsWith("v3_")).sort();
  const actualV3Indexes = [...actualIndexes].filter((name) => name.startsWith("idx_v3_")).sort();
  if (actualV3Tables.length !== V3_TABLES.length || actualV3Tables.some((name, index) => name !== [...V3_TABLES].sort()[index])) throw new Error(`V3 schema table count mismatch: ${actualV3Tables.length}`);
  if (actualV3Indexes.length !== V3_INDEXES.length || actualV3Indexes.some((name, index) => name !== [...V3_INDEXES].sort()[index])) throw new Error(`V3 schema index count mismatch: ${actualV3Indexes.length}`);
  const version = database.prepare("SELECT version,name,checksum,applied_at FROM app_schema_versions WHERE version=3").get();
  if (!version || version.name !== "v3-topic-sample-chain" || version.checksum !== V3_SCHEMA_CHECKSUM) throw new Error("V3 schema checksum mismatch");
  const violations = database.prepare("PRAGMA foreign_key_check").all();
  if (violations.length) throw new Error(`V3 foreign key violations: ${violations.length}`);
  return version;
}

export function ensureV31TaskDetailSchema(database) {
  const columns = new Set(database.prepare("PRAGMA table_info(v3_topic_tasks)").all().map((row) => row.name));
  const missing = V31_TASK_DETAIL_COLUMNS.filter(([name]) => !columns.has(name));
  if (!missing.length) return false;
  transaction(database, () => {
    for (const [name, definition] of missing) database.exec(`ALTER TABLE v3_topic_tasks ADD COLUMN ${name} ${definition}`);
  });
  return true;
}

export function migrateV3Schema(database) {
  const names = new Set(tables(database, "table"));
  if (names.has("app_schema_versions")) {
    const rows = database.prepare("SELECT version,name,checksum,applied_at FROM app_schema_versions ORDER BY version").all();
    const max = rows.length ? Math.max(...rows.map((r) => r.version)) : 1;
    if (max > 3) throw new Error(`Unsupported schema version: ${max}`);
    const current = rows.find((r) => r.version === 3);
    if (current) { ensureV31TaskDetailSchema(database); validateV3Schema(database); return { migrated: false, version: current }; }
  }
  const indexes = new Set(tables(database, "index"));
  // A legacy V1 migration may have removed app_schema_versions while leaving
  // an already complete V3 object set. Re-register the immutable checksum
  // instead of treating that state as a partial migration.
  if (V3_TABLES.every((name) => names.has(name)) && V3_INDEXES.every((name) => indexes.has(name))) {
    transaction(database, () => database.prepare("INSERT INTO app_schema_versions(version,name,checksum,applied_at) VALUES(3,'v3-topic-sample-chain',?,?)").run(V3_SCHEMA_CHECKSUM, now()));
    ensureV31TaskDetailSchema(database);
    return { migrated: true, version: validateV3Schema(database) };
  }
  const partial = [...names].filter((name) => name.startsWith("v3_"));
  if (partial.length) throw new Error(`Partial V3 migration detected: ${partial.join(",")}`);
  transaction(database, () => {
    database.exec(V3_SCHEMA_SQL);
    database.prepare("INSERT INTO app_schema_versions(version,name,checksum,applied_at) VALUES(3,'v3-topic-sample-chain',?,?)").run(V3_SCHEMA_CHECKSUM, now());
  });
  ensureV31TaskDetailSchema(database);
  return { migrated: true, version: validateV3Schema(database) };
}

function v5NormalizeName(value) {
  return String(value ?? "").trim().toLocaleLowerCase("zh-CN");
}

function v5EnsureUnassignedTopic(database) {
  const existing = database.prepare("SELECT * FROM v5_topics WHERE system_key='unassigned'").get();
  if (existing) return existing;
  const stamp = now();
  const result = database.prepare("INSERT INTO v5_topics(name,purpose,status,notes,system_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .run("无专题", "尚未归类的任务暂存区", "active", "可在任务全量编辑台中重新归类到其他专题。", "unassigned", stamp, stamp);
  return database.prepare("SELECT * FROM v5_topics WHERE id=?").get(Number(result.lastInsertRowid));
}

function v5LegacyPhase(status, startDate) {
  if (status === "completed") return "completed";
  if (status === "active" || (status == null && startDate && startDate <= todayIsoDate())) return "testing";
  return "waiting";
}

function v5InsertSample(database, source) {
  const sampleNo = source.sample_no ?? source.formal_identifier ?? source.temporary_identifier ?? null;
  const eta = source.eta_date ?? source.current_eta_date ?? null;
  const pending = source.eta_pending ? 1 : (eta ? 0 : 1);
  const stamp = now();
  const result = database.prepare("INSERT INTO v5_samples(planning_label,model,sample_no,eta_date,arrival_date,eta_pending,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(String(source.planning_label || source.model || "待确认样品"), String(source.model || "待确认型号"), sampleNo, eta, source.arrival_date ?? source.actual_arrival_date ?? null, pending, String(source.notes || ""), stamp, stamp);
  return Number(result.lastInsertRowid);
}

function v5LegacyV2PlanData(database, legacyTaskId) {
  if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='v2_plan_tasks'").get()) return null;
  return database.prepare(`
    SELECT pt.plan_id, pt.primary_member_id, p.source_group_id, p.cryostat_id,
           p.cryostat_pending, p.name AS plan_name, p.purpose, p.sample_model,
           p.sample_identifier, p.identifier_kind, p.current_eta_date,
           p.eta_pending, p.actual_arrival_date
    FROM v2_plan_tasks pt
    JOIN v2_control_plans p ON p.id=pt.plan_id
    WHERE pt.task_id=?
  `).get(legacyTaskId) || null;
}

function v5LegacyV2Sample(database, plan) {
  if (!plan) return null;
  const marker = `[legacy-v2-plan:${plan.plan_id}]`;
  const existing = database.prepare("SELECT id FROM v5_samples WHERE notes LIKE ? ORDER BY id LIMIT 1").get(`%${marker}%`);
  if (existing) return existing.id;
  return v5InsertSample(database, {
    planning_label: plan.plan_name || plan.sample_model,
    model: plan.sample_model,
    sample_no: plan.sample_identifier,
    eta_date: plan.current_eta_date,
    eta_pending: plan.eta_pending,
    actual_arrival_date: plan.actual_arrival_date,
    notes: marker
  });
}

function v5CopyLegacyV2Details(database, target, plan) {
  if (!target || !plan) return target;
  const unassigned = database.prepare("SELECT id FROM v5_topics WHERE system_key='unassigned'").get();
  const hasV5Details = database.prepare("SELECT 1 FROM v5_task_samples WHERE task_id=? UNION SELECT 1 FROM v5_test_items WHERE task_id=? LIMIT 1").get(target.id, target.id);
  const shouldEnrich = target.topic_id === unassigned?.id && target.source_group_id == null && target.cryostat_id == null && !target.purpose && !hasV5Details;
  if (!shouldEnrich) return target;
  const cryostat = plan.cryostat_pending ? null : plan.cryostat_id;
  database.prepare("UPDATE v5_tasks SET source_group_id=?,cryostat_id=?,purpose=?,updated_at=? WHERE id=?").run(plan.source_group_id ?? null, cryostat, plan.purpose || "", now(), target.id);
  const sampleId = v5LegacyV2Sample(database, plan);
  if (sampleId) database.prepare("INSERT OR IGNORE INTO v5_task_samples(task_id,sample_id,is_required,created_at) VALUES(?,?,1,?)").run(target.id, sampleId, now());
  for (const item of database.prepare("SELECT title,description,acceptance_criteria,position FROM v2_test_items WHERE plan_id=? AND archived_at IS NULL ORDER BY position,id").all(plan.plan_id)) {
    if (!database.prepare("SELECT 1 FROM v5_test_items WHERE task_id=? AND position=?").get(target.id, item.position)) database.prepare("INSERT INTO v5_test_items(task_id,name,acceptance_criteria,note,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(target.id, item.title, item.acceptance_criteria || "", item.description || "", item.position, now(), now());
  }
  return database.prepare("SELECT * FROM v5_tasks WHERE id=?").get(target.id);
}

function v5SyncLegacyData(database) {
  const unassigned = v5EnsureUnassignedTopic(database);
  const topicMap = new Map();
  const sampleMap = new Map();
  const taskMap = new Map();

  for (const topic of database.prepare("SELECT * FROM v3_topics ORDER BY id").all()) {
    const key = `legacy-v3-topic-${topic.id}`;
    let target = database.prepare("SELECT * FROM v5_topics WHERE system_key=?").get(key);
    if (!target) {
      const stamp = now();
      const result = database.prepare("INSERT INTO v5_topics(name,purpose,status,notes,system_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
        .run(topic.name, topic.purpose || "", topic.archived_at ? "archived" : "active", "从 V3 专题迁移", key, stamp, stamp);
      target = database.prepare("SELECT * FROM v5_topics WHERE id=?").get(Number(result.lastInsertRowid));
    }
    topicMap.set(topic.id, target.id);
  }
  for (const sample of database.prepare("SELECT * FROM v3_samples ORDER BY id").all()) {
    const existing = database.prepare("SELECT id FROM v5_samples WHERE notes LIKE ? AND planning_label=? AND model=? ORDER BY id LIMIT 1")
      .get(`%legacy-v3-sample:${sample.id}%`, sample.planning_label, sample.model);
    if (existing) { sampleMap.set(sample.id, existing.id); continue; }
    const sampleId = v5InsertSample(database, { planning_label: sample.planning_label, model: sample.model, formal_identifier: sample.formal_identifier, temporary_identifier: sample.temporary_identifier, current_eta_date: sample.current_eta_date, eta_pending: sample.eta_pending, actual_arrival_date: sample.actual_arrival_date, notes: `${sample.notes || ""}${sample.notes ? " " : ""}[legacy-v3-sample:${sample.id}]` });
    sampleMap.set(sample.id, sampleId);
  }
  for (const task of database.prepare("SELECT * FROM v3_topic_tasks ORDER BY id").all()) {
    const topicId = topicMap.get(task.topic_id) || unassigned.id;
    let target = database.prepare("SELECT * FROM v5_tasks WHERE legacy_task_id=?").get(task.task_id);
    if (!target) {
      const linked = task.task_id == null ? null : database.prepare("SELECT * FROM tasks WHERE id=?").get(task.task_id);
      const stamp = now();
      const result = database.prepare("INSERT INTO v5_tasks(legacy_task_id,topic_id,source_group_id,cryostat_id,title,purpose,notes,color,manual_phase,start_date,end_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(task.task_id ?? null, topicId, database.prepare("SELECT source_group_id FROM v3_topics WHERE id=?").get(task.topic_id)?.source_group_id ?? null, task.cryostat_id ?? null, task.title, task.test_purpose || "", task.description || "", linked?.color || "", v5LegacyPhase(linked?.status, task.start_date), task.start_date, task.end_date, stamp, stamp);
      target = database.prepare("SELECT * FROM v5_tasks WHERE id=?").get(Number(result.lastInsertRowid));
    }
    taskMap.set(task.id, target.id);
    for (const link of database.prepare("SELECT sample_id FROM v3_task_samples WHERE topic_task_id=? ORDER BY sample_id").all(task.id)) {
      const sampleId = sampleMap.get(link.sample_id);
      if (sampleId) database.prepare("INSERT OR IGNORE INTO v5_task_samples(task_id,sample_id,is_required,created_at) VALUES(?,?,1,?)").run(target.id, sampleId, now());
    }
    for (const item of storedTestItems(task.test_items_json)) {
      if (!item?.name) continue;
      const position = Number(item.position ?? 0);
      if (!database.prepare("SELECT 1 FROM v5_test_items WHERE task_id=? AND position=?").get(target.id, position)) database.prepare("INSERT INTO v5_test_items(task_id,name,acceptance_criteria,note,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(target.id, item.name, item.acceptance_criteria || "", item.note || "", position, now(), now());
    }
    for (const effort of database.prepare("SELECT member_id FROM v3_task_member_efforts WHERE topic_task_id=?").all(task.id)) {
      if (!memberExists(database, effort.member_id)) continue;
      database.prepare("INSERT OR IGNORE INTO v5_task_members(task_id,member_id,start_date,end_date,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(target.id, effort.member_id, task.start_date, task.end_date, now(), now());
    }
  }
  // V1 tasks that were not represented in V3 are still first-class V5 tasks.
  for (const task of database.prepare("SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY id").all()) {
    if (database.prepare("SELECT 1 FROM v5_tasks WHERE legacy_task_id=?").get(task.id)) continue;
    const legacyPlan = v5LegacyV2PlanData(database, task.id);
    const stamp = now();
    const result = database.prepare("INSERT INTO v5_tasks(legacy_task_id,topic_id,source_group_id,cryostat_id,title,purpose,notes,color,manual_phase,start_date,end_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(task.id, unassigned.id, legacyPlan?.source_group_id ?? null, legacyPlan?.cryostat_pending ? null : (legacyPlan?.cryostat_id ?? null), task.title, legacyPlan?.purpose || "", task.description || "", task.color || "", v5LegacyPhase(task.status, task.default_start_date), task.default_start_date, task.default_end_date, stamp, stamp);
    const v5TaskId = Number(result.lastInsertRowid);
    if (legacyPlan) {
      const sampleId = v5LegacyV2Sample(database, legacyPlan);
      if (sampleId) database.prepare("INSERT OR IGNORE INTO v5_task_samples(task_id,sample_id,is_required,created_at) VALUES(?,?,1,?)").run(v5TaskId, sampleId, stamp);
      for (const item of database.prepare("SELECT title,description,acceptance_criteria,position FROM v2_test_items WHERE plan_id=? AND archived_at IS NULL ORDER BY position,id").all(legacyPlan.plan_id)) database.prepare("INSERT INTO v5_test_items(task_id,name,acceptance_criteria,note,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(v5TaskId, item.title, item.acceptance_criteria || "", item.description || "", item.position, stamp, stamp);
    }
    for (const assignment of database.prepare("SELECT * FROM task_assignments WHERE task_id=? AND deleted_at IS NULL").all(task.id)) {
      if (!memberExists(database, assignment.member_id)) continue;
      database.prepare("INSERT OR IGNORE INTO v5_task_members(task_id,member_id,start_date,end_date,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(v5TaskId, assignment.member_id, assignment.start_date, assignment.end_date, stamp, stamp);
    }
    if (legacyPlan?.primary_member_id && memberExists(database, legacyPlan.primary_member_id) && !database.prepare("SELECT 1 FROM v5_task_members WHERE task_id=? AND member_id=?").get(v5TaskId, legacyPlan.primary_member_id)) database.prepare("INSERT INTO v5_task_members(task_id,member_id,start_date,end_date,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(v5TaskId, legacyPlan.primary_member_id, task.default_start_date, task.default_end_date, stamp, stamp);
  }
  // A V2 plan/task may have been created after the first V5 migration. Enrich
  // only still-unclassified projections, preserving any deliberate V5 edits.
  for (const task of database.prepare("SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY id").all()) {
    const target = database.prepare("SELECT * FROM v5_tasks WHERE legacy_task_id=?").get(task.id);
    const legacyPlan = v5LegacyV2PlanData(database, task.id);
    if (target && legacyPlan) v5CopyLegacyV2Details(database, target, legacyPlan);
  }
}

export function validateV5Schema(database) {
  const actualTables = new Set(tables(database, "table"));
  const actualIndexes = new Set(tables(database, "index"));
  for (const name of V5_TABLES) if (!actualTables.has(name)) throw new Error(`V5 schema missing table: ${name}`);
  for (const name of V5_INDEXES) if (!actualIndexes.has(name)) throw new Error(`V5 schema missing index: ${name}`);
  const version = database.prepare("SELECT version,name,checksum,applied_at FROM v5_schema_versions WHERE version=1").get();
  if (!version || version.name !== "v5-three-modules" || version.checksum !== V5_SCHEMA_CHECKSUM) throw new Error("V5 schema checksum mismatch");
  const violations = database.prepare("PRAGMA foreign_key_check").all();
  if (violations.length) throw new Error(`V5 foreign key violations: ${violations.length}`);
  return version;
}

export function migrateV5Schema(database) {
  const names = new Set(tables(database, "table"));
  if (!names.has("v5_schema_versions")) {
    const partial = [...names].filter((name) => name.startsWith("v5_"));
    if (partial.length) throw new Error(`Partial V5 migration detected: ${partial.join(",")}`);
    transaction(database, () => {
      database.exec(V5_SCHEMA_SQL);
      database.prepare("INSERT INTO v5_schema_versions(version,name,checksum,applied_at) VALUES(1,'v5-three-modules',?,?)").run(V5_SCHEMA_CHECKSUM, now());
      v5EnsureUnassignedTopic(database);
      v5SyncLegacyData(database);
    });
    return { migrated: true, version: validateV5Schema(database) };
  }
  const current = database.prepare("SELECT * FROM v5_schema_versions WHERE version=1").get();
  if (!current || current.checksum !== V5_SCHEMA_CHECKSUM || current.name !== "v5-three-modules") throw new Error("V5 schema checksum mismatch");
  transaction(database, () => { v5EnsureUnassignedTopic(database); v5SyncLegacyData(database); });
  return { migrated: false, version: validateV5Schema(database) };
}

function ensureTopic(database, topicId, includeArchived = false) { const row = database.prepare("SELECT * FROM v3_topics WHERE id=?").get(topicId); if (!row || (!includeArchived && row.archived_at)) fail(404, "NOT_FOUND", { resource: "topic", id: topicId }); return row; }
function ensureSample(database, sampleId, includeArchived = false) { const row = database.prepare("SELECT * FROM v3_samples WHERE id=?").get(sampleId); if (!row || (!includeArchived && row.archived_at)) fail(404, "NOT_FOUND", { resource: "sample", id: sampleId }); return row; }
function ensureTask(database, taskId) { const row = database.prepare("SELECT * FROM v3_topic_tasks WHERE id=?").get(taskId); if (!row) fail(404, "NOT_FOUND", { resource: "topic_task", id: taskId }); return row; }
function actor(payload) { return trim(payload.actor ?? payload.submitted_by ?? payload.reviewer ?? "本地用户", "actor", 1, 100); }
function event(database, topicId, type, values = {}) { database.prepare("INSERT INTO v3_topic_events(topic_id,topic_task_id,sample_id,event_type,actor,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?)").run(topicId, values.taskId ?? null, values.sampleId ?? null, type, values.actor || "本地用户", values.before == null ? null : JSON.stringify(values.before), values.after == null ? null : JSON.stringify(values.after), now()); }
function expected(row, payload) { if (payload.expected_version !== undefined && Number(payload.expected_version) !== row.version) fail(409, "VERSION_CONFLICT", { expected_version: payload.expected_version, actual_version: row.version }); }
function listIds(input, field) { if (input === undefined) return []; if (!Array.isArray(input)) fail(400, "VALIDATION_ERROR", { field, reason: "array required" }); const values = input.map((v) => id(v, field)); const unique = [...new Set(values)].sort((a, b) => a - b); if (unique.length !== values.length) fail(400, "VALIDATION_ERROR", { field, reason: "duplicates are not allowed" }); return unique; }
function sampleRows(database, taskId) { return database.prepare("SELECT s.* FROM v3_samples s JOIN v3_task_samples ts ON ts.sample_id=s.id WHERE ts.topic_task_id=? AND s.archived_at IS NULL ORDER BY s.id").all(taskId); }
function readiness(database, taskId) { const rows = sampleRows(database, taskId); if (!rows.length || rows.some((r) => r.eta_pending || !r.current_eta_date)) return null; return rows.reduce((max, r) => max > r.current_eta_date ? max : r.current_eta_date, rows[0].current_eta_date); }
function memberExists(database, memberId) { return Boolean(database.prepare("SELECT 1 FROM members WHERE id=? AND deleted_at IS NULL").get(memberId)); }
function storedTestItems(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function normalizeTestItems(input, existing = null) {
  const raw = input === undefined ? storedTestItems(existing?.test_items_json) : input;
  if (raw == null) return [];
  if (!Array.isArray(raw)) fail(400, "VALIDATION_ERROR", { field: "test_items", reason: "array required" });
  return raw.map((item, index) => {
    const source = typeof item === "string" ? { name: item } : item;
    if (!source || typeof source !== "object") fail(400, "VALIDATION_ERROR", { field: `test_items[${index}]`, reason: "object required" });
    return {
      position: index,
      name: trim(source.name ?? source.label, `test_items[${index}].name`, 1, 300),
      acceptance_criteria: trim(source.acceptance_criteria ?? source.acceptance ?? "", `test_items[${index}].acceptance_criteria`, 0, 1000),
      is_required: bool(source.is_required ?? 1, `test_items[${index}].is_required`),
      note: trim(source.note ?? "", `test_items[${index}].note`, 0, 1000)
    };
  });
}
function normalizeTask(database, topicId, payload, existing = null) {
  const title = trim(payload.title ?? existing?.title, "title", 1, 200);
  const description = trim(payload.description ?? existing?.description ?? "", "description", 0, 4000);
  const testPurpose = trim(payload.test_purpose ?? existing?.test_purpose ?? "", "test_purpose", 0, 4000);
  const testItems = normalizeTestItems(payload.test_items, existing);
  const sampleIds = listIds(payload.sample_ids ?? (existing ? sampleRows(database, existing.id).map((s) => s.id) : []), "sample_ids");
  if (!sampleIds.length) fail(400, "VALIDATION_ERROR", { field: "sample_ids", reason: "at least one sample required" });
  for (const sampleId of sampleIds) { const sample = ensureSample(database, sampleId); if (sample.topic_id !== topicId) fail(400, "CROSS_TOPIC_REFERENCE", { sample_id: sampleId }); }
  const position = Number(payload.position ?? existing?.position ?? 0); if (!Number.isInteger(position) || position < 0) fail(400, "VALIDATION_ERROR", { field: "position", reason: "non-negative integer required" });
  const isRequired = bool(payload.is_required ?? existing?.is_required ?? 1, "is_required");
  const primary = id(payload.primary_member_id ?? existing?.primary_member_id, "primary_member_id"); if (!memberExists(database, primary)) fail(400, "VALIDATION_ERROR", { field: "primary_member_id", reason: "member not found" });
  const participants = listIds(payload.participant_member_ids ?? [], "participant_member_ids");
  const allMembers = [...new Set([primary, ...participants])]; for (const memberId of allMembers) if (!memberExists(database, memberId)) fail(400, "VALIDATION_ERROR", { field: "participant_member_ids", reason: "member not found" });
  const effortsInput = payload.member_efforts || allMembers.map((memberId) => ({ member_id: memberId, planned_half_hours: memberId === primary ? 1 : 0 }));
  if (!Array.isArray(effortsInput)) fail(400, "VALIDATION_ERROR", { field: "member_efforts", reason: "array required" });
  const efforts = effortsInput.map((item) => { const memberId = id(item.member_id, "member_efforts.member_id"); if (!allMembers.includes(memberId)) fail(400, "VALIDATION_ERROR", { field: "member_efforts", reason: "member must be assigned" }); const half = Number(item.planned_half_hours); if (!Number.isInteger(half) || half < 0) fail(400, "VALIDATION_ERROR", { field: "planned_half_hours", reason: "0.5h step required" }); return { member_id: memberId, planned_half_hours: half }; });
  const cryoPending = bool(payload.cryostat_pending ?? existing?.cryostat_pending ?? 0, "cryostat_pending"); const cryo = payload.cryostat_id === null ? null : (payload.cryostat_id === undefined ? (existing?.cryostat_id ?? null) : id(payload.cryostat_id, "cryostat_id")); if (cryoPending && cryo !== null || !cryoPending && cryo === null) fail(400, "VALIDATION_ERROR", { field: "cryostat_id", reason: "cryostat and pending are mutually exclusive" });
  const start = date(payload.start_date ?? existing?.start_date, "start_date"); const end = date(payload.end_date ?? existing?.end_date, "end_date"); if ((start && !end) || (!start && end) || (start && end && start > end)) fail(400, "VALIDATION_ERROR", { field: "end_date", reason: "valid date range required" });
  const predecessor = payload.predecessor_task_id == null ? null : id(payload.predecessor_task_id, "predecessor_task_id");
  if (predecessor != null) { const predecessorRow = ensureTask(database, predecessor); if (predecessorRow.topic_id !== topicId) fail(400, "CROSS_TOPIC_REFERENCE", { field: "predecessor_task_id" }); if (existing?.id === predecessor || predecessorRow.position >= position) fail(409, "DEPENDENCY_CYCLE", { predecessor_task_id: predecessor, position }); }
  return { title, description, test_purpose: testPurpose, test_items: testItems, sample_ids: sampleIds, position, is_required: isRequired, primary_member_id: primary, participant_member_ids: allMembers.filter((m) => m !== primary), member_efforts: efforts, cryostat_id: cryo, cryostat_pending: cryoPending, start_date: start, end_date: end, after_arrival: bool(payload.after_arrival ?? existing?.after_arrival ?? 0, "after_arrival"), predecessor_task_id: predecessor };
}
function taskConflicts(database, normalized, topicId, existing = null) {
  const conflicts = []; const members = normalized.member_efforts.filter((e) => e.planned_half_hours > 0).map((e) => e.member_id);
  if (normalized.start_date && normalized.end_date) {
    const params = [normalized.start_date, normalized.end_date, ...members];
    if (members.length) {
      const marks = members.map(() => "?").join(",");
      const rows = database.prepare(`SELECT t.id,t.title,a.member_id,a.start_date,a.end_date FROM task_assignments a JOIN tasks t ON t.id=a.task_id WHERE t.deleted_at IS NULL AND a.member_id IN (${marks}) AND a.start_date<=? AND a.end_date>=?`).all(...members, normalized.end_date, normalized.start_date);
      for (const row of rows) if (existing?.task_id == null || row.id !== existing.task_id) conflicts.push({ type: "MEMBER_DATE_OVERLAP", task_id: row.id, member_id: row.member_id, date: row.start_date });
      const v3Rows = database.prepare(`SELECT tt.id,tt.topic_id,e.member_id,tt.start_date,tt.end_date FROM v3_topic_tasks tt JOIN v3_task_member_efforts e ON e.topic_task_id=tt.id JOIN v3_topics tp ON tp.id=tt.topic_id WHERE tp.archived_at IS NULL AND tt.id<>? AND e.member_id IN (${marks}) AND e.planned_half_hours>0 AND tt.start_date<=? AND tt.end_date>=?`).all(existing?.id || -1, ...members, normalized.end_date, normalized.start_date);
      for (const row of v3Rows) conflicts.push({ type: "MEMBER_DATE_OVERLAP", task_id: row.id, topic_id: row.topic_id, member_id: row.member_id, date: row.start_date });
    }
    if (normalized.cryostat_id != null) {
      const rows = database.prepare("SELECT tt.id,tt.title,tt.topic_id,tt.start_date,tt.end_date FROM v3_topic_tasks tt JOIN v3_topics tp ON tp.id=tt.topic_id WHERE tt.cryostat_id=? AND tt.start_date<=? AND tt.end_date>=? AND tt.id<>? AND tp.archived_at IS NULL AND tt.topic_id<>?").all(normalized.cryostat_id, normalized.end_date, normalized.start_date, existing?.id || -1, topicId);
      for (const row of rows) conflicts.push({ type: "CRYOSTAT_DATE_OVERLAP", task_id: row.id, topic_id: row.topic_id, date: row.start_date });
    }
  }
  const total = normalized.member_efforts.reduce((sum, item) => sum + item.planned_half_hours, 0); if (total > 80) conflicts.push({ type: "MEMBER_WEEKLY_LOAD", total_half_hours: total });
  return conflicts.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function token(input, facts, conflicts) { return createHash("sha256").update(JSON.stringify({ input, facts, conflicts, checksum: V3_SCHEMA_CHECKSUM })).digest("hex"); }
function previewTask(database, topicId, payload, existing = null) { const normalized = normalizeTask(database, topicId, payload, existing); const conflicts = taskConflicts(database, normalized, topicId, existing); const positionOwner = database.prepare("SELECT id FROM v3_topic_tasks WHERE topic_id=? AND position=? AND id<>?").get(topicId, normalized.position, existing?.id ?? -1); if (positionOwner) conflicts.push({ type: "POSITION_CONFLICT", task_id: positionOwner.id, position: normalized.position }); conflicts.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); const facts = { topicId, existingId: existing?.id ?? null, version: existing?.version ?? null, readiness: existing ? readiness(database, existing.id) : null }; return { normalized_input: normalized, conflicts, preview_token: token(normalized, facts, conflicts) }; }
function requirePreview(payload, normalized, facts, conflicts) { if (!payload.preview_token || payload.preview_token !== token(normalized, facts, conflicts)) fail(409, "STALE_PREVIEW", { reason: "preview token no longer matches" }); }
function conflictAck(payload, conflicts) { if (conflicts.length && !payload.ack) fail(409, "CONFLICTS_NOT_ACKNOWLEDGED", { conflicts }); }

function topicData(database, row) { const samples = database.prepare("SELECT COUNT(*) AS count FROM v3_samples WHERE topic_id=? AND archived_at IS NULL").get(row.id).count; const tasks = database.prepare("SELECT COUNT(*) AS count FROM v3_topic_tasks WHERE topic_id=?").get(row.id).count; return { ...row, sample_count: samples, task_count: tasks }; }
function listTopics(database, url) { const includeArchived = url.searchParams.get("include_archived") === "1"; const params = []; const where = [includeArchived ? "1=1" : "t.archived_at IS NULL"]; const search = url.searchParams.get("search"); if (search) { where.push("(t.name LIKE ? OR t.purpose LIKE ?)"); params.push(`%${search}%`, `%${search}%`); } const rows = database.prepare(`SELECT t.* FROM v3_topics t WHERE ${where.join(" AND ")} ORDER BY t.updated_at DESC,t.id DESC`).all(...params).map((r) => topicData(database, r)); const active = rows.filter((r) => !r.archived_at); const groups = database.prepare("SELECT id,name,is_active FROM v2_source_groups ORDER BY name COLLATE NOCASE").all(); const cryostats = database.prepare("SELECT id,name,status FROM v2_cryostats ORDER BY name COLLATE NOCASE").all(); return { items: rows, groups, cryostats, stats: { total: active.length, samples: active.reduce((sum, t) => sum + t.sample_count, 0), tasks: active.reduce((sum, t) => sum + t.task_count, 0) }, total: rows.length }; }
function taskData(database, row) {
  const samples = sampleRows(database, row.id).map((s) => ({ id: s.id, model: s.model, planning_label: s.planning_label, current_eta_date: s.current_eta_date, eta_pending: s.eta_pending, actual_arrival_date: s.actual_arrival_date }));
  const efforts = database.prepare("SELECT e.*,m.name FROM v3_task_member_efforts e JOIN members m ON m.id=e.member_id WHERE e.topic_task_id=? ORDER BY e.member_id").all(row.id);
  const linked = row.task_id == null ? null : database.prepare("SELECT status FROM tasks WHERE id=?").get(row.task_id);
  const context = database.prepare("SELECT tp.id AS topic_id,tp.name AS topic_name,tp.purpose AS topic_purpose,sg.id AS source_group_id,sg.name AS source_group_name,c.id AS cryostat_id,c.name AS cryostat_name FROM v3_topic_tasks tt JOIN v3_topics tp ON tp.id=tt.topic_id JOIN v2_source_groups sg ON sg.id=tp.source_group_id LEFT JOIN v2_cryostats c ON c.id=tt.cryostat_id WHERE tt.id=?").get(row.id);
  const dependency = database.prepare("SELECT predecessor_task_id FROM v3_task_dependencies WHERE successor_task_id=?").get(row.id);
  const status = linked?.status === "completed" ? "completed" : (row.start_date && row.start_date <= todayIsoDate() ? "active" : "planned");
  return {
    ...row,
    test_purpose: row.test_purpose || "",
    test_items: storedTestItems(row.test_items_json),
    topic: context ? { id: context.topic_id, name: context.topic_name, purpose: context.topic_purpose } : null,
    source_group: context ? { id: context.source_group_id, name: context.source_group_name } : null,
    cryostat: context?.cryostat_id ? { id: context.cryostat_id, name: context.cryostat_name } : null,
    predecessor_task_id: dependency?.predecessor_task_id ?? null,
    samples,
    efforts,
    total_half_hours: efforts.reduce((sum, e) => sum + e.planned_half_hours, 0),
    readiness_date: readiness(database, row.id),
    display_status: status
  };
}
function exactSampleSet(database, taskId, supplied) { const actual = sampleRows(database, taskId).map((s) => s.id); const input = listIds(supplied, "sample_ids"); if (actual.length !== input.length || actual.some((v, i) => v !== input[i])) fail(400, "SAMPLE_SET_MISMATCH", { expected: actual, received: input }); return actual; }
function parseChecklist(database, topicId, payload) { const template = database.prepare("SELECT * FROM v3_acceptance_templates WHERE topic_id=? AND is_active=1").get(topicId); const items = template ? database.prepare("SELECT * FROM v3_acceptance_template_items WHERE template_id=? ORDER BY position").all(template.id) : []; const incoming = payload.template_item_ids; if (!Array.isArray(incoming)) fail(400, "CHECKLIST_ITEM_SET_MISMATCH", { reason: "template_item_ids required" }); const ids = incoming.map((i) => id(i.id, "template_item_ids.id")); const expectedIds = items.map((i) => i.id); if (ids.length !== expectedIds.length || [...ids].sort((a,b)=>a-b).some((v,i)=>v !== [...expectedIds].sort((a,b)=>a-b)[i]) || new Set(ids).size !== ids.length) fail(400, "CHECKLIST_ITEM_SET_MISMATCH", { expected: expectedIds, received: ids }); return items.map((item) => { const got = incoming.find((i) => Number(i.id) === item.id); return { id: item.id, label: item.label, position: item.position, checked: Boolean(got.checked) }; }); }

function cryostatPreviewState(database, topicId, taskIds, cryostatId) {
  const selected = taskIds.length ? [...new Set(taskIds)] : database.prepare("SELECT id FROM v3_topic_tasks WHERE topic_id=? ORDER BY position,id").all(topicId).map((row) => row.id);
  const selectedRows = selected.length ? database.prepare(`SELECT id,start_date,end_date,version FROM v3_topic_tasks WHERE topic_id=? AND id IN (${selected.map(() => "?").join(",")}) ORDER BY id`).all(topicId, ...selected) : [];
  const conflicts = [];
  if (cryostatId != null && selectedRows.length) {
    const marks = selectedRows.map(() => "?").join(",");
    for (const candidate of selectedRows) {
      if (!candidate.start_date || !candidate.end_date) continue;
      const rows = database.prepare(`SELECT tt.id,tt.topic_id,tt.start_date,tt.end_date FROM v3_topic_tasks tt JOIN v3_topics tp ON tp.id=tt.topic_id WHERE tt.cryostat_id=? AND tt.topic_id<>? AND tt.id NOT IN (${marks}) AND tp.archived_at IS NULL AND tt.start_date<=? AND tt.end_date>=? ORDER BY tt.id`).all(cryostatId, topicId, ...selected, candidate.end_date, candidate.start_date);
      for (const row of rows) conflicts.push({ type: "CRYOSTAT_DATE_OVERLAP", task_id: row.id, topic_id: row.topic_id, date: row.start_date, candidate_task_id: candidate.id });
    }
  }
  const unique = new Map(conflicts.map((row) => [`${row.candidate_task_id}:${row.task_id}`, row]));
  return { selected, selectedRows, conflicts: [...unique.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
}

export async function routeV3Api(req, res, database, url) {
  try {
    seedV3ReferenceResources(database);
    const path = url.pathname; const method = req.method; let match;
    if (method === "GET" && path === "/api/v3/status") return response(res, 200, { schema_version: 3, checksum: V3_SCHEMA_CHECKSUM, tables: V3_TABLES.length, indexes: V3_INDEXES.length, endpoints: V3_ENDPOINTS.length, v2_compat: true });
    if (method === "GET" && path === "/api/v3/backup") return response(res, 200, { created_at: now(), source: "sqlite", checksum: V3_SCHEMA_CHECKSUM });
    if (method === "GET" && path === "/api/v3/topics") return response(res, 200, listTopics(database, url));
    if (method === "POST" && path === "/api/v3/topics") { const p = await body(req); const source = id(p.source_group_id, "source_group_id"); const name = trim(p.name, "name", 1, 200); const purpose = trim(p.purpose, "purpose", 1, 4000); const contact = p.source_contact_id == null ? null : id(p.source_contact_id, "source_contact_id"); if (contact && !database.prepare("SELECT 1 FROM v2_source_contacts WHERE id=? AND source_group_id=?").get(contact, source)) fail(400, "VALIDATION_ERROR", { field: "source_contact_id", reason: "contact not in source group" }); const cryo = p.default_cryostat_id == null ? null : id(p.default_cryostat_id, "default_cryostat_id"); const timestamp = now(); const row = transaction(database, () => { const result = database.prepare("INSERT INTO v3_topics(source_group_id,source_contact_id,name,purpose,default_cryostat_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(source, contact, name, purpose, cryo, timestamp, timestamp); event(database, Number(result.lastInsertRowid), "topic_create", { actor: actor(p), after: p }); return database.prepare("SELECT * FROM v3_topics WHERE id=?").get(Number(result.lastInsertRowid)); }); return response(res, 201, topicData(database, row)); }
    match = path.match(/^\/api\/v3\/topics\/(\d+)$/); if (match && method === "GET") return response(res, 200, topicData(database, ensureTopic(database, id(match[1]))));
    if (match && method === "PUT") { const topic = ensureTopic(database, id(match[1])); const p = await body(req); expected(topic, p); const source = p.source_group_id === undefined ? topic.source_group_id : id(p.source_group_id, "source_group_id"); const name = trim(p.name ?? topic.name, "name", 1, 200); const purpose = trim(p.purpose ?? topic.purpose, "purpose", 1, 4000); const contact = p.source_contact_id === undefined ? topic.source_contact_id : (p.source_contact_id == null ? null : id(p.source_contact_id, "source_contact_id")); if (contact && !database.prepare("SELECT 1 FROM v2_source_contacts WHERE id=? AND source_group_id=?").get(contact, source)) fail(400, "VALIDATION_ERROR", { field: "source_contact_id", reason: "contact not in source group" }); const cryo = p.default_cryostat_id === undefined ? topic.default_cryostat_id : (p.default_cryostat_id == null ? null : id(p.default_cryostat_id, "default_cryostat_id")); const row = transaction(database, () => { database.prepare("UPDATE v3_topics SET source_group_id=?,source_contact_id=?,name=?,purpose=?,default_cryostat_id=?,version=version+1,updated_at=? WHERE id=?").run(source, contact, name, purpose, cryo, now(), topic.id); event(database, topic.id, "topic_update", { actor: actor(p), before: topic, after: { source_group_id: source, name, purpose, contact, cryo } }); return database.prepare("SELECT * FROM v3_topics WHERE id=?").get(topic.id); }); return response(res, 200, topicData(database, row)); }
    match = path.match(/^\/api\/v3\/topics\/(\d+)\/(archive|restore)$/); if (match && method === "POST") { const topic = ensureTopic(database, id(match[1]), true); const p = await body(req); expected(topic, p); const archived = match[2] === "archive"; const row = transaction(database, () => { database.prepare("UPDATE v3_topics SET archived_at=?,version=version+1,updated_at=? WHERE id=?").run(archived ? now() : null, now(), topic.id); event(database, topic.id, archived ? "topic_archive" : "topic_restore", { actor: actor(p), before: topic }); return database.prepare("SELECT * FROM v3_topics WHERE id=?").get(topic.id); }); return response(res, 200, topicData(database, row)); }
    match = path.match(/^\/api\/v3\/topics\/(\d+)\/samples$/); if (match && method === "GET") { ensureTopic(database, id(match[1])); return response(res, 200, { items: database.prepare("SELECT * FROM v3_samples WHERE topic_id=? AND archived_at IS NULL ORDER BY current_eta_date IS NULL,current_eta_date,id").all(id(match[1])) }); }
    if (match && method === "POST") { const topic = ensureTopic(database, id(match[1])); const p = await body(req); const label = trim(p.planning_label, "planning_label", 1, 200); const model = trim(p.model, "model", 1, 200); const pending = bool(p.eta_pending, "eta_pending"); const eta = date(p.eta_date ?? null, "eta_date"); const initialEta = p.initial_eta_date === undefined ? eta : date(p.initial_eta_date, "initial_eta_date"); if (pending && eta || !pending && !eta) fail(400, "VALIDATION_ERROR", { field: "eta_date", reason: "eta or pending required" }); const timestamp = now(); const row = transaction(database, () => { const result = database.prepare("INSERT INTO v3_samples(topic_id,planning_label,model,formal_identifier,temporary_identifier,initial_eta_date,current_eta_date,eta_pending,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(topic.id, label, model, p.formal_identifier ?? null, p.temporary_identifier ?? null, initialEta, eta, pending, trim(p.notes ?? "", "notes", 0, 2000), timestamp, timestamp); event(database, topic.id, "sample_create", { actor: actor(p), sampleId: Number(result.lastInsertRowid), after: p }); return database.prepare("SELECT * FROM v3_samples WHERE id=?").get(Number(result.lastInsertRowid)); }); return response(res, 201, row); }
    match = path.match(/^\/api\/v3\/samples\/(\d+)$/); if (match && method === "GET") return response(res, 200, ensureSample(database, id(match[1])));
    if (match && method === "PUT") { const sample = ensureSample(database, id(match[1])); const p = await body(req); expected(sample, p); const next = { label: trim(p.planning_label ?? sample.planning_label, "planning_label", 1, 200), model: trim(p.model ?? sample.model, "model", 1, 200), initial_eta: p.initial_eta_date === undefined ? sample.initial_eta_date : date(p.initial_eta_date, "initial_eta_date"), formal: p.formal_identifier === undefined ? sample.formal_identifier : (p.formal_identifier == null ? null : trim(p.formal_identifier, "formal_identifier", 1, 200)), temporary: p.temporary_identifier === undefined ? sample.temporary_identifier : (p.temporary_identifier == null ? null : trim(p.temporary_identifier, "temporary_identifier", 1, 200)), notes: trim(p.notes ?? sample.notes, "notes", 0, 2000) }; const row = transaction(database, () => { database.prepare("UPDATE v3_samples SET planning_label=?,model=?,formal_identifier=?,temporary_identifier=?,initial_eta_date=?,notes=?,version=version+1,updated_at=? WHERE id=?").run(next.label,next.model,next.formal,next.temporary,next.initial_eta,next.notes,now(),sample.id); event(database, sample.topic_id, "sample_update", { actor: actor(p), sampleId: sample.id, before: sample, after: next }); return database.prepare("SELECT * FROM v3_samples WHERE id=?").get(sample.id); }); return response(res, 200, row); }
    match = path.match(/^\/api\/v3\/samples\/(\d+)\/(archive|restore)$/); if (match && method === "POST") { const sample = ensureSample(database, id(match[1]), true); const p = await body(req); expected(sample, p); const row = transaction(database, () => { database.prepare("UPDATE v3_samples SET archived_at=?,version=version+1,updated_at=? WHERE id=?").run(match[2] === "archive" ? now() : null, now(), sample.id); event(database, sample.topic_id, `sample_${match[2]}`, { actor: actor(p), sampleId: sample.id }); return database.prepare("SELECT * FROM v3_samples WHERE id=?").get(sample.id); }); return response(res, 200, row); }
    match = path.match(/^\/api\/v3\/samples\/(\d+)\/arrival$/); if (match && method === "POST") { const sample = ensureSample(database, id(match[1])); const p = await body(req); expected(sample,p); const arrived = date(p.actual_arrival_date, "actual_arrival_date", false); const row = transaction(database, () => { database.prepare("UPDATE v3_samples SET actual_arrival_date=?,version=version+1,updated_at=? WHERE id=?").run(arrived,now(),sample.id); event(database,sample.topic_id,"sample_arrival",{actor:actor(p),sampleId:sample.id,before:sample,after:{actual_arrival_date:arrived}}); return database.prepare("SELECT * FROM v3_samples WHERE id=?").get(sample.id); }); return response(res,200,row); }
    match = path.match(/^\/api\/v3\/samples\/(\d+)\/eta\/(preview|confirm)$/); if (match && method === "POST") { const sample = ensureSample(database, id(match[1])); const p = await body(req); const pending = bool(p.eta_pending,"eta_pending"); const newEta = date(p.new_eta_date ?? null,"new_eta_date"); if ((pending && newEta) || (!pending && !newEta)) fail(400,"VALIDATION_ERROR",{field:"new_eta_date",reason:"eta or pending required"}); const selected = listIds(p.selected_task_ids,"selected_task_ids"); const tasks = database.prepare("SELECT tt.* FROM v3_topic_tasks tt JOIN v3_task_samples ts ON ts.topic_task_id=tt.id WHERE ts.sample_id=? ORDER BY tt.id").all(sample.id); const candidates = newEta ? tasks.filter((t) => t.after_arrival && t.start_date && t.start_date > newEta && t.status_source === "manual").map((t) => ({ task_id:t.id, old_start_date:t.start_date, old_end_date:t.end_date, new_start_date:t.start_date, new_end_date:t.end_date })) : []; const facts = { sample_id:sample.id,version:sample.version,current_eta_date:sample.current_eta_date,eta_pending:sample.eta_pending,task_ids:tasks.map((t)=>t.id) }; const input = {new_eta_date:newEta,eta_pending:pending,selected_task_ids:selected}; const conflicts=[]; const preview={ normalized_input:input, eligible_tasks:candidates, selected_task_ids:selected, conflicts, preview_token:token(input,facts,conflicts) }; if (match[2] === "preview") return response(res,200,preview); if (!p.preview_token || p.preview_token !== preview.preview_token) fail(409,"STALE_PREVIEW",{reason:"eta facts changed"}); if (selected.some((taskId)=>!candidates.some((c)=>c.task_id===taskId))) fail(400,"VALIDATION_ERROR",{field:"selected_task_ids",reason:"task is not eligible"}); const row=transaction(database,()=>{ database.prepare("UPDATE v3_samples SET initial_eta_date=COALESCE(initial_eta_date,?),current_eta_date=?,eta_pending=?,version=version+1,updated_at=? WHERE id=?").run(newEta,newEta,pending,now(),sample.id); for(const taskId of selected){const c=candidates.find((x)=>x.task_id===taskId); const delta = newEta && sample.current_eta_date ? Math.round((Date.parse(`${newEta}T00:00:00Z`)-Date.parse(`${sample.current_eta_date}T00:00:00Z`))/86400000) : 0; database.prepare("UPDATE v3_topic_tasks SET start_date=date(start_date, ? || ' days'), end_date=date(end_date, ? || ' days'),version=version+1,updated_at=? WHERE id=?").run(`${delta>=0?'+':''}${delta}`,`${delta>=0?'+':''}${delta}`,now(),taskId); event(database,sample.topic_id,"sample_eta_confirm",{actor:actor(p),sampleId:sample.id,taskId,after:{new_eta_date:newEta}}); c.new_start_date=database.prepare("SELECT start_date FROM v3_topic_tasks WHERE id=?").get(taskId).start_date; c.new_end_date=database.prepare("SELECT end_date FROM v3_topic_tasks WHERE id=?").get(taskId).end_date;} return database.prepare("SELECT * FROM v3_samples WHERE id=?").get(sample.id); }); return response(res,200,{sample:row,moved_tasks:candidates.filter(c=>selected.includes(c.task_id))}); }
    match = path.match(/^\/api\/v3\/topics\/(\d+)\/cryostat\/(preview|confirm)$/);
    if (match && method === "POST") {
      const topic = ensureTopic(database, id(match[1])); const p = await body(req);
      const pending = bool(p.cryostat_pending, "cryostat_pending"); const cryo = p.new_cryostat_id == null ? null : id(p.new_cryostat_id, "new_cryostat_id");
      if ((pending && cryo) || (!pending && !cryo)) fail(400, "VALIDATION_ERROR", { field: "new_cryostat_id", reason: "cryostat or pending required" });
      const taskIds = listIds(p.task_ids, "task_ids"); const state = cryostatPreviewState(database, topic.id, taskIds, cryo);
      if (taskIds.length && state.selectedRows.length !== state.selected.length) fail(400, "CROSS_TOPIC_REFERENCE", { field: "task_ids" });
      const input = { new_cryostat_id: cryo, cryostat_pending: pending, task_ids: taskIds };
      const facts = { topic_id: topic.id, version: topic.version, tasks: state.selectedRows };
      const preview = { normalized_input: input, conflicts: state.conflicts, preview_token: token(input, facts, state.conflicts) };
      if (match[2] === "preview") return response(res, 200, preview);
      if (p.preview_token !== preview.preview_token) fail(409, "STALE_PREVIEW", {});
      conflictAck(p, state.conflicts);
      const row = transaction(database, () => {
        const query = taskIds.length ? `UPDATE v3_topic_tasks SET cryostat_id=?,cryostat_pending=?,version=version+1,updated_at=? WHERE topic_id=? AND id IN (${taskIds.map(() => "?").join(",")})` : "UPDATE v3_topic_tasks SET cryostat_id=?,cryostat_pending=?,version=version+1,updated_at=? WHERE topic_id=?";
        database.prepare(query).run(...[cryo, pending, now(), topic.id, ...taskIds]);
        event(database, topic.id, "cryostat_confirm", { actor: actor(p), after: input });
        return database.prepare("SELECT * FROM v3_topic_tasks WHERE topic_id=? ORDER BY position").all(topic.id);
      });
      return response(res, 200, { tasks: row });
    }
    match = path.match(/^\/api\/v3\/topics\/(\d+)\/legacy-plans\/(preview|confirm)$/); if(match&&method==="POST"){const topic=ensureTopic(database,id(match[1]));const p=await body(req);const planIds=listIds(p.v2_plan_ids,"v2_plan_ids");const plans=planIds.map((planId)=>{const row=database.prepare("SELECT * FROM v2_control_plans WHERE id=?").get(planId);if(!row)fail(404,"NOT_FOUND",{resource:"v2_plan",id:planId});return row;});const snapshot={plans:plans.map((plan)=>({id:plan.id,name:plan.name,purpose:plan.purpose,sample_model:plan.sample_model,current_eta_date:plan.current_eta_date}))};const preview={snapshot,preview_token:token(snapshot,{topic_id:topic.id},[])};if(match[2]==="preview")return response(res,200,preview);if(p.preview_token!==preview.preview_token)fail(409,"STALE_PREVIEW",{});const rows=transaction(database,()=>{for(const plan of plans){database.prepare("INSERT OR IGNORE INTO v3_topic_plan_links(topic_id,v2_plan_id,copy_mode,snapshot_json,copied_by,copied_at) VALUES(?,?,?,?,?,?)").run(topic.id,plan.id,"snapshot",JSON.stringify(plan),actor(p),now());}event(database,topic.id,"legacy_plan_copy",{actor:actor(p),after:snapshot});return database.prepare("SELECT * FROM v3_topic_plan_links WHERE topic_id=? ORDER BY v2_plan_id").all(topic.id);});return response(res,201,rows);}
    match = path.match(/^\/api\/v3\/topics\/(\d+)\/legacy-plans\/(\d+)\/unlink$/); if(match&&method==="POST"){const topic=ensureTopic(database,id(match[1]));const planId=id(match[2],"plan_id");const p=await body(req);const row=transaction(database,()=>{database.prepare("DELETE FROM v3_topic_plan_links WHERE topic_id=? AND v2_plan_id=?").run(topic.id,planId);event(database,topic.id,"legacy_plan_unlink",{actor:actor(p),after:{v2_plan_id:planId}});return {topic_id:topic.id,v2_plan_id:planId};});return response(res,200,row);}
    match = path.match(/^\/api\/v3\/topics\/(\d+)\/tasks(\/preview)?$/); if(match&&method==="GET"&&!match[2]){const topic=ensureTopic(database,id(match[1]));return response(res,200,{items:database.prepare("SELECT * FROM v3_topic_tasks WHERE topic_id=? ORDER BY position,id").all(topic.id).map((r)=>taskData(database,r))});}
    if(match&&method==="POST"){const topic=ensureTopic(database,id(match[1]));const p=await body(req);const preview=previewTask(database,topic.id,p);if(match[2]||p.preview_only===true)return response(res,200,preview);requirePreview(p,preview.normalized_input,{topicId:topic.id,existingId:null,version:null,readiness:null},preview.conflicts);conflictAck(p,preview.conflicts);const row=transaction(database,()=>{const timestamp=now();const today=todayIsoDate();const start=preview.normalized_input.start_date||today;const end=preview.normalized_input.end_date||start;const v1Result=database.prepare("INSERT INTO tasks(title,description,default_start_date,default_end_date,color,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(preview.normalized_input.title,preview.normalized_input.description,start,end,"#2563eb",start>today?"planned":"active",timestamp,timestamp);const v1TaskId=Number(v1Result.lastInsertRowid);for(const effort of preview.normalized_input.member_efforts)if(effort.planned_half_hours>0)database.prepare("INSERT INTO task_assignments(task_id,member_id,start_date,end_date,progress,note,created_at,updated_at) VALUES(?,?,?,?,0,'',?,?)").run(v1TaskId,effort.member_id,start,end,timestamp,timestamp);const result=database.prepare("INSERT INTO v3_topic_tasks(topic_id,task_id,task_lineage_key,title,description,test_purpose,test_items_json,position,is_required,primary_member_id,cryostat_id,cryostat_pending,start_date,end_date,after_arrival,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(topic.id,v1TaskId,uuid(randomUUID()),preview.normalized_input.title,preview.normalized_input.description,preview.normalized_input.test_purpose,JSON.stringify(preview.normalized_input.test_items),preview.normalized_input.position,preview.normalized_input.is_required,preview.normalized_input.primary_member_id,preview.normalized_input.cryostat_id,preview.normalized_input.cryostat_pending,preview.normalized_input.start_date,preview.normalized_input.end_date,preview.normalized_input.after_arrival,timestamp,timestamp);const taskId=Number(result.lastInsertRowid);for(const sampleId of preview.normalized_input.sample_ids)database.prepare("INSERT INTO v3_task_samples(topic_task_id,sample_id,created_at) VALUES(?,?,?)").run(taskId,sampleId,timestamp);for(const effort of preview.normalized_input.member_efforts)database.prepare("INSERT INTO v3_task_member_efforts(topic_task_id,member_id,planned_half_hours,created_at,updated_at) VALUES(?,?,?,?,?)").run(taskId,effort.member_id,effort.planned_half_hours,timestamp,timestamp);if(preview.normalized_input.predecessor_task_id!=null){const predecessor=ensureTask(database,preview.normalized_input.predecessor_task_id);if(predecessor.topic_id!==topic.id)fail(400,"CROSS_TOPIC_REFERENCE",{});database.prepare("INSERT INTO v3_task_dependencies(topic_id,predecessor_task_id,successor_task_id,created_at) VALUES(?,?,?,?)").run(topic.id,predecessor.id,taskId,timestamp);}event(database,topic.id,"task_create",{actor:actor(p),taskId,after:preview.normalized_input});return database.prepare("SELECT * FROM v3_topic_tasks WHERE id=?").get(taskId);});return response(res,201,taskData(database,row));}
    match=path.match(/^\/api\/v3\/topic-tasks\/(\d+)\/preview$/);if(match&&method==="POST"){const task=ensureTask(database,id(match[1]));const p=await body(req);expected(task,p);return response(res,200,previewTask(database,task.topic_id,p,task));}
    match=path.match(/^\/api\/v3\/topic-tasks\/(\d+)$/);
    if(match&&method==="PUT"){
      const task=ensureTask(database,id(match[1])); const p=await body(req); expected(task,p); const preview=previewTask(database,task.topic_id,p,task);
      const facts={topicId:task.topic_id,existingId:task.id,version:task.version,readiness:readiness(database,task.id)}; requirePreview(p,preview.normalized_input,facts,preview.conflicts); conflictAck(p,preview.conflicts);
      const row=transaction(database,()=>{
        const stamp=now(); const input=preview.normalized_input;
        database.prepare("UPDATE v3_topic_tasks SET title=?,description=?,test_purpose=?,test_items_json=?,position=?,is_required=?,primary_member_id=?,cryostat_id=?,cryostat_pending=?,start_date=?,end_date=?,after_arrival=?,version=version+1,updated_at=? WHERE id=?").run(input.title,input.description,input.test_purpose,JSON.stringify(input.test_items),input.position,input.is_required,input.primary_member_id,input.cryostat_id,input.cryostat_pending,input.start_date,input.end_date,input.after_arrival,stamp,task.id);
        if(task.task_id!=null){
          const start=input.start_date||todayIsoDate(); const end=input.end_date||start;
          database.prepare("UPDATE tasks SET title=?,description=?,default_start_date=?,default_end_date=?,updated_at=? WHERE id=? AND deleted_at IS NULL").run(input.title,input.description,start,end,stamp,task.task_id);
          const desired=new Set(input.member_efforts.filter((effort)=>effort.planned_half_hours>0).map((effort)=>effort.member_id));
          const current=database.prepare("SELECT id,member_id FROM task_assignments WHERE task_id=? AND deleted_at IS NULL").all(task.task_id);
          for(const assignment of current) if(!desired.has(assignment.member_id)) database.prepare("UPDATE task_assignments SET deleted_at=?,updated_at=? WHERE id=?").run(stamp,stamp,assignment.id);
          for(const effort of input.member_efforts) if(effort.planned_half_hours>0){ const existing=database.prepare("SELECT id FROM task_assignments WHERE task_id=? AND member_id=?").get(task.task_id,effort.member_id); if(existing) database.prepare("UPDATE task_assignments SET start_date=?,end_date=?,deleted_at=NULL,updated_at=? WHERE id=?").run(start,end,stamp,existing.id); else database.prepare("INSERT INTO task_assignments(task_id,member_id,start_date,end_date,progress,note,created_at,updated_at) VALUES(?,?,?, ?,0,'',?,?)").run(task.task_id,effort.member_id,start,end,stamp,stamp); }
        }
        database.prepare("DELETE FROM v3_task_samples WHERE topic_task_id=?").run(task.id); for(const sampleId of input.sample_ids) database.prepare("INSERT INTO v3_task_samples(topic_task_id,sample_id,created_at) VALUES(?,?,?)").run(task.id,sampleId,stamp);
        database.prepare("DELETE FROM v3_task_member_efforts WHERE topic_task_id=?").run(task.id); for(const effort of input.member_efforts) database.prepare("INSERT INTO v3_task_member_efforts(topic_task_id,member_id,planned_half_hours,created_at,updated_at) VALUES(?,?,?,?,?)").run(task.id,effort.member_id,effort.planned_half_hours,stamp,stamp);
        database.prepare("DELETE FROM v3_task_dependencies WHERE successor_task_id=?").run(task.id); if(input.predecessor_task_id!=null){ const predecessor=ensureTask(database,input.predecessor_task_id); if(predecessor.topic_id!==task.topic_id) fail(400,"CROSS_TOPIC_REFERENCE",{}); database.prepare("INSERT INTO v3_task_dependencies(topic_id,predecessor_task_id,successor_task_id,created_at) VALUES(?,?,?,?)").run(task.topic_id,predecessor.id,task.id,stamp); }
        event(database,task.topic_id,"task_update",{actor:actor(p),taskId:task.id,after:input}); return database.prepare("SELECT * FROM v3_topic_tasks WHERE id=?").get(task.id);
      }); return response(res,200,taskData(database,row));
    }
    match=path.match(/^\/api\/v3\/topics\/(\d+)\/task-order$/);if(match&&method==="PUT"){const topic=ensureTopic(database,id(match[1]));const p=await body(req);const ordered=listIds(p.ordered_task_ids,"ordered_task_ids");const tasks=database.prepare("SELECT id FROM v3_topic_tasks WHERE topic_id=? ORDER BY id").all(topic.id).map((r)=>r.id).sort((a,b)=>a-b);if(ordered.length!==tasks.length||ordered.some((v,i)=>v!==tasks.slice().sort((a,b)=>a-b)[i]))fail(400,"VALIDATION_ERROR",{field:"ordered_task_ids",reason:"must contain exactly topic tasks"});const rows=transaction(database,()=>{ordered.forEach((taskId,index)=>database.prepare("UPDATE v3_topic_tasks SET position=?,version=version+1,updated_at=? WHERE id=? AND topic_id=?").run(index,now(),taskId,topic.id));event(database,topic.id,"task_order",{actor:actor(p),after:{ordered_task_ids:ordered}});return database.prepare("SELECT * FROM v3_topic_tasks WHERE topic_id=? ORDER BY position").all(topic.id).map((r)=>taskData(database,r));});return response(res,200,rows);}
    match=path.match(/^\/api\/v3\/topics\/(\d+)\/acceptance-template$/);if(match&&method==="GET"){ensureTopic(database,id(match[1]));const t=database.prepare("SELECT * FROM v3_acceptance_templates WHERE topic_id=? AND is_active=1").get(id(match[1]));return response(res,200,t?{...t,items:database.prepare("SELECT * FROM v3_acceptance_template_items WHERE template_id=? ORDER BY position").all(t.id)}:null);}
    if(match&&method==="PUT"){const topic=ensureTopic(database,id(match[1]));const p=await body(req);const name=trim(p.name,"name",1,200);if(!Array.isArray(p.items))fail(400,"VALIDATION_ERROR",{field:"items",reason:"array required"});const items=p.items.map((i,index)=>({position:Number(i.position??index),label:trim(i.label,`items[${index}].label`,1,300)}));const row=transaction(database,()=>{const stamp=now();database.prepare("UPDATE v3_acceptance_templates SET is_active=0,updated_at=? WHERE topic_id=? AND is_active=1").run(stamp,topic.id);const result=database.prepare("INSERT INTO v3_acceptance_templates(topic_id,name,is_active,created_at,updated_at) VALUES(?,?,1,?,?)").run(topic.id,name,stamp,stamp);for(const item of items)database.prepare("INSERT INTO v3_acceptance_template_items(template_id,position,label) VALUES(?,?,?)").run(result.lastInsertRowid,item.position,item.label);event(database,topic.id,"template_update",{actor:actor(p),after:{name,items}});return database.prepare("SELECT * FROM v3_acceptance_templates WHERE id=?").get(Number(result.lastInsertRowid));});return response(res,200,{...row,items:database.prepare("SELECT * FROM v3_acceptance_template_items WHERE template_id=? ORDER BY position").all(row.id)});}
    match=path.match(/^\/api\/v3\/topics\/(\d+)\/submissions$/);if(match&&method==="GET"){ensureTopic(database,id(match[1]));return response(res,200,{items:database.prepare("SELECT * FROM v3_deliverable_submissions WHERE topic_task_id IN (SELECT id FROM v3_topic_tasks WHERE topic_id=?) ORDER BY submitted_at DESC").all(id(match[1]))});}
    match=path.match(/^\/api\/v3\/tasks\/(\d+)\/submissions$/);if(match&&method==="POST"){const task=ensureTask(database,id(match[1],"task_id"));const p=await body(req);const sampleIds=exactSampleSet(database,task.id,p.sample_ids);const checklist=parseChecklist(database,task.topic_id,p);const description=trim(p.description,"description",1,4000);const resource=trim(p.resource_url,"resource_url",1,2000);if(!/^(https?|file):/i.test(resource))fail(400,"VALIDATION_ERROR",{field:"resource_url",reason:"http,https or file URL required"});const prior=p.supersedes_submission_id==null?null:database.prepare("SELECT * FROM v3_deliverable_submissions WHERE id=? AND task_lineage_key=?").get(id(p.supersedes_submission_id,"supersedes_submission_id"),task.task_lineage_key);if(p.supersedes_submission_id!=null&&(!prior||prior.status!=="returned"))fail(409,"SUPERSESSION_REQUIRED",{});const latest=database.prepare("SELECT * FROM v3_deliverable_submissions WHERE task_lineage_key=? ORDER BY sequence DESC LIMIT 1").get(task.task_lineage_key);if(latest&&latest.status!=="returned")fail(409,"SUBMISSION_ALREADY_ACTIVE",{});const fingerprint=createHash("sha256").update(JSON.stringify(sampleIds)).digest("hex");const row=transaction(database,()=>{const stamp=now();const seq=(latest?.sequence||0)+1;const result=database.prepare("INSERT INTO v3_deliverable_submissions(topic_task_id,task_id,task_lineage_key,task_title_snapshot,sequence,supersedes_submission_id,sample_set_fingerprint,description,submitted_by,submitted_at,resource_url,checklist_snapshot_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(task.id,task.task_id,task.task_lineage_key,task.title,seq,prior?.id||null,fingerprint,description,trim(p.submitted_by||"本地用户","submitted_by",1,100),p.submitted_at||stamp,resource,JSON.stringify(checklist),"submitted",stamp,stamp);const submissionId=Number(result.lastInsertRowid);for(const [position,sampleId] of sampleIds.entries()){const sample=database.prepare("SELECT * FROM v3_samples WHERE id=?").get(sampleId);database.prepare("INSERT INTO v3_submission_samples(submission_id,sample_id,sample_key,position,model_snapshot,identifier_snapshot,planning_label_snapshot) VALUES(?,?,?,?,?,?,?)").run(submissionId,sample.id,randomUUID(),position,sample.model,sample.formal_identifier||sample.temporary_identifier||null,sample.planning_label);}event(database,task.topic_id,"submission",{actor:actor(p),taskId:task.id,after:{submission_id:submissionId}});return database.prepare("SELECT * FROM v3_deliverable_submissions WHERE id=?").get(submissionId);});return response(res,201,row);}
    match=path.match(/^\/api\/v3\/submissions\/(\d+)\/review$/);if(match&&method==="POST"){const submission=database.prepare("SELECT * FROM v3_deliverable_submissions WHERE id=?").get(id(match[1]));if(!submission)fail(404,"NOT_FOUND",{resource:"submission",id:match[1]});const p=await body(req);const decision=p.decision;if(!["accepted","returned"].includes(decision))fail(400,"VALIDATION_ERROR",{field:"decision",reason:"accepted or returned"});const checked=Array.isArray(p.checked_items)?p.checked_items:[];const snapshot=JSON.parse(submission.checklist_snapshot_json);if(decision==="accepted"&&(!snapshot.length||snapshot.some((item)=>!checked.some((c)=>Number(c.id)===item.id&&c.passed===true))))fail(400,"CHECKLIST_NOT_PASSED",{});if(decision==="returned"&&!trim(p.reason,"reason",1,4000))fail(400,"VALIDATION_ERROR",{field:"reason",reason:"required"});const row=transaction(database,()=>{const stamp=now();database.prepare("INSERT INTO v3_acceptance_reviews(submission_id,decision,reviewer,reason,checked_snapshot_json,reviewed_at) VALUES(?,?,?,?,?,?)").run(submission.id,decision,trim(p.reviewer||"本地用户","reviewer",1,100),p.reason||"",JSON.stringify(checked),stamp);database.prepare("UPDATE v3_deliverable_submissions SET status=?,version=version+1,updated_at=? WHERE id=?").run(decision,stamp,submission.id);if(decision==="accepted"&&submission.topic_task_id)database.prepare("UPDATE tasks SET status='completed',updated_at=? WHERE id=? AND deleted_at IS NULL").run(stamp,submission.task_id);event(database,submission.topic_task_id?database.prepare("SELECT topic_id FROM v3_topic_tasks WHERE id=?").get(submission.topic_task_id).topic_id:null,"acceptance",{actor:actor(p),taskId:submission.topic_task_id,after:{submission_id:submission.id,decision}});return database.prepare("SELECT * FROM v3_deliverable_submissions WHERE id=?").get(submission.id);});return response(res,200,row);}
    match=path.match(/^\/api\/v3\/topics\/(\d+)\/events$/);if(match&&method==="GET"){ensureTopic(database,id(match[1]),true);return response(res,200,{items:database.prepare("SELECT * FROM v3_topic_events WHERE topic_id=? ORDER BY id DESC").all(id(match[1]))});}
    return errorResponse(res, new V3Error(404, "API_NOT_FOUND", {}, "API route not found"));
  } catch (error) { return errorResponse(res,error); }
}

const V5_STATUS_META = Object.freeze({
  waiting: { label: "等待样品", color: "#0f172a", background: "#e2e8f0" },
  "sample-delayed": { label: "样品交付延期", color: "#7f1d1d", background: "#fee2e2" },
  testing: { label: "正在测试", color: "#1e3a8a", background: "#dbeafe" },
  "test-delayed": { label: "测试延期", color: "#7c2d12", background: "#ffedd5" },
  completed: { label: "已完成", color: "#14532d", background: "#dcfce7" }
});

function v5EnsureTopic(database, topicId, includeArchived = false) {
  const row = database.prepare("SELECT * FROM v5_topics WHERE id=?").get(topicId);
  if (!row || (!includeArchived && row.status === "archived")) fail(404, "NOT_FOUND", { resource: "topic", id: topicId });
  return row;
}
function v5EnsureTask(database, taskId) {
  const row = database.prepare("SELECT * FROM v5_tasks WHERE id=?").get(taskId);
  if (!row) fail(404, "NOT_FOUND", { resource: "task", id: taskId });
  return row;
}
function v5EnsureSample(database, sampleId) {
  const row = database.prepare("SELECT * FROM v5_samples WHERE id=?").get(sampleId);
  if (!row) fail(404, "NOT_FOUND", { resource: "sample", id: sampleId });
  return row;
}
function v5Expected(row, payload) {
  if (payload.expected_version !== undefined && Number(payload.expected_version) !== row.version) fail(409, "VERSION_CONFLICT", { expected_version: payload.expected_version, actual_version: row.version });
}
function v5ExpectedResource(row, payload) {
  if (payload.expected_updated_at !== undefined && String(payload.expected_updated_at) !== String(row.updated_at)) fail(409, "VERSION_CONFLICT", { expected_updated_at: payload.expected_updated_at, actual_updated_at: row.updated_at });
}
function v5DateRange(start, end) {
  const s = date(start, "start_date"); const e = date(end, "end_date");
  if ((s && !e) || (!s && e) || (s && e && s > e)) fail(400, "VALIDATION_ERROR", { field: "end_date", reason: "valid date range required" });
  return { start_date: s, end_date: e };
}
function v5Color(value, fallback = "") {
  const color = String(value ?? fallback).trim();
  if (color && !/^#[0-9a-f]{3,8}$/i.test(color)) fail(400, "VALIDATION_ERROR", { field: "color", reason: "hex color required" });
  return color;
}
function v5ListIds(input, field, allowEmpty = true) {
  if (input === undefined) return [];
  if (!Array.isArray(input)) fail(400, "VALIDATION_ERROR", { field, reason: "array required" });
  const values = input.map((value) => id(value, field));
  const unique = [...new Set(values)].sort((a, b) => a - b);
  if (unique.length !== values.length) fail(400, "VALIDATION_ERROR", { field, reason: "duplicates are not allowed" });
  if (!allowEmpty && !unique.length) fail(400, "VALIDATION_ERROR", { field, reason: "at least one item required" });
  return unique;
}
function v5ActiveResource(database, table, resourceId, field) {
  const row = database.prepare(`SELECT * FROM ${table} WHERE id=?`).get(resourceId);
  if (!row) fail(400, "VALIDATION_ERROR", { field, reason: "resource not found" });
  const active = table === "members" ? row.deleted_at == null && row.status === "active" : table === "v2_source_groups" ? row.is_active === 1 : row.status === "active";
  if (!active) fail(409, "RESOURCE_DISABLED", { field, id: resourceId });
  return row;
}
function v5TaskSamples(database, taskId) {
  return database.prepare("SELECT s.*,ts.is_required FROM v5_samples s JOIN v5_task_samples ts ON ts.sample_id=s.id WHERE ts.task_id=? ORDER BY s.eta_date IS NULL,s.eta_date,s.id").all(taskId);
}
function v5TaskMembers(database, taskId) {
  return database.prepare("SELECT tm.*,m.name,m.role,m.status FROM v5_task_members tm JOIN members m ON m.id=tm.member_id WHERE tm.task_id=? ORDER BY m.name COLLATE NOCASE,m.id").all(taskId);
}
function v5ComputedStatus(database, row, at = todayIsoDate()) {
  if (row.manual_phase === "completed") return "completed";
  const samples = v5TaskSamples(database, row.id).filter((sample) => sample.is_required === 1);
  const sampleDelayed = row.manual_phase === "waiting" && samples.some((sample) => !sample.arrival_date && !sample.eta_pending && sample.eta_date && sample.eta_date < at);
  if (sampleDelayed) return "sample-delayed";
  if (row.manual_phase === "testing" && row.end_date && row.end_date < at) return "test-delayed";
  if (row.manual_phase === "testing") return "testing";
  return "waiting";
}
function v5TaskData(database, row) {
  const topic = database.prepare("SELECT id,name,purpose,status FROM v5_topics WHERE id=?").get(row.topic_id);
  const source = row.source_group_id == null ? null : database.prepare("SELECT id,name,is_active FROM v2_source_groups WHERE id=?").get(row.source_group_id);
  const cryostat = row.cryostat_id == null ? null : database.prepare("SELECT id,name,status FROM v2_cryostats WHERE id=?").get(row.cryostat_id);
  const statusCode = v5ComputedStatus(database, row);
  const statusMeta = V5_STATUS_META[statusCode];
  const samples = v5TaskSamples(database, row.id).map((sample) => ({ id: sample.id, planning_label: sample.planning_label, model: sample.model, sample_no: sample.sample_no, eta_date: sample.eta_date, arrival_date: sample.arrival_date, eta_pending: sample.eta_pending, is_required: sample.is_required, notes: sample.notes }));
  const members = v5TaskMembers(database, row.id).map((member) => ({ id: member.member_id, name: member.name, role: member.role, status: member.status, start_date: member.start_date, end_date: member.end_date, version: member.version }));
  const testItems = database.prepare("SELECT id,name,acceptance_criteria,note,position FROM v5_test_items WHERE task_id=? ORDER BY position,id").all(row.id);
  return { ...row, task_number: `TASK-${row.legacy_task_id ?? row.id}`, topic, source_group: source, cryostat, samples, test_items: testItems, participants: members, participant_member_ids: members.map((member) => member.id), status: statusCode, status_label: statusMeta.label, status_color: statusMeta.color, status_background: statusMeta.background, display_status: statusCode };
}
function v5Facts(database, row) {
  if (!row) return { task_id: null, version: null, topic_id: null, member_count: 0, sample_count: 0, members: [], samples: [], resources: [] };
  const members = database.prepare("SELECT member_id,start_date,end_date,version FROM v5_task_members WHERE task_id=? ORDER BY member_id").all(row.id);
  const samples = database.prepare("SELECT s.id,s.eta_date,s.arrival_date,s.eta_pending,s.version FROM v5_samples s JOIN v5_task_samples ts ON ts.sample_id=s.id WHERE ts.task_id=? ORDER BY s.id").all(row.id);
  const resources = [row.source_group_id == null ? null : database.prepare("SELECT id,is_active,updated_at FROM v2_source_groups WHERE id=?").get(row.source_group_id), row.cryostat_id == null ? null : database.prepare("SELECT id,status,updated_at FROM v2_cryostats WHERE id=?").get(row.cryostat_id), ...members.map((member) => database.prepare("SELECT id,status,updated_at FROM members WHERE id=?").get(member.member_id))].filter(Boolean);
  return { task_id: row.id, version: row.version, topic_id: row.topic_id, member_count: members.length, sample_count: samples.length, members, samples, resources };
}
function v5Token(normalized, facts, conflicts) { return createHash("sha256").update(JSON.stringify({ normalized, facts, conflicts, checksum: V5_SCHEMA_CHECKSUM })).digest("hex"); }
function v5NormalizeItems(input, existingTaskId = null, database = null) {
  const raw = input === undefined && existingTaskId != null ? database.prepare("SELECT name,acceptance_criteria,note,position FROM v5_test_items WHERE task_id=? ORDER BY position").all(existingTaskId) : (input ?? []);
  if (!Array.isArray(raw)) fail(400, "VALIDATION_ERROR", { field: "test_items", reason: "array required" });
  return raw.map((item, index) => ({ name: trim(typeof item === "string" ? item : item?.name ?? item?.label, `test_items[${index}].name`, 1, 300), acceptance_criteria: trim(typeof item === "string" ? "" : item?.acceptance_criteria ?? "", `test_items[${index}].acceptance_criteria`, 0, 2000), note: trim(typeof item === "string" ? "" : item?.note ?? "", `test_items[${index}].note`, 0, 2000), position: index }));
}
function v5NormalizeTask(database, payload, existing = null) {
  const topicId = payload.topic_id === undefined ? (existing?.topic_id ?? v5EnsureUnassignedTopic(database).id) : id(payload.topic_id, "topic_id");
  v5EnsureTopic(database, topicId);
  const title = trim(payload.title ?? existing?.title, "title", 1, 200);
  const purpose = trim(payload.purpose ?? existing?.purpose ?? "", "purpose", 0, 4000);
  const notes = trim(payload.notes ?? existing?.notes ?? "", "notes", 0, 4000);
  const sourceGroupId = payload.source_group_id === undefined ? (existing?.source_group_id ?? null) : (payload.source_group_id == null ? null : id(payload.source_group_id, "source_group_id"));
  const cryostatId = payload.cryostat_id === undefined ? (existing?.cryostat_id ?? null) : (payload.cryostat_id == null ? null : id(payload.cryostat_id, "cryostat_id"));
  if (sourceGroupId != null) v5ActiveResource(database, "v2_source_groups", sourceGroupId, "source_group_id");
  if (cryostatId != null) v5ActiveResource(database, "v2_cryostats", cryostatId, "cryostat_id");
  const manualPhase = payload.manual_phase ?? existing?.manual_phase ?? "waiting";
  if (!["waiting", "testing", "completed"].includes(manualPhase)) fail(400, "VALIDATION_ERROR", { field: "manual_phase", reason: "waiting, testing or completed required" });
  const ranges = v5DateRange(payload.start_date === undefined ? existing?.start_date : payload.start_date, payload.end_date === undefined ? existing?.end_date : payload.end_date);
  const sampleIds = v5ListIds(payload.sample_ids === undefined ? (existing ? database.prepare("SELECT sample_id FROM v5_task_samples WHERE task_id=? ORDER BY sample_id").all(existing.id).map((item) => item.sample_id) : []) : payload.sample_ids, "sample_ids");
  for (const sampleId of sampleIds) v5EnsureSample(database, sampleId);
  const memberIds = v5ListIds(payload.participant_member_ids ?? payload.member_ids ?? (existing ? database.prepare("SELECT member_id FROM v5_task_members WHERE task_id=? ORDER BY member_id").all(existing.id).map((item) => item.member_id) : []), "participant_member_ids");
  for (const memberId of memberIds) v5ActiveResource(database, "members", memberId, "participant_member_ids");
  const memberDates = (payload.member_dates ?? (existing ? database.prepare("SELECT member_id,start_date,end_date FROM v5_task_members WHERE task_id=? ORDER BY member_id").all(existing.id) : [])).map((item, index) => { const memberId = id(item.member_id, `member_dates[${index}].member_id`); if (!memberIds.includes(memberId)) fail(400, "VALIDATION_ERROR", { field: "member_dates", reason: "member must be in participants" }); const range = v5DateRange(item.start_date ?? null, item.end_date ?? null); return { member_id: memberId, ...range }; });
  for (const memberId of memberIds) if (!memberDates.some((item) => item.member_id === memberId)) memberDates.push({ member_id: memberId, start_date: ranges.start_date, end_date: ranges.end_date });
  return { topic_id: topicId, source_group_id: sourceGroupId, cryostat_id: cryostatId, title, purpose, notes, color: v5Color(payload.color, existing?.color ?? ""), manual_phase: manualPhase, start_date: ranges.start_date, end_date: ranges.end_date, sample_ids: sampleIds, participant_member_ids: memberIds, member_dates: memberDates, test_items: v5NormalizeItems(payload.test_items, existing?.id, database) };
}
function v5Conflicts(database, normalized, existing = null) {
  const conflicts = [];
  if (normalized.start_date && normalized.end_date && normalized.participant_member_ids.length) {
    const marks = normalized.participant_member_ids.map(() => "?").join(",");
    const rows = database.prepare(`SELECT tm.task_id,tm.member_id,tm.start_date,tm.end_date,t.title FROM v5_task_members tm JOIN v5_tasks t ON t.id=tm.task_id WHERE tm.member_id IN (${marks}) AND tm.start_date IS NOT NULL AND tm.end_date IS NOT NULL AND tm.start_date<=? AND tm.end_date>=? AND tm.task_id<>? ORDER BY tm.task_id`).all(...normalized.participant_member_ids, normalized.end_date, normalized.start_date, existing?.id ?? -1);
    for (const row of rows) conflicts.push({ type: "MEMBER_DATE_OVERLAP", task_id: row.task_id, member_id: row.member_id, title: row.title, start_date: row.start_date, end_date: row.end_date });
  }
  if (normalized.cryostat_id != null && normalized.start_date && normalized.end_date) {
    const rows = database.prepare("SELECT id,title,start_date,end_date FROM v5_tasks WHERE cryostat_id=? AND start_date IS NOT NULL AND end_date IS NOT NULL AND start_date<=? AND end_date>=? AND id<>? ORDER BY id").all(normalized.cryostat_id, normalized.end_date, normalized.start_date, existing?.id ?? -1);
    for (const row of rows) conflicts.push({ type: "CRYOSTAT_DATE_OVERLAP", task_id: row.id, title: row.title, start_date: row.start_date, end_date: row.end_date });
  }
  return conflicts.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function v5Preview(database, payload, existing = null) { const normalized = v5NormalizeTask(database, payload, existing); const conflicts = v5Conflicts(database, normalized, existing); return { normalized_input: normalized, conflicts, preview_token: v5Token(normalized, v5Facts(database, existing), conflicts) }; }
function v5RequirePreview(payload, preview, database, existing = null) { if (!payload.preview_token || payload.preview_token !== preview.preview_token) fail(409, "STALE_PREVIEW", { reason: "preview token no longer matches" }); if (preview.conflicts.length && !payload.ack) fail(409, "CONFLICTS_NOT_ACKNOWLEDGED", { conflicts: preview.conflicts }); if (existing) v5Expected(existing, payload); }
function v5WriteEvent(database, topicId, taskId, type, payload = {}) { database.prepare("INSERT INTO v5_events(topic_id,task_id,sample_id,event_type,actor,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?)").run(topicId, taskId ?? null, payload.sample_id ?? null, type, payload.actor || "本地用户", payload.before == null ? null : JSON.stringify(payload.before), payload.after == null ? null : JSON.stringify(payload.after), now()); }
function v5SyncLegacyTask(database, v5Task, input) {
  if (v5Task.legacy_task_id == null) return null;
  const legacy = database.prepare("SELECT * FROM tasks WHERE id=?").get(v5Task.legacy_task_id);
  if (!legacy) return null;
  const start = input.start_date || todayIsoDate(); const end = input.end_date || start;
  const legacyStatus = input.manual_phase === "completed" ? "completed" : input.manual_phase === "testing" ? "active" : "planned";
  database.prepare("UPDATE tasks SET title=?,description=?,default_start_date=?,default_end_date=?,color=?,status=?,updated_at=? WHERE id=? AND deleted_at IS NULL").run(input.title, input.notes, start, end, input.color || legacy.color || "#2563eb", legacyStatus, now(), legacy.id);
  const desired = new Set(input.participant_member_ids);
  for (const assignment of database.prepare("SELECT id,member_id FROM task_assignments WHERE task_id=? AND deleted_at IS NULL").all(legacy.id)) if (!desired.has(assignment.member_id)) database.prepare("UPDATE task_assignments SET deleted_at=?,updated_at=? WHERE id=?").run(now(), now(), assignment.id);
  for (const member of input.member_dates) {
    if (!member.start_date || !member.end_date) continue;
    const current = database.prepare("SELECT id FROM task_assignments WHERE task_id=? AND member_id=?").get(legacy.id, member.member_id);
    if (current) database.prepare("UPDATE task_assignments SET start_date=?,end_date=?,deleted_at=NULL,updated_at=? WHERE id=?").run(member.start_date, member.end_date, now(), current.id);
    else database.prepare("INSERT INTO task_assignments(task_id,member_id,start_date,end_date,progress,note,created_at,updated_at) VALUES(?,?,?,?,0,'',?,?)").run(legacy.id, member.member_id, member.start_date, member.end_date, now(), now());
  }
  return legacy.id;
}
function v5ListTasks(database, url) {
  const clauses = ["1=1"]; const params = [];
  const value = (name) => url.searchParams.get(name);
  if (value("topic_id")) { clauses.push("t.topic_id=?"); params.push(id(value("topic_id"), "topic_id")); }
  if (value("source_group_id")) { clauses.push("t.source_group_id=?"); params.push(id(value("source_group_id"), "source_group_id")); }
  if (value("cryostat_id")) { clauses.push("t.cryostat_id=?"); params.push(id(value("cryostat_id"), "cryostat_id")); }
  if (value("member_id")) { clauses.push("EXISTS (SELECT 1 FROM v5_task_members tmf WHERE tmf.task_id=t.id AND tmf.member_id=?)"); params.push(id(value("member_id"), "member_id")); }
  if (value("search")) { clauses.push("(t.title LIKE ? OR t.purpose LIKE ? OR t.notes LIKE ?)"); const search = `%${value("search")}%`; params.push(search, search, search); }
  if (value("from")) { date(value("from"), "from"); clauses.push("(t.end_date IS NULL OR t.end_date>=?)"); params.push(value("from")); }
  if (value("to")) { date(value("to"), "to"); clauses.push("(t.start_date IS NULL OR t.start_date<=?)"); params.push(value("to")); }
  const rows = database.prepare(`SELECT t.* FROM v5_tasks t WHERE ${clauses.join(" AND ")} ORDER BY t.start_date IS NULL,t.start_date,t.id`).all(...params).map((row) => v5TaskData(database, row));
  const status = value("status"); return status ? rows.filter((row) => row.status === status) : rows;
}

export async function routeV5Api(req, res, database, url) {
  try {
    const path = url.pathname; const method = req.method; let match;
    if (method === "GET" && path === "/api/v5/status") return response(res, 200, { schema_version: 1, checksum: V5_SCHEMA_CHECKSUM, tables: V5_TABLES.length, indexes: V5_INDEXES.length, endpoints: V5_ENDPOINTS.length, v1_compat: true, v2_compat: true, v3_compat: true });
    if (method === "GET" && path === "/api/v5/resources") {
      seedV3ReferenceResources(database);
      return response(res, 200, {
        source_groups: database.prepare("SELECT id,name,note,is_active,created_at,updated_at FROM v2_source_groups ORDER BY name COLLATE NOCASE").all(),
        members: database.prepare("SELECT id,name,role,status,created_at,updated_at FROM members WHERE deleted_at IS NULL ORDER BY status,name COLLATE NOCASE").all(),
        cryostats: database.prepare("SELECT id,name,note,status,created_at,updated_at FROM v2_cryostats ORDER BY name COLLATE NOCASE").all()
      });
    }
    match = path.match(/^\/api\/v5\/resources\/(source-groups|members|cryostats)(?:\/(\d+))?$/);
    if (match && (method === "POST" || method === "PUT")) {
      const kind = match[1]; const resourceId = match[2] ? id(match[2]) : null; const payload = await body(req); const stamp = now();
      if (kind === "source-groups") {
        const name = trim(payload.name, "name", 1, 100); const normalized = v5NormalizeName(name); const note = trim(payload.note ?? "", "note", 0, 1000); const active = payload.is_active === undefined ? 1 : bool(payload.is_active, "is_active");
        const before = resourceId ? database.prepare("SELECT * FROM v2_source_groups WHERE id=?").get(resourceId) : null;
        const row = transaction(database, () => { if (resourceId) { const current = database.prepare("SELECT * FROM v2_source_groups WHERE id=?").get(resourceId); if (!current) fail(404, "NOT_FOUND", { resource: kind, id: resourceId }); v5ExpectedResource(current, payload); database.prepare("UPDATE v2_source_groups SET name=?,normalized_name=?,note=?,is_active=?,updated_at=? WHERE id=?").run(name, normalized, note, active, stamp, resourceId); return database.prepare("SELECT * FROM v2_source_groups WHERE id=?").get(resourceId); } const result = database.prepare("INSERT INTO v2_source_groups(name,normalized_name,note,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(name, normalized, note, active, stamp, stamp); return database.prepare("SELECT * FROM v2_source_groups WHERE id=?").get(Number(result.lastInsertRowid)); });
        v5WriteEvent(database,v5EnsureUnassignedTopic(database).id,null,resourceId?"source_group_update":"source_group_create",{actor:actor(payload),before,after:row});
        return response(res, resourceId ? 200 : 201, row);
      }
      if (kind === "cryostats") {
        const name = trim(payload.name, "name", 1, 100); const normalized = v5NormalizeName(name); const note = trim(payload.note ?? "", "note", 0, 1000); const status = payload.status ?? "active"; if (!["active", "inactive"].includes(status)) fail(400, "VALIDATION_ERROR", { field: "status" });
        const before = resourceId ? database.prepare("SELECT * FROM v2_cryostats WHERE id=?").get(resourceId) : null;
        const row = transaction(database, () => { if (resourceId) { const current = database.prepare("SELECT * FROM v2_cryostats WHERE id=?").get(resourceId); if (!current) fail(404, "NOT_FOUND", { resource: kind, id: resourceId }); v5ExpectedResource(current, payload); database.prepare("UPDATE v2_cryostats SET name=?,normalized_name=?,note=?,status=?,updated_at=? WHERE id=?").run(name, normalized, note, status, stamp, resourceId); return database.prepare("SELECT * FROM v2_cryostats WHERE id=?").get(resourceId); } const result = database.prepare("INSERT INTO v2_cryostats(name,normalized_name,note,status,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(name, normalized, note, status, stamp, stamp); return database.prepare("SELECT * FROM v2_cryostats WHERE id=?").get(Number(result.lastInsertRowid)); });
        v5WriteEvent(database,v5EnsureUnassignedTopic(database).id,null,resourceId?"cryostat_update":"cryostat_create",{actor:actor(payload),before,after:row});
        return response(res, resourceId ? 200 : 201, row);
      }
      const memberId = resourceId; const name = trim(payload.name, "name", 1, 100); const role = trim(payload.role ?? "", "role", 0, 200); const status = payload.status ?? "active"; if (!["active", "inactive"].includes(status)) fail(400, "VALIDATION_ERROR", { field: "status" });
      const before = memberId ? database.prepare("SELECT id,name,role,status,created_at,updated_at FROM members WHERE id=? AND deleted_at IS NULL").get(memberId) : null;
      const row = transaction(database, () => { if (memberId) { const current = database.prepare("SELECT * FROM members WHERE id=? AND deleted_at IS NULL").get(memberId); if (!current) fail(404, "NOT_FOUND", { resource: kind, id: memberId }); v5ExpectedResource(current, payload); database.prepare("UPDATE members SET name=?,role=?,status=?,updated_at=? WHERE id=?").run(name, role, status, stamp, memberId); return database.prepare("SELECT id,name,role,status,created_at,updated_at FROM members WHERE id=?").get(memberId); } const result = database.prepare("INSERT INTO members(name,role,email,status,created_at,updated_at) VALUES(?,?,?, ?,?,?)").run(name, role, "", status, stamp, stamp); return database.prepare("SELECT id,name,role,status,created_at,updated_at FROM members WHERE id=?").get(Number(result.lastInsertRowid)); });
      v5WriteEvent(database,v5EnsureUnassignedTopic(database).id,null,memberId?"member_update":"member_create",{actor:actor(payload),before,after:row});
      return response(res, memberId ? 200 : 201, row);
    }
    if (method === "GET" && path === "/api/v5/topics") {
      const includeArchived = url.searchParams.get("include_archived") === "1"; const rows = database.prepare(`SELECT t.*, (SELECT COUNT(*) FROM v5_tasks x WHERE x.topic_id=t.id) task_count FROM v5_topics t WHERE ${includeArchived ? "1=1" : "t.status='active'"} ORDER BY t.system_key='unassigned' DESC,t.name COLLATE NOCASE`).all();
      return response(res, 200, { items: rows, total: rows.length });
    }
    if (method === "POST" && path === "/api/v5/topics") { const p = await body(req); const name = trim(p.name, "name", 1, 200); const purpose = trim(p.purpose ?? "", "purpose", 0, 4000); const notes = trim(p.notes ?? "", "notes", 0, 4000); const stamp = now(); const result = transaction(database, () => { const created = database.prepare("INSERT INTO v5_topics(name,purpose,status,notes,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(name, purpose, "active", notes, stamp, stamp); const topicId=Number(created.lastInsertRowid); v5WriteEvent(database,topicId,null,"topic_create",{actor:actor(p),after:{name,purpose,notes}}); return topicId; }); return response(res, 201, database.prepare("SELECT * FROM v5_topics WHERE id=?").get(result)); }
    match = path.match(/^\/api\/v5\/topics\/(\d+)$/);
    if (match && method === "PUT") { const topic = v5EnsureTopic(database, id(match[1]), true); const p = await body(req); v5Expected(topic, p); const name = trim(p.name ?? topic.name, "name", 1, 200); const purpose = trim(p.purpose ?? topic.purpose, "purpose", 0, 4000); const notes = trim(p.notes ?? topic.notes, "notes", 0, 4000); const status = p.status ?? topic.status; if (!["active", "archived"].includes(status)) fail(400, "VALIDATION_ERROR", { field: "status" }); const row = transaction(database, () => { database.prepare("UPDATE v5_topics SET name=?,purpose=?,status=?,notes=?,archived_at=?,version=version+1,updated_at=? WHERE id=?").run(name, purpose, status, notes, status === "archived" ? now() : null, now(), topic.id); const updated=database.prepare("SELECT * FROM v5_topics WHERE id=?").get(topic.id); v5WriteEvent(database,topic.id,null,"topic_update",{actor:actor(p),before:topic,after:updated}); return updated; }); return response(res, 200, row); }
    if (match && method === "DELETE") { const topic = v5EnsureTopic(database, id(match[1]), true); const p = await body(req); const target = id(p.target_topic_id, "target_topic_id"); if (topic.system_key === "unassigned" || target === topic.id) fail(409, "VALIDATION_ERROR", { reason: "unassigned topic cannot be deleted and target must differ" }); const destination = v5EnsureTopic(database, target); v5Expected(topic, p); const row = transaction(database, () => { const moved=database.prepare("SELECT id FROM v5_tasks WHERE topic_id=?").all(topic.id).map((x)=>x.id); database.prepare("UPDATE v5_tasks SET topic_id=?,version=version+1,updated_at=? WHERE topic_id=?").run(destination.id, now(), topic.id); database.prepare("UPDATE v5_topics SET status='archived',archived_at=?,version=version+1,updated_at=? WHERE id=?").run(now(), now(), topic.id); v5WriteEvent(database,topic.id,null,"topic_delete_and_move",{actor:actor(p),before:{topic_id:topic.id,task_ids:moved},after:{target_topic_id:destination.id,task_ids:moved}}); return database.prepare("SELECT * FROM v5_topics WHERE id=?").get(topic.id); }); return response(res, 200, row); }
    match = path.match(/^\/api\/v5\/topics\/(\d+)\/move-tasks$/); if (match && method === "POST") { const source = v5EnsureTopic(database, id(match[1])); const p = await body(req); const destination = v5EnsureTopic(database, id(p.target_topic_id)); const taskIds = v5ListIds(p.task_ids, "task_ids", false); const row = transaction(database, () => { const marks = taskIds.map(() => "?").join(","); const result = database.prepare(`UPDATE v5_tasks SET topic_id=?,version=version+1,updated_at=? WHERE topic_id=? AND id IN (${marks})`).run(destination.id, now(), source.id, ...taskIds); v5WriteEvent(database,source.id,null,"task_topic_move",{actor:actor(p),before:{topic_id:source.id,task_ids:taskIds},after:{topic_id:destination.id,task_ids:taskIds}}); return { moved: result.changes, task_ids: taskIds }; }); return response(res, 200, row); }
    if (method === "GET" && path === "/api/v5/samples") { const search = url.searchParams.get("search"); const rows = search ? database.prepare("SELECT * FROM v5_samples WHERE planning_label LIKE ? OR model LIKE ? OR sample_no LIKE ? ORDER BY eta_date IS NULL,eta_date,id").all(`%${search}%`,`%${search}%`,`%${search}%`) : database.prepare("SELECT * FROM v5_samples ORDER BY eta_date IS NULL,eta_date,id").all(); return response(res, 200, { items: rows }); }
    if (method === "POST" && path === "/api/v5/samples") { const p = await body(req); const label = trim(p.planning_label, "planning_label", 1, 300); const model = trim(p.model, "model", 1, 200); const etaPending = bool(p.eta_pending, "eta_pending"); const eta = date(p.eta_date ?? null, "eta_date"); const arrival = date(p.arrival_date ?? null, "arrival_date"); if (!etaPending && !eta) fail(400, "VALIDATION_ERROR", { field: "eta_date", reason: "eta or pending required" }); if (eta && arrival && arrival < eta) fail(400, "VALIDATION_ERROR", { field: "arrival_date", reason: "arrival cannot precede ETA" }); const stamp = now(); const result = transaction(database, () => { const created=database.prepare("INSERT INTO v5_samples(planning_label,model,sample_no,eta_date,arrival_date,eta_pending,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(label, model, p.sample_no == null ? null : trim(p.sample_no, "sample_no", 0, 200), eta, arrival, etaPending, trim(p.notes ?? "", "notes", 0, 4000), stamp, stamp); const sampleId=Number(created.lastInsertRowid); v5WriteEvent(database,v5EnsureUnassignedTopic(database).id,null,"sample_create",{actor:actor(p),sample_id:sampleId,after:{planning_label:label,model,eta_date:eta,arrival_date:arrival,eta_pending:etaPending}}); return sampleId; }); return response(res, 201, database.prepare("SELECT * FROM v5_samples WHERE id=?").get(result)); }
    match = path.match(/^\/api\/v5\/samples\/(\d+)$/); if (match && method === "PUT") { const sample = v5EnsureSample(database, id(match[1])); const p = await body(req); v5Expected(sample, p); const label = trim(p.planning_label ?? sample.planning_label, "planning_label", 1, 300); const model = trim(p.model ?? sample.model, "model", 1, 200); const etaPending = p.eta_pending === undefined ? sample.eta_pending : bool(p.eta_pending, "eta_pending"); const eta = date(p.eta_date === undefined ? sample.eta_date : p.eta_date, "eta_date"); const arrival = date(p.arrival_date === undefined ? sample.arrival_date : p.arrival_date, "arrival_date"); if (!etaPending && !eta) fail(400, "VALIDATION_ERROR", { field: "eta_date", reason: "eta or pending required" }); if (eta && arrival && arrival < eta) fail(400, "VALIDATION_ERROR", { field: "arrival_date", reason: "arrival cannot precede ETA" }); const row = transaction(database, () => { const after={planning_label:label,model,sample_no:p.sample_no === undefined ? sample.sample_no : p.sample_no,eta_date:eta,arrival_date:arrival,eta_pending:etaPending,notes:trim(p.notes ?? sample.notes, "notes", 0, 4000)}; database.prepare("UPDATE v5_samples SET planning_label=?,model=?,sample_no=?,eta_date=?,arrival_date=?,eta_pending=?,notes=?,version=version+1,updated_at=? WHERE id=?").run(label, model, after.sample_no == null ? null : trim(after.sample_no, "sample_no", 0, 200), eta, arrival, etaPending, after.notes, now(), sample.id); v5WriteEvent(database,v5EnsureUnassignedTopic(database).id,null,"sample_update",{actor:actor(p),sample_id:sample.id,before:sample,after}); return database.prepare("SELECT * FROM v5_samples WHERE id=?").get(sample.id); }); return response(res, 200, row); }
    if (method === "GET" && path === "/api/v5/tasks") return response(res, 200, { items: v5ListTasks(database, url) });
    match = path.match(/^\/api\/v5\/tasks\/(\d+)$/);
    if (match && method === "GET") return response(res, 200, v5TaskData(database, v5EnsureTask(database, id(match[1]))));
    if (method === "POST" && path === "/api/v5/tasks/preview") { const p = await body(req); return response(res, 200, v5Preview(database, p)); }
    if (method === "POST" && path === "/api/v5/tasks") {
      const p = await body(req); const preview = v5Preview(database, p); v5RequirePreview(p, preview, database); const input = preview.normalized_input; const stamp = now();
      const task = transaction(database, () => { const start = input.start_date || todayIsoDate(); const end = input.end_date || start; const legacy = database.prepare("INSERT INTO tasks(title,description,default_start_date,default_end_date,color,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(input.title, input.notes, start, end, input.color || "#2563eb", input.manual_phase === "completed" ? "completed" : input.manual_phase === "testing" ? "active" : "planned", stamp, stamp); const result = database.prepare("INSERT INTO v5_tasks(legacy_task_id,topic_id,source_group_id,cryostat_id,title,purpose,notes,color,manual_phase,start_date,end_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(Number(legacy.lastInsertRowid), input.topic_id, input.source_group_id, input.cryostat_id, input.title, input.purpose, input.notes, input.color, input.manual_phase, input.start_date, input.end_date, stamp, stamp); const taskId = Number(result.lastInsertRowid); for (const item of input.test_items) database.prepare("INSERT INTO v5_test_items(task_id,name,acceptance_criteria,note,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(taskId,item.name,item.acceptance_criteria,item.note,item.position,stamp,stamp); for (const sampleId of input.sample_ids) database.prepare("INSERT INTO v5_task_samples(task_id,sample_id,is_required,created_at) VALUES(?,?,1,?)").run(taskId,sampleId,stamp); for (const member of input.member_dates) database.prepare("INSERT INTO v5_task_members(task_id,member_id,start_date,end_date,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(taskId,member.member_id,member.start_date,member.end_date,stamp,stamp); v5SyncLegacyTask(database, database.prepare("SELECT * FROM v5_tasks WHERE id=?").get(taskId), input); v5WriteEvent(database,input.topic_id,taskId,"task_create",{actor:actor(p),after:input}); return database.prepare("SELECT * FROM v5_tasks WHERE id=?").get(taskId); });
      return response(res, 201, v5TaskData(database, task));
    }
    match = path.match(/^\/api\/v5\/tasks\/(\d+)\/preview$/); if (match && method === "POST") { const task = v5EnsureTask(database, id(match[1])); const p = await body(req); return response(res, 200, v5Preview(database, p, task)); }
    match = path.match(/^\/api\/v5\/tasks\/(\d+)$/);
    if (match && method === "PUT") {
      const task = v5EnsureTask(database, id(match[1])); const p = await body(req); const preview = v5Preview(database, p, task); v5RequirePreview(p, preview, database, task); const input = preview.normalized_input;
      const row = transaction(database, () => { const stamp = now(); database.prepare("UPDATE v5_tasks SET topic_id=?,source_group_id=?,cryostat_id=?,title=?,purpose=?,notes=?,color=?,manual_phase=?,start_date=?,end_date=?,version=version+1,updated_at=? WHERE id=?").run(input.topic_id,input.source_group_id,input.cryostat_id,input.title,input.purpose,input.notes,input.color,input.manual_phase,input.start_date,input.end_date,stamp,task.id); database.prepare("DELETE FROM v5_test_items WHERE task_id=?").run(task.id); for(const item of input.test_items) database.prepare("INSERT INTO v5_test_items(task_id,name,acceptance_criteria,note,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(task.id,item.name,item.acceptance_criteria,item.note,item.position,stamp,stamp); database.prepare("DELETE FROM v5_task_samples WHERE task_id=?").run(task.id); for(const sampleId of input.sample_ids) database.prepare("INSERT INTO v5_task_samples(task_id,sample_id,is_required,created_at) VALUES(?,?,1,?)").run(task.id,sampleId,stamp); database.prepare("DELETE FROM v5_task_members WHERE task_id=?").run(task.id); for(const member of input.member_dates) database.prepare("INSERT INTO v5_task_members(task_id,member_id,start_date,end_date,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(task.id,member.member_id,member.start_date,member.end_date,stamp,stamp); const updated=database.prepare("SELECT * FROM v5_tasks WHERE id=?").get(task.id); v5SyncLegacyTask(database,updated,input); v5WriteEvent(database,input.topic_id,task.id,"task_update",{actor:actor(p),before:task,after:input}); return updated; });
      return response(res, 200, v5TaskData(database, row));
    }
    match = path.match(/^\/api\/v5\/tasks\/(\d+)\/(start-testing|complete)$/); if (match && method === "POST") { const task = v5EnsureTask(database, id(match[1])); const p = await body(req); v5Expected(task,p); const phase = match[2] === "complete" ? "completed" : "testing"; const row = transaction(database, () => { database.prepare("UPDATE v5_tasks SET manual_phase=?,version=version+1,updated_at=? WHERE id=?").run(phase,now(),task.id); const updated=database.prepare("SELECT * FROM v5_tasks WHERE id=?").get(task.id); v5SyncLegacyTask(database,updated,{...updated,participant_member_ids:database.prepare("SELECT member_id FROM v5_task_members WHERE task_id=?").all(task.id).map((x)=>x.member_id),member_dates:v5TaskMembers(database,task.id),color:updated.color}); v5WriteEvent(database,task.topic_id,task.id,phase==="completed"?"task_complete":"task_start_testing",{actor:actor(p),before:task,after:{manual_phase:phase}}); return updated; }); return response(res,200,v5TaskData(database,row)); }
    match = path.match(/^\/api\/v5\/tasks\/(\d+)\/(schedule-preview|schedule|member-schedule-preview|member-schedule)$/);
    if (match && (method === "POST")) {
      const task = v5EnsureTask(database, id(match[1])); const p = await body(req); const isMember = match[2].includes("member"); const taskMemberIds = database.prepare("SELECT member_id FROM v5_task_members WHERE task_id=? ORDER BY member_id").all(task.id).map((x)=>x.member_id); const baseInput = isMember ? { ...task, start_date: p.start_date, end_date: p.end_date, participant_member_ids: [id(p.member_id,"member_id")], member_dates: [{member_id:id(p.member_id,"member_id"),start_date:p.start_date,end_date:p.end_date}] } : { ...task, ...p, topic_id:task.topic_id, title:task.title, purpose:task.purpose, notes:task.notes, sample_ids:database.prepare("SELECT sample_id FROM v5_task_samples WHERE task_id=?").all(task.id).map((x)=>x.sample_id), participant_member_ids:taskMemberIds, test_items:database.prepare("SELECT name,acceptance_criteria,note FROM v5_test_items WHERE task_id=? ORDER BY position").all(task.id) };
      const input = { ...baseInput, topic_id:task.topic_id, source_group_id:task.source_group_id, cryostat_id:task.cryostat_id, title:task.title, purpose:task.purpose, notes:task.notes, color:task.color, manual_phase:task.manual_phase, sample_ids:database.prepare("SELECT sample_id FROM v5_task_samples WHERE task_id=?").all(task.id).map((x)=>x.sample_id), test_items:database.prepare("SELECT name,acceptance_criteria,note FROM v5_test_items WHERE task_id=? ORDER BY position").all(task.id) };
      if (!isMember && p.sync_members === true) input.member_dates = taskMemberIds.map((memberId)=>({member_id:memberId,start_date:p.start_date,end_date:p.end_date}));
      const preview = v5Preview(database,input,task); if(isMember && task.start_date && task.end_date && (p.start_date < task.start_date || p.end_date > task.end_date)){ preview.conflicts.push({type:"MEMBER_OUTSIDE_TASK_RANGE",task_id:task.id,member_id:id(p.member_id,"member_id"),task_start_date:task.start_date,task_end_date:task.end_date,member_start_date:p.start_date,member_end_date:p.end_date}); preview.conflicts.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))); preview.preview_token=v5Token(preview.normalized_input,v5Facts(database,task),preview.conflicts); } if (match[2].endsWith("preview")) return response(res,200,preview); v5RequirePreview(p,preview,database,task); const normalized=preview.normalized_input; const row=transaction(database,()=>{ const stamp=now(); if(isMember){ const memberId=id(p.member_id,"member_id"); if(!database.prepare("SELECT 1 FROM v5_task_members WHERE task_id=? AND member_id=?").get(task.id,memberId)) fail(404,"NOT_FOUND",{resource:"task_member",task_id:task.id,member_id:memberId}); database.prepare("UPDATE v5_task_members SET start_date=?,end_date=?,version=version+1,updated_at=? WHERE task_id=? AND member_id=?").run(normalized.start_date,normalized.end_date,stamp,task.id,memberId); database.prepare("UPDATE v5_tasks SET version=version+1,updated_at=? WHERE id=?").run(stamp,task.id); } else { database.prepare("UPDATE v5_tasks SET start_date=?,end_date=?,version=version+1,updated_at=? WHERE id=?").run(normalized.start_date,normalized.end_date,stamp,task.id); if(p.sync_members===true) database.prepare("UPDATE v5_task_members SET start_date=?,end_date=?,version=version+1,updated_at=? WHERE task_id=?").run(normalized.start_date,normalized.end_date,stamp,task.id); } const updated=database.prepare("SELECT * FROM v5_tasks WHERE id=?").get(task.id); v5SyncLegacyTask(database,updated,{...normalized,participant_member_ids:database.prepare("SELECT member_id FROM v5_task_members WHERE task_id=?").all(task.id).map((x)=>x.member_id),member_dates:v5TaskMembers(database,task.id),color:updated.color}); v5WriteEvent(database,task.topic_id,task.id,isMember?"member_schedule_change":"task_schedule_change",{actor:actor(p),after:{...normalized,sync_members:p.sync_members===true}}); return updated; }); return response(res,200,v5TaskData(database,row));
    }
    if (method === "GET" && (path === "/api/v5/execution" || path === "/api/v5/gantt")) { const items = v5ListTasks(database,url); const memberLoad = database.prepare("SELECT m.id,m.name,COUNT(tm.task_id) AS task_count,MIN(tm.start_date) AS first_date,MAX(tm.end_date) AS last_date FROM members m LEFT JOIN v5_task_members tm ON tm.member_id=m.id WHERE m.deleted_at IS NULL GROUP BY m.id ORDER BY m.name COLLATE NOCASE").all(); return response(res,200,{items,member_load:memberLoad,filters:Object.fromEntries(url.searchParams)}); }
    if (method === "GET" && path === "/api/v5/events") return response(res,200,{items:database.prepare("SELECT * FROM v5_events ORDER BY id DESC LIMIT 500").all()});
    return errorResponse(res, new V3Error(404, "API_NOT_FOUND", {}, "API route not found"));
  } catch (error) { return errorResponse(res,error); }
}
