import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const html = read("public/index.html");
const app = read("public/app.js");

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
