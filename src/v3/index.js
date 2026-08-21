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

export function migrateV3Schema(database) {
  const names = new Set(tables(database, "table"));
  if (names.has("app_schema_versions")) {
    const rows = database.prepare("SELECT version,name,checksum,applied_at FROM app_schema_versions ORDER BY version").all();
    const max = rows.length ? Math.max(...rows.map((r) => r.version)) : 1;
    if (max > 3) throw new Error(`Unsupported schema version: ${max}`);
    const current = rows.find((r) => r.version === 3);
    if (current) { validateV3Schema(database); return { migrated: false, version: current }; }
  }
  const indexes = new Set(tables(database, "index"));
  // A legacy V1 migration may have removed app_schema_versions while leaving
  // an already complete V3 object set. Re-register the immutable checksum
  // instead of treating that state as a partial migration.
  if (V3_TABLES.every((name) => names.has(name)) && V3_INDEXES.every((name) => indexes.has(name))) {
    transaction(database, () => database.prepare("INSERT INTO app_schema_versions(version,name,checksum,applied_at) VALUES(3,'v3-topic-sample-chain',?,?)").run(V3_SCHEMA_CHECKSUM, now()));
    return { migrated: true, version: validateV3Schema(database) };
  }
  const partial = [...names].filter((name) => name.startsWith("v3_"));
  if (partial.length) throw new Error(`Partial V3 migration detected: ${partial.join(",")}`);
  transaction(database, () => {
    database.exec(V3_SCHEMA_SQL);
    database.prepare("INSERT INTO app_schema_versions(version,name,checksum,applied_at) VALUES(3,'v3-topic-sample-chain',?,?)").run(V3_SCHEMA_CHECKSUM, now());
  });
  return { migrated: true, version: validateV3Schema(database) };
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
function normalizeTask(database, topicId, payload, existing = null) {
  const title = trim(payload.title ?? existing?.title, "title", 1, 200);
  const description = trim(payload.description ?? existing?.description ?? "", "description", 0, 4000);
  const sampleIds = listIds(payload.sample_ids ?? (existing ? sampleRows(database, existing.id).map((s) => s.id) : []), "sample_ids");
  if (!sampleIds.length) fail(400, "VALIDATION_ERROR", { field: "sample_ids", reason: "at least one sample required" });
  for (const sampleId of sampleIds) { const sample = ensureSample(database, sampleId); if (sample.topic_id !== topicId) fail(400, "CROSS_TOPIC_REFERENCE", { sample_id: sampleId }); }
  const position = Number(payload.position ?? existing?.position ?? 0); if (!Number.isInteger(position) || position < 0) fail(400, "VALIDATION_ERROR", { field: "position", reason: "non-negative integer required" });
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
  return { title, description, sample_ids: sampleIds, position, primary_member_id: primary, participant_member_ids: allMembers.filter((m) => m !== primary), member_efforts: efforts, cryostat_id: cryo, cryostat_pending: cryoPending, start_date: start, end_date: end, after_arrival: bool(payload.after_arrival ?? existing?.after_arrival ?? 0, "after_arrival"), predecessor_task_id: predecessor };
}
function taskConflicts(database, normalized, topicId, existingId = null) {
  const conflicts = []; const members = normalized.member_efforts.filter((e) => e.planned_half_hours > 0).map((e) => e.member_id);
  if (normalized.start_date && normalized.end_date) {
    const params = [normalized.start_date, normalized.end_date, ...members];
    if (members.length) {
      const marks = members.map(() => "?").join(",");
      const rows = database.prepare(`SELECT t.id,t.title,a.member_id,a.start_date,a.end_date FROM task_assignments a JOIN tasks t ON t.id=a.task_id WHERE t.deleted_at IS NULL AND a.member_id IN (${marks}) AND a.start_date<=? AND a.end_date>=?`).all(...members, normalized.end_date, normalized.start_date);
      for (const row of rows) if (existingId == null || row.id !== existingId) conflicts.push({ type: "MEMBER_DATE_OVERLAP", task_id: row.id, member_id: row.member_id, date: row.start_date });
      const v3Rows = database.prepare(`SELECT tt.id,tt.topic_id,e.member_id,tt.start_date,tt.end_date FROM v3_topic_tasks tt JOIN v3_task_member_efforts e ON e.topic_task_id=tt.id JOIN v3_topics tp ON tp.id=tt.topic_id WHERE tp.archived_at IS NULL AND tt.id<>? AND e.member_id IN (${marks}) AND e.planned_half_hours>0 AND tt.start_date<=? AND tt.end_date>=?`).all(existingId || -1, ...members, normalized.end_date, normalized.start_date);
      for (const row of v3Rows) conflicts.push({ type: "MEMBER_DATE_OVERLAP", task_id: row.id, topic_id: row.topic_id, member_id: row.member_id, date: row.start_date });
    }
    if (normalized.cryostat_id != null) {
      const rows = database.prepare("SELECT tt.id,tt.title,tt.topic_id,tt.start_date,tt.end_date FROM v3_topic_tasks tt JOIN v3_topics tp ON tp.id=tt.topic_id WHERE tt.cryostat_id=? AND tt.start_date<=? AND tt.end_date>=? AND tt.id<>? AND tp.archived_at IS NULL AND tt.topic_id<>?").all(normalized.cryostat_id, normalized.end_date, normalized.start_date, existingId || -1, topicId);
      for (const row of rows) conflicts.push({ type: "CRYOSTAT_DATE_OVERLAP", task_id: row.id, topic_id: row.topic_id, date: row.start_date });
    }
  }
  const total = normalized.member_efforts.reduce((sum, item) => sum + item.planned_half_hours, 0); if (total > 80) conflicts.push({ type: "MEMBER_WEEKLY_LOAD", total_half_hours: total });
  return conflicts.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function token(input, facts, conflicts) { return createHash("sha256").update(JSON.stringify({ input, facts, conflicts, checksum: V3_SCHEMA_CHECKSUM })).digest("hex"); }
function previewTask(database, topicId, payload, existing = null) { const normalized = normalizeTask(database, topicId, payload, existing); const conflicts = taskConflicts(database, normalized, topicId, existing?.id ?? null); const positionOwner = database.prepare("SELECT id FROM v3_topic_tasks WHERE topic_id=? AND position=? AND id<>?").get(topicId, normalized.position, existing?.id ?? -1); if (positionOwner) conflicts.push({ type: "POSITION_CONFLICT", task_id: positionOwner.id, position: normalized.position }); conflicts.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); const facts = { topicId, existingId: existing?.id ?? null, version: existing?.version ?? null, readiness: existing ? readiness(database, existing.id) : null }; return { normalized_input: normalized, conflicts, preview_token: token(normalized, facts, conflicts) }; }
function requirePreview(payload, normalized, facts, conflicts) { if (!payload.preview_token || payload.preview_token !== token(normalized, facts, conflicts)) fail(409, "STALE_PREVIEW", { reason: "preview token no longer matches" }); }
function conflictAck(payload, conflicts) { if (conflicts.length && !payload.ack) fail(409, "CONFLICTS_NOT_ACKNOWLEDGED", { conflicts }); }

function topicData(database, row) { const samples = database.prepare("SELECT COUNT(*) AS count FROM v3_samples WHERE topic_id=? AND archived_at IS NULL").get(row.id).count; const tasks = database.prepare("SELECT COUNT(*) AS count FROM v3_topic_tasks WHERE topic_id=?").get(row.id).count; return { ...row, sample_count: samples, task_count: tasks }; }
function listTopics(database, url) { const includeArchived = url.searchParams.get("include_archived") === "1"; const params = []; const where = [includeArchived ? "1=1" : "t.archived_at IS NULL"]; const search = url.searchParams.get("search"); if (search) { where.push("(t.name LIKE ? OR t.purpose LIKE ?)"); params.push(`%${search}%`, `%${search}%`); } const rows = database.prepare(`SELECT t.* FROM v3_topics t WHERE ${where.join(" AND ")} ORDER BY t.updated_at DESC,t.id DESC`).all(...params).map((r) => topicData(database, r)); const active = rows.filter((r) => !r.archived_at); const groups = database.prepare("SELECT id,name,is_active FROM v2_source_groups ORDER BY name COLLATE NOCASE").all(); const cryostats = database.prepare("SELECT id,name,status FROM v2_cryostats ORDER BY name COLLATE NOCASE").all(); return { items: rows, groups, cryostats, stats: { total: active.length, samples: active.reduce((sum, t) => sum + t.sample_count, 0), tasks: active.reduce((sum, t) => sum + t.task_count, 0) }, total: rows.length }; }
function taskData(database, row) { const samples = sampleRows(database, row.id).map((s) => ({ id: s.id, model: s.model, planning_label: s.planning_label, current_eta_date: s.current_eta_date, eta_pending: s.eta_pending, actual_arrival_date: s.actual_arrival_date })); const efforts = database.prepare("SELECT e.*,m.name FROM v3_task_member_efforts e JOIN members m ON m.id=e.member_id WHERE e.topic_task_id=? ORDER BY e.member_id").all(row.id); const linked = row.task_id == null ? null : database.prepare("SELECT status FROM tasks WHERE id=?").get(row.task_id); const status = linked?.status === "completed" ? "completed" : (row.start_date && row.start_date <= todayIsoDate() ? "active" : "planned"); return { ...row, samples, efforts, total_half_hours: efforts.reduce((sum, e) => sum + e.planned_half_hours, 0), readiness_date: readiness(database, row.id), display_status: status }; }
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
    if (match && method === "PUT") { const topic = ensureTopic(database, id(match[1])); const p = await body(req); expected(topic, p); const name = trim(p.name ?? topic.name, "name", 1, 200); const purpose = trim(p.purpose ?? topic.purpose, "purpose", 1, 4000); const contact = p.source_contact_id === undefined ? topic.source_contact_id : (p.source_contact_id == null ? null : id(p.source_contact_id, "source_contact_id")); const cryo = p.default_cryostat_id === undefined ? topic.default_cryostat_id : (p.default_cryostat_id == null ? null : id(p.default_cryostat_id, "default_cryostat_id")); const row = transaction(database, () => { database.prepare("UPDATE v3_topics SET source_contact_id=?,name=?,purpose=?,default_cryostat_id=?,version=version+1,updated_at=? WHERE id=?").run(contact, name, purpose, cryo, now(), topic.id); event(database, topic.id, "topic_update", { actor: actor(p), before: topic, after: { name, purpose, contact, cryo } }); return database.prepare("SELECT * FROM v3_topics WHERE id=?").get(topic.id); }); return response(res, 200, topicData(database, row)); }
    match = path.match(/^\/api\/v3\/topics\/(\d+)\/(archive|restore)$/); if (match && method === "POST") { const topic = ensureTopic(database, id(match[1]), true); const p = await body(req); expected(topic, p); const archived = match[2] === "archive"; const row = transaction(database, () => { database.prepare("UPDATE v3_topics SET archived_at=?,version=version+1,updated_at=? WHERE id=?").run(archived ? now() : null, now(), topic.id); event(database, topic.id, archived ? "topic_archive" : "topic_restore", { actor: actor(p), before: topic }); return database.prepare("SELECT * FROM v3_topics WHERE id=?").get(topic.id); }); return response(res, 200, topicData(database, row)); }
    match = path.match(/^\/api\/v3\/topics\/(\d+)\/samples$/); if (match && method === "GET") { ensureTopic(database, id(match[1])); return response(res, 200, { items: database.prepare("SELECT * FROM v3_samples WHERE topic_id=? AND archived_at IS NULL ORDER BY current_eta_date IS NULL,current_eta_date,id").all(id(match[1])) }); }
    if (match && method === "POST") { const topic = ensureTopic(database, id(match[1])); const p = await body(req); const label = trim(p.planning_label, "planning_label", 1, 200); const model = trim(p.model, "model", 1, 200); const pending = bool(p.eta_pending, "eta_pending"); const eta = date(p.eta_date ?? null, "eta_date"); if (pending && eta || !pending && !eta) fail(400, "VALIDATION_ERROR", { field: "eta_date", reason: "eta or pending required" }); const timestamp = now(); const row = transaction(database, () => { const result = database.prepare("INSERT INTO v3_samples(topic_id,planning_label,model,formal_identifier,temporary_identifier,initial_eta_date,current_eta_date,eta_pending,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(topic.id, label, model, p.formal_identifier ?? null, p.temporary_identifier ?? null, eta, eta, pending, trim(p.notes ?? "", "notes", 0, 2000), timestamp, timestamp); event(database, topic.id, "sample_create", { actor: actor(p), sampleId: Number(result.lastInsertRowid), after: p }); return database.prepare("SELECT * FROM v3_samples WHERE id=?").get(Number(result.lastInsertRowid)); }); return response(res, 201, row); }
    match = path.match(/^\/api\/v3\/samples\/(\d+)$/); if (match && method === "GET") return response(res, 200, ensureSample(database, id(match[1])));
    if (match && method === "PUT") { const sample = ensureSample(database, id(match[1])); const p = await body(req); expected(sample, p); const next = { label: trim(p.planning_label ?? sample.planning_label, "planning_label", 1, 200), model: trim(p.model ?? sample.model, "model", 1, 200), formal: p.formal_identifier === undefined ? sample.formal_identifier : (p.formal_identifier == null ? null : trim(p.formal_identifier, "formal_identifier", 1, 200)), temporary: p.temporary_identifier === undefined ? sample.temporary_identifier : (p.temporary_identifier == null ? null : trim(p.temporary_identifier, "temporary_identifier", 1, 200)), notes: trim(p.notes ?? sample.notes, "notes", 0, 2000) }; const row = transaction(database, () => { database.prepare("UPDATE v3_samples SET planning_label=?,model=?,formal_identifier=?,temporary_identifier=?,notes=?,version=version+1,updated_at=? WHERE id=?").run(next.label,next.model,next.formal,next.temporary,next.notes,now(),sample.id); event(database, sample.topic_id, "sample_update", { actor: actor(p), sampleId: sample.id, before: sample, after: next }); return database.prepare("SELECT * FROM v3_samples WHERE id=?").get(sample.id); }); return response(res, 200, row); }
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
    if(match&&method==="POST"){const topic=ensureTopic(database,id(match[1]));const p=await body(req);const preview=previewTask(database,topic.id,p);if(match[2]||p.preview_only===true)return response(res,200,preview);requirePreview(p,preview.normalized_input,{topicId:topic.id,existingId:null,version:null,readiness:null},preview.conflicts);conflictAck(p,preview.conflicts);const row=transaction(database,()=>{const timestamp=now();const today=todayIsoDate();const start=preview.normalized_input.start_date||today;const end=preview.normalized_input.end_date||start;const v1Result=database.prepare("INSERT INTO tasks(title,description,default_start_date,default_end_date,color,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(preview.normalized_input.title,preview.normalized_input.description,start,end,"#2563eb",start>today?"planned":"active",timestamp,timestamp);const v1TaskId=Number(v1Result.lastInsertRowid);for(const effort of preview.normalized_input.member_efforts)if(effort.planned_half_hours>0)database.prepare("INSERT INTO task_assignments(task_id,member_id,start_date,end_date,progress,note,created_at,updated_at) VALUES(?,?,?,?,0,'',?,?)").run(v1TaskId,effort.member_id,start,end,timestamp,timestamp);const result=database.prepare("INSERT INTO v3_topic_tasks(topic_id,task_id,task_lineage_key,title,description,position,primary_member_id,cryostat_id,cryostat_pending,start_date,end_date,after_arrival,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(topic.id,v1TaskId,uuid(randomUUID()),preview.normalized_input.title,preview.normalized_input.description,preview.normalized_input.position,preview.normalized_input.primary_member_id,preview.normalized_input.cryostat_id,preview.normalized_input.cryostat_pending,preview.normalized_input.start_date,preview.normalized_input.end_date,preview.normalized_input.after_arrival,timestamp,timestamp);const taskId=Number(result.lastInsertRowid);for(const sampleId of preview.normalized_input.sample_ids)database.prepare("INSERT INTO v3_task_samples(topic_task_id,sample_id,created_at) VALUES(?,?,?)").run(taskId,sampleId,timestamp);for(const effort of preview.normalized_input.member_efforts)database.prepare("INSERT INTO v3_task_member_efforts(topic_task_id,member_id,planned_half_hours,created_at,updated_at) VALUES(?,?,?,?,?)").run(taskId,effort.member_id,effort.planned_half_hours,timestamp,timestamp);if(preview.normalized_input.predecessor_task_id!=null){const predecessor=ensureTask(database,preview.normalized_input.predecessor_task_id);if(predecessor.topic_id!==topic.id)fail(400,"CROSS_TOPIC_REFERENCE",{});database.prepare("INSERT INTO v3_task_dependencies(topic_id,predecessor_task_id,successor_task_id,created_at) VALUES(?,?,?,?)").run(topic.id,predecessor.id,taskId,timestamp);}event(database,topic.id,"task_create",{actor:actor(p),taskId,after:preview.normalized_input});return database.prepare("SELECT * FROM v3_topic_tasks WHERE id=?").get(taskId);});return response(res,201,taskData(database,row));}
    match=path.match(/^\/api\/v3\/topic-tasks\/(\d+)\/preview$/);if(match&&method==="POST"){const task=ensureTask(database,id(match[1]));const p=await body(req);expected(task,p);return response(res,200,previewTask(database,task.topic_id,p,task));}
    match=path.match(/^\/api\/v3\/topic-tasks\/(\d+)$/);if(match&&method==="PUT"){const task=ensureTask(database,id(match[1]));const p=await body(req);expected(task,p);const preview=previewTask(database,task.topic_id,p,task);const facts={topicId:task.topic_id,existingId:task.id,version:task.version,readiness:readiness(database,task.id)};requirePreview(p,preview.normalized_input,facts,preview.conflicts);conflictAck(p,preview.conflicts);const row=transaction(database,()=>{const stamp=now();database.prepare("UPDATE v3_topic_tasks SET title=?,description=?,position=?,primary_member_id=?,cryostat_id=?,cryostat_pending=?,start_date=?,end_date=?,after_arrival=?,version=version+1,updated_at=? WHERE id=?").run(preview.normalized_input.title,preview.normalized_input.description,preview.normalized_input.position,preview.normalized_input.primary_member_id,preview.normalized_input.cryostat_id,preview.normalized_input.cryostat_pending,preview.normalized_input.start_date,preview.normalized_input.end_date,preview.normalized_input.after_arrival,stamp,task.id);if(task.task_id!=null){const start=preview.normalized_input.start_date||todayIsoDate();const end=preview.normalized_input.end_date||start;database.prepare("UPDATE tasks SET title=?,description=?,default_start_date=?,default_end_date=?,updated_at=? WHERE id=? AND deleted_at IS NULL").run(preview.normalized_input.title,preview.normalized_input.description,start,end,stamp,task.task_id);for(const effort of preview.normalized_input.member_efforts)if(effort.planned_half_hours>0)database.prepare("UPDATE task_assignments SET start_date=?,end_date=?,updated_at=? WHERE task_id=? AND member_id=? AND deleted_at IS NULL").run(start,end,stamp,task.task_id,effort.member_id);}database.prepare("DELETE FROM v3_task_samples WHERE topic_task_id=?").run(task.id);for(const sampleId of preview.normalized_input.sample_ids)database.prepare("INSERT INTO v3_task_samples(topic_task_id,sample_id,created_at) VALUES(?,?,?)").run(task.id,sampleId,stamp);database.prepare("DELETE FROM v3_task_member_efforts WHERE topic_task_id=?").run(task.id);for(const effort of preview.normalized_input.member_efforts)database.prepare("INSERT INTO v3_task_member_efforts(topic_task_id,member_id,planned_half_hours,created_at,updated_at) VALUES(?,?,?,?,?)").run(task.id,effort.member_id,effort.planned_half_hours,stamp,stamp);event(database,task.topic_id,"task_update",{actor:actor(p),taskId:task.id,after:preview.normalized_input});return database.prepare("SELECT * FROM v3_topic_tasks WHERE id=?").get(task.id);});return response(res,200,taskData(database,row));}
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
