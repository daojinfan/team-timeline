import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(import.meta.dirname, "..");
const dbPath = path.join(root, "data", "team_tasks.sqlite");
const backupDir = path.join(root, "data", "backups");
const backupPath = path.join(backupDir, "team_tasks.sqlite.pre-web-reconcile-20260822-01.sqlite");
const snapshotPath = path.join(backupDir, "web-reconcile-before-20260822-01.json");
const rehearsalPath = path.join(backupDir, "team_tasks.sqlite.rollback-rehearsal-20260822-01.sqlite");
const sourceGroupId = 1;
const sourceGroupName = "工艺组";
const actor = "web-data-reconcile-20260822-01";
const selectedTopicIds = [1, 2, 3, 4, 6];
const selectedSampleIds = [1, 4, 5, 7, 8, 9, 10, 11, 13];
const archivedTopicIds = [5, 7, 8, 9, 10];
const archivedSampleIds = [2, 3, 6, 12, 14, 15, 16, 17, 18, 19];

const topics = new Map([
  [1, { name: "应力和翘曲问题", purpose: "祖冲之4.1工艺研发阶段；应力和翘曲问题样品制备与测试。", cryostatId: 19 }],
  [2, { name: "倒焊工艺问题", purpose: "祖冲之4.1工艺研发阶段；倒焊工艺窗口、Spacer 与后道兼容性。", cryostatId: 19 }],
  [3, { name: "读取驻波问题", purpose: "祖冲之4.1工艺研发阶段；读取链路驻波与传输特性验证。", cryostatId: 19 }],
  [4, { name: "CPW工艺片内片间工艺极限和稳定性+RDL孔周缺胶问题", purpose: "祖冲之4.1工艺研发阶段；CPW 工艺极限、稳定性与 RDL 孔周缺胶。", cryostatId: 19 }],
  [6, { name: "低损耗约瑟夫森结工艺开发", purpose: "祖冲之4.1工艺研发阶段；低损耗约瑟夫森结工艺开发。", cryostatId: 2 }],
]);

const commonDescription = "来源于祖冲之4.1待制备样品清单；样品到样后按排期执行测试。";
const commonChecklist = "通用测试成果验收";
const commonAcceptance = "测试项逐项完成；原始数据/报告链接可访问；结论和异常说明完整。";
const item = (position, name) => ({ position, name, acceptance_criteria: "待补充验收要求", is_required: 1, note: "" });

const tasks = [
  {
    imageNo: 1, legacyTaskId: 18, topicId: 1, sampleId: 1,
    title: "z4readout（BGA扇出）样品测试（至少2个）",
    purpose: "验证 BGA 扇出样品的倒焊间距、BGA 通断、Q 值与读取设计性能。",
    testItems: [item(0, "倒焊测试腔间距测试（不改变/改变底座材料影响）"), item(1, "Q值测试"), item(2, "BGA通断验证"), item(3, "读取设计验证")],
    start: "2026-09-04", end: "2026-10-04", cryostatId: 19, cryostatPending: 0,
    status: "planned", primary: 8, members: [8, 11],
    sampleLabel: "z4readout（BGA扇出）样品", model: "z4readout（BGA扇出）样品", initialEta: "2026-09-04", currentEta: "2026-09-04",
    sampleNotes: "图片测试系统：祖4制冷机；样品交付情况：未提供。",
  },
  {
    imageNo: 4, legacyTaskId: 19, topicId: 2, sampleId: 4,
    title: "z4Readout（Wirebonding扇出）（有Spacer）样品测试-Z3规模",
    purpose: "验证 Wirebonding 扇出（有 Spacer）样品的倒焊间距、Q 值与读取设计性能。",
    testItems: [item(0, "倒焊测试腔间距测试"), item(1, "Q值测试"), item(2, "读取设计验证")],
    start: "2026-07-13", end: "2026-07-27", cryostatId: 19, cryostatPending: 0,
    status: "active", primary: 11, members: [11, 8, 16],
    sampleLabel: "z4Readout（Wirebonding扇出）（有Spacer）样品", model: "z4Readout（Wirebonding扇出）（有Spacer）样品", initialEta: "2026-07-13", currentEta: "2026-07-13",
    sampleNotes: "图片测试系统：祖4制冷机；样品交付情况：已全部交付。",
  },
  {
    imageNo: 5, legacyTaskId: 20, topicId: 2, sampleId: 5,
    title: "z4Readout（Wirebonding扇出）（有+无Spacer）样品测试-Z3规模",
    purpose: "验证 Wirebonding 扇出（有/无 Spacer）样品的倒焊间距、Q 值与读取设计性能。",
    testItems: [item(0, "倒焊测试腔间距测试"), item(1, "Q值测试"), item(2, "读取设计验证")],
    start: "2026-07-27", end: "2026-08-10", cryostatId: 19, cryostatPending: 0,
    status: "active", primary: 11, members: [11],
    sampleLabel: "z4Readout（Wirebonding扇出）（有+无Spacer）样品（3批/片）", model: "z4Readout（Wirebonding扇出）（有+无Spacer）样品", initialEta: "2026-07-27", currentEta: "2026-08-24",
    sampleNotes: "图片测试系统：祖4制冷机；样品交付情况：预计延期至 2026-08-17、2026-08-31、2026-09-14；批次 ETA：2026-07-27、2026-08-10、2026-08-24。",
  },
  {
    imageNo: 7, legacyTaskId: 21, topicId: 3, sampleId: 7,
    title: "BGA_test_V4（芯片端UBM Pad尺寸200μm）样品测试",
    purpose: "验证芯片端 UBM Pad 尺寸 200 μm 的读取链路传输特性。",
    testItems: [item(0, "读取链路传输特性")],
    start: "2026-07-30", end: "2026-08-15", cryostatId: null, cryostatPending: 1,
    status: "planned", primary: 8, members: [8],
    sampleLabel: "BGA_test_V4（芯片端UBM Pad尺寸200μm）样品", model: "BGA_test_V4（芯片端UBM Pad尺寸200μm）样品", initialEta: "2026-07-30", currentEta: "2026-07-30",
    sampleNotes: "图片测试系统：牛津号；样品交付情况：预计延期至 2026-08-31；图片制冷机未在当前配置中匹配，待确认。",
  },
  {
    imageNo: 8, legacyTaskId: 22, topicId: 4, sampleId: 8,
    title: "底片Q值测试片（测试腔+读取腔设计）样品测试（12个）",
    purpose: "评估测试腔+读取腔设计的 Q 值。",
    testItems: [item(0, "Q值测试")],
    start: "2026-07-22", end: "2026-08-22", cryostatId: null, cryostatPending: 1,
    status: "active", primary: 12, members: [12, 11],
    sampleLabel: "底片Q值测试片（测试腔+读取腔设计）样品", model: "底片Q值测试片（测试腔+读取腔设计）样品", initialEta: "2026-07-22", currentEta: "2026-07-22",
    sampleNotes: "图片测试系统：南京号；样品交付情况：已交付5片，2个在济南号制冷机测试，3个在重庆号测试，后续交付计划根据测试结果决定；图片制冷机待确认。",
  },
  {
    imageNo: 9, legacyTaskId: 23, topicId: 4, sampleId: 9,
    title: "z4readout（Wirebonding扇出）样品测试（1个）-Z3规模",
    purpose: "验证 Wirebonding 扇出样品的 Q 值表现。",
    testItems: [item(0, "Q值测试")],
    start: "2026-09-08", end: "2026-09-17", cryostatId: null, cryostatPending: 1,
    status: "planned", primary: 11, members: [11, 8],
    sampleLabel: "z4readout（Wirebonding扇出）样品", model: "z4readout（Wirebonding扇出）样品", initialEta: "2026-09-08", currentEta: "2026-09-08",
    sampleNotes: "图片测试系统：长沙号；样品交付情况：未提供；图片制冷机未在当前配置中匹配，待确认。",
  },
  {
    imageNo: 10, legacyTaskId: 25, topicId: 4, sampleId: 10,
    title: "z4readout（Wirebonding扇出）样品测试（至少2个）-Z3规模",
    purpose: "验证 Wirebonding 扇出样品的倒焊间距、Q 值与读取设计性能。",
    testItems: [item(0, "倒焊测试腔间距测试"), item(1, "Q值测试"), item(2, "读取设计验证")],
    start: "2026-11-10", end: "2026-11-30", cryostatId: null, cryostatPending: 1,
    status: "planned", primary: 11, members: [11, 8],
    sampleLabel: "z4readout（Wirebonding扇出）样品", model: "z4readout（Wirebonding扇出）样品", initialEta: "2026-11-10", currentEta: "2026-11-10",
    sampleNotes: "图片测试系统：长沙号；样品交付情况：未提供；原表结束日期写为 2026/11/31，11 月无 31 日，Web 日期按 2026-11-30 录入；图片制冷机待确认。",
  },
  {
    imageNo: 11, legacyTaskId: 26, topicId: 4, sampleId: 11,
    title: "z4readout（BGA扇出）样品测试（至少1个）",
    purpose: "验证 BGA 扇出样品的倒焊间距、BGA 通断、Q 值与读取设计性能。",
    testItems: [item(0, "倒焊测试腔间距测试"), item(1, "Q值测试"), item(2, "BGA通断验证"), item(3, "读取设计验证")],
    start: "2026-11-10", end: "2026-12-19", cryostatId: 19, cryostatPending: 0,
    status: "planned", primary: 8, members: [8, 11],
    sampleLabel: "z4readout（BGA扇出）样品", model: "z4readout（BGA扇出）样品", initialEta: "2026-11-10", currentEta: "2026-11-10",
    sampleNotes: "图片测试系统：祖4制冷机；样品交付情况：未提供。",
  },
  {
    imageNo: 13, legacyTaskId: 24, topicId: 6, sampleId: 13,
    title: "P12平面样品测试（至少4个）",
    purpose: "完成 P12 平面样品的比特基础性能标定。",
    testItems: [item(0, "比特样品基础性能标定")],
    start: "2026-07-18", end: "2026-09-15", cryostatId: 2, cryostatPending: 0,
    status: "archived", primary: 18, members: [18],
    sampleLabel: "P12平面样品（4批/片）", model: "P12平面样品", initialEta: "2026-07-18", currentEta: "2026-09-01",
    sampleNotes: "图片测试系统：合肥号；样品交付情况：2026-07-18已交付一片，2026-08-01已交付，2026-08-15已交付，2026-09-01按计划；图片与 Web 制冷机均匹配为合肥号。",
  },
];

const selectedTaskIds = tasks.map((row) => row.legacyTaskId).sort((a, b) => a - b);

function json(value) { return JSON.stringify(value, Object.keys(value ?? {}).sort()); }
function isoNow() { return new Date().toISOString(); }
async function fileSha256(filePath) { return createHash("sha256").update(await readFile(filePath)).digest("hex"); }
function rows(db, sql, ...params) { return db.prepare(sql).all(...params); }
function one(db, sql, ...params) { return db.prepare(sql).get(...params); }
function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

function otherGroupFacts(db) {
  return {
    sourceGroups: rows(db, "SELECT * FROM v2_source_groups ORDER BY id"),
    cryostats: rows(db, "SELECT * FROM v2_cryostats ORDER BY id"),
    topics: rows(db, "SELECT * FROM v3_topics WHERE source_group_id<>? ORDER BY id", sourceGroupId),
    samples: rows(db, "SELECT s.* FROM v3_samples s JOIN v3_topics t ON t.id=s.topic_id WHERE t.source_group_id<>? ORDER BY s.id", sourceGroupId),
    topicTasks: rows(db, "SELECT tt.* FROM v3_topic_tasks tt JOIN v3_topics t ON t.id=tt.topic_id WHERE t.source_group_id<>? ORDER BY tt.id", sourceGroupId),
    taskSamples: rows(db, "SELECT ts.* FROM v3_task_samples ts JOIN v3_topic_tasks tt ON tt.id=ts.topic_task_id JOIN v3_topics t ON t.id=tt.topic_id WHERE t.source_group_id<>? ORDER BY ts.topic_task_id,ts.sample_id", sourceGroupId),
    efforts: rows(db, "SELECT e.* FROM v3_task_member_efforts e JOIN v3_topic_tasks tt ON tt.id=e.topic_task_id JOIN v3_topics t ON t.id=tt.topic_id WHERE t.source_group_id<>? ORDER BY e.topic_task_id,e.member_id", sourceGroupId),
  };
}

function buildBeforeSnapshot(db) {
  const integrity = one(db, "PRAGMA integrity_check").integrity_check;
  const counts = {};
  for (const table of ["v3_topics", "v3_samples", "v3_topic_tasks", "v3_task_samples", "v3_task_member_efforts", "v3_deliverable_submissions"]) {
    counts[table] = one(db, `SELECT COUNT(*) AS count FROM ${table}`).count;
  }
  const other = otherGroupFacts(db);
  return {
    schema_version: 1,
    created_at: isoNow(),
    database_sha256: null,
    source_group_id: sourceGroupId,
    source_group_name: sourceGroupName,
    integrity,
    counts,
    selected_topic_ids_before: rows(db, "SELECT id FROM v3_topics WHERE source_group_id=? AND archived_at IS NULL ORDER BY id", sourceGroupId).map((r) => r.id),
    selected_sample_ids_before: rows(db, "SELECT s.id FROM v3_samples s JOIN v3_topics t ON t.id=s.topic_id WHERE t.source_group_id=? AND s.archived_at IS NULL ORDER BY s.id", sourceGroupId).map((r) => r.id),
    selected_v3_task_ids_before: rows(db, "SELECT tt.id FROM v3_topic_tasks tt JOIN v3_topics t ON t.id=tt.topic_id WHERE t.source_group_id=? ORDER BY tt.id", sourceGroupId).map((r) => r.id),
    selected_canonical_task_ids_before: rows(db, "SELECT DISTINCT tt.task_id FROM v3_topic_tasks tt JOIN v3_topics t ON t.id=tt.topic_id WHERE t.source_group_id=? AND tt.task_id IS NOT NULL ORDER BY tt.task_id", sourceGroupId).map((r) => r.task_id),
    other_group_facts: other,
    other_group_digest: digest(other),
  };
}

async function ensureBackupAndSnapshot() {
  await mkdir(backupDir, { recursive: true });
  if (existsSync(backupPath) || existsSync(snapshotPath)) throw new Error("执行前备份或快照已存在，拒绝重复写入；如需重做请先由项目经理确认回滚范围。");
  await copyFile(dbPath, backupPath);
  const beforeHash = await fileSha256(dbPath);
  const backupHash = await fileSha256(backupPath);
  if (beforeHash !== backupHash) throw new Error("SQLite 执行前备份哈希不一致。");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA foreign_keys=ON");
    const snapshot = buildBeforeSnapshot(db);
    snapshot.database_sha256 = beforeHash;
    await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
    return snapshot;
  } finally { db.close(); }
}

function archiveTopic(db, topicId, stamp) {
  const topic = one(db, "SELECT id,name FROM v3_topics WHERE id=? AND source_group_id=?", topicId, sourceGroupId);
  if (!topic) throw new Error(`找不到工艺组专题 ${topicId}`);
  db.prepare("UPDATE v3_topics SET archived_at=?,version=version+1,updated_at=? WHERE id=?").run(stamp, stamp, topicId);
  db.prepare("INSERT INTO v3_topic_events(topic_id,event_type,actor,after_json,created_at) VALUES(?,?,?,?,?)").run(topicId, "data_reconcile_archive", actor, JSON.stringify({ reason: "not_in_approved_excel_scope", name: topic.name }), stamp);
}

function archiveSample(db, sampleId, stamp) {
  const sample = one(db, "SELECT id,topic_id,planning_label FROM v3_samples WHERE id=? AND topic_id IN (SELECT id FROM v3_topics WHERE source_group_id=?)", sampleId, sourceGroupId);
  if (!sample) throw new Error(`找不到工艺组样品 ${sampleId}`);
  db.prepare("UPDATE v3_samples SET archived_at=?,version=version+1,updated_at=? WHERE id=?").run(stamp, stamp, sampleId);
  db.prepare("INSERT INTO v3_topic_events(topic_id,sample_id,event_type,actor,after_json,created_at) VALUES(?,?,?,?,?,?)").run(sample.topic_id, sampleId, "data_reconcile_archive", actor, JSON.stringify({ reason: "not_in_approved_excel_scope", planning_label: sample.planning_label }), stamp);
}

function syncAssignments(db, row, stamp) {
  const members = [...new Set(row.members)];
  const marks = members.length ? members.map(() => "?").join(",") : "NULL";
  db.prepare(`UPDATE task_assignments SET deleted_at=?,updated_at=? WHERE task_id=? AND deleted_at IS NULL AND member_id NOT IN (${marks})`).run(stamp, stamp, row.legacyTaskId, ...members);
  const assignment = db.prepare("SELECT id FROM task_assignments WHERE task_id=? AND member_id=? ORDER BY id DESC LIMIT 1");
  const update = db.prepare("UPDATE task_assignments SET start_date=?,end_date=?,deleted_at=NULL,updated_at=? WHERE id=?");
  const insert = db.prepare("INSERT INTO task_assignments(task_id,member_id,start_date,end_date,progress,note,created_at,updated_at) VALUES(?,?,?,?,0,'',?,?)");
  for (const memberId of members) {
    const existing = assignment.get(row.legacyTaskId, memberId);
    if (existing) update.run(row.start, row.end, stamp, existing.id);
    else insert.run(row.legacyTaskId, memberId, row.start, row.end, stamp, stamp);
  }
}

function applyData(db, stamp) {
  db.exec("PRAGMA foreign_keys=ON");
  const pendingSubmissionCount = one(db, "SELECT COUNT(*) AS count FROM v3_deliverable_submissions WHERE topic_task_id IN (SELECT tt.id FROM v3_topic_tasks tt JOIN v3_topics t ON t.id=tt.topic_id WHERE t.source_group_id=?)", sourceGroupId).count;
  if (pendingSubmissionCount) throw new Error(`工艺组已有 ${pendingSubmissionCount} 条成果提交，拒绝重建任务关系以避免丢失验收链。`);
  const group = one(db, "SELECT id,name FROM v2_source_groups WHERE id=?", sourceGroupId);
  if (!group || group.name !== sourceGroupName) throw new Error("来源小组 ID 1 不是工艺组，拒绝执行。");
  for (const id of archivedTopicIds) archiveTopic(db, id, stamp);
  for (const id of selectedTopicIds) {
    const topic = topics.get(id);
    db.prepare("UPDATE v3_topics SET name=?,purpose=?,default_cryostat_id=?,archived_at=NULL,version=version+1,updated_at=? WHERE id=? AND source_group_id=?").run(topic.name, topic.purpose, topic.cryostatId, stamp, id, sourceGroupId);
  }
  for (const id of archivedSampleIds) archiveSample(db, id, stamp);
  for (const row of tasks) {
    db.prepare("UPDATE v3_samples SET planning_label=?,model=?,initial_eta_date=?,current_eta_date=?,eta_pending=0,notes=?,archived_at=NULL,version=version+1,updated_at=? WHERE id=? AND topic_id IN (SELECT id FROM v3_topics WHERE source_group_id=?)").run(row.sampleLabel, row.model, row.initialEta, row.currentEta, row.sampleNotes, stamp, row.sampleId, sourceGroupId);
  }

  const oldV3Rows = rows(db, "SELECT tt.id,tt.task_id FROM v3_topic_tasks tt JOIN v3_topics t ON t.id=tt.topic_id WHERE t.source_group_id=?", sourceGroupId);
  const oldCanonicalIds = oldV3Rows.map((r) => r.task_id).filter((id) => id != null && !selectedTaskIds.includes(id));
  for (const taskId of oldCanonicalIds) db.prepare("UPDATE tasks SET deleted_at=COALESCE(deleted_at,?),updated_at=? WHERE id=?").run(stamp, stamp, taskId);
  db.prepare("DELETE FROM v3_topic_tasks WHERE topic_id IN (SELECT id FROM v3_topics WHERE source_group_id=?)").run(sourceGroupId);

  for (const row of tasks) {
    db.prepare("UPDATE tasks SET title=?,description=?,default_start_date=?,default_end_date=?,status=?,deleted_at=NULL,updated_at=? WHERE id=?").run(row.title, commonDescription, row.start, row.end, row.status, stamp, row.legacyTaskId);
    syncAssignments(db, row, stamp);
    const topicTask = db.prepare(`INSERT INTO v3_topic_tasks(topic_id,task_id,task_lineage_key,title,description,test_purpose,test_items_json,position,is_required,primary_member_id,cryostat_id,cryostat_pending,start_date,end_date,after_arrival,status_source,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.topicId, row.legacyTaskId, `web-excel-20260822-${String(row.legacyTaskId).padStart(2, "0")}`, row.title, commonDescription, row.purpose, JSON.stringify(row.testItems), tasks.filter((candidate) => candidate.topicId === row.topicId && candidate.legacyTaskId < row.legacyTaskId).length, 1, row.primary, row.cryostatId, row.cryostatPending, row.start, row.end, 1, "manual", 1, stamp, stamp);
    const topicTaskId = Number(topicTask.lastInsertRowid);
    db.prepare("INSERT INTO v3_task_samples(topic_task_id,sample_id,created_at) VALUES(?,?,?)").run(topicTaskId, row.sampleId, stamp);
    for (const memberId of row.members) db.prepare("INSERT INTO v3_task_member_efforts(topic_task_id,member_id,planned_half_hours,created_at,updated_at) VALUES(?,?,?,?,?)").run(topicTaskId, memberId, 0, stamp, stamp);
    db.prepare("INSERT INTO v3_topic_events(topic_id,topic_task_id,sample_id,event_type,actor,after_json,created_at) VALUES(?,?,?,?,?,?,?)").run(row.topicId, topicTaskId, row.sampleId, "data_reconcile_task", actor, JSON.stringify({ source: "专题任务Web字段整理表.xlsx", image_no: row.imageNo, legacy_task_id: row.legacyTaskId, title: row.title }), stamp);
  }
}

async function apply() {
  if (!existsSync(dbPath)) throw new Error(`数据库不存在：${dbPath}`);
  const snapshot = await ensureBackupAndSnapshot();
  const db = new DatabaseSync(dbPath);
  const stamp = isoNow();
  try {
    db.exec("BEGIN IMMEDIATE");
    applyData(db, stamp);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally { db.close(); }
  const result = await verify();
  console.log(JSON.stringify({ mode: "apply", backup: backupPath, snapshot: snapshotPath, before_counts: snapshot.counts, result }, null, 2));
}

function expectedBeforeSnapshot() {
  if (!existsSync(snapshotPath)) throw new Error(`缺少执行前快照：${snapshotPath}`);
  return JSON.parse(readFileSync(snapshotPath, "utf8"));
}

async function verify() {
  if (!existsSync(backupPath)) throw new Error(`缺少执行前 SQLite 备份：${backupPath}`);
  const before = expectedBeforeSnapshot();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec("PRAGMA foreign_keys=ON");
    const integrity = one(db, "PRAGMA integrity_check").integrity_check;
    if (integrity !== "ok") throw new Error(`SQLite integrity_check=${integrity}`);
    const activeTopics = rows(db, "SELECT id FROM v3_topics WHERE source_group_id=? AND archived_at IS NULL ORDER BY id", sourceGroupId).map((r) => r.id);
    const activeSamples = rows(db, "SELECT s.id FROM v3_samples s JOIN v3_topics t ON t.id=s.topic_id WHERE t.source_group_id=? AND t.archived_at IS NULL AND s.archived_at IS NULL ORDER BY s.id", sourceGroupId).map((r) => r.id);
    const v3TaskIds = rows(db, "SELECT tt.task_id FROM v3_topic_tasks tt JOIN v3_topics t ON t.id=tt.topic_id WHERE t.source_group_id=? ORDER BY tt.task_id", sourceGroupId).map((r) => r.task_id);
    if (JSON.stringify(activeTopics) !== JSON.stringify(selectedTopicIds)) throw new Error(`保留专题不匹配：${JSON.stringify(activeTopics)}`);
    if (JSON.stringify(activeSamples) !== JSON.stringify(selectedSampleIds)) throw new Error(`保留样品不匹配：${JSON.stringify(activeSamples)}`);
    if (JSON.stringify(v3TaskIds) !== JSON.stringify(selectedTaskIds)) throw new Error(`保留任务不匹配：${JSON.stringify(v3TaskIds)}`);
    for (const expected of tasks) {
      const actual = one(db, "SELECT tt.title,tt.description,tt.test_purpose,tt.test_items_json,tt.cryostat_id,tt.cryostat_pending,tt.start_date,tt.end_date,tt.primary_member_id,tt.task_id FROM v3_topic_tasks tt JOIN v3_topics t ON t.id=tt.topic_id WHERE t.source_group_id=? AND tt.task_id=?", sourceGroupId, expected.legacyTaskId);
      if (!actual || actual.title !== expected.title || actual.description !== commonDescription || actual.test_purpose !== expected.purpose || actual.cryostat_id !== expected.cryostatId || actual.cryostat_pending !== expected.cryostatPending || actual.start_date !== expected.start || actual.end_date !== expected.end || actual.primary_member_id !== expected.primary || JSON.stringify(JSON.parse(actual.test_items_json)) !== JSON.stringify(expected.testItems)) {
        throw new Error(`任务 ${expected.legacyTaskId} 的结构化字段与批准表不一致。`);
      }
    }
    const archivedTopics = rows(db, `SELECT id FROM v3_topics WHERE source_group_id=? AND id IN (${archivedTopicIds.map(() => "?").join(",")}) AND archived_at IS NOT NULL ORDER BY id`, sourceGroupId, ...archivedTopicIds).map((r) => r.id);
    const archivedSamples = rows(db, `SELECT id FROM v3_samples WHERE id IN (${archivedSampleIds.map(() => "?").join(",")}) AND archived_at IS NOT NULL ORDER BY id`, ...archivedSampleIds).map((r) => r.id);
    if (JSON.stringify(archivedTopics) !== JSON.stringify(archivedTopicIds)) throw new Error("多余专题未完整归档。");
    if (JSON.stringify(archivedSamples) !== JSON.stringify(archivedSampleIds)) throw new Error("多余样品未完整归档。");
    const orphanSamples = one(db, "SELECT COUNT(*) AS count FROM v3_task_samples ts LEFT JOIN v3_topic_tasks tt ON tt.id=ts.topic_task_id LEFT JOIN v3_samples s ON s.id=ts.sample_id WHERE tt.id IS NULL OR s.id IS NULL").count;
    const orphanEfforts = one(db, "SELECT COUNT(*) AS count FROM v3_task_member_efforts e LEFT JOIN v3_topic_tasks tt ON tt.id=e.topic_task_id LEFT JOIN members m ON m.id=e.member_id WHERE tt.id IS NULL OR m.id IS NULL").count;
    const orphanDeps = one(db, "SELECT COUNT(*) AS count FROM v3_task_dependencies d LEFT JOIN v3_topic_tasks p ON p.id=d.predecessor_task_id LEFT JOIN v3_topic_tasks s ON s.id=d.successor_task_id WHERE p.id IS NULL OR s.id IS NULL").count;
    if (orphanSamples || orphanEfforts || orphanDeps) throw new Error(`V3 孤儿关系：samples=${orphanSamples}, efforts=${orphanEfforts}, deps=${orphanDeps}`);
    const mismatchedSamples = one(db, "SELECT COUNT(*) AS count FROM v3_task_samples ts JOIN v3_topic_tasks tt ON tt.id=ts.topic_task_id JOIN v3_samples s ON s.id=ts.sample_id JOIN v3_topics t1 ON t1.id=tt.topic_id JOIN v3_topics t2 ON t2.id=s.topic_id WHERE t1.id<>t2.id").count;
    if (mismatchedSamples) throw new Error(`任务样品跨专题关系异常：${mismatchedSamples}`);
    const selectedDeleted = one(db, `SELECT COUNT(*) AS count FROM tasks WHERE id IN (${selectedTaskIds.map(() => "?").join(",")}) AND deleted_at IS NOT NULL`, ...selectedTaskIds).count;
    if (selectedDeleted) throw new Error(`保留任务仍处于 deleted_at：${selectedDeleted}`);
    const oldV3StillLinked = one(db, "SELECT COUNT(*) AS count FROM v3_topic_tasks WHERE task_id IN (41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58)").count;
    if (oldV3StillLinked) throw new Error(`旧导入任务仍挂在 V3：${oldV3StillLinked}`);
    const other = otherGroupFacts(db);
    if (digest(other) !== before.other_group_digest) throw new Error("其他来源小组或公共资源数据发生变化。");
    return { integrity, active_topics: activeTopics, active_samples: activeSamples, v3_task_legacy_ids: v3TaskIds, archived_topics: archivedTopics, archived_samples: archivedSamples, orphan_samples: orphanSamples, orphan_efforts: orphanEfforts, orphan_dependencies: orphanDeps, other_source_groups_unchanged: true };
  } finally { db.close(); }
}

async function rehearseRollback() {
  if (!existsSync(backupPath)) throw new Error(`缺少备份：${backupPath}`);
  if (existsSync(rehearsalPath)) throw new Error(`回滚演练文件已存在：${rehearsalPath}`);
  await copyFile(backupPath, rehearsalPath);
  const db = new DatabaseSync(rehearsalPath, { readOnly: true });
  try {
    const integrity = one(db, "PRAGMA integrity_check").integrity_check;
    const counts = {};
    for (const table of ["v3_topics", "v3_samples", "v3_topic_tasks", "v3_task_samples", "v3_task_member_efforts", "v3_deliverable_submissions"]) counts[table] = one(db, `SELECT COUNT(*) AS count FROM ${table}`).count;
    const before = expectedBeforeSnapshot();
    if (integrity !== "ok" || JSON.stringify(counts) !== JSON.stringify(before.counts)) throw new Error("回滚演练快照校验失败。");
    console.log(JSON.stringify({ mode: "rollback-rehearsal", rehearsal: rehearsalPath, integrity, counts }, null, 2));
  } finally { db.close(); }
}

const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--verify") ? "verify" : process.argv.includes("--rollback-rehearsal") ? "rollback-rehearsal" : null;
if (!mode) {
  console.error("用法：node scripts/reconcile-web-data.mjs --apply|--verify|--rollback-rehearsal");
  process.exitCode = 2;
} else {
  try {
    if (mode === "apply") await apply();
    else if (mode === "verify") console.log(JSON.stringify({ mode, result: await verify() }, null, 2));
    else await rehearseRollback();
  } catch (error) {
    console.error(JSON.stringify({ mode, error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  }
}
