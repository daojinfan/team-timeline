import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { V3_SCHEMA_CHECKSUM } from "../src/v3/index.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(projectRoot, "data", "team_tasks.sqlite");
const sourceDoc = process.env.TOPIC_SOURCE_DOC || "E:\\oneDrive\\桌面\\祖冲之4.1待制备样品清单(1).docx";
const sourceDocSha256 = "767b4798e4bfd977429fd6fffe48325260537b816cbe97718892ce943111a07d";
const sourceDocDisplay = "祖冲之4.1待制备样品清单(1).docx";
const importActor = "本地用户（文档导入）";
const fallbackMemberName = "待分配";
const sourceGroupName = "工艺组";
const requestedCryostatIds = new Set([1, 2, 3, 19, 20, 21]);

const topicDefinitions = new Map([
  [1, { name: "应力和翘曲问题", purpose: "祖冲之4.1工艺研发阶段；应力和翘曲问题样品制备与测试。", defaultCryostatId: 19 }],
  [2, { name: "倒焊工艺问题", purpose: "祖冲之4.1工艺研发阶段；倒焊工艺窗口、Spacer 与后道兼容性。", defaultCryostatId: 19 }],
  [3, { name: "读取驻波问题", purpose: "祖冲之4.1工艺研发阶段；读取链路驻波与传输特性验证。", defaultCryostatId: 19 }],
  [4, { name: "CPW工艺片内片间工艺极限和稳定性+RDL孔周缺胶问题", purpose: "祖冲之4.1工艺研发阶段；CPW 工艺极限、稳定性与 RDL 孔周缺胶。", defaultCryostatId: 19 }],
  [5, { name: "BGA问题", purpose: "祖冲之4.1工艺研发阶段；BGA 小球、封装与通断验证。", defaultCryostatId: 19 }],
  [8, { name: "低损耗约瑟夫森结工艺开发", purpose: "祖冲之4.1工艺研发阶段；低损耗约瑟夫森结工艺开发。", defaultCryostatId: 19 }],
  [9, { name: "NbTa膜Q值问题", purpose: "祖冲之4.1工艺研发阶段；NbTa 膜与顶片/底片高 Q 工艺验证。", defaultCryostatId: 1 }],
  [10, { name: "衬底质控问题", purpose: "祖冲之4.1工艺研发阶段；衬底兼容性与质控验证。", defaultCryostatId: 19 }],
  [11, { name: "生产过程颗粒度控制问题", purpose: "祖冲之4.1工艺研发阶段；生产过程颗粒度与良率监控。", defaultCryostatId: 19 }],
  [12, { name: "Crossover SiO2介质层缺陷问题", purpose: "祖冲之4.1工艺研发阶段；Crossover SiO2 介质层缺陷监控。", defaultCryostatId: 19 }]
]);

// Normalized from the tables in the source DOCX.  The source uses repeated
// dates to record delivery-date changes; those values are deliberately kept.
const samplePlans = [
  { no: 1, topicNo: 1, sampleName: "z4readout（BGA扇出）样品", start: "2026-07-06", task: "z4芯片样品盒基座材料改进效果验证样品制备", prerequisite: "专题4基础baseline工艺开发完成（2026-07-08）；专题5 BGA baseline工艺开发完成（2026-07-05）", layout: "待设计，使用z4顶片+z4底片规模，双端读取倒焊测试腔设计、BGA封装工艺的z4readout样品", quantity: "至少2个chip（2Top+2Bottom），对应2片wafer（1Top+1Bottom）", eta: ["2026-08-21", "2026-08-21"], testQuantity: "2个z4v1规模样品", testContent: "倒焊测试腔间距测试（不改变/改变底座材料影响）、Q值测试；BGA通断验证；读取设计验证" },
  { no: 2, topicNo: 2, sampleName: "BFC（时间相关性）样品", start: "2026-05-01", task: "倒焊时间相关性实验样品制备（无Spacer）", prerequisite: "无", layout: "已完成设计", quantity: "至少50个chip（50Top+50Bottom），对应3片wafer（1Top+2Bottom）", eta: ["2026-05-21", "2026-05-21"], testQuantity: "/", testContent: "/", completedInSource: true },
  { no: 3, topicNo: 2, sampleName: "BFC（Baseline，无Spacer）样品", start: "2026-06-08", task: "倒焊baseline工艺窗口测试（普通In柱、增厚In柱、减薄、非减薄条件，温度压缩量二维谱）", prerequisite: "无", layout: "已完成设计", quantity: "至少36个chip（36Top+36Bottom），对应7片wafer（3Top+4Bottom）", eta: ["2026-06-22", "2026-06-29", "2026-07-06", "2026-07-13"], testQuantity: "/", testContent: "/" },
  { no: 4, topicNo: 2, sampleName: "z4Readout（Wirebonding扇出）（有Spacer）样品", start: "2026-06-15", task: "倒焊间距指标（10~14μm）验证（至少测量三块减薄样品）", prerequisite: "无", layout: "已完成设计", quantity: "至少3个chip（3Top+3Bottom），对应2片wafer（1Top+1Bottom）", eta: ["2026-06-26", "2026-07-10"], testQuantity: "3个z3规模样品（已测1块）", testContent: "倒焊测试腔间距测试、Q值测试；读取设计验证" },
  { no: 5, topicNo: 2, sampleName: "z4Readout（Wirebonding扇出）（有+无Spacer）样品", start: "2026-05-31", task: "Spacer结构必要性验证（有+无Spacer对比倒焊效果）", prerequisite: "无", layout: "已完成设计", quantity: "至少3个chip（3Top+3Bottom），对应2片wafer（1Top+1Bottom）", eta: ["2026-07-01", "2026-07-14", "2026-07-28"], testQuantity: "3个z3规模样品", testContent: "倒焊测试腔间距测试、Q值测试；读取设计验证" },
  { no: 6, topicNo: 2, sampleName: "BFC（工艺兼容性）样品", start: "2026-07-15", task: "后道工艺对于倒焊条件的影响（连通）", prerequisite: "无", layout: "已完成设计", quantity: "至少27个chip（27Top+27Bottom），对应5片wafer（2Top+3Bottom）", eta: ["2026-08-01", "2026-08-15", "2026-09-01"], testQuantity: "/", testContent: "/" },
  { no: 7, topicNo: 3, sampleName: "BGA_test_V4（芯片端UBM Pad尺寸200μm）样品", start: "2026-06-15", task: "结合TSV验证新链路设计下无驻波现象的样品样品制备", prerequisite: "专题5 BGA baseline工艺开发完成（2026-07-05）", layout: "设计中", quantity: "至少1个chip，对应1片wafer", eta: ["2026-07-30"], testQuantity: "1", testContent: "读取链路传输特性" },
  { no: 8, topicNo: 4, sampleName: "底片Q值测试片（测试腔+读取腔设计）样品", start: "2026-07-08", task: "结合表面清洗工艺后的底片高Q工艺开发（底片Q值样品制备+低温测试+数据分析）", prerequisite: "无", layout: "待设计，使用常规Q值测试片和读取腔测试片拼版", quantity: "至少12个chip，对应~6片wafer", eta: ["2026-07-22"], testQuantity: "12", testContent: "Q值测试" },
  { no: 9, topicNo: 4, sampleName: "z4readout（Wirebonding扇出）样品", start: "2026-08-08", task: "底片高Q工艺稳定性测试以及考虑前道TSV工艺影响评定测试（样品制备+低温测试+数据分析）", prerequisite: "无", layout: "待设计，在z4readout（绑定线扇出）设计上添加TSV图形", quantity: "至少1个chip（1Bottom），对应1片wafer（1Bottom）", eta: ["2026-09-08"], testQuantity: "1个z3规模样品", testContent: "Q值测试" },
  { no: 10, topicNo: 4, sampleName: "z4readout（Wirebonding扇出）样品", start: "2026-09-22", task: "底片Q值样品样品制备+低温测试+数据分析（后道工艺影响评定）", prerequisite: "无", layout: "待设计，在z4readout（绑定线扇出）设计上添加TSV图形", quantity: "至少2个chip（1Top+2Bottom），对应2片wafer（1Top+1Bottom）", eta: ["2026-11-10", "2026-11-10"], testQuantity: "2个z3规模样品", testContent: "倒焊测试腔间距测试、Q值测试；读取设计验证" },
  { no: 11, topicNo: 4, sampleName: "z4readout（BGA扇出）样品", start: "2026-09-22", task: "底片Q值样品样品制备+低温测试+数据分析（后道工艺影响评定）", prerequisite: "专题5 BGA baseline工艺开发完成（2026-07-05）", layout: "待设计，使用z4顶片+z4底片规模，双端读取倒焊测试腔设计、BGA封装工艺的z4readout样品", quantity: "至少1个chip（1Top+1Bottom），对应~2片wafer（1Top+1Bottom）", eta: ["2026-11-10"], testQuantity: "1个z4v1规模样品", testContent: "倒焊测试腔间距测试、Q值测试；BGA通断验证；读取设计验证" },
  { no: 12, topicNo: 5, sampleName: "Bgapad_test样品", start: "2026-05-22", task: "BGA小球方案可行性研究与测试", prerequisite: "无", layout: "已完成设计", quantity: "至少6个chip，对应1片wafer", eta: ["2026-09-22"], testQuantity: "/", testContent: "/" },
  { no: 13, topicNo: 8, sampleName: "P12平面样品", start: "2026-07-01", task: "表面处理比特性能验证", prerequisite: "无", layout: "已完成设计", quantity: "至少4个chip，对应4片wafer", eta: ["2026-07-18", "2026-08-01", "2026-08-15", "2026-09-01"], testQuantity: "4", testContent: "比特样品基础标定" },
  { no: 14, topicNo: 9, sampleName: "顶片Q值测试片（第一轮）样品", start: "2026-05-10", task: "济南顶片高Q基础工艺开发（第一轮：薄膜生长条件、清洗条件）", prerequisite: "无", layout: "已完成设计", quantity: "至少16个chip，对应~8片wafer", eta: ["2026-05-25"], testQuantity: "16", testContent: "Q值测试", completedInSource: true },
  { no: 15, topicNo: 9, sampleName: "顶片Q值测试片（第二轮）样品", start: "2026-06-17", task: "济南顶片高Q基础工艺重复性验证（第二轮：重复性验证）", prerequisite: "无", layout: "已完成设计", quantity: "至少16个chip，对应~8片wafer", eta: ["2026-07-01"], testQuantity: "16", testContent: "Q值测试" },
  { no: 16, topicNo: 9, sampleName: "顶片Q值测试片（第三轮）样品", start: "2026-07-15", task: "济南顶片高Q基础工艺兼容性验证（第三轮：其他工艺影响）", prerequisite: "无", layout: "已完成设计", quantity: "至少16个chip，对应~8片wafer", eta: ["2026-08-01"], testQuantity: "16", testContent: "Q值测试" },
  { no: 17, topicNo: 10, sampleName: "Z4.0正式片", start: "2026-06-20", task: "基于Topsil衬底的z4.0工艺兼容性测试样品制备", prerequisite: "无", layout: "已完成设计", quantity: "至少1个chip，对应~1片wafer", eta: ["2026-08-05"], testQuantity: "/", testContent: "/" },
  { no: 18, topicNo: 11, sampleName: "Z4.0正式片-图形layer样品", start: "2026-06-08", task: "当前z4工艺各图层缺陷数目统计及对良率影响评定", prerequisite: "无", layout: "已完成设计", quantity: "至少3个chip，对应~3片wafer", eta: ["2026-07-23", "2026-08-10", "2026-08-24"], testQuantity: "/", testContent: "/" },
  { no: 19, topicNo: 12, sampleName: "Crossover_monitor样品", start: "2026-06-08", task: "Crossover良率监控", prerequisite: "无", layout: "已完成设计", quantity: "至少1个chip，对应~1片wafer", eta: ["2026-06-22"], testQuantity: "/", testContent: "/" }
];

function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function isoNow() { return new Date().toISOString(); }
function safeStamp() { return isoNow().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
function json(value) { return JSON.stringify(value); }
function shorten(value, max = 3990) { return value.length <= max ? value : `${value.slice(0, max - 20)}\n[已截断]`; }
function normalizedModel(sampleName) {
  return sampleName.replace(/（样品）$/, "").replace(/\s+/g, " ").trim();
}
function uniqueDates(values) { return [...new Set(values.filter(Boolean))]; }
function latestDate(values) { return [...values].sort().at(-1) || null; }
function cryostatMatch(row) {
  const text = `${row.sampleName} ${row.task} ${row.testContent}`;
  if (/P12/.test(text)) return { id: 2, name: "合肥号", reason: "P12 平面样品按现有设备匹配" };
  if (/z4|Z4|BGA|BFC|倒焊|读取|Wirebonding|UBM|TSV/i.test(text)) return { id: 19, name: "祖4", reason: "z4/BGA/倒焊/读取工艺按现有设备匹配" };
  if (/Q值|高Q|NbTa/i.test(text)) return { id: 1, name: "重庆号", reason: "Q值/高Q/NbTa 测试按现有设备匹配" };
  return { id: 19, name: "祖4", reason: "文档属于祖冲之4.1研发阶段，未识别到更具体设备，采用现有默认匹配" };
}
function sampleNotes(row, cryostat) {
  const status = row.completedInSource ? "文档标记：截至2026-06-16已加工完成（删除线）" : "文档标记：待制备/计划中";
  return [
    `来源文档：${sourceDocDisplay}`,
    `文档序号：${row.no}`,
    `开始制备：${row.start}`,
    `前置条件：${row.prerequisite}`,
    `版图设计需求：${row.layout}`,
    `样品制备数量：${row.quantity}`,
    `测试数量：${row.testQuantity}`,
    `测试内容：${row.testContent}`,
    status,
    `制冷机匹配：${cryostat.name}（${cryostat.reason}）`,
    "负责人：待人工分配"
  ].join("\n");
}
function taskDescription(row, cryostat) {
  return shorten([
    `来源文档：${sourceDocDisplay}（第${row.no}条）`,
    `规划样品：${row.sampleName}`,
    `样品数量：${row.quantity}`,
    `前置条件：${row.prerequisite}`,
    `版图设计需求：${row.layout}`,
    `测试数量：${row.testQuantity}`,
    `测试内容：${row.testContent}`,
    `制冷机：${cryostat.name}（${cryostat.reason}）`,
    "负责人：待人工分配"
  ].join("\n"));
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function queryOne(db, sql, ...params) { return db.prepare(sql).get(...params); }
function queryAll(db, sql, ...params) { return db.prepare(sql).all(...params); }

async function assertServiceStopped() {
  try {
    const response = await fetch("http://localhost:3000/api/v3/status", { signal: AbortSignal.timeout(500) });
    throw new Error(`本地服务仍在运行（HTTP ${response.status}），请先停止服务再导入`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("本地服务仍在运行")) throw error;
  }
}

function verifyDatabase(db, label) {
  db.exec("PRAGMA foreign_keys=ON");
  const quick = queryOne(db, "PRAGMA quick_check")["quick_check"];
  assert(quick === "ok", `${label} quick_check=${quick}`);
  const foreign = queryAll(db, "PRAGMA foreign_key_check");
  assert(foreign.length === 0, `${label} foreign_key_check=${json(foreign)}`);
  const schema = queryOne(db, "SELECT checksum FROM app_schema_versions WHERE version=3 AND name='v3-topic-sample-chain'");
  assert(schema?.checksum === V3_SCHEMA_CHECKSUM, `${label} V3 checksum 不匹配`);
  return { quick_check: quick, foreign_key_errors: foreign.length, v3_checksum: schema.checksum };
}

async function main() {
  assert(fs.existsSync(sourceDoc), `源文档不存在：${sourceDoc}`);
  const actualHash = sha256File(sourceDoc);
  assert(actualHash === sourceDocSha256, `源文档 SHA-256 已变化：${actualHash}`);
  await assertServiceStopped();
  assert(fs.existsSync(dbPath), `目标数据库不存在：${dbPath}`);

  const probe = new DatabaseSync(dbPath, { readOnly: true });
  verifyDatabase(probe, "目标库导入前");
  const marker = queryOne(probe, "SELECT id FROM v3_topic_events WHERE event_type='external_doc_import' AND after_json LIKE ? LIMIT 1", `%${sourceDocSha256}%`);
  if (marker) {
    probe.close();
    console.log(JSON.stringify({ idempotent: true, source_doc_sha256: sourceDocSha256, marker_event_id: marker.id }));
    return;
  }
  const beforeVersions = queryAll(probe, "SELECT version,name,checksum FROM app_schema_versions ORDER BY version");
  const beforeCounts = {
    topics: queryOne(probe, "SELECT COUNT(*) AS c FROM v3_topics WHERE archived_at IS NULL").c,
    samples: queryOne(probe, "SELECT COUNT(*) AS c FROM v3_samples WHERE archived_at IS NULL").c,
    tasks: queryOne(probe, "SELECT COUNT(*) AS c FROM v3_topic_tasks").c,
    members: queryOne(probe, "SELECT COUNT(*) AS c FROM members WHERE deleted_at IS NULL").c,
    cryostats: queryOne(probe, "SELECT COUNT(*) AS c FROM v2_cryostats WHERE status='active'").c
  };
  probe.close();

  const stamp = safeStamp();
  const backupDir = path.join(projectRoot, "data", "backups");
  const stagingDir = path.join(projectRoot, "data", "import-staging");
  fs.mkdirSync(backupDir, { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  const backupPath = path.join(backupDir, `team_tasks.pre-topic-import-${stamp}.sqlite`);
  const candidatePath = path.join(stagingDir, `team_tasks.topic-import-${stamp}.sqlite`);
  const displacedPath = path.join(stagingDir, `team_tasks.before-topic-swap-${stamp}.sqlite`);
  fs.copyFileSync(dbPath, backupPath);
  fs.copyFileSync(dbPath, candidatePath);
  const backupSha256 = sha256File(backupPath);

  const db = new DatabaseSync(candidatePath);
  db.exec("PRAGMA foreign_keys=ON");
  const group = queryOne(db, "SELECT id,name FROM v2_source_groups WHERE name=? AND is_active=1", sourceGroupName);
  assert(group, `来源小组不存在或未启用：${sourceGroupName}`);
  const fallbackMember = queryOne(db, "SELECT id,name FROM members WHERE name=? AND deleted_at IS NULL", fallbackMemberName);
  assert(fallbackMember, `缺少占位成员：${fallbackMemberName}`);
  const cryostats = new Map(queryAll(db, "SELECT id,name,status FROM v2_cryostats WHERE status='active'").map((row) => [row.id, row]));
  for (const id of requestedCryostatIds) assert(cryostats.has(id), `所需制冷机不存在或未启用：${id}`);

  const topicIds = new Map();
  const taskIdsByTopic = new Map();
  const sampleIdsByDocumentNo = new Map();
  const taskGroups = [];
  const taskGroupByKey = new Map();
  for (const row of samplePlans) {
    const key = `${row.topicNo}::${row.task}`;
    let taskGroup = taskGroupByKey.get(key);
    if (!taskGroup) {
      taskGroup = { topicNo: row.topicNo, task: row.task, rows: [] };
      taskGroupByKey.set(key, taskGroup);
      taskGroups.push(taskGroup);
    }
    taskGroup.rows.push(row);
  }
  const imported = { topics: [], samples: [], tasks: [], task_samples: 0, dependencies: 0 };
  const now = isoNow();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [topicNo, definition] of topicDefinitions) {
      const conflicting = queryOne(db, "SELECT id FROM v3_topics WHERE name=? AND archived_at IS NULL", definition.name);
      assert(!conflicting, `已有同名活动专题，拒绝覆盖：${definition.name}（id=${conflicting?.id}）`);
      const topicResult = db.prepare("INSERT INTO v3_topics(source_group_id,source_contact_id,name,purpose,default_cryostat_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(group.id, null, definition.name, definition.purpose, definition.defaultCryostatId, now, now);
      const topicId = Number(topicResult.lastInsertRowid);
      topicIds.set(topicNo, topicId);
      taskIdsByTopic.set(topicNo, []);
      imported.topics.push({ topic_no: topicNo, topic_id: topicId, name: definition.name, default_cryostat_id: definition.defaultCryostatId });
    }

    for (const row of samplePlans) {
      const topicId = topicIds.get(row.topicNo);
      assert(topicId, `未知专题编号：${row.topicNo}`);
      const etaDates = uniqueDates(row.eta);
      const currentEta = latestDate(etaDates);
      assert(row.start && currentEta && row.start <= currentEta, `样品日期范围无效：${row.no}`);
      const cryostat = cryostatMatch(row);
      assert(requestedCryostatIds.has(cryostat.id), `制冷机匹配超出当前资源：${cryostat.id}`);
      const sampleResult = db.prepare("INSERT INTO v3_samples(topic_id,planning_label,model,formal_identifier,temporary_identifier,initial_eta_date,current_eta_date,eta_pending,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(topicId, row.sampleName, normalizedModel(row.sampleName), null, null, etaDates[0], currentEta, 0, sampleNotes(row, cryostat), now, now);
      const sampleId = Number(sampleResult.lastInsertRowid);
      db.prepare("INSERT INTO v3_topic_events(topic_id,sample_id,event_type,actor,after_json,created_at) VALUES(?,?,?,?,?,?)").run(topicId, sampleId, "sample_eta_import", importActor, json({ source_doc: sourceDocDisplay, source_doc_sha256: sourceDocSha256, document_no: row.no, eta_history: row.eta, current_eta_date: currentEta, eta_pending: false, completed_in_source: Boolean(row.completedInSource) }), now);
      imported.samples.push({ document_no: row.no, sample_id: sampleId, topic_no: row.topicNo, topic_id: topicId, planning_label: row.sampleName, eta_history: row.eta, current_eta_date: currentEta, cryostat_id: cryostat.id, cryostat_name: cryostat.name, completed_in_source: Boolean(row.completedInSource) });
      sampleIdsByDocumentNo.set(row.no, sampleId);
    }

    for (const taskGroup of taskGroups) {
      const topicId = topicIds.get(taskGroup.topicNo);
      const rows = taskGroup.rows;
      const first = rows[0];
      const start = [...rows.map((row) => row.start)].sort()[0];
      const currentEta = latestDate(rows.flatMap((row) => uniqueDates(row.eta)));
      const combined = {
        ...first,
        sampleName: rows.map((row) => row.sampleName).join("；"),
        quantity: rows.map((row) => `第${row.no}条：${row.quantity}`).join("；"),
        prerequisite: [...new Set(rows.map((row) => row.prerequisite))].join("；"),
        layout: [...new Set(rows.map((row) => row.layout))].join("；"),
        testQuantity: rows.map((row) => `第${row.no}条：${row.testQuantity}`).join("；"),
        testContent: rows.map((row) => `第${row.no}条：${row.testContent}`).join("；")
      };
      const cryostat = cryostatMatch(combined);
      assert(requestedCryostatIds.has(cryostat.id), `制冷机匹配超出当前资源：${cryostat.id}`);
      const topicTaskIds = taskIdsByTopic.get(taskGroup.topicNo);
      const predecessor = topicTaskIds.at(-1) ?? null;
      const position = topicTaskIds.length;
      const documentNos = rows.map((row) => row.no);
      const lineage = `docx-${sourceDocSha256.slice(0, 16)}-${documentNos.map((no) => String(no).padStart(2, "0")).join("-")}`;
      const description = taskDescription(combined, cryostat);
      const taskStatus = start <= new Date().toISOString().slice(0, 10) ? "active" : "planned";
      const v1Task = db.prepare("INSERT INTO tasks(title,description,default_start_date,default_end_date,color,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(taskGroup.task, description, start, currentEta, "#2563eb", taskStatus, now, now);
      const v1TaskId = Number(v1Task.lastInsertRowid);
      db.prepare("INSERT INTO task_assignments(task_id,member_id,start_date,end_date,progress,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(v1TaskId, fallbackMember.id, start, currentEta, 0, "负责人待人工分配；本次导入仅使用待分配占位成员", now, now);
      const v3Task = db.prepare("INSERT INTO v3_topic_tasks(topic_id,task_id,task_lineage_key,title,description,position,is_required,primary_member_id,cryostat_id,cryostat_pending,start_date,end_date,after_arrival,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(topicId, v1TaskId, lineage, taskGroup.task, description, position, 1, fallbackMember.id, cryostat.id, 0, start, currentEta, 1, now, now);
      const topicTaskId = Number(v3Task.lastInsertRowid);
      for (const row of rows) db.prepare("INSERT INTO v3_task_samples(topic_task_id,sample_id,created_at) VALUES(?,?,?)").run(topicTaskId, sampleIdsByDocumentNo.get(row.no), now);
      db.prepare("INSERT INTO v3_task_member_efforts(topic_task_id,member_id,planned_half_hours,created_at,updated_at) VALUES(?,?,?,?,?)").run(topicTaskId, fallbackMember.id, 0, now, now);
      if (predecessor !== null) db.prepare("INSERT INTO v3_task_dependencies(topic_id,predecessor_task_id,successor_task_id,created_at) VALUES(?,?,?,?)").run(topicId, predecessor, topicTaskId, now);
      db.prepare("INSERT INTO v3_topic_events(topic_id,topic_task_id,event_type,actor,after_json,created_at) VALUES(?,?,?,?,?,?)").run(topicId, topicTaskId, "external_doc_import_task", importActor, json({ source_doc: sourceDocDisplay, source_doc_sha256: sourceDocSha256, document_nos: documentNos, sample_ids: rows.map((row) => sampleIdsByDocumentNo.get(row.no)), v1_task_id: v1TaskId, task_lineage_key: lineage, cryostat_id: cryostat.id, cryostat_name: cryostat.name, cryostat_match_reason: cryostat.reason, primary_member_id: fallbackMember.id, primary_member_name: fallbackMember.name, predecessor_task_id: predecessor }), now);
      topicTaskIds.push(topicTaskId);
      imported.tasks.push({ document_nos: documentNos, topic_no: taskGroup.topicNo, topic_task_id: topicTaskId, v1_task_id: v1TaskId, task_lineage_key: lineage, cryostat_id: cryostat.id, cryostat_name: cryostat.name, primary_member_id: fallbackMember.id, predecessor_task_id: predecessor, sample_count: rows.length });
      imported.task_samples += rows.length;
      if (predecessor !== null) imported.dependencies += 1;
    }

    for (const [topicNo, topicId] of topicIds) {
      db.prepare("INSERT INTO v3_topic_events(topic_id,event_type,actor,after_json,created_at) VALUES(?,?,?,?,?)").run(topicId, "external_doc_import", importActor, json({ source_doc: sourceDocDisplay, source_doc_sha256: sourceDocSha256, topic_no: topicNo, source_group_id: group.id, source_group_name: group.name, sample_count: samplePlans.filter((row) => row.topicNo === topicNo).length }), now);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    throw error;
  }

  const candidateIntegrity = verifyDatabase(db, "候选库");
  const afterVersions = queryAll(db, "SELECT version,name,checksum FROM app_schema_versions ORDER BY version");
  assert(json(beforeVersions) === json(afterVersions), "schema 版本/校验值发生变化");
  const counts = {
    topics: queryOne(db, "SELECT COUNT(*) AS c FROM v3_topics WHERE archived_at IS NULL").c,
    samples: queryOne(db, "SELECT COUNT(*) AS c FROM v3_samples WHERE archived_at IS NULL").c,
    tasks: queryOne(db, "SELECT COUNT(*) AS c FROM v3_topic_tasks").c,
    task_samples: queryOne(db, "SELECT COUNT(*) AS c FROM v3_task_samples").c,
    dependencies: queryOne(db, "SELECT COUNT(*) AS c FROM v3_task_dependencies").c,
    v1_tasks: queryOne(db, "SELECT COUNT(*) AS c FROM tasks WHERE deleted_at IS NULL").c,
    v1_assignments: queryOne(db, "SELECT COUNT(*) AS c FROM task_assignments WHERE deleted_at IS NULL").c
  };
  assert(counts.topics - beforeCounts.topics === 10, `专题增量不符：${json(counts)}`);
  assert(counts.samples - beforeCounts.samples === 19, `样品增量不符：${json(counts)}`);
  assert(counts.tasks - beforeCounts.tasks === 18, `V3任务增量不符：${json(counts)}`);
  assert(counts.task_samples === 19, `任务样品关联不符：${counts.task_samples}`);
  assert(counts.dependencies === 8, `任务链依赖不符：${counts.dependencies}`);
  assert(counts.v1_tasks >= 18 && counts.v1_assignments >= 18, "V1 兼容任务或占位分配未生成");
  db.close();

  fs.renameSync(dbPath, displacedPath);
  try {
    fs.renameSync(candidatePath, dbPath);
  } catch (error) {
    fs.renameSync(displacedPath, dbPath);
    throw error;
  }
  const finalDb = new DatabaseSync(dbPath, { readOnly: true });
  const finalIntegrity = verifyDatabase(finalDb, "目标库导入后");
  const finalCounts = {
    topics: queryOne(finalDb, "SELECT COUNT(*) AS c FROM v3_topics WHERE archived_at IS NULL").c,
    samples: queryOne(finalDb, "SELECT COUNT(*) AS c FROM v3_samples WHERE archived_at IS NULL").c,
    tasks: queryOne(finalDb, "SELECT COUNT(*) AS c FROM v3_topic_tasks").c,
    task_samples: queryOne(finalDb, "SELECT COUNT(*) AS c FROM v3_task_samples").c,
    dependencies: queryOne(finalDb, "SELECT COUNT(*) AS c FROM v3_task_dependencies").c
  };
  finalDb.close();
  const report = {
    task_id: "TASK-084",
    imported_at: now,
    source_doc: sourceDoc,
    source_doc_sha256: sourceDocSha256,
    source_group: { id: group.id, name: group.name },
    fallback_member: { id: fallbackMember.id, name: fallbackMember.name },
    cryostats_used: [...new Set(imported.tasks.map((row) => `${row.cryostat_id}:${row.cryostat_name}`))],
    before_counts: beforeCounts,
    imported_counts: { topics: imported.topics.length, samples: imported.samples.length, tasks: imported.tasks.length, task_samples: imported.task_samples, dependencies: imported.dependencies },
    after_counts: finalCounts,
    backup: { path: backupPath, sha256: backupSha256 },
    displaced_pre_swap_copy: displacedPath,
    candidate_path: candidatePath,
    candidate_integrity: candidateIntegrity,
    final_integrity: finalIntegrity,
    v3_schema_checksum: V3_SCHEMA_CHECKSUM,
    topics: imported.topics,
    samples: imported.samples,
    tasks: imported.tasks,
    idempotency_marker: sourceDocSha256,
    notes: ["样品编号 formal_identifier/temporary_identifier 保持为空。", "任务负责人暂以待分配占位成员建立，未自动指派具体人员。", "专题 6、7 在源文档总述中出现但无样品明细，本次未自动创建。", "Z4.1 未作为制冷机使用；文档中的 4.1 仅作为研发阶段上下文。"]
  };
  const evidenceDir = path.join(projectRoot, "docs", "05-quality", "evidence", "TASK-084");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const reportPath = path.join(evidenceDir, `import-report-${stamp}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ report_path: reportPath, backup_path: backupPath, imported_counts: report.imported_counts, final_counts: finalCounts }));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
