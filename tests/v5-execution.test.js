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

test("V5 execution center exposes the approved filters and schedule preview flow", () => {
  for (const id of ["v5ExecutionSearch", "v5ExecutionSource", "v5ExecutionTopic", "v5ExecutionStatus", "v5ExecutionMember", "v5ExecutionSample", "v5ExecutionCryostat", "v5ExecutionFrom", "v5ExecutionTo", "v5ExecutionScale", "v5ExecutionRange", "v5ExecutionOnlyBusy", "v5ExecutionStack"]) assert.match(index, new RegExp(`id="${id}"`));
  assert.match(app, /schedule-preview/);
  assert.match(app, /member-schedule-preview/);
  assert.match(app, /preview_token: schedule\.preview\.preview_token/);
  assert.match(app, /expected_version: task\.version/);
  assert.match(app, /data-v5-schedule-ack/);
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
