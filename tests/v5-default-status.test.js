import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const index = readFileSync("public/index.html", "utf8");
const app = readFileSync("public/app.js", "utf8");

test("V5 resource maintenance exposes independent default status settings", () => {
  for (const id of ["v5DefaultStatusTitle", "v5SaveDefaultStatuses", "v5ResetDefaultStatuses", "v5DefaultStatusMessage"]) assert.match(index, new RegExp(`id="${id}"`));
  assert.match(index, /data-v5-default-status-group="editor"/);
  assert.match(index, /data-v5-default-status-group="execution"/);
  for (const status of ["waiting", "sample-delayed", "testing", "test-delayed", "completed"]) {
    assert.match(index, new RegExp(`data-v5-default-status="editor" value="${status}"`));
    assert.match(index, new RegExp(`data-v5-default-status="execution" value="${status}"`));
  }
});

test("V5 default statuses use versioned local preferences and safe fallback", () => {
  assert.match(app, /teamTaskGantt\.v5Prefs\.v1/);
  assert.match(app, /version: V5_PREFS_VERSION/);
  assert.match(app, /window\.localStorage\.getItem\(V5_PREFS_KEY\)/);
  assert.match(app, /window\.localStorage\.setItem\(V5_PREFS_KEY/);
  assert.match(app, /value\.version !== V5_PREFS_VERSION/);
  assert.match(app, /new Set\(values\)\.size !== values\.length/);
  assert.match(app, /v5State\.filterExpressions\[surface\] = v5DefaultStatusExpression/);
  assert.match(app, /v5SaveDefaultStatusPreferences\(\{ reset: true \}\)/);
});

test("V5 temporary filters do not persist default preferences", () => {
  const quickFilter = app.match(/function v5UpdateQuickFilter\(surface, field\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(quickFilter, "quick filter helper should exist");
  assert.doesNotMatch(quickFilter, /localStorage|v5WritePreferences|v5SaveDefaultStatusPreferences/);
  assert.match(app, /v5State\.preferences = v5ReadPreferences\(\);[\s\S]*v5ApplyConfiguredDefaultFilters\(\);/);
});

test("V5 workspace refresh reapplies configured defaults after temporary filters", () => {
  assert.match(app, /function v5RefreshWorkspace\(\) \{ v5ApplyConfiguredDefaultFilters\(\); await v5LoadAll\(\); \}/);
  assert.match(app, /#v5RefreshBtn.*addEventListener\("click", \(\) => v5RefreshWorkspace\(\)\)/);
  assert.match(app, /function v5ClearFilterQuickInputs\(surface\)/);
  assert.match(app, /v5ClearFilterQuickInputs\(surface\);[\s\S]*v5DefaultStatusExpression/);
});
