import { createServer } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { migrateV3Schema, routeV3Api, V3_ENDPOINTS, migrateV5Schema, routeV5Api, V5_ENDPOINTS } from "./v3/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const publicDir = path.join(rootDir, "public");
const dbPath = process.env.DB_PATH || path.join(dataDir, "team_tasks.sqlite");
const port = Number(process.env.PORT || 3000);

let db;

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const taskStatuses = new Set(["planned", "active", "paused", "completed", "cancelled", "archived"]);
const manualTaskStatuses = new Set(["paused", "completed", "cancelled", "archived"]);
const memberStatuses = new Set(["active", "inactive"]);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8"
};

const defaultTemplates = [
  {
    name: "实验任务",
    description: "完成样品准备、实验记录和结果复核。",
    color: "#2563eb",
    duration_days: 14,
    checklist: ["样品准备", "实验记录", "数据备份", "结果复核"]
  },
  {
    name: "数据分析",
    description: "清洗数据、绘图并整理结论。",
    color: "#16a34a",
    duration_days: 10,
    checklist: ["数据清洗", "初步绘图", "异常点检查", "结论整理"]
  },
  {
    name: "文献整理",
    description: "阅读论文并形成可复用笔记。",
    color: "#9333ea",
    duration_days: 7,
    checklist: ["阅读原文", "提取核心问题", "整理图表", "形成笔记"]
  },
  {
    name: "论文写作",
    description: "完成段落草稿、图表和修改。",
    color: "#ea580c",
    duration_days: 21,
    checklist: ["拟定大纲", "完成初稿", "图表检查", "统一修改"]
  }
];

function nowIso() {
  return new Date().toISOString();
}

function formatLocalIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayIsoDate() {
  return formatLocalIsoDate(new Date());
}

function sendJson(res, status, payload) {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType });
  res.end(text);
}

function sendCsv(res, text) {
  res.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
  res.end(`\uFEFF${text}`);
}

function runTransaction(database, action) {
  database.exec("BEGIN");
  try {
    const result = action();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error("无效 ID");
  return id;
}

function requireFields(payload, fields) {
  for (const field of fields) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === "") {
      throw new Error(`缺少必填字段：${field}`);
    }
  }
}

function assertDateRange(start, end, prefix = "日期") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error(`${prefix}必须使用 YYYY-MM-DD 格式`);
  }
  if (start > end) throw new Error(`${prefix}开始时间不能晚于结束时间`);
}

function addDays(date, amount) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(year, month - 1, day);
  next.setDate(next.getDate() + amount);
  return formatLocalIsoDate(next);
}

function runImmediateTransaction(database, action) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function normalizeTaskStatus(status, fallback = "active") {
  const next = status || fallback;
  if (!taskStatuses.has(next)) throw new Error(`无效任务状态：${next}`);
  return next;
}

function deriveAutoTaskStatus(startDate, today = todayIsoDate()) {
  return startDate > today ? "planned" : "active";
}

function resolveTaskStatus(status, startDate, fallback = "auto") {
  if (status === "archived") throw new Error("请使用归档操作归档任务");
  if (manualTaskStatuses.has(status)) return status;
  if (manualTaskStatuses.has(fallback)) return fallback;
  if (status && status !== "auto") normalizeTaskStatus(status);
  return deriveAutoTaskStatus(startDate);
}

function syncAutoTaskStatuses(database = db) {
  const today = todayIsoDate();
  const rows = database.prepare(`
    SELECT id, default_start_date, status
    FROM tasks
    WHERE deleted_at IS NULL AND status IN ('planned', 'active')
  `).all();
  const update = database.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?");
  const timestamp = nowIso();
  for (const row of rows) {
    const next = deriveAutoTaskStatus(row.default_start_date, today);
    if (next !== row.status) update.run(next, timestamp, row.id);
  }
}

function normalizeMemberStatus(status, fallback = "active") {
  const next = status || fallback;
  if (!memberStatuses.has(next)) throw new Error(`无效成员状态：${next}`);
  return next;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((item) => item.trim());
  return rows.slice(1).map((cells, index) => ({
    __line: index + 2,
    ...Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] || ""]))
  }));
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows, headers) {
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
}

function logChange(changeType, values = {}) {
  db.prepare(`
    INSERT INTO task_change_logs (task_id, assignment_id, member_id, change_type, old_value, new_value, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    values.task_id ?? null,
    values.assignment_id ?? null,
    values.member_id ?? null,
    changeType,
    values.old_value === undefined ? null : JSON.stringify(values.old_value),
    values.new_value === undefined ? null : JSON.stringify(values.new_value),
    nowIso()
  );
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 3_000_000) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("请求 JSON 格式错误"));
      }
    });
    req.on("error", reject);
  });
}

function createSchema(database) {
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT DEFAULT '',
      email TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      default_start_date TEXT NOT NULL,
      default_end_date TEXT NOT NULL,
      color TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS task_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      UNIQUE(task_id, member_id)
    );

    CREATE TABLE IF NOT EXISTS task_checklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      is_done INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      color TEXT NOT NULL,
      duration_days INTEGER NOT NULL DEFAULT 7,
      checklist_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS task_change_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      assignment_id INTEGER,
      member_id INTEGER,
      change_type TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
      FOREIGN KEY (assignment_id) REFERENCES task_assignments(id) ON DELETE SET NULL,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_assignments_member ON task_assignments(member_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_task ON task_assignments(task_id);
    CREATE INDEX IF NOT EXISTS idx_checklist_task ON task_checklist_items(task_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_dates ON tasks(default_start_date, default_end_date);
    CREATE INDEX IF NOT EXISTS idx_logs_created ON task_change_logs(created_at);
  `);
}

const V2_TABLES = [
  "app_schema_versions",
  "v2_source_groups",
  "v2_source_contacts",
  "v2_cryostats",
  "v2_control_plans",
  "v2_test_items",
  "v2_acceptance_templates",
  "v2_acceptance_template_items",
  "v2_plan_tasks",
  "v2_plan_events",
  "v2_deliverable_submissions",
  "v2_acceptance_reviews"
];

const V2_INDEXES = [
  "idx_v2_contacts_group",
  "idx_v2_plans_source",
  "idx_v2_plans_eta",
  "idx_v2_plans_cryostat",
  "idx_v2_test_items_plan",
  "idx_v2_one_active_template",
  "idx_v2_plan_tasks_plan",
  "idx_v2_plan_tasks_primary",
  "idx_v2_events_plan",
  "idx_v2_submissions_plan"
];

export const V2_ENDPOINTS = Object.freeze([
  "GET /api/v2/status",
  "GET /api/v2/source-groups",
  "POST /api/v2/source-groups",
  "PUT /api/v2/source-groups/:id",
  "GET /api/v2/source-groups/:id/contacts",
  "POST /api/v2/source-groups/:id/contacts",
  "PUT /api/v2/source-contacts/:id",
  "GET /api/v2/cryostats",
  "POST /api/v2/cryostats",
  "PUT /api/v2/cryostats/:id",
  "GET /api/v2/plans",
  "POST /api/v2/plans",
  "GET /api/v2/plans/:id",
  "PUT /api/v2/plans/:id",
  "POST /api/v2/plans/:id/archive",
  "POST /api/v2/plans/:id/restore",
  "POST /api/v2/plans/:id/arrival",
  "POST /api/v2/plans/:id/test-items",
  "PUT /api/v2/test-items/:id",
  "GET /api/v2/plans/:id/acceptance-template",
  "PUT /api/v2/plans/:id/acceptance-template",
  "GET /api/v2/plans/:id/events",
  "GET /api/v2/backup",
  "POST /api/v2/plans/:id/eta/preview",
  "POST /api/v2/plans/:id/eta/confirm",
  "POST /api/v2/plans/:id/cryostat/preview",
  "POST /api/v2/plans/:id/cryostat/confirm",
  "POST /api/v2/plans/:id/tasks/preview",
  "POST /api/v2/plans/:id/tasks",
  "POST /api/v2/plan-tasks/:task_id/preview",
  "PUT /api/v2/plan-tasks/:task_id",
  "GET /api/v2/plans/:id/submissions",
  "POST /api/v2/tasks/:task_id/submissions",
  "POST /api/v2/submissions/:id/review"
]);

export { V3_ENDPOINTS, V5_ENDPOINTS };

const V2_ENDPOINT_MATCHERS = V2_ENDPOINTS.map((entry) => {
  const [method, template] = entry.split(" ");
  const pattern = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[^/]+/g, "[^/]+");
  return { method, pattern: new RegExp(`^${pattern}$`) };
});

const V2_SCHEMA_SQL = `
CREATE TABLE app_schema_versions (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL CHECK (length(checksum) = 64),
  applied_at TEXT NOT NULL
);

CREATE TABLE v2_source_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  normalized_name TEXT NOT NULL UNIQUE CHECK (length(normalized_name) BETWEEN 1 AND 100),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE v2_source_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_group_id INTEGER NOT NULL REFERENCES v2_source_groups(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  normalized_name TEXT NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 100),
  title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 100),
  contact_text TEXT NOT NULL DEFAULT '' CHECK (length(contact_text) <= 300),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_group_id, normalized_name)
);

CREATE TABLE v2_cryostats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  normalized_name TEXT NOT NULL UNIQUE CHECK (length(normalized_name) BETWEEN 1 AND 100),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE v2_control_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_group_id INTEGER NOT NULL REFERENCES v2_source_groups(id) ON DELETE RESTRICT,
  counterpart_contact_id INTEGER REFERENCES v2_source_contacts(id) ON DELETE SET NULL,
  local_liaison_name TEXT NOT NULL DEFAULT '' CHECK (length(local_liaison_name) <= 100),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  purpose TEXT NOT NULL CHECK (length(trim(purpose)) BETWEEN 1 AND 4000),
  sample_model TEXT NOT NULL CHECK (length(trim(sample_model)) BETWEEN 1 AND 200),
  sample_identifier TEXT CHECK (sample_identifier IS NULL OR length(sample_identifier) BETWEEN 1 AND 200),
  identifier_kind TEXT CHECK (identifier_kind IS NULL OR identifier_kind IN ('temporary', 'formal')),
  initial_eta_date TEXT CHECK (initial_eta_date IS NULL OR length(initial_eta_date) = 10),
  current_eta_date TEXT CHECK (current_eta_date IS NULL OR length(current_eta_date) = 10),
  eta_pending INTEGER NOT NULL DEFAULT 0 CHECK (eta_pending IN (0, 1)),
  cryostat_id INTEGER REFERENCES v2_cryostats(id) ON DELETE SET NULL,
  cryostat_pending INTEGER NOT NULL DEFAULT 0 CHECK (cryostat_pending IN (0, 1)),
  actual_arrival_date TEXT CHECK (actual_arrival_date IS NULL OR length(actual_arrival_date) = 10),
  project_tag TEXT CHECK (project_tag IS NULL OR length(project_tag) <= 100),
  topic_tag TEXT CHECK (topic_tag IS NULL OR length(topic_tag) <= 100),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((eta_pending = 1 AND current_eta_date IS NULL) OR (eta_pending = 0 AND current_eta_date IS NOT NULL)),
  CHECK ((cryostat_pending = 1 AND cryostat_id IS NULL) OR (cryostat_pending = 0 AND cryostat_id IS NOT NULL)),
  CHECK ((sample_identifier IS NULL AND identifier_kind IS NULL) OR (sample_identifier IS NOT NULL AND identifier_kind IS NOT NULL))
);

CREATE TABLE v2_test_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES v2_control_plans(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  acceptance_criteria TEXT NOT NULL DEFAULT '' CHECK (length(acceptance_criteria) <= 4000),
  is_required INTEGER NOT NULL DEFAULT 1 CHECK (is_required IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE v2_acceptance_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES v2_control_plans(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  name TEXT NOT NULL DEFAULT '计划验收清单' CHECK (length(name) BETWEEN 1 AND 200),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (plan_id, version)
);

CREATE TABLE v2_acceptance_template_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES v2_acceptance_templates(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 300),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  UNIQUE (template_id, position)
);

CREATE TABLE v2_plan_tasks (
  task_id INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  task_lineage_key TEXT NOT NULL UNIQUE CHECK (length(task_lineage_key) = 36),
  plan_id INTEGER NOT NULL REFERENCES v2_control_plans(id) ON DELETE CASCADE,
  test_item_id INTEGER REFERENCES v2_test_items(id) ON DELETE SET NULL,
  primary_member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  estimated_half_hours INTEGER NOT NULL CHECK (estimated_half_hours BETWEEN 1 AND 20000),
  after_arrival INTEGER NOT NULL DEFAULT 0 CHECK (after_arrival IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE v2_plan_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES v2_control_plans(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'create_plan', 'update_plan', 'eta_confirm', 'cryostat_confirm',
    'arrival_confirm', 'sample_identifier', 'create_test_item', 'update_test_item',
    'acceptance_template', 'create_task', 'update_assignment', 'task_soft_delete',
    'task_restore', 'task_hard_delete', 'submission', 'accept', 'return', 'archive', 'restore'
  )),
  actor_label TEXT NOT NULL DEFAULT '本地用户' CHECK (length(actor_label) BETWEEN 1 AND 100),
  old_value_json TEXT,
  new_value_json TEXT,
  impact_json TEXT,
  created_at TEXT NOT NULL,
  CHECK (old_value_json IS NULL OR json_valid(old_value_json)),
  CHECK (new_value_json IS NULL OR json_valid(new_value_json)),
  CHECK (impact_json IS NULL OR json_valid(impact_json))
);

CREATE TABLE v2_deliverable_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES v2_control_plans(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  task_lineage_key TEXT NOT NULL CHECK (length(task_lineage_key) = 36),
  original_task_id INTEGER NOT NULL CHECK (original_task_id > 0),
  task_title_snapshot TEXT NOT NULL CHECK (length(trim(task_title_snapshot)) BETWEEN 1 AND 200),
  test_item_id INTEGER REFERENCES v2_test_items(id) ON DELETE SET NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  supersedes_submission_id INTEGER REFERENCES v2_deliverable_submissions(id) ON DELETE SET NULL,
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 4000),
  submitter_label TEXT NOT NULL CHECK (length(trim(submitter_label)) BETWEEN 1 AND 100),
  submitted_at TEXT NOT NULL,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('url', 'local_path')),
  resource_value TEXT NOT NULL CHECK (length(trim(resource_value)) BETWEEN 1 AND 2000),
  checklist_snapshot_json TEXT NOT NULL CHECK (json_valid(checklist_snapshot_json)),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'accepted', 'returned')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at TEXT NOT NULL,
  UNIQUE (plan_id, task_lineage_key, sequence),
  UNIQUE (supersedes_submission_id)
);

CREATE TABLE v2_acceptance_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL UNIQUE REFERENCES v2_deliverable_submissions(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'returned')),
  reviewer_label TEXT NOT NULL CHECK (length(trim(reviewer_label)) BETWEEN 1 AND 100),
  comment TEXT NOT NULL DEFAULT '' CHECK (length(comment) <= 4000),
  checklist_result_json TEXT NOT NULL CHECK (json_valid(checklist_result_json)),
  reviewed_at TEXT NOT NULL
);

CREATE INDEX idx_v2_contacts_group ON v2_source_contacts(source_group_id, is_active);
CREATE INDEX idx_v2_plans_source ON v2_control_plans(source_group_id, archived_at);
CREATE INDEX idx_v2_plans_eta ON v2_control_plans(current_eta_date, actual_arrival_date, archived_at);
CREATE INDEX idx_v2_plans_cryostat ON v2_control_plans(cryostat_id, archived_at);
CREATE INDEX idx_v2_test_items_plan ON v2_test_items(plan_id, archived_at, position);
CREATE UNIQUE INDEX idx_v2_one_active_template ON v2_acceptance_templates(plan_id) WHERE is_active = 1;
CREATE INDEX idx_v2_plan_tasks_plan ON v2_plan_tasks(plan_id, test_item_id);
CREATE INDEX idx_v2_plan_tasks_primary ON v2_plan_tasks(primary_member_id);
CREATE INDEX idx_v2_events_plan ON v2_plan_events(plan_id, id DESC);
CREATE INDEX idx_v2_submissions_plan ON v2_deliverable_submissions(plan_id, task_lineage_key, sequence DESC);
`;

export const V2_SCHEMA_CHECKSUM = createHash("sha256").update(V2_SCHEMA_SQL).digest("hex");

function sqliteScalar(database, pragma) {
  const row = database.prepare(pragma).get();
  return row ? Object.values(row)[0] : null;
}

function assertDatabaseHealthy(database) {
  const quickCheck = sqliteScalar(database, "PRAGMA quick_check");
  if (quickCheck !== "ok") throw new Error(`SQLite quick_check failed: ${quickCheck}`);
}

function databaseObjectNames(database, type) {
  return database.prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name").all(type).map((row) => row.name);
}

function validateV2Schema(database) {
  const tables = new Set(databaseObjectNames(database, "table"));
  const indexes = new Set(databaseObjectNames(database, "index"));
  for (const name of V2_TABLES) if (!tables.has(name)) throw new Error(`V2 schema missing table: ${name}`);
  for (const name of V2_INDEXES) if (!indexes.has(name)) throw new Error(`V2 schema missing index: ${name}`);
  const actualTables = [...tables].filter((name) => name === "app_schema_versions" || name.startsWith("v2_"));
  const actualIndexes = [...indexes].filter((name) => name.startsWith("idx_v2_"));
  if (actualTables.length !== 12) throw new Error(`V2 schema table count mismatch: ${actualTables.length}`);
  if (actualIndexes.length !== 10) throw new Error(`V2 schema index count mismatch: ${actualIndexes.length}`);
  const version = database.prepare("SELECT version, name, checksum, applied_at FROM app_schema_versions WHERE version = 2").get();
  if (!version || version.name !== "v2-control-plan" || version.checksum !== V2_SCHEMA_CHECKSUM) {
    throw new Error("V2 schema checksum mismatch");
  }
  const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyViolations.length) throw new Error(`V2 schema foreign key violations: ${foreignKeyViolations.length}`);
  assertDatabaseHealthy(database);
  return version;
}

function hasTable(database, name) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function assertV1Schema(database) {
  for (const name of ["members", "tasks", "task_assignments", "task_checklist_items", "task_templates", "task_change_logs"]) {
    if (!hasTable(database, name)) throw new Error(`V1 schema missing table: ${name}`);
  }
}

async function createPreV2Backup(database, customPath, label = "pre-v2") {
  const backupDir = path.join(path.dirname(customPath), "backups");
  await mkdir(backupDir, { recursive: true });
  const stamp = nowIso().replaceAll(":", "-").replaceAll(".", "-");
  const backupPath = path.join(backupDir, `team_tasks.${label}-${stamp}.sqlite`);
  const escaped = backupPath.replaceAll("'", "''");
  database.exec(`VACUUM INTO '${escaped}'`);
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  try {
    assertDatabaseHealthy(backup);
  } finally {
    backup.close();
  }
  return backupPath;
}

async function createPreV3Backup(database, customPath) {
  const backupDir = path.join(path.dirname(customPath), "backups");
  await mkdir(backupDir, { recursive: true });
  const stamp = nowIso().replaceAll(":", "-").replaceAll(".", "-");
  const backupPath = path.join(backupDir, `team_tasks.pre-v3-${stamp}.sqlite`);
  database.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  try { assertDatabaseHealthy(backup); } finally { backup.close(); }
  return backupPath;
}

function migrateV2Schema(database) {
  const names = new Set(databaseObjectNames(database, "table"));
  const hasVersionTable = names.has("app_schema_versions");
  if (hasVersionTable) {
    const rows = database.prepare("SELECT version, name, checksum, applied_at FROM app_schema_versions ORDER BY version").all();
    const maxVersion = rows.length ? Math.max(...rows.map((row) => row.version)) : 1;
    if (maxVersion > 3) throw new Error(`Unsupported schema version: ${maxVersion}`);
    const version2 = rows.find((row) => row.version === 2);
    if (version2) {
      if (version2.name !== "v2-control-plan" || version2.checksum !== V2_SCHEMA_CHECKSUM) throw new Error("V2 schema checksum mismatch");
      validateV2Schema(database);
      return { migrated: false, version: version2 };
    }
  }
  const partial = [...names].filter((name) => name === "app_schema_versions" || name.startsWith("v2_"));
  if (partial.length) throw new Error(`Partial V2 migration detected: ${partial.join(",")}`);
  const appliedAt = nowIso();
  runImmediateTransaction(database, () => {
    database.exec(V2_SCHEMA_SQL);
    database.prepare("INSERT INTO app_schema_versions (version, name, checksum, applied_at) VALUES (2, 'v2-control-plan', ?, ?)")
      .run(V2_SCHEMA_CHECKSUM, appliedAt);
  });
  return { migrated: true, version: validateV2Schema(database) };
}

function seedTemplates(database) {
  const count = database.prepare("SELECT COUNT(*) AS count FROM task_templates WHERE deleted_at IS NULL").get().count;
  if (count > 0) return;
  const timestamp = nowIso();
  const insert = database.prepare(`
    INSERT INTO task_templates (name, description, color, duration_days, checklist_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const template of defaultTemplates) {
    insert.run(template.name, template.description, template.color, template.duration_days, JSON.stringify(template.checklist), timestamp, timestamp);
  }
}

function insertSampleMembersAndTasks(database, dateAnchor = null) {
  const timestamp = nowIso();
  const insertMember = database.prepare(`
    INSERT INTO members (name, role, email, status, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?)
  `);
  const insertTask = database.prepare(`
    INSERT INTO tasks (title, description, default_start_date, default_end_date, color, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAssignment = database.prepare(`
    INSERT INTO task_assignments (task_id, member_id, start_date, end_date, progress, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertChecklist = database.prepare(`
    INSERT INTO task_checklist_items (task_id, title, is_done, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const members = [
    ["张三", "实验设计", "zhangsan@example.com"],
    ["李四", "数据分析", "lisi@example.com"],
    ["王五", "仿真建模", "wangwu@example.com"],
    ["赵六", "论文整理", "zhaoliu@example.com"]
  ];
  const memberIds = members.map((member) => insertMember.run(...member, timestamp, timestamp).lastInsertRowid);

  const dates = dateAnchor
    ? [
        [addDays(dateAnchor, -6), addDays(dateAnchor, 8)],
        [addDays(dateAnchor, 5), addDays(dateAnchor, 19)],
        [addDays(dateAnchor, -20), addDays(dateAnchor, -8)],
        [addDays(dateAnchor, -2), addDays(dateAnchor, 15)]
      ]
    : [
        ["2026-06-24", "2026-07-12"],
        ["2026-07-02", "2026-07-24"],
        ["2026-06-10", "2026-06-26"],
        ["2026-07-08", "2026-08-06"]
      ];
  const tasks = [
    ["相稳定性实验", "完成第一批样品测试和数据记录。", ...dates[0], "#2563eb", "active", ["样品准备", "实验记录", "数据备份"]],
    ["XY 相图整理", "整理已有结果并绘制阶段性相图。", ...dates[1], "#16a34a", "planned", ["收集结果", "绘制相图", "复核标注"]],
    ["文献精读汇总", "整理近期论文并形成组会材料。", ...dates[2], "#9333ea", "completed", ["阅读论文", "整理笔记", "完成汇报"]],
    ["模型参数扫描", "执行多组参数扫描并记录异常点。", ...dates[3], "#ea580c", "active", ["参数表", "运行扫描", "异常点记录"]]
  ];
  const taskIds = tasks.map((task) => insertTask.run(...task.slice(0, 6), timestamp, timestamp).lastInsertRowid);
  tasks.forEach((task, taskIndex) => {
    task[6].forEach((item, index) => insertChecklist.run(taskIds[taskIndex], item, task[5] === "completed" ? 1 : 0, index, timestamp, timestamp));
  });

  insertAssignment.run(taskIds[0], memberIds[0], tasks[0][2], tasks[0][3], 45, "负责样品 A/B。", timestamp, timestamp);
  insertAssignment.run(taskIds[0], memberIds[1], addDays(tasks[0][2], 2), tasks[0][3], 35, "同步整理原始数据。", timestamp, timestamp);
  insertAssignment.run(taskIds[1], memberIds[1], tasks[1][2], tasks[1][3], 10, "", timestamp, timestamp);
  insertAssignment.run(taskIds[1], memberIds[2], tasks[1][2], tasks[1][3], 15, "", timestamp, timestamp);
  insertAssignment.run(taskIds[2], memberIds[3], tasks[2][2], tasks[2][3], 100, "已完成组会版本。", timestamp, timestamp);
  insertAssignment.run(taskIds[3], memberIds[0], tasks[3][2], addDays(tasks[3][3], -4), 5, "", timestamp, timestamp);
  insertAssignment.run(taskIds[3], memberIds[2], tasks[3][2], tasks[3][3], 5, "负责高温区间。", timestamp, timestamp);
}

function seedMembersAndTasks(database, dateAnchor = null) {
  const row = database.prepare("SELECT COUNT(*) AS count FROM members WHERE deleted_at IS NULL").get();
  if (row.count > 0) return;

  runTransaction(database, () => {
    insertSampleMembersAndTasks(database, dateAnchor);
  });
}

function seedIfEmpty(database, dateAnchor = null) {
  seedTemplates(database);
  seedMembersAndTasks(database, dateAnchor);
}

export async function initDatabase(customPath = dbPath) {
  const isNewDatabase = !existsSync(customPath);
  await mkdir(path.dirname(customPath), { recursive: true });
  const database = new DatabaseSync(customPath);
  try {
    database.exec("PRAGMA foreign_keys = ON");
    assertDatabaseHealthy(database);
    let hadVersion2 = false;
    let preV2BackupPath = null;
    if (isNewDatabase) {
      createSchema(database);
    } else {
      assertV1Schema(database);
      const version2 = hasTable(database, "app_schema_versions")
        ? database.prepare("SELECT checksum FROM app_schema_versions WHERE version = 2").get()
        : null;
      hadVersion2 = Boolean(version2);
      if (!version2) preV2BackupPath = await createPreV2Backup(database, customPath, "pre-v2-pre-v3");
    }
    migrateV2Schema(database);
    if (!isNewDatabase && !database.prepare("SELECT 1 FROM app_schema_versions WHERE version = 3").get()) {
      // A pure V1 database already has a pre-v2-pre-v3 VACUUM INTO backup;
      // a V2 database needs its own explicit pre-v3 snapshot.
      if (hadVersion2) await createPreV3Backup(database, customPath);
      else if (!preV2BackupPath) await createPreV3Backup(database, customPath);
    }
    migrateV3Schema(database);
    seedIfEmpty(database, isNewDatabase ? todayIsoDate() : null);
    migrateV5Schema(database);
    validateV2Schema(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function listMembers() {
  return db.prepare(`
    SELECT id, name, role, email, status, created_at, updated_at
    FROM members
    WHERE deleted_at IS NULL
    ORDER BY status, name COLLATE NOCASE
  `).all();
}

function getMember(id) {
  return db.prepare("SELECT * FROM members WHERE id = ? AND deleted_at IS NULL").get(id);
}

function listTemplates() {
  return db.prepare(`
    SELECT id, name, description, color, duration_days, checklist_json, created_at, updated_at
    FROM task_templates
    WHERE deleted_at IS NULL
    ORDER BY id
  `).all().map((template) => ({ ...template, checklist: JSON.parse(template.checklist_json || "[]") }));
}

function createTemplate(payload) {
  requireFields(payload, ["name", "color"]);
  const checklist = Array.isArray(payload.checklist) ? payload.checklist.filter(Boolean) : [];
  const duration = Math.max(1, Number(payload.duration_days || 7));
  const timestamp = nowIso();
  const result = db.prepare(`
    INSERT INTO task_templates (name, description, color, duration_days, checklist_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(payload.name.trim(), payload.description?.trim() || "", payload.color, duration, JSON.stringify(checklist), timestamp, timestamp);
  logChange("create_template", { new_value: { id: result.lastInsertRowid, ...payload } });
  return listTemplates().find((item) => item.id === Number(result.lastInsertRowid));
}

function updateTemplate(templateId, payload) {
  const existing = db.prepare("SELECT * FROM task_templates WHERE id = ? AND deleted_at IS NULL").get(templateId);
  if (!existing) throw new Error("Template not found");
  const checklist = Array.isArray(payload.checklist) ? payload.checklist.filter(Boolean) : JSON.parse(existing.checklist_json || "[]");
  const next = {
    name: payload.name?.trim() || existing.name,
    description: payload.description !== undefined ? payload.description.trim() : existing.description,
    color: payload.color || existing.color,
    duration_days: Math.max(1, Number(payload.duration_days || existing.duration_days)),
    checklist_json: JSON.stringify(checklist)
  };
  db.prepare(`
    UPDATE task_templates
    SET name = ?, description = ?, color = ?, duration_days = ?, checklist_json = ?, updated_at = ?
    WHERE id = ?
  `).run(next.name, next.description, next.color, next.duration_days, next.checklist_json, nowIso(), templateId);
  logChange("update_template", { old_value: existing, new_value: next });
  return listTemplates().find((item) => item.id === templateId);
}

function deleteTemplate(templateId) {
  const existing = db.prepare("SELECT * FROM task_templates WHERE id = ? AND deleted_at IS NULL").get(templateId);
  if (!existing) throw new Error("模板不存在");
  db.prepare("UPDATE task_templates SET deleted_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), templateId);
  logChange("delete_template", { old_value: existing });
  return { ok: true };
}

function createMember(payload) {
  requireFields(payload, ["name"]);
  const timestamp = nowIso();
  const result = db.prepare(`
    INSERT INTO members (name, role, email, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(payload.name.trim(), payload.role?.trim() || "", payload.email?.trim() || "", normalizeMemberStatus(payload.status), timestamp, timestamp);
  const member = getMember(result.lastInsertRowid);
  logChange("create_member", { member_id: member.id, new_value: member });
  return member;
}

function updateMember(memberId, payload) {
  const existing = getMember(memberId);
  if (!existing) throw new Error("成员不存在");
  const next = {
    name: payload.name?.trim() || existing.name,
    role: payload.role !== undefined ? payload.role.trim() : existing.role,
    email: payload.email !== undefined ? payload.email.trim() : existing.email,
    status: normalizeMemberStatus(payload.status, existing.status)
  };
  db.prepare("UPDATE members SET name = ?, role = ?, email = ?, status = ?, updated_at = ? WHERE id = ?")
    .run(next.name, next.role, next.email, next.status, nowIso(), memberId);
  logChange("update_member", { member_id: memberId, old_value: existing, new_value: next });
  return getMember(memberId);
}

function deleteMember(memberId) {
  const existing = getMember(memberId);
  if (!existing) throw new Error("成员不存在");
  const primaryTasks = db.prepare(`
    SELECT pt.task_id
    FROM v2_plan_tasks pt JOIN tasks t ON t.id=pt.task_id
    WHERE pt.primary_member_id=? AND t.deleted_at IS NULL
    ORDER BY pt.task_id
  `).all(memberId).map((row) => row.task_id);
  if (primaryTasks.length) v2Fail(409, "PRIMARY_MEMBER_IN_USE", { member_id: memberId, task_ids: primaryTasks });
  const affectedLinks = db.prepare(`
    SELECT DISTINCT pt.plan_id,pt.task_id,pt.task_lineage_key
    FROM v2_plan_tasks pt JOIN task_assignments ta ON ta.task_id=pt.task_id
    WHERE ta.member_id=? AND ta.deleted_at IS NULL
    ORDER BY pt.plan_id,pt.task_id
  `).all(memberId);
  const timestamp = nowIso();
  runTransaction(db, () => {
    db.prepare("UPDATE members SET deleted_at = ?, status = 'inactive', updated_at = ? WHERE id = ?").run(timestamp, timestamp, memberId);
    db.prepare("UPDATE task_assignments SET deleted_at = ?, updated_at = ? WHERE member_id = ? AND deleted_at IS NULL").run(timestamp, timestamp, memberId);
    for (const [planId, links] of groupV2LinksByPlan(affectedLinks)) {
      bumpV2PlanVersion(planId, timestamp);
      insertV2Event(planId, "update_assignment", "本地用户", { oldValue: { member_id: memberId }, impact: { action: "delete_member", task_ids: links.map((link) => link.task_id), task_lineage_keys: links.map((link) => link.task_lineage_key) } });
    }
    logChange("delete_member", { member_id: memberId, old_value: existing });
  });
  return { ok: true };
}

function checklistRows(taskId) {
  return db.prepare(`
    SELECT id, task_id, title, is_done, position, created_at, updated_at
    FROM task_checklist_items
    WHERE task_id = ? AND deleted_at IS NULL
    ORDER BY position, id
  `).all(taskId);
}

function assignmentRowsForTask(taskId) {
  return db.prepare(`
    SELECT ta.id, ta.task_id, ta.member_id, m.name AS member_name, ta.start_date, ta.end_date, ta.progress, ta.note
    FROM task_assignments ta
    JOIN members m ON m.id = ta.member_id
    WHERE ta.task_id = ? AND ta.deleted_at IS NULL AND m.deleted_at IS NULL
    ORDER BY m.name COLLATE NOCASE
  `).all(taskId);
}

function listTasks(includeArchived = false) {
  syncAutoTaskStatuses();
  const tasks = db.prepare(`
    SELECT id, title, description, default_start_date, default_end_date, color, status, created_at, updated_at
    FROM tasks
    WHERE deleted_at IS NULL ${includeArchived ? "" : "AND status != 'archived'"}
    ORDER BY default_start_date, title
  `).all();
  return tasks.map((task) => ({
    ...task,
    assignments: assignmentRowsForTask(task.id),
    checklist: checklistRows(task.id)
  }));
}

function getTask(taskId) {
  return db.prepare("SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL").get(taskId);
}

function taskById(taskId) {
  return listTasks(true).find((task) => task.id === taskId);
}

function insertChecklistItems(taskId, checklist, timestamp) {
  const insert = db.prepare(`
    INSERT INTO task_checklist_items (task_id, title, is_done, position, created_at, updated_at)
    VALUES (?, ?, 0, ?, ?, ?)
  `);
  checklist.filter(Boolean).forEach((item, index) => insert.run(taskId, String(item).trim(), index, timestamp, timestamp));
}

function createTask(payload) {
  requireFields(payload, ["title", "default_start_date", "default_end_date", "color"]);
  assertDateRange(payload.default_start_date, payload.default_end_date, "任务");
  const memberIds = Array.isArray(payload.member_ids) ? payload.member_ids.map(parseId) : [];
  const checklist = Array.isArray(payload.checklist) ? payload.checklist : [];
  const timestamp = nowIso();

  const taskId = runTransaction(db, () => {
    const result = db.prepare(`
      INSERT INTO tasks (title, description, default_start_date, default_end_date, color, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.title.trim(),
      payload.description?.trim() || "",
      payload.default_start_date,
      payload.default_end_date,
      payload.color,
      resolveTaskStatus(payload.status, payload.default_start_date),
      timestamp,
      timestamp
    );
    const id = Number(result.lastInsertRowid);
    const insertAssignment = db.prepare(`
      INSERT INTO task_assignments (task_id, member_id, start_date, end_date, progress, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, '', ?, ?)
    `);
    for (const memberId of new Set(memberIds)) {
      if (!getMember(memberId)) throw new Error(`成员不存在：${memberId}`);
      insertAssignment.run(id, memberId, payload.default_start_date, payload.default_end_date, timestamp, timestamp);
    }
    insertChecklistItems(id, checklist, timestamp);
    logChange("create_task", { task_id: id, new_value: payload });
    return id;
  });
  return taskById(taskId);
}

function updateTask(taskId, payload) {
  const existing = getTask(taskId);
  if (!existing) throw new Error("任务不存在");
  const next = {
    title: payload.title?.trim() || existing.title,
    description: payload.description !== undefined ? payload.description.trim() : existing.description,
    default_start_date: payload.default_start_date || existing.default_start_date,
    default_end_date: payload.default_end_date || existing.default_end_date,
    color: payload.color || existing.color,
    status: resolveTaskStatus(payload.status, payload.default_start_date || existing.default_start_date, existing.status)
  };
  assertDateRange(next.default_start_date, next.default_end_date, "任务");
  const timestamp = nowIso();
  const syncAssignments = payload.sync_assignments === true;

  runTransaction(db, () => {
    db.prepare(`
      UPDATE tasks
      SET title = ?, description = ?, default_start_date = ?, default_end_date = ?, color = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(next.title, next.description, next.default_start_date, next.default_end_date, next.color, next.status, timestamp, taskId);
    if (syncAssignments) {
      db.prepare("UPDATE task_assignments SET start_date = ?, end_date = ?, updated_at = ? WHERE task_id = ? AND deleted_at IS NULL")
        .run(next.default_start_date, next.default_end_date, timestamp, taskId);
    }
    logChange(syncAssignments ? "update_task_and_sync_assignments" : "update_task", { task_id: taskId, old_value: existing, new_value: next });
  });
  return taskById(taskId);
}

function archiveTask(taskId) {
  const existing = getTask(taskId);
  if (!existing) throw new Error("任务不存在");
  db.prepare("UPDATE tasks SET status = 'archived', updated_at = ? WHERE id = ?").run(nowIso(), taskId);
  logChange("archive_task", { task_id: taskId, old_value: existing, new_value: { status: "archived" } });
  return taskById(taskId);
}

function restoreTask(taskId) {
  const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!existing) throw new Error("Task not found");
  const link = db.prepare("SELECT * FROM v2_plan_tasks WHERE task_id=?").get(taskId);
  let primaryAssignment = null;
  let restorableAssignmentIds = null;
  let skippedCollaboratorIds = [];
  if (link) {
    const primaryMember = db.prepare("SELECT id,status,deleted_at FROM members WHERE id=?").get(link.primary_member_id);
    if (!primaryMember || primaryMember.deleted_at || primaryMember.status !== "active") {
      v2Fail(409, "PRIMARY_MEMBER_UNAVAILABLE", { task_id: taskId, member_id: link.primary_member_id });
    }
    primaryAssignment = db.prepare("SELECT id FROM task_assignments WHERE task_id=? AND member_id=?").get(taskId, link.primary_member_id);
    if (!primaryAssignment) v2Fail(409, "PRIMARY_ASSIGNMENT_MISSING", { task_id: taskId, member_id: link.primary_member_id });
    const assignments = db.prepare(`
      SELECT ta.id,ta.member_id,m.status,m.deleted_at member_deleted_at
      FROM task_assignments ta LEFT JOIN members m ON m.id=ta.member_id
      WHERE ta.task_id=? ORDER BY ta.id
    `).all(taskId);
    restorableAssignmentIds = assignments.filter((row) => row.id === primaryAssignment.id || (row.member_deleted_at === null && row.status === "active")).map((row) => row.id);
    skippedCollaboratorIds = assignments.filter((row) => row.id !== primaryAssignment.id && (row.member_deleted_at !== null || row.status !== "active")).map((row) => row.member_id);
  }
  const timestamp = nowIso();
  runTransaction(db, () => {
    const restoredStatus = existing.status === "archived" ? deriveAutoTaskStatus(existing.default_start_date) : resolveTaskStatus(existing.status, existing.default_start_date, existing.status);
    db.prepare("UPDATE tasks SET status = ?, deleted_at = NULL, updated_at = ? WHERE id = ?")
      .run(restoredStatus, timestamp, taskId);
    if (link) {
      if (restorableAssignmentIds.length) {
        const placeholders = restorableAssignmentIds.map(() => "?").join(",");
        db.prepare(`UPDATE task_assignments SET deleted_at=NULL,updated_at=? WHERE id IN (${placeholders})`).run(timestamp, ...restorableAssignmentIds);
      }
      bumpV2PlanVersion(link.plan_id, timestamp);
      insertV2Event(link.plan_id, "task_restore", "本地用户", { oldValue: { task_id: taskId, deleted_at: existing.deleted_at }, newValue: { task_id: taskId, status: restoredStatus }, impact: { task_lineage_key: link.task_lineage_key, skipped_collaborator_member_ids: skippedCollaboratorIds } });
    } else {
      db.prepare("UPDATE task_assignments SET deleted_at = NULL, updated_at = ? WHERE task_id = ?").run(timestamp, taskId);
    }
    db.prepare("UPDATE task_checklist_items SET deleted_at = NULL, updated_at = ? WHERE task_id = ?").run(timestamp, taskId);
    logChange("restore_task", { task_id: taskId, old_value: existing });
  });
  return taskById(taskId);
}

function deleteTask(taskId) {
  const existing = getTask(taskId);
  if (!existing) throw new Error("任务不存在");
  const link = db.prepare("SELECT * FROM v2_plan_tasks WHERE task_id=?").get(taskId);
  const timestamp = nowIso();
  runTransaction(db, () => {
    db.prepare("UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, taskId);
    db.prepare("UPDATE task_assignments SET deleted_at = ?, updated_at = ? WHERE task_id = ? AND deleted_at IS NULL").run(timestamp, timestamp, taskId);
    db.prepare("UPDATE task_checklist_items SET deleted_at = ?, updated_at = ? WHERE task_id = ? AND deleted_at IS NULL").run(timestamp, timestamp, taskId);
    if (link) {
      bumpV2PlanVersion(link.plan_id, timestamp);
      insertV2Event(link.plan_id, "task_soft_delete", "本地用户", { oldValue: { task_id: taskId, title: existing.title }, impact: { task_lineage_key: link.task_lineage_key } });
    }
    logChange("delete_task", { task_id: taskId, old_value: existing });
  });
  return { ok: true };
}

function restoreMember(memberId) {
  const existing = db.prepare("SELECT * FROM members WHERE id = ?").get(memberId);
  if (!existing) throw new Error("Member not found");
  db.prepare("UPDATE members SET deleted_at = NULL, status = 'active', updated_at = ? WHERE id = ?").run(nowIso(), memberId);
  logChange("restore_member", { member_id: memberId, old_value: existing });
  return getMember(memberId);
}

function addTaskMembers(taskId, memberIds) {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  const timestamp = nowIso();
  runTransaction(db, () => {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO task_assignments (task_id, member_id, start_date, end_date, progress, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, '', ?, ?)
    `);
    for (const memberId of new Set(memberIds.map(parseId))) {
      if (!getMember(memberId)) throw new Error(`成员不存在：${memberId}`);
      insert.run(taskId, memberId, task.default_start_date, task.default_end_date, timestamp, timestamp);
    }
    logChange("add_task_members", { task_id: taskId, new_value: { member_ids: memberIds } });
  });
  return taskById(taskId);
}

function updateAssignment(assignmentId, payload) {
  const existing = db.prepare(`
    SELECT ta.*, t.title AS task_title
    FROM task_assignments ta
    JOIN tasks t ON t.id = ta.task_id
    WHERE ta.id = ? AND ta.deleted_at IS NULL
  `).get(assignmentId);
  if (!existing) throw new Error("成员分配不存在");
  const next = {
    start_date: payload.start_date || existing.start_date,
    end_date: payload.end_date || existing.end_date,
    progress: Number.isInteger(Number(payload.progress)) ? Math.max(0, Math.min(100, Number(payload.progress))) : existing.progress,
    note: payload.note !== undefined ? String(payload.note) : existing.note
  };
  assertDateRange(next.start_date, next.end_date, "个人分配");
  db.prepare("UPDATE task_assignments SET start_date = ?, end_date = ?, progress = ?, note = ?, updated_at = ? WHERE id = ?")
    .run(next.start_date, next.end_date, next.progress, next.note, nowIso(), assignmentId);
  logChange("update_assignment", { task_id: existing.task_id, assignment_id: assignmentId, member_id: existing.member_id, old_value: existing, new_value: next });
  return db.prepare(`
    SELECT ta.id, ta.task_id, ta.member_id, m.name AS member_name, ta.start_date, ta.end_date, ta.progress, ta.note
    FROM task_assignments ta JOIN members m ON m.id = ta.member_id WHERE ta.id = ?
  `).get(assignmentId);
}

function deleteAssignment(assignmentId) {
  const existing = db.prepare("SELECT * FROM task_assignments WHERE id = ? AND deleted_at IS NULL").get(assignmentId);
  if (!existing) throw new Error("成员分配不存在");
  const link = db.prepare("SELECT * FROM v2_plan_tasks WHERE task_id=?").get(existing.task_id);
  const task = link ? db.prepare("SELECT deleted_at FROM tasks WHERE id=?").get(existing.task_id) : null;
  if (link && !task.deleted_at && link.primary_member_id === existing.member_id) {
    v2Fail(409, "PRIMARY_ASSIGNMENT_REQUIRED", { task_id: existing.task_id, member_id: existing.member_id });
  }
  const timestamp = nowIso();
  runTransaction(db, () => {
    db.prepare("UPDATE task_assignments SET deleted_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, assignmentId);
    if (link) {
      bumpV2PlanVersion(link.plan_id, timestamp);
      insertV2Event(link.plan_id, "update_assignment", "本地用户", { oldValue: { assignment_id: assignmentId, member_id: existing.member_id }, impact: { action: "remove_assignment", task_id: existing.task_id, task_lineage_key: link.task_lineage_key } });
    }
    logChange("remove_assignment", { task_id: existing.task_id, assignment_id: assignmentId, member_id: existing.member_id, old_value: existing });
  });
  return { ok: true };
}

function createChecklistItem(taskId, payload) {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  requireFields(payload, ["title"]);
  const maxPosition = db.prepare("SELECT COALESCE(MAX(position), -1) AS max_position FROM task_checklist_items WHERE task_id = ? AND deleted_at IS NULL").get(taskId).max_position;
  const timestamp = nowIso();
  const result = db.prepare(`
    INSERT INTO task_checklist_items (task_id, title, is_done, position, created_at, updated_at)
    VALUES (?, ?, 0, ?, ?, ?)
  `).run(taskId, payload.title.trim(), maxPosition + 1, timestamp, timestamp);
  logChange("create_checklist_item", { task_id: taskId, new_value: payload });
  return checklistRows(taskId).find((item) => item.id === Number(result.lastInsertRowid));
}

function updateChecklistItem(itemId, payload) {
  const existing = db.prepare("SELECT * FROM task_checklist_items WHERE id = ? AND deleted_at IS NULL").get(itemId);
  if (!existing) throw new Error("检查项不存在");
  const next = {
    title: payload.title !== undefined ? String(payload.title).trim() : existing.title,
    is_done: payload.is_done === undefined ? existing.is_done : payload.is_done ? 1 : 0
  };
  if (!next.title) throw new Error("检查项标题不能为空");
  db.prepare("UPDATE task_checklist_items SET title = ?, is_done = ?, updated_at = ? WHERE id = ?")
    .run(next.title, next.is_done, nowIso(), itemId);
  logChange("update_checklist_item", { task_id: existing.task_id, old_value: existing, new_value: next });
  return checklistRows(existing.task_id).find((item) => item.id === itemId);
}

function deleteChecklistItem(itemId) {
  const existing = db.prepare("SELECT * FROM task_checklist_items WHERE id = ? AND deleted_at IS NULL").get(itemId);
  if (!existing) throw new Error("检查项不存在");
  db.prepare("UPDATE task_checklist_items SET deleted_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), itemId);
  logChange("delete_checklist_item", { task_id: existing.task_id, old_value: existing });
  return { ok: true };
}

function batchUpdate(payload) {
  const taskIds = Array.isArray(payload.task_ids) ? payload.task_ids.map(parseId) : [];
  if (!taskIds.length && payload.archive_completed !== true) throw new Error("请先选择任务");
  const timestamp = nowIso();
  const updated = [];
  runTransaction(db, () => {
    const ids = payload.archive_completed === true
      ? db.prepare("SELECT id FROM tasks WHERE status = 'completed' AND deleted_at IS NULL").all().map((item) => item.id)
      : taskIds;
    for (const taskId of ids) {
      const task = getTask(taskId);
      if (!task) continue;
      const nextStatus = payload.archive_completed === true || payload.status === "archived"
        ? "archived"
        : payload.status ? resolveTaskStatus(payload.status, task.default_start_date, task.status) : resolveTaskStatus(task.status, task.default_start_date, task.status);
      const nextEnd = payload.default_end_date || task.default_end_date;
      assertDateRange(task.default_start_date, nextEnd, "任务");
      db.prepare("UPDATE tasks SET status = ?, default_end_date = ?, updated_at = ? WHERE id = ?").run(nextStatus, nextEnd, timestamp, taskId);
      if (payload.sync_assignments === true || payload.default_end_date) {
        db.prepare("UPDATE task_assignments SET end_date = ?, updated_at = ? WHERE task_id = ? AND deleted_at IS NULL").run(nextEnd, timestamp, taskId);
      }
      updated.push(taskId);
    }
    logChange("batch_update_tasks", { new_value: { ...payload, updated } });
  });
  return { updated };
}

function dashboardData(filters = {}) {
  const members = listMembers();
  const includeArchived = filters.status === "archived";
  const tasks = listTasks(includeArchived);
  const today = todayIsoDate();
  const assignments = db.prepare(`
    SELECT
      ta.id, ta.task_id, ta.member_id, ta.start_date, ta.end_date, ta.progress, ta.note,
      m.name AS member_name, m.role AS member_role,
      t.title AS task_title, t.description AS task_description, t.color, t.status AS task_status,
      CASE WHEN t.status IN ('completed', 'archived') THEN 1 ELSE 0 END AS is_completed,
      CASE WHEN t.status NOT IN ('completed', 'cancelled', 'archived') AND ta.end_date < ? THEN 1 ELSE 0 END AS is_overdue
    FROM task_assignments ta
    JOIN members m ON m.id = ta.member_id
    JOIN tasks t ON t.id = ta.task_id
    WHERE ta.deleted_at IS NULL AND m.deleted_at IS NULL AND t.deleted_at IS NULL ${includeArchived ? "" : "AND t.status != 'archived'"}
    ORDER BY m.name COLLATE NOCASE, ta.start_date, t.title
  `).all(today);
  const stats = buildStats(members, tasks, assignments, today);
  return { members, tasks, assignments, today, stats, filters, filtered_task_ids: filterTaskIds(tasks, assignments, stats.member_load, filters) };
}

function filterTaskIds(tasks, assignments, memberLoad, filters) {
  let ids = new Set(tasks.map((task) => task.id));
  if (filters.member_id) {
    const memberId = parseId(filters.member_id);
    ids = new Set(assignments.filter((item) => item.member_id === memberId).map((item) => item.task_id));
  }
  if (filters.status) {
    ids = new Set([...ids].filter((id) => tasks.find((task) => task.id === id)?.status === filters.status));
  }
  if (filters.overdue === "1") {
    ids = new Set([...ids].filter((id) => assignments.some((item) => item.task_id === id && item.is_overdue)));
  }
  if (filters.overlap === "1") {
    const memberIds = new Set(memberLoad.filter((item) => item.overlap_count > 0).map((item) => item.member_id));
    ids = new Set([...ids].filter((id) => assignments.some((item) => item.task_id === id && memberIds.has(item.member_id))));
  }
  if (filters.start_date) {
    ids = new Set([...ids].filter((id) => tasks.find((task) => task.id === id)?.default_end_date >= filters.start_date));
  }
  if (filters.end_date) {
    ids = new Set([...ids].filter((id) => tasks.find((task) => task.id === id)?.default_start_date <= filters.end_date));
  }
  return [...ids];
}

function buildStats(members, tasks, assignments, today) {
  const next7 = addDays(today, 7);
  const next30 = addDays(today, 30);
  const memberLoad = members.map((member) => {
    const own = assignments.filter((item) => item.member_id === member.id);
    const current = own.filter((item) => item.start_date <= today && item.end_date >= today && !["completed", "cancelled", "archived"].includes(item.task_status));
    const future7 = own.filter((item) => item.start_date <= next7 && item.end_date >= today && !["completed", "cancelled", "archived"].includes(item.task_status));
    const future30 = own.filter((item) => item.start_date <= next30 && item.end_date >= today && !["completed", "cancelled", "archived"].includes(item.task_status));
    return {
      member_id: member.id,
      member_name: member.name,
      role: member.role,
      current_count: current.length,
      next7_count: future7.length,
      next30_count: future30.length,
      overdue_count: own.filter((item) => item.is_overdue).length,
      completed_count: own.filter((item) => item.is_completed).length,
      overlap_count: countOverlaps(own)
    };
  });
  return {
    total_members: members.length,
    total_tasks: tasks.length,
    active_assignments: assignments.filter((item) => item.task_status === "active").length,
    overdue_assignments: assignments.filter((item) => item.is_overdue).length,
    completed_tasks: tasks.filter((item) => item.status === "completed").length,
    overlapping_members: memberLoad.filter((item) => item.overlap_count > 0).length,
    member_load: memberLoad
  };
}

function countOverlaps(items) {
  let count = 0;
  const active = items.filter((item) => !["completed", "cancelled", "archived"].includes(item.task_status));
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      if (active[i].start_date <= active[j].end_date && active[j].start_date <= active[i].end_date) count += 1;
    }
  }
  return count;
}

function changeLogs() {
  return db.prepare(`
    SELECT id, task_id, assignment_id, member_id, change_type, old_value, new_value, created_at
    FROM task_change_logs ORDER BY id DESC LIMIT 200
  `).all();
}

function listArchiveTasks() {
  return listTasks(true).filter((task) => task.status === "archived" && !task.deleted_at);
}

function listDeletedItems() {
  const tasks = db.prepare(`
    SELECT id, title, status, default_start_date, default_end_date, deleted_at, updated_at
    FROM tasks
    WHERE deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  `).all();
  const members = db.prepare(`
    SELECT id, name, role, email, status, deleted_at, updated_at
    FROM members
    WHERE deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  `).all();
  return { tasks, members };
}

function backupData() {
  return {
    exported_at: nowIso(),
    members: db.prepare("SELECT * FROM members").all(),
    tasks: db.prepare("SELECT * FROM tasks").all(),
    task_assignments: db.prepare("SELECT * FROM task_assignments").all(),
    task_checklist_items: db.prepare("SELECT * FROM task_checklist_items").all(),
    task_templates: db.prepare("SELECT * FROM task_templates").all(),
    task_change_logs: db.prepare("SELECT * FROM task_change_logs ORDER BY id DESC").all()
  };
}

function maintenancePreview() {
  const archivedTasks = db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status = 'archived' AND deleted_at IS NULL").get().count;
  const deletedTasks = db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE deleted_at IS NOT NULL").get().count;
  const deletedMembers = db.prepare("SELECT COUNT(*) AS count FROM members WHERE deleted_at IS NOT NULL").get().count;
  const logs = db.prepare("SELECT COUNT(*) AS count FROM task_change_logs").get().count;
  return {
    archived_tasks: archivedTasks,
    deleted_tasks: deletedTasks,
    deleted_members: deletedMembers,
    logs
  };
}

function exportTasksCsv() {
  const rows = dashboardData().assignments.map((item) => ({
    task_id: item.task_id,
    task_title: item.task_title,
    task_status: item.task_status,
    member_id: item.member_id,
    member_name: item.member_name,
    start_date: item.start_date,
    end_date: item.end_date,
    progress: item.progress,
    overdue: item.is_overdue ? "yes" : "no"
  }));
  return toCsv(rows, ["task_id", "task_title", "task_status", "member_id", "member_name", "start_date", "end_date", "progress", "overdue"]);
}

function exportLoadCsv() {
  return toCsv(dashboardData().stats.member_load, ["member_id", "member_name", "role", "current_count", "next7_count", "next30_count", "overdue_count", "completed_count", "overlap_count"]);
}

function importMembersCsv(csvText) {
  const rows = parseCsv(csvText);
  const errors = [];
  let created = 0;
  for (const row of rows) {
    try {
      if (!row.name) throw new Error("name 不能为空");
      createMember({ name: row.name, role: row.role || "", email: row.email || "", status: row.status || "active" });
      created += 1;
    } catch (error) {
      errors.push({ line: row.__line, error: error.message });
    }
  }
  return { created, errors };
}

function importTasksCsv(csvText) {
  const rows = parseCsv(csvText);
  const errors = [];
  let created = 0;
  const memberByName = new Map(listMembers().map((member) => [member.name, member.id]));
  for (const row of rows) {
    try {
      if (!row.title) throw new Error("title 不能为空");
      if (!row.default_start_date || !row.default_end_date) throw new Error("default_start_date/default_end_date 不能为空");
      const memberNames = (row.member_names || "").split(/[;；]/).map((item) => item.trim()).filter(Boolean);
      const member_ids = memberNames.map((name) => memberByName.get(name)).filter(Boolean);
      const checklist = (row.checklist || "").split(/[;；]/).map((item) => item.trim()).filter(Boolean);
      createTask({
        title: row.title,
        description: row.description || "",
        default_start_date: row.default_start_date,
        default_end_date: row.default_end_date,
        color: row.color || "#2563eb",
        status: row.status || "auto",
        member_ids,
        checklist
      });
      created += 1;
    } catch (error) {
      errors.push({ line: row.__line, error: error.message });
    }
  }
  return { created, errors };
}

function clearLogs() {
  const backup = backupData();
  const result = db.prepare("DELETE FROM task_change_logs").run();
  return { deleted: result.changes, backup };
}

function purgeArchivedTasks() {
  const backup = backupData();
  const timestamp = nowIso();
  const archived = db.prepare("SELECT id,title FROM tasks WHERE status = 'archived' AND deleted_at IS NULL ORDER BY id").all();
  runTransaction(db, () => {
    for (const task of archived) {
      const link = db.prepare("SELECT * FROM v2_plan_tasks WHERE task_id=?").get(task.id);
      db.prepare("UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, task.id);
      db.prepare("UPDATE task_assignments SET deleted_at = ?, updated_at = ? WHERE task_id = ? AND deleted_at IS NULL").run(timestamp, timestamp, task.id);
      db.prepare("UPDATE task_checklist_items SET deleted_at = ?, updated_at = ? WHERE task_id = ? AND deleted_at IS NULL").run(timestamp, timestamp, task.id);
      if (link) {
        bumpV2PlanVersion(link.plan_id, timestamp);
        insertV2Event(link.plan_id, "task_soft_delete", "本地用户", { oldValue: { task_id: task.id, title: task.title, status: "archived" }, impact: { task_lineage_key: link.task_lineage_key, source: "purge_archived" } });
      }
    }
    logChange("purge_archived_tasks", { new_value: { task_ids: archived.map((task) => task.id) } });
  });
  return { deleted: archived.length, backup };
}

function resetSampleData() {
  const backup = backupData();
  const hardDeleteLinks = db.prepare(`
    SELECT pt.plan_id,pt.task_id,pt.task_lineage_key,t.title
    FROM v2_plan_tasks pt JOIN tasks t ON t.id=pt.task_id
    ORDER BY pt.plan_id,pt.task_id
  `).all();
  runTransaction(db, () => {
    const timestamp = nowIso();
    for (const [planId, links] of groupV2LinksByPlan(hardDeleteLinks)) {
      bumpV2PlanVersion(planId, timestamp);
      for (const link of links) {
        insertV2Event(planId, "task_hard_delete", "本地用户", { oldValue: { plan_id: planId, task_id: link.task_id, task_lineage_key: link.task_lineage_key, title: link.title }, impact: { source: "reset_sample" } });
      }
    }
    db.exec(`
      DELETE FROM v5_events;
      DELETE FROM v5_test_items;
      DELETE FROM v5_task_samples;
      DELETE FROM v5_task_members;
      DELETE FROM v5_tasks;
      DELETE FROM task_change_logs;
      DELETE FROM task_checklist_items;
      DELETE FROM task_assignments;
      DELETE FROM tasks;
      DELETE FROM members;
      DELETE FROM task_templates;
      DELETE FROM sqlite_sequence WHERE name IN ('members', 'tasks', 'task_assignments', 'task_checklist_items', 'task_templates', 'task_change_logs');
    `);
    seedTemplates(db);
    insertSampleMembersAndTasks(db);
  });
  return { ok: true, backup };
}

class V2ApiError extends Error {
  constructor(status, code, details = {}, message = code) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function v2Fail(status, code, details = {}, message = code) {
  throw new V2ApiError(status, code, details, message);
}

function groupV2LinksByPlan(links) {
  const grouped = new Map();
  for (const link of links) {
    if (!grouped.has(link.plan_id)) grouped.set(link.plan_id, []);
    grouped.get(link.plan_id).push(link);
  }
  return [...grouped.entries()].sort((left, right) => left[0] - right[0]);
}

function bumpV2PlanVersion(planId, timestamp = nowIso()) {
  db.prepare("UPDATE v2_control_plans SET version=version+1,updated_at=? WHERE id=?").run(timestamp, planId);
}

function parseV2Id(value, parameter = "id") {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) v2Fail(400, "INVALID_ID", { parameter, value });
  return id;
}

function assertKnownFields(payload, allowed) {
  const fields = Object.keys(payload || {}).filter((field) => !allowed.includes(field)).sort();
  if (fields.length) v2Fail(400, "UNKNOWN_FIELD", { fields });
}

function queryFields(url, allowed) {
  const keys = [...url.searchParams.keys()];
  const fields = [...new Set(keys.filter((key) => !allowed.includes(key)))].sort();
  if (fields.length) v2Fail(400, "UNKNOWN_QUERY", { fields });
  for (const key of new Set(keys)) {
    if (url.searchParams.getAll(key).length > 1) v2Fail(400, "INVALID_QUERY", { field: key, reason: "duplicate" });
  }
  return Object.fromEntries(url.searchParams);
}

function validation(field, reason = "invalid") {
  v2Fail(400, "VALIDATION_ERROR", { field, reason });
}

function trimText(value, field, min, max, { optional = false, nullable = false, fallback = "" } = {}) {
  if (value === undefined) {
    if (optional) return fallback;
    validation(field, "required");
  }
  if (value === null) {
    if (nullable) return null;
    if (optional) return fallback;
    validation(field, "required");
  }
  if (typeof value !== "string") validation(field, "type");
  const text = value.trim();
  const length = Array.from(text).length;
  if (length < min || length > max) validation(field, "length");
  return text;
}

function optionalNullableText(value, field, max) {
  if (value === undefined || value === null || value === "") return null;
  return trimText(value, field, 1, max);
}

function boolValue(value, field) {
  if (typeof value !== "boolean") validation(field, "type");
  return value;
}

function intValue(value, field, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < min || value > max) validation(field, "range");
  return value;
}

function isLocalDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

function localDate(value, field, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (!isLocalDate(value)) validation(field, "date");
  return value;
}

function daysBetween(left, right) {
  if (!left || !right) return null;
  const toUtc = (value) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(right) - toUtc(left)) / 86_400_000);
}

function actorLabel(value) {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return "本地用户";
  return trimText(value, "actor_label", 1, 100);
}

function normalizedName(value) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("und");
}

function jsonOrNull(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function previewHash(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function v2NotFound(resource, id) {
  const codes = {
    plan: "PLAN_NOT_FOUND",
    source_group: "SOURCE_GROUP_NOT_FOUND",
    contact: "CONTACT_NOT_FOUND",
    cryostat: "CRYOSTAT_NOT_FOUND",
    test_item: "TEST_ITEM_NOT_FOUND",
    template: "TEMPLATE_NOT_FOUND",
    member: "MEMBER_NOT_FOUND",
    plan_task: "PLAN_TASK_NOT_FOUND",
    task: "TASK_NOT_FOUND",
    submission: "SUBMISSION_NOT_FOUND"
  };
  v2Fail(404, codes[resource], { resource, id });
}

function listOptions(query, allowedSorts, defaultSort) {
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  const sort = query.sort || defaultSort;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) v2Fail(400, "INVALID_QUERY", { field: "limit", reason: "range" });
  if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) v2Fail(400, "INVALID_QUERY", { field: "offset", reason: "range" });
  if (!allowedSorts.includes(sort)) v2Fail(400, "INVALID_QUERY", { field: "sort", reason: "enum" });
  if (query.search !== undefined && query.search.trim().length > 200) v2Fail(400, "INVALID_QUERY", { field: "search", reason: "length" });
  return { limit, offset, sort, search: query.search?.trim() || "" };
}

function sourceGroupObject(row) {
  return {
    id: row.id,
    name: row.name,
    note: row.note,
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function sourceContactObject(row) {
  return {
    id: row.id,
    source_group_id: row.source_group_id,
    name: row.name,
    title: row.title,
    contact_text: row.contact_text,
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function cryostatObject(row) {
  return {
    id: row.id,
    name: row.name,
    note: row.note,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function testItemObject(row) {
  return {
    id: row.id,
    plan_id: row.plan_id,
    title: row.title,
    description: row.description,
    acceptance_criteria: row.acceptance_criteria,
    is_required: Boolean(row.is_required),
    position: row.position,
    archived: Boolean(row.archived_at),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function eventObject(row) {
  return {
    id: row.id,
    plan_id: row.plan_id,
    event_type: row.event_type,
    actor_label: row.actor_label,
    old_value: row.old_value_json ? JSON.parse(row.old_value_json) : null,
    new_value: row.new_value_json ? JSON.parse(row.new_value_json) : null,
    impact: row.impact_json ? JSON.parse(row.impact_json) : null,
    created_at: row.created_at
  };
}

function insertV2Event(planId, eventType, actor, { oldValue, newValue, impact } = {}) {
  const result = db.prepare(`
    INSERT INTO v2_plan_events (plan_id,event_type,actor_label,old_value_json,new_value_json,impact_json,created_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(planId, eventType, actorLabel(actor), jsonOrNull(oldValue), jsonOrNull(newValue), jsonOrNull(impact), nowIso());
  return eventObject(db.prepare("SELECT * FROM v2_plan_events WHERE id = ?").get(result.lastInsertRowid));
}

function getV2PlanRow(planId) {
  const row = db.prepare("SELECT * FROM v2_control_plans WHERE id = ?").get(planId);
  if (!row) v2NotFound("plan", planId);
  return row;
}

function getV2Resource(table, resource, id) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) v2NotFound(resource, id);
  return row;
}

function normalizeEtaChoice(date, pending) {
  if (typeof pending !== "boolean" || (pending && date !== null) || (!pending && !isLocalDate(date))) {
    v2Fail(400, "ETA_CHOICE_INVALID", { new_eta_date: date ?? null, eta_pending: pending });
  }
  return { current_eta_date: pending ? null : date, eta_pending: pending };
}

function normalizeCryostatChoice(id, pending) {
  if (typeof pending !== "boolean" || (pending && id !== null) || (!pending && (!Number.isInteger(id) || id <= 0))) {
    v2Fail(400, "CRYOSTAT_CHOICE_INVALID", { new_cryostat_id: id ?? null, cryostat_pending: pending });
  }
  return { cryostat_id: pending ? null : id, cryostat_pending: pending };
}

function assertIdentifierPair(identifier, kind) {
  const valid = (identifier === null && kind === null) || (typeof identifier === "string" && identifier.length >= 1 && identifier.length <= 200 && ["temporary", "formal"].includes(kind));
  if (!valid) v2Fail(400, "IDENTIFIER_PAIR_INVALID", { sample_identifier: identifier, identifier_kind: kind });
}

function requireActiveResource(row, resource) {
  const active = resource === "cryostat" ? row.status === "active" : Boolean(row.is_active);
  if (!active) v2Fail(409, "RESOURCE_INACTIVE", { resource, id: row.id });
}

function v2MigrationStatus() {
  try {
    const version = validateV2Schema(db);
    return {
      schema_version: 2,
      migration_name: version.name,
      checksum: version.checksum,
      applied_at: version.applied_at,
      quick_check: sqliteScalar(db, "PRAGMA quick_check"),
      foreign_key_violations: db.prepare("PRAGMA foreign_key_check").all().length
    };
  } catch (error) {
    v2Fail(500, "SCHEMA_NOT_READY", {}, error.message);
  }
}

function listV2SourceGroups(url) {
  const query = queryFields(url, ["include_inactive", "search", "limit", "offset", "sort"]);
  const options = listOptions(query, ["name_asc", "updated_desc"], "name_asc");
  const includeInactive = query.include_inactive === undefined ? false : query.include_inactive === "1";
  if (query.include_inactive !== undefined && !["0", "1"].includes(query.include_inactive)) v2Fail(400, "INVALID_QUERY", { field: "include_inactive", reason: "enum" });
  let rows = db.prepare("SELECT * FROM v2_source_groups").all();
  if (!includeInactive) rows = rows.filter((row) => row.is_active);
  if (options.search) rows = rows.filter((row) => row.name.toLocaleLowerCase().includes(options.search.toLocaleLowerCase()));
  rows.sort(options.sort === "updated_desc" ? (a, b) => b.updated_at.localeCompare(a.updated_at) || b.id - a.id : (a, b) => a.normalized_name.localeCompare(b.normalized_name) || a.id - b.id);
  return { data: rows.slice(options.offset, options.offset + options.limit).map(sourceGroupObject), meta: { limit: options.limit, offset: options.offset, total: rows.length, sort: options.sort } };
}

function createV2SourceGroup(payload) {
  assertKnownFields(payload, ["name", "note"]);
  const name = trimText(payload.name, "name", 1, 100);
  const note = trimText(payload.note, "note", 0, 1000, { optional: true, fallback: "" });
  const normalized = normalizedName(name);
  if (db.prepare("SELECT 1 FROM v2_source_groups WHERE normalized_name = ?").get(normalized)) v2Fail(409, "SOURCE_GROUP_EXISTS", { normalized_name: normalized });
  const timestamp = nowIso();
  const id = db.prepare("INSERT INTO v2_source_groups (name,normalized_name,note,created_at,updated_at) VALUES (?,?,?,?,?)")
    .run(name, normalized, note, timestamp, timestamp).lastInsertRowid;
  return sourceGroupObject(db.prepare("SELECT * FROM v2_source_groups WHERE id = ?").get(id));
}

function updateV2SourceGroup(id, payload) {
  assertKnownFields(payload, ["name", "note", "is_active", "expected_updated_at"]);
  const existing = getV2Resource("v2_source_groups", "source_group", id);
  const name = trimText(payload.name, "name", 1, 100);
  const note = trimText(payload.note, "note", 0, 1000);
  const active = boolValue(payload.is_active, "is_active");
  const expected = trimText(payload.expected_updated_at, "expected_updated_at", 1, 100);
  if (expected !== existing.updated_at) v2Fail(409, "RESOURCE_CONFLICT", { expected_updated_at: expected, current_updated_at: existing.updated_at });
  const normalized = normalizedName(name);
  if (db.prepare("SELECT 1 FROM v2_source_groups WHERE normalized_name = ? AND id != ?").get(normalized, id)) v2Fail(409, "SOURCE_GROUP_EXISTS", { normalized_name: normalized });
  db.prepare("UPDATE v2_source_groups SET name=?,normalized_name=?,note=?,is_active=?,updated_at=? WHERE id=?")
    .run(name, normalized, note, active ? 1 : 0, nowIso(), id);
  return sourceGroupObject(db.prepare("SELECT * FROM v2_source_groups WHERE id = ?").get(id));
}

function listV2Contacts(groupId, url) {
  getV2Resource("v2_source_groups", "source_group", groupId);
  const query = queryFields(url, ["include_inactive", "search", "limit", "offset", "sort"]);
  const options = listOptions(query, ["name_asc", "updated_desc"], "name_asc");
  const includeInactive = query.include_inactive === undefined ? false : query.include_inactive === "1";
  if (query.include_inactive !== undefined && !["0", "1"].includes(query.include_inactive)) v2Fail(400, "INVALID_QUERY", { field: "include_inactive", reason: "enum" });
  let rows = db.prepare("SELECT * FROM v2_source_contacts WHERE source_group_id = ?").all(groupId);
  if (!includeInactive) rows = rows.filter((row) => row.is_active);
  if (options.search) rows = rows.filter((row) => `${row.name} ${row.title} ${row.contact_text}`.toLocaleLowerCase().includes(options.search.toLocaleLowerCase()));
  rows.sort(options.sort === "updated_desc" ? (a, b) => b.updated_at.localeCompare(a.updated_at) || b.id - a.id : (a, b) => a.normalized_name.localeCompare(b.normalized_name) || a.id - b.id);
  return { data: rows.slice(options.offset, options.offset + options.limit).map(sourceContactObject), meta: { limit: options.limit, offset: options.offset, total: rows.length, sort: options.sort } };
}

function createV2Contact(groupId, payload) {
  assertKnownFields(payload, ["name", "title", "contact_text"]);
  const group = getV2Resource("v2_source_groups", "source_group", groupId);
  requireActiveResource(group, "source_group");
  const name = trimText(payload.name, "name", 1, 100);
  const title = trimText(payload.title, "title", 0, 100, { optional: true, fallback: "" });
  const contactText = trimText(payload.contact_text, "contact_text", 0, 300, { optional: true, fallback: "" });
  const normalized = normalizedName(name);
  if (db.prepare("SELECT 1 FROM v2_source_contacts WHERE source_group_id=? AND normalized_name=?").get(groupId, normalized)) v2Fail(409, "CONTACT_EXISTS", { source_group_id: groupId, normalized_name: normalized });
  const timestamp = nowIso();
  const id = db.prepare("INSERT INTO v2_source_contacts (source_group_id,name,normalized_name,title,contact_text,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run(groupId, name, normalized, title, contactText, timestamp, timestamp).lastInsertRowid;
  return sourceContactObject(db.prepare("SELECT * FROM v2_source_contacts WHERE id = ?").get(id));
}

function updateV2Contact(id, payload) {
  assertKnownFields(payload, ["name", "title", "contact_text", "is_active", "expected_updated_at"]);
  const existing = getV2Resource("v2_source_contacts", "contact", id);
  const name = trimText(payload.name, "name", 1, 100);
  const title = trimText(payload.title, "title", 0, 100);
  const contactText = trimText(payload.contact_text, "contact_text", 0, 300);
  const active = boolValue(payload.is_active, "is_active");
  const expected = trimText(payload.expected_updated_at, "expected_updated_at", 1, 100);
  if (expected !== existing.updated_at) v2Fail(409, "RESOURCE_CONFLICT", { expected_updated_at: expected, current_updated_at: existing.updated_at });
  const normalized = normalizedName(name);
  if (db.prepare("SELECT 1 FROM v2_source_contacts WHERE source_group_id=? AND normalized_name=? AND id!=?").get(existing.source_group_id, normalized, id)) v2Fail(409, "CONTACT_EXISTS", { source_group_id: existing.source_group_id, normalized_name: normalized });
  db.prepare("UPDATE v2_source_contacts SET name=?,normalized_name=?,title=?,contact_text=?,is_active=?,updated_at=? WHERE id=?")
    .run(name, normalized, title, contactText, active ? 1 : 0, nowIso(), id);
  return sourceContactObject(db.prepare("SELECT * FROM v2_source_contacts WHERE id = ?").get(id));
}

function listV2Cryostats(url) {
  const query = queryFields(url, ["include_inactive", "search", "limit", "offset", "sort"]);
  const options = listOptions(query, ["name_asc", "updated_desc"], "name_asc");
  const includeInactive = query.include_inactive === undefined ? false : query.include_inactive === "1";
  if (query.include_inactive !== undefined && !["0", "1"].includes(query.include_inactive)) v2Fail(400, "INVALID_QUERY", { field: "include_inactive", reason: "enum" });
  let rows = db.prepare("SELECT * FROM v2_cryostats").all();
  if (!includeInactive) rows = rows.filter((row) => row.status === "active");
  if (options.search) rows = rows.filter((row) => `${row.name} ${row.note}`.toLocaleLowerCase().includes(options.search.toLocaleLowerCase()));
  rows.sort(options.sort === "updated_desc" ? (a, b) => b.updated_at.localeCompare(a.updated_at) || b.id - a.id : (a, b) => a.normalized_name.localeCompare(b.normalized_name) || a.id - b.id);
  return { data: rows.slice(options.offset, options.offset + options.limit).map(cryostatObject), meta: { limit: options.limit, offset: options.offset, total: rows.length, sort: options.sort } };
}

function createV2Cryostat(payload) {
  assertKnownFields(payload, ["name", "note"]);
  const name = trimText(payload.name, "name", 1, 100);
  const note = trimText(payload.note, "note", 0, 1000, { optional: true, fallback: "" });
  const normalized = normalizedName(name);
  if (db.prepare("SELECT 1 FROM v2_cryostats WHERE normalized_name=?").get(normalized)) v2Fail(409, "CRYOSTAT_EXISTS", { normalized_name: normalized });
  const timestamp = nowIso();
  const id = db.prepare("INSERT INTO v2_cryostats (name,normalized_name,note,created_at,updated_at) VALUES (?,?,?,?,?)")
    .run(name, normalized, note, timestamp, timestamp).lastInsertRowid;
  return cryostatObject(db.prepare("SELECT * FROM v2_cryostats WHERE id=?").get(id));
}

function updateV2Cryostat(id, payload) {
  assertKnownFields(payload, ["name", "note", "status", "expected_updated_at"]);
  const existing = getV2Resource("v2_cryostats", "cryostat", id);
  const name = trimText(payload.name, "name", 1, 100);
  const note = trimText(payload.note, "note", 0, 1000);
  if (!["active", "inactive"].includes(payload.status)) validation("status", "enum");
  const expected = trimText(payload.expected_updated_at, "expected_updated_at", 1, 100);
  if (expected !== existing.updated_at) v2Fail(409, "RESOURCE_CONFLICT", { expected_updated_at: expected, current_updated_at: existing.updated_at });
  const normalized = normalizedName(name);
  if (db.prepare("SELECT 1 FROM v2_cryostats WHERE normalized_name=? AND id!=?").get(normalized, id)) v2Fail(409, "CRYOSTAT_EXISTS", { normalized_name: normalized });
  db.prepare("UPDATE v2_cryostats SET name=?,normalized_name=?,note=?,status=?,updated_at=? WHERE id=?")
    .run(name, normalized, note, payload.status, nowIso(), id);
  return cryostatObject(db.prepare("SELECT * FROM v2_cryostats WHERE id=?").get(id));
}

function normalizeTestItems(items) {
  if (!Array.isArray(items) || !items.length) v2Fail(409, "TEST_ITEM_REQUIRED", { required_count: 0 });
  const positions = new Set();
  const normalized = items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) validation("test_items", "type");
    assertKnownFields(item, ["title", "description", "acceptance_criteria", "is_required", "position"]);
    const position = item.position === undefined ? index : intValue(item.position, "position", 0);
    if (positions.has(position)) v2Fail(409, "POSITION_CONFLICT", { resource: "test_item", position, conflicting_id: 0 });
    positions.add(position);
    return {
      title: trimText(item.title, "title", 1, 200),
      description: trimText(item.description, "description", 0, 4000, { optional: true, fallback: "" }),
      acceptance_criteria: trimText(item.acceptance_criteria, "acceptance_criteria", 0, 4000, { optional: true, fallback: "" }),
      is_required: boolValue(item.is_required, "is_required"),
      position
    };
  });
  const requiredCount = normalized.filter((item) => item.is_required).length;
  if (!requiredCount) v2Fail(409, "TEST_ITEM_REQUIRED", { required_count: 0 });
  return normalized.sort((a, b) => a.position - b.position);
}

function normalizeAcceptanceTemplate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) v2Fail(409, "TEMPLATE_ITEM_REQUIRED", { item_count: 0 });
  assertKnownFields(value, ["name", "items"]);
  if (!Array.isArray(value.items) || !value.items.length) v2Fail(409, "TEMPLATE_ITEM_REQUIRED", { item_count: 0 });
  const positions = new Set();
  const items = value.items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) validation("acceptance_template.items", "type");
    assertKnownFields(item, ["label", "position"]);
    const position = item.position === undefined ? index : intValue(item.position, "position", 0);
    if (positions.has(position)) v2Fail(409, "POSITION_CONFLICT", { resource: "template_item", position, conflicting_id: 0 });
    positions.add(position);
    return { label: trimText(item.label, "label", 1, 300), position };
  }).sort((a, b) => a.position - b.position);
  return { name: trimText(value.name, "acceptance_template.name", 1, 200), items };
}

function validatePlanResources(input) {
  const group = getV2Resource("v2_source_groups", "source_group", input.source_group_id);
  requireActiveResource(group, "source_group");
  if (input.counterpart_contact_id !== null) {
    const contact = getV2Resource("v2_source_contacts", "contact", input.counterpart_contact_id);
    if (contact.source_group_id !== input.source_group_id) {
      v2Fail(409, "CONTACT_GROUP_MISMATCH", { contact_id: contact.id, expected_source_group_id: input.source_group_id, actual_source_group_id: contact.source_group_id });
    }
    requireActiveResource(contact, "contact");
  }
  if (input.cryostat_id !== null) {
    const cryostat = getV2Resource("v2_cryostats", "cryostat", input.cryostat_id);
    requireActiveResource(cryostat, "cryostat");
  }
}

function normalizePlanCreate(payload) {
  const allowed = ["source_group_id", "counterpart_contact_id", "local_liaison_name", "name", "purpose", "sample_model", "sample_identifier", "identifier_kind", "current_eta_date", "eta_pending", "cryostat_id", "cryostat_pending", "project_tag", "topic_tag", "test_items", "acceptance_template", "actor_label"];
  assertKnownFields(payload, allowed);
  const sourceGroupId = parseV2Id(payload.source_group_id, "source_group_id");
  const contactId = payload.counterpart_contact_id === null || payload.counterpart_contact_id === undefined ? null : parseV2Id(payload.counterpart_contact_id, "counterpart_contact_id");
  const eta = normalizeEtaChoice(payload.current_eta_date ?? null, payload.eta_pending);
  const cryostat = normalizeCryostatChoice(payload.cryostat_id ?? null, payload.cryostat_pending);
  const identifier = optionalNullableText(payload.sample_identifier, "sample_identifier", 200);
  const kind = payload.identifier_kind ?? null;
  assertIdentifierPair(identifier, kind);
  const normalized = {
    source_group_id: sourceGroupId,
    counterpart_contact_id: contactId,
    local_liaison_name: payload.local_liaison_name === null || payload.local_liaison_name === undefined ? "" : trimText(payload.local_liaison_name, "local_liaison_name", 0, 100),
    name: trimText(payload.name, "name", 1, 200),
    purpose: trimText(payload.purpose, "purpose", 1, 4000),
    sample_model: trimText(payload.sample_model, "sample_model", 1, 200),
    sample_identifier: identifier,
    identifier_kind: kind,
    current_eta_date: eta.current_eta_date,
    eta_pending: eta.eta_pending,
    cryostat_id: cryostat.cryostat_id,
    cryostat_pending: cryostat.cryostat_pending,
    project_tag: optionalNullableText(payload.project_tag, "project_tag", 100),
    topic_tag: optionalNullableText(payload.topic_tag, "topic_tag", 100),
    test_items: normalizeTestItems(payload.test_items),
    acceptance_template: normalizeAcceptanceTemplate(payload.acceptance_template),
    actor_label: actorLabel(payload.actor_label)
  };
  validatePlanResources(normalized);
  return normalized;
}

function normalizePlanUpdate(payload) {
  const allowed = ["source_group_id", "counterpart_contact_id", "local_liaison_name", "name", "purpose", "sample_model", "sample_identifier", "identifier_kind", "project_tag", "topic_tag", "actor_label", "expected_version"];
  assertKnownFields(payload, allowed);
  const identifier = optionalNullableText(payload.sample_identifier, "sample_identifier", 200);
  const kind = payload.identifier_kind ?? null;
  assertIdentifierPair(identifier, kind);
  const normalized = {
    source_group_id: parseV2Id(payload.source_group_id, "source_group_id"),
    counterpart_contact_id: payload.counterpart_contact_id === null ? null : parseV2Id(payload.counterpart_contact_id, "counterpart_contact_id"),
    local_liaison_name: payload.local_liaison_name === null ? "" : trimText(payload.local_liaison_name, "local_liaison_name", 0, 100),
    name: trimText(payload.name, "name", 1, 200),
    purpose: trimText(payload.purpose, "purpose", 1, 4000),
    sample_model: trimText(payload.sample_model, "sample_model", 1, 200),
    sample_identifier: identifier,
    identifier_kind: kind,
    project_tag: optionalNullableText(payload.project_tag, "project_tag", 100),
    topic_tag: optionalNullableText(payload.topic_tag, "topic_tag", 100),
    actor_label: actorLabel(payload.actor_label),
    expected_version: intValue(payload.expected_version, "expected_version", 1)
  };
  validatePlanResources({ ...normalized, cryostat_id: null });
  return normalized;
}

function assertPlanVersion(row, expectedVersion) {
  if (row.version !== expectedVersion) v2Fail(409, "VERSION_CONFLICT", { expected_version: expectedVersion, current_version: row.version });
}

function createV2Plan(payload) {
  const input = normalizePlanCreate(payload);
  const timestamp = nowIso();
  const planId = runImmediateTransaction(db, () => {
    const result = db.prepare(`
      INSERT INTO v2_control_plans
      (source_group_id,counterpart_contact_id,local_liaison_name,name,purpose,sample_model,sample_identifier,identifier_kind,initial_eta_date,current_eta_date,eta_pending,cryostat_id,cryostat_pending,project_tag,topic_tag,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      input.source_group_id, input.counterpart_contact_id, input.local_liaison_name, input.name, input.purpose,
      input.sample_model, input.sample_identifier, input.identifier_kind, input.current_eta_date, input.current_eta_date,
      input.eta_pending ? 1 : 0, input.cryostat_id, input.cryostat_pending ? 1 : 0, input.project_tag, input.topic_tag,
      timestamp, timestamp
    );
    const id = Number(result.lastInsertRowid);
    const insertItem = db.prepare("INSERT INTO v2_test_items (plan_id,title,description,acceptance_criteria,is_required,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)");
    for (const item of input.test_items) insertItem.run(id, item.title, item.description, item.acceptance_criteria, item.is_required ? 1 : 0, item.position, timestamp, timestamp);
    const templateId = Number(db.prepare("INSERT INTO v2_acceptance_templates (plan_id,version,name,is_active,created_at) VALUES (?,1,?,1,?)")
      .run(id, input.acceptance_template.name, timestamp).lastInsertRowid);
    const insertTemplateItem = db.prepare("INSERT INTO v2_acceptance_template_items (template_id,label,position) VALUES (?,?,?)");
    for (const item of input.acceptance_template.items) insertTemplateItem.run(templateId, item.label, item.position);
    insertV2Event(id, "create_plan", input.actor_label, { newValue: { ...input, test_items: input.test_items, acceptance_template: input.acceptance_template } });
    return id;
  });
  return v2PlanDetail(planId);
}

function updateV2Plan(planId, payload) {
  const input = normalizePlanUpdate(payload);
  const existing = getV2PlanRow(planId);
  assertPlanVersion(existing, input.expected_version);
  runImmediateTransaction(db, () => {
    const result = db.prepare(`
      UPDATE v2_control_plans SET source_group_id=?,counterpart_contact_id=?,local_liaison_name=?,name=?,purpose=?,sample_model=?,sample_identifier=?,identifier_kind=?,project_tag=?,topic_tag=?,version=version+1,updated_at=?
      WHERE id=? AND version=?
    `).run(input.source_group_id, input.counterpart_contact_id, input.local_liaison_name, input.name, input.purpose, input.sample_model, input.sample_identifier, input.identifier_kind, input.project_tag, input.topic_tag, nowIso(), planId, input.expected_version);
    if (!result.changes) {
      const current = getV2PlanRow(planId);
      v2Fail(409, "VERSION_CONFLICT", { expected_version: input.expected_version, current_version: current.version });
    }
    insertV2Event(planId, "update_plan", input.actor_label, { oldValue: existing, newValue: input });
  });
  return v2PlanDetail(planId);
}

function activeTemplateForPlan(planId, { required = false } = {}) {
  const row = db.prepare("SELECT * FROM v2_acceptance_templates WHERE plan_id=? AND is_active=1").get(planId);
  if (!row) {
    if (required) v2NotFound("template", planId);
    return null;
  }
  const items = db.prepare("SELECT id,label,position FROM v2_acceptance_template_items WHERE template_id=? ORDER BY position,id").all(row.id);
  return { id: row.id, plan_id: row.plan_id, version: row.version, name: row.name, is_active: Boolean(row.is_active), created_at: row.created_at, items };
}

function submissionObject(row) {
  return {
    id: row.id,
    plan_id: row.plan_id,
    task_id: row.task_id ?? null,
    task_lineage_key: row.task_lineage_key,
    original_task_id: row.original_task_id,
    task_title_snapshot: row.task_title_snapshot,
    test_item_id: row.test_item_id ?? null,
    sequence: row.sequence,
    supersedes_submission_id: row.supersedes_submission_id ?? null,
    description: row.description,
    submitter_label: row.submitter_label,
    submitted_at: row.submitted_at,
    resource_kind: row.resource_kind,
    resource_value: row.resource_value,
    checklist_snapshot: JSON.parse(row.checklist_snapshot_json),
    status: row.status,
    version: row.version,
    updated_at: row.updated_at
  };
}

function reviewObject(row) {
  return {
    id: row.id,
    submission_id: row.submission_id,
    decision: row.decision,
    reviewer_label: row.reviewer_label,
    comment: row.comment,
    checklist_result: JSON.parse(row.checklist_result_json),
    reviewed_at: row.reviewed_at
  };
}

function planIsCompleted(planId) {
  const required = db.prepare("SELECT id FROM v2_test_items WHERE plan_id=? AND is_required=1 AND archived_at IS NULL ORDER BY id").all(planId);
  if (!required.length) return false;
  for (const item of required) {
    const links = db.prepare(`
      SELECT pt.task_lineage_key FROM v2_plan_tasks pt JOIN tasks t ON t.id=pt.task_id
      WHERE pt.plan_id=? AND pt.test_item_id=? AND t.deleted_at IS NULL
    `).all(planId, item.id);
    if (!links.length) return false;
    for (const link of links) {
      const latest = db.prepare("SELECT status FROM v2_deliverable_submissions WHERE plan_id=? AND task_lineage_key=? ORDER BY sequence DESC,id DESC LIMIT 1").get(planId, link.task_lineage_key);
      if (!latest || latest.status !== "accepted") return false;
    }
  }
  return true;
}

function classifyPlan(row, windowDays = 7, today = todayIsoDate()) {
  if (planIsCompleted(row.id)) return { display_status: "completed", display_color: "#16a34a", window_bucket: "completed" };
  const testing = db.prepare(`SELECT 1 FROM v2_plan_tasks pt JOIN tasks t ON t.id=pt.task_id WHERE pt.plan_id=? AND t.deleted_at IS NULL AND t.status='active' LIMIT 1`).get(row.id);
  if (testing) return { display_status: "testing", display_color: "#2563eb", window_bucket: "testing" };
  if (row.actual_arrival_date !== null) return { display_status: null, display_color: null, window_bucket: null };
  if (row.eta_pending) return { display_status: "time_pending", display_color: "#7c3aed", window_bucket: "pending" };
  if (row.current_eta_date < today) return { display_status: "delayed", display_color: "#dc2626", window_bucket: "delayed" };
  if (row.current_eta_date <= addDays(today, windowDays)) return { display_status: "arriving_within_window", display_color: "#f59e0b", window_bucket: "within" };
  return { display_status: "arriving_outside_window", display_color: "#64748b", window_bucket: "outside" };
}

function v2PlanSummary(planId, windowDays = 7, today = todayIsoDate()) {
  const row = getV2PlanRow(planId);
  const group = getV2Resource("v2_source_groups", "source_group", row.source_group_id);
  const contact = row.counterpart_contact_id ? getV2Resource("v2_source_contacts", "contact", row.counterpart_contact_id) : null;
  const cryostat = row.cryostat_id ? getV2Resource("v2_cryostats", "cryostat", row.cryostat_id) : null;
  return {
    id: row.id,
    version: row.version,
    source_group: { id: group.id, name: group.name, is_active: Boolean(group.is_active) },
    counterpart_contact: contact ? { id: contact.id, name: contact.name, title: contact.title, contact_text: contact.contact_text, is_active: Boolean(contact.is_active) } : null,
    local_liaison_name: row.local_liaison_name,
    name: row.name,
    purpose: row.purpose,
    sample_model: row.sample_model,
    sample_identifier: row.sample_identifier ?? null,
    identifier_kind: row.identifier_kind ?? null,
    initial_eta_date: row.initial_eta_date ?? null,
    current_eta_date: row.current_eta_date ?? null,
    eta_pending: Boolean(row.eta_pending),
    cryostat: cryostat ? { id: cryostat.id, name: cryostat.name, status: cryostat.status } : null,
    cryostat_pending: Boolean(row.cryostat_pending),
    actual_arrival_date: row.actual_arrival_date ?? null,
    project_tag: row.project_tag ?? null,
    topic_tag: row.topic_tag ?? null,
    ...classifyPlan(row, windowDays, today),
    eta_drift_days: daysBetween(row.initial_eta_date, row.current_eta_date),
    archived: Boolean(row.archived_at),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function v2PlanTaskMeta(row) {
  const primary = db.prepare("SELECT id,name,role,email,status FROM members WHERE id=?").get(row.primary_member_id);
  const collaborators = db.prepare(`
    SELECT m.id,m.name,m.role,m.email,m.status,ta.progress,ta.note,ta.start_date,ta.end_date
    FROM task_assignments ta JOIN members m ON m.id=ta.member_id
    WHERE ta.task_id=? AND ta.deleted_at IS NULL AND m.deleted_at IS NULL AND m.id!=?
    ORDER BY m.id
  `).all(row.task_id, row.primary_member_id);
  return {
    task_id: row.task_id,
    task_lineage_key: row.task_lineage_key,
    plan_id: row.plan_id,
    test_item_id: row.test_item_id ?? null,
    primary_member: primary ? { id: primary.id, name: primary.name, role: primary.role, email: primary.email, status: primary.status } : null,
    collaborators,
    estimated_hours: row.estimated_half_hours / 2,
    after_arrival: Boolean(row.after_arrival),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function v2PlanDetail(planId, windowDays = 7, today = todayIsoDate()) {
  const summary = v2PlanSummary(planId, windowDays, today);
  const testItems = db.prepare("SELECT * FROM v2_test_items WHERE plan_id=? ORDER BY position,id").all(planId).map(testItemObject);
  const links = db.prepare(`
    SELECT pt.*,t.title,t.description,t.default_start_date,t.default_end_date,t.color,t.status,t.created_at AS task_created_at,t.updated_at AS task_updated_at,t.deleted_at
    FROM v2_plan_tasks pt JOIN tasks t ON t.id=pt.task_id WHERE pt.plan_id=?
    ORDER BY t.default_start_date,t.id
  `).all(planId);
  const planTasks = links.map((row) => ({
    id: row.task_id,
    title: row.title,
    description: row.description,
    default_start_date: row.default_start_date,
    default_end_date: row.default_end_date,
    color: row.color,
    status: row.status,
    deleted_at: row.deleted_at ?? null,
    assignments: assignmentRowsForTask(row.task_id),
    ...v2PlanTaskMeta(row)
  }));
  const latestSubmissions = db.prepare(`
    SELECT s.* FROM v2_deliverable_submissions s
    JOIN (SELECT task_lineage_key,MAX(sequence) sequence FROM v2_deliverable_submissions WHERE plan_id=? GROUP BY task_lineage_key) latest
      ON latest.task_lineage_key=s.task_lineage_key AND latest.sequence=s.sequence
    WHERE s.plan_id=? ORDER BY s.task_lineage_key
  `).all(planId, planId).map(submissionObject);
  const events = db.prepare("SELECT * FROM v2_plan_events WHERE plan_id=? ORDER BY id DESC LIMIT 50").all(planId).map(eventObject);
  return { ...summary, test_items: testItems, plan_tasks: planTasks, acceptance_template: activeTemplateForPlan(planId), latest_submissions: latestSubmissions, events };
}

function listV2Plans(url) {
  const allowed = ["search", "source_group_id", "cryostat_id", "primary_member_id", "display_status", "project_tag", "topic_tag", "group_by", "window_days", "include_archived", "limit", "offset", "sort"];
  const query = queryFields(url, allowed);
  const options = listOptions(query, ["eta_asc", "updated_desc", "name_asc"], "eta_asc");
  const groupBy = query.group_by || "none";
  const windowDays = query.window_days === undefined ? 7 : Number(query.window_days);
  const includeArchived = query.include_archived === "1";
  if (!Number.isInteger(windowDays) || windowDays < 0 || windowDays > 365) v2Fail(400, "INVALID_QUERY", { field: "window_days", reason: "range" });
  if (query.include_archived !== undefined && !["0", "1"].includes(query.include_archived)) v2Fail(400, "INVALID_QUERY", { field: "include_archived", reason: "enum" });
  if (!["none", "source_group", "cryostat", "primary_member", "project_tag", "topic_tag"].includes(groupBy)) v2Fail(400, "INVALID_QUERY", { field: "group_by", reason: "enum" });
  const validStatuses = ["testing", "delayed", "arriving_within_window", "arriving_outside_window", "time_pending", "completed", "unclassified"];
  if (query.display_status && !validStatuses.includes(query.display_status)) v2Fail(400, "INVALID_QUERY", { field: "display_status", reason: "enum" });
  for (const field of ["source_group_id", "cryostat_id", "primary_member_id"]) if (query[field] !== undefined) query[field] = parseV2Id(query[field], field);
  for (const field of ["project_tag", "topic_tag"]) if (query[field] !== undefined && query[field].length > 100) v2Fail(400, "INVALID_QUERY", { field, reason: "length" });
  const today = todayIsoDate();
  let rows = db.prepare("SELECT id FROM v2_control_plans ORDER BY id").all().map((item) => v2PlanSummary(item.id, windowDays, today));
  const matchesCommon = (plan) => {
    if (options.search && !`${plan.name} ${plan.purpose} ${plan.sample_model} ${plan.sample_identifier || ""} ${plan.source_group.name}`.toLocaleLowerCase().includes(options.search.toLocaleLowerCase())) return false;
    if (query.source_group_id && plan.source_group.id !== query.source_group_id) return false;
    if (query.cryostat_id && plan.cryostat?.id !== query.cryostat_id) return false;
    if (query.project_tag !== undefined && plan.project_tag !== query.project_tag) return false;
    if (query.topic_tag !== undefined && plan.topic_tag !== query.topic_tag) return false;
    if (query.primary_member_id && !db.prepare("SELECT 1 FROM v2_plan_tasks WHERE plan_id=? AND primary_member_id=?").get(plan.id, query.primary_member_id)) return false;
    return true;
  };
  const statsRows = rows.filter((plan) => !plan.archived && matchesCommon(plan));
  const stats = { testing: 0, delayed: 0, within: 0, outside: 0, pending: 0, completed: 0, unclassified: 0 };
  for (const plan of statsRows) {
    const key = plan.window_bucket || "unclassified";
    if (Object.hasOwn(stats, key)) stats[key] += 1;
  }
  rows = rows.filter((plan) => (includeArchived || !plan.archived) && matchesCommon(plan));
  if (query.display_status) rows = rows.filter((plan) => (query.display_status === "unclassified" ? plan.display_status === null : plan.display_status === query.display_status));
  const groupInfo = (plan) => {
    if (groupBy === "source_group") return { key: String(plan.source_group.id), label: plan.source_group.name };
    if (groupBy === "cryostat") return plan.cryostat ? { key: String(plan.cryostat.id), label: plan.cryostat.name } : { key: "__none__", label: "未设置" };
    if (groupBy === "project_tag") return plan.project_tag ? { key: plan.project_tag, label: plan.project_tag } : { key: "__none__", label: "未设置" };
    if (groupBy === "topic_tag") return plan.topic_tag ? { key: plan.topic_tag, label: plan.topic_tag } : { key: "__none__", label: "未设置" };
    if (groupBy === "primary_member") {
      const member = db.prepare("SELECT m.id,m.name FROM v2_plan_tasks pt JOIN members m ON m.id=pt.primary_member_id WHERE pt.plan_id=? ORDER BY m.name,m.id LIMIT 1").get(plan.id);
      return member ? { key: String(member.id), label: member.name } : { key: "__none__", label: "未设置" };
    }
    return null;
  };
  const sortPlans = (a, b) => {
    if (options.sort === "updated_desc") return b.updated_at.localeCompare(a.updated_at) || b.id - a.id;
    if (options.sort === "name_asc") return a.name.localeCompare(b.name) || a.id - b.id;
    const left = a.current_eta_date || "9999-99-99";
    const right = b.current_eta_date || "9999-99-99";
    return left.localeCompare(right) || a.id - b.id;
  };
  rows.sort((a, b) => {
    if (groupBy !== "none") {
      const ga = groupInfo(a); const gb = groupInfo(b);
      if (ga.key === "__none__" && gb.key !== "__none__") return 1;
      if (gb.key === "__none__" && ga.key !== "__none__") return -1;
      const groupCompare = ga.label.localeCompare(gb.label);
      if (groupCompare) return groupCompare;
    }
    return sortPlans(a, b);
  });
  const groupsMap = new Map();
  if (groupBy !== "none") for (const plan of rows) {
    const group = groupInfo(plan);
    if (!groupsMap.has(group.key)) groupsMap.set(group.key, { ...group, count: 0 });
    groupsMap.get(group.key).count += 1;
  }
  const groups = [...groupsMap.values()];
  return { data: rows.slice(options.offset, options.offset + options.limit), meta: { today, window_days: windowDays, limit: options.limit, offset: options.offset, total: rows.length, sort: options.sort, group_by: groupBy, groups, stats } };
}

function changePlanArchive(planId, payload, restore = false) {
  assertKnownFields(payload, ["actor_label", "expected_version"]);
  const plan = getV2PlanRow(planId);
  const expected = intValue(payload.expected_version, "expected_version", 1);
  assertPlanVersion(plan, expected);
  if (restore && !plan.archived_at) v2Fail(409, "PLAN_NOT_ARCHIVED", { plan_id: planId });
  if (!restore && plan.archived_at) v2Fail(409, "PLAN_ALREADY_ARCHIVED", { plan_id: planId });
  let event;
  runImmediateTransaction(db, () => {
    db.prepare(`UPDATE v2_control_plans SET archived_at=?,version=version+1,updated_at=? WHERE id=? AND version=?`)
      .run(restore ? null : nowIso(), nowIso(), planId, expected);
    event = insertV2Event(planId, restore ? "restore" : "archive", payload.actor_label, { oldValue: { archived_at: plan.archived_at }, newValue: { archived_at: restore ? null : "set" } });
  });
  return { plan: v2PlanDetail(planId), event };
}

function confirmV2Arrival(planId, payload) {
  assertKnownFields(payload, ["actual_arrival_date", "sample_identifier", "identifier_kind", "actor_label", "expected_version"]);
  const plan = getV2PlanRow(planId);
  const expected = intValue(payload.expected_version, "expected_version", 1);
  assertPlanVersion(plan, expected);
  const arrival = localDate(payload.actual_arrival_date, "actual_arrival_date");
  const identifier = optionalNullableText(payload.sample_identifier, "sample_identifier", 200);
  const kind = payload.identifier_kind ?? null;
  assertIdentifierPair(identifier, kind);
  let event;
  runImmediateTransaction(db, () => {
    db.prepare("UPDATE v2_control_plans SET actual_arrival_date=?,sample_identifier=?,identifier_kind=?,version=version+1,updated_at=? WHERE id=? AND version=?")
      .run(arrival, identifier, kind, nowIso(), planId, expected);
    event = insertV2Event(planId, "arrival_confirm", payload.actor_label, { oldValue: { actual_arrival_date: plan.actual_arrival_date, sample_identifier: plan.sample_identifier, identifier_kind: plan.identifier_kind }, newValue: { actual_arrival_date: arrival, sample_identifier: identifier, identifier_kind: kind } });
  });
  return { plan: v2PlanDetail(planId), event };
}

function createV2TestItem(planId, payload) {
  assertKnownFields(payload, ["title", "description", "acceptance_criteria", "is_required", "position", "actor_label", "expected_version"]);
  const plan = getV2PlanRow(planId);
  const expected = intValue(payload.expected_version, "expected_version", 1);
  assertPlanVersion(plan, expected);
  const item = {
    title: trimText(payload.title, "title", 1, 200),
    description: trimText(payload.description, "description", 0, 4000, { optional: true, fallback: "" }),
    acceptance_criteria: trimText(payload.acceptance_criteria, "acceptance_criteria", 0, 4000, { optional: true, fallback: "" }),
    is_required: boolValue(payload.is_required, "is_required"),
    position: payload.position === undefined ? db.prepare("SELECT COALESCE(MAX(position),-1)+1 value FROM v2_test_items WHERE plan_id=?").get(planId).value : intValue(payload.position, "position", 0)
  };
  const collision = db.prepare("SELECT id FROM v2_test_items WHERE plan_id=? AND position=?").get(planId, item.position);
  if (collision) v2Fail(409, "POSITION_CONFLICT", { resource: "test_item", position: item.position, conflicting_id: collision.id });
  let id; let event;
  runImmediateTransaction(db, () => {
    const timestamp = nowIso();
    id = Number(db.prepare("INSERT INTO v2_test_items (plan_id,title,description,acceptance_criteria,is_required,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(planId, item.title, item.description, item.acceptance_criteria, item.is_required ? 1 : 0, item.position, timestamp, timestamp).lastInsertRowid);
    db.prepare("UPDATE v2_control_plans SET version=version+1,updated_at=? WHERE id=? AND version=?").run(timestamp, planId, expected);
    event = insertV2Event(planId, "create_test_item", payload.actor_label, { newValue: { id, ...item } });
  });
  return { test_item: testItemObject(db.prepare("SELECT * FROM v2_test_items WHERE id=?").get(id)), plan_version: expected + 1, event };
}

function updateV2TestItem(itemId, payload) {
  assertKnownFields(payload, ["title", "description", "acceptance_criteria", "is_required", "position", "archived", "actor_label", "expected_version"]);
  const existing = getV2Resource("v2_test_items", "test_item", itemId);
  const plan = getV2PlanRow(existing.plan_id);
  const expected = intValue(payload.expected_version, "expected_version", 1);
  assertPlanVersion(plan, expected);
  const next = {
    title: trimText(payload.title, "title", 1, 200),
    description: trimText(payload.description, "description", 0, 4000),
    acceptance_criteria: trimText(payload.acceptance_criteria, "acceptance_criteria", 0, 4000),
    is_required: boolValue(payload.is_required, "is_required"),
    position: intValue(payload.position, "position", 0),
    archived: boolValue(payload.archived, "archived")
  };
  const collision = db.prepare("SELECT id FROM v2_test_items WHERE plan_id=? AND position=? AND id!=?").get(existing.plan_id, next.position, itemId);
  if (collision) v2Fail(409, "POSITION_CONFLICT", { resource: "test_item", position: next.position, conflicting_id: collision.id });
  const requiredCount = db.prepare("SELECT COUNT(*) count FROM v2_test_items WHERE plan_id=? AND is_required=1 AND archived_at IS NULL AND id!=?").get(existing.plan_id, itemId).count + (next.is_required && !next.archived ? 1 : 0);
  if (!requiredCount) v2Fail(409, "REQUIRED_ITEM_MINIMUM", { required_count: 0 });
  let event;
  runImmediateTransaction(db, () => {
    const timestamp = nowIso();
    db.prepare("UPDATE v2_test_items SET title=?,description=?,acceptance_criteria=?,is_required=?,position=?,archived_at=?,updated_at=? WHERE id=?")
      .run(next.title, next.description, next.acceptance_criteria, next.is_required ? 1 : 0, next.position, next.archived ? timestamp : null, timestamp, itemId);
    db.prepare("UPDATE v2_control_plans SET version=version+1,updated_at=? WHERE id=? AND version=?").run(timestamp, existing.plan_id, expected);
    event = insertV2Event(existing.plan_id, "update_test_item", payload.actor_label, { oldValue: existing, newValue: next });
  });
  return { test_item: testItemObject(db.prepare("SELECT * FROM v2_test_items WHERE id=?").get(itemId)), plan_version: expected + 1, event };
}

function updateV2AcceptanceTemplate(planId, payload) {
  assertKnownFields(payload, ["name", "items", "actor_label", "expected_version"]);
  const plan = getV2PlanRow(planId);
  const expected = intValue(payload.expected_version, "expected_version", 1);
  assertPlanVersion(plan, expected);
  const template = normalizeAcceptanceTemplate({ name: payload.name, items: payload.items });
  let event;
  runImmediateTransaction(db, () => {
    const timestamp = nowIso();
    const current = db.prepare("SELECT * FROM v2_acceptance_templates WHERE plan_id=? AND is_active=1").get(planId);
    const version = current ? current.version + 1 : 1;
    if (current) db.prepare("UPDATE v2_acceptance_templates SET is_active=0 WHERE id=?").run(current.id);
    const templateId = Number(db.prepare("INSERT INTO v2_acceptance_templates (plan_id,version,name,is_active,created_at) VALUES (?,?,?,?,?)")
      .run(planId, version, template.name, 1, timestamp).lastInsertRowid);
    const insert = db.prepare("INSERT INTO v2_acceptance_template_items (template_id,label,position) VALUES (?,?,?)");
    for (const item of template.items) insert.run(templateId, item.label, item.position);
    db.prepare("UPDATE v2_control_plans SET version=version+1,updated_at=? WHERE id=? AND version=?").run(timestamp, planId, expected);
    event = insertV2Event(planId, "acceptance_template", payload.actor_label, { oldValue: current, newValue: { template_id: templateId, version, ...template } });
  });
  return { template: activeTemplateForPlan(planId, { required: true }), plan_version: expected + 1, event };
}

function listV2Events(planId, url) {
  getV2PlanRow(planId);
  const query = queryFields(url, ["limit", "offset", "sort"]);
  const options = listOptions(query, ["id_desc", "id_asc"], "id_desc");
  const rows = db.prepare(`SELECT * FROM v2_plan_events WHERE plan_id=? ORDER BY id ${options.sort === "id_desc" ? "DESC" : "ASC"}`).all(planId);
  return { data: rows.slice(options.offset, options.offset + options.limit).map(eventObject), meta: { limit: options.limit, offset: options.offset, total: rows.length, sort: options.sort } };
}

function v2BackupData() {
  const parseRows = (name, transform = (row) => row) => db.prepare(`SELECT * FROM ${name} ORDER BY id`).all().map(transform);
  return {
    schema_version: 2,
    exported_at: nowIso(),
    source_groups: parseRows("v2_source_groups", sourceGroupObject),
    source_contacts: parseRows("v2_source_contacts", sourceContactObject),
    cryostats: parseRows("v2_cryostats", cryostatObject),
    control_plans: parseRows("v2_control_plans"),
    test_items: parseRows("v2_test_items", testItemObject),
    acceptance_templates: parseRows("v2_acceptance_templates"),
    acceptance_template_items: parseRows("v2_acceptance_template_items"),
    plan_tasks: db.prepare("SELECT * FROM v2_plan_tasks ORDER BY task_id").all(),
    plan_events: parseRows("v2_plan_events", eventObject),
    deliverable_submissions: parseRows("v2_deliverable_submissions", submissionObject),
    acceptance_reviews: parseRows("v2_acceptance_reviews", reviewObject)
  };
}

function dateRangeIntersection(left, right) {
  const start = left.start_date > right.start_date ? left.start_date : right.start_date;
  const end = left.end_date < right.end_date ? left.end_date : right.end_date;
  return start <= end ? { start_date: start, end_date: end } : null;
}

function isoWeekStart(dateValue) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1);
  return date.toISOString().slice(0, 10);
}

function weeksForRange(startDate, endDate) {
  const weeks = [];
  let current = isoWeekStart(startDate);
  while (current <= endDate) {
    weeks.push(current);
    current = addDays(current, 7);
  }
  return weeks;
}

function scheduleTasks() {
  const rows = db.prepare(`
    SELECT pt.*,t.title,t.default_start_date,t.default_end_date,t.status,p.cryostat_id
    FROM v2_plan_tasks pt
    JOIN tasks t ON t.id=pt.task_id
    JOIN v2_control_plans p ON p.id=pt.plan_id
    WHERE t.deleted_at IS NULL AND p.archived_at IS NULL AND t.status NOT IN ('completed','cancelled','archived')
    ORDER BY t.id
  `).all();
  return rows.map((row) => {
    const assignments = db.prepare("SELECT id,member_id,start_date,end_date,progress,note FROM task_assignments WHERE task_id=? AND deleted_at IS NULL ORDER BY id").all(row.task_id);
    return {
      task_id: row.task_id,
      task_lineage_key: row.task_lineage_key,
      plan_id: row.plan_id,
      title: row.title,
      start_date: row.default_start_date,
      end_date: row.default_end_date,
      estimated_hours: row.estimated_half_hours / 2,
      cryostat_id: row.cryostat_id ?? null,
      assignments,
      member_ranges: assignments.map((assignment) => ({ member_id: assignment.member_id, start_date: assignment.start_date, end_date: assignment.end_date }))
    };
  });
}

function sortUniqueNumbers(values) {
  return [...new Set(values.filter((value) => Number.isInteger(value)))].sort((a, b) => a - b);
}

function conflictRecord(code, tasks, members, plans, dateRange, extra = {}) {
  const messages = {
    MEMBER_DATE_OVERLAP: "成员日期存在重叠",
    MEMBER_LOAD_HIGH: "成员单周预计工时超过 40 小时",
    CRYOSTAT_DATE_OVERLAP: "制冷机排期存在重叠"
  };
  return {
    code,
    severity: "warning",
    message: messages[code],
    task_ids: sortUniqueNumbers(tasks),
    member_ids: sortUniqueNumbers(members),
    plan_ids: sortUniqueNumbers(plans),
    date_range: dateRange || null,
    week_start: extra.week_start ?? null,
    hours_before: extra.hours_before ?? null,
    hours_after: extra.hours_after ?? null
  };
}

function conflictKey(conflict) {
  return [conflict.code, conflict.task_ids.join(","), conflict.member_ids.join(","), conflict.plan_ids.join(","), conflict.date_range ? `${conflict.date_range.start_date}:${conflict.date_range.end_date}` : "", conflict.week_start || ""].join("|");
}

function sortConflicts(conflicts) {
  const unique = new Map(conflicts.map((conflict) => [conflictKey(conflict), conflict]));
  return [...unique.values()].sort((a, b) => {
    const av = [a.code, a.date_range?.start_date || "9999", a.week_start || "9999", a.member_ids.join(","), a.plan_ids.join(","), a.task_ids.join(",")].join("|");
    const bv = [b.code, b.date_range?.start_date || "9999", b.week_start || "9999", b.member_ids.join(","), b.plan_ids.join(","), b.task_ids.join(",")].join("|");
    return av.localeCompare(bv);
  });
}

function memberRangeFor(task, memberId) {
  return task.member_ranges.find((range) => range.member_id === memberId) || null;
}

function scheduleHours(tasks, memberId, weekStart) {
  const weekRange = { start_date: weekStart, end_date: addDays(weekStart, 6) };
  return tasks.reduce((total, task) => {
    const range = memberRangeFor(task, memberId);
    return total + (range && dateRangeIntersection(range, weekRange) ? task.estimated_hours : 0);
  }, 0);
}

function scheduleConflicts(candidates, excludedTaskIds = [], { excludedCryostatPlanIds = [] } = {}) {
  const excluded = new Set(excludedTaskIds);
  const excludedCryostatPlans = new Set(excludedCryostatPlanIds);
  const before = scheduleTasks();
  const after = [...before.filter((task) => !excluded.has(task.task_id)), ...candidates];
  const conflicts = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    for (const other of after) {
      if (other === candidate) continue;
      if (candidates.includes(other) && candidates.indexOf(other) <= index) continue;
      const sharedMembers = candidate.member_ranges.map((range) => range.member_id).filter((id) => other.member_ranges.some((range) => range.member_id === id));
      const overlappingMembers = sharedMembers.filter((memberId) => dateRangeIntersection(memberRangeFor(candidate, memberId), memberRangeFor(other, memberId)));
      if (overlappingMembers.length) {
        const intersections = overlappingMembers.map((memberId) => dateRangeIntersection(memberRangeFor(candidate, memberId), memberRangeFor(other, memberId)));
        const start = intersections.map((item) => item.start_date).sort()[0];
        const end = intersections.map((item) => item.end_date).sort().at(-1);
        conflicts.push(conflictRecord("MEMBER_DATE_OVERLAP", [candidate.task_id, other.task_id], overlappingMembers, [candidate.plan_id, other.plan_id], { start_date: start, end_date: end }));
      }
      if (!excludedCryostatPlans.has(other.plan_id) && candidate.cryostat_id !== null && candidate.cryostat_id === other.cryostat_id) {
        const overlap = dateRangeIntersection(candidate, other);
        if (overlap) conflicts.push(conflictRecord("CRYOSTAT_DATE_OVERLAP", [candidate.task_id, other.task_id], [], [candidate.plan_id, other.plan_id], overlap));
      }
    }
  }
  const affectedMembers = sortUniqueNumbers(candidates.flatMap((task) => task.member_ranges.map((range) => range.member_id)));
  for (const memberId of affectedMembers) {
    const weeks = [...new Set(candidates.flatMap((task) => {
      const range = memberRangeFor(task, memberId);
      return range ? weeksForRange(range.start_date, range.end_date) : [];
    }))].sort();
    for (const weekStart of weeks) {
      const hoursBefore = scheduleHours(before, memberId, weekStart);
      const hoursAfter = scheduleHours(after, memberId, weekStart);
      if (hoursAfter > 40) {
        const contributing = after.filter((task) => {
          const range = memberRangeFor(task, memberId);
          return range && dateRangeIntersection(range, { start_date: weekStart, end_date: addDays(weekStart, 6) });
        });
        conflicts.push(conflictRecord("MEMBER_LOAD_HIGH", contributing.map((task) => task.task_id), [memberId], contributing.map((task) => task.plan_id), { start_date: weekStart, end_date: addDays(weekStart, 6) }, { week_start: weekStart, hours_before: hoursBefore, hours_after: hoursAfter }));
      }
    }
  }
  return sortConflicts(conflicts);
}

function validateAcknowledgements(value, conflicts) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) validation("acknowledged_conflict_codes", "type");
  if (new Set(value).size !== value.length) validation("acknowledged_conflict_codes", "duplicate");
  const current = [...new Set(conflicts.map((conflict) => conflict.code))].sort();
  const unknown = value.filter((code) => !current.includes(code));
  if (unknown.length) validation("acknowledged_conflict_codes", "unknown_code");
  const missing = current.filter((code) => !value.includes(code));
  if (missing.length) v2Fail(409, "CONFLICTS_NOT_ACKNOWLEDGED", { codes: missing });
}

function normalizeEtaPreviewInput(payload) {
  const allowed = ["new_eta_date", "eta_pending", "selected_task_ids", "actor_label", "expected_version"];
  assertKnownFields(payload, allowed);
  const eta = normalizeEtaChoice(payload.new_eta_date ?? null, payload.eta_pending);
  const rawIds = payload.selected_task_ids === undefined ? [] : payload.selected_task_ids;
  if (!Array.isArray(rawIds)) v2Fail(400, "TASK_SELECTION_INVALID", { ids: [], reason: "type" });
  let ids;
  try { ids = sortUniqueNumbers(rawIds.map((id) => parseV2Id(id, "selected_task_ids"))); } catch { v2Fail(400, "TASK_SELECTION_INVALID", { ids: rawIds, reason: "invalid_id" }); }
  return { new_eta_date: eta.current_eta_date, eta_pending: eta.eta_pending, selected_task_ids: ids, actor_label: actorLabel(payload.actor_label), expected_version: intValue(payload.expected_version, "expected_version", 1) };
}

function etaPreviewData(planId, payload) {
  const input = normalizeEtaPreviewInput(payload);
  const plan = getV2PlanRow(planId);
  assertPlanVersion(plan, input.expected_version);
  const delta = daysBetween(plan.current_eta_date, input.new_eta_date);
  const rows = db.prepare(`
    SELECT pt.*,t.title,t.default_start_date,t.default_end_date,t.status,t.deleted_at
    FROM v2_plan_tasks pt JOIN tasks t ON t.id=pt.task_id WHERE pt.plan_id=? ORDER BY t.id
  `).all(planId);
  const eligibleTasks = [];
  const protectedTasks = [];
  for (const row of rows) {
    const eligible = row.after_arrival === 1 && row.deleted_at === null && row.status === "planned" && delta !== null;
    if (eligible) {
      const assignments = db.prepare("SELECT id,member_id,start_date,end_date FROM task_assignments WHERE task_id=? AND deleted_at IS NULL ORDER BY id").all(row.task_id);
      eligibleTasks.push({
        task_id: row.task_id,
        task_lineage_key: row.task_lineage_key,
        title: row.title,
        old_start_date: row.default_start_date,
        old_end_date: row.default_end_date,
        new_start_date: addDays(row.default_start_date, delta),
        new_end_date: addDays(row.default_end_date, delta),
        selected: input.selected_task_ids.includes(row.task_id),
        assignment_moves: assignments.map((assignment) => ({ assignment_id: assignment.id, member_id: assignment.member_id, old_start_date: assignment.start_date, old_end_date: assignment.end_date, new_start_date: addDays(assignment.start_date, delta), new_end_date: addDays(assignment.end_date, delta) }))
      });
    } else {
      const reason = !row.after_arrival ? "not_after_arrival" : row.deleted_at ? "task_deleted" : row.status !== "planned" ? `status_${row.status}` : "eta_not_concrete";
      protectedTasks.push({ task_id: row.task_id, task_lineage_key: row.task_lineage_key, title: row.title, reason });
    }
  }
  const eligibleIds = new Set(eligibleTasks.map((task) => task.task_id));
  const selectedProtected = protectedTasks.filter((task) => input.selected_task_ids.includes(task.task_id));
  if (selectedProtected.length) v2Fail(409, "PROTECTED_TASK_SELECTED", { task_ids: selectedProtected.map((task) => task.task_id), reasons: selectedProtected.map((task) => ({ task_id: task.task_id, reason: task.reason })) });
  const invalid = input.selected_task_ids.filter((id) => !eligibleIds.has(id));
  if (invalid.length) v2Fail(400, "TASK_SELECTION_INVALID", { ids: invalid, reason: "not_eligible" });
  const baseTasks = scheduleTasks();
  const selectedCandidates = eligibleTasks.filter((task) => task.selected).map((task) => {
    const base = baseTasks.find((item) => item.task_id === task.task_id);
    return {
      ...base,
      start_date: task.new_start_date,
      end_date: task.new_end_date,
      assignments: task.assignment_moves.map((move) => ({ id: move.assignment_id, member_id: move.member_id, start_date: move.new_start_date, end_date: move.new_end_date })),
      member_ranges: task.assignment_moves.map((move) => ({ member_id: move.member_id, start_date: move.new_start_date, end_date: move.new_end_date }))
    };
  });
  const conflicts = selectedCandidates.length ? scheduleConflicts(selectedCandidates, input.selected_task_ids) : [];
  const tokenFacts = { operation: "eta", plan_id: planId, normalized_input: input, plan, eligible_tasks: eligibleTasks, protected_tasks: protectedTasks, schedule: baseTasks, conflicts };
  return { preview_token: previewHash(tokenFacts), normalized_input: input, old_eta: { current_eta_date: plan.current_eta_date ?? null, eta_pending: Boolean(plan.eta_pending) }, delta_days: delta, eligible_tasks: eligibleTasks, protected_tasks: protectedTasks, conflicts };
}

function confirmV2Eta(planId, payload) {
  const allowed = ["new_eta_date", "eta_pending", "preview_token", "expected_version", "selected_task_ids", "acknowledged_conflict_codes", "actor_label"];
  assertKnownFields(payload, allowed);
  const token = trimText(payload.preview_token, "preview_token", 64, 64);
  let result;
  runImmediateTransaction(db, () => {
    const preview = etaPreviewData(planId, {
      new_eta_date: payload.new_eta_date,
      eta_pending: payload.eta_pending,
      selected_task_ids: payload.selected_task_ids,
      actor_label: payload.actor_label,
      expected_version: payload.expected_version
    });
    if (preview.preview_token !== token) v2Fail(409, "STALE_PREVIEW", { operation: "eta", plan_id: planId });
    validateAcknowledgements(payload.acknowledged_conflict_codes, preview.conflicts);
    const plan = getV2PlanRow(planId);
    const movedTasks = [];
    for (const task of preview.eligible_tasks.filter((item) => item.selected)) {
      db.prepare("UPDATE tasks SET default_start_date=?,default_end_date=?,updated_at=? WHERE id=?")
        .run(task.new_start_date, task.new_end_date, nowIso(), task.task_id);
      for (const move of task.assignment_moves) db.prepare("UPDATE task_assignments SET start_date=?,end_date=?,updated_at=? WHERE id=?")
        .run(move.new_start_date, move.new_end_date, nowIso(), move.assignment_id);
      movedTasks.push({ task_id: task.task_id, task_lineage_key: task.task_lineage_key, old_start_date: task.old_start_date, old_end_date: task.old_end_date, new_start_date: task.new_start_date, new_end_date: task.new_end_date, assignment_moves: task.assignment_moves });
    }
    const initial = plan.initial_eta_date || (preview.normalized_input.eta_pending ? null : preview.normalized_input.new_eta_date);
    db.prepare("UPDATE v2_control_plans SET initial_eta_date=?,current_eta_date=?,eta_pending=?,version=version+1,updated_at=? WHERE id=? AND version=?")
      .run(initial, preview.normalized_input.new_eta_date, preview.normalized_input.eta_pending ? 1 : 0, nowIso(), planId, preview.normalized_input.expected_version);
    const event = insertV2Event(planId, "eta_confirm", preview.normalized_input.actor_label, { oldValue: preview.old_eta, newValue: { current_eta_date: preview.normalized_input.new_eta_date, eta_pending: preview.normalized_input.eta_pending }, impact: { selected_task_ids: preview.normalized_input.selected_task_ids, protected_tasks: preview.protected_tasks, conflicts: preview.conflicts } });
    result = { movedTasks, event };
  });
  return { plan: v2PlanDetail(planId), moved_tasks: result.movedTasks, event: result.event };
}

function cryostatPlanRange(planId) {
  const row = db.prepare(`
    SELECT MIN(t.default_start_date) start_date,MAX(t.default_end_date) end_date
    FROM v2_plan_tasks pt JOIN tasks t ON t.id=pt.task_id
    WHERE pt.plan_id=? AND t.deleted_at IS NULL AND t.status NOT IN ('cancelled','archived')
  `).get(planId);
  return row.start_date ? row : null;
}

function normalizeCryostatPreviewInput(payload) {
  assertKnownFields(payload, ["new_cryostat_id", "cryostat_pending", "actor_label", "expected_version"]);
  const choice = normalizeCryostatChoice(payload.new_cryostat_id ?? null, payload.cryostat_pending);
  return { new_cryostat_id: choice.cryostat_id, cryostat_pending: choice.cryostat_pending, actor_label: actorLabel(payload.actor_label), expected_version: intValue(payload.expected_version, "expected_version", 1) };
}

function cryostatPreviewData(planId, payload) {
  const input = normalizeCryostatPreviewInput(payload);
  const plan = getV2PlanRow(planId);
  assertPlanVersion(plan, input.expected_version);
  const oldCryostat = plan.cryostat_id ? cryostatObject(getV2Resource("v2_cryostats", "cryostat", plan.cryostat_id)) : null;
  let newCryostat = null;
  if (input.new_cryostat_id !== null) {
    const row = getV2Resource("v2_cryostats", "cryostat", input.new_cryostat_id);
    requireActiveResource(row, "cryostat");
    newCryostat = cryostatObject(row);
  }
  const planDateRange = cryostatPlanRange(planId);
  const conflicts = [];
  if (newCryostat && planDateRange) {
    const others = db.prepare(`
      SELECT p.id plan_id,MIN(t.default_start_date) start_date,MAX(t.default_end_date) end_date,GROUP_CONCAT(t.id) task_ids
      FROM v2_control_plans p JOIN v2_plan_tasks pt ON pt.plan_id=p.id JOIN tasks t ON t.id=pt.task_id
      WHERE p.id!=? AND p.cryostat_id=? AND p.archived_at IS NULL AND t.deleted_at IS NULL AND t.status NOT IN ('cancelled','archived')
      GROUP BY p.id ORDER BY p.id
    `).all(planId, newCryostat.id);
    const ownTaskIds = db.prepare("SELECT task_id FROM v2_plan_tasks WHERE plan_id=? ORDER BY task_id").all(planId).map((row) => row.task_id);
    for (const other of others) {
      const overlap = dateRangeIntersection(planDateRange, other);
      if (overlap) conflicts.push(conflictRecord("CRYOSTAT_DATE_OVERLAP", [...ownTaskIds, ...String(other.task_ids).split(",").map(Number)], [], [planId, other.plan_id], overlap));
    }
  }
  const facts = { operation: "cryostat", plan_id: planId, normalized_input: input, plan, old_cryostat: oldCryostat, new_cryostat: newCryostat, plan_date_range: planDateRange, conflicts: sortConflicts(conflicts) };
  return { preview_token: previewHash(facts), normalized_input: input, old_cryostat: oldCryostat, new_cryostat: newCryostat, plan_date_range: planDateRange, conflicts: facts.conflicts };
}

function confirmV2Cryostat(planId, payload) {
  assertKnownFields(payload, ["new_cryostat_id", "cryostat_pending", "preview_token", "expected_version", "acknowledged_conflict_codes", "actor_label"]);
  const token = trimText(payload.preview_token, "preview_token", 64, 64);
  let result;
  runImmediateTransaction(db, () => {
    const preview = cryostatPreviewData(planId, {
      new_cryostat_id: payload.new_cryostat_id,
      cryostat_pending: payload.cryostat_pending,
      actor_label: payload.actor_label,
      expected_version: payload.expected_version
    });
    if (preview.preview_token !== token) v2Fail(409, "STALE_PREVIEW", { operation: "cryostat", plan_id: planId });
    validateAcknowledgements(payload.acknowledged_conflict_codes, preview.conflicts);
    db.prepare("UPDATE v2_control_plans SET cryostat_id=?,cryostat_pending=?,version=version+1,updated_at=? WHERE id=? AND version=?")
      .run(preview.normalized_input.new_cryostat_id, preview.normalized_input.cryostat_pending ? 1 : 0, nowIso(), planId, preview.normalized_input.expected_version);
    const event = insertV2Event(planId, "cryostat_confirm", preview.normalized_input.actor_label, { oldValue: preview.old_cryostat, newValue: preview.new_cryostat, impact: { conflicts: preview.conflicts } });
    result = { event, conflicts: preview.conflicts };
  });
  return { plan: v2PlanDetail(planId), event: result.event, conflicts: result.conflicts };
}

function normalizePlanTaskInput(payload, { confirm = false } = {}) {
  const base = ["test_item_id", "title", "description", "primary_member_id", "collaborator_member_ids", "start_date", "end_date", "estimated_hours", "after_arrival", "expected_version"];
  assertKnownFields(payload, confirm ? [...base, "preview_token", "acknowledged_conflict_codes", "actor_label"] : base);
  const primary = parseV2Id(payload.primary_member_id, "primary_member_id");
  if (!Array.isArray(payload.collaborator_member_ids)) v2Fail(400, "MEMBER_SET_INVALID", { ids: [], reason: "type" });
  let collaborators;
  try { collaborators = payload.collaborator_member_ids.map((id) => parseV2Id(id, "collaborator_member_ids")); } catch { v2Fail(400, "MEMBER_SET_INVALID", { ids: payload.collaborator_member_ids, reason: "invalid_id" }); }
  if (new Set(collaborators).size !== collaborators.length) v2Fail(400, "MEMBER_SET_INVALID", { ids: sortUniqueNumbers(collaborators), reason: "duplicate" });
  collaborators.sort((a, b) => a - b);
  if (collaborators.includes(primary)) v2Fail(400, "MEMBER_SET_INVALID", { ids: [primary], reason: "primary_in_collaborators" });
  const startDate = localDate(payload.start_date, "start_date");
  const endDate = localDate(payload.end_date, "end_date");
  if (startDate > endDate) validation("end_date", "before_start");
  if (typeof payload.estimated_hours !== "number" || payload.estimated_hours <= 0 || payload.estimated_hours > 10000 || !Number.isInteger(payload.estimated_hours * 2)) validation("estimated_hours", "step");
  return {
    test_item_id: payload.test_item_id === null || payload.test_item_id === undefined ? null : parseV2Id(payload.test_item_id, "test_item_id"),
    title: trimText(payload.title, "title", 1, 200),
    description: payload.description === undefined || payload.description === null ? "" : trimText(payload.description, "description", 0, 4000),
    primary_member_id: primary,
    collaborator_member_ids: collaborators,
    start_date: startDate,
    end_date: endDate,
    estimated_hours: payload.estimated_hours,
    after_arrival: boolValue(payload.after_arrival, "after_arrival"),
    expected_version: intValue(payload.expected_version, "expected_version", 1)
  };
}

function validatePlanTaskReferences(planId, input) {
  const plan = getV2PlanRow(planId);
  assertPlanVersion(plan, input.expected_version);
  if (input.test_item_id !== null) {
    const item = getV2Resource("v2_test_items", "test_item", input.test_item_id);
    if (item.plan_id !== planId || item.archived_at) v2NotFound("test_item", input.test_item_id);
  }
  for (const memberId of [input.primary_member_id, ...input.collaborator_member_ids]) {
    const member = db.prepare("SELECT * FROM members WHERE id=? AND deleted_at IS NULL").get(memberId);
    if (!member) v2NotFound("member", memberId);
    if (member.status !== "active") v2Fail(409, "RESOURCE_INACTIVE", { resource: "member", id: memberId });
  }
  return plan;
}

function relatedLoadForCandidate(candidate, excludedTaskIds) {
  const before = scheduleTasks();
  const after = [...before.filter((task) => !excludedTaskIds.includes(task.task_id)), candidate];
  return sortUniqueNumbers(candidate.member_ranges.map((range) => range.member_id)).map((memberId) => {
    const range = memberRangeFor(candidate, memberId);
    return { member_id: memberId, weeks: weeksForRange(range.start_date, range.end_date).map((weekStart) => ({ week_start: weekStart, hours_before: scheduleHours(before, memberId, weekStart), hours_after: scheduleHours(after, memberId, weekStart) })) };
  });
}

function planTaskPreviewData(planId, payload, taskId = null) {
  const input = normalizePlanTaskInput(payload);
  const plan = validatePlanTaskReferences(planId, input);
  let existingFacts = null;
  if (taskId !== null) {
    const link = db.prepare("SELECT * FROM v2_plan_tasks WHERE task_id=?").get(taskId);
    if (!link || link.plan_id !== planId) v2NotFound("plan_task", taskId);
    const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(taskId);
    if (!task) v2NotFound("task", taskId);
    if (task.deleted_at) v2Fail(409, "TASK_DELETED", { task_id: taskId });
    existingFacts = { link, task, assignments: db.prepare("SELECT * FROM task_assignments WHERE task_id=? ORDER BY id").all(taskId) };
  }
  const members = [input.primary_member_id, ...input.collaborator_member_ids];
  const candidate = {
    task_id: taskId,
    task_lineage_key: existingFacts?.link.task_lineage_key ?? null,
    plan_id: planId,
    title: input.title,
    start_date: input.start_date,
    end_date: input.end_date,
    estimated_hours: input.estimated_hours,
    cryostat_id: plan.cryostat_id ?? null,
    assignments: members.map((memberId) => ({ member_id: memberId, start_date: input.start_date, end_date: input.end_date })),
    member_ranges: members.map((memberId) => ({ member_id: memberId, start_date: input.start_date, end_date: input.end_date }))
  };
  const excluded = taskId === null ? [] : [taskId];
  const conflicts = scheduleConflicts([candidate], excluded, { excludedCryostatPlanIds: [planId] });
  const relatedLoad = relatedLoadForCandidate(candidate, excluded);
  const token = previewHash({ operation: taskId === null ? "create_plan_task" : "update_plan_task", plan_id: planId, task_id: taskId, normalized_input: input, plan, existing_facts: existingFacts, schedule: scheduleTasks(), conflicts, related_load: relatedLoad });
  return { preview_token: token, normalized_input: input, conflicts, related_load: relatedLoad };
}

function generateTaskLineage() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const value = randomUUID().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) continue;
    if (!db.prepare("SELECT 1 FROM v2_plan_tasks WHERE task_lineage_key=? UNION SELECT 1 FROM v2_deliverable_submissions WHERE task_lineage_key=? LIMIT 1").get(value, value)) return value;
  }
  v2Fail(500, "LINEAGE_GENERATION_FAILED", {});
}

function confirmCreatePlanTask(planId, payload) {
  const input = normalizePlanTaskInput(payload, { confirm: true });
  const token = trimText(payload.preview_token, "preview_token", 64, 64);
  let taskId;
  runImmediateTransaction(db, () => {
    const preview = planTaskPreviewData(planId, input);
    if (preview.preview_token !== token) v2Fail(409, "STALE_PREVIEW", { operation: "create_plan_task", plan_id: planId });
    validateAcknowledgements(payload.acknowledged_conflict_codes, preview.conflicts);
    const timestamp = nowIso();
    const status = deriveAutoTaskStatus(input.start_date);
    taskId = Number(db.prepare("INSERT INTO tasks (title,description,default_start_date,default_end_date,color,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(input.title, input.description, input.start_date, input.end_date, "#2563eb", status, timestamp, timestamp).lastInsertRowid);
    const insertAssignment = db.prepare("INSERT INTO task_assignments (task_id,member_id,start_date,end_date,progress,note,created_at,updated_at) VALUES (?,?,?,?,0,'',?,?)");
    for (const memberId of [input.primary_member_id, ...input.collaborator_member_ids]) insertAssignment.run(taskId, memberId, input.start_date, input.end_date, timestamp, timestamp);
    const lineage = generateTaskLineage();
    db.prepare("INSERT INTO v2_plan_tasks (task_id,task_lineage_key,plan_id,test_item_id,primary_member_id,estimated_half_hours,after_arrival,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(taskId, lineage, planId, input.test_item_id, input.primary_member_id, input.estimated_hours * 2, input.after_arrival ? 1 : 0, timestamp, timestamp);
    db.prepare("UPDATE v2_control_plans SET version=version+1,updated_at=? WHERE id=? AND version=?").run(timestamp, planId, input.expected_version);
    logChange("create_task", { task_id: taskId, new_value: { ...input, member_ids: [input.primary_member_id, ...input.collaborator_member_ids] } });
    insertV2Event(planId, "create_task", payload.actor_label, { newValue: { task_id: taskId, task_lineage_key: lineage, ...input }, impact: { conflicts: preview.conflicts } });
  });
  const link = db.prepare("SELECT * FROM v2_plan_tasks WHERE task_id=?").get(taskId);
  return { task: taskById(taskId), plan_task: v2PlanTaskMeta(link), plan_version: input.expected_version + 1 };
}

function confirmUpdatePlanTask(taskId, payload) {
  const link = db.prepare("SELECT * FROM v2_plan_tasks WHERE task_id=?").get(taskId);
  if (!link) v2NotFound("plan_task", taskId);
  const input = normalizePlanTaskInput(payload, { confirm: true });
  const token = trimText(payload.preview_token, "preview_token", 64, 64);
  runImmediateTransaction(db, () => {
    const preview = planTaskPreviewData(link.plan_id, input, taskId);
    if (preview.preview_token !== token) v2Fail(409, "STALE_PREVIEW", { operation: "update_plan_task", plan_id: link.plan_id });
    validateAcknowledgements(payload.acknowledged_conflict_codes, preview.conflicts);
    const timestamp = nowIso();
    const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(taskId);
    const status = manualTaskStatuses.has(task.status) ? task.status : deriveAutoTaskStatus(input.start_date);
    db.prepare("UPDATE tasks SET title=?,description=?,default_start_date=?,default_end_date=?,status=?,updated_at=? WHERE id=?")
      .run(input.title, input.description, input.start_date, input.end_date, status, timestamp, taskId);
    const desired = new Set([input.primary_member_id, ...input.collaborator_member_ids]);
    const assignments = db.prepare("SELECT * FROM task_assignments WHERE task_id=?").all(taskId);
    for (const memberId of desired) {
      const assignment = assignments.find((row) => row.member_id === memberId);
      if (assignment) db.prepare("UPDATE task_assignments SET start_date=?,end_date=?,deleted_at=NULL,updated_at=? WHERE id=?").run(input.start_date, input.end_date, timestamp, assignment.id);
      else db.prepare("INSERT INTO task_assignments (task_id,member_id,start_date,end_date,progress,note,created_at,updated_at) VALUES (?,?,?,?,0,'',?,?)").run(taskId, memberId, input.start_date, input.end_date, timestamp, timestamp);
    }
    for (const assignment of assignments) if (!desired.has(assignment.member_id) && assignment.deleted_at === null) db.prepare("UPDATE task_assignments SET deleted_at=?,updated_at=? WHERE id=?").run(timestamp, timestamp, assignment.id);
    db.prepare("UPDATE v2_plan_tasks SET test_item_id=?,primary_member_id=?,estimated_half_hours=?,after_arrival=?,updated_at=? WHERE task_id=?")
      .run(input.test_item_id, input.primary_member_id, input.estimated_hours * 2, input.after_arrival ? 1 : 0, timestamp, taskId);
    db.prepare("UPDATE v2_control_plans SET version=version+1,updated_at=? WHERE id=? AND version=?").run(timestamp, link.plan_id, input.expected_version);
    logChange("update_task", { task_id: taskId, old_value: task, new_value: input });
    insertV2Event(link.plan_id, "update_assignment", payload.actor_label, { oldValue: { task, link, assignments }, newValue: input, impact: { conflicts: preview.conflicts } });
  });
  const updated = db.prepare("SELECT * FROM v2_plan_tasks WHERE task_id=?").get(taskId);
  return { task: taskById(taskId), plan_task: v2PlanTaskMeta(updated), plan_version: input.expected_version + 1 };
}

function canonicalUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function listV2Submissions(planId, url) {
  getV2PlanRow(planId);
  const query = queryFields(url, ["status", "task_lineage_key", "limit", "offset", "sort"]);
  const options = listOptions(query, ["lineage_asc_sequence_desc", "submitted_desc"], "lineage_asc_sequence_desc");
  if (query.status && !["submitted", "accepted", "returned"].includes(query.status)) v2Fail(400, "INVALID_QUERY", { field: "status", reason: "enum" });
  if (query.task_lineage_key && !canonicalUuid(query.task_lineage_key)) v2Fail(400, "INVALID_QUERY", { field: "task_lineage_key", reason: "uuid" });
  let rows = db.prepare("SELECT * FROM v2_deliverable_submissions WHERE plan_id=?").all(planId);
  if (query.status) rows = rows.filter((row) => row.status === query.status);
  if (query.task_lineage_key) rows = rows.filter((row) => row.task_lineage_key === query.task_lineage_key);
  rows.sort(options.sort === "submitted_desc"
    ? (a, b) => b.submitted_at.localeCompare(a.submitted_at) || b.id - a.id
    : (a, b) => a.task_lineage_key.localeCompare(b.task_lineage_key) || b.sequence - a.sequence || b.id - a.id);
  return { data: rows.slice(options.offset, options.offset + options.limit).map(submissionObject), meta: { limit: options.limit, offset: options.offset, total: rows.length, sort: options.sort } };
}

function checklistIds(value, mode) {
  if (!Array.isArray(value) || !value.length) v2Fail(400, "CHECKLIST_EMPTY", { field: "checklist" });
  const allowed = mode === "submission" ? ["template_item_id", "checked"] : ["template_item_id", "passed", "note"];
  const rows = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) validation("checklist", "type");
    assertKnownFields(item, allowed);
    const id = parseV2Id(item.template_item_id, "template_item_id");
    if (mode === "submission") return { template_item_id: id, checked: boolValue(item.checked, "checked") };
    return { template_item_id: id, passed: boolValue(item.passed, "passed"), note: trimText(item.note, "note", 0, 1000, { optional: true, fallback: "" }) };
  });
  const ids = rows.map((row) => row.template_item_id);
  const duplicates = sortUniqueNumbers(ids.filter((id, index) => ids.indexOf(id) !== index));
  if (duplicates.length) v2Fail(400, "CHECKLIST_DUPLICATE_ITEM", { template_item_ids: duplicates });
  return rows;
}

function assertChecklistSet(provided, expected) {
  const actualIds = new Set(provided.map((item) => item.template_item_id));
  const expectedIds = new Set(expected.map((item) => item.id ?? item.template_item_id));
  const missingIds = [...expectedIds].filter((id) => !actualIds.has(id)).sort((a, b) => a - b);
  const unexpectedIds = [...actualIds].filter((id) => !expectedIds.has(id)).sort((a, b) => a - b);
  if (missingIds.length || unexpectedIds.length) v2Fail(400, "CHECKLIST_ITEM_SET_MISMATCH", { missing_ids: missingIds, unexpected_ids: unexpectedIds });
}

function createV2Submission(taskId, payload) {
  assertKnownFields(payload, ["description", "submitter_label", "resource_kind", "resource_value", "checklist", "supersedes_submission_id"]);
  const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(taskId);
  if (!task || task.deleted_at) v2NotFound("task", taskId);
  const link = db.prepare("SELECT * FROM v2_plan_tasks WHERE task_id=?").get(taskId);
  if (!link) v2NotFound("task", taskId);
  const description = trimText(payload.description, "description", 1, 4000);
  const submitter = payload.submitter_label === undefined || payload.submitter_label === null || !String(payload.submitter_label).trim() ? "本地用户" : trimText(payload.submitter_label, "submitter_label", 1, 100);
  if (!["url", "local_path"].includes(payload.resource_kind)) validation("resource_kind", "enum");
  const resourceValue = trimText(payload.resource_value, "resource_value", 1, 2000);
  if (payload.resource_kind === "url") {
    let parsed;
    try { parsed = new URL(resourceValue); } catch { validation("resource_value", "url"); }
    if (!parsed || !["http:", "https:"].includes(parsed.protocol)) validation("resource_value", "url_protocol");
  }
  const checklist = checklistIds(payload.checklist, "submission");
  const template = activeTemplateForPlan(link.plan_id, { required: true });
  assertChecklistSet(checklist, template.items);
  const latest = db.prepare("SELECT * FROM v2_deliverable_submissions WHERE plan_id=? AND task_lineage_key=? ORDER BY sequence DESC,id DESC LIMIT 1").get(link.plan_id, link.task_lineage_key);
  const supersedes = payload.supersedes_submission_id === undefined || payload.supersedes_submission_id === null ? null : parseV2Id(payload.supersedes_submission_id, "supersedes_submission_id");
  if (!latest && supersedes !== null) v2Fail(409, "SUPERSESSION_INVALID", { submission_id: supersedes, reason: "first_submission" });
  if (latest?.status === "submitted") v2Fail(409, "SUBMISSION_PENDING", { submission_id: latest.id });
  if (latest?.status === "accepted") v2Fail(409, "TASK_ALREADY_ACCEPTED", { submission_id: latest.id });
  if (latest?.status === "returned" && supersedes === null) v2Fail(409, "SUPERSESSION_REQUIRED", { submission_id: latest.id });
  if (latest?.status === "returned" && supersedes !== latest.id) v2Fail(409, "SUPERSESSION_INVALID", { submission_id: supersedes, reason: "must_supersede_latest_returned" });
  if (supersedes !== null) {
    const previous = db.prepare("SELECT * FROM v2_deliverable_submissions WHERE id=?").get(supersedes);
    if (!previous || previous.plan_id !== link.plan_id || previous.task_lineage_key !== link.task_lineage_key || previous.status !== "returned") v2Fail(409, "SUPERSESSION_INVALID", { submission_id: supersedes, reason: "lineage_or_status" });
    const successor = db.prepare("SELECT id FROM v2_deliverable_submissions WHERE supersedes_submission_id=?").get(supersedes);
    if (successor) v2Fail(409, "SUBMISSION_HAS_SUCCESSOR", { successor_id: successor.id });
  }
  const inputById = new Map(checklist.map((item) => [item.template_item_id, item]));
  const snapshot = template.items.map((item) => ({ template_id: template.id, template_version: template.version, template_item_id: item.id, label: item.label, position: item.position, checked: inputById.get(item.id).checked }));
  const timestamp = nowIso();
  let submissionId;
  runImmediateTransaction(db, () => {
    const currentTemplate = activeTemplateForPlan(link.plan_id, { required: true });
    if (currentTemplate.id !== template.id) v2Fail(409, "CHECKLIST_TEMPLATE_STALE", { current_template_id: currentTemplate.id, submitted_template_item_ids: checklist.map((item) => item.template_item_id).sort((a, b) => a - b) });
    const sequence = latest ? latest.sequence + 1 : 1;
    submissionId = Number(db.prepare(`
      INSERT INTO v2_deliverable_submissions
      (plan_id,task_id,task_lineage_key,original_task_id,task_title_snapshot,test_item_id,sequence,supersedes_submission_id,description,submitter_label,submitted_at,resource_kind,resource_value,checklist_snapshot_json,status,version,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'submitted',1,?)
    `).run(link.plan_id, taskId, link.task_lineage_key, taskId, task.title, link.test_item_id, sequence, supersedes, description, submitter, timestamp, payload.resource_kind, resourceValue, JSON.stringify(snapshot), timestamp).lastInsertRowid);
    insertV2Event(link.plan_id, "submission", submitter, { newValue: { submission_id: submissionId, task_id: taskId, task_lineage_key: link.task_lineage_key, sequence }, impact: { checklist_snapshot: snapshot } });
  });
  return submissionObject(db.prepare("SELECT * FROM v2_deliverable_submissions WHERE id=?").get(submissionId));
}

function reviewV2Submission(submissionId, payload) {
  assertKnownFields(payload, ["decision", "reviewer_label", "comment", "checklist", "expected_version"]);
  const submission = db.prepare("SELECT * FROM v2_deliverable_submissions WHERE id=?").get(submissionId);
  if (!submission) v2NotFound("submission", submissionId);
  const expected = intValue(payload.expected_version, "expected_version", 1);
  if (submission.version !== expected) v2Fail(409, "VERSION_CONFLICT", { expected_version: expected, current_version: submission.version });
  if (db.prepare("SELECT 1 FROM v2_acceptance_reviews WHERE submission_id=?").get(submissionId)) v2Fail(409, "SUBMISSION_ALREADY_REVIEWED", { submission_id: submissionId, status: submission.status });
  if (submission.status !== "submitted" || submission.task_id === null) v2Fail(409, "SUBMISSION_NOT_REVIEWABLE", { submission_id: submissionId, status: submission.task_id === null ? "task_deleted" : submission.status });
  if (!["accepted", "returned"].includes(payload.decision)) validation("decision", "enum");
  const reviewer = payload.reviewer_label === undefined || payload.reviewer_label === null || !String(payload.reviewer_label).trim() ? "本地用户" : trimText(payload.reviewer_label, "reviewer_label", 1, 100);
  const comment = trimText(payload.comment, "comment", 0, 4000);
  if (payload.decision === "returned" && !comment) validation("comment", "required");
  const checklist = checklistIds(payload.checklist, "review");
  const snapshot = JSON.parse(submission.checklist_snapshot_json);
  assertChecklistSet(checklist, snapshot);
  if (payload.decision === "accepted") {
    const failed = checklist.filter((item) => !item.passed).map((item) => item.template_item_id).sort((a, b) => a - b);
    if (failed.length) v2Fail(400, "CHECKLIST_ACCEPTANCE_INCOMPLETE", { failed_item_ids: failed });
  }
  const snapshotById = new Map(snapshot.map((item) => [item.template_item_id, item]));
  const resultSnapshot = checklist.map((item) => ({ template_item_id: item.template_item_id, label: snapshotById.get(item.template_item_id).label, position: snapshotById.get(item.template_item_id).position, passed: item.passed, note: item.note })).sort((a, b) => a.position - b.position || a.template_item_id - b.template_item_id);
  let reviewId;
  runImmediateTransaction(db, () => {
    const timestamp = nowIso();
    reviewId = Number(db.prepare("INSERT INTO v2_acceptance_reviews (submission_id,decision,reviewer_label,comment,checklist_result_json,reviewed_at) VALUES (?,?,?,?,?,?)")
      .run(submissionId, payload.decision, reviewer, comment, JSON.stringify(resultSnapshot), timestamp).lastInsertRowid);
    const update = db.prepare("UPDATE v2_deliverable_submissions SET status=?,version=version+1,updated_at=? WHERE id=? AND version=?").run(payload.decision, timestamp, submissionId, expected);
    if (!update.changes) v2Fail(409, "VERSION_CONFLICT", { expected_version: expected, current_version: db.prepare("SELECT version FROM v2_deliverable_submissions WHERE id=?").get(submissionId).version });
    const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(submission.task_id);
    if (!task || task.deleted_at) v2Fail(409, "SUBMISSION_NOT_REVIEWABLE", { submission_id: submissionId, status: "task_deleted" });
    const nextStatus = payload.decision === "accepted" ? "completed" : deriveAutoTaskStatus(task.default_start_date);
    db.prepare("UPDATE tasks SET status=?,updated_at=? WHERE id=?").run(nextStatus, timestamp, task.id);
    insertV2Event(submission.plan_id, payload.decision === "accepted" ? "accept" : "return", reviewer, { oldValue: { submission_status: submission.status, task_status: task.status }, newValue: { submission_status: payload.decision, task_status: nextStatus, review_id: reviewId }, impact: { checklist_result: resultSnapshot } });
  });
  const updatedSubmission = db.prepare("SELECT * FROM v2_deliverable_submissions WHERE id=?").get(submissionId);
  const review = db.prepare("SELECT * FROM v2_acceptance_reviews WHERE id=?").get(reviewId);
  return { submission: submissionObject(updatedSubmission), review: reviewObject(review), task: taskById(submission.task_id), plan_summary: v2PlanSummary(submission.plan_id) };
}

async function routeV2Api(req, res, url) {
  try {
    if (!V2_ENDPOINT_MATCHERS.some((endpoint) => endpoint.method === req.method && endpoint.pattern.test(url.pathname))) {
      return sendJson(res, 404, { error: "API 路由不存在", code: "API_NOT_FOUND", details: {} });
    }
    if (["POST", "PUT"].includes(req.method) && !(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
      v2Fail(400, "VALIDATION_ERROR", { field: "content-type", reason: "application/json_required" });
    }
    if (req.method === "GET" && url.pathname === "/api/v2/status") return sendJson(res, 200, { data: v2MigrationStatus() });
    if (req.method === "GET" && url.pathname === "/api/v2/source-groups") return sendJson(res, 200, listV2SourceGroups(url));
    if (req.method === "POST" && url.pathname === "/api/v2/source-groups") return sendJson(res, 201, { data: createV2SourceGroup(await parseBody(req)) });
    let match = url.pathname.match(/^\/api\/v2\/source-groups\/([^/]+)$/);
    if (match && req.method === "PUT") return sendJson(res, 200, { data: updateV2SourceGroup(parseV2Id(match[1]), await parseBody(req)) });
    match = url.pathname.match(/^\/api\/v2\/source-groups\/([^/]+)\/contacts$/);
    if (match && req.method === "GET") return sendJson(res, 200, listV2Contacts(parseV2Id(match[1]), url));
    if (match && req.method === "POST") return sendJson(res, 201, { data: createV2Contact(parseV2Id(match[1]), await parseBody(req)) });
    match = url.pathname.match(/^\/api\/v2\/source-contacts\/([^/]+)$/);
    if (match && req.method === "PUT") return sendJson(res, 200, { data: updateV2Contact(parseV2Id(match[1]), await parseBody(req)) });
    if (req.method === "GET" && url.pathname === "/api/v2/cryostats") return sendJson(res, 200, listV2Cryostats(url));
    if (req.method === "POST" && url.pathname === "/api/v2/cryostats") return sendJson(res, 201, { data: createV2Cryostat(await parseBody(req)) });
    match = url.pathname.match(/^\/api\/v2\/cryostats\/([^/]+)$/);
    if (match && req.method === "PUT") return sendJson(res, 200, { data: updateV2Cryostat(parseV2Id(match[1]), await parseBody(req)) });

    if (req.method === "GET" && url.pathname === "/api/v2/plans") return sendJson(res, 200, listV2Plans(url));
    if (req.method === "POST" && url.pathname === "/api/v2/plans") return sendJson(res, 201, { data: createV2Plan(await parseBody(req)) });
    match = url.pathname.match(/^\/api\/v2\/plans\/([^/]+)$/);
    if (match && req.method === "GET") return sendJson(res, 200, { data: v2PlanDetail(parseV2Id(match[1])) });
    if (match && req.method === "PUT") return sendJson(res, 200, { data: updateV2Plan(parseV2Id(match[1]), await parseBody(req)) });
    match = url.pathname.match(/^\/api\/v2\/plans\/([^/]+)\/(archive|restore)$/);
    if (match && req.method === "POST") return sendJson(res, 200, { data: changePlanArchive(parseV2Id(match[1]), await parseBody(req), match[2] === "restore") });
    match = url.pathname.match(/^\/api\/v2\/plans\/([^/]+)\/arrival$/);
    if (match && req.method === "POST") return sendJson(res, 200, { data: confirmV2Arrival(parseV2Id(match[1]), await parseBody(req)) });
    match = url.pathname.match(/^\/api\/v2\/plans\/([^/]+)\/test-items$/);
    if (match && req.method === "POST") return sendJson(res, 201, { data: createV2TestItem(parseV2Id(match[1]), await parseBody(req)) });
    match = url.pathname.match(/^\/api\/v2\/test-items\/([^/]+)$/);
    if (match && req.method === "PUT") return sendJson(res, 200, { data: updateV2TestItem(parseV2Id(match[1]), await parseBody(req)) });
    match = url.pathname.match(/^\/api\/v2\/plans\/([^/]+)\/acceptance-template$/);
    if (match && req.method === "GET") return sendJson(res, 200, { data: activeTemplateForPlan(parseV2Id(match[1]), { required: true }) });
    if (match && req.method === "PUT") return sendJson(res, 200, { data: updateV2AcceptanceTemplate(parseV2Id(match[1]), await parseBody(req)) });
    match = url.pathname.match(/^\/api\/v2\/plans\/([^/]+)\/events$/);
    if (match && req.method === "GET") return sendJson(res, 200, listV2Events(parseV2Id(match[1]), url));
    if (req.method === "GET" && url.pathname === "/api/v2/backup") return sendJson(res, 200, { data: v2BackupData() });

    match = url.pathname.match(/^\/api\/v2\/plans\/([^/]+)\/eta\/(preview|confirm)$/);
    if (match && req.method === "POST") {
      const id = parseV2Id(match[1]); const body = await parseBody(req);
      return sendJson(res, 200, { data: match[2] === "preview" ? etaPreviewData(id, body) : confirmV2Eta(id, body) });
    }
    match = url.pathname.match(/^\/api\/v2\/plans\/([^/]+)\/cryostat\/(preview|confirm)$/);
    if (match && req.method === "POST") {
      const id = parseV2Id(match[1]); const body = await parseBody(req);
      return sendJson(res, 200, { data: match[2] === "preview" ? cryostatPreviewData(id, body) : confirmV2Cryostat(id, body) });
    }
    match = url.pathname.match(/^\/api\/v2\/plans\/([^/]+)\/tasks(\/preview)?$/);
    if (match && req.method === "POST") {
      const id = parseV2Id(match[1]); const body = await parseBody(req);
      return sendJson(res, match[2] ? 200 : 201, { data: match[2] ? planTaskPreviewData(id, body) : confirmCreatePlanTask(id, body) });
    }
    match = url.pathname.match(/^\/api\/v2\/plan-tasks\/([^/]+)(\/preview)?$/);
    if (match && ((match[2] && req.method === "POST") || (!match[2] && req.method === "PUT"))) {
      const taskId = parseV2Id(match[1], "task_id");
      const link = db.prepare("SELECT plan_id FROM v2_plan_tasks WHERE task_id=?").get(taskId);
      if (!link) v2NotFound("plan_task", taskId);
      const body = await parseBody(req);
      return sendJson(res, 200, { data: match[2] ? planTaskPreviewData(link.plan_id, body, taskId) : confirmUpdatePlanTask(taskId, body) });
    }
    match = url.pathname.match(/^\/api\/v2\/plans\/([^/]+)\/submissions$/);
    if (match && req.method === "GET") return sendJson(res, 200, listV2Submissions(parseV2Id(match[1]), url));
    match = url.pathname.match(/^\/api\/v2\/tasks\/([^/]+)\/submissions$/);
    if (match && req.method === "POST") return sendJson(res, 201, { data: createV2Submission(parseV2Id(match[1], "task_id"), await parseBody(req)) });
    match = url.pathname.match(/^\/api\/v2\/submissions\/([^/]+)\/review$/);
    if (match && req.method === "POST") return sendJson(res, 200, { data: reviewV2Submission(parseV2Id(match[1]), await parseBody(req)) });
    return sendJson(res, 404, { error: "API 路由不存在", code: "API_NOT_FOUND", details: {} });
  } catch (error) {
    if (error instanceof V2ApiError) return sendJson(res, error.status, { error: error.message, code: error.code, details: error.details });
    return sendJson(res, 500, { error: error.message || "服务错误", code: "INTERNAL_ERROR", details: {} });
  }
}

async function routeApi(req, res, url) {
  if (url.pathname === "/api/v5" || url.pathname.startsWith("/api/v5/")) return routeV5Api(req, res, db, url);
  if (url.pathname === "/api/v3" || url.pathname.startsWith("/api/v3/")) return routeV3Api(req, res, db, url);
  if (url.pathname === "/api/v2" || url.pathname.startsWith("/api/v2/")) return routeV2Api(req, res, url);
  try {
    if (req.method === "GET" && url.pathname === "/api/members") return sendJson(res, 200, listMembers());
    if (req.method === "POST" && url.pathname === "/api/members") return sendJson(res, 201, createMember(await parseBody(req)));
    const memberMatch = url.pathname.match(/^\/api\/members\/(\d+)$/);
    if (memberMatch && req.method === "PUT") return sendJson(res, 200, updateMember(parseId(memberMatch[1]), await parseBody(req)));
    if (memberMatch && req.method === "DELETE") return sendJson(res, 200, deleteMember(parseId(memberMatch[1])));

    if (req.method === "GET" && url.pathname === "/api/templates") return sendJson(res, 200, listTemplates());
    if (req.method === "POST" && url.pathname === "/api/templates") return sendJson(res, 201, createTemplate(await parseBody(req)));
    const templateMatch = url.pathname.match(/^\/api\/templates\/(\d+)$/);
    if (templateMatch && req.method === "PUT") return sendJson(res, 200, updateTemplate(parseId(templateMatch[1]), await parseBody(req)));
    if (templateMatch && req.method === "DELETE") return sendJson(res, 200, deleteTemplate(parseId(templateMatch[1])));

    if (req.method === "GET" && url.pathname === "/api/tasks") return sendJson(res, 200, listTasks(url.searchParams.get("include_archived") === "1"));
    if (req.method === "GET" && url.pathname === "/api/archive/tasks") return sendJson(res, 200, listArchiveTasks());
    if (req.method === "GET" && url.pathname === "/api/trash") return sendJson(res, 200, listDeletedItems());
    if (req.method === "POST" && url.pathname === "/api/tasks") return sendJson(res, 201, createTask(await parseBody(req)));
    const taskMatch = url.pathname.match(/^\/api\/tasks\/(\d+)$/);
    if (taskMatch && req.method === "PUT") return sendJson(res, 200, updateTask(parseId(taskMatch[1]), await parseBody(req)));
    if (taskMatch && req.method === "DELETE") return sendJson(res, 200, deleteTask(parseId(taskMatch[1])));
    const archiveMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/archive$/);
    if (archiveMatch && req.method === "POST") return sendJson(res, 200, archiveTask(parseId(archiveMatch[1])));
    const restoreTaskMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/restore$/);
    if (restoreTaskMatch && req.method === "POST") return sendJson(res, 200, restoreTask(parseId(restoreTaskMatch[1])));
    const membersMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/members$/);
    if (membersMatch && req.method === "POST") {
      const body = await parseBody(req);
      return sendJson(res, 200, addTaskMembers(parseId(membersMatch[1]), body.member_ids || []));
    }
    const checklistMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/checklist$/);
    if (checklistMatch && req.method === "POST") return sendJson(res, 201, createChecklistItem(parseId(checklistMatch[1]), await parseBody(req)));

    const checklistItemMatch = url.pathname.match(/^\/api\/checklist\/(\d+)$/);
    if (checklistItemMatch && req.method === "PUT") return sendJson(res, 200, updateChecklistItem(parseId(checklistItemMatch[1]), await parseBody(req)));
    if (checklistItemMatch && req.method === "DELETE") return sendJson(res, 200, deleteChecklistItem(parseId(checklistItemMatch[1])));

    const assignmentMatch = url.pathname.match(/^\/api\/assignments\/(\d+)$/);
    if (assignmentMatch && req.method === "PUT") return sendJson(res, 200, updateAssignment(parseId(assignmentMatch[1]), await parseBody(req)));
    if (assignmentMatch && req.method === "DELETE") return sendJson(res, 200, deleteAssignment(parseId(assignmentMatch[1])));

    if (req.method === "POST" && url.pathname === "/api/batch/tasks") return sendJson(res, 200, batchUpdate(await parseBody(req)));
    if (req.method === "GET" && url.pathname === "/api/dashboard") return sendJson(res, 200, dashboardData(Object.fromEntries(url.searchParams)));
    if (req.method === "GET" && url.pathname === "/api/logs") return sendJson(res, 200, changeLogs());
    if (req.method === "GET" && url.pathname === "/api/backup") return sendJson(res, 200, backupData());
    if (req.method === "GET" && url.pathname === "/api/export/tasks.csv") return sendCsv(res, exportTasksCsv());
    if (req.method === "GET" && url.pathname === "/api/export/member-load.csv") return sendCsv(res, exportLoadCsv());
    if (req.method === "POST" && url.pathname === "/api/import/members") return sendJson(res, 200, importMembersCsv((await parseBody(req)).csv || ""));
    if (req.method === "POST" && url.pathname === "/api/import/tasks") return sendJson(res, 200, importTasksCsv((await parseBody(req)).csv || ""));
    if (req.method === "POST" && url.pathname === "/api/maintenance/clear-logs") return sendJson(res, 200, clearLogs());
    if (req.method === "GET" && url.pathname === "/api/maintenance/preview") return sendJson(res, 200, maintenancePreview());
    if (req.method === "POST" && url.pathname === "/api/maintenance/purge-archived") return sendJson(res, 200, purgeArchivedTasks());
    if (req.method === "POST" && url.pathname === "/api/maintenance/reset-sample") return sendJson(res, 200, resetSampleData());
    const restoreMemberMatch = url.pathname.match(/^\/api\/members\/(\d+)\/restore$/);
    if (restoreMemberMatch && req.method === "POST") return sendJson(res, 200, restoreMember(parseId(restoreMemberMatch[1])));

    return sendJson(res, 404, { error: "API 路由不存在" });
  } catch (error) {
    if (error instanceof V2ApiError) return sendJson(res, error.status, { error: error.message, code: error.code, details: error.details });
    return sendJson(res, error.message.includes("不存在") ? 404 : 400, { error: error.message });
  }
}

async function serveStatic(req, res, url) {
  const relative = url.pathname === "/"
    ? "index.html"
    : path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]/, "");
  const filePath = path.join(publicDir, relative);
  if (!filePath.startsWith(publicDir)) return sendText(res, 403, "Forbidden");
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    const content = await readFile(filePath);
    res.writeHead(200, { "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  } catch {
    sendText(res, 404, "Not found");
  }
}

export function createAppServer(database) {
  db = database;
  return createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) return routeApi(req, res, url);
    return serveStatic(req, res, url);
  });
}

if (process.argv[1] === __filename) {
  if (!existsSync(dataDir)) await mkdir(dataDir, { recursive: true });
  const database = await initDatabase();
  const server = createAppServer(database);
  server.listen(port, () => {
    console.log(`小组任务管理与甘特图系统已启动：http://localhost:${port}`);
    console.log(`SQLite database: ${dbPath}`);
  });
}
