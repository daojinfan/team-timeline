import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(path.join(root, "public/app.js"), "utf8");
const styles = readFileSync(path.join(root, "public/styles.css"), "utf8");

test("V5 selected-task summary renders inline editable task attributes", () => {
  assert.match(app, /id="v5InlineTaskForm"/);
  for (const field of ["topic_id", "source_group_id", "cryostat_id", "purpose", "start_date", "end_date", "notes"]) assert.match(app, new RegExp(`name="${field}"`));
  assert.match(app, /v5-inline-member-check/);
  assert.match(app, /data-v5-inline-toggle-members/);
  assert.match(app, /data-v5-inline-member-search/);
  assert.match(app, /v5InlineMemberSummaryMarkup/);
  assert.match(app, /v5RenderInlineMembers/);
  assert.match(app, /v5InlineTestItems/);
  assert.match(app, /data-v5-inline-add-test-item/);
  assert.match(app, /id="v5InlineTaskFormError" role="alert" aria-live="polite"/);
});

test("V5 inline task save uses preview, conflict acknowledgement and expected version", () => {
  assert.match(app, /v5InlineTaskPayload/);
  assert.match(app, /\/api\/v5\/tasks\/\$\{task\.id\}\/preview/);
  assert.match(app, /preview_token: preview\.preview_token/);
  assert.match(app, /ack: Boolean\(preview\.conflicts\?\.length\)/);
  assert.match(app, /expected_version: task\.version/);
  assert.match(app, /v5State\.selectedTaskId = saved\.id; await v5LoadAll\(\)/);
});

test("V5 inline editor keeps samples in the full editor and has compact responsive styles", () => {
  assert.match(app, /样品明细不在摘要区重复编辑/);
  assert.match(app, /data-v5-edit-task/);
  assert.match(styles, /\.v5-inline-task-form/);
  assert.match(styles, /\.v5-inline-member-summary/);
  assert.match(styles, /\.v5-inline-member-picker/);
  assert.match(styles, /\.v5-inline-member-list/);
  assert.match(styles, /\.v5-inline-test-item \{ grid-template-columns/);
  assert.match(styles, /@media \(max-width: 520px\)/);
});

test("V5 task status filter supports an accessible inverse mode", () => {
  const index = readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(index, /id="v5TaskStatusFilter"/);
  assert.match(index, /id="v5TaskStatusNot" type="checkbox"/);
  assert.match(index, /> 非<\/label>/);
  assert.match(app, /const statusNot = Boolean\(\$\("#v5TaskStatusNot"\)\?\.checked\)/);
  assert.match(app, /statusNot \? task\.status !== status : task\.status === status/);
  assert.match(app, /\$\("#v5TaskStatusNot"\)\.checked = false/);
  assert.match(styles, /\.v5-status-filter-control/);
});

test("V5 editor layout keeps filters, task hierarchy, and metadata aligned", () => {
  const index = readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(index, /class="v5-toolbar-primary"/);
  assert.match(index, /class="v5-toolbar-filters"/);
  assert.match(index, /class="v5-toolbar-actions"/);
  assert.match(app, /v5-task-meta v5-task-date/);
  assert.match(app, /v5-task-meta v5-task-cryostat/);
  assert.match(app, /v5-task-meta v5-task-participants/);
  assert.match(styles, /\.v5-task-row \{ display: grid; grid-template-columns:/);
  assert.match(styles, /\.v5-task-cryostat \{ display: none; \}/);
  assert.match(styles, /\.v5-editor-layout \{ display: grid; grid-template-columns:/);
});
