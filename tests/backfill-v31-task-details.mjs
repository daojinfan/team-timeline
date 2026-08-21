import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const databasePath = path.resolve(process.argv[2] || "data/team_tasks.sqlite");
const database = new DatabaseSync(databasePath);
const now = new Date().toISOString();

function ensureColumns() {
  const columns = new Set(database.prepare("PRAGMA table_info(v3_topic_tasks)").all().map((row) => row.name));
  if (!columns.has("test_purpose")) database.exec("ALTER TABLE v3_topic_tasks ADD COLUMN test_purpose TEXT NOT NULL DEFAULT ''");
  if (!columns.has("test_items_json")) database.exec("ALTER TABLE v3_topic_tasks ADD COLUMN test_items_json TEXT NOT NULL DEFAULT '[]'");
}

function testItems(description) {
  const line = String(description || "").split(/\r?\n/).find((value) => value.startsWith("测试内容："));
  if (!line) return [];
  const value = line.slice("测试内容：".length).replace(/第\d+条：/g, "").trim();
  if (!value || value === "/") return [];
  return value.split(/[；;]/).map((name) => name.trim()).filter((name) => name && name !== "/").map((name, position) => ({
    position,
    name,
    acceptance_criteria: "",
    is_required: 1,
    note: "由样品清单测试内容回填，验收要求待补充"
  }));
}

ensureColumns();
const rows = database.prepare("SELECT tt.id,tt.description,tt.test_purpose,tt.test_items_json,tp.purpose AS topic_purpose FROM v3_topic_tasks tt JOIN v3_topics tp ON tp.id=tt.topic_id ORDER BY tt.id").all();
const update = database.prepare("UPDATE v3_topic_tasks SET test_purpose=?,test_items_json=?,updated_at=? WHERE id=?");
const report = [];
let updatedCount = 0;
database.exec("BEGIN IMMEDIATE");
try {
  for (const row of rows) {
    const items = testItems(row.description);
    const purpose = String(row.topic_purpose || "").trim();
    const nextItems = JSON.stringify(items);
    const unchanged = row.test_purpose === purpose && row.test_items_json === nextItems;
    if (!unchanged) { update.run(purpose, nextItems, now, row.id); updatedCount += 1; }
    report.push({ task_id: row.id, test_purpose_source: "topic.purpose", test_item_count: items.length, changed: !unchanged });
  }
  database.exec("COMMIT");
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
}

const bindings = database.prepare("SELECT COUNT(*) AS tasks,COUNT(DISTINCT topic_id) AS topics FROM v3_topic_tasks").get();
const sampleLinks = database.prepare("SELECT COUNT(*) AS links FROM v3_task_samples").get();
const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
const output = {
  database: databasePath,
  migrated_at: now,
  task_count: rows.length,
  binding_counts: { tasks: bindings.tasks, topics: bindings.topics, sample_links: sampleLinks.links },
  test_items_backfilled: report.filter((row) => row.test_item_count > 0).length,
  updated_count: updatedCount,
  no_op_count: rows.length - updatedCount,
  foreign_key_violations: foreignKeys.length,
  tasks: report
};
console.log(JSON.stringify(output, null, 2));
database.close();
