import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const html = read("public/index.html");
const app = read("public/app.js");
const styles = read("public/styles.css");

test("V5 task editor renders the existing test-item editor node", () => {
  assert.match(html, /id="v5TestItemsEditor"/);
  assert.match(app, /\$\("#v5TestItemsEditor"\)\.innerHTML/);
  assert.doesNotMatch(app, /#v5TaskItemsEditor/);
});

test("V5 task editor protects topic defaults and surfaces nested API errors", () => {
  assert.match(app, /fallbackTopicId/);
  assert.match(app, /\.\.\.\(topicId \? \{ topic_id: topicId \} : \{\}\)/);
  assert.match(app, /const apiError = payload\?\.error/);
  assert.match(app, /error\.details = \(typeof apiError === "object" \? apiError\?\.details/);
});

test("V5 resource maintenance exposes a guarded delete action", () => {
  assert.match(app, /data-v5-delete-resource/);
  assert.match(app, /async function v5DeleteResource/);
  assert.match(app, /v5Json\("DELETE"/);
  assert.match(styles, /\.viewer-mode \[data-v5-delete-resource\]/);
});

test("V5 resource enabled checkbox uses compact sizing", () => {
  assert.match(html, /id="v5ResourceActive" name="is_active" type="checkbox"/);
  assert.match(styles, /#v5ResourceActive\s*\{[^}]*width:\s*14px[^}]*height:\s*14px/);
});

test("V5 resource active count has its own element id", () => {
  assert.match(html, /id="v5ResourceActiveCount"/);
  assert.match(app, /"#v5ResourceActiveCount": active/);
  assert.equal((html.match(/id="v5ResourceActive"/g) || []).length, 1);
});

test("V5 resource maintenance explains references and supports optional member handover", () => {
  assert.match(html, /id="v5ResourceDeleteDialog"/);
  assert.match(html, /id="v5ResourceTransferBtn"/);
  assert.match(app, /function v5ResourceReferencedTasks/);
  assert.match(app, /async function v5TransferMemberTasks/);
  assert.match(app, /v5OpenResourceDeleteDialog/);
  assert.match(app, /直接删除（保留历史）/);
});

test("V5 execution center can include inactive historical members", () => {
  assert.match(html, /id="v5ExecutionIncludeInactive"/);
  assert.match(app, /includeInactive: true/);
  assert.match(app, /execution\.includeInactive !== false/);
  assert.match(app, /v5MemberStatusBadge/);
  assert.match(styles, /\.v5-member-status-badge/);
});

test("V5 task member options retain selected inactive members but hide them for new tasks", () => {
  assert.match(app, /v5State\.dialogMemberIds\.has\(Number\(member\.id\)\)/);
  assert.match(app, /key === "resource-transfer"/);
  assert.match(app, /（停用）/);
});
