import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const V1_TABLES = [
  "members",
  "tasks",
  "task_assignments",
  "task_checklist_items",
  "task_templates",
  "task_change_logs"
];
const V2_V3_TABLE_PREFIXES = ["v2_", "v3_"];

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function requireArg(name) {
  const value = arg(name);
  if (!value) throw new Error(`缺少参数 ${name}`);
  return path.resolve(value);
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function jsonSafe(value) {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? Number(item) : item);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fileSha256(filename) {
  return sha256(fs.readFileSync(filename));
}

function quoteSqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function openDatabase(filename, readOnly = false) {
  const db = new DatabaseSync(filename, readOnly ? { readOnly: true } : {});
  db.__filename = filename;
  db.exec("PRAGMA foreign_keys = ON");
  if (readOnly) db.exec("PRAGMA query_only = ON");
  return db;
}

function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map((row) => row.name);
}

function assertV1Schema(db, label) {
  const expected = {
    members: ["id", "name", "role", "email", "status", "created_at", "updated_at", "deleted_at"],
    tasks: ["id", "title", "description", "default_start_date", "default_end_date", "color", "status", "created_at", "updated_at", "deleted_at"],
    task_assignments: ["id", "task_id", "member_id", "start_date", "end_date", "progress", "note", "created_at", "updated_at", "deleted_at"],
    task_checklist_items: ["id", "task_id", "title", "is_done", "position", "created_at", "updated_at", "deleted_at"],
    task_templates: ["id", "name", "description", "color", "duration_days", "checklist_json", "created_at", "updated_at", "deleted_at"],
    task_change_logs: ["id", "task_id", "assignment_id", "member_id", "change_type", "old_value", "new_value", "created_at"]
  };
  const tables = tableNames(db);
  for (const [table, columns] of Object.entries(expected)) {
    if (!tables.includes(table)) throw new Error(`${label} 缺少 V1 表 ${table}`);
    const actual = tableColumns(db, table);
    if (jsonSafe(actual) !== jsonSafe(columns)) throw new Error(`${label} 表 ${table} 字段不符合 V1 契约`);
  }
}

function checkIntegrity(db, label) {
  const quick = db.prepare("PRAGMA quick_check").all();
  if (quick.length !== 1 || quick[0].quick_check !== "ok") throw new Error(`${label} quick_check 未通过`);
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeys.length) throw new Error(`${label} foreign_key_check 发现 ${foreignKeys.length} 条错误`);
}

function rowCount(db, table, predicate = "1=1") {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} WHERE ${predicate}`).get().count);
}

function tableHash(db, table) {
  const rows = db.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all()
    .map((row) => jsonSafe(row))
    .sort();
  return sha256(rows.join("\n"));
}

function nonV1Hashes(db) {
  return Object.fromEntries(tableNames(db)
    .filter((table) => !V1_TABLES.includes(table))
    .filter((table) => V2_V3_TABLE_PREFIXES.some((prefix) => table.startsWith(prefix)) || table === "app_schema_versions")
    .map((table) => [table, tableHash(db, table)]));
}

function audit(db, label) {
  checkIntegrity(db, label);
  const tables = tableNames(db);
  const counts = {};
  for (const table of V1_TABLES) {
    const total = rowCount(db, table);
    counts[table] = table === "task_change_logs"
      ? { total, live: total, deleted: 0 }
      : { total, live: rowCount(db, table, "deleted_at IS NULL"), deleted: rowCount(db, table, "deleted_at IS NOT NULL") };
  }
  const logTotal = rowCount(db, "task_change_logs");
  return {
    label,
    file_sha256: fileSha256(db.__filename),
    tables,
    counts,
    log_total: logTotal,
    non_v1_hashes: nonV1Hashes(db),
    app_schema_versions: tables.includes("app_schema_versions")
      ? db.prepare("SELECT * FROM app_schema_versions ORDER BY version").all()
      : []
  };
}

function selectRows(db, table, where = "1=1") {
  return db.prepare(`SELECT * FROM ${quoteIdentifier(table)} WHERE ${where} ORDER BY id`).all();
}

function keyForMember(row) {
  return [row.name ?? "", row.role ?? "", row.email ?? ""].join("\u0000");
}

function keyForTemplate(row) {
  return String(row.name ?? "");
}

function insertAndGetId(db, sql, values) {
  const result = db.prepare(sql).run(...values);
  return Number(result.lastInsertRowid);
}

function assertNoLiveReferencesToDeletedRows(db, label) {
  const checks = [
    ["live assignment -> deleted task", `SELECT COUNT(*) AS count FROM task_assignments a JOIN tasks t ON t.id=a.task_id WHERE a.deleted_at IS NULL AND t.deleted_at IS NOT NULL`],
    ["live assignment -> deleted member", `SELECT COUNT(*) AS count FROM task_assignments a JOIN members m ON m.id=a.member_id WHERE a.deleted_at IS NULL AND m.deleted_at IS NOT NULL`],
    ["live checklist -> deleted task", `SELECT COUNT(*) AS count FROM task_checklist_items c JOIN tasks t ON t.id=c.task_id WHERE c.deleted_at IS NULL AND t.deleted_at IS NOT NULL`]
  ];
  for (const [description, sql] of checks) {
    const count = Number(db.prepare(sql).get().count);
    if (count) throw new Error(`${label} 存在 ${description}：${count} 条`);
  }
}

function deleteCurrentDeletedRows(db) {
  const crossRefs = [
    ["v2_plan_tasks", "SELECT COUNT(*) AS count FROM v2_plan_tasks WHERE task_id IN (SELECT id FROM tasks WHERE deleted_at IS NOT NULL) OR primary_member_id IN (SELECT id FROM members WHERE deleted_at IS NOT NULL)"],
    ["v3_topic_tasks", "SELECT COUNT(*) AS count FROM v3_topic_tasks WHERE task_id IN (SELECT id FROM tasks WHERE deleted_at IS NOT NULL) OR primary_member_id IN (SELECT id FROM members WHERE deleted_at IS NOT NULL)"],
    ["v3_task_member_efforts", "SELECT COUNT(*) AS count FROM v3_task_member_efforts WHERE member_id IN (SELECT id FROM members WHERE deleted_at IS NOT NULL)"],
  ];
  for (const [name, sql] of crossRefs) {
    if (tableNames(db).includes(name) && Number(db.prepare(sql).get().count)) {
      throw new Error(`当前 V2/V3 表 ${name} 引用了待清理的已删除 V1 记录，停止导入`);
    }
  }
  const before = {
    members: rowCount(db, "members", "deleted_at IS NOT NULL"),
    tasks: rowCount(db, "tasks", "deleted_at IS NOT NULL"),
    assignments: rowCount(db, "task_assignments", "deleted_at IS NOT NULL"),
    checklists: rowCount(db, "task_checklist_items", "deleted_at IS NOT NULL"),
    templates: rowCount(db, "task_templates", "deleted_at IS NOT NULL")
  };
  db.exec(`
    DELETE FROM task_change_logs
    WHERE task_id IN (SELECT id FROM tasks WHERE deleted_at IS NOT NULL)
       OR assignment_id IN (SELECT id FROM task_assignments WHERE deleted_at IS NOT NULL)
       OR member_id IN (SELECT id FROM members WHERE deleted_at IS NOT NULL);
    DELETE FROM task_checklist_items
    WHERE deleted_at IS NOT NULL OR task_id IN (SELECT id FROM tasks WHERE deleted_at IS NOT NULL);
    DELETE FROM task_assignments
    WHERE deleted_at IS NOT NULL
       OR task_id IN (SELECT id FROM tasks WHERE deleted_at IS NOT NULL)
       OR member_id IN (SELECT id FROM members WHERE deleted_at IS NOT NULL);
    DELETE FROM tasks WHERE deleted_at IS NOT NULL;
    DELETE FROM members WHERE deleted_at IS NOT NULL;
    DELETE FROM task_templates WHERE deleted_at IS NOT NULL;
  `);
  return before;
}

function mergeLiveData(source, target) {
  assertV1Schema(source, "源库");
  assertV1Schema(target, "候选库");
  checkIntegrity(source, "源库");
  checkIntegrity(target, "候选库");
  assertNoLiveReferencesToDeletedRows(source, "源库");
  const sourceRows = {
    members: selectRows(source, "members", "deleted_at IS NULL"),
    tasks: selectRows(source, "tasks", "deleted_at IS NULL"),
    assignments: selectRows(source, "task_assignments", "deleted_at IS NULL"),
    checklists: selectRows(source, "task_checklist_items", "deleted_at IS NULL"),
    templates: selectRows(source, "task_templates", "deleted_at IS NULL"),
    logs: selectRows(source, "task_change_logs")
  };
  const sourceTaskIds = new Set(sourceRows.tasks.map((row) => Number(row.id)));
  const sourceMemberIds = new Set(sourceRows.members.map((row) => Number(row.id)));
  const sourceAssignmentIds = new Set(sourceRows.assignments.map((row) => Number(row.id)));
  const retainedLogs = sourceRows.logs.filter((row) =>
    (row.task_id == null || sourceTaskIds.has(Number(row.task_id))) &&
    (row.member_id == null || sourceMemberIds.has(Number(row.member_id))) &&
    (row.assignment_id == null || sourceAssignmentIds.has(Number(row.assignment_id)))
  );
  const removedCurrent = deleteCurrentDeletedRows(target);
  const memberMap = new Map();
  const taskMap = new Map();
  const assignmentMap = new Map();
  const templateMap = new Map();

  const currentMembers = target.prepare("SELECT * FROM members WHERE deleted_at IS NULL").all();
  const currentMemberKeys = new Map(currentMembers.map((row) => [keyForMember(row), Number(row.id)]));
  for (const row of sourceRows.members) {
    const key = keyForMember(row);
    const existing = currentMemberKeys.get(key);
    const id = existing ?? insertAndGetId(target,
      `INSERT INTO members (name,role,email,status,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,NULL)`,
      [row.name, row.role, row.email, row.status, row.created_at, row.updated_at]);
    memberMap.set(Number(row.id), id);
    if (!existing) currentMemberKeys.set(key, id);
  }

  for (const row of sourceRows.tasks) {
    const id = insertAndGetId(target,
      `INSERT INTO tasks (title,description,default_start_date,default_end_date,color,status,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,NULL)`,
      [row.title, row.description, row.default_start_date, row.default_end_date, row.color, row.status, row.created_at, row.updated_at]);
    taskMap.set(Number(row.id), id);
  }

  const currentTemplates = target.prepare("SELECT * FROM task_templates WHERE deleted_at IS NULL").all();
  const currentTemplateKeys = new Map(currentTemplates.map((row) => [keyForTemplate(row), Number(row.id)]));
  for (const row of sourceRows.templates) {
    const key = keyForTemplate(row);
    const existing = currentTemplateKeys.get(key);
    const id = existing ?? insertAndGetId(target,
      `INSERT INTO task_templates (name,description,color,duration_days,checklist_json,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,NULL)`,
      [row.name, row.description, row.color, row.duration_days, row.checklist_json, row.created_at, row.updated_at]);
    templateMap.set(Number(row.id), id);
    if (!existing) currentTemplateKeys.set(key, id);
  }

  for (const row of sourceRows.assignments) {
    const taskId = taskMap.get(Number(row.task_id));
    const memberId = memberMap.get(Number(row.member_id));
    if (!taskId || !memberId) throw new Error(`任务分配 ${row.id} 无法完成 ID 映射`);
    const id = insertAndGetId(target,
      `INSERT INTO task_assignments (task_id,member_id,start_date,end_date,progress,note,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,NULL)`,
      [taskId, memberId, row.start_date, row.end_date, row.progress, row.note, row.created_at, row.updated_at]);
    assignmentMap.set(Number(row.id), id);
  }

  for (const row of sourceRows.checklists) {
    const taskId = taskMap.get(Number(row.task_id));
    if (!taskId) throw new Error(`清单 ${row.id} 无法完成任务 ID 映射`);
    insertAndGetId(target,
      `INSERT INTO task_checklist_items (task_id,title,is_done,position,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,NULL)`,
      [taskId, row.title, row.is_done, row.position, row.created_at, row.updated_at]);
  }

  for (const row of retainedLogs) {
    const taskId = row.task_id == null ? null : taskMap.get(Number(row.task_id));
    const assignmentId = row.assignment_id == null ? null : assignmentMap.get(Number(row.assignment_id));
    const memberId = row.member_id == null ? null : memberMap.get(Number(row.member_id));
    if ((row.task_id != null && !taskId) || (row.assignment_id != null && !assignmentId) || (row.member_id != null && !memberId)) {
      throw new Error(`日志 ${row.id} 无法完成关联 ID 映射`);
    }
    target.prepare(`INSERT INTO task_change_logs (task_id,assignment_id,member_id,change_type,old_value,new_value,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(taskId, assignmentId, memberId, row.change_type, row.old_value, row.new_value, row.created_at);
  }

  checkIntegrity(target, "候选库导入后");
  for (const table of ["members", "tasks", "task_assignments", "task_checklist_items", "task_templates"]) {
    const deletedCount = rowCount(target, table, "deleted_at IS NOT NULL");
    if (deletedCount) throw new Error(`候选库仍存在 ${table} 的 ${deletedCount} 条已删除记录`);
  }
  return {
    source_rows: {
      members: sourceRows.members.length,
      tasks: sourceRows.tasks.length,
      assignments: sourceRows.assignments.length,
      checklists: sourceRows.checklists.length,
      templates: sourceRows.templates.length,
      logs_total: sourceRows.logs.length,
      logs_retained: retainedLogs.length,
      logs_excluded: sourceRows.logs.length - retainedLogs.length
    },
    removed_current_deleted_rows: removedCurrent,
    id_maps: {
      members: memberMap.size,
      tasks: taskMap.size,
      assignments: assignmentMap.size,
      templates: templateMap.size
    }
  };
}

function prepareCandidate() {
  const sourcePath = requireArg("--source");
  const targetPath = requireArg("--target");
  const candidatePath = requireArg("--candidate");
  const backupPath = requireArg("--backup");
  const reportPath = requireArg("--report");
  for (const filename of [sourcePath, targetPath]) {
    if (!fs.existsSync(filename)) throw new Error(`文件不存在：${filename}`);
  }
  for (const filename of [candidatePath, backupPath]) {
    if (fs.existsSync(filename)) throw new Error(`拒绝覆盖已存在文件：${filename}`);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const source = openDatabase(sourcePath, true);
  const target = openDatabase(targetPath, false);
  const sourceBefore = audit(source, "source");
  const targetBefore = audit(target, "target-before");
  target.exec(`VACUUM INTO ${quoteSqlString(backupPath)}`);
  target.exec(`VACUUM INTO ${quoteSqlString(candidatePath)}`);
  target.close();
  const candidate = openDatabase(candidatePath, false);
  let merge;
  try {
    candidate.exec("BEGIN IMMEDIATE");
    merge = mergeLiveData(source, candidate);
    candidate.exec("COMMIT");
  } catch (error) {
    try { candidate.exec("ROLLBACK"); } catch { /* transaction may already be closed */ }
    candidate.close();
    source.close();
    throw error;
  }
  const candidateAfter = audit(candidate, "candidate-after");
  const preservedNonV1 = JSON.stringify(targetBefore.non_v1_hashes) === JSON.stringify(candidateAfter.non_v1_hashes);
  if (!preservedNonV1) throw new Error("候选库 V2/V3 或 schema 版本数据发生变化");
  candidate.close();
  source.close();
  const report = {
    operation: "merge-live-v1-data",
    source_path: sourcePath,
    target_path: targetPath,
    candidate_path: candidatePath,
    backup_path: backupPath,
    source_sha256: sourceBefore.file_sha256,
    backup_sha256: fileSha256(backupPath),
    candidate_sha256: fileSha256(candidatePath),
    source_before: sourceBefore,
    target_before: targetBefore,
    candidate_after: candidateAfter,
    merge,
    preserved_non_v1: preservedNonV1,
    generated_at: new Date().toISOString()
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

function verify() {
  const sourcePath = requireArg("--source");
  const targetPath = requireArg("--target");
  const reportPath = requireArg("--report");
  const source = openDatabase(sourcePath, true);
  const target = openDatabase(targetPath, true);
  const sourceAudit = audit(source, "source-verify");
  const targetAudit = audit(target, "target-verify");
  for (const table of ["members", "tasks", "task_assignments", "task_checklist_items", "task_templates"]) {
    if (targetAudit.counts[table].deleted !== 0) throw new Error(`正式库仍存在 ${table} 的 deleted_at 记录`);
  }
  if (!fs.existsSync(reportPath)) throw new Error(`缺少导入报告：${reportPath}`);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const output = { source: sourceAudit, target: targetAudit, report_source_sha256: report.source_sha256, target_sha256: fileSha256(targetPath) };
  console.log(JSON.stringify(output, null, 2));
  source.close();
  target.close();
}

if (hasArg("--prepare-candidate")) prepareCandidate();
else if (hasArg("--verify")) verify();
else throw new Error("请指定 --prepare-candidate 或 --verify");
