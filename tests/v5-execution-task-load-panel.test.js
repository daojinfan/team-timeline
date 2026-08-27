import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

function sourceBetween(start, end) {
  const from = app.indexOf(start);
  const to = app.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing source marker: ${start}`);
  assert.notEqual(to, -1, `missing source marker: ${end}`);
  return app.slice(from, to);
}

test("execution task and load views use one adaptive data workspace", () => {
  assert.match(index, /class="v5-execution-task-list-head"/);
  assert.match(index, /任务 \/ 专题与排期/);
  assert.match(index, /class="v5-execution-card v5-execution-load-card"/);
  assert.match(styles, /--v5-execution-data-height:\s*clamp\(560px,\s*calc\(100dvh - 122px\),\s*760px\)/);
  assert.match(styles, /\.v5-execution-workspace\.is-data-view \.v5-execution-member-sidebar\s*\{[^}]*height:\s*var\(--v5-execution-data-height\)/);
  assert.match(styles, /\.v5-execution-workspace\.is-data-view \.v5-execution-view-panel\.active > \.v5-execution-card\s*\{[^}]*height:\s*var\(--v5-execution-data-height\)/);
  assert.doesNotMatch(styles, /\.v5-execution-task-list\s*\{[^}]*max-height:\s*340px/);
  assert.doesNotMatch(styles, /\.v5-execution-load\s*\{[^}]*max-height:\s*355px/);
});

test("task list has stable columns, two-line titles, and preserved scroll", () => {
  const render = sourceBetween("function v5RenderExecutionTaskList", "function v5SetExecutionMemberSidebarCollapsed");
  assert.match(render, /const scrollTop = node\.scrollTop/);
  assert.match(render, /node\.scrollTop = scrollTop/);
  assert.match(app, /function v5RenderExecution\(\)\s*\{[\s\S]*const taskScrollTop = \$\("#v5ExecutionTaskList"\)\?\.scrollTop[\s\S]*v5RestoreExecutionScroll\("#v5ExecutionTaskList", taskScrollTop\)/);
  assert.match(styles, /\.v5-execution-task-list-head, \.v5-execution-task-list-row\s*\{[^}]*grid-template-columns:/);
  assert.match(styles, /\.v5-execution-task-list-row strong\s*\{[^}]*-webkit-line-clamp:\s*2/);
  assert.match(styles, /\.v5-execution-task-list\s*\{[^}]*flex:\s*1 1 auto[^}]*overflow:\s*auto/);
  assert.match(styles, /\.v5-execution-task-list\s*\{[^}]*overflow-anchor:\s*none/);
});

test("load table keeps statistics and adds a relative visual meter", () => {
  const render = sourceBetween("function v5RenderExecutionLoad", "function v5RenderExecutionStats");
  assert.match(render, /v5ExecutionVisibleMemberRows\(tasks\)/);
  assert.match(render, /Math\.max\(1, \.\.\.rows\.map\(\(row\) => row\.days\)\)/);
  assert.match(render, /负载强度/);
  assert.match(render, /class="v5-execution-load-meter"/);
  assert.match(render, /class="v5-execution-overlap\$\{row\.overlaps \? " is-risk" : ""\}"/);
  assert.match(render, /const scrollTop = node\.scrollTop/);
  assert.match(render, /node\.scrollTop = scrollTop/);
  assert.match(app, /function v5RenderExecution\(\)\s*\{[\s\S]*const loadScrollTop = \$\("#v5ExecutionLoad"\)\?\.scrollTop[\s\S]*v5RestoreExecutionScroll\("#v5ExecutionLoad", loadScrollTop\)/);
  assert.match(styles, /\.v5-execution-load-table th\s*\{[^}]*position:\s*sticky[^}]*top:\s*0/);
  assert.match(styles, /\.v5-execution-load\s*\{[^}]*overflow-anchor:\s*none/);
});

test("narrow data views put content first and expose a member-filter disclosure", () => {
  assert.match(index, /data-v5-exec-toggle-members[^>]*aria-expanded="true"[^>]*aria-controls="v5ExecutionMemberSidebarBody"/);
  assert.match(index, /id="v5ExecutionMemberSidebarBody" class="v5-execution-member-sidebar-body"/);
  assert.match(app, /workspace\?\.classList\.toggle\("is-data-view", next !== "gantt"\)/);
  assert.match(app, /window\.matchMedia\?\.\("\(max-width: 720px\)"\)\.matches/);
  assert.match(app, /data-v5-exec-toggle-members[\s\S]*v5SetExecutionMemberSidebarCollapsed/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.v5-execution-workspace\.is-data-view \.v5-execution-main\s*\{\s*order:\s*1/);
  assert.match(styles, /\.v5-execution-workspace\.is-data-view \.v5-execution-member-sidebar\.is-collapsed \.v5-execution-member-sidebar-body\s*\{\s*display:\s*none/);
  assert.match(styles, /\.v5-execution-sidebar-option input\[type="checkbox"\]\s*\{[^}]*width:\s*16px[^}]*height:\s*16px/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.v5-execution-load\s*\{[^}]*overflow-x:\s*hidden/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.v5-execution-load-table\s*\{[^}]*display:\s*grid/);
});
