import { createServer } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

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

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
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
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + amount);
  return next.toISOString().slice(0, 10);
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

function insertSampleMembersAndTasks(database) {
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

  const tasks = [
    ["相稳定性实验", "完成第一批样品测试和数据记录。", "2026-06-24", "2026-07-12", "#2563eb", "active", ["样品准备", "实验记录", "数据备份"]],
    ["XY 相图整理", "整理已有结果并绘制阶段性相图。", "2026-07-02", "2026-07-24", "#16a34a", "planned", ["收集结果", "绘制相图", "复核标注"]],
    ["文献精读汇总", "整理近期论文并形成组会材料。", "2026-06-10", "2026-06-26", "#9333ea", "completed", ["阅读论文", "整理笔记", "完成汇报"]],
    ["模型参数扫描", "执行多组参数扫描并记录异常点。", "2026-07-08", "2026-08-06", "#ea580c", "active", ["参数表", "运行扫描", "异常点记录"]]
  ];
  const taskIds = tasks.map((task) => insertTask.run(...task.slice(0, 6), timestamp, timestamp).lastInsertRowid);
  tasks.forEach((task, taskIndex) => {
    task[6].forEach((item, index) => insertChecklist.run(taskIds[taskIndex], item, task[5] === "completed" ? 1 : 0, index, timestamp, timestamp));
  });

  insertAssignment.run(taskIds[0], memberIds[0], "2026-06-24", "2026-07-12", 45, "负责样品 A/B。", timestamp, timestamp);
  insertAssignment.run(taskIds[0], memberIds[1], "2026-06-26", "2026-07-12", 35, "同步整理原始数据。", timestamp, timestamp);
  insertAssignment.run(taskIds[1], memberIds[1], "2026-07-02", "2026-07-24", 10, "", timestamp, timestamp);
  insertAssignment.run(taskIds[1], memberIds[2], "2026-07-02", "2026-07-24", 15, "", timestamp, timestamp);
  insertAssignment.run(taskIds[2], memberIds[3], "2026-06-10", "2026-06-26", 100, "已完成组会版本。", timestamp, timestamp);
  insertAssignment.run(taskIds[3], memberIds[0], "2026-07-08", "2026-08-02", 5, "", timestamp, timestamp);
  insertAssignment.run(taskIds[3], memberIds[2], "2026-07-08", "2026-08-06", 5, "负责高温区间。", timestamp, timestamp);
}

function seedMembersAndTasks(database) {
  const row = database.prepare("SELECT COUNT(*) AS count FROM members WHERE deleted_at IS NULL").get();
  if (row.count > 0) return;

  runTransaction(database, () => {
    insertSampleMembersAndTasks(database);
  });
}

function seedIfEmpty(database) {
  seedTemplates(database);
  seedMembersAndTasks(database);
}

export async function initDatabase(customPath = dbPath) {
  await mkdir(path.dirname(customPath), { recursive: true });
  const database = new DatabaseSync(customPath);
  createSchema(database);
  seedIfEmpty(database);
  return database;
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
  const timestamp = nowIso();
  runTransaction(db, () => {
    db.prepare("UPDATE members SET deleted_at = ?, status = 'inactive', updated_at = ? WHERE id = ?").run(timestamp, timestamp, memberId);
    db.prepare("UPDATE task_assignments SET deleted_at = ?, updated_at = ? WHERE member_id = ? AND deleted_at IS NULL").run(timestamp, timestamp, memberId);
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
  const timestamp = nowIso();
  runTransaction(db, () => {
    const restoredStatus = existing.status === "archived" ? deriveAutoTaskStatus(existing.default_start_date) : resolveTaskStatus(existing.status, existing.default_start_date, existing.status);
    db.prepare("UPDATE tasks SET status = ?, deleted_at = NULL, updated_at = ? WHERE id = ?")
      .run(restoredStatus, timestamp, taskId);
    db.prepare("UPDATE task_assignments SET deleted_at = NULL, updated_at = ? WHERE task_id = ?").run(timestamp, taskId);
    db.prepare("UPDATE task_checklist_items SET deleted_at = NULL, updated_at = ? WHERE task_id = ?").run(timestamp, taskId);
    logChange("restore_task", { task_id: taskId, old_value: existing });
  });
  return taskById(taskId);
}

function deleteTask(taskId) {
  const existing = getTask(taskId);
  if (!existing) throw new Error("任务不存在");
  const timestamp = nowIso();
  runTransaction(db, () => {
    db.prepare("UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, taskId);
    db.prepare("UPDATE task_assignments SET deleted_at = ?, updated_at = ? WHERE task_id = ? AND deleted_at IS NULL").run(timestamp, timestamp, taskId);
    db.prepare("UPDATE task_checklist_items SET deleted_at = ?, updated_at = ? WHERE task_id = ? AND deleted_at IS NULL").run(timestamp, timestamp, taskId);
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
  db.prepare("UPDATE task_assignments SET deleted_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), assignmentId);
  logChange("remove_assignment", { task_id: existing.task_id, assignment_id: assignmentId, member_id: existing.member_id, old_value: existing });
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
  const archived = db.prepare("SELECT id FROM tasks WHERE status = 'archived' AND deleted_at IS NULL").all().map((item) => item.id);
  runTransaction(db, () => {
    for (const taskId of archived) {
      db.prepare("UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, taskId);
      db.prepare("UPDATE task_assignments SET deleted_at = ?, updated_at = ? WHERE task_id = ? AND deleted_at IS NULL").run(timestamp, timestamp, taskId);
      db.prepare("UPDATE task_checklist_items SET deleted_at = ?, updated_at = ? WHERE task_id = ? AND deleted_at IS NULL").run(timestamp, timestamp, taskId);
    }
    logChange("purge_archived_tasks", { new_value: { task_ids: archived } });
  });
  return { deleted: archived.length, backup };
}

function resetSampleData() {
  const backup = backupData();
  runTransaction(db, () => {
    db.exec(`
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

async function routeApi(req, res, url) {
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
    console.log(`Team task manager is running at http://localhost:${port}`);
    console.log(`SQLite database: ${dbPath}`);
  });
}
