import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

test("V5 schedule detail lives inside the execution workspace and is absent until selected", () => {
  const workspace = index.slice(index.indexOf('<section class="v5-execution-workspace">'), index.indexOf('id="v5ResourcesView"'));
  assert.match(workspace, /id="v5ExecutionDetailCard"[^>]*class="v5-execution-card v5-execution-detail-card"[^>]*hidden/);
  assert.match(workspace, /data-v5-exec-close-detail[^>]*aria-label="关闭排期详情"/);
  assert.doesNotMatch(workspace, /data-v5-back-editor/);
});

test("V5 schedule detail toggles the three-column state and supports closing", () => {
  assert.match(app, /card\.hidden = !task/);
  assert.match(app, /workspace\.classList\.toggle\("has-detail", Boolean\(task\)\)/);
  assert.match(app, /data-v5-exec-close-detail[\s\S]*selectedTaskId = null; v5RenderExecution\(\)/);
  assert.match(styles, /\.v5-execution-workspace\.has-detail\s*\{[^}]*grid-template-columns:\s*210px minmax\(0, 1fr\) minmax\(320px, 360px\)/);
  assert.match(styles, /@media \(max-width: 1180px\)[^{]*\{[^}]*\.v5-execution-workspace\.has-detail[^}]*grid-template-columns:\s*200px minmax\(0, 1fr\)/);
  assert.match(styles, /@media \(max-width: 720px\)[^{]*\{[^}]*\.v5-execution-workspace\.has-detail[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*?\.v5-execution-detail-card\s*\{[^}]*width:\s*min\(100%, calc\(100vw - 16px\)\)/);
});

test("V5 schedule facts and member rows use isolated detail styles", () => {
  assert.match(styles, /\.v5-execution-facts\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(styles, /\.v5-execution-facts\s*>\s*div\s*\{[^}]*grid-template-columns:\s*84px minmax\(0, 1fr\)/);
  assert.match(app, /class="v5-execution-detail-members"/);
  assert.match(app, /class="v5-execution-detail-member-row"/);
  assert.doesNotMatch(app.match(/function v5RenderExecutionDetail\(\)[\s\S]*?\n\}/)?.[0] || "", /class="v5-execution-member-list"/);
  assert.match(app, />修改任务时间<\/button>/);
  assert.match(app, />全量编辑<\/button>/);
});
