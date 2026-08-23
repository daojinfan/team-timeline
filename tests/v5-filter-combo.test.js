import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

test("V5 editor and execution center expose the shared filter builder", () => {
  for (const id of ["v5OpenEditorFilters", "v5EditorFilterSummary", "v5OpenExecutionFilters", "v5ExecutionFilterSummary", "v5FilterDialog", "v5FilterConditions", "v5FilterAddField", "v5FilterAddCondition", "v5FilterAddGroup", "v5FilterReset"]) {
    assert.match(index, new RegExp(`id="${id}"`));
  }
  assert.match(app, /v5OpenFilterDialog\("editor"\)/);
  assert.match(app, /v5OpenFilterDialog\("execution"\)/);
  assert.match(app, /v5FilterExpressionMatches/);
  assert.match(app, /v5FilterNormaliseExpression/);
  assert.match(app, /v5ResetFilterSurface/);
});

test("V5 filters support per-condition inverse matching and multi-select", () => {
  for (const id of ["v5TaskSearchNot", "v5TaskSourceNot", "v5TaskStatusNot", "v5TaskCryostatNot", "v5ExecutionSearchNot", "v5ExecutionSourceNot", "v5ExecutionTopicNot", "v5ExecutionStatusNot", "v5ExecutionMemberNot", "v5ExecutionSampleNot", "v5ExecutionCryostatNot"]) {
    assert.match(index, new RegExp(`id="${id}"`));
  }
  assert.match(app, /<select multiple size="4"/);
  assert.match(app, /supportsNegate: true/);
  assert.match(app, /condition\.negate \? !matches : matches/);
  assert.match(app, /match === "all"/);
});

test("V5 filter groups make AND\/OR explicit and keep date exceptions", () => {
  assert.match(app, /connector: group\.connector === "or" \? "or" : "and"/);
  assert.match(app, /logic: group\.logic === "or" \? "or" : "and"/);
  assert.match(app, /data-v5-filter-group-connector/);
  assert.match(app, /data-v5-filter-group-logic/);
  assert.match(app, /\{ field: "from", label: "开始日期不晚于", kind: "date", supportsNegate: false \}/);
  assert.match(app, /\{ field: "to", label: "结束日期不早于", kind: "date", supportsNegate: false \}/);
  for (const id of ["v5ExecutionFromNot", "v5ExecutionToNot"]) assert.doesNotMatch(index, new RegExp(`id="${id}"`));
  assert.match(app, /日期不支持非\/多选/);
});

test("V5 filter styling keeps builder groups readable on narrow screens", () => {
  for (const selector of [".v5-filter-dialog", ".v5-filter-group", ".v5-filter-condition", ".v5-filter-group-connector", ".v5-filter-builder-actions"]) {
    assert.match(styles, new RegExp(selector.replace(/[.]/g, "\\.")));
  }
  assert.match(styles, /\.v5-filter-condition-value[^}]*select\[multiple\]/);
  assert.match(styles, /@media \(max-width: 720px\)/);
});
