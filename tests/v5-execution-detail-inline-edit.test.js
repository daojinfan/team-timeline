import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync("public/app.js", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

function sourceOf(name, nextName) {
  const start = app.indexOf(`function ${name}`);
  const end = nextName ? app.indexOf(`function ${nextName}`, start + 1) : app.length;
  return start >= 0 ? app.slice(start, end > start ? end : app.length) : "";
}

test("V5 execution selection never opens a schedule dialog", () => {
  const taskBar = sourceOf("v5ExecutionTaskBar", "v5ExecutionMemberLanes");
  const events = sourceOf("bindV5ExecutionEvents");
  assert.match(taskBar, /data-v5-exec-select-task="\$\{task\.id\}"/);
  assert.doesNotMatch(taskBar, /data-v5-exec-edit-member|data-v5-exec-edit-task/);
  assert.match(events, /const selected = action\("\[data-v5-exec-select-task\]"\);[\s\S]*?selectedTaskId = Number\(selected\.dataset\.v5ExecSelectTask\); v5RenderExecution\(\); return;/);
  assert.doesNotMatch(events, /v5OpenScheduleEditor/);
});

test("V5 task schedule is edited inline with an explicit sync-all button", () => {
  const render = sourceOf("v5RenderExecutionDetail", "v5ExecutionDetailConflictMarkup");
  const save = sourceOf("v5SaveExecutionTaskSchedule", "v5SaveExecutionMemberSchedule");
  assert.match(render, /data-v5-exec-task-start="\$\{task\.id\}"/);
  assert.match(render, /data-v5-exec-task-end="\$\{task\.id\}"/);
  assert.match(render, /data-v5-exec-sync-members="\$\{task\.id\}" aria-pressed="false"/);
  assert.match(render, /data-v5-exec-save-task-schedule="\$\{task\.id\}"/);
  assert.match(save, /\/schedule-preview`[\s\S]*sync_members: syncMembers/);
  assert.match(save, /\/schedule`[\s\S]*preview_token: preview\.preview_token[\s\S]*expected_version: task\.version/);
  assert.match(save, /data-v5-exec-confirm-task-schedule/);
  assert.doesNotMatch(save, /window\.confirm/);
});

test("V5 member schedules are edited and saved independently in the detail panel", () => {
  const render = sourceOf("v5RenderExecutionDetail", "v5ExecutionDetailConflictMarkup");
  const save = sourceOf("v5SaveExecutionMemberSchedule", "v5RenderExecutionTaskList");
  assert.match(render, /data-v5-exec-member-start="\$\{member\.id\}"/);
  assert.match(render, /data-v5-exec-member-end="\$\{member\.id\}"/);
  assert.match(render, /data-v5-exec-save-member-schedule="\$\{task\.id\}"/);
  assert.match(save, /\/member-schedule-preview`[\s\S]*member_id: member\.id/);
  assert.match(save, /\/member-schedule`[\s\S]*preview_token: preview\.preview_token[\s\S]*expected_version: task\.version/);
  assert.match(save, /data-v5-exec-confirm-member-schedule/);
  assert.doesNotMatch(save, /sync_members|window\.confirm/);
});

test("V5 full edit reuses the task modal without leaving execution center", () => {
  const render = sourceOf("v5RenderExecutionDetail", "v5ExecutionDetailConflictMarkup");
  const eventStart = app.indexOf("function bindV5ExecutionEvents");
  const executionEvents = app.slice(eventStart, app.indexOf("bindV5ExecutionEvents();", eventStart));
  assert.match(render, /data-v5-edit-task="\$\{task\.id\}">全量编辑<\/button>/);
  assert.doesNotMatch(render, /data-v5-open-editor/);
  assert.match(app, /if \(action\("\[data-v5-edit-task\]"\)\) return v5OpenTaskEditor/);
  assert.doesNotMatch(executionEvents, /v5SetView\("editor"\)/);
});

test("V5 inline schedule controls remain compact and responsive", () => {
  assert.match(styles, /\.v5-execution-detail-date-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.v5-execution-detail-date-grid input\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/);
  assert.match(styles, /\.v5-execution-sync-button\[aria-pressed="true"\][^{]*\{[^}]*background:\s*#2563eb/);
  assert.match(styles, /\.v5-execution-detail-feedback\.is-warning\s*\{[^}]*background:\s*#fff7ed/);
});
