import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

test("V5 execution center is a real projection, not the legacy placeholder", () => {
  assert.match(index, /id="v5ExecutionView"/);
  assert.match(index, /id="v5ExecutionGantt"/);
  assert.match(index, /id="v5ExecutionLoad"/);
  assert.match(index, /id="v5ExecutionTaskList"/);
  assert.doesNotMatch(index, /甘特图和成员负载视图将在这里使用任务全量编辑台/);
  assert.match(app, /v5RenderExecution\(\)/);
  assert.match(app, /v5RenderExecutionGantt/);
  assert.match(app, /v5RenderExecutionLoad/);
  assert.match(app, /v5RenderExecutionTaskList/);
});

test("V5 execution center direct save uses an automatic conflict check without manual preview", () => {
  for (const id of ["v5ExecutionSearch", "v5ExecutionSource", "v5ExecutionTopic", "v5ExecutionStatus", "v5ExecutionMember", "v5ExecutionSample", "v5ExecutionCryostat", "v5ExecutionFrom", "v5ExecutionTo", "v5ExecutionScale", "v5ExecutionGranularity", "v5ExecutionGranularityValue", "v5ExecutionRange", "v5ExecutionOnlyBusy", "v5ExecutionStack"]) assert.match(index, new RegExp(`id="${id}"`));
  assert.doesNotMatch(index, /v5SchedulePreviewBtn/);
  assert.doesNotMatch(index, /生成预览/);
  assert.match(index, /id="v5ScheduleSaveBtn"[^>]*>确认保存/);
  assert.match(app, /schedule-preview/);
  assert.match(app, /member-schedule-preview/);
  assert.match(app, /async function v5PreviewSchedule/);
  assert.match(app, /const preview = await v5PreviewSchedule\(\)/);
  assert.match(app, /preview_token: preview\.preview_token/);
  assert.match(app, /expected_version: task\.version/);
  assert.match(app, /window\.confirm/);
});

test("V5 execution center keeps internal gantt scrolling and synchronizes all V5 projections", () => {
  assert.match(styles, /\.v5-execution-gantt-scroll\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(styles, /\.v5-execution-workspace\s*\{[^}]*grid-template-columns:\s*226px/);
  assert.match(index, /id="v5ExecutionSubnav"/);
  assert.match(index, /id="v5ExecutionMemberList"/);
  assert.match(app, /v5SetExecutionSubView/);
  assert.match(app, /v5RenderExecutionMemberList/);
  assert.match(app, /v5LoadAll\(\).*v5RenderExecution/s);
  assert.match(app, /if \(view === "execution"\) v5RenderExecution\(\)/);
  assert.match(app, /v5State\.execution\.selectedTaskId/);
});

test("V5 gantt is grouped by member and preserves unassigned work", () => {
  assert.match(app, /v5ExecutionMemberGanttRows/);
  assert.match(app, /v5ExecutionAssignmentLanes/);
  assert.match(app, /ensure\("unassigned", null\)/);
  assert.match(app, /成员 \/ 任务/);
  assert.match(styles, /\.v5-execution-bar\.member-bar[^}]*background:\s*var\(--task-accent/);
});

test("V5 gantt exposes a continuous granularity control without changing date units", () => {
  assert.match(index, /id="v5ExecutionGranularity"[^>]*type="range"/);
  assert.match(index, /id="v5ExecutionGranularityValue"/);
  assert.match(app, /v5ExecutionGranularityValue/);
  assert.match(app, /v5ExecutionGranularityLabel/);
  assert.match(app, /v5ExecutionUnitWidth\(\)\s*\{[^}]*v5ExecutionGranularityValue/);
  assert.match(app, /#v5ExecutionGranularity"\)\?\.addEventListener\("input"/);
  assert.match(styles, /\.v5-execution-granularity-control[^}]*grid-template-columns/);
});
