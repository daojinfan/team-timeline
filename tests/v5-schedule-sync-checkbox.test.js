import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = readFileSync(path.join(root, "public/index.html"), "utf8");
const app = readFileSync(path.join(root, "public/app.js"), "utf8");

test("V5 schedule sync checkbox is compact and aligned", () => {
  const field = index.slice(index.indexOf('id="v5ScheduleSyncField"'), index.indexOf('id="v5ScheduleBoundaryHint"'));
  assert.match(field, /class="v5-check-inline"/);
  assert.match(field, /style="justify-self:start"/);
  assert.match(field, /id="v5ScheduleSync" type="checkbox" style="width:14px;height:14px;min-width:14px;min-height:14px;margin:0;padding:0;border:0;background:transparent;accent-color:var\(--accent\);flex:0 0 14px"/);
  assert.match(field, /> 同步所有成员的排期<\/label>/);
});

test("V5 schedule editor hides the all-member sync option for member edits", () => {
  assert.match(app, /const syncField = \$\("#v5ScheduleSyncField"\);/);
  assert.match(app, /syncField\.style\.setProperty\("display", mode === "member" \? "none" : "inline-flex", "important"\)/);
  assert.match(app, /syncField\.hidden = mode === "member"/);
  assert.match(app, /\$\("#v5ScheduleSync"\)\.checked = mode === "task"/);
});

test("V5 schedule sync payload remains task-only and member edits stay isolated", () => {
  assert.match(app, /schedule\.mode === "member" \? \{ member_id: memberId, start_date: start, end_date: end \} : \{ start_date: start, end_date: end, sync_members: \$\("#v5ScheduleSync"\)\.checked \}/);
  assert.match(app, /schedule\.mode === "member" \? \{ member_id: schedule\.memberId, start_date: start, end_date: end, preview_token: preview\.preview_token, expected_version: task\.version, ack \} : \{ start_date: start, end_date: end, sync_members: \$\("#v5ScheduleSync"\)\.checked/);
});
