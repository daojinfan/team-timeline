import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const index = readFileSync("public/index.html", "utf8");
const app = readFileSync("public/app.js", "utf8");

test("V5 execution smart range exposes adjustable look-back and look-ahead controls", () => {
  assert.match(index, /id="v5ExecutionSmartRangeControls"[^>]*aria-label="智能时间范围设置"/);
  assert.match(index, /id="v5ExecutionSmartPastDays"[^>]*type="range"[^>]*min="0"[^>]*max="90"[^>]*value="14"/);
  assert.match(index, /id="v5ExecutionSmartFutureDays"[^>]*type="range"[^>]*min="0"[^>]*max="180"[^>]*value="45"/);
  assert.match(index, /id="v5ExecutionSmartPastDaysValue"[^>]*>14 天</);
  assert.match(index, /id="v5ExecutionSmartFutureDaysValue"[^>]*>45 天</);
  assert.match(index, /id="v5ExecutionSaveSmartRange"[^>]*>保存为默认</);
  assert.match(index, /id="v5ExecutionResetSmartRange"[^>]*>恢复建议值</);
  assert.match(index, /id="v5ExecutionSmartRangeMessage"[^>]*role="status"/);
});

test("V5 smart range preferences are versioned, bounded, and preserve status defaults", () => {
  assert.match(app, /V5_SMART_RANGE_DEFAULTS = \{ pastDays: 14, futureDays: 45 \}/);
  assert.match(app, /V5_SMART_RANGE_LIMITS = \{ pastDays: \{ min: 0, max: 90 \}, futureDays: \{ min: 0, max: 180 \} \}/);
  assert.match(app, /executionSmartPastDays/);
  assert.match(app, /executionSmartFutureDays/);
  assert.match(app, /v5NormaliseSmartRangeDays\(value, key\)/);
  assert.match(app, /const current = v5State\.preferences \|\| v5ReadPreferences\(\);[\s\S]*const next = reset \? \{ \.\.\.current, \.\.\.v5DefaultStatusPreferences\(\) \}/);
  assert.match(app, /function v5SaveSmartRangePreferences\(\)/);
  assert.match(app, /v5WritePreferences\(next\)/);
});

test("V5 smart range uses the configured anchor window and nearest-task fallback", () => {
  const buildRange = app.match(/function v5ExecutionBuildRange\(tasks\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(buildRange, "smart range builder should exist");
  assert.match(buildRange, /execution\.range === "smart"/);
  assert.match(buildRange, /v5ExecutionSmartDays\("pastDays"\)/);
  assert.match(buildRange, /v5ExecutionSmartDays\("futureDays"\)/);
  assert.match(buildRange, /const relevant = dated\.filter/);
  assert.match(buildRange, /if \(!relevant\.length\)/);
  assert.match(buildRange, /const nearest = dated\.slice\(\)\.sort/);
  assert.match(buildRange, /execution\.range === "all"/);
  assert.match(buildRange, /execution\.range === "week"/);
  assert.match(buildRange, /execution\.range === "month"/);
});

test("V5 smart range controls update immediately and reload from saved preferences", () => {
  assert.match(app, /v5ExecutionSmartPastDays.*addEventListener\("input"/);
  assert.match(app, /v5ExecutionSmartFutureDays.*addEventListener\("input"/);
  assert.match(app, /v5ExecutionSaveSmartRange.*addEventListener\("click"/);
  assert.match(app, /v5ExecutionResetSmartRange.*addEventListener\("click"/);
  assert.match(app, /v5ApplySmartRangePreferences\(\);[\s\S]*await v5LoadAll\(\);/);
  assert.match(app, /v5ApplyConfiguredDefaultFilters\(\);[\s\S]*v5ApplySmartRangePreferences\(\);/);
  assert.match(app, /v5State\.execution\.range === "smart"\) v5RenderExecutionGantt/);
});
