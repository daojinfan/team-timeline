import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = readFileSync(path.join(root, "public/index.html"), "utf8");
const app = readFileSync(path.join(root, "public/app.js"), "utf8");
const design = readFileSync(path.join(root, "docs/03-architecture/components/current-fixed-cycle-schedule-detailed-design.md"), "utf8");

test("current workspace exposes the fixed-cycle preference", () => {
  assert.match(index, /工作区偏好/);
  assert.match(index, /工作区默认值/);
  assert.match(index, /id="v5FixedCycleMode" type="checkbox" data-v5-fixed-cycle-mode/);
  assert.match(index, /固定周期模式/);
  assert.match(app, /fixedCycleMode: false/);
  assert.match(app, /fixedCycleMode: value\.fixedCycleMode === true/);
  assert.match(app, /fixedCycleMode: Boolean\(\$\("#v5FixedCycleMode"\)\?\.checked\)/);
});

test("fixed-cycle calculation uses inclusive calendar days and both anchors", () => {
  assert.match(app, /function v5FixedCycleDuration\(start, end\)/);
  assert.match(app, /return daysBetween\(start, end\) \+ 1/);
  assert.match(app, /addDays\(input\.value, duration - 1\)/);
  assert.match(app, /addDays\(input\.value, -\(duration - 1\)\)/);
  assert.match(app, /function v5ApplyFixedCycleInput\(input\)/);
  assert.match(app, /if \(!v5IsFixedCycleMode\(\)/);
});

test("all current date-range editors use isolated fixed-cycle containers", () => {
  for (const marker of [
    "id=\"v5TaskStart\" name=\"start_date\" type=\"date\" data-v5-fixed-cycle-start",
    "class=\"v5-inline-schedule-fields full\"><label>计划开始<input name=\"start_date\" type=\"date\" value=\"${escapeHtml(task.start_date || \"\")}\" data-v5-fixed-cycle-start",
    "data-v5-inline-member-row=\"${memberId}\" data-v5-fixed-cycle-container",
    "id=\"v5ScheduleStart\" type=\"date\" data-v5-fixed-cycle-start",
    "data-v5-exec-task-start=\"${task.id}\" data-v5-fixed-cycle-start",
    "data-v5-exec-member-start=\"${member.id}\" data-v5-fixed-cycle-start",
    "data-v5-member-row=\"${memberId}\" data-v5-fixed-cycle-container"
  ]) assert.ok(index.includes(marker) || app.includes(marker), marker);
  assert.match(app, /scheduleFields\.dataset\.v5FixedCycleContainer = "true"/);
  assert.match(app, /\["input", "change"\]\.forEach\(\(eventName\) => document\.body\.addEventListener/);
  assert.match(app, /v5RefreshFixedCycleContainers\(\)/);
});

test("detailed design keeps one current-version implementation boundary", () => {
  assert.match(design, /不按 V2、V3 或其他历史版本拆分功能/);
  assert.match(design, /当前主界面以下入口统一接入该规则/);
  assert.match(design, /不修改数据库结构/);
  assert.match(design, /单个日期字段.*不参与固定周期计算/);
});
